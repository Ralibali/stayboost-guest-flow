import { readFileSync } from "node:fs";
import { ScriptTarget, transpileModule } from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  runStripeCheckoutDiagnostic,
  type DiagnosticAttempt,
  type DiagnosticStore,
} from "../../supabase/functions/_shared/stripe-checkout-diagnostic";
import { stripeConfigForProperty } from "../../supabase/functions/_shared/stripe-config";
import { verifyStripeSignature } from "../../supabase/functions/_shared/stripe";

const actor = "11111111-1111-4111-8111-111111111111";
const property = "22222222-2222-4222-8222-222222222222";
const attemptId = "33333333-3333-4333-8333-333333333333";
const values: Record<string, string> = {
  STRIPE_PROPERTY_ID: property,
  STRIPE_SECRET_KEY: " rk_test_synthetic ",
  STRIPE_WEBHOOK_SECRET: "whsec_synthetic",
};
const env = (name: string) => values[name];
const makeAttempt = (): DiagnosticAttempt => ({
  id: attemptId,
  property_id: property,
  created_at: new Date().toISOString(),
  lease_id: "44444444-4444-4444-8444-444444444444",
  livemode: false,
  api_version: "2026-08-26.dahlia",
  idempotency_key: `stayboost-checkout-check:v1:${attemptId}`,
  expires_at: Math.floor(Date.now() / 1000) + 1860,
  session_id: null,
  request_body: {
    mode: "payment",
    "metadata[stayboost_diagnostic]": attemptId,
    "metadata[property_id]": property,
    expires_at: String(Math.floor(Date.now() / 1000) + 1860),
  },
});
const makeStore = (attempt = makeAttempt()) => ({
  claim: vi.fn<DiagnosticStore["claim"]>().mockResolvedValue({ state: "claimed", attempt }),
  finish: vi.fn<DiagnosticStore["finish"]>().mockResolvedValue(true),
});
const session = (a: DiagnosticAttempt, patch: Record<string, unknown> = {}) => ({
  id: "cs_test_synthetic",
  object: "checkout.session",
  mode: "payment",
  livemode: false,
  payment_status: "unpaid",
  amount_total: 1000,
  currency: "sek",
  client_reference_id: null,
  customer: null,
  customer_email: null,
  expires_at: a.expires_at,
  metadata: { stayboost_diagnostic: a.id, property_id: a.property_id },
  status: "open",
  url: "https://checkout.stripe.com/PRIVATE",
  ...patch,
});
const ok = (a: DiagnosticAttempt, patch: Record<string, unknown> = {}) =>
  new Response(JSON.stringify(session(a, patch)), { status: 200 });
const run = (store: DiagnosticStore) => runStripeCheckoutDiagnostic(actor, property, env, store);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("unpaid owner Checkout creation and immediate expiry", () => {
  it("performs only fixed create+expire requests, uses frozen fields, and emits no provider data", async () => {
    const a = makeAttempt(),
      store = makeStore(a),
      fetch = vi
        .fn()
        .mockResolvedValueOnce(ok(a))
        .mockResolvedValueOnce(ok(a, { status: "expired" }));
    vi.stubGlobal("fetch", fetch);
    const result = await run(store);
    expect(result.status).toBe("create_and_expire_confirmed");
    expect(Object.keys(result).sort()).toEqual(["checkedAt", "status"]);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|cs_test|rk_test|http/);
    expect(fetch.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      ["https://api.stripe.com/v1/checkout/sessions", "POST"],
      ["https://api.stripe.com/v1/checkout/sessions/cs_test_synthetic/expire", "POST"],
    ]);
    expect(fetch.mock.calls[0][1]).toMatchObject({
      headers: {
        Authorization: "Bearer rk_test_synthetic",
        "Stripe-Version": a.api_version,
        "Idempotency-Key": a.idempotency_key,
      },
      redirect: "error",
      signal: expect.any(AbortSignal),
    });
    expect(Object.fromEntries(new URLSearchParams(fetch.mock.calls[0][1].body))).toEqual(
      a.request_body,
    );
    expect(fetch.mock.calls[1][1].headers["Idempotency-Key"]).toBe(`${a.idempotency_key}:expire`);
    expect(store.finish.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ["cs_test_synthetic", null],
      ["cs_test_synthetic", "create_and_expire_confirmed"],
    ]);
    expect(store.claim.mock.calls[0][0].fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });
  it("replays the exact creation body and key after unknown network failure, with no new attempt", async () => {
    const a = makeAttempt(),
      store = makeStore(a),
      fetch = vi
        .fn()
        .mockRejectedValueOnce(new Error("PRIVATE key and URL"))
        .mockResolvedValueOnce(ok(a))
        .mockResolvedValueOnce(ok(a, { status: "expired" }));
    vi.stubGlobal("fetch", fetch);
    expect((await run(store)).status).toBe("create_not_confirmed");
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 20_000);
    expect((await run(store)).status).toBe("create_and_expire_confirmed");
    expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body);
    expect(fetch.mock.calls[0][1].headers["Idempotency-Key"]).toBe(
      fetch.mock.calls[1][1].headers["Idempotency-Key"],
    );
  });
  it("keeps a delayed first-create validation failure unresolved instead of inventing a new expiry/key", async () => {
    const a = makeAttempt();
    a.created_at = new Date(Date.now() - 120_000).toISOString();
    a.expires_at -= 120;
    a.request_body.expires_at = String(a.expires_at);
    const store = makeStore(a),
      fetch = vi.fn().mockResolvedValue(new Response("PRIVATE validation error", { status: 400 }));
    vi.stubGlobal("fetch", fetch);
    expect((await run(store)).status).toBe("create_not_confirmed");
    expect(new URLSearchParams(fetch.mock.calls[0][1].body).get("expires_at")).toBe(
      String(a.expires_at),
    );
    expect(store.finish).toHaveBeenCalledWith(a, null, "create_not_confirmed");
  });
  it("checks an internally saved session after expiry timeout without another create", async () => {
    const a = makeAttempt(),
      store = makeStore(a),
      fetch = vi.fn().mockResolvedValueOnce(ok(a)).mockRejectedValueOnce(new Error("PRIVATE"));
    vi.stubGlobal("fetch", fetch);
    expect((await run(store)).status).toBe("expiry_not_confirmed");
    a.session_id = "cs_test_synthetic";
    a.created_at = new Date(Date.now() - 25 * 3600000).toISOString();
    fetch.mockResolvedValueOnce(ok(a, { status: "expired" }));
    expect((await run(store)).status).toBe("create_and_expire_confirmed");
    expect(fetch.mock.calls[2]).toEqual([
      "https://api.stripe.com/v1/checkout/sessions/cs_test_synthetic",
      expect.objectContaining({ method: "GET" }),
    ]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("never replays an unknown create at the pruning safety boundary", async () => {
    const a = makeAttempt();
    a.created_at = new Date(Date.now() - 23 * 3600000).toISOString();
    const store = makeStore(a),
      fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect((await run(store)).status).toBe("attempt_requires_followup");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("still expires the known session if its intermediate database checkpoint fails", async () => {
    const a = makeAttempt(),
      store = makeStore(a);
    store.finish.mockRejectedValueOnce(new Error("PRIVATE")).mockResolvedValueOnce(true);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(ok(a))
      .mockResolvedValueOnce(ok(a, { status: "expired" }));
    vi.stubGlobal("fetch", fetch);
    expect((await run(store)).status).toBe("create_and_expire_confirmed");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each([401, 403, 429, 500])(
    "sanitizes create HTTP%s without reading error text",
    async (status) => {
      const a = makeAttempt(),
        store = makeStore(a),
        response = new Response("PRIVATE provider details", { status });
      const text = vi.spyOn(response, "text"),
        json = vi.spyOn(response, "json");
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
      const result = await run(store);
      expect(result.status).toBe(
        status === 401
          ? "authentication_failed"
          : status === 403
            ? "permission_denied"
            : "create_not_confirmed",
      );
      expect(text).not.toHaveBeenCalled();
      expect(json).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain("PRIVATE");
    },
  );
  it.each([
    { status: "complete" },
    { payment_status: "paid" },
    { livemode: true },
    { client_reference_id: "a-booking" },
    { customer: "cus_unrelated" },
    { metadata: { stayboost_diagnostic: "another", property_id: property } },
    { metadata: { stayboost_diagnostic: attemptId, property_id: property, booking_id: "booking" } },
    { amount_total: 999 },
    { currency: "eur" },
  ])("never expires an unrelated or unexpected provider response: %j", async (patch) => {
    const a = makeAttempt(),
      store = makeStore(a),
      fetch = vi.fn().mockResolvedValue(ok(a, patch));
    vi.stubGlobal("fetch", fetch);
    expect((await run(store)).status).toBe("create_not_confirmed");
    expect(fetch).toHaveBeenCalledOnce();
    expect(store.finish.mock.calls[0][1]).toBeNull();
  });
  it("does not claim success from an unconfirmed expiry or stale database lease", async () => {
    const a = makeAttempt(),
      store = makeStore(a);
    const fetch = vi.fn().mockResolvedValueOnce(ok(a)).mockResolvedValueOnce(ok(a));
    vi.stubGlobal("fetch", fetch);
    expect((await run(store)).status).toBe("expiry_not_confirmed");
    store.finish.mockResolvedValue(false);
    fetch.mockResolvedValueOnce(ok(a, { status: "expired" }));
    expect((await run(store)).status).toBe("diagnostic_unavailable");
  });
  it("rejects oversized successful bodies and enforces the five-second abort signal", async () => {
    const a = makeAttempt(),
      store = makeStore(a),
      timeout = vi.spyOn(AbortSignal, "timeout");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x".repeat(65537))));
    expect((await run(store)).status).toBe("create_not_confirmed");
    expect(timeout).toHaveBeenCalledWith(5000);
  });
  it("aborts a hanging provider request and retains an unknown creation for the same-attempt retry", async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new Error("PRIVATE network timeout")), ms);
      return controller.signal;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal!.addEventListener("abort", () => reject(init.signal!.reason), {
              once: true,
            });
          }),
      ),
    );
    const store = makeStore();
    const pending = run(store);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(5000);
    const result = await pending;
    expect(result.status).toBe("create_not_confirmed");
    expect(store.finish.mock.calls[0][2]).toBe("create_not_confirmed");
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });
  it("never expires another session returned for an already bound diagnostic ID", async () => {
    const a = makeAttempt();
    a.session_id = "cs_test_bound";
    const fetch = vi.fn().mockResolvedValue(ok(a, { id: "cs_test_other" }));
    vi.stubGlobal("fetch", fetch);
    expect((await run(makeStore(a))).status).toBe("expiry_not_confirmed");
    expect(fetch).toHaveBeenCalledOnce();
  });
  it.each(["in_progress", "configuration_changed", "attempt_requires_followup"] as const)(
    "does not contact Stripe for %s",
    async (state) => {
      const store = makeStore();
      store.claim.mockResolvedValue({ state });
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      expect((await run(store)).status).toBe(state);
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it("rejects an incorrectly scoped merchant before persistence or provider access", async () => {
    const store = makeStore(),
      fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect((await runStripeCheckoutDiagnostic(actor, actor, env, store)).status).toBe(
      "configuration_invalid",
    );
    expect(store.claim).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});

function sourceHandler(path: string, dependencies: Record<string, unknown>) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8").replace(
    /import[\s\S]*?from\s+["'][^"']+["'];\s*/g,
    "",
  );
  let handler!: (request: Request) => Promise<Response>;
  new Function(
    "Deno",
    ...Object.keys(dependencies),
    transpileModule(source, { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText,
  )(
    {
      serve: (fn: typeof handler) => {
        handler = fn;
      },
      env: { get: env },
    },
    ...Object.values(dependencies),
  );
  return (request: Request) => handler(request);
}
describe("actual owner endpoint and signed diagnostic webhook boundaries", () => {
  it("runs the real owner handler and helper using only private diagnostic RPCs, returning status/time", async () => {
    const a = makeAttempt(),
      queried: string[] = [],
      calls: Array<[string, Record<string, unknown>]> = [];
    const filters: Record<string, unknown> = {};
    const query = {
      select: () => query,
      eq: (k: string, v: unknown) => {
        filters[k] = v;
        return query;
      },
      maybeSingle: async () => ({
        data: filters.id === property && filters.owner_id === actor ? { id: property } : null,
        error: null,
      }),
    };
    const admin = {
      auth: { getUser: async () => ({ data: { user: { id: actor } }, error: null }) },
      from: (table: string) => {
        queried.push(table);
        return query;
      },
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push([name, args]);
        if (name === "claim_stripe_checkout_diagnostic")
          return { data: { state: "claimed", attempt: a }, error: null };
        if (name === "finish_stripe_checkout_diagnostic") return { data: true, error: null };
        throw new Error("No operational RPC permitted");
      },
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(ok(a))
        .mockResolvedValueOnce(ok(a, { status: "expired" })),
    );
    const handler = sourceHandler("../../supabase/functions/stripe-checkout-diagnostic/index.ts", {
      createClient: () => admin,
      runStripeCheckoutDiagnostic,
    });
    const response = await handler(
      new Request("https://example.test", {
        method: "POST",
        headers: { authorization: "Bearer owner" },
        body: JSON.stringify({ propertyId: property }),
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(["checkedAt", "status"]);
    expect(body.status).toBe("create_and_expire_confirmed");
    expect(JSON.stringify(body)).not.toMatch(/PRIVATE|cs_test|rk_test|http/);
    expect(queried).toEqual(["properties"]);
    expect(calls.map(([name]) => name)).toEqual([
      "claim_stripe_checkout_diagnostic",
      "finish_stripe_checkout_diagnostic",
      "finish_stripe_checkout_diagnostic",
    ]);
  });
  it.each(["missing JWT", "invalid JWT", "foreign property", "untrusted body"])(
    "rejects %s before Stripe or diagnostic writes",
    async (kind) => {
      const run = vi.fn();
      const filters: Record<string, unknown> = {};
      const query = {
        select: () => query,
        eq: (k: string, v: unknown) => {
          filters[k] = v;
          return query;
        },
        maybeSingle: async () => ({
          data: kind === "foreign property" ? null : { id: property },
          error: null,
        }),
      };
      const handler = sourceHandler(
        "../../supabase/functions/stripe-checkout-diagnostic/index.ts",
        {
          createClient: () => ({
            auth: {
              getUser: async () => ({
                data: { user: kind === "invalid JWT" ? null : { id: actor } },
                error: null,
              }),
            },
            from: () => query,
          }),
          runStripeCheckoutDiagnostic: run,
        },
      );
      const response = await handler(
        new Request("https://example.test", {
          method: "POST",
          headers: kind === "missing JWT" ? {} : { authorization: "Bearer synthetic" },
          body: JSON.stringify(
            kind === "untrusted body"
              ? { propertyId: property, url: "https://evil.test" }
              : { propertyId: property },
          ),
        }),
      );
      expect(response.status).toBe(
        kind === "untrusted body" ? 400 : kind === "foreign property" ? 403 : 401,
      );
      expect(run).not.toHaveBeenCalled();
      if (kind === "foreign property") expect(filters).toEqual({ id: property, owner_id: actor });
    },
  );
  it("acknowledges a real-signature-format expiry with no booking reference before any database client/ledger use", async () => {
    const createClient = vi.fn(() => {
      throw new Error("No DB client permitted");
    });
    const handler = sourceHandler("../../supabase/functions/stripe-webhook/index.ts", {
      stripeConfigForProperty,
      verifyStripeSignature,
      createClient,
    });
    const now = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({
      id: "evt_synthetic",
      created: now,
      type: "checkout.session.expired",
      livemode: false,
      data: {
        object: {
          id: "cs_test_synthetic",
          metadata: { stayboost_diagnostic: attemptId, property_id: property },
        },
      },
    });
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode("whsec_synthetic"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = Array.from(
      new Uint8Array(
        await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${now}.${body}`)),
      ),
      (x) => x.toString(16).padStart(2, "0"),
    ).join("");
    const response = await handler(
      new Request("https://example.test", {
        method: "POST",
        body,
        headers: { "stripe-signature": `t=${now},v1=${signature}` },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, ignored: "no_booking_ref" });
    expect(createClient).not.toHaveBeenCalled();
  });
});

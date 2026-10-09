import { readFileSync } from "node:fs";
import { ScriptTarget, transpileModule } from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { diagnoseStripeConnection } from "../../supabase/functions/_shared/stripe-diagnostic";
import { STRIPE_API_VERSION } from "../../supabase/functions/_shared/stripe";
import { stripeReadiness } from "../../supabase/functions/_shared/stripe-config";
import { readStripeDiagnostic } from "./stripe-diagnostic";

const propertyId = "11111111-1111-4111-8111-111111111111";
const otherPropertyId = "22222222-2222-4222-8222-222222222222";
const checkedAt = "2026-10-09T17:00:00.000Z";
const environment = (patch: Record<string, string | undefined> = {}) => {
  const values: Record<string, string | undefined> = {
    STRIPE_PROPERTY_ID: propertyId,
    STRIPE_SECRET_KEY: " \trk_test_synthetic\r\n",
    ...patch,
  };
  return (name: string) => values[name];
};

function discardedResponse(status: number) {
  const cancel = vi.fn().mockResolvedValue(undefined);
  const json = vi.fn(() => {
    throw new Error("Customer JSON must never be read");
  });
  const text = vi.fn(() => {
    throw new Error("Customer text must never be read");
  });
  return {
    response: { status, body: { cancel }, json, text } as unknown as Response,
    cancel,
    json,
    text,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("read-only Stripe connection diagnostic", () => {
  it("uses only the fixed GET, normalized server key, pinned API, no redirects and 5 second deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(checkedAt));
    const response = discardedResponse(200);
    const fetch = vi.fn().mockResolvedValue(response.response);
    vi.stubGlobal("fetch", fetch);
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const result = await diagnoseStripeConnection(propertyId, environment());
    expect(result).toEqual({ status: "read_access_confirmed", checkedAt });
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      "https://api.stripe.com/v1/checkout/sessions?limit=1",
      {
        method: "GET",
        headers: {
          Authorization: "Bearer rk_test_synthetic",
          "Stripe-Version": STRIPE_API_VERSION,
        },
        redirect: "error",
        signal: expect.any(AbortSignal),
      },
    );
    expect(timeout).toHaveBeenCalledExactlyOnceWith(5_000);
    expect(response.cancel).toHaveBeenCalledOnce();
    expect(response.json).not.toHaveBeenCalled();
    expect(response.text).not.toHaveBeenCalled();
    expect(Object.keys(result).sort()).toEqual(["checkedAt", "status"]);
  });

  it.each([
    [401, "authentication_failed"],
    [403, "permission_denied"],
    [429, "rate_limited"],
    [500, "stripe_unavailable"],
    [503, "stripe_unavailable"],
    [302, "unexpected_response"],
    [400, "unexpected_response"],
    [204, "unexpected_response"],
  ])("sanitizes HTTP %s without reading even its error body", async (status, expected) => {
    const response = discardedResponse(status as number);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response.response));
    const result = await diagnoseStripeConnection(propertyId, environment());
    expect(result.status).toBe(expected);
    expect(response.cancel).toHaveBeenCalledOnce();
    expect(response.json).not.toHaveBeenCalled();
    expect(response.text).not.toHaveBeenCalled();
    expect(readStripeDiagnostic(result)).toEqual(result);
  });

  it.each([
    { STRIPE_PROPERTY_ID: undefined },
    { STRIPE_PROPERTY_ID: otherPropertyId },
    { STRIPE_PROPERTY_ID: "*" },
    { STRIPE_SECRET_KEY: undefined },
    { STRIPE_SECRET_KEY: "pk_live_synthetic" },
    { STRIPE_SECRET_KEY: "rk_live_bad padding" },
    { STRIPE_PAYMENT_METHOD_CONFIGURATION_ID: "bad-method-config" },
  ])(
    "does not call Stripe with invalid local configuration or a different property: %j",
    async (patch) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      expect((await diagnoseStripeConnection(propertyId, environment(patch))).status).toBe(
        "configuration_invalid",
      );
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("fails closed on redirects/network rejection without forwarding exception details", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValue(
        new TypeError("redirect target https://private.test/customer?key=rk_test_PRIVATE"),
      );
    vi.stubGlobal("fetch", fetch);
    const result = await diagnoseStripeConnection(propertyId, environment());
    expect(result.status).toBe("connection_failed");
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1].redirect).toBe("error");
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|customer|https|key=/);
  });

  it("aborts the request at the configured deadline and returns a sanitized timeout", async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new Error("PRIVATE timeout detail")), ms);
      return controller.signal;
    });
    const fetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
        }),
    );
    vi.stubGlobal("fetch", fetch);
    let settled = false;
    const pending = diagnoseStripeConnection(propertyId, environment()).then((result) => {
      settled = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(4999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).status).toBe("timeout");
    expect(fetch.mock.calls[0][1].signal?.aborted).toBe(true);
  });

  it("does not wait for or expose body cancellation failures", async () => {
    const response = discardedResponse(200);
    response.cancel.mockRejectedValue(new Error("PRIVATE body details"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response.response));
    expect((await diagnoseStripeConnection(propertyId, environment())).status).toBe(
      "read_access_confirmed",
    );
  });
});

function handler(
  options: {
    authenticated?: boolean;
    ownedProperty?: string;
    databaseError?: boolean;
    env?: Record<string, string | undefined>;
  } = {},
) {
  const queries: string[] = [];
  const env = vi.fn(environment(options.env));
  const rpc = vi.fn(() => {
    throw new Error("Diagnostic must not mutate data");
  });
  const client = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: options.authenticated === false ? null : { id: "owner" } },
        error: null,
      })),
    },
    rpc,
    from(table: string) {
      queries.push(table);
      const filters: Record<string, unknown> = {};
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => {
          filters[key] = value;
          return query;
        },
        maybeSingle: async () => ({
          data:
            filters.owner_id === "owner" && filters.id === (options.ownedProperty ?? propertyId)
              ? { id: filters.id }
              : null,
          error: options.databaseError ? { message: "PRIVATE database details" } : null,
        }),
      };
      return query;
    },
  };
  const source = readFileSync(
    new URL("../../supabase/functions/booking-import/index.ts", import.meta.url),
    "utf8",
  ).replace(/import[\s\S]*?from\s+["'][^"']+["'];\s*/g, "");
  const code = transpileModule(source, {
    compilerOptions: { target: ScriptTarget.ES2022 },
  }).outputText;
  let serve!: (request: Request) => Promise<Response>;
  new Function("Deno", "createClient", "stripeReadiness", "diagnoseStripeConnection", code)(
    {
      serve: (fn: typeof serve) => {
        serve = fn;
      },
      env: { get: env },
    },
    () => client,
    stripeReadiness,
    diagnoseStripeConnection,
  );
  const request = (
    body: Record<string, unknown> = {},
    authorization: string | null = "Bearer synthetic-owner",
  ) =>
    serve(
      new Request("https://example.test/booking-import", {
        method: "POST",
        headers: {
          ...(authorization ? { authorization } : {}),
          "content-type": "application/json",
        },
        body: JSON.stringify({ propertyId, action: "stripe_diagnostic", ...body }),
      }),
    );
  return { request, queries, rpc, env };
}

describe("actual booking-import diagnostic authorization", () => {
  it.each(["no bearer", "invalid JWT", "not owner", "database error"])(
    "rejects %s before configuration or Stripe access",
    async (caseName) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      const runtime = handler({
        authenticated: caseName !== "invalid JWT",
        databaseError: caseName === "database error",
      });
      const response = await runtime.request(
        caseName === "not owner" ? { propertyId: otherPropertyId } : {},
        caseName === "no bearer" ? null : "Bearer synthetic-owner",
      );
      expect(response.status).toBe(
        caseName === "database error" ? 503 : caseName === "not owner" ? 403 : 401,
      );
      expect(fetch).not.toHaveBeenCalled();
      expect(runtime.env.mock.calls.map(([name]) => name)).not.toContain("STRIPE_SECRET_KEY");
      expect(runtime.rpc).not.toHaveBeenCalled();
      expect(JSON.stringify(await response.json())).not.toContain("PRIVATE");
    },
  );

  it("does not let an authorized owner of a different property borrow the scoped merchant", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const response = await handler({ ownedProperty: otherPropertyId }).request({
      propertyId: otherPropertyId,
    });
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe("configuration_invalid");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns only status and timestamp, ignores request transport overrides, never imports or reads bookings", async () => {
    const response = discardedResponse(200);
    const fetch = vi.fn().mockResolvedValue(response.response);
    vi.stubGlobal("fetch", fetch);
    const runtime = handler();
    const result = await runtime.request({
      url: "https://evil.test",
      method: "POST",
      key: "attacker",
      rows: [{ guest: "PRIVATE" }],
    });
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("no-store");
    const body = await result.json();
    expect(Object.keys(body).sort()).toEqual(["checkedAt", "status"]);
    expect(body.status).toBe("read_access_confirmed");
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      "https://api.stripe.com/v1/checkout/sessions?limit=1",
      expect.objectContaining({ method: "GET", redirect: "error" }),
    );
    expect(runtime.queries).toEqual(["properties"]);
    expect(runtime.rpc).not.toHaveBeenCalled();
    expect(response.json).not.toHaveBeenCalled();
  });
});

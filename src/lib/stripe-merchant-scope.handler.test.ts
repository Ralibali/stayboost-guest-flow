import { readFileSync } from "node:fs";
import { ScriptTarget, transpileModule } from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stripeConfigForProperty } from "../../supabase/functions/_shared/stripe-config";
import * as stripe from "../../supabase/functions/_shared/stripe";
import * as lifecycle from "../../supabase/functions/_shared/payment-lifecycle";

const PROPERTY = "11111111-1111-4111-8111-111111111111";
const env = {
  STRIPE_SECRET_KEY: "rk_test_synthetic",
  STRIPE_WEBHOOK_SECRET: "whsec_synthetic",
  STRIPE_PROPERTY_ID: PROPERTY,
};
type Row = Record<string, unknown>;
function runtime(
  slug: "stripe-refund" | "payment-action",
  rowPatch: Row = {},
  envPatch: Record<string, string | undefined> = {},
) {
  const booking: Row = {
    id: "booking",
    property_id: PROPERTY,
    source: "direct",
    status: "confirmed",
    payment_method: "stripe",
    payment_status: "paid",
    payment_amount: 1000,
    payment_ref: "SB-SYNTHETIC",
    stripe_session_id: "cs_synthetic",
    stripe_payment_intent_id: null,
    stripe_refund_id: null,
    payment_expires_at: null,
    properties: { owner_id: "owner" },
    ...rowPatch,
  };
  const writes: Row[] = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "owner" } }, error: null }) },
    from(table: string) {
      expect(table).toBe("bookings");
      let patch: Row | null = null;
      const filters: Row = {};
      const execute = () => {
        if (!Object.entries(filters).every(([key, value]) => booking[key] === value))
          return { data: null, error: null };
        if (patch) {
          writes.push(patch);
          Object.assign(booking, patch);
        }
        return { data: { ...booking }, error: null };
      };
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => {
          filters[key] = value;
          return query;
        },
        is: (key: string, value: unknown) => {
          filters[key] = value;
          return query;
        },
        update: (value: Row) => {
          patch = value;
          return query;
        },
        maybeSingle: async () => execute(),
      };
      return query;
    },
  };
  const source = readFileSync(
    new URL(`../../supabase/functions/${slug}/index.ts`, import.meta.url),
    "utf8",
  ).replace(/import[\s\S]*?from\s+["'][^"']+["'];\s*/g, "");
  const code = transpileModule(source, {
    compilerOptions: { target: ScriptTarget.ES2022 },
  }).outputText;
  const bindings = { createClient: () => client, stripeConfigForProperty, ...stripe, ...lifecycle };
  let handler!: (request: Request) => Promise<Response>;
  new Function("Deno", ...Object.keys(bindings), code)(
    {
      serve: (callback: typeof handler) => {
        handler = callback;
      },
      env: {
        get: (key: string) =>
          (({ ...env, ...envPatch }) as Record<string, string | undefined>)[key],
      },
    },
    ...Object.values(bindings),
  );
  return {
    booking,
    writes,
    request: () =>
      handler(
        new Request(`https://example.test/${slug}`, {
          method: "POST",
          headers: { authorization: "Bearer synthetic", "Content-Type": "application/json" },
          body: JSON.stringify({ bookingId: "booking", action: "cancel_booking" }),
        }),
      ),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("actual owner payment handlers use the merchant property before money/state changes", () => {
  it.each(["stripe-refund", "payment-action"] as const)(
    "%s rejects another owned property's Stripe booking before network or state changes",
    async (slug) => {
      const fetch = vi.fn(() => {
        throw new Error("Unexpected network");
      });
      vi.stubGlobal("fetch", fetch);
      const f = runtime(slug, {
        property_id: "22222222-2222-4222-8222-222222222222",
        payment_status: slug === "payment-action" ? "pending" : "paid",
      });
      expect((await f.request()).status).toBe(503);
      expect(f.writes).toEqual([]);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each(["STRIPE_PROPERTY_ID", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"])(
    "refund fails closed before refund_pending if %s is missing",
    async (field) => {
      const fetch = vi.fn(() => {
        throw new Error("Unexpected network");
      });
      vi.stubGlobal("fetch", fetch);
      const f = runtime("stripe-refund", {}, { [field]: undefined });
      expect((await f.request()).status).toBe(503);
      expect(f.writes).toEqual([]);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("completes a verified same-property full refund and pins both session read and refund creation", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return Response.json(
          url.includes("/checkout/sessions/")
            ? {
                id: "cs_synthetic",
                client_reference_id: "booking",
                metadata: { booking_id: "booking", payment_ref: "SB-SYNTHETIC" },
                payment_intent: "pi_synthetic",
                payment_status: "paid",
                currency: "sek",
                amount_total: 100000,
              }
            : { id: "re_synthetic", status: "succeeded" },
        );
      }),
    );
    const f = runtime("stripe-refund");
    const response = await f.request();
    expect(response.status).toBe(200);
    expect(f.booking).toMatchObject({
      payment_status: "refunded",
      stripe_payment_intent_id: "pi_synthetic",
      stripe_refund_id: "re_synthetic",
    });
    expect(f.writes.map((row) => row.payment_status)).toEqual(["refund_pending", "refunded"]);
    expect(calls).toHaveLength(2);
    for (const call of calls)
      expect(new Headers(call.init?.headers).get("Stripe-Version")).toBe(stripe.STRIPE_API_VERSION);
    expect(new Headers(calls[1].init?.headers).get("Idempotency-Key")).toBe(
      "stayboost-refund-booking",
    );
    const form = new URLSearchParams(String(calls[1].init?.body));
    expect(form.get("payment_intent")).toBe("pi_synthetic");
    expect(form.get("metadata[booking_id]")).toBe("booking");
  });
});

describe("Checkout transport contract", () => {
  it("uses dynamic methods, fixed quote currency, stable idempotency, and the pinned integration identifier", async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({ id: "cs_synthetic", url: "https://checkout.stripe.com/synthetic" }),
    );
    vi.stubGlobal("fetch", fetch);
    await stripe.createCheckoutSession({
      secretKey: "rk_test_synthetic",
      amountSek: 2329,
      description: "Synthetic stay",
      paymentRef: "SB-SYNTHETIC",
      bookingId: "booking",
      successUrl: "https://example.test/success",
      cancelUrl: "https://example.test/cancel",
      idempotencyKey: "stable-booking-id",
    });
    const init = fetch.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("Stripe-Version")).toBe(stripe.STRIPE_API_VERSION);
    expect(headers.get("Idempotency-Key")).toBe("stable-booking-id");
    const form = new URLSearchParams(String(init.body));
    expect(form.get("line_items[0][price_data][unit_amount]")).toBe("232900");
    expect(form.get("line_items[0][price_data][currency]")).toBe("sek");
    expect(form.get("adaptive_pricing[enabled]")).toBe("false");
    expect(form.get("integration_identifier")).toMatch(/^stayboost-guest-[a-z]{8}$/);
    expect([...form.keys()].some((key) => key.startsWith("payment_method_types"))).toBe(false);
  });
});

it("passes only a valid configured payment-method configuration and leaves it optional", () => {
  const config = stripeConfigForProperty(
    PROPERTY,
    (key) =>
      (
        ({ ...env, STRIPE_PAYMENT_METHOD_CONFIGURATION_ID: "pmc_Glamping123" }) as Record<
          string,
          string
        >
      )[key],
  );
  expect(config?.paymentMethodConfiguration).toBe("pmc_Glamping123");
  expect(
    stripeConfigForProperty(PROPERTY, (key) => (env as Record<string, string>)[key])
      ?.paymentMethodConfiguration,
  ).toBeUndefined();
  const params = {
    secretKey: "rk_test_synthetic",
    amountSek: 1000,
    description: "Stay",
    paymentRef: "SB-TEST",
    bookingId: "booking",
    successUrl: "https://example.test/success",
    cancelUrl: "https://example.test/cancel",
  };
  expect(
    new URLSearchParams(
      stripe.checkoutBody({
        ...params,
        paymentMethodConfiguration: config!.paymentMethodConfiguration,
      }),
    ).get("payment_method_configuration"),
  ).toBe("pmc_Glamping123");
  expect(new URLSearchParams(stripe.checkoutBody(params)).has("payment_method_configuration")).toBe(
    false,
  );
  expect(
    stripeConfigForProperty(
      PROPERTY,
      (key) =>
        (
          ({ ...env, STRIPE_PAYMENT_METHOD_CONFIGURATION_ID: "pmc_x&amount=0" }) as Record<
            string,
            string
          >
        )[key],
    ),
  ).toBeNull();
  expect(() => stripe.checkoutBody({ ...params, paymentMethodConfiguration: "wrong" })).toThrow(
    "invalid_payment_method_configuration",
  );
});

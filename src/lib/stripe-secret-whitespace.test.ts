import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { ScriptTarget, transpileModule } from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  stripeConfigForProperty,
  stripeReadiness,
} from "../../supabase/functions/_shared/stripe-config";
import * as stripe from "../../supabase/functions/_shared/stripe";
import * as lifecycle from "../../supabase/functions/_shared/payment-lifecycle";

const PROPERTY = "11111111-1111-4111-8111-111111111111";
const WEBHOOK_SECRET = "whsec_synthetic";
function environment(patch: Record<string, string | undefined> = {}) {
  const values: Record<string, string | undefined> = {
    STRIPE_PROPERTY_ID: ` \t${PROPERTY}\n`,
    STRIPE_SECRET_KEY: " \trk_live_synthetic\r\n",
    STRIPE_WEBHOOK_SECRET: `\r\n${WEBHOOK_SECRET}\t `,
    STRIPE_PAYMENT_METHOD_CONFIGURATION_ID: " \tpmc_Synthetic123\n",
    ...patch,
  };
  return (key: string) => values[key];
}

afterEach(() => vi.unstubAllGlobals());

describe("Stripe secret copy/paste padding", () => {
  it.each(["rk_live", "rk_test", "sk_live", "sk_test"])(
    "validates and uses the same normalized %s credentials and mode",
    (prefix) => {
      const env = environment({ STRIPE_SECRET_KEY: `\n ${prefix}_synthetic\t\r\n` });
      expect(stripeReadiness(PROPERTY, env)).toEqual({
        stripeConfigured: true,
        stripeWebhookConfigured: true,
      });
      expect(stripeConfigForProperty(PROPERTY, env)).toEqual({
        propertyId: PROPERTY,
        secretKey: `${prefix}_synthetic`,
        webhookSecret: WEBHOOK_SECRET,
        paymentMethodConfiguration: "pmc_Synthetic123",
        livemode: prefix.endsWith("live"),
      });
    },
  );

  it.each([
    ["STRIPE_SECRET_KEY", undefined],
    ["STRIPE_SECRET_KEY", " \t\r\n"],
    ["STRIPE_SECRET_KEY", "rk_live_ \t"],
    ["STRIPE_SECRET_KEY", "pk_live_synthetic"],
    ["STRIPE_SECRET_KEY", "rk_live_syn thetic"],
    ["STRIPE_SECRET_KEY", "rk_live_syn\nthetic"],
    ["STRIPE_WEBHOOK_SECRET", undefined],
    ["STRIPE_WEBHOOK_SECRET", " \t\r\n"],
    ["STRIPE_WEBHOOK_SECRET", "whsec_ \t"],
    ["STRIPE_WEBHOOK_SECRET", "wrong_synthetic"],
    ["STRIPE_WEBHOOK_SECRET", "whsec_syn thetic"],
    ["STRIPE_WEBHOOK_SECRET", "whsec_syn\r\nthetic"],
  ])("fails closed for malformed %s input %#", (field, value) => {
    const env = environment({ [field!]: value });
    expect(stripeConfigForProperty(PROPERTY, env)).toBeNull();
    expect(stripeReadiness(PROPERTY, env)).toEqual({
      stripeConfigured: field !== "STRIPE_SECRET_KEY",
      stripeWebhookConfigured: field !== "STRIPE_WEBHOOK_SECRET",
    });
  });

  it("keeps property isolation and optional payment-method configuration validation", () => {
    const otherProperty = "22222222-2222-4222-8222-222222222222";
    expect(stripeConfigForProperty(otherProperty, environment())).toBeNull();
    expect(stripeReadiness(otherProperty, environment())).toEqual({
      stripeConfigured: false,
      stripeWebhookConfigured: false,
    });
    expect(
      stripeConfigForProperty(PROPERTY, environment({ STRIPE_PROPERTY_ID: "not-a-uuid" })),
    ).toBeNull();
    expect(
      stripeConfigForProperty(
        PROPERTY,
        environment({ STRIPE_PAYMENT_METHOD_CONFIGURATION_ID: "pmc_syn thetic" }),
      ),
    ).toBeNull();
    expect(
      stripeConfigForProperty(
        PROPERTY,
        environment({ STRIPE_PAYMENT_METHOD_CONFIGURATION_ID: " \t\n" }),
      )?.paymentMethodConfiguration,
    ).toBeUndefined();
  });

  it("passes the normalized restricted key to the actual Checkout transport", async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({ id: "cs_synthetic", url: "https://checkout.stripe.com/synthetic" }),
    );
    vi.stubGlobal("fetch", fetch);
    const config = stripeConfigForProperty(PROPERTY, environment())!;
    await stripe.createCheckoutSession({
      secretKey: config.secretKey,
      paymentMethodConfiguration: config.paymentMethodConfiguration,
      amountSek: 329,
      description: "Synthetic stay",
      bookingId: "synthetic-booking",
      paymentRef: "SB-SYNTHETIC",
      successUrl: "https://example.test/success",
      cancelUrl: "https://example.test/cancel",
    });
    expect(fetch).toHaveBeenCalledOnce();
    // Inspect the original object, since Headers would itself trim some padding.
    expect(fetch.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: "Bearer rk_live_synthetic",
    });
  });
});

function webhookRuntime(env: (name: string) => string | undefined) {
  const createClient = vi.fn(() => {
    throw new Error("This synthetic event must never reach the database");
  });
  const source = readFileSync(
    new URL("../../supabase/functions/stripe-webhook/index.ts", import.meta.url),
    "utf8",
  ).replace(/import[\s\S]*?from\s+["'][^"']+["'];\s*/g, "");
  const code = transpileModule(source, {
    compilerOptions: { target: ScriptTarget.ES2022 },
  }).outputText;
  const bindings = { createClient, stripeConfigForProperty, ...stripe, ...lifecycle };
  let handler!: (request: Request) => Promise<Response>;
  new Function("Deno", ...Object.keys(bindings), code)(
    { serve: (fn: typeof handler) => (handler = fn), env: { get: env } },
    ...Object.values(bindings),
  );
  return { handler, createClient };
}

describe("actual webhook uses the normalized signing secret", () => {
  it.each([true, false])("accepts a signed synthetic event in livemode=%s", async (livemode) => {
    const runtime = webhookRuntime(
      environment({ STRIPE_SECRET_KEY: ` \trk_${livemode ? "live" : "test"}_synthetic\n` }),
    );
    const fetch = vi.fn(() => {
      throw new Error("This synthetic event must never call Stripe");
    });
    vi.stubGlobal("fetch", fetch);
    const timestamp = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({
      id: "evt_synthetic_padding",
      type: "checkout.session.completed",
      created: timestamp,
      livemode,
      data: { object: {} },
    });
    const signature = createHmac("sha256", WEBHOOK_SECRET)
      .update(`${timestamp}.${body}`)
      .digest("hex");
    const request = (sig: string) =>
      new Request("https://example.test/stripe-webhook", {
        method: "POST",
        headers: { "stripe-signature": `t=${timestamp},v1=${sig}` },
        body,
      });
    const response = await runtime.handler(request(signature));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, ignored: "no_booking_ref" });
    const invalid = await runtime.handler(request("0".repeat(64)));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "invalid_signature" });
    expect(runtime.createClient).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});

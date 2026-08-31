import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const migration = read("supabase/migrations/20260831130000_saas_billing_foundation.sql");
const endpoint = read("supabase/functions/saas-billing/index.ts");
const webhook = read("supabase/functions/saas-stripe-webhook/index.ts");
const stripe = read("supabase/functions/_shared/saas-stripe.ts");
const config = read("supabase/config.toml");
const panel = read("src/components/app/BillingPanel.tsx");
const env = read(".env.example");

describe("StayBoost SaaS billing activation", () => {
  it("keeps operator subscription state separate and server-owned", () => {
    expect(migration).toContain("create table if not exists public.account_subscriptions");
    expect(migration).toContain("references auth.users(id) on delete cascade");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain('create policy "Owners read own subscription"');
    expect(migration).toContain("revoke insert, update, delete");
    expect(migration).toContain("public.saas_billing_events");
  });

  it("activates the published monthly and annual prices with Swedish VAT on top", () => {
    expect(endpoint).not.toContain("SAAS_BILLING_ENABLED");
    expect(endpoint).not.toContain("STAYBOOST_STRIPE_PRICE_MONTHLY");
    expect(stripe).toContain("STAYBOOST_MONTHLY_ORE = 44_900");
    expect(stripe).toContain("STAYBOOST_ANNUAL_ORE = 449_000");
    expect(stripe).toContain('body.set("mode", "subscription")');
    expect(stripe).toContain('body.set("line_items[0][price_data][recurring][interval]", params.interval)');
    expect(stripe).toContain('body.set("line_items[0][price_data][tax_behavior]", "exclusive")');
    expect(stripe).toContain('body.set("percentage", "25")');
    expect(stripe).toContain('body.set("tax_type", "vat")');
    expect(stripe).toContain('body.set("line_items[0][tax_rates][0]", params.taxRateId)');
  });

  it("uses authenticated owner actions and synchronizes status from Stripe on demand", () => {
    expect(config).toContain("[functions.saas-billing]\nverify_jwt = true");
    expect(endpoint).toContain("userClient.auth.getUser()");
    expect(endpoint).toContain("listOwnerSaasSubscriptions");
    expect(endpoint).toContain("persistSubscription");
    expect(endpoint).toContain('enabled: Boolean(stripeKey)');
    expect(env).toContain("Status synkas från Stripe när billingvyn används");
  });

  it("reuses customers and open checkout sessions instead of creating duplicates", () => {
    expect(stripe).toContain("stayboost-customer-${params.ownerId}");
    expect(stripe).toContain("findOpenSaasCheckout");
    expect(stripe).toContain('status: "open"');
    expect(endpoint).toContain("openCheckout?.url");
    expect(endpoint).toContain('error: "already_subscribed"');
  });

  it("provisions a self-service portal with card, invoices and period-end cancellation", () => {
    expect(stripe).toContain('body.set("features[invoice_history][enabled]", "true")');
    expect(stripe).toContain('body.set("features[payment_method_update][enabled]", "true")');
    expect(stripe).toContain('body.set("features[subscription_cancel][enabled]", "true")');
    expect(stripe).toContain('body.set("features[subscription_cancel][mode]", "at_period_end")');
    expect(endpoint).toContain("ensureSaasPortalConfiguration");
    expect(endpoint).toContain("createSaasPortal");
  });

  it("keeps the separately signed webhook as an idempotent realtime accelerator", () => {
    expect(config).toContain("[functions.saas-stripe-webhook]\nverify_jwt = false");
    expect(webhook).toContain('Deno.env.get("SAAS_STRIPE_WEBHOOK_SECRET")');
    expect(webhook).toContain("verifyStripeSignature");
    expect(webhook).toContain('from("saas_billing_events").insert');
    expect(webhook).toContain('claimError?.code === "23505"');
    expect(webhook).toContain('object.mode !== "subscription" || metadata.product !== "stayboost"');
  });

  it("keeps SMS included and never models it as a metered billing item", () => {
    expect(panel).toContain("449 kr/mån");
    expect(panel).toContain("4 490 kr/år");
    expect(panel).toContain("SMS ingår utan separat kostnad");
    expect(stripe).toContain("inklusive SMS utan separat SMS-kostnad");
    expect(stripe).not.toContain("usage_type");
    expect(stripe).not.toContain("metered");
    expect(env).toContain("SMS ingår i StayBoost-abonnemanget");
  });
});

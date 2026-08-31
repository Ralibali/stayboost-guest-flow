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

describe("StayBoost SaaS billing foundation", () => {
  it("keeps operator subscription state separate and server-owned", () => {
    expect(migration).toContain("create table if not exists public.account_subscriptions");
    expect(migration).toContain("references auth.users(id) on delete cascade");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain('create policy "Owners read own subscription"');
    expect(migration).toContain("revoke insert, update, delete");
    expect(migration).toContain("public.saas_billing_events");
  });

  it("cannot create a real subscription until the explicit production gate is enabled", () => {
    expect(endpoint).toContain('Deno.env.get("SAAS_BILLING_ENABLED") === "true"');
    expect(endpoint).toContain('return json({ error: "billing_disabled" }, 409)');
    expect(endpoint).toContain('Deno.env.get("STAYBOOST_STRIPE_PRICE_MONTHLY")');
    expect(stripe).toContain('body.set("mode", "subscription")');
    expect(stripe).toContain('body.set("line_items[0][price]", params.priceId)');
    expect(stripe).not.toMatch(/price_[A-Za-z0-9]{8,}/);
    expect(env).toContain("SAAS_BILLING_ENABLED=false");
  });

  it("uses authenticated owner actions and a separately signed, idempotent webhook", () => {
    expect(config).toContain("[functions.saas-billing]\nverify_jwt = true");
    expect(config).toContain("[functions.saas-stripe-webhook]\nverify_jwt = false");
    expect(endpoint).toContain("userClient.auth.getUser()");
    expect(webhook).toContain('Deno.env.get("SAAS_STRIPE_WEBHOOK_SECRET")');
    expect(webhook).toContain("verifyStripeSignature");
    expect(webhook).toContain('from("saas_billing_events").insert');
    expect(webhook).toContain('claimError?.code === "23505"');
  });

  it("rejects unrelated Stripe subscriptions even on the same Stripe account", () => {
    expect(webhook).toContain('object.mode !== "subscription" || metadata.product !== "stayboost"');
    expect(webhook).toContain('subscription.metadata?.product !== "stayboost"');
    expect(webhook).toContain("subscription.metadata?.owner_id !== ownerId");
    expect(webhook).toContain('if (metadata.product !== "stayboost")');
    expect(webhook).toContain("ownerId !== clientReferenceId");
  });

  it("keeps the commercial SMS policy visible in billing UI", () => {
    expect(panel).toContain("449 kr/mån");
    expect(panel).toContain("SMS ingår utan separat kostnad");
    expect(panel).toContain("Betalningsflödet är förberett men ännu inte aktiverat");
  });
});

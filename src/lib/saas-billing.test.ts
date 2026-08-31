import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const migration = read("supabase/migrations/20260831113000_saas_billing.sql");
const shared = read("supabase/functions/_shared/saas-billing.ts");
const billing = read("supabase/functions/saas-billing/index.ts");
const panel = read("src/components/app/BillingPanel.tsx");
const config = read("supabase/config.toml");

describe("StayBoost SaaS billing", () => {
  it("stores subscription state server-side and only lets owners read their row", () => {
    expect(migration).toContain("create table if not exists public.billing_accounts");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("owner_id = (select auth.uid())");
    expect(migration).toContain("revoke insert, update, delete on table public.billing_accounts from authenticated");
  });

  it("locks the published monthly and annual prices without SMS metering", () => {
    expect(shared).toContain("STAYBOOST_MONTHLY_ORE = 44_900");
    expect(shared).toContain("STAYBOOST_ANNUAL_ORE = 449_000");
    expect(migration).toContain("SMS is included in the subscription and is never metered here");
    expect(panel).toContain("SMS ingår utan separat kostnad");
    expect(panel).toContain("449 kr/mån");
    expect(panel).toContain("4 490 kr/år");
  });

  it("requires an authenticated owner for checkout, status and customer portal", () => {
    expect(config).toContain("[functions.saas-billing]\nverify_jwt = true");
    expect(billing).toContain('userClient.auth.getUser()');
    expect(billing).toContain('action?: "status" | "checkout" | "portal"');
    expect(billing).toContain('mode: "subscription"');
    expect(billing).toContain('/billing_portal/sessions');
  });

  it("adds Swedish VAT on top of the public ex-VAT list price", () => {
    expect(shared).toContain("percentage: 25");
    expect(shared).toContain('country: "SE"');
    expect(shared).toContain("inclusive: false");
    expect(billing).toContain('"line_items[0][tax_rates][0]": taxRateId');
  });

  it("reuses Stripe customers/checkouts and syncs cancellation/payment status before showing it", () => {
    expect(shared).toContain("stayboost-saas-customer-");
    expect(billing).toContain("stripe_checkout_session_id");
    expect(billing).toContain("prior.status === \"open\"");
    expect(billing).toContain("syncBillingAccount(admin, stripeKey, account)");
    expect(shared).toContain("cancel_at_period_end");
    expect(shared).toContain("current_period_end");
  });
});

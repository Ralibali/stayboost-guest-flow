import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const migration = read("supabase/migrations/20260831143500_platform_owner_admin.sql");
const endpoint = read("supabase/functions/platform-admin/index.ts");
const config = read("supabase/config.toml");
const panel = read("src/components/app/PlatformOwnerPanel.tsx");
const shell = read("src/components/app/AppShell.tsx");

describe("StayBoost platform owner admin", () => {
  it("uses a server-managed allowlist that clients cannot read or mutate", () => {
    expect(migration).toContain("create table if not exists public.platform_admins");
    expect(migration).toContain("references auth.users(id) on delete cascade");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain(
      "revoke all on table public.platform_admins from public, anon, authenticated",
    );
    expect(migration).toContain("grant select, insert, update, delete");
  });

  it("requires both a valid JWT and platform-admin membership server-side", () => {
    expect(config).toContain("[functions.platform-admin]\nverify_jwt = true");
    expect(endpoint).toContain("userClient.auth.getUser()");
    expect(endpoint).toContain('.from("platform_admins")');
    expect(endpoint).toContain('.eq("user_id", userData.user.id)');
    expect(endpoint).toContain('return json({ error: "forbidden" }, 403)');
  });

  it("reports platform economics from verified StayBoost subscriptions", () => {
    expect(endpoint).toContain("retrieveSaasSubscription");
    expect(endpoint).toContain("isAllowedSaasSubscriptionPrice");
    expect(endpoint).toContain("subscription.metadata?.owner_id !== row.owner_id");
    expect(endpoint).toContain("mrrSek");
    expect(endpoint).toContain("arrSek");
    expect(endpoint).toContain("canceling");
    expect(endpoint).toContain("paymentProblems");
    expect(panel).toContain("Aktiva abonnemang");
    expect(panel).toContain("ARR run-rate");
    expect(panel).toContain("Aktiverade");
  });

  it("does not expose guest booking records to the platform dashboard", () => {
    expect(endpoint).toContain('.from("bookings").select("id", { count: "exact", head: true })');
    expect(endpoint).not.toContain("guest_name");
    expect(endpoint).not.toContain("guest_email");
    expect(endpoint).not.toContain("guest_phone");
    expect(panel).toContain("Ingen");
    expect(panel).toContain("gäst-PII");
  });

  it("keeps owner admin invisible to ordinary customer accounts", () => {
    expect(panel).toContain('supabase.functions.invoke("platform-admin"');
    expect(panel).toContain("Vanliga kundkonton får 403");
    expect(panel).toContain("if (error || !data?.ok)");
    expect(panel).toContain("if (loading || !overview) return null");
    expect(shell).toContain('pathname.startsWith("/app/installningar")');
    expect(shell).toContain("<PlatformOwnerPanel />");
  });
});

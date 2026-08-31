import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const helper = read("supabase/functions/_shared/cron-auth.ts");
const opsCron = read("supabase/functions/ops-cron/index.ts");
const icalSync = read("supabase/functions/ical-sync/index.ts");
const messages = read("supabase/functions/send-scheduled-messages/index.ts");
const migration = read("supabase/migrations/20260831100000_cron_vault_auth.sql");

describe("production cron Vault auth", () => {
  it("keeps raw cron credentials out of public/authenticated access", () => {
    expect(migration).toContain("ops_runtime_auth");
    expect(migration).toContain("secret_sha256");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain(
      "revoke all on table public.ops_runtime_auth from public, anon, authenticated",
    );
    expect(migration).not.toMatch(/[A-Za-z0-9_-]{40,}/);
  });

  it("exposes verifier only to service_role", () => {
    expect(migration).toContain("verify_ops_cron_secret");
    expect(migration).toContain("extensions.digest(p_secret, 'sha256')");
    expect(migration).toContain(
      "revoke all on function public.verify_ops_cron_secret(text) from public, anon, authenticated",
    );
    expect(migration).toContain(
      "grant execute on function public.verify_ops_cron_secret(text) to service_role",
    );
  });

  it("supports Edge Function secret fallback plus DB verifier", () => {
    expect(helper).toContain('Deno.env.get("CRON_SECRET")');
    expect(helper).toContain('admin.rpc("verify_ops_cron_secret"');
    expect(helper).toContain("return data === true");
  });

  it("protects every cron-callable worker with the same helper", () => {
    for (const source of [opsCron, icalSync, messages]) {
      expect(source).toContain('import { isCronAuthorized } from "../_shared/cron-auth.ts"');
      expect(source).toContain("await isCronAuthorized(");
    }
  });

  it("keeps manual owner JWT fallback in iCal sync", () => {
    expect(icalSync).toContain('req.headers.get("Authorization")');
    expect(icalSync).toContain("userClient.auth.getUser()");
    expect(icalSync).toContain("ownerFilter = userData.user.id");
  });
});

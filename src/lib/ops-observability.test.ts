import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const migration = read("supabase/migrations/20260830240000_ops_observability.sql");
const cron = read("supabase/functions/ops-cron/index.ts");
const config = read("supabase/config.toml");
const registerCron = read("supabase/cron/register-production-jobs.sql");
const messages = read("supabase/functions/send-scheduled-messages/index.ts");
const appLayout = read("src/routes/app.tsx");
const alertPanel = read("src/components/OpsAlertPanel.tsx");

describe("BP-4 cron + observability", () => {
  it("uses one lease-locked cron orchestrator instead of overlapping workers", () => {
    expect(migration).toContain("ops_claim_cron_run");
    expect(migration).toContain("lock_expires_at");
    expect(cron).toContain("const CRON_LEASE_SECONDS = 6 * 60");
    expect(cron).toContain('admin.rpc("ops_claim_cron_run"');
    expect(cron).toContain("p_ttl_seconds: CRON_LEASE_SECONDS");
    expect(cron).toContain('skipped: "already_running"');
    expect(cron).toContain('admin.rpc("ops_release_cron_run"');
  });

  it("runs payment expiry, guest messages and periodic iCal through tracked jobs", () => {
    expect(cron).toContain('"expire-payment-holds"');
    expect(cron).toContain('admin.rpc("expire_pending_payment_holds"');
    expect(cron).toContain('invokeCronFunction("send-scheduled-messages"');
    expect(cron).toContain('invokeCronFunction("ical-sync"');
    expect(cron).toContain("ICAL_RUN_EVERY_MS");
    expect(cron).toContain("ops_job_state");
  });

  it("lets cron-secret requests reach code without making user-only actions public", () => {
    expect(config).toContain("[functions.ops-cron]\nverify_jwt = false");
    expect(config).toContain("[functions.ical-sync]\nverify_jwt = false");
    expect(config).toContain("[functions.send-scheduled-messages]\nverify_jwt = false");
    expect(config).toContain("[functions.payment-action]\nverify_jwt = true");
    expect(config).toContain("[functions.stripe-refund]\nverify_jwt = true");
    expect(cron).toContain('req.headers.get("x-cron-secret")');
    expect(cron).toContain('Deno.env.get("CRON_SECRET")');
  });

  it("registers production scheduling via pg_cron + pg_net + Vault without committed secrets", () => {
    expect(registerCron).toContain("cron.schedule");
    expect(registerCron).toContain("net.http_post");
    expect(registerCron).toContain("vault.decrypted_secrets");
    expect(registerCron).toContain("stayboost_cron_secret");
    expect(registerCron).toContain("*/5 * * * *");
    expect(registerCron).not.toMatch(/x-cron-secret'\s*,\s*'[A-Za-z0-9_-]{20,}'/);
  });

  it("keeps payment expiry out of the message worker", () => {
    expect(messages).not.toContain("expiredSwishBookings");
    expect(messages).not.toContain('.eq("payment_method", "swish")');
    expect(messages).toContain('["none", "paid"]');
  });

  it("creates deduplicated owner-only alerts for the operational failure modes", () => {
    expect(migration).toContain("operational_alerts");
    expect(migration).toContain("unique (property_id, fingerprint)");
    expect(migration).toContain("Owners read own operational alerts");
    expect(cron).toContain("ical_critical");
    expect(cron).toContain("payment_hold_overdue");
    expect(cron).toContain("stripe_refund_stuck");
    expect(cron).toContain("swish_refund_required");
    expect(cron).toContain("stripe_webhook_failed");
    expect(cron).toContain("message_delivery_failed");
  });

  it("only auto-resolves alerts owned by the BP-4 health scanner", () => {
    expect(cron).toContain("const OPS_ALERT_CODES = [");
    expect(cron).toContain('.in("code", [...OPS_ALERT_CODES])');
  });

  it("surfaces scheduler health and actionable alerts across the operator app", () => {
    expect(appLayout).toContain("OpsAlertPanel");
    expect(alertPanel).toContain("operational_alerts");
    expect(alertPanel).toContain("ops_job_state");
    expect(alertPanel).toContain("Bakgrundsautomatiken är inte frisk");
    expect(alertPanel).toContain("Driftstatus frisk");
  });
});

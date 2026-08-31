import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isCronAuthorized } from "../_shared/cron-auth.ts";

// StayBoost BP-4: en enda cron-ingång för återkommande bakgrundsjobb.
// - x-cron-secret verifieras i funktionen (gateway JWT är avstängd i config.toml)
// - DB-lease hindrar överlappande körningar
// - varje deljobb får heartbeat/resultat
// - health scan skapar deduplicerade ägarspecifika driftlarm

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const MINUTE = 60_000;
const CRON_LEASE_SECONDS = 6 * 60; // Längre än 5-minutersschemat: nästa tick får aldrig överlappa en seg körning.
const ICAL_RUN_EVERY_MS = 12 * MINUTE; // 5-min cron => faktisk körning ungefär var 15:e minut.
const ICAL_WARNING_MS = 20 * MINUTE;
const ICAL_CRITICAL_MS = 35 * MINUTE;
const OVERDUE_HOLD_GRACE_MS = 2 * MINUTE;
const STRIPE_REFUND_STUCK_MS = 10 * MINUTE;
const WEBHOOK_STUCK_MS = 5 * MINUTE;
const FAILED_MESSAGE_LOOKBACK_MS = 24 * 60 * MINUTE;
const OPS_ALERT_CODES = [
  "ical_critical",
  "ical_stale",
  "payment_hold_overdue",
  "stripe_refund_stuck",
  "swish_refund_required",
  "stripe_webhook_failed",
  "message_delivery_failed",
  "background_job_unhealthy",
] as const;

type Admin = ReturnType<typeof createClient>;
type Json = Record<string, unknown>;

type JobResult = {
  job: string;
  ok: boolean;
  skipped?: boolean;
  summary?: unknown;
  error?: string;
};

type AlertIssue = {
  property_id: string;
  fingerprint: string;
  code: (typeof OPS_ALERT_CODES)[number];
  severity: "warning" | "critical";
  title: string;
  detail: string;
  entity_type?: string | null;
  entity_id?: string | null;
  metadata?: Json;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function one<T = any>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return (value[0] as T | undefined) ?? null;
  return value ?? null;
}

async function setJobStarted(admin: Admin, job: string) {
  const now = new Date().toISOString();
  const { error } = await admin
    .from("ops_job_state")
    .upsert({ job_name: job, last_started_at: now, updated_at: now }, { onConflict: "job_name" });
  if (error) throw error;
}

async function setJobSucceeded(admin: Admin, job: string, summary: unknown) {
  const now = new Date().toISOString();
  const { error } = await admin
    .from("ops_job_state")
    .update({
      last_succeeded_at: now,
      last_error: null,
      last_summary: summary ?? {},
      updated_at: now,
    })
    .eq("job_name", job);
  if (error) throw error;
}

async function setJobFailed(admin: Admin, job: string, errorValue: unknown) {
  const now = new Date().toISOString();
  const message = errorMessage(errorValue).slice(0, 1000);
  const { error } = await admin.from("ops_job_state").upsert(
    {
      job_name: job,
      last_failed_at: now,
      last_error: message,
      updated_at: now,
    },
    { onConflict: "job_name" },
  );
  if (error) console.error(`Kunde inte skriva heartbeat för ${job}:`, error.message);
}

async function runTracked(
  admin: Admin,
  job: string,
  fn: () => Promise<unknown>,
): Promise<JobResult> {
  try {
    await setJobStarted(admin, job);
    const summary = await fn();
    await setJobSucceeded(admin, job, summary);
    return { job, ok: true, summary };
  } catch (error) {
    await setJobFailed(admin, job, error);
    return { job, ok: false, error: errorMessage(error) };
  }
}

async function invokeCronFunction(name: string, secret: string) {
  const base = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
  if (!base) throw new Error("SUPABASE_URL saknas");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch(`${base}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cron-secret": secret,
      },
      body: JSON.stringify({ trigger: "ops-cron" }),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload: unknown = text;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      // Behåll texten i fel/sammanfattning.
    }
    if (!response.ok) {
      throw new Error(`${name} HTTP ${response.status}: ${String(text).slice(0, 500)}`);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function icalIsDue(admin: Admin) {
  const { data, error } = await admin
    .from("ops_job_state")
    .select("last_started_at")
    .eq("job_name", "ical-sync")
    .maybeSingle();
  if (error) throw error;
  if (!data?.last_started_at) return true;
  return Date.now() - new Date(data.last_started_at).getTime() >= ICAL_RUN_EVERY_MS;
}

function ageMs(value: string | null | undefined, nowMs: number) {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? nowMs - parsed : Number.POSITIVE_INFINITY;
}

async function scanHealth(admin: Admin) {
  const now = new Date();
  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  const failedSince = new Date(nowMs - FAILED_MESSAGE_LOOKBACK_MS).toISOString();

  const [propertiesRes, sourcesRes, paymentsRes, webhooksRes, messagesRes, jobsRes] =
    await Promise.all([
      admin.from("properties").select("id"),
      admin
        .from("ical_sources")
        .select(
          "id, property_id, name, paused, created_at, consecutive_failures, last_attempt_at, last_success_at, last_status, unit:units(name)",
        )
        .eq("paused", false),
      admin
        .from("bookings")
        .select(
          "id, property_id, guest_name, payment_method, payment_status, payment_amount, payment_ref, payment_expires_at, payment_refund_requested_at, updated_at",
        )
        .in("payment_status", ["pending", "refund_pending"]),
      admin
        .from("stripe_webhook_events")
        .select(
          "event_id, event_type, received_at, processed_at, outcome, last_error, booking:bookings(property_id)",
        )
        .or("processed_at.is.null,last_error.not.is.null"),
      admin
        .from("scheduled_messages")
        .select("id, send_at, error, booking:bookings(property_id, guest_name)")
        .eq("status", "failed")
        .gte("send_at", failedSince)
        .order("send_at", { ascending: false })
        .limit(200),
      admin
        .from("ops_job_state")
        .select("job_name, last_started_at, last_succeeded_at, last_failed_at, last_error"),
    ]);

  const errors = [propertiesRes, sourcesRes, paymentsRes, webhooksRes, messagesRes, jobsRes]
    .map((result) => result.error)
    .filter(Boolean);
  if (errors.length) throw errors[0];

  const propertyIds = (propertiesRes.data ?? []).map((row: any) => row.id as string);
  const issues: AlertIssue[] = [];

  for (const source of sourcesRes.data ?? []) {
    const failures = Number(source.consecutive_failures ?? 0);
    const successAge = ageMs(source.last_success_at, nowMs);
    const sourceAge = ageMs(source.created_at, nowMs);
    if (failures >= 2 || (sourceAge > ICAL_WARNING_MS && successAge > ICAL_CRITICAL_MS)) {
      issues.push({
        property_id: source.property_id,
        fingerprint: `ical:${source.id}`,
        code: "ical_critical",
        severity: "critical",
        title: `Kalendersynken är kritisk: ${source.name}`,
        detail:
          failures >= 2
            ? `${failures} fel i följd. Senaste status: ${source.last_status ?? "okänd"}. Pausa direktbokning för berörd enhet tills synken fungerar.`
            : `Ingen lyckad synk på över 35 minuter. Pausa direktbokning för berörd enhet tills synken fungerar.`,
        entity_type: "ical_source",
        entity_id: source.id,
        metadata: { unit: one<any>(source.unit)?.name ?? null, failures },
      });
    } else if (sourceAge > ICAL_WARNING_MS && successAge > ICAL_WARNING_MS) {
      issues.push({
        property_id: source.property_id,
        fingerprint: `ical:${source.id}`,
        code: "ical_stale",
        severity: "warning",
        title: `Kalendersynken är försenad: ${source.name}`,
        detail: "Ingen lyckad synk på över 20 minuter. StayBoost försöker igen automatiskt.",
        entity_type: "ical_source",
        entity_id: source.id,
        metadata: { unit: one<any>(source.unit)?.name ?? null, failures },
      });
    }
  }

  for (const booking of paymentsRes.data ?? []) {
    if (booking.payment_status === "pending" && booking.payment_expires_at) {
      const overdueMs = nowMs - new Date(booking.payment_expires_at).getTime();
      if (overdueMs > OVERDUE_HOLD_GRACE_MS) {
        issues.push({
          property_id: booking.property_id,
          fingerprint: `payment-expiry:${booking.id}`,
          code: "payment_hold_overdue",
          severity: "critical",
          title: "Betalningsreservation har inte släppts",
          detail: `En utgången ${booking.payment_method}-reservation ligger fortfarande som pending och kan blockera datum.`,
          entity_type: "booking",
          entity_id: booking.id,
          metadata: { paymentRef: booking.payment_ref ?? null },
        });
      }
    }

    if (booking.payment_status === "refund_pending") {
      const requestedAt = booking.payment_refund_requested_at ?? booking.updated_at;
      const refundAge = ageMs(requestedAt, nowMs);
      if (booking.payment_method === "stripe" && refundAge > STRIPE_REFUND_STUCK_MS) {
        issues.push({
          property_id: booking.property_id,
          fingerprint: `refund:${booking.id}`,
          code: "stripe_refund_stuck",
          severity: "critical",
          title: "Stripe-återbetalning har fastnat",
          detail: "Återbetalningen har varit pending i över 10 minuter och behöver kontrolleras.",
          entity_type: "booking",
          entity_id: booking.id,
          metadata: {
            amount: booking.payment_amount ?? null,
            paymentRef: booking.payment_ref ?? null,
          },
        });
      } else if (booking.payment_method === "swish") {
        issues.push({
          property_id: booking.property_id,
          fingerprint: `refund:${booking.id}`,
          code: "swish_refund_required",
          severity: "warning",
          title: "Swish-återbetalning väntar",
          detail: "Swisha tillbaka beloppet och bekräfta därefter återbetalningen i StayBoost.",
          entity_type: "booking",
          entity_id: booking.id,
          metadata: {
            amount: booking.payment_amount ?? null,
            paymentRef: booking.payment_ref ?? null,
          },
        });
      }
    }
  }

  for (const event of webhooksRes.data ?? []) {
    const booking = one<any>(event.booking);
    if (!booking?.property_id) continue;
    const stuck = !event.processed_at && ageMs(event.received_at, nowMs) > WEBHOOK_STUCK_MS;
    if (!event.last_error && !stuck) continue;
    issues.push({
      property_id: booking.property_id,
      fingerprint: `stripe-webhook:${event.event_id}`,
      code: "stripe_webhook_failed",
      severity: "critical",
      title: "Stripe-webhook behöver kontroll",
      detail: event.last_error
        ? `Webhook ${event.event_type} gav fel: ${String(event.last_error).slice(0, 300)}`
        : `Webhook ${event.event_type} har inte behandlats på över 5 minuter.`,
      entity_type: "stripe_webhook",
      entity_id: event.event_id,
      metadata: { outcome: event.outcome ?? null },
    });
  }

  for (const message of messagesRes.data ?? []) {
    const booking = one<any>(message.booking);
    if (!booking?.property_id) continue;
    issues.push({
      property_id: booking.property_id,
      fingerprint: `message:${message.id}`,
      code: "message_delivery_failed",
      severity: "warning",
      title: "Gästmeddelande kunde inte skickas",
      detail: String(message.error ?? "Okänt leveransfel").slice(0, 400),
      entity_type: "scheduled_message",
      entity_id: message.id,
      metadata: { sendAt: message.send_at },
    });
  }

  const expectedJobs: Record<string, number> = {
    "expire-payment-holds": 12 * MINUTE,
    "send-scheduled-messages": 12 * MINUTE,
    "ical-sync": ICAL_CRITICAL_MS,
  };
  for (const state of jobsRes.data ?? []) {
    const maxAge = expectedJobs[state.job_name];
    if (!maxAge) continue;
    const successAge = ageMs(state.last_succeeded_at, nowMs);
    const failedAfterSuccess =
      Boolean(state.last_failed_at) &&
      (!state.last_succeeded_at ||
        new Date(state.last_failed_at).getTime() > new Date(state.last_succeeded_at).getTime());
    if (!failedAfterSuccess && successAge <= maxAge) continue;
    for (const propertyId of propertyIds) {
      issues.push({
        property_id: propertyId,
        fingerprint: `job:${state.job_name}`,
        code: "background_job_unhealthy",
        severity: "critical",
        title: `Bakgrundsjobbet ${state.job_name} är inte friskt`,
        detail: failedAfterSuccess
          ? `Senaste körningen misslyckades: ${state.last_error ?? "okänt fel"}`
          : "Ingen lyckad körning inom förväntat intervall.",
        entity_type: "ops_job",
        entity_id: state.job_name,
      });
    }
  }

  const rows = issues.map((issue) => ({
    ...issue,
    metadata: issue.metadata ?? {},
    last_seen_at: nowIso,
    resolved_at: null,
  }));
  if (rows.length) {
    const { error } = await admin
      .from("operational_alerts")
      .upsert(rows, { onConflict: "property_id,fingerprint" });
    if (error) throw error;
  }

  // Auto-resolve endast larm som den här scannern själv äger. Framtida/manuala
  // producenter i samma tabell får aldrig få sina larm släckta av BP-4.
  const { data: openAlerts, error: openError } = await admin
    .from("operational_alerts")
    .select("id, property_id, fingerprint")
    .in("code", [...OPS_ALERT_CODES])
    .is("resolved_at", null);
  if (openError) throw openError;

  const active = new Set(issues.map((issue) => `${issue.property_id}:${issue.fingerprint}`));
  const resolvedIds = (openAlerts ?? [])
    .filter((alert: any) => !active.has(`${alert.property_id}:${alert.fingerprint}`))
    .map((alert: any) => alert.id as string);
  if (resolvedIds.length) {
    const { error } = await admin
      .from("operational_alerts")
      .update({ resolved_at: nowIso })
      .in("id", resolvedIds);
    if (error) throw error;
  }

  return {
    open: issues.length,
    critical: issues.filter((issue) => issue.severity === "critical").length,
    warning: issues.filter((issue) => issue.severity === "warning").length,
    resolved: resolvedIds.length,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const secret = req.headers.get("x-cron-secret") ?? "";
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  if (!(await isCronAuthorized(admin, secret))) {
    return json({ error: "unauthorized" }, 401);
  }
  const runId = crypto.randomUUID();

  const { data: claimed, error: claimError } = await admin.rpc("ops_claim_cron_run", {
    p_run_id: runId,
    p_ttl_seconds: CRON_LEASE_SECONDS,
  });
  if (claimError) return json({ error: claimError.message }, 500);
  if (!claimed) return json({ ok: true, skipped: "already_running" }, 202);

  const results: JobResult[] = [];
  try {
    results.push(
      await runTracked(admin, "expire-payment-holds", async () => {
        const { data, error } = await admin.rpc("expire_pending_payment_holds", {
          p_now: new Date().toISOString(),
        });
        if (error) throw error;
        return { expired: Number(data ?? 0) };
      }),
    );

    results.push(
      await runTracked(admin, "send-scheduled-messages", () =>
        invokeCronFunction("send-scheduled-messages", secret),
      ),
    );

    try {
      if (await icalIsDue(admin)) {
        results.push(
          await runTracked(admin, "ical-sync", () => invokeCronFunction("ical-sync", secret)),
        );
      } else {
        results.push({ job: "ical-sync", ok: true, skipped: true });
      }
    } catch (error) {
      await setJobFailed(admin, "ical-sync", error);
      results.push({ job: "ical-sync", ok: false, error: errorMessage(error) });
    }

    results.push(await runTracked(admin, "ops-health", () => scanHealth(admin)));

    const failed = results.filter((result) => !result.ok);
    if (failed.length) {
      const message = failed.map((result) => `${result.job}: ${result.error}`).join("; ");
      await setJobFailed(admin, "ops-cron", message);
      return json({ ok: false, runId, results }, 500);
    }

    await setJobSucceeded(admin, "ops-cron", { results });
    return json({ ok: true, runId, results });
  } catch (error) {
    await setJobFailed(admin, "ops-cron", error);
    return json({ error: "ops_cron_failed", detail: errorMessage(error), runId, results }, 500);
  } finally {
    const { error } = await admin.rpc("ops_release_cron_run", { p_run_id: runId });
    if (error) console.error("Kunde inte släppa ops-cron lease:", error.message);
  }
});

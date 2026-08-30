import { Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, type OperationalAlert, type OpsJobState } from "@/lib/supabase";

const CRON_STALE_MS = 12 * 60 * 1000;

function formatTime(value: string | null) {
  if (!value) return "aldrig";
  return new Date(value).toLocaleString("sv-SE", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function alertTarget(code: string): "/app/kallor" | "/app/bokningar" | "/app/mallar" | "/app/idag" {
  if (code.startsWith("ical_")) return "/app/kallor";
  if (code.includes("payment") || code.includes("refund") || code.includes("stripe_webhook")) {
    return "/app/bokningar";
  }
  if (code.includes("message")) return "/app/mallar";
  return "/app/idag";
}

export function OpsAlertPanel({ propertyId }: { propertyId: string }) {
  const [alerts, setAlerts] = useState<OperationalAlert[]>([]);
  const [jobs, setJobs] = useState<OpsJobState[]>([]);
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!supabase) return;
    const [alertsResult, jobsResult] = await Promise.all([
      supabase
        .from("operational_alerts")
        .select("*")
        .eq("property_id", propertyId)
        .is("resolved_at", null)
        .order("severity")
        .order("last_seen_at", { ascending: false })
        .limit(20),
      supabase.from("ops_job_state").select("*").order("job_name"),
    ]);

    // Rolling deploy-säkert: UI:t får inte gå sönder om frontend hinner före migrationen.
    if (alertsResult.error || jobsResult.error) {
      setAvailable(false);
      setLoading(false);
      return;
    }

    setAlerts((alertsResult.data as OperationalAlert[]) ?? []);
    setJobs((jobsResult.data as OpsJobState[]) ?? []);
    setAvailable(true);
    setLoading(false);
  }, [propertyId]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const cron = useMemo(() => jobs.find((job) => job.job_name === "ops-cron") ?? null, [jobs]);
  const cronFailedAfterSuccess = Boolean(
    cron?.last_failed_at &&
    (!cron.last_succeeded_at ||
      new Date(cron.last_failed_at).getTime() > new Date(cron.last_succeeded_at).getTime()),
  );
  const cronStale =
    available &&
    (!cron?.last_succeeded_at ||
      Date.now() - new Date(cron.last_succeeded_at).getTime() > CRON_STALE_MS);
  const criticalCount = alerts.filter((alert) => alert.severity === "critical").length;

  if (loading || !available) return null;

  if (!cronStale && !cronFailedAfterSuccess && alerts.length === 0) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[11px] font-semibold text-emerald-900">
        <span className="inline-flex items-center gap-1.5">
          <CheckCircle2 size={15} /> Driftstatus frisk
        </span>
        <span className="font-medium text-emerald-800/65">
          Automatik senast OK {formatTime(cron?.last_succeeded_at ?? null)}
        </span>
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-[24px] border border-red-200 bg-red-50/70">
      <div className="flex flex-col gap-3 border-b border-red-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.15em] text-red-700/65">
            <ShieldAlert size={13} /> Driftlarm
          </p>
          <h2 className="mt-1 font-[Fraunces] text-[20px] font-semibold text-red-950">
            {criticalCount || cronStale || cronFailedAfterSuccess
              ? "Något kräver åtgärd"
              : "Driften behöver koll"}
          </h2>
        </div>
        <button
          onClick={load}
          className="inline-flex items-center gap-1.5 self-start rounded-full border border-red-200 bg-white/70 px-3 py-1.5 text-[10px] font-bold text-red-800"
        >
          <RefreshCw size={12} /> Kontrollera igen
        </button>
      </div>

      <div className="divide-y divide-red-200/70">
        {cronStale || cronFailedAfterSuccess ? (
          <div className="flex items-start gap-3 px-5 py-4">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-700" />
            <div>
              <p className="text-[12px] font-bold text-red-950">
                Bakgrundsautomatiken är inte frisk
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-red-900/70">
                {cronFailedAfterSuccess
                  ? `Senaste cron-körningen misslyckades: ${cron?.last_error ?? "okänt fel"}`
                  : `Ingen lyckad cron-körning inom 12 minuter. Senast OK: ${formatTime(cron?.last_succeeded_at ?? null)}.`}
              </p>
            </div>
          </div>
        ) : null}

        {alerts.slice(0, 6).map((alert) => (
          <Link
            key={alert.id}
            to={alertTarget(alert.code)}
            className="flex items-start gap-3 px-5 py-4 transition hover:bg-white/55"
          >
            <AlertTriangle
              size={16}
              className={`mt-0.5 shrink-0 ${alert.severity === "critical" ? "text-red-700" : "text-amber-700"}`}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[12px] font-bold text-red-950">{alert.title}</p>
                <span
                  className={`rounded-full px-2 py-0.5 text-[8px] font-bold uppercase tracking-wide ${
                    alert.severity === "critical"
                      ? "bg-red-200 text-red-900"
                      : "bg-amber-100 text-amber-900"
                  }`}
                >
                  {alert.severity === "critical" ? "Kritisk" : "Varning"}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-red-900/65">{alert.detail}</p>
            </div>
            <span className="shrink-0 text-[11px] font-bold text-red-800/55">Öppna →</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

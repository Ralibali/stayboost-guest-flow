import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Clock3, Save, Send, Workflow } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  supabase,
  useProperty,
  useSession,
  TRIGGER_LABELS,
  type MessageTemplate,
} from "@/lib/supabase";

export const Route = createFileRoute("/app/mallar")({
  component: TemplatesPage,
});

const VARIABLES = [
  "gäst_namn",
  "anläggning",
  "enhet",
  "incheckning",
  "utcheckning",
  "incheckningstid",
  "utcheckningstid",
  "gästsida_länk",
  "wifi_namn",
  "wifi_lösenord",
  "vägbeskrivning",
  "recensionslänk",
];

const TRIGGER_HINTS: Record<MessageTemplate["trigger_type"], string> = {
  booking_created: "När bokningen är bekräftad och betalningsläget tillåter utskick",
  pre_arrival: "Före ankomst – bygg förväntan och minska praktiska frågor",
  checkin_day: "På incheckningsdagen – rätt information precis när gästen behöver den",
  post_stay: "Efter vistelsen – recension, återbesök och nästa relation",
};

const JOURNEY_ORDER: MessageTemplate["trigger_type"][] = [
  "booking_created",
  "pre_arrival",
  "checkin_day",
  "post_stay",
];

type QueueRow = {
  id: string;
  status: "pending" | "sent" | "failed" | "cancelled";
  send_at: string;
  sent_at: string | null;
  channel: "email" | "sms";
  template: { trigger_type: MessageTemplate["trigger_type"] } | null;
};

function TemplatesPage() {
  const session = useSession();
  const { property } = useProperty(session);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set());
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !property) return;
    setError(null);

    const [templatesResult, queueResult] = await Promise.all([
      supabase
        .from("message_templates")
        .select("*")
        .eq("property_id", property.id)
        .order("trigger_type"),
      supabase
        .from("scheduled_messages")
        .select(
          "id,status,send_at,sent_at,channel,template:message_templates(trigger_type),booking:bookings!inner(property_id)",
        )
        .eq("booking.property_id", property.id)
        .order("send_at", { ascending: false })
        .limit(500),
    ]);

    if (templatesResult.error) {
      setError(`Kunde inte läsa mallarna: ${templatesResult.error.message}`);
      return;
    }
    if (queueResult.error) {
      setError(`Kunde inte läsa gästresan: ${queueResult.error.message}`);
      return;
    }

    setTemplates((templatesResult.data as MessageTemplate[]) ?? []);
    setQueue((queueResult.data as unknown as QueueRow[]) ?? []);
    setDirtyIds(new Set());
  }, [property]);

  useEffect(() => {
    load();
  }, [load]);

  const metrics = useMemo(() => {
    const now = Date.now();
    const sent = queue.filter((row) => row.status === "sent").length;
    const pending = queue.filter((row) => row.status === "pending").length;
    const failed = queue.filter((row) => row.status === "failed").length;
    const upcoming = queue.filter(
      (row) => row.status === "pending" && new Date(row.send_at).getTime() >= now,
    ).length;
    const deliveryBase = sent + failed;
    return {
      sent,
      pending,
      failed,
      upcoming,
      deliveryRate: deliveryBase > 0 ? Math.round((sent / deliveryBase) * 100) : null,
    };
  }, [queue]);

  const stageMetrics = useMemo(
    () =>
      Object.fromEntries(
        JOURNEY_ORDER.map((trigger) => {
          const rows = queue.filter((row) => row.template?.trigger_type === trigger);
          return [
            trigger,
            {
              sent: rows.filter((row) => row.status === "sent").length,
              pending: rows.filter((row) => row.status === "pending").length,
              failed: rows.filter((row) => row.status === "failed").length,
            },
          ];
        }),
      ) as Record<
        MessageTemplate["trigger_type"],
        { sent: number; pending: number; failed: number }
      >,
    [queue],
  );

  const edit = (id: string, patch: Partial<MessageTemplate>) => {
    setTemplates((current) =>
      current.map((template) => (template.id === id ? { ...template, ...patch } : template)),
    );
    setDirtyIds((current) => new Set(current).add(id));
    setSavedId(null);
  };

  const save = async (template: MessageTemplate) => {
    if (!supabase) return;
    setSavingId(template.id);
    setError(null);
    const { id, property_id, trigger_type, ...patch } = template;
    const { error: saveError } = await supabase
      .from("message_templates")
      .update(patch)
      .eq("id", id)
      .eq("property_id", property_id);
    setSavingId(null);
    if (saveError) {
      setError(`Kunde inte spara ${TRIGGER_LABELS[trigger_type]}: ${saveError.message}`);
      return;
    }
    setDirtyIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setSavedId(id);
    await load();
    setSavedId(id);
    setTimeout(() => setSavedId((current) => (current === id ? null : current)), 1600);
  };

  if (!property) return null;

  return (
    <div className="mx-auto max-w-5xl">
      <p className="eyebrow">Gästresa · Automationer</p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-[Fraunces] text-3xl font-semibold">Automatiserad gästresa</h1>
          <p className="mt-1 max-w-2xl text-[14px] text-[color:var(--ink)]/65">
            En sammanhängande resa från bokning till återbesök. StayBoost använder samma kö och
            mallar som dina riktiga utskick – ingen separat automationsmotor att hålla synkad.
          </p>
        </div>
        <button onClick={load} className="btn-secondary !rounded-xl !px-3 !py-2 text-[12px]">
          <Workflow size={14} /> Uppdatera status
        </button>
      </div>

      {error && (
        <p className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-[13px] text-red-700">{error}</p>
      )}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          icon={Send}
          label="Skickade"
          value={String(metrics.sent)}
          hint="Senaste 500 köhändelser"
        />
        <Metric
          icon={Clock3}
          label="Kommande"
          value={String(metrics.upcoming)}
          hint={`${metrics.pending} väntar totalt`}
        />
        <Metric
          icon={CheckCircle2}
          label="Leveransgrad"
          value={metrics.deliveryRate === null ? "—" : `${metrics.deliveryRate}%`}
          hint="Skickade av skickade + misslyckade"
        />
        <Metric
          icon={AlertTriangle}
          label="Misslyckade"
          value={String(metrics.failed)}
          hint="Behöver åtgärd"
          danger={metrics.failed > 0}
        />
      </div>

      <section className="card-surface mt-5 p-5">
        <div className="flex items-center gap-2">
          <Workflow size={17} className="text-[color:var(--forest)]" />
          <h2 className="text-[15px] font-bold">Resan steg för steg</h2>
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-4">
          {JOURNEY_ORDER.map((trigger, index) => {
            const template = templates.find((item) => item.trigger_type === trigger);
            const stage = stageMetrics[trigger];
            return (
              <div
                key={trigger}
                className="relative rounded-xl border border-[color:var(--line)] bg-white p-3.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--ink)]/45">
                    Steg {index + 1}
                  </span>
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${template?.enabled ? "bg-[color:var(--success)]" : "bg-[color:var(--line)]"}`}
                    title={template?.enabled ? "Aktiv" : "Avstängd"}
                  />
                </div>
                <p className="mt-2 text-[13px] font-bold">{TRIGGER_LABELS[trigger]}</p>
                <p className="mt-1 text-[11px] text-[color:var(--ink)]/55">
                  {stage.sent} skickade · {stage.pending} väntar
                  {stage.failed > 0 ? ` · ${stage.failed} fel` : ""}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      <div className="mt-5 flex flex-wrap gap-1.5">
        {VARIABLES.map((variable) => (
          <code
            key={variable}
            className="rounded-full bg-[color:var(--forest)]/8 px-2.5 py-1 text-[11px] font-semibold text-[color:var(--forest)]"
          >
            {`{{${variable}}}`}
          </code>
        ))}
      </div>

      <div className="mt-6 space-y-4">
        {templates
          .slice()
          .sort(
            (a, b) => JOURNEY_ORDER.indexOf(a.trigger_type) - JOURNEY_ORDER.indexOf(b.trigger_type),
          )
          .map((template) => {
            const dirty = dirtyIds.has(template.id);
            const saving = savingId === template.id;
            return (
              <section
                key={template.id}
                className={`card-surface p-5 transition ${template.enabled ? "" : "opacity-70"}`}
              >
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-[15px] font-bold">
                      {TRIGGER_LABELS[template.trigger_type]}
                    </h2>
                    <p className="text-[12px] text-[color:var(--ink)]/55">
                      {TRIGGER_HINTS[template.trigger_type]}
                      {dirty && (
                        <span className="font-semibold text-amber-700"> · Osparade ändringar</span>
                      )}
                      {savedId === template.id && (
                        <span className="font-semibold text-[color:var(--success)]">
                          {" "}
                          · ✓ Sparat och kön uppdaterad
                        </span>
                      )}
                    </p>
                  </div>
                  <button
                    onClick={() => edit(template.id, { enabled: !template.enabled })}
                    role="switch"
                    aria-checked={template.enabled}
                    title={template.enabled ? "Aktiv" : "Avstängd"}
                    className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${template.enabled ? "bg-[color:var(--success)]" : "bg-[color:var(--line)]"}`}
                  >
                    <span
                      className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${template.enabled ? "left-6" : "left-1"}`}
                    />
                  </button>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <label className="block">
                    <span className="text-[12px] font-medium text-[color:var(--ink)]/55">
                      Kanal
                    </span>
                    <select
                      value={template.channel}
                      onChange={(event) =>
                        edit(template.id, {
                          channel: event.target.value as MessageTemplate["channel"],
                        })
                      }
                      className="inp mt-1"
                    >
                      <option value="email">E-post</option>
                      <option value="sms">SMS</option>
                      <option value="both">Båda</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-[12px] font-medium text-[color:var(--ink)]/55">
                      Förskjutning, dagar
                    </span>
                    <input
                      type="number"
                      min={-30}
                      max={30}
                      value={template.offset_days}
                      onChange={(event) =>
                        edit(template.id, {
                          offset_days: Math.min(30, Math.max(-30, Number(event.target.value) || 0)),
                        })
                      }
                      className="inp mt-1"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[12px] font-medium text-[color:var(--ink)]/55">
                      Klockslag
                    </span>
                    <input
                      type="time"
                      value={template.send_time}
                      onChange={(event) => edit(template.id, { send_time: event.target.value })}
                      className="inp mt-1"
                    />
                  </label>
                </div>

                {template.channel !== "sms" && (
                  <label className="mt-3 block">
                    <span className="text-[12px] font-medium text-[color:var(--ink)]/55">Ämne</span>
                    <input
                      value={template.subject ?? ""}
                      onChange={(event) => edit(template.id, { subject: event.target.value })}
                      className="inp mt-1"
                    />
                  </label>
                )}
                <label className="mt-3 block">
                  <span className="text-[12px] font-medium text-[color:var(--ink)]/55">
                    Meddelande
                  </span>
                  <textarea
                    value={template.body}
                    rows={6}
                    onChange={(event) => edit(template.id, { body: event.target.value })}
                    className="inp mt-1 resize-y"
                  />
                </label>

                <div className="mt-4 flex justify-end">
                  <button
                    onClick={() => save(template)}
                    disabled={!dirty || saving || !template.body.trim()}
                    className="btn-primary !rounded-xl !px-4 !py-2.5 text-[13px] disabled:opacity-35"
                  >
                    <Save size={15} /> {saving ? "Sparar…" : "Spara & uppdatera resa"}
                  </button>
                </div>
              </section>
            );
          })}
      </div>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  hint,
  danger = false,
}: {
  icon: typeof Send;
  label: string;
  value: string;
  hint: string;
  danger?: boolean;
}) {
  return (
    <div className="card-surface p-4">
      <div className="flex items-center gap-2 text-[12px] font-semibold text-[color:var(--ink)]/55">
        <Icon size={14} className={danger ? "text-red-600" : "text-[color:var(--forest)]"} />
        {label}
      </div>
      <p className={`mt-2 text-2xl font-bold ${danger ? "text-red-700" : ""}`}>{value}</p>
      <p className="mt-0.5 text-[11px] text-[color:var(--ink)]/45">{hint}</p>
    </div>
  );
}

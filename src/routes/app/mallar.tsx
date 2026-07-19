import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
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
  booking_created: "Skickas direkt när bokningen skapas",
  pre_arrival: "Relativt incheckningsdagen (t.ex. −2 dagar)",
  checkin_day: "På incheckningsdagen",
  post_stay: "Relativt utcheckningsdagen (t.ex. +1 dag)",
};

function TemplatesPage() {
  const session = useSession();
  const { property } = useProperty(session);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [savedId, setSavedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !property) return;
    const { data } = await supabase
      .from("message_templates")
      .select("*")
      .eq("property_id", property.id)
      .order("trigger_type");
    setTemplates((data as MessageTemplate[]) ?? []);
  }, [property]);

  useEffect(() => {
    load();
  }, [load]);

  const update = async (id: string, patch: Partial<MessageTemplate>) => {
    if (!supabase) return;
    setTemplates((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    await supabase.from("message_templates").update(patch).eq("id", id);
    setSavedId(id);
    setTimeout(() => setSavedId(null), 1200);
  };

  if (!property) return null;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-[Fraunces] text-2xl font-semibold">Meddelandemallar</h1>
      <p className="mt-1 text-[14px] text-[color:var(--ink)]/65">
        Skickas automatiskt till gästen vid rätt tidpunkt. Ändringar gäller nya schemaläggningar.
      </p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {VARIABLES.map((v) => (
          <code
            key={v}
            className="rounded-full bg-[color:var(--forest)]/8 px-2.5 py-1 text-[11px] font-semibold text-[color:var(--forest)]"
          >
            {`{{${v}}}`}
          </code>
        ))}
      </div>

      <div className="mt-6 space-y-4">
        {templates.map((t) => (
          <div
            key={t.id}
            className={`card-surface p-5 transition ${t.enabled ? "" : "opacity-60"}`}
          >
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-[15px] font-bold">{TRIGGER_LABELS[t.trigger_type]}</h2>
                <p className="text-[12px] text-[color:var(--ink)]/55">
                  {TRIGGER_HINTS[t.trigger_type]} ·{" "}
                  {savedId === t.id ? (
                    <span className="font-semibold text-[color:var(--success)]">✓ Sparat</span>
                  ) : (
                    "sparas automatiskt vid ändring"
                  )}
                </p>
              </div>
              <button
                onClick={() => update(t.id, { enabled: !t.enabled })}
                role="switch"
                aria-checked={t.enabled}
                className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                  t.enabled ? "bg-[color:var(--success)]" : "bg-[color:var(--line)]"
                }`}
              >
                <span
                  className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${
                    t.enabled ? "left-6" : "left-1"
                  }`}
                />
              </button>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div>
                <label className="text-[12px] font-medium text-[color:var(--ink)]/55">Kanal</label>
                <select
                  value={t.channel}
                  onChange={(e) =>
                    update(t.id, { channel: e.target.value as MessageTemplate["channel"] })
                  }
                  className="inp mt-1"
                >
                  <option value="email">E-post</option>
                  <option value="sms">Sms</option>
                  <option value="both">Båda</option>
                </select>
              </div>
              <div>
                <label className="text-[12px] font-medium text-[color:var(--ink)]/55">
                  Förskjutning (dagar)
                </label>
                <input
                  type="number"
                  value={t.offset_days}
                  onChange={(e) => update(t.id, { offset_days: Number(e.target.value) })}
                  className="inp mt-1"
                />
              </div>
              <div>
                <label className="text-[12px] font-medium text-[color:var(--ink)]/55">
                  Klockslag
                </label>
                <input
                  type="time"
                  value={t.send_time}
                  onChange={(e) => update(t.id, { send_time: e.target.value })}
                  className="inp mt-1"
                />
              </div>
            </div>

            {t.channel !== "sms" && (
              <div className="mt-3">
                <label className="text-[12px] font-medium text-[color:var(--ink)]/55">Ämne</label>
                <input
                  value={t.subject ?? ""}
                  onChange={(e) => update(t.id, { subject: e.target.value })}
                  className="inp mt-1"
                />
              </div>
            )}
            <div className="mt-3">
              <label className="text-[12px] font-medium text-[color:var(--ink)]/55">
                Meddelande
              </label>
              <textarea
                value={t.body}
                rows={5}
                onChange={(e) => update(t.id, { body: e.target.value })}
                className="inp mt-1 resize-none"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

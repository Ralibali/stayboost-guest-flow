import { createFileRoute } from "@tanstack/react-router";
import { Save } from "lucide-react";
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
  booking_created: "Skickas när betalningen är klar och bokningen bekräftad",
  pre_arrival: "Relativt incheckningsdagen, exempelvis −2 dagar",
  checkin_day: "På incheckningsdagen",
  post_stay: "Relativt utcheckningsdagen, exempelvis +1 dag",
};

function TemplatesPage() {
  const session = useSession();
  const { property } = useProperty(session);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set());
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !property) return;
    setError(null);
    const { data, error } = await supabase
      .from("message_templates")
      .select("*")
      .eq("property_id", property.id)
      .order("trigger_type");
    if (error) {
      setError(`Kunde inte läsa mallarna: ${error.message}`);
      return;
    }
    setTemplates((data as MessageTemplate[]) ?? []);
    setDirtyIds(new Set());
  }, [property]);

  useEffect(() => {
    load();
  }, [load]);

  const edit = (id: string, patch: Partial<MessageTemplate>) => {
    setTemplates((current) =>
      current.map((template) =>
        template.id === id ? { ...template, ...patch } : template,
      ),
    );
    setDirtyIds((current) => new Set(current).add(id));
    setSavedId(null);
  };

  const save = async (template: MessageTemplate) => {
    if (!supabase) return;
    setSavingId(template.id);
    setError(null);
    const { id, property_id, trigger_type, ...patch } = template;
    const { error } = await supabase
      .from("message_templates")
      .update(patch)
      .eq("id", id)
      .eq("property_id", property_id);
    setSavingId(null);
    if (error) {
      setError(`Kunde inte spara ${TRIGGER_LABELS[trigger_type]}: ${error.message}`);
      return;
    }
    setDirtyIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setSavedId(id);
    setTimeout(() => setSavedId((current) => (current === id ? null : current)), 1600);
  };

  if (!property) return null;

  return (
    <div className="mx-auto max-w-3xl">
      <p className="eyebrow">Automationer</p>
      <h1 className="mt-2 font-[Fraunces] text-3xl font-semibold">Meddelandemallar</h1>
      <p className="mt-1 text-[14px] text-[color:var(--ink)]/65">
        Anpassa e-post och SMS. Betalda flöden skickas först när betalningen är bekräftad.
      </p>

      {error && (
        <p className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-[13px] text-red-700">
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-1.5">
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
        {templates.map((template) => {
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
                    {dirty && <span className="font-semibold text-amber-700"> · Osparade ändringar</span>}
                    {savedId === template.id && (
                      <span className="font-semibold text-[color:var(--success)]"> · ✓ Sparat</span>
                    )}
                  </p>
                </div>
                <button
                  onClick={() => edit(template.id, { enabled: !template.enabled })}
                  role="switch"
                  aria-checked={template.enabled}
                  title={template.enabled ? "Aktiv" : "Avstängd"}
                  className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                    template.enabled ? "bg-[color:var(--success)]" : "bg-[color:var(--line)]"
                  }`}
                >
                  <span
                    className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${
                      template.enabled ? "left-6" : "left-1"
                    }`}
                  />
                </button>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <label className="block">
                  <span className="text-[12px] font-medium text-[color:var(--ink)]/55">Kanal</span>
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
                  <span className="text-[12px] font-medium text-[color:var(--ink)]/55">Klockslag</span>
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
                <span className="text-[12px] font-medium text-[color:var(--ink)]/55">Meddelande</span>
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
                  <Save size={15} /> {saving ? "Sparar…" : "Spara mall"}
                </button>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

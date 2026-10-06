import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Clock3, Save, Send, Workflow } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  supabase,
  useProperty,
  useSession,
  TRIGGER_LABELS,
  type MessageTemplate,
} from "@/lib/supabase";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MESSAGE_LANGUAGES,
  previewMessageTemplate,
  type MessageLanguage,
} from "../../../supabase/functions/_shared/message-content";

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
  manual: "Sparas som mall utan automatiska utskick",
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

const LANGUAGE_LABELS: Record<MessageLanguage, string> = {
  sv: "Svenska",
  en: "Engelska",
  de: "Tyska",
  da: "Danska",
  no: "Norska",
};

// Kept here with the editor so its tested save contract cannot drift from the form.
// eslint-disable-next-line react-refresh/only-export-components
export function messageDraftPatch(
  template: MessageTemplate,
  patch: Partial<MessageTemplate>,
): MessageTemplate {
  const next = { ...template, ...patch };
  if (
    next.trigger_type === "manual" ||
    (template.source_archive_id && Object.keys(patch).some((key) => key !== "enabled"))
  ) {
    next.enabled = false;
  }
  return next;
}

// eslint-disable-next-line react-refresh/only-export-components
export function editMessageLanguage(
  template: MessageTemplate,
  lang: MessageLanguage,
  patch: Partial<{ subject: string; body: string }>,
): MessageTemplate {
  const translations = template.content_translations ?? {};
  if (lang === "sv" && !Object.hasOwn(translations, "sv"))
    return messageDraftPatch(template, patch);
  const current = translations[lang] ?? { subject: "", body: "" };
  const translated = { ...current, ...patch };
  return messageDraftPatch(template, {
    content_translations: { ...translations, [lang]: translated },
    ...(lang === "sv" ? translated : {}),
  });
}

// eslint-disable-next-line react-refresh/only-export-components
export async function saveMessageDraft(
  client: Pick<SupabaseClient, "rpc">,
  propertyId: string,
  template: MessageTemplate,
): Promise<MessageTemplate> {
  if (
    template.property_id !== propertyId ||
    !Number.isInteger(template.revision) ||
    template.revision < 1
  ) {
    throw new Error("message_template_changed");
  }
  const {
    name,
    subject,
    body,
    content_translations,
    body_format,
    trigger_type,
    offset_days,
    send_time,
    channel,
    enabled,
  } = template;
  const { data, error } = await client.rpc("save_message_template", {
    p_property: propertyId,
    p_template: template.id,
    p_revision: template.revision,
    p_data: {
      name,
      subject,
      body,
      content_translations,
      body_format,
      trigger_type,
      offset_days,
      send_time,
      channel,
      enabled,
    },
  });
  if (error) throw error;
  const saved = data as MessageTemplate | null;
  if (
    !saved ||
    saved.id !== template.id ||
    saved.property_id !== propertyId ||
    !Number.isInteger(saved.revision) ||
    saved.revision <= template.revision
  ) {
    throw new Error("message_save_unconfirmed");
  }
  return saved;
}

function errorText(value: unknown): string {
  const message =
    value && typeof value === "object" && "message" in value ? String(value.message) : "";
  if (message.includes("message_template_changed"))
    return "Mallen har ändrats i en annan vy. Ditt utkast finns kvar. Kopiera ändringarna innan du läser in den senaste versionen.";
  if (message.includes("message_source") || message.includes("message_template_source_activation"))
    return "Källmallen måste granskas före aktivering. Dina ändringar finns kvar.";
  if (message.includes("message_save_unconfirmed"))
    return "Sparandet kunde inte bekräftas. Ditt utkast finns kvar; läs in aktuell version innan du försöker igen.";
  return "Mallen kunde inte sparas. Kontrollera innehåll och anslutning. Ditt utkast finns kvar.";
}

function sourceField(template: MessageTemplate, key: string): string {
  const field = template.source_metadata?.[key];
  if (!field || typeof field !== "object") return "Ej angivet";
  const value = field as Record<string, unknown>;
  if (value.hidden_in_saved_dom === true) return "Dolt i källformuläret; styr inte planeringen";
  if (typeof value.checked_attribute === "boolean") return value.checked_attribute ? "Ja" : "Nej";
  return typeof value.label_display_normalized === "string"
    ? value.label_display_normalized
    : typeof value.value_exact === "string"
      ? value.value_exact
      : "Ej angivet";
}

function TemplatesPage() {
  const session = useSession();
  const { property } = useProperty(session);
  if (!session || !property || property.owner_id !== session.user.id) return null;
  return <TemplateWorkspace key={`${session.user.id}:${property.id}`} propertyId={property.id} />;
}

function TemplateWorkspace({ propertyId }: { propertyId: string }) {
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set());
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(false);
  const request = useRef(0);
  const saveInFlight = useRef(false);

  const load = useCallback(async () => {
    if (!supabase || saveInFlight.current) return;
    const generation = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const [templatesResult, queueResult] = await Promise.all([
        supabase
          .from("message_templates")
          .select("*")
          .eq("property_id", propertyId)
          .order("trigger_type"),
        supabase
          .from("scheduled_messages")
          .select(
            "id,status,send_at,sent_at,channel,template:message_templates(trigger_type),booking:bookings!inner(property_id)",
          )
          .eq("booking.property_id", propertyId)
          .order("send_at", { ascending: false })
          .limit(500),
      ]);
      if (!alive.current || request.current !== generation) return;
      if (templatesResult.error || queueResult.error) {
        setError("Kunde inte läsa mallarna och gästresan. Försök igen.");
        return;
      }
      setTemplates((templatesResult.data as MessageTemplate[]) ?? []);
      setQueue((queueResult.data as unknown as QueueRow[]) ?? []);
      setDirtyIds(new Set());
      setSavedId(null);
    } catch {
      if (alive.current && request.current === generation)
        setError("Kunde inte läsa mallarna. Kontrollera anslutningen och försök igen.");
    } finally {
      if (alive.current && request.current === generation) setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
      request.current += 1;
    };
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
    if (loading || savingId === id) return;
    setTemplates((current) =>
      current.map((template) =>
        template.id === id ? messageDraftPatch(template, patch) : template,
      ),
    );
    setDirtyIds((current) => new Set(current).add(id));
    setSavedId(null);
  };

  const save = async (template: MessageTemplate) => {
    if (!supabase || saveInFlight.current || loading) return;
    saveInFlight.current = true;
    setSavingId(template.id);
    setError(null);
    try {
      const saved = await saveMessageDraft(supabase, propertyId, template);
      if (!alive.current) return;
      // Update only this draft. Other cards may have unsaved changes.
      setTemplates((current) => current.map((item) => (item.id === saved.id ? saved : item)));
      setDirtyIds((current) => {
        const next = new Set(current);
        next.delete(saved.id);
        return next;
      });
      setSavedId(saved.id);
    } catch (cause) {
      if (alive.current) setError(errorText(cause));
    } finally {
      saveInFlight.current = false;
      if (alive.current) setSavingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <p className="eyebrow">Gästresa · Automationer</p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-[Fraunces] text-3xl font-semibold">Automatiserad gästresa</h1>
          <p className="mt-1 max-w-2xl text-[14px] text-[color:var(--ink)]/65">
            Redigera innehåll och planering för gästernas meddelanden. Förhandsvisningen använder
            exempeluppgifter och skickar ingenting.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading || dirtyIds.size > 0 || savingId !== null}
          title={dirtyIds.size ? "Spara eller återställ utkasten först" : undefined}
          className="btn-secondary !rounded-xl !px-3 !py-2 text-[12px]"
        >
          <Workflow size={14} /> Uppdatera status
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-[13px] text-red-700">
          {error}
        </p>
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
            const active = templates.some((item) => item.trigger_type === trigger && item.enabled);
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
                    className={`h-2.5 w-2.5 rounded-full ${active ? "bg-[color:var(--success)]" : "bg-[color:var(--line)]"}`}
                    title={active ? "Aktiv" : "Avstängd"}
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

      <p className="mt-2 text-[12px] text-[color:var(--ink)]/60">
        %bookinginfo% infogar bokningsuppgifter i e-post. Okända koder visas som granskningsfel.
        Tider räknas i Europe/Stockholm, även vid sommar- och vintertid.
      </p>
      {loading && (
        <p role="status" className="mt-5">
          Läser mallar…
        </p>
      )}
      <div className="mt-6 space-y-4">
        {templates
          .slice()
          .sort(
            (a, b) =>
              [...JOURNEY_ORDER, "manual"].indexOf(a.trigger_type) -
              [...JOURNEY_ORDER, "manual"].indexOf(b.trigger_type),
          )
          .map((template) => (
            <MessageTemplateEditor
              key={template.id}
              template={template}
              dirty={dirtyIds.has(template.id)}
              saving={savingId === template.id}
              busy={loading || savingId !== null}
              saved={savedId === template.id}
              onEdit={(patch) => edit(template.id, patch)}
              onSave={() => void save(template)}
              onReload={() => {
                if (
                  window.confirm(
                    "Läsa in aktuella mallar? Alla osparade ändringar på sidan försvinner.",
                  )
                )
                  void load();
              }}
            />
          ))}
      </div>
    </div>
  );
}

export function MessageTemplateEditor({
  template,
  dirty,
  saving,
  busy,
  saved,
  onEdit,
  onSave,
  onReload,
}: {
  template: MessageTemplate;
  dirty: boolean;
  saving: boolean;
  busy: boolean;
  saved: boolean;
  onEdit: (patch: Partial<MessageTemplate>) => void;
  onSave: () => void;
  onReload: () => void;
}) {
  const [lang, setLang] = useState<MessageLanguage>("sv");
  const translations = template.content_translations ?? {};
  const current =
    translations[lang] ??
    (lang === "sv" ? { subject: template.subject ?? "", body: template.body } : null);
  const source = Boolean(template.source_archive_id);
  const manual = template.trigger_type === "manual";
  const dateRelative = !manual && template.trigger_type !== "booking_created";
  const reviewedAt = Date.parse(template.source_reviewed_at ?? "");
  const activationStartsAt = Date.parse(template.activation_starts_at ?? "");
  const sourceCanEnable =
    template.source_metadata?.import_mapping_supported === true &&
    Number.isFinite(reviewedAt) &&
    Number.isFinite(activationStartsAt) &&
    activationStartsAt >= reviewedAt &&
    !dirty;
  const translate = (patch: Partial<{ subject: string; body: string }>) => {
    const next = editMessageLanguage(template, lang, patch);
    onEdit({
      subject: next.subject,
      body: next.body,
      content_translations: next.content_translations,
    });
  };
  const format = template.body_format ?? "text";
  return (
    <section className="card-surface p-5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-bold">
            {template.name || TRIGGER_LABELS[template.trigger_type]}
          </h2>
          <p className="text-[12px] text-[color:var(--ink)]/65">
            {TRIGGER_HINTS[template.trigger_type]}
          </p>
          {dirty && <p className="text-[12px] font-semibold text-amber-700">Osparade ändringar</p>}
          {saved && (
            <p role="status" className="text-[12px] text-[color:var(--success)]">
              Sparat
            </p>
          )}
        </div>
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            role="switch"
            aria-label={`Automatik för ${template.name || TRIGGER_LABELS[template.trigger_type]}`}
            checked={template.enabled}
            disabled={busy || manual || (source && !template.enabled && !sourceCanEnable)}
            onChange={(event) => onEdit({ enabled: event.target.checked })}
          />
          {template.enabled ? "Aktiv" : "Avstängd"}
        </label>
      </div>
      {source && (
        <div className="mt-3 rounded-xl bg-amber-50 p-3 text-[12px] text-amber-950">
          <p className="font-semibold">Källa: Sirvoy · mall {template.source_template_id}</p>
          <p>
            {dirty
              ? "Ändringar i innehåll eller planering kräver ny granskning och stänger av mallen när du sparar."
              : template.source_reviewed_at
                ? "Källmallen är granskad. Aktivering gäller först från den fastställda övergången."
                : "Importerad som avstängt utkast. Innehåll och planering måste granskas före aktivering."}
          </p>
          {template.activation_starts_at && (
            <p>
              Övergång:{" "}
              {new Date(template.activation_starts_at).toLocaleString("sv-SE", {
                timeZone: "Europe/Stockholm",
              })}{" "}
              (Europe/Stockholm)
            </p>
          )}
          <p>
            Originalet finns kvar i källarkivet. Språkfältens innehåll är bevarat och behöver
            bedömas var för sig.
          </p>
          <details className="mt-2">
            <summary className="cursor-pointer font-semibold">Källans inställningar</summary>
            <dl className="mt-2 space-y-1">
              {(
                [
                  ["Händelse", "event"],
                  ["Dagar", "days"],
                  ["Före/efter", "timing"],
                  ["Kategori", "category"],
                  ["Sidfot", "use-footer"],
                ] as const
              ).map(([label, key]) => (
                <div key={key}>
                  <dt className="inline font-semibold">{label}: </dt>
                  <dd className="inline">{sourceField(template, key)}</dd>
                </div>
              ))}
            </dl>
            {template.source_metadata?.import_mapping_supported === false && (
              <p className="mt-2 font-semibold">
                Källans automatik kräver kompletterande stöd eller granskad anpassning.
              </p>
            )}
            <p className="mt-2">
              {template.source_schedule_archive_id
                ? "Källunderlag för sändningstid finns kopplat."
                : "Inget separat källunderlag för sändningstid är kopplat."}
            </p>
          </details>
        </div>
      )}
      <fieldset disabled={busy} className="mt-4 space-y-3 disabled:opacity-70">
        <label className="block text-[12px] font-medium">
          Mallnamn
          <input
            className="inp mt-1"
            maxLength={500}
            value={template.name ?? ""}
            onChange={(e) => onEdit({ name: e.target.value })}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-[12px] font-medium">
            Händelse
            <select
              className="inp mt-1"
              value={template.trigger_type}
              onChange={(e) =>
                onEdit({ trigger_type: e.target.value as MessageTemplate["trigger_type"] })
              }
            >
              {Object.entries(TRIGGER_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-[12px] font-medium">
            Kanal
            <select
              className="inp mt-1"
              value={template.channel}
              onChange={(e) => onEdit({ channel: e.target.value as MessageTemplate["channel"] })}
            >
              <option value="email">E-post</option>
              <option value="sms" disabled={format === "html"}>
                SMS
              </option>
              <option value="both" disabled={format === "html"}>
                Båda
              </option>
            </select>
          </label>
          <label className="block text-[12px] font-medium">
            Innehållsformat
            <select
              className="inp mt-1"
              value={format}
              onChange={(e) =>
                onEdit({ body_format: e.target.value as MessageTemplate["body_format"] })
              }
            >
              <option value="text">Text</option>
              <option value="html" disabled={template.channel !== "email"}>
                Formaterad e-post (HTML)
              </option>
            </select>
          </label>
        </div>
        {dateRelative ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-[12px] font-medium">
              Dagar från {template.trigger_type === "post_stay" ? "utcheckning" : "incheckning"}
              <input
                className="inp mt-1"
                type="number"
                step={1}
                value={template.offset_days}
                onChange={(e) => onEdit({ offset_days: Number(e.target.value) })}
              />
              <span className="mt-1 block font-normal">
                Minus = före, plus = efter. Hela kalenderdagar.
              </span>
            </label>
            <label className="block text-[12px] font-medium">
              Lokal tid (Europe/Stockholm)
              <input
                className="inp mt-1"
                type="time"
                step={1}
                value={template.send_time}
                onChange={(e) => onEdit({ send_time: e.target.value })}
              />
            </label>
          </div>
        ) : (
          <p className="text-[12px] text-[color:var(--ink)]/65">
            {manual
              ? "Manuell mall: ingen automatisk kö eller sändning skapas."
              : "Bekräftelsen gäller när bokningen är bekräftad och betalningsläget tillåter utskick. Inget separat klockslag används."}
          </p>
        )}
        <div className="flex flex-wrap gap-1.5" aria-label="Meddelandets språk">
          {MESSAGE_LANGUAGES.map((language) => (
            <button
              key={language}
              type="button"
              aria-pressed={lang === language}
              onClick={() => setLang(language)}
              className={`rounded-lg border px-3 py-2 text-[12px] ${lang === language ? "bg-[color:var(--forest)] text-white" : "border-[color:var(--line)]"}`}
            >
              {LANGUAGE_LABELS[language]}
            </button>
          ))}
        </div>
        {current ? (
          <>
            {template.channel !== "sms" && (
              <label className="block text-[12px] font-medium">
                Ämne · {LANGUAGE_LABELS[lang]}
                <input
                  className="inp mt-1"
                  maxLength={1000}
                  value={current.subject}
                  onChange={(e) => translate({ subject: e.target.value })}
                />
              </label>
            )}
            <label className="block text-[12px] font-medium">
              {format === "html" ? "HTML-innehåll" : "Meddelande"} · {LANGUAGE_LABELS[lang]}
              <textarea
                className="inp mt-1 min-h-48 resize-y font-mono text-[13px]"
                rows={8}
                maxLength={100000}
                value={current.body}
                onChange={(e) => translate({ body: e.target.value })}
              />
            </label>
            {!source && !translations[lang] && (
              <p className="text-[12px] text-[color:var(--ink)]/65">
                Befintlig standardtext används när gästens språk saknar egen text.
              </p>
            )}
          </>
        ) : (
          <div className="rounded-xl border border-[color:var(--line)] p-3 text-[13px]">
            <p>
              Ingen egen text på {LANGUAGE_LABELS[lang].toLowerCase()}.{" "}
              {source
                ? "Källmallen kan inte skickas på ett språk som saknar text."
                : "Befintlig standardtext används tills du lägger till en översättning."}
            </p>
            <button
              type="button"
              className="btn-secondary mt-2 !px-3 !py-2"
              onClick={() =>
                onEdit({
                  content_translations: { ...translations, [lang]: { subject: "", body: "" } },
                })
              }
            >
              Lägg till {LANGUAGE_LABELS[lang].toLowerCase()}
            </button>
          </div>
        )}
      </fieldset>
      <MessagePreview template={template} language={lang} />
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {dirty && (
          <button
            type="button"
            onClick={onReload}
            disabled={busy}
            className="btn-secondary !px-3 !py-2 text-[13px]"
          >
            Läs in sparade mallar
          </button>
        )}
        <button
          type="button"
          onClick={onSave}
          disabled={
            !dirty ||
            busy ||
            !template.body.trim() ||
            Object.values(translations).some((entry) => !entry?.body.trim())
          }
          className="btn-primary !rounded-xl !px-4 !py-2.5 text-[13px] disabled:opacity-35"
        >
          <Save size={15} />
          {saving ? "Sparar…" : "Spara ändringar"}
        </button>
      </div>
    </section>
  );
}

export function MessagePreview({
  template,
  language,
}: {
  template: MessageTemplate;
  language: MessageLanguage;
}) {
  const result = useMemo(() => {
    try {
      return { content: previewMessageTemplate(template, language), error: false };
    } catch {
      return { content: null, error: true };
    }
  }, [template, language]);
  return (
    <details className="mt-4 rounded-xl border border-[color:var(--line)] p-3">
      <summary className="cursor-pointer text-[13px] font-semibold">
        Säker förhandsvisning · {LANGUAGE_LABELS[language]}
      </summary>
      <p className="mt-2 text-[12px] text-[color:var(--ink)]/60">
        Endast exempeluppgifter. Inget meddelande skickas.
      </p>
      {result.error ? (
        <p role="alert" className="mt-2 text-[13px] text-amber-800">
          Förhandsvisningen kunde inte skapas. Granska språktext, meddelandekoder, länkar och
          HTML-format innan mallen aktiveras.
        </p>
      ) : (
        result.content && (
          <>
            <p className="mt-3 whitespace-pre-wrap font-semibold">{result.content.subject}</p>
            {result.content.html !== undefined ? (
              <iframe
                title={`Förhandsvisning på ${LANGUAGE_LABELS[language].toLowerCase()}`}
                sandbox=""
                referrerPolicy="no-referrer"
                className="mt-2 min-h-64 w-full border-0 bg-white"
                srcDoc={`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"></head><body>${result.content.html}</body></html>`}
              />
            ) : (
              <p className="mt-2 whitespace-pre-wrap text-[13px]">{result.content.text}</p>
            )}
            {result.content.html !== undefined && (
              <details className="mt-2 text-[12px]">
                <summary>Textversion</summary>
                <p className="mt-2 whitespace-pre-wrap">{result.content.text}</p>
              </details>
            )}
          </>
        )
      )}
    </details>
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

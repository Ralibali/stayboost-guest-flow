import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Clock3, PhoneCall, Save, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useProperty, useSession } from "@/lib/supabase";

export const Route = createFileRoute("/app/telefon")({
  component: VoicePilotPage,
});

type IntentKey = "faq" | "arrival" | "addons" | "booking";

type VoicePilotConfig = {
  enabled: boolean;
  afterHoursOnly: boolean;
  greeting: string;
  handoffPhone: string;
  languages: string[];
  intents: Record<IntentKey, boolean>;
  knowledge: string;
};

const intentLabels: Record<IntentKey, { title: string; description: string }> = {
  faq: {
    title: "Vanliga frågor",
    description: "Öppettider, vägbeskrivning, regler och praktisk information.",
  },
  arrival: {
    title: "Ankomst & vistelse",
    description: "Incheckning, utcheckning, hitta hit och frågor under vistelsen.",
  },
  addons: {
    title: "Frukost & tillval",
    description: "Informera om befintliga tillval och samla ett önskemål för personalen.",
  },
  booking: {
    title: "Bokningsunderlag",
    description: "Samla namn, datum, antal gäster och kontaktväg. Ingen direktbokning ännu.",
  },
};

const defaults = (propertyName: string, phone: string | null): VoicePilotConfig => ({
  enabled: false,
  afterHoursOnly: true,
  greeting: `Hej! Du har kommit till ${propertyName}. Jag är vår digitala assistent och kan hjälpa med vanliga frågor eller ta ett meddelande till personalen.`,
  handoffPhone: phone ?? "",
  languages: ["sv"],
  intents: { faq: true, arrival: true, addons: true, booking: true },
  knowledge: "",
});

function VoicePilotPage() {
  const session = useSession();
  const { property } = useProperty(session);
  const [config, setConfig] = useState<VoicePilotConfig | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!property) return;
    const key = `stayboost:voice-pilot:${property.id}`;
    try {
      const stored = window.localStorage.getItem(key);
      setConfig(
        stored
          ? { ...defaults(property.name, property.contact_phone), ...JSON.parse(stored) }
          : defaults(property.name, property.contact_phone),
      );
    } catch {
      setConfig(defaults(property.name, property.contact_phone));
    }
  }, [property]);

  const readiness = useMemo(() => {
    if (!config) return [];
    return [
      { label: "Hälsningsfras", ok: config.greeting.trim().length >= 20 },
      { label: "Överlämningsnummer", ok: config.handoffPhone.trim().length >= 7 },
      { label: "Minst ett ärendeflöde", ok: Object.values(config.intents).some(Boolean) },
      { label: "Kunskapsunderlag", ok: config.knowledge.trim().length >= 40 },
    ];
  }, [config]);

  const readyCount = readiness.filter((item) => item.ok).length;
  const pilotReady = readiness.length > 0 && readyCount === readiness.length;

  if (!property || !config) return null;

  const save = () => {
    window.localStorage.setItem(`stayboost:voice-pilot:${property.id}`, JSON.stringify(config));
    setSavedAt(new Date().toISOString());
  };

  const toggleLanguage = (language: string) => {
    setConfig((current) => {
      if (!current) return current;
      const exists = current.languages.includes(language);
      const next = exists
        ? current.languages.filter((item) => item !== language)
        : [...current.languages, language];
      return { ...current, languages: next.length ? next : ["sv"] };
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#2d684c]">
            <PhoneCall size={13} /> StayBoost Voice · pilot
          </div>
          <h1 className="mt-2 font-[Fraunces] text-[34px] font-semibold leading-tight">
            Telefonagent
          </h1>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-[color:var(--ink)]/55">
            Förbered exakt vad en framtida telefonagent får svara på och när den ska lämna över.
            Sidan aktiverar inte telefoni och ringer ingen kund.
          </p>
        </div>
        <button
          type="button"
          onClick={save}
          className="inline-flex items-center gap-2 self-start rounded-xl bg-[#173c2b] px-4 py-2.5 text-[11px] font-bold text-white transition hover:bg-[#214e39]"
        >
          <Save size={14} /> Spara pilotunderlag
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {readiness.map((item) => (
          <div
            key={item.label}
            className={`rounded-2xl border px-4 py-4 ${item.ok ? "border-[#2d684c]/20 bg-[#edf6f1]" : "border-black/[0.07] bg-white"}`}
          >
            <div className="flex items-center gap-2">
              <CheckCircle2
                size={15}
                className={item.ok ? "text-[#2d684c]" : "text-[color:var(--ink)]/25"}
              />
              <p className="text-[11px] font-bold">{item.label}</p>
            </div>
            <p className="mt-2 text-[11px] text-[color:var(--ink)]/45">
              {item.ok ? "Klart" : "Behöver fyllas i"}
            </p>
          </div>
        ))}
      </div>

      <section className="rounded-[24px] border border-black/[0.07] bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--ink)]/40">
              Pilotstatus
            </p>
            <h2 className="mt-1 font-[Fraunces] text-xl font-semibold">
              {pilotReady
                ? "Redo för provider-test"
                : `${readyCount}/${readiness.length} delar klara`}
            </h2>
          </div>
          <label className="flex items-center gap-2 text-[12px] font-semibold">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(event) =>
                setConfig((current) => current && { ...current, enabled: event.target.checked })
              }
            />
            Markera pilot som aktiv internt
          </label>
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-[color:var(--ink)]/50">
          “Aktiv” betyder bara att pilotkonfigurationen är vald. Ingen telefontjänst, röstmodell
          eller webhook är ansluten förrän en provider uttryckligen konfigurerats och testats.
        </p>
        {savedAt ? (
          <p className="mt-2 text-[11px] font-semibold text-[#2d684c]">
            Sparat{" "}
            {new Date(savedAt).toLocaleTimeString("sv-SE", {
              hour: "2-digit",
              minute: "2-digit",
            })}{" "}
            i den här webbläsaren.
          </p>
        ) : null}
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-[24px] border border-black/[0.07] bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-center gap-2">
            <ShieldCheck size={17} className="text-[#2d684c]" />
            <h2 className="font-[Fraunces] text-xl font-semibold">Samtalsregler</h2>
          </div>

          <div className="mt-5 space-y-5">
            <label className="block">
              <span className="text-[11px] font-bold uppercase tracking-wide text-[color:var(--ink)]/45">
                Hälsning
              </span>
              <textarea
                value={config.greeting}
                onChange={(event) =>
                  setConfig((current) => current && { ...current, greeting: event.target.value })
                }
                rows={4}
                className="inp mt-1.5 w-full"
              />
            </label>

            <label className="block">
              <span className="text-[11px] font-bold uppercase tracking-wide text-[color:var(--ink)]/45">
                Överlämningsnummer
              </span>
              <input
                value={config.handoffPhone}
                onChange={(event) =>
                  setConfig(
                    (current) => current && { ...current, handoffPhone: event.target.value },
                  )
                }
                className="inp mt-1.5 w-full"
                placeholder="+46…"
              />
            </label>

            <label className="flex items-center gap-2 text-[12px] font-semibold">
              <input
                type="checkbox"
                checked={config.afterHoursOnly}
                onChange={(event) =>
                  setConfig(
                    (current) => current && { ...current, afterHoursOnly: event.target.checked },
                  )
                }
              />
              Börja med samtal utanför ordinarie öppettid
            </label>

            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-[color:var(--ink)]/45">
                Språk
              </p>
              <div className="mt-2 flex gap-2">
                {[
                  ["sv", "Svenska"],
                  ["en", "Engelska"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => toggleLanguage(value)}
                    className={`rounded-full border px-3 py-1.5 text-[11px] font-bold ${config.languages.includes(value) ? "border-[#2d684c] bg-[#edf6f1] text-[#2d684c]" : "border-black/10 text-[color:var(--ink)]/50"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[24px] border border-black/[0.07] bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-center gap-2">
            <Clock3 size={17} className="text-[#2d684c]" />
            <h2 className="font-[Fraunces] text-xl font-semibold">Tillåtna ärenden</h2>
          </div>
          <div className="mt-5 space-y-3">
            {(Object.keys(intentLabels) as IntentKey[]).map((key) => {
              const item = intentLabels[key];
              return (
                <label
                  key={key}
                  className="flex cursor-pointer gap-3 rounded-2xl border border-black/[0.07] p-4"
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={config.intents[key]}
                    onChange={(event) =>
                      setConfig(
                        (current) =>
                          current && {
                            ...current,
                            intents: { ...current.intents, [key]: event.target.checked },
                          },
                      )
                    }
                  />
                  <span>
                    <span className="block text-[13px] font-bold">{item.title}</span>
                    <span className="mt-1 block text-[11px] leading-relaxed text-[color:var(--ink)]/50">
                      {item.description}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </section>
      </div>

      <section className="rounded-[24px] border border-black/[0.07] bg-white p-5 shadow-sm sm:p-6">
        <h2 className="font-[Fraunces] text-xl font-semibold">Kunskapsunderlag</h2>
        <p className="mt-1 text-[12px] text-[color:var(--ink)]/50">
          Skriv bara sådant som agenten ska få behandla som verifierad information. Exempel: priser,
          check-in, parkering, frukost, husdjursregler och när personal måste ta över.
        </p>
        <textarea
          value={config.knowledge}
          onChange={(event) =>
            setConfig((current) => current && { ...current, knowledge: event.target.value })
          }
          rows={9}
          className="inp mt-4 w-full"
          placeholder="Exempel: Incheckning från 15:00. Vid akuta problem ska samtalet alltid lämnas över till personal…"
        />
      </section>

      <section className="rounded-[24px] border border-[#2d684c]/15 bg-[#edf6f1] p-5 sm:p-6">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#2d684c]">
          Första provider-testet
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-[color:var(--ink)]/65">
          När underlaget är komplett kopplas telefoni som ett separat steg. Första testet bör vara
          inkommande samtal utanför öppettid, med tydlig AI-presentation, transkript/sammanfattning
          och mänsklig överlämning. Direktbokning ska vara avstängd tills bokningsintegrationen är
          verifierad.
        </p>
      </section>
    </div>
  );
}

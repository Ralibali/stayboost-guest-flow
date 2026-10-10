import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase, type Property } from "@/lib/supabase";
import {
  propertyGuestInfoSnapshot,
  savePropertyGuestInfoDraft,
  type PropertyGuestInfoSnapshot,
} from "@/lib/property-guest-info-save";
import {
  isGuestInfoTranslations,
  localizedPropertyGuestInfo,
  type GuestInfoText,
} from "../../../supabase/functions/_shared/property-guest-info";
import {
  CONTENT_LANGUAGES,
  type ContentLanguage,
} from "../../../supabase/functions/_shared/unit-content";

const languageNames: Record<ContentLanguage, string> = {
  sv: "Svenska",
  en: "Engelska",
  de: "Tyska",
  da: "Danska",
  no: "Norska",
};
const fields = [
  { key: "directions", label: "Hitta hit och ankomst" },
  { key: "house_rules", label: "Husregler" },
] as const;

export function PropertyGuestInfoEditor({
  property,
  onSaved,
}: {
  property: Property;
  onSaved: (snapshot: PropertyGuestInfoSnapshot) => void;
}) {
  return (
    <GuestInfoEditor
      key={`${property.owner_id}:${property.id}`}
      property={property}
      onSaved={onSaved}
    />
  );
}

function GuestInfoEditor({
  property,
  onSaved,
}: {
  property: Property;
  onSaved: (snapshot: PropertyGuestInfoSnapshot) => void;
}) {
  const [draft, setDraft] = useState(() => propertyGuestInfoSnapshot(property));
  const [language, setLanguage] = useState<ContentLanguage>("sv");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const original = useRef(propertyGuestInfoSnapshot(property));
  const dirtyRef = useRef(false);
  const inFlight = useRef(false);
  const alive = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const incoming = propertyGuestInfoSnapshot(property);
    if (
      !dirtyRef.current &&
      !inFlight.current &&
      JSON.stringify(incoming) !== JSON.stringify(original.current)
    ) {
      original.current = incoming;
      setDraft(incoming);
      setError(null);
      setSaved(false);
    }
  }, [property]);

  const change = (field: keyof GuestInfoText, value: string | null) => {
    setDraft((previous) => {
      const entry = {
        directions: language === "sv" ? previous.directions : null,
        house_rules: language === "sv" ? previous.house_rules : null,
        ...previous.guest_info_translations[language],
        [field]: value,
      };
      return {
        ...previous,
        ...(language === "sv" ? entry : {}),
        guest_info_translations: { ...previous.guest_info_translations, [language]: entry },
      };
    });
    dirtyRef.current = true;
    setDirty(true);
    setSaved(false);
    setError(null);
  };
  const fallback = localizedPropertyGuestInfo(
    { ...draft, guestInfoTranslations: draft.guest_info_translations },
    "sv",
  );
  const save = async () => {
    if (!supabase || inFlight.current || !dirtyRef.current) return;
    if (!isGuestInfoTranslations(draft.guest_info_translations)) {
      setError(
        "Kontrollera språktexterna. Texten är för lång eller innehåller otillåtna tecken; inget har kortats.",
      );
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const ok = await savePropertyGuestInfoDraft(supabase, property.id, original.current, draft);
      if (!alive.current) return;
      if (!ok) {
        setError(
          "Gästinformationen har ändrats i ett annat fönster. Ditt utkast finns kvar; kopiera det innan du laddar om sidan.",
        );
        return;
      }
      original.current = draft;
      dirtyRef.current = false;
      setDirty(false);
      setSaved(true);
      onSaved(structuredClone(draft));
    } catch {
      if (alive.current)
        setError("Gästinformationen kunde inte sparas. Ditt utkast finns kvar. Försök igen.");
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  };

  return (
    <section className="card-surface mt-6 space-y-4 p-6" aria-label="Gästinformation på fem språk">
      <div>
        <h2 className="text-[16px] font-bold">Gästinformation på fem språk</h2>
        <p className="mt-1 text-sm text-ink/65">
          Allmän information om ankomst och regler visas på gästsidan. Skriv inte koder eller
          Wi-Fi-lösenord här. Ändringarna visas när du sparar gästinformationen.
        </p>
      </div>
      <div className="flex flex-wrap gap-2" aria-label="Gästinformationens språk">
        {CONTENT_LANGUAGES.map((lang) => (
          <button
            key={lang}
            type="button"
            disabled={busy}
            aria-pressed={language === lang}
            onClick={() => setLanguage(lang)}
            className={`min-h-11 rounded-full border px-3 py-2 text-sm disabled:opacity-50 ${language === lang ? "bg-forest text-white" : "bg-card"}`}
          >
            {languageNames[lang]}
          </button>
        ))}
      </div>
      {fields.map(({ key, label }) => {
        const raw = draft.guest_info_translations[language]?.[key];
        const inherits = language !== "sv" && raw == null;
        const value =
          language === "sv" ? (raw ?? draft[key] ?? "") : inherits ? (fallback[key] ?? "") : raw;
        return (
          <div key={key}>
            <label className="block text-sm font-semibold">
              {label} · {languageNames[language]}
              <textarea
                className="inp mt-2 min-h-32 resize-y disabled:opacity-60"
                rows={6}
                value={value ?? ""}
                disabled={busy || inherits}
                onChange={(event) => change(key, event.target.value)}
              />
            </label>
            {language !== "sv" && (
              <label className="mt-2 flex items-center gap-2 text-xs text-ink/65">
                <input
                  type="checkbox"
                  checked={inherits}
                  disabled={busy}
                  onChange={(event) =>
                    change(key, event.target.checked ? null : (fallback[key] ?? ""))
                  }
                />
                Använd svensk text för {label.toLowerCase()}
              </label>
            )}
          </div>
        );
      })}
      <p className="text-xs text-ink/60">
        Varje språk sparas i sin helhet. Ett tomt eget textfält visas inte för gästen.
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? "Sparar gästinformation…" : "Spara gästinformation"}
        </Button>
        <span role="status" aria-live="polite" className="text-sm text-forest">
          {saved ? "Gästinformationen är sparad." : dirty ? "Osparade ändringar" : ""}
        </span>
      </div>
    </section>
  );
}

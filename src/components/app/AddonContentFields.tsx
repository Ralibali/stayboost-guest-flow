import { useState } from "react";
import {
  CONTENT_LANGUAGES,
  type ContentLanguage,
} from "../../../supabase/functions/_shared/unit-content";
import type { AddonTranslations, VatRate } from "../../../supabase/functions/_shared/addon-content";

const languageNames: Record<ContentLanguage, string> = {
  sv: "Svenska",
  en: "Engelska",
  de: "Tyska",
  da: "Danska",
  no: "Norska",
};

export function AddonContentFields({
  translations,
  vatRate,
  onTranslations,
  onVatRate,
}: {
  translations: AddonTranslations;
  vatRate: VatRate | null;
  onTranslations: (value: AddonTranslations) => void;
  onVatRate: (value: VatRate | null) => void;
}) {
  const [language, setLanguage] = useState<ContentLanguage>("sv");
  const current = translations[language];
  const patch = (field: "name" | "description", value: string) =>
    onTranslations({
      ...translations,
      [language]: { name: "", description: null, ...current, [field]: value },
    });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" aria-label="Textens språk">
        {CONTENT_LANGUAGES.map((lang) => (
          <button
            key={lang}
            type="button"
            aria-pressed={language === lang}
            onClick={() => setLanguage(lang)}
            className={`rounded-full border px-3 py-1.5 text-[12px] ${language === lang ? "bg-[color:var(--forest)] text-white" : "bg-white"}`}
          >
            {languageNames[lang]}
            {translations[lang] ? " ✓" : ""}
          </button>
        ))}
      </div>
      <label className="block text-sm">
        Namn · {languageNames[language]}
        <input
          className="inp mt-1"
          value={current?.name ?? ""}
          onChange={(event) => patch("name", event.target.value)}
        />
      </label>
      <label className="block text-sm">
        Fullständig beskrivning · {languageNames[language]}
        <textarea
          className="inp mt-1 resize-y"
          rows={6}
          value={current?.description ?? ""}
          onChange={(event) => patch("description", event.target.value)}
        />
      </label>
      {language !== "sv" && current && (
        <button
          type="button"
          className="text-xs text-red-700 underline"
          onClick={() => {
            const next = { ...translations };
            delete next[language];
            onTranslations(next);
          }}
        >
          Ta bort denna översättning ur utkastet
        </button>
      )}
      <p className="text-xs text-[color:var(--ink)]/60">
        Hela texten sparas. Gästen kan välja svenska, engelska, tyska, danska och norska.
      </p>
      <label className="block text-sm">
        Inkluderad momssats
        <select
          className="inp mt-1"
          value={vatRate ?? ""}
          onChange={(event) =>
            onVatRate(event.target.value === "" ? null : (Number(event.target.value) as VatRate))
          }
        >
          <option value="">Ej angivet</option>
          <option value="0">0 %</option>
          <option value="12">12 %</option>
          <option value="25">25 %</option>
        </select>
      </label>
      <p className="text-xs text-[color:var(--ink)]/60">
        Momsen ingår i det angivna priset och läggs inte på igen. Ändringar gäller nya köp.
      </p>
    </div>
  );
}

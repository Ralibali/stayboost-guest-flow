import {
  CONTENT_LANGUAGES,
  isUnitTranslation,
  isUnitTranslations,
  type ContentLanguage,
  type UnitTranslation,
  type UnitTranslations,
} from "./unit-content.ts";

export type AddonTranslations = UnitTranslations;
export type VatRate = 0 | 12 | 25;
export const isAddonTranslations = isUnitTranslations;
export const isVatRate = (value: unknown): value is VatRate =>
  value === 0 || value === 12 || value === 25;

/** Public text and tax metadata only. Never forward source/archive keys. */
export function projectAddonContent(source: {
  content_translations?: unknown;
  vat_rate?: unknown;
}): {
  contentTranslations: AddonTranslations;
  vatRate: VatRate | null;
} {
  const contentTranslations: AddonTranslations = {};
  const translations = source.content_translations;
  if (translations && typeof translations === "object" && !Array.isArray(translations)) {
    for (const lang of CONTENT_LANGUAGES) {
      const entry = (translations as Record<string, unknown>)[lang];
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const candidate = entry as Record<string, unknown>;
      const text = { name: candidate.name, description: candidate.description };
      if (isUnitTranslation(text)) contentTranslations[lang] = text;
    }
  }
  return { contentTranslations, vatRate: isVatRate(source.vat_rate) ? source.vat_rate : null };
}

export function localizedAddonText(
  addon: { name: string; description?: string | null; contentTranslations?: AddonTranslations },
  language: ContentLanguage,
): UnitTranslation {
  return (
    addon.contentTranslations?.[language] ??
    addon.contentTranslations?.sv ?? {
      name: addon.name,
      description: addon.description ?? null,
    }
  );
}

export function addonVatLabel(rate: VatRate | null | undefined, language: "sv" | "en" | "de") {
  if (rate == null) return null;
  return { sv: `Inkl. ${rate} % moms`, en: `Includes ${rate}% VAT`, de: `Inkl. ${rate} % MwSt.` }[
    language
  ];
}

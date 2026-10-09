import { CONTENT_LANGUAGES, type ContentLanguage } from "./unit-content.ts";

/** Generic guest information only. Access codes, Wi-Fi and private unit instructions stay separate. */
export type GuestInfoText = { directions: string | null; house_rules: string | null };
export type GuestInfoTranslations = Partial<Record<ContentLanguage, GuestInfoText>>;

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const validText = (value: unknown): value is string | null =>
  value === null ||
  (typeof value === "string" && [...value].length <= 100000 && !value.includes("\u0000"));
const validEntry = (value: unknown): value is GuestInfoText =>
  record(value) &&
  Object.keys(value).every((key) => key === "directions" || key === "house_rules") &&
  Object.hasOwn(value, "directions") &&
  Object.hasOwn(value, "house_rules") &&
  validText(value.directions) &&
  validText(value.house_rules);

export function isGuestInfoTranslations(value: unknown): value is GuestInfoTranslations {
  return (
    record(value) &&
    Object.entries(value).every(
      ([language, entry]) =>
        CONTENT_LANGUAGES.includes(language as ContentLanguage) && validEntry(entry),
    )
  );
}

/** Never spread the stored JSON into a token response, even if a future writer adds fields. */
export function projectPropertyGuestInfo(value: unknown): GuestInfoTranslations {
  const result: GuestInfoTranslations = {};
  if (!record(value)) return result;
  for (const language of CONTENT_LANGUAGES) {
    if (!Object.hasOwn(value, language)) continue;
    const entry = value[language];
    if (!record(entry)) continue;
    const projected = {
      directions:
        Object.hasOwn(entry, "directions") && validText(entry.directions) ? entry.directions : null,
      house_rules:
        Object.hasOwn(entry, "house_rules") && validText(entry.house_rules)
          ? entry.house_rules
          : null,
    };
    result[language] = projected;
  }
  return result;
}

/** Null means fallback; an explicit empty string intentionally hides that field. */
export function localizedPropertyGuestInfo(
  property: GuestInfoText & { guestInfoTranslations?: GuestInfoTranslations },
  language: ContentLanguage,
): GuestInfoText {
  const translations = projectPropertyGuestInfo(property.guestInfoTranslations);
  return {
    directions:
      translations[language]?.directions ?? translations.sv?.directions ?? property.directions,
    house_rules:
      translations[language]?.house_rules ?? translations.sv?.house_rules ?? property.house_rules,
  };
}

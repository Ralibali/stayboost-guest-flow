import { sanitizedHttpsUrl } from "./public-links.ts";

export const CONTENT_LANGUAGES = ["sv", "en", "de", "da", "no"] as const;
export type ContentLanguage = (typeof CONTENT_LANGUAGES)[number];
export type UnitTranslation = { name: string; description: string | null };
export type UnitTranslations = Partial<Record<ContentLanguage, UnitTranslation>>;
export type UnitGalleryImage = { id: string; storage_path: string; alt_text: string };
export type PublicUnitImage = { id: string; url: string; altText: string };
export const MAX_GALLERY_IMAGES = 100;

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
const textWithin = (value: unknown, max: number): value is string =>
  typeof value === "string" && [...value].length <= max && !value.includes("\u0000");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isUnitTranslation(value: unknown): value is UnitTranslation {
  return (
    record(value) &&
    exactKeys(value, ["name", "description"]) &&
    textWithin(value.name, 2000) &&
    Boolean(value.name.trim()) &&
    (value.description === null || textWithin(value.description, 100000))
  );
}

export function isUnitTranslations(value: unknown): value is UnitTranslations {
  return (
    record(value) &&
    Object.entries(value).every(
      ([language, entry]) =>
        CONTENT_LANGUAGES.includes(language as ContentLanguage) && isUnitTranslation(entry),
    )
  );
}

/** New gallery files always belong to this exact property and unit. No URL/query is accepted. */
export function isUnitImagePath(
  value: unknown,
  propertyId: string,
  unitId: string,
): value is string {
  if (typeof value !== "string" || !UUID.test(propertyId) || !UUID.test(unitId)) return false;
  const parts = value.split("/");
  return (
    parts.length === 3 &&
    parts[0] === propertyId &&
    parts[1] === unitId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|avif)$/.test(
      parts[2],
    )
  );
}

export function isUnitGallery(
  value: unknown,
  propertyId: string,
  unitId: string,
): value is UnitGalleryImage[] {
  if (!Array.isArray(value) || value.length > MAX_GALLERY_IMAGES) return false;
  const ids = new Set<string>();
  const paths = new Set<string>();
  return value.every((image) => {
    if (
      !record(image) ||
      !exactKeys(image, ["id", "storage_path", "alt_text"]) ||
      typeof image.id !== "string" ||
      !UUID.test(image.id) ||
      ids.has(image.id) ||
      !isUnitImagePath(image.storage_path, propertyId, unitId) ||
      paths.has(image.storage_path) ||
      !textWithin(image.alt_text, 2000)
    )
      return false;
    ids.add(image.id);
    paths.add(image.storage_path);
    return true;
  });
}

export function unitImageUrl(
  baseUrl: string,
  path: string,
  propertyId: string,
  unitId: string,
): string | null {
  if (!isUnitImagePath(path, propertyId, unitId)) return null;
  const safeBase = sanitizedHttpsUrl(baseUrl);
  if (!safeBase) return null;
  return `${new URL(safeBase).origin}/storage/v1/object/public/unit-images/${path}`;
}

/** Explicit public projection: never expose source archives, signed URLs or arbitrary JSON keys. */
export function projectUnitContent(
  source: { id: string; content_translations?: unknown; gallery?: unknown },
  propertyId: string,
  baseUrl: string,
): { contentTranslations: UnitTranslations; gallery: PublicUnitImage[] } {
  const contentTranslations: UnitTranslations = {};
  if (record(source.content_translations)) {
    for (const language of CONTENT_LANGUAGES) {
      const entry = source.content_translations[language];
      if (!record(entry)) continue;
      const publicEntry = { name: entry.name, description: entry.description };
      if (isUnitTranslation(publicEntry)) contentTranslations[language] = publicEntry;
    }
  }
  const gallery = isUnitGallery(source.gallery, propertyId, source.id)
    ? source.gallery.flatMap((image) => {
        const url = unitImageUrl(baseUrl, image.storage_path, propertyId, source.id);
        return url ? [{ id: image.id, url, altText: image.alt_text }] : [];
      })
    : [];
  return { contentTranslations, gallery };
}

export function localizedUnitText(
  unit: { name: string; description: string | null; contentTranslations?: UnitTranslations },
  language: ContentLanguage,
): UnitTranslation {
  const selected = unit.contentTranslations?.[language] ?? unit.contentTranslations?.sv;
  return selected ?? { name: unit.name, description: unit.description };
}

export function unitDisplayImages(unit: {
  name: string;
  imageUrl: string | null;
  gallery?: PublicUnitImage[];
}): PublicUnitImage[] {
  if (unit.gallery?.length) return unit.gallery;
  const url = sanitizedHttpsUrl(unit.imageUrl);
  return url ? [{ id: "legacy-cover", url, altText: unit.name }] : [];
}

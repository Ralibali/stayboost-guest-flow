export const SIRVOY_ARCHIVE_MAX_BYTES = 10 * 1024 * 1024;
export const SIRVOY_ARCHIVE_KINDS = [
  "bookings_condensed",
  "bookings_expanded",
  "sirvoy_compatible",
  "guests",
  "payments",
  "accounting",
  "settings",
  "other",
] as const;
export type SirvoyArchiveKind = (typeof SIRVOY_ARCHIVE_KINDS)[number];
export type SirvoyArchive = {
  id: string;
  property_id: string;
  filename: string;
  media_type: string;
  export_kind: SirvoyArchiveKind;
  coverage_from: string | null;
  coverage_to: string | null;
  coverage_filter: string | null;
  row_count: number | null;
  row_count_note: string | null;
  byte_count: number;
  sha256: string;
  created_at: string;
};
export const SIRVOY_ARCHIVE_COLUMNS =
  "id,property_id,filename,media_type,export_kind,coverage_from,coverage_to,coverage_filter,row_count,row_count_note,byte_count,sha256,created_at";

const hex = Array.from({ length: 256 }, (_, value) => value.toString(16).padStart(2, "0"));
export function archiveBytesToHex(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let start = 0; start < bytes.length; start += 65536)
    chunks.push(Array.from(bytes.subarray(start, start + 65536), (value) => hex[value]).join(""));
  return "\\x" + chunks.join("");
}
export function archiveHexToBytes(value: string): Uint8Array {
  if (
    value.length < 4 ||
    !value.startsWith("\\x") ||
    (value.length - 2) % 2 ||
    /[^0-9a-f]/i.test(value.slice(2))
  )
    throw new Error("invalid_archive_bytes");
  const bytes = new Uint8Array((value.length - 2) / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(value.slice(2 + i * 2, 4 + i * 2), 16);
  return bytes;
}
export async function archiveSha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (value) => hex[value]).join("");
}

/** Counts CSV/TSV records only. It never maps fields or alters the archived bytes. */
export function archiveRowCount(bytes: Uint8Array, filename: string) {
  const unknown = (note: string) => ({ rowCount: null, rowCountNote: note });
  if (!/\.(csv|tsv)$/i.test(filename)) return unknown("Radantal räknas bara för CSV och TSV.");
  let text: string;
  try {
    const encoding =
      bytes[0] === 255 && bytes[1] === 254
        ? "utf-16le"
        : bytes[0] === 254 && bytes[1] === 255
          ? "utf-16be"
          : "utf-8";
    text = new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    return unknown("Filens teckenkodning kunde inte verifieras; originalet är bevarat.");
  }
  if (text.includes("\0"))
    return unknown("Filformatet kunde inte verifieras; originalet är bevarat.");
  const first = text.split(/\r?\n/, 1)[0];
  const delimiter = /\.tsv$/i.test(filename)
    ? "\t"
    : (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0)
      ? ";"
      : ",";
  let quoted = false,
    fieldStart = true,
    afterQuote = false,
    nonempty = false,
    rows = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') i++;
      else if (char === '"') {
        quoted = false;
        afterQuote = true;
      }
      nonempty = true;
    } else if (char === delimiter) {
      fieldStart = true;
      afterQuote = false;
      nonempty = true;
    } else if (char === "\r" || char === "\n") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      if (nonempty) rows++;
      nonempty = false;
      fieldStart = true;
      afterQuote = false;
    } else if (char === '"' && fieldStart) {
      quoted = true;
      fieldStart = false;
      nonempty = true;
    } else if (char === '"' || (afterQuote && char.trim()))
      return unknown("CSV-raderna kunde inte verifieras; originalet är bevarat.");
    else {
      fieldStart = false;
      nonempty ||= Boolean(char.trim());
    }
  }
  if (quoted) return unknown("CSV-raderna kunde inte verifieras; originalet är bevarat.");
  if (nonempty) rows++;
  return {
    rowCount: Math.max(0, rows - 1),
    rowCountNote: "Dataposter exklusive första rubrikraden.",
  };
}

export function archiveDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value + "T12:00:00Z")) ||
    new Date(value + "T12:00:00Z").toISOString().slice(0, 10) !== value
  )
    throw new Error("invalid_coverage");
  return value;
}

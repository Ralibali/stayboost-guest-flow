/** Source-only projection. Never creates reservations, charges, or refunds. */
export const SIRVOY_SOURCE_PARSER_VERSION = "sirvoy-csv-v1";
export type SirvoySourceFormat = "bookings_condensed" | "bookings_expanded" | "sirvoy_compatible";
export type SirvoySourceScope = "excluding_cancelled" | "cancelled" | "all" | "unknown";
export type SirvoySourceRecord = {
  rowNumber: number;
  bookingRef: string;
  recordKind: string;
  roomRef: string | null;
  checkIn: string | null;
  checkOut: string | null;
  guestName: string | null;
  guestEmail: string | null;
  guestPhone: string | null;
  amountRaw: string | null;
  amountDecimal: string | null;
  paymentRef: string | null;
  paymentStatus: string | null;
  occurredRaw: string | null;
  fields: string[];
};
export type SirvoySourceResult = {
  parserVersion: typeof SIRVOY_SOURCE_PARSER_VERSION;
  format: SirvoySourceFormat;
  scope: SirvoySourceScope;
  headers: string[];
  records: SirvoySourceRecord[];
  rowCount: number;
  counts: { bookingCount: number; recordKinds: Record<string, number> };
  warnings: string[];
};

export const SIRVOY_SOURCE_HEADERS: Record<SirvoySourceFormat, readonly string[]> = {
  bookings_condensed: [
    "Booking date",
    "Booking source",
    "Booking no.",
    "Check-in",
    "Check-out",
    "First name",
    "Last name",
    "Company",
    "Address",
    "Postal code",
    "City",
    "State",
    "Country",
    "Phone",
    "Email",
    "Total",
    "Paid",
    "Number of guests",
    "Number of rooms",
    "Coupon code",
    "Guest comment",
    "Internal note",
    "Confirmed",
    "Checked-in",
    "Checked-out",
    "Star",
    "Passport no.",
    "Language",
    "Channel booking ID",
    "",
  ],
  bookings_expanded: [
    "Type",
    "Booking no.",
    "Check-in",
    "Check-out",
    "First name",
    "Last name",
    "Specification",
    "Room ID",
    "Guests",
    "Guest name",
    "Internal note",
    "Date",
    "Units",
    "Unit price",
    "Total",
    "Reference",
    "Status",
  ],
  sirvoy_compatible: [
    "Booking ID",
    "Check-in",
    "Check-out",
    "First name",
    "Last name",
    "Room ID",
    "Number of guests",
    "Room note",
    "Nightly price",
    "Company",
    "Address",
    "Postal code",
    "City",
    "Country",
    "Phone",
    "Email",
    "Guest comment",
    "Internal note",
    "Language",
    "Confirmed",
    "Guest name",
  ],
};

/** RFC4180 records, preserving every cell character after CSV unescaping. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let afterQuote = false;
  let rowStarted = false;
  const finishCell = () => {
    row.push(cell);
    cell = "";
    afterQuote = false;
  };
  const finishRow = () => {
    finishCell();
    rows.push(row);
    if (rows.length > 100_001) throw new Error("sirvoy_source_too_many_rows");
    row = [];
    rowStarted = false;
  };
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index++;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else cell += character;
      continue;
    }
    if (character === ",") {
      finishCell();
      rowStarted = true;
    } else if (character === "\r" || character === "\n") {
      finishRow();
      if (character === "\r" && text[index + 1] === "\n") index++;
    } else if (character === '"' && cell === "" && !afterQuote) {
      quoted = true;
      rowStarted = true;
    } else {
      if (afterQuote || character === '"') throw new Error("sirvoy_source_invalid_csv");
      cell += character;
      rowStarted = true;
    }
  }
  if (quoted) throw new Error("sirvoy_source_invalid_csv");
  if (rowStarted || row.length || cell || afterQuote) finishRow();
  return rows;
}

/** Exact decimal text, never a floating point conversion or a rounded amount. */
function normalizeAmount(value: string): string | null {
  const match = /^(-?)(\d{1,16})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const whole = match[2].replace(/^0+(?=\d)/, "");
  const fraction = (match[3] ?? "").padEnd(2, "0");
  const sign = match[1] && (whole !== "0" || fraction !== "00") ? "-" : "";
  return `${sign}${whole}.${fraction}`;
}

function sourceDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? value
    : null;
}

export function parseSirvoySource(
  bytes: Uint8Array,
  archiveKind: SirvoySourceFormat,
  scope: SirvoySourceScope,
): SirvoySourceResult {
  if (!Object.prototype.hasOwnProperty.call(SIRVOY_SOURCE_HEADERS, archiveKind))
    throw new Error("sirvoy_source_unsupported_format");
  if (!["excluding_cancelled", "cancelled", "all", "unknown"].includes(scope))
    throw new Error("sirvoy_source_invalid_scope");
  if (!bytes.length || bytes.length > 10 * 1024 * 1024)
    throw new Error("sirvoy_source_invalid_size");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    throw new Error("sirvoy_source_invalid_encoding");
  }
  if (text.includes("\0")) throw new Error("sirvoy_source_invalid_encoding");
  const [headers, ...rows] = parseCsv(text);
  const expected = SIRVOY_SOURCE_HEADERS[archiveKind];
  if (!headers || headers.length !== expected.length || headers.some((h, i) => h !== expected[i]))
    throw new Error("sirvoy_source_unsupported_headers");
  const indexes = new Map(headers.map((header, index) => [header, index]));
  const warningCounts = new Map<string, number>();
  const warn = (code: string) => warningCounts.set(code, (warningCounts.get(code) ?? 0) + 1);
  const recordKinds: Record<string, number> = Object.create(null);
  const bookings = new Set<string>();
  const records = rows.map((fields, index): SirvoySourceRecord => {
    const rowNumber = index + 1;
    if (fields.length !== headers.length)
      throw new Error(`sirvoy_source_column_count_row_${rowNumber}`);
    const get = (header: string) => {
      const at = indexes.get(header);
      return at === undefined ? "" : fields[at];
    };
    const nullable = (value: string) => (value === "" ? null : value);
    const bookingRef = get(
      archiveKind === "sirvoy_compatible" ? "Booking ID" : "Booking no.",
    ).trim();
    if (!bookingRef) throw new Error(`sirvoy_source_missing_booking_ref_row_${rowNumber}`);
    const recordKind =
      archiveKind === "bookings_expanded"
        ? get("Type")
        : archiveKind === "bookings_condensed"
          ? "BOOKING"
          : "ACCOMM";
    if (!recordKind || recordKind.length > 80)
      throw new Error(`sirvoy_source_invalid_record_kind_row_${rowNumber}`);
    if (
      archiveKind === "bookings_expanded" &&
      !["ACCOMM", "EXTRAS", "PAYMENT"].includes(recordKind)
    )
      warn("unknown_record_kind");
    const amountRaw = nullable(
      get(archiveKind === "sirvoy_compatible" ? "Nightly price" : "Total"),
    );
    const amountDecimal = amountRaw === null ? null : normalizeAmount(amountRaw);
    if (amountRaw !== null && amountDecimal === null) warn("unparsed_amount");
    const checkIn = sourceDate(get("Check-in"));
    const checkOut = sourceDate(get("Check-out"));
    if (!checkIn || !checkOut) warn("unparsed_stay_dates");
    if (checkIn && checkOut && checkOut <= checkIn) warn("unordered_stay_dates");
    if (recordKind === "PAYMENT" && !get("Reference")) warn("payment_without_reference");
    const contactName = [get("First name").trim(), get("Last name").trim()]
      .filter(Boolean)
      .join(" ");
    bookings.add(bookingRef);
    recordKinds[recordKind] = (recordKinds[recordKind] ?? 0) + 1;
    return {
      rowNumber,
      bookingRef,
      recordKind,
      roomRef: nullable(get("Room ID")),
      checkIn,
      checkOut,
      guestName: nullable(contactName || get("Guest name")),
      guestEmail: nullable(get("Email")),
      guestPhone: nullable(get("Phone")),
      amountRaw,
      amountDecimal,
      paymentRef: nullable(get("Reference")),
      paymentStatus: nullable(get("Status")),
      occurredRaw: nullable(get("Date") || get("Booking date")),
      fields,
    };
  });
  return {
    parserVersion: SIRVOY_SOURCE_PARSER_VERSION,
    format: archiveKind,
    scope,
    headers,
    records,
    rowCount: records.length,
    counts: { bookingCount: bookings.size, recordKinds },
    warnings: Array.from(warningCounts, ([code, count]) => `${code}:${count}`),
  };
}

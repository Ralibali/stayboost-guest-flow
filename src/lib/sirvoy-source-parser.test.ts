import { describe, expect, it } from "vitest";
import {
  parseSirvoySource,
  SIRVOY_SOURCE_HEADERS,
  type SirvoySourceFormat,
} from "../../supabase/functions/_shared/sirvoy-source-parser";

const encoder = new TextEncoder();
const quote = (value: string) =>
  /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
const source = (format: SirvoySourceFormat, input: Record<string, string>[], newline = "\r\n") => {
  const headers = SIRVOY_SOURCE_HEADERS[format];
  const rows = input.map((overrides) =>
    headers.map(
      (header) =>
        ({
          "Booking no.": "9001",
          "Booking ID": "9001",
          "Check-in": "2026-06-05",
          "Check-out": "2026-06-07",
          "First name": "Synthetic",
          "Last name": "Guest",
          Type: "ACCOMM",
          "Room ID": "1",
          Total: "1200.5",
          "Nightly price": "600.25",
          ...overrides,
        })[header] ?? "",
    ),
  );
  return encoder.encode(
    [headers, ...rows].map((row) => row.map(quote).join(",")).join(newline) + newline,
  );
};

describe("Sirvoy source parser", () => {
  it("retains every multiline, quoted and empty field and counts data records, not physical lines", () => {
    const note = '  Special, "quoted" note\r\nsecond line\n=literal formula  ';
    const result = parseSirvoySource(
      source("bookings_expanded", [
        { "Internal note": note },
        {
          "Room ID": "2",
          "Guest name": "Another synthetic guest",
        },
      ]),
      "bookings_expanded",
      "excluding_cancelled",
    );
    expect(result.rowCount).toBe(2);
    expect(result.records.map((r) => r.rowNumber)).toEqual([1, 2]);
    expect(result.records[0].fields[result.headers.indexOf("Internal note")]).toBe(note);
    expect(result.records[0].fields).toHaveLength(17);
    expect(result.counts).toEqual({ bookingCount: 1, recordKinds: { ACCOMM: 2 } });
    expect(result.records.map((r) => r.roomRef)).toEqual(["1", "2"]);
  });

  it("preserves cancelled export scope independently of Yes confirmation and No lifecycle flags", () => {
    const result = parseSirvoySource(
      source("bookings_condensed", [
        {
          Confirmed: "Ja",
          "Checked-in": "Nej",
          "Checked-out": "Nej",
          Email: "synthetic@example.invalid",
          Phone: "synthetic-phone",
          "Booking date": "2025-09-06 23:17:49",
          Paid: "1000",
        },
      ]),
      "bookings_condensed",
      "cancelled",
    );
    const record = result.records[0];
    expect(result.scope).toBe("cancelled");
    expect(record.recordKind).toBe("BOOKING");
    expect(record.guestEmail).toBe("synthetic@example.invalid");
    expect(record.guestPhone).toBe("synthetic-phone");
    expect(record.occurredRaw).toBe("2025-09-06 23:17:49");
    expect(record.fields[result.headers.indexOf("Confirmed")]).toBe("Ja");
    expect(record.fields[result.headers.indexOf("Checked-out")]).toBe("Nej");
    expect(record.fields[result.headers.indexOf("Paid")]).toBe("1000");
    expect(result.headers.at(-1)).toBe("");
    expect(record.fields.at(-1)).toBe("");
    expect(record).not.toHaveProperty("bookingStatus");
  });

  it("keeps payments at booking level with exact signed amount, source status and raw timestamp", () => {
    const result = parseSirvoySource(
      source("bookings_expanded", [
        { "Room ID": "1", Total: "1000.25" },
        { "Room ID": "2", Total: "1000.25" },
        { Type: "EXTRAS", "Room ID": "", Total: "200" },
        {
          Type: "PAYMENT",
          "Room ID": "",
          Total: "-1200.5",
          Reference: "ch_synthetic",
          Date: "2026-06-01 12:30",
          Status: "Genomförd",
        },
        {
          Type: "PAYMENT",
          "Room ID": "",
          Total: "200.50",
          Reference: "re_synthetic",
          Date: "2026-06-02 12:30",
          Status: "",
        },
      ]),
      "bookings_expanded",
      "excluding_cancelled",
    );
    const payments = result.records.filter((r) => r.recordKind === "PAYMENT");
    expect(payments).toHaveLength(2);
    expect(payments.map((r) => r.amountDecimal)).toEqual(["-1200.50", "200.50"]);
    expect(payments.map((r) => r.roomRef)).toEqual([null, null]);
    expect(payments.map((r) => r.paymentRef)).toEqual(["ch_synthetic", "re_synthetic"]);
    expect(payments.map((r) => r.paymentStatus)).toEqual(["Genomförd", null]);
    expect(payments[0].occurredRaw).toBe("2026-06-01 12:30");
    expect(payments[1]).not.toHaveProperty("refundStatus");
    expect(payments[0]).not.toHaveProperty("currency");
    expect(result.counts).toEqual({
      bookingCount: 1,
      recordKinds: { ACCOMM: 2, EXTRAS: 1, PAYMENT: 2 },
    });
  });

  it("retains high precision or unrecognized amounts without rounding or inventing a value", () => {
    const amounts = ["001234.5", "-0.00", "9007199254740993.99", "1.234", "1,50", "SEK 100", ""];
    const result = parseSirvoySource(
      source(
        "bookings_expanded",
        amounts.map((Total) => ({ Total })),
      ),
      "bookings_expanded",
      "unknown",
    );
    expect(result.records.map((r) => r.amountDecimal)).toEqual([
      "1234.50",
      "0.00",
      "9007199254740993.99",
      null,
      null,
      null,
      null,
    ]);
    expect(result.records.map((r) => r.amountRaw)).toEqual(amounts.map((a) => a || null));
    expect(result.warnings).toContain("unparsed_amount:3");
  });

  it("preserves unknown row kinds and duplicate rows instead of silently dropping source evidence", () => {
    const result = parseSirvoySource(
      source("bookings_expanded", [
        { Type: "ADJUSTMENT" },
        { Type: "ADJUSTMENT" },
        { Type: "__proto__" },
      ]),
      "bookings_expanded",
      "all",
    );
    expect(result.records).toHaveLength(3);
    expect(result.records[0].fields).toEqual(result.records[1].fields);
    expect(result.counts.recordKinds).toEqual({ ADJUSTMENT: 2, ["__proto__"]: 1 });
    expect(result.warnings).toEqual(["unknown_record_kind:3"]);
  });

  it("retains invoice source entries without classifying them as payments", () => {
    const result = parseSirvoySource(
      source("bookings_expanded", [
        {
          Type: "INVOICE 90001",
          "Room ID": "",
          Total: "-1200.50",
          Reference: "",
          Status: "",
        },
      ]),
      "bookings_expanded",
      "excluding_cancelled",
    );
    expect(result.records[0].recordKind).toBe("INVOICE 90001");
    expect(result.records[0].amountDecimal).toBe("-1200.50");
    expect(result.records[0].paymentRef).toBeNull();
    expect(result.records[0].paymentStatus).toBeNull();
    expect(result.records.filter((record) => record.recordKind === "PAYMENT")).toHaveLength(0);
    expect(result.records[0].fields[0]).toBe("INVOICE 90001");
  });

  it("maps compatible room rows without treating nightly price as a reservation total", () => {
    const result = parseSirvoySource(
      source("sirvoy_compatible", [{ Confirmed: "Yes" }]),
      "sirvoy_compatible",
      "cancelled",
    );
    expect(result.format).toBe("sirvoy_compatible");
    expect(result.records[0].amountDecimal).toBe("600.25");
    expect(result.records[0].paymentRef).toBeNull();
    expect(result.records[0].recordKind).toBe("ACCOMM");
    expect(result.records[0].fields[result.headers.indexOf("Confirmed")]).toBe("Yes");
  });

  it("supports UTF-8 BOM, header-only exports and final records without a newline", () => {
    const headers = SIRVOY_SOURCE_HEADERS.bookings_expanded.join(",");
    expect(
      parseSirvoySource(encoder.encode(`\uFEFF${headers}\r\n`), "bookings_expanded", "all")
        .rowCount,
    ).toBe(0);
    const bytes = source("bookings_expanded", [{}], "\n");
    expect(
      parseSirvoySource(bytes.subarray(0, bytes.length - 1), "bookings_expanded", "all").rowCount,
    ).toBe(1);
  });

  it("leaves invalid source dates in fields and reports that normalized dates are unavailable", () => {
    const result = parseSirvoySource(
      source("bookings_expanded", [{ "Check-in": "2026-02-30" }, { "Check-out": "2026-06-01" }]),
      "bookings_expanded",
      "unknown",
    );
    expect(result.records[0].checkIn).toBeNull();
    expect(result.records[0].fields[result.headers.indexOf("Check-in")]).toBe("2026-02-30");
    expect(result.warnings).toEqual(["unparsed_stay_dates:1", "unordered_stay_dates:1"]);
  });

  it("rejects unknown schemas, malformed CSV, missing keys and invalid bytes without disclosing cells", () => {
    const wrongHeader = source("bookings_expanded", [{}]);
    const original = new TextDecoder().decode(wrongHeader);
    expect(() =>
      parseSirvoySource(
        encoder.encode(original.replace("Type", "Private unexpected header")),
        "bookings_expanded",
        "all",
      ),
    ).toThrow("sirvoy_source_unsupported_headers");
    expect(() =>
      parseSirvoySource(
        encoder.encode(original + '"private unterminated'),
        "bookings_expanded",
        "all",
      ),
    ).toThrow("sirvoy_source_invalid_csv");
    expect(() =>
      parseSirvoySource(
        encoder.encode(original + "private,short,row\n"),
        "bookings_expanded",
        "all",
      ),
    ).toThrow("sirvoy_source_column_count_row_2");
    expect(() =>
      parseSirvoySource(
        source("bookings_expanded", [{ "Booking no.": "" }]),
        "bookings_expanded",
        "all",
      ),
    ).toThrow("sirvoy_source_missing_booking_ref_row_1");
    expect(() => parseSirvoySource(new Uint8Array([0xff]), "bookings_expanded", "all")).toThrow(
      "sirvoy_source_invalid_encoding",
    );
    expect(() => parseSirvoySource(encoder.encode("\0"), "bookings_expanded", "all")).toThrow(
      "sirvoy_source_invalid_encoding",
    );
  });
});

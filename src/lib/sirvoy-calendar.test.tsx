import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ImportedPaymentPanel } from "@/components/app/ImportedPaymentPanel";
import { SirvoyCalendarPanel } from "@/components/app/SirvoyCalendarPanel";
import type { Booking } from "./supabase";
import {
  formatSirvoyDecimal,
  isSirvoyCalendarBooking,
  matchingSirvoyValues,
  type SirvoyCalendarValues,
} from "./sirvoy-calendar";

vi.mock("./supabase", () => ({ supabase: null }));

const booking = {
  id: "booking-a",
  property_id: "property-a",
  external_id: "sirvoy-csv:123:1",
  source_accommodation_record_id: "room-source",
  source_booking_record_id: "booking-source",
  payment_status: "none",
  payment_amount: null,
  communications_enabled: false,
  status: "confirmed",
  created_at: "2026-10-05T12:00:00Z",
} as Booking;
const values: SirvoyCalendarValues = {
  booking_id: booking.id,
  property_id: booking.property_id,
  source_accommodation_record_id: "room-source",
  source_booking_record_id: "booking-source",
  accommodation_amount: "3304.20",
  booking_total: "3304.20",
  booking_paid_raw: "0",
  source_booking_ref: "123",
  source_room_ref: "1",
  accommodation_archive_id: "archive-a",
  booking_archive_id: "archive-b",
  accommodation_filename: "room.csv",
  booking_filename: "booking.csv",
  accommodation_row: 2,
  booking_row: 3,
  currency: null,
};

describe("Sirvoy calendar documentary values", () => {
  it("preserves cents, signs, trailing decimals and large amounts without floating point", () => {
    expect(formatSirvoyDecimal("3304.20")).toBe("3\u00a0304,20");
    expect(formatSirvoyDecimal("4079.25")).toBe("4\u00a0079,25");
    expect(formatSirvoyDecimal("-9007199254740993.25")).toBe(
      "-9\u00a0007\u00a0199\u00a0254\u00a0740\u00a0993,25",
    );
    expect(formatSirvoyDecimal("0.00")).toBe("0,00");
    expect(formatSirvoyDecimal("1.2340")).toBe("1,2340");
    for (const raw of [null, undefined, "", "1e3", "1,00", "NaN"]) {
      expect(formatSirvoyDecimal(raw)).toBe("Ej tillgängligt");
    }
  });

  it("requires property, booking and both permanent source identities to match", () => {
    expect(matchingSirvoyValues(booking, values)).toBe(values);
    for (const key of [
      "booking_id",
      "property_id",
      "source_accommodation_record_id",
      "source_booking_record_id",
    ] as const) {
      expect(matchingSirvoyValues(booking, { ...values, [key]: "other" })).toBeNull();
    }
    expect(matchingSirvoyValues(booking, undefined)).toBeNull();
    expect(matchingSirvoyValues({ ...booking, source_booking_record_id: null }, values)).toBeNull();
  });

  it("keeps partial markers protected even without an external reference", () => {
    expect(isSirvoyCalendarBooking({})).toBe(false);
    expect(
      isSirvoyCalendarBooking({
        source_accommodation_record_id: null,
        source_booking_record_id: null,
      }),
    ).toBe(false);
    expect(isSirvoyCalendarBooking({ source_accommodation_record_id: "room-source" })).toBe(true);
    expect(isSirvoyCalendarBooking({ source_booking_record_id: "booking-source" })).toBe(true);
    expect(isSirvoyCalendarBooking({ source_booking_record_id: "" })).toBe(true);
  });

  it("removes reconciliation and message controls regardless of documentary availability or stale payment state", () => {
    for (const markers of [
      { source_accommodation_record_id: "room-source", source_booking_record_id: null },
      { source_accommodation_record_id: null, source_booking_record_id: "booking-source" },
    ]) {
      for (const status of ["none", "paid", "refund_pending"] as const) {
        const protectedBooking = {
          ...booking,
          ...markers,
          payment_status: status,
          payment_method: "none" as const,
        };
        expect(
          renderToStaticMarkup(
            <ImportedPaymentPanel booking={protectedBooking} onChanged={() => undefined} />,
          ),
        ).toBe("");
        expect(
          renderToStaticMarkup(
            <ImportedPaymentPanel
              booking={{ ...protectedBooking, external_id: null }}
              onChanged={() => undefined}
            />,
          ),
        ).toBe("");
      }
    }
  });

  it("keeps existing legacy import reconciliation available", () => {
    const legacy = {
      ...booking,
      source_accommodation_record_id: null,
      source_booking_record_id: null,
    };
    const html = renderToStaticMarkup(
      <ImportedPaymentPanel booking={legacy} onChanged={() => undefined} />,
    );
    expect(html).toContain("Betalning mottagen före flytten");
    expect(html).toContain("Aktivera kommande gästmeddelanden");
  });

  it("shows exact documentary amounts and source links without declaring payment or inventing currency", () => {
    const html = renderToStaticMarkup(<SirvoyCalendarPanel booking={booking} values={values} />);
    expect(html).toContain("3\u00a0304,20");
    expect(html).toContain("Inte verifierad i källunderlaget");
    expect(html).toContain("Betalning är inte avstämd i StayBoost");
    expect(html).toContain("Visa boendets originalrad");
    expect(html).toContain("room.csv");
    expect(html).not.toContain(" kr");
    expect(html).not.toContain("Registrera tidigare mottagen betalning");
  });

  it("keeps the failure state closed and never displays stale source amounts", () => {
    for (const source of [undefined, { ...values, property_id: "other" }]) {
      const html = renderToStaticMarkup(<SirvoyCalendarPanel booking={booking} values={source} />);
      expect(html).toContain("Källbeloppen kunde inte hämtas");
      expect(html).toContain("gästutskick är fortsatt avstängda");
      expect(html).not.toContain("3\u00a0304,20");
      expect(html).not.toContain("Visa boendets originalrad");
    }
  });
});

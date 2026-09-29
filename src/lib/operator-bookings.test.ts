import { describe, expect, it } from "vitest";
import type { Booking } from "./supabase";
import {
  bookingConflicts,
  bookingsNeedingAttention,
  bookingValueInWindow,
  fetchAllRows,
  occupiedUnitNights,
} from "./operator-bookings";
const booking = (overrides: Partial<Booking> = {}): Booking =>
  ({
    id: "booking",
    unit_id: "unit",
    status: "confirmed",
    checkin_date: "2026-09-01",
    checkout_date: "2026-09-03",
    payment_status: "paid",
    payment_amount: 2000,
    guest_email: "guest@example.com",
    guest_phone: "+46700000000",
    ...overrides,
  }) as Booking;

describe("operator booking attention", () => {
  it("keeps refunds visible after cancellation and after the stay ends", () => {
    const cancelled = booking({
      id: "cancelled",
      status: "cancelled",
      payment_status: "refund_pending",
    });
    const historic = booking({ id: "historic", payment_status: "refund_pending" });
    const paid = booking({ id: "paid" });
    expect(
      bookingsNeedingAttention([cancelled, historic, paid], "2026-09-29").map((row) => row.id),
    ).toEqual(["cancelled", "historic"]);
  });
  it("flags active unpaid past stays and unmapped upcoming reservations", () => {
    expect(
      bookingsNeedingAttention(
        [
          booking({ id: "pending", payment_status: "pending" }),
          booking({
            id: "unmapped",
            unit_id: null,
            checkin_date: "2026-10-01",
            checkout_date: "2026-10-03",
          }),
          booking({ id: "cancelled", status: "cancelled", payment_status: "pending" }),
        ],
        "2026-09-29",
      ).map((row) => row.id),
    ).toEqual(["pending", "unmapped"]);
  });
  it("detects nested overlaps but allows same-day turnover and ignores cancelled or unmapped rows", () => {
    const rows = [
      booking({ id: "long", checkout_date: "2026-09-10" }),
      booking({ id: "short", checkin_date: "2026-09-04", checkout_date: "2026-09-05" }),
      booking({ id: "turnover", checkin_date: "2026-09-10", checkout_date: "2026-09-12" }),
      booking({ id: "cancelled", status: "cancelled" }),
      booking({ id: "unmapped", unit_id: null }),
    ];
    expect([...bookingConflicts(rows)]).toEqual(["long", "short"]);
    expect(rows.map((row) => row.id)).toEqual([
      "long",
      "short",
      "turnover",
      "cancelled",
      "unmapped",
    ]);
  });
});

describe("occupancy and booking-value windows", () => {
  it("counts a conflicting unit/night only once and excludes hidden units", () => {
    expect(
      occupiedUnitNights(
        [
          booking(),
          booking({ id: "duplicate" }),
          booking({ id: "other", unit_id: "other" }),
          booking({ id: "hidden", unit_id: "hidden" }),
        ],
        [
          { id: "unit", active: true },
          { id: "other", active: true },
          { id: "hidden", active: false },
        ],
        "2026-09-01",
        "2026-09-04",
      ),
    ).toBe(4);
  });
  it("counts dates across DST and excludes the checkout night", () => {
    expect(
      occupiedUnitNights(
        [booking({ checkin_date: "2026-10-24", checkout_date: "2026-10-27" })],
        [{ id: "unit", active: true }],
        "2026-10-25",
        "2026-10-27",
      ),
    ).toBe(2);
  });
  it("attributes only the nights inside the selected revenue period", () => {
    const stay = booking({
      checkin_date: "2026-08-31",
      checkout_date: "2026-09-04",
      payment_amount: 4000,
    });
    expect(bookingValueInWindow(stay, "2026-09-01", "2026-09-03")).toBe(2000);
    expect(bookingValueInWindow(stay, "2026-09-01", "2026-09-03", 400)).toBe(200);
    expect(bookingValueInWindow(stay, "2026-09-04", "2026-09-10")).toBe(0);
    for (const payment_status of ["expired", "refunded", "refund_pending"] as const) {
      expect(bookingValueInWindow({ ...stay, payment_status }, "2026-08-31", "2026-09-04")).toBe(0);
    }
  });
});

describe("complete operator data loading", () => {
  it("reads more than the Data API's default row limit", async () => {
    const rows = Array.from({ length: 1251 }, (_, id) => ({ id }));
    const pages: [number, number][] = [];
    const result = await fetchAllRows(async (from, to) => {
      pages.push([from, to]);
      return { data: rows.slice(from, to + 1), error: null, count: rows.length };
    });
    expect(result).toEqual(rows);
    expect(pages).toEqual([
      [0, 499],
      [500, 999],
      [1000, 1499],
    ]);
  });
  it("continues when the server applies a smaller cap and returns a total count", async () => {
    const rows = Array.from({ length: 250 }, (_, id) => ({ id }));
    const result = await fetchAllRows(async (from) => ({
      data: rows.slice(from, from + 100),
      error: null,
      count: rows.length,
    }));
    expect(result).toEqual(rows);
  });
  it("fails the whole read when a later page fails, preventing a partial export", async () => {
    await expect(
      fetchAllRows(
        async (from) =>
          from
            ? { data: null, error: { message: "network" } }
            : { data: [{ id: 1 }], error: null, count: 2 },
        1,
      ),
    ).rejects.toThrow("network");
  });
});

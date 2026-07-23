import { describe, expect, it } from "vitest";
import { bookingsToCsv, emptyFilters, filterBookings } from "./booking-filters";
import type { Booking } from "./supabase";

const mk = (over: Partial<Booking>): Booking => ({
  id: "b1",
  property_id: "p1",
  unit_id: "u1",
  source: "direct",
  guest_name: "Anna Andersson",
  guest_email: "anna@example.se",
  guest_phone: "+46701234567",
  checkin_date: "2026-08-10",
  checkout_date: "2026-08-12",
  status: "confirmed",
  guest_token: "t".repeat(24),
  notes: null,
  payment_status: "paid",
  payment_amount: 2400,
  payment_ref: "SB-ABC123",
  payment_method: "stripe",
  payment_expires_at: null,
  stripe_session_id: null,
  addons_total: 0,
  guests: 2,
  created_at: "2026-08-01T10:00:00Z",
  updated_at: "2026-08-01T10:00:00Z",
  unit: { name: "Sjöbrisretreatet" },
  ...over,
});

describe("filterBookings", () => {
  const bookings = [
    mk({ id: "1", guest_name: "Anna Andersson", source: "direct", payment_status: "paid" }),
    mk({ id: "2", guest_name: "Bo Berg", source: "sirvoy", payment_status: "none", status: "cancelled" }),
    mk({ id: "3", guest_name: "Cecilia", unit_id: "u2", checkin_date: "2026-09-05", checkout_date: "2026-09-08" }),
  ];

  it("returnerar allt vid tomma filter", () => {
    expect(filterBookings(bookings, emptyFilters)).toHaveLength(3);
  });

  it("filtrerar på fritext (namn)", () => {
    const r = filterBookings(bookings, { ...emptyFilters, search: "berg" });
    expect(r.map((b) => b.id)).toEqual(["2"]);
  });

  it("filtrerar på källa och status", () => {
    expect(filterBookings(bookings, { ...emptyFilters, source: "sirvoy" }).map((b) => b.id)).toEqual(["2"]);
    expect(filterBookings(bookings, { ...emptyFilters, status: "cancelled" }).map((b) => b.id)).toEqual(["2"]);
  });

  it("filtrerar på datumintervall", () => {
    const r = filterBookings(bookings, { ...emptyFilters, from: "2026-09-01", to: "2026-09-30" });
    expect(r.map((b) => b.id)).toEqual(["3"]);
  });
});

describe("bookingsToCsv", () => {
  it("bygger header och rader med semikolon", () => {
    const csv = bookingsToCsv([mk({ guest_name: "Anna" })]);
    const [header, row] = csv.split("\n");
    expect(header.split(";")[0]).toBe("Namn");
    expect(row.split(";")[0]).toBe("Anna");
  });

  it("citerar fält med semikolon eller citattecken", () => {
    const csv = bookingsToCsv([mk({ guest_name: 'Nils "Kalle"; Persson' })]);
    expect(csv).toContain('"Nils ""Kalle""; Persson"');
  });
});

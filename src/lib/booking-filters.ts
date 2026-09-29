// StayBoost: filter- och exporthjälpare för bokningsadmin.
// Ren TypeScript — enkel att enhetstesta utan Supabase.

import type { Booking } from "./supabase";

export type BookingFilters = {
  search: string; // fritext mot namn/e-post/telefon
  unitId: string; // "alla" eller unit-id
  status: "all" | "confirmed" | "cancelled";
  source: "all" | Booking["source"];
  payment: "all" | Booking["payment_status"];
  from: string; // YYYY-MM-DD eller ""
  to: string; // YYYY-MM-DD eller ""
};

export const emptyFilters: BookingFilters = {
  search: "",
  unitId: "alla",
  status: "all",
  source: "all",
  payment: "all",
  from: "",
  to: "",
};

/** Bokningar som matchar samtliga aktiva filter. Tomma filter ignoreras. */
export function filterBookings(bookings: Booking[], f: BookingFilters): Booking[] {
  const q = f.search.trim().toLowerCase();
  return bookings.filter((b) => {
    if (f.unitId !== "alla" && b.unit_id !== f.unitId) return false;
    if (f.status !== "all" && b.status !== f.status) return false;
    if (f.source !== "all" && b.source !== f.source) return false;
    if (f.payment !== "all" && b.payment_status !== f.payment) return false;
    if (f.from && b.checkout_date < f.from) return false;
    if (f.to && b.checkin_date > f.to) return false;
    if (q) {
      const hay =
        `${b.guest_name ?? ""} ${b.guest_email ?? ""} ${b.guest_phone ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** RFC 4180-kompatibel CSV-cell. */
function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Bygger CSV med semikolon (Excel-vänligt i sv-SE). */
export function bookingsToCsv(bookings: Booking[]): string {
  const header = [
    "Namn",
    "E-post",
    "Telefon",
    "Boende",
    "Incheckning",
    "Utcheckning",
    "Gäster",
    "Status",
    "Källa",
    "Betalstatus",
    "Belopp",
    "Betalref",
    "Skapad",
  ];
  const rows = bookings.map((b) => [
    b.guest_name ?? "",
    b.guest_email ?? "",
    b.guest_phone ?? "",
    b.unit?.name ?? "",
    b.checkin_date,
    b.checkout_date,
    b.guests ?? "",
    b.status,
    b.source,
    b.payment_status,
    b.payment_amount ?? "",
    b.payment_ref ?? "",
    b.created_at,
  ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(";")).join("\n");
}

/** Filnamn med ISO-datum för nedladdning. */
export const csvFilename = (prefix = "bokningar") =>
  `${prefix}-${new Date().toISOString().slice(0, 10)}.csv`;

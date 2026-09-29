import type { Booking, Unit } from "./supabase";
import { shiftPropertyDay } from "./property-dates";

type InventoryBooking = Pick<
  Booking,
  "id" | "unit_id" | "status" | "checkin_date" | "checkout_date"
>;

export function bookingConflicts(bookings: InventoryBooking[]): Set<string> {
  const ids = new Set<string>();
  const units = new Map<string, InventoryBooking[]>();
  for (const booking of bookings) {
    if (booking.status !== "confirmed" || !booking.unit_id) continue;
    const stays = units.get(booking.unit_id) ?? [];
    stays.push(booking);
    units.set(booking.unit_id, stays);
  }
  for (const stays of units.values()) {
    stays.sort((a, b) => a.checkin_date.localeCompare(b.checkin_date));
    for (let i = 0; i < stays.length; i++) {
      for (let j = i + 1; j < stays.length && stays[j].checkin_date < stays[i].checkout_date; j++) {
        ids.add(stays[i].id);
        ids.add(stays[j].id);
      }
    }
  }
  return ids;
}

export function bookingsNeedingAttention(
  bookings: Booking[],
  today: string,
  conflicts = bookingConflicts(bookings),
): Booking[] {
  return bookings.filter(
    (booking) =>
      booking.payment_status === "refund_pending" ||
      (booking.status === "confirmed" && booking.payment_status === "pending") ||
      (booking.status === "confirmed" &&
        booking.checkout_date >= today &&
        (conflicts.has(booking.id) ||
          !booking.unit_id ||
          !booking.guest_email ||
          !booking.guest_phone)),
  );
}

/** Count each active accommodation/night once, including conflicting external bookings. */
export function occupiedUnitNights(
  bookings: InventoryBooking[],
  units: Pick<Unit, "id" | "active">[],
  from: string,
  to: string,
): number {
  const activeIds = new Set(units.filter((unit) => unit.active).map((unit) => unit.id));
  const nights = new Set<string>();
  for (const booking of bookings) {
    if (booking.status !== "confirmed" || !booking.unit_id || !activeIds.has(booking.unit_id))
      continue;
    const start = booking.checkin_date > from ? booking.checkin_date : from;
    const end = booking.checkout_date < to ? booking.checkout_date : to;
    for (let day = start; day < end; day = shiftPropertyDay(day, 1)) {
      nights.add(`${booking.unit_id}:${day}`);
    }
  }
  return nights.size;
}

export function bookingValueInWindow(
  booking: Pick<Booking, "payment_status" | "payment_amount" | "checkin_date" | "checkout_date">,
  from: string,
  to: string,
  amount = booking.payment_amount ?? 0,
): number {
  if (["refunded", "refund_pending", "expired"].includes(booking.payment_status)) return 0;
  const start = booking.checkin_date > from ? booking.checkin_date : from;
  const end = booking.checkout_date < to ? booking.checkout_date : to;
  const totalNights =
    (Date.parse(booking.checkout_date) - Date.parse(booking.checkin_date)) / 86400000;
  const overlap = (Date.parse(end) - Date.parse(start)) / 86400000;
  return totalNights > 0 && overlap > 0 ? (amount * overlap) / totalNights : 0;
}

export type PageResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
  count?: number | null;
};

/** The Data API caps responses. Exhaust pages so history and exports remain complete. */
export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = 500,
): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    const result = await page(rows.length, rows.length + pageSize - 1);
    if (result.error) throw new Error(result.error.message);
    const batch = result.data ?? [];
    rows.push(...batch);
    if (
      batch.length === 0 ||
      (result.count != null ? rows.length >= result.count : batch.length < pageSize)
    )
      return rows;
  }
}

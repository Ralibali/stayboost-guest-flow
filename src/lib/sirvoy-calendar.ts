import type { Booking } from "./supabase";

type SourceMarkers = Pick<Booking, "source_accommodation_record_id" | "source_booking_record_id">;

/** Either marker is sufficient to keep an incomplete or unavailable source read fail-closed. */
export function isSirvoyCalendarBooking(booking: SourceMarkers): boolean {
  return booking.source_accommodation_record_id != null || booking.source_booking_record_id != null;
}

export type SirvoyCalendarValues = {
  booking_id: string;
  property_id: string;
  source_accommodation_record_id: string;
  source_booking_record_id: string;
  accommodation_amount: string | null;
  booking_total: string | null;
  booking_paid_raw: string | null;
  source_booking_ref: string;
  source_room_ref: string;
  accommodation_archive_id: string;
  booking_archive_id: string;
  accommodation_filename: string;
  booking_filename: string;
  accommodation_row: number;
  booking_row: number;
  currency: string | null;
};

export function matchingSirvoyValues(
  booking: Pick<Booking, "id" | "property_id"> & SourceMarkers,
  values: SirvoyCalendarValues | null | undefined,
): SirvoyCalendarValues | null {
  return values &&
    isSirvoyCalendarBooking(booking) &&
    values.booking_id === booking.id &&
    values.property_id === booking.property_id &&
    values.source_accommodation_record_id === booking.source_accommodation_record_id &&
    values.source_booking_record_id === booking.source_booking_record_id
    ? values
    : null;
}

/** String operations retain all source decimals, including amounts beyond Number's exact range. */
export function formatSirvoyDecimal(value: string | null | undefined): string {
  if (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value)) return "Ej tillgängligt";
  const [integer, fraction] = value.split(".");
  return (
    integer.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0") +
    (fraction === undefined ? "" : `,${fraction}`)
  );
}

export const STAY_STATUS = {
  expected: "Väntas",
  checked_in: "Incheckad",
  checked_out: "Utcheckad",
  no_show: "Utebliven",
} as const;

export type StayStatus = keyof typeof STAY_STATUS;
export type BookingDraft = {
  unit_id: string;
  guest_name: string;
  guest_email: string;
  guest_phone: string;
  guests: number;
  checkin_date: string;
  checkout_date: string;
  internal_notes: string;
  stay_status: StayStatus;
};

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateBookingDraft(
  draft: BookingDraft,
  unit: { max_guests: number } | undefined,
  maxStay: number,
  validateStay = true,
): string | null {
  if (validateStay && !unit) return "Välj ett boende.";
  if (draft.guest_name.trim().length < 2 || draft.guest_name.trim().length > 120)
    return "Ange gästens namn (2–120 tecken).";
  if (draft.guest_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.guest_email.trim()))
    return "Kontrollera e-postadressen.";
  if (
    validateStay &&
    (!isCalendarDate(draft.checkin_date) ||
      !isCalendarDate(draft.checkout_date) ||
      draft.checkout_date <= draft.checkin_date)
  )
    return "Välj giltiga datum med avresa efter ankomst.";
  const nights = (Date.parse(draft.checkout_date) - Date.parse(draft.checkin_date)) / 86400000;
  if (validateStay && nights > maxStay) return `Vistelsen får vara högst ${maxStay} nätter.`;
  if (
    validateStay &&
    unit &&
    (!Number.isInteger(draft.guests) || draft.guests < 1 || draft.guests > unit.max_guests)
  )
    return `Boendet rymmer högst ${unit.max_guests} gäster. Ändra antalet eller välj ett annat boende.`;
  if (draft.internal_notes.length > 10000) return "Anteckningen får vara högst 10 000 tecken.";
  if (!(draft.stay_status in STAY_STATUS)) return "Välj en giltig ankomststatus.";
  return null;
}

export function bookingAdminError(error: { message: string; code?: string }): string {
  const known: Record<string, string> = {
    booking_overlap:
      "Boendet är redan bokat under hela eller delar av perioden. Välj ett annat tält eller andra datum.",
    stale_booking:
      "Bokningen har ändrats sedan du öppnade den. Stäng redigeringen, läs in bokningen igen och försök på nytt.",
    external_booking_dates:
      "Den här bokningens datum och boende styrs av den anslutna bokningskanalen. Ändra där först.",
    pending_payment_edit:
      "Bokningen har en pågående betalning eller återbetalning. Slutför den innan du ändrar vistelsen.",
    capacity_exceeded: "Antalet gäster överskrider boendets kapacitet.",
    inactive_unit: "Boendet är dolt från försäljning. Aktivera det innan bokningen flyttas dit.",
    invalid_unit: "Boendet tillhör inte den här anläggningen.",
    max_stay_exceeded: "Vistelsen överskrider anläggningens högsta antal nätter.",
    cancelled_booking_edit: "En avbokad bokning kan inte flyttas eller checkas in.",
  };
  return (
    Object.entries(known).find(([key]) => error.message.includes(key))?.[1] ??
    (error.code === "23P01"
      ? known.booking_overlap
      : "Ändringen kunde inte sparas. Läs in sidan igen och försök på nytt.")
  );
}

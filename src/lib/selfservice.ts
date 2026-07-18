/**
 * Min sida — gästens självbetjäning.
 * En inbyggd demobokning + alla bokningar som skapats i demots bokningsflöde
 * kan öppnas med bokningsnummer.
 */

import { ADDONS } from "./demo-data";
import {
  addDays,
  addSessionBooking,
  getSessionBookings,
  isRangeAvailable,
  rangeTotal,
  startOfDay,
  BOOKING_UNITS,
  type Booking,
} from "./booking-data";

export type MyBooking = {
  ref: string;
  guestName: string;
  email: string;
  unitId: string;
  start: Date;
  nights: number;
  guests: number;
  total: number;
  hasGuarantee: boolean;
  status: "Betald" | "Avbokad";
  addons: { name: string; qty: number }[];
  sessionBacked?: Booking; // om bokningen kommer från bokningsflödet
};

/** Inbyggd demobokning (Anna) — modul-nivå så ändringar lever kvar i sessionen. */
const demoBooking: MyBooking = {
  ref: "SB-DEMO",
  guestName: "Anna Lindqvist",
  email: "anna@example.se",
  unitId: "sjostugan",
  start: addDays(startOfDay(new Date()), 6),
  nights: 2,
  guests: 2,
  total: 0, // räknas nedan
  hasGuarantee: true,
  status: "Betald",
  addons: [{ name: "Frukostkorg", qty: 2 }],
};
demoBooking.total =
  rangeTotal(
    BOOKING_UNITS.find((u) => u.id === demoBooking.unitId)!,
    demoBooking.start,
    demoBooking.nights,
  ) +
  295 +
  ADDONS.find((a) => a.id === "frukost")!.price * 2;

/** Slå upp bokning på bokningsnummer (demo-bokning eller sessionsbokning). */
export const findMyBooking = (ref: string): MyBooking | null => {
  const r = ref.trim().toUpperCase();
  if (r === demoBooking.ref) return demoBooking.status === "Avbokad" ? demoBooking : demoBooking;
  const s = getSessionBookings().find((b) => b.id.toUpperCase() === r);
  if (!s) return null;
  return {
    ref: s.id,
    guestName: s.guestName,
    email: "din@epost.se",
    unitId: s.unitId,
    start: s.start,
    nights: s.nights,
    guests: 2,
    total: s.total,
    hasGuarantee: false,
    status: s.status === "Betald" ? "Betald" : "Betald",
    addons: [],
    sessionBacked: s,
  };
};

/** Boka om till nytt startdatum (samma enhet & antal nätter). */
export const rebook = (b: MyBooking, newStart: Date): { ok: boolean; reason?: string } => {
  if (!isRangeAvailable(b.unitId, newStart, b.nights)) {
    return { ok: false, reason: "Enheten är tyvärr bokad de datumen — välj andra datum." };
  }
  b.start = newStart;
  if (b.sessionBacked) {
    b.sessionBacked.start = newStart;
    b.sessionBacked.isNew = true;
  } else {
    // Registrera i ägarkalendern så ombokningen syns direkt
    addSessionBooking({
      id: b.ref,
      unitId: b.unitId,
      guestName: b.guestName,
      start: newStart,
      nights: b.nights,
      source: "Direkt",
      status: "Betald",
      total: b.total,
      createdDaysAgo: 0,
      isNew: true,
    });
  }
  return { ok: true };
};

export const cancel = (b: MyBooking) => {
  b.status = "Avbokad";
};

export const addAddonToBooking = (b: MyBooking, name: string, qty: number, price: number) => {
  const existing = b.addons.find((a) => a.name === name);
  if (existing) existing.qty += qty;
  else b.addons.push({ name, qty });
  b.total += price * qty;
};

/** Dagar kvar till ankomst (styr återbetalningsvillkoren). */
export const daysUntilArrival = (b: MyBooking) =>
  Math.round((+startOfDay(b.start) - +startOfDay(new Date())) / 86400000);

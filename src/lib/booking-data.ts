/**
 * Bokningsmotor — datamodell och deterministisk testdata.
 * Tillgängligheten genereras med ett frö så att demon ser stabilt och
 * realistiskt ut, men räknas relativt dagens datum.
 */

import { UNITS, type Unit } from "./demo-data";

export type BookingUnit = Unit & {
  capacity: number;
  basePrice: number;
  blurb: string;
  imageEmoji: string;
};

export type Booking = {
  id: string;
  unitId: string;
  guestName: string;
  start: Date; // incheckning
  nights: number;
  source: "Direkt" | "Booking.com" | "Sirvoy";
  status: "Betald" | "Delbetald";
  total: number;
  createdDaysAgo: number;
  isNew?: boolean;
};

export const BOOKING_UNITS: BookingUnit[] = UNITS.map((u) => {
  const extra: Record<
    string,
    { capacity: number; basePrice: number; blurb: string; imageEmoji: string }
  > = {
    sjobris: {
      capacity: 4,
      basePrice: 1695,
      blurb: "Rakt fram vid kanalen — dubbelsäng, bäddsoffa, värme och kylskåp.",
      imageEmoji: "⛺",
    },
    naturkarnan: {
      capacity: 4,
      basePrice: 1495,
      blurb: "Längst till vänster — familjetält med dubbelsäng och bäddsoffa.",
      imageEmoji: "🌿",
    },
    lugnetsyta: {
      capacity: 4,
      basePrice: 1395,
      blurb: "I mitten — lugnt läge med dubbelsäng, bäddsoffa och värme.",
      imageEmoji: "🌲",
    },
  };
  return { ...u, ...extra[u.id] };
});

export const CLEANING_FEE = 295;
export const WEEKEND_UPLIFT = 1.25; // fre & lör
export const PROMO_CODES: Record<string, number> = { KANAL10: 0.1 }; // 10 % rabatt

/* ---------- Sessionsbokningar (skapade i demots bokningsflöde) ---------- */
const sessionBookings: Booking[] = [];

export const addSessionBooking = (b: Booking) => {
  sessionBookings.unshift(b);
};

export const getSessionBookings = () => sessionBookings;

/* ---------- Datumhjälp ---------- */
export const startOfDay = (d: Date) => {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
};

export const addDays = (d: Date, n: number) => {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
};

export const dateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const isWeekendNight = (d: Date) => d.getDay() === 5 || d.getDay() === 6;

/** Säsongspris: högsäsong jun–aug, mellansäsong maj/sep, lågsäsong vinter. */
export const seasonMultiplier = (d: Date) => {
  const m = d.getMonth();
  if (m >= 5 && m <= 7) return 1.0; // jun–aug
  if (m === 4 || m === 8) return 0.85; // maj, sep
  return 0.7; // okt–apr
};

export const seasonLabel = (d: Date) => {
  const s = seasonMultiplier(d);
  if (s === 1) return null;
  return s === 0.85 ? "Mellansäsong −15 %" : "Lågsäsong −30 %";
};

/** Pris för en natt i en viss enhet (säsong + helgpåslag). */
export const nightlyPrice = (unit: BookingUnit, date: Date) => {
  const raw = unit.basePrice * seasonMultiplier(date) * (isWeekendNight(date) ? WEEKEND_UPLIFT : 1);
  return Math.round(raw / 5) * 5;
};

/* ---------- Deterministisk seedad RNG ---------- */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GUEST_NAMES = [
  "Familj Norberg",
  "Johan & Petra Sund",
  "Sofia Ekström",
  "Familj Bergström",
  "Markus Ohlsson",
  "Elin & David Fors",
  "Familj Åkerman",
  "Karin Lindell",
  "Peter & Anna Skog",
  "Familj Dahlqvist",
  "Nils Hedman",
  "Sara & Joel Vikström",
  "Familj Lindgren",
  "Emma Sjöblom",
  "Henrik & Lisa Ahl",
];
const SOURCES: Booking["source"][] = ["Direkt", "Direkt", "Booking.com", "Direkt", "Sirvoy"];

/** Genererar bokningar per enhet, från 5 dagar bakåt till 45 dagar framåt. */
export const BOOKINGS: Booking[] = (() => {
  const today = startOfDay(new Date());
  const all: Booking[] = [];
  BOOKING_UNITS.forEach((unit, ui) => {
    const rand = mulberry32(1234 + ui * 777);
    let day = -5;
    let nameIdx = ui * 3;
    let idCounter = 0;
    while (day < 45) {
      // ~45 % chans att en bokning startar (ger hög sommarbeläggning)
      if (rand() < 0.45) {
        const nights = rand() < 0.45 ? 1 : rand() < 0.8 ? 2 : 3;
        const start = addDays(today, day);
        let total = 0;
        for (let n = 0; n < nights; n++) total += nightlyPrice(unit, addDays(start, n));
        total += CLEANING_FEE;
        all.push({
          id: `SB-${unit.id.slice(0, 2).toUpperCase()}${100 + idCounter}`,
          unitId: unit.id,
          guestName: GUEST_NAMES[nameIdx % GUEST_NAMES.length],
          start,
          nights,
          source: SOURCES[Math.floor(rand() * SOURCES.length)],
          status: rand() < 0.75 ? "Betald" : "Delbetald",
          total,
          createdDaysAgo: Math.floor(rand() * 10),
        });
        nameIdx += 1;
        idCounter += 1;
        day += nights + (rand() < 0.5 ? 0 : 1);
      } else {
        day += 1;
      }
    }
  });
  return all;
})();

export const allBookings = () => [...sessionBookings, ...BOOKINGS];

/** Är en natt bokad för enheten? */
export const isNightBooked = (unitId: string, date: Date) => {
  const key = dateKey(date);
  return allBookings().some((b) => {
    if (b.unitId !== unitId) return false;
    for (let n = 0; n < b.nights; n++) {
      if (dateKey(addDays(b.start, n)) === key) return true;
    }
    return false;
  });
};

/** Är hela spannet ledigt? */
export const isRangeAvailable = (unitId: string, start: Date, nights: number) => {
  for (let n = 0; n < nights; n++) {
    if (isNightBooked(unitId, addDays(start, n))) return false;
  }
  return true;
};

/** Lägsta tillgängliga nattpris en viss natt (null = fullt). */
export const minAvailablePrice = (date: Date) => {
  let min: number | null = null;
  for (const u of BOOKING_UNITS) {
    if (!isNightBooked(u.id, date)) {
      const p = nightlyPrice(u, date);
      if (min === null || p < min) min = p;
    }
  }
  return min;
};

/** Totalpris för ett spann (exkl. städavgift). */
export const rangeTotal = (unit: BookingUnit, start: Date, nights: number) => {
  let total = 0;
  for (let n = 0; n < nights; n++) total += nightlyPrice(unit, addDays(start, n));
  return total;
};

/** Beläggning i % för kommande N dagar. */
export const occupancyPct = (days: number) => {
  const today = startOfDay(new Date());
  let booked = 0;
  const total = BOOKING_UNITS.length * days;
  for (const u of BOOKING_UNITS) {
    for (let d = 0; d < days; d++) {
      if (isNightBooked(u.id, addDays(today, d))) booked++;
    }
  }
  return Math.round((booked / total) * 100);
};

/* ---------- Resurser med delad kapacitet (BookSpot-stil) ---------- */
function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h;
}

export type Resource = {
  id: string;
  name: string;
  total: number;
  addonId: string; // tillvalet som drar på resursen
};

export const RESOURCES: Resource[] = [
  { id: "cyklar", name: "Cyklar", total: 6, addonId: "cykel" },
  { id: "kanoter", name: "Kanoter", total: 2, addonId: "kanot" },
  { id: "supbrador", name: "SUP-brädor", total: 4, addonId: "sup" },
];

/** Hur många av en resurs som är bokade ett visst datum (deterministiskt testdata). */
export const resourceBooked = (resourceId: string, date: Date) => {
  const r = RESOURCES.find((x) => x.id === resourceId)!;
  const rand = mulberry32(hashStr(dateKey(date) + resourceId));
  return Math.floor(rand() * (r.total + 1)); // 0..total
};

export const resourceLeft = (resourceId: string, date: Date) => {
  const r = RESOURCES.find((x) => x.id === resourceId)!;
  return Math.max(0, r.total - resourceBooked(resourceId, date));
};

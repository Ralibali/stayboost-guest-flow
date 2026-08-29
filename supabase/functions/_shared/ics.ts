// StayBoost: iCal-parsning via kewisch ical.js (MPL-2.0) — WP-SB-ICAL-LIBS-1 allowlist.
// Do not write a new RFC 5545 parser. First-8-digit DTSTART/DTEND is wrong for
// UTC DATE-TIME near midnight in Europe/Stockholm.
// Shared by ical-sync and src/lib/*.test.ts.

import ICAL from "ical.js";

export const ICS_TIMEZONE = "Europe/Stockholm";

export interface IcsEvent {
  uid: string;
  summary: string;
  status: string;
  startDate: string; // YYYY-MM-DD (incheckning)
  endDate: string; // YYYY-MM-DD (utcheckning, exklusiv i iCal = vår checkout_date)
}

type IcalTime = {
  isDate: boolean;
  year: number;
  month: number;
  day: number;
  timezone?: string;
  zone?: { tzid?: string };
  toJSDate: () => Date;
};

/** Slår ihop radbrutna fält (fortsättningsrader börjar med mellanslag/tab). */
export function unfoldIcs(raw: string): string {
  return raw.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function civilIso(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function stockholmDateFromJs(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ICS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  if (!year || !month || !day) return date.toISOString().slice(0, 10);
  return `${year}-${month}-${day}`;
}

function zoneId(time: IcalTime): string {
  return (time.zone?.tzid ?? time.timezone ?? "").replace(/^\//, "");
}

/** DATE-only stays put. UTC DATE-TIME becomes the Europe/Stockholm civil date. */
export function icalTimeToStockholmDate(time: IcalTime): string {
  if (time.isDate) return civilIso(time.year, time.month, time.day);
  const zone = zoneId(time);
  if (zone === "UTC" || zone === "Z") return stockholmDateFromJs(time.toJSDate());
  // TZID or floating: the printed wall-clock date is the night.
  return civilIso(time.year, time.month, time.day);
}

type IcalComponent = {
  name: string;
  getAllSubcomponents: (name: string) => IcalComponent[];
  getFirstPropertyValue: (name: string) => unknown;
};

function veventsFromRoot(root: IcalComponent): IcalComponent[] {
  if (root.name === "vevent") return [root];
  const nested = root.getAllSubcomponents("vevent");
  if (nested.length > 0) return nested;
  return root.getAllSubcomponents("vcalendar").flatMap((cal) => cal.getAllSubcomponents("vevent"));
}

export function parseIcs(raw: string): IcsEvent[] {
  let jcal: unknown;
  try {
    jcal = ICAL.parse(raw);
  } catch {
    return [];
  }
  if (!jcal || (Array.isArray(jcal) && jcal.length === 0)) return [];

  const Component = ICAL.Component as unknown as new (data: unknown) => IcalComponent;
  const Event = ICAL.Event as unknown as new (comp: IcalComponent) => {
    uid: string;
    summary?: string;
    startDate: IcalTime | null;
    endDate: IcalTime | null;
  };
  const root = new Component(jcal);
  const events: IcsEvent[] = [];
  for (const vevent of veventsFromRoot(root)) {
    try {
      const event = new Event(vevent);
      const start = event.startDate as IcalTime | null;
      const end = event.endDate as IcalTime | null;
      if (!event.uid || !start || !end) continue;
      const startDate = icalTimeToStockholmDate(start);
      const endDate = icalTimeToStockholmDate(end);
      if (endDate <= startDate) continue;
      const status = String(vevent.getFirstPropertyValue("status") ?? "CONFIRMED").toUpperCase();
      events.push({
        uid: String(event.uid),
        summary: event.summary ? String(event.summary) : "",
        status,
        startDate,
        endDate,
      });
    } catch {
      continue;
    }
  }
  return events;
}

/** Blockerade nätter ("Not available"/"Closed") är inte bokningar. */
export function isBlockEvent(e: IcsEvent): boolean {
  return /not available|blocked|closed|unavailable/i.test(e.summary);
}

/** Airbnb skriver "Reserved" när namnet inte delas — då saknar vi namn. */
export function guestNameFrom(summary: string): string | null {
  const s = summary.trim();
  if (!s || /^reserved$/i.test(s)) return null;
  return s;
}

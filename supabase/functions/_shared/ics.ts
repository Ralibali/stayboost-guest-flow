// StayBoost: iCal-parsning (RFC 5545-subset för Airbnb/Booking.com-flöden).
// Ren TypeScript utan Deno-beroenden — delas av edge-funktionen ical-sync
// och av enhetstesterna i src/lib/fas1.test.ts.
//
// DATE-only (VALUE=DATE or YYYYMMDD) is a civil night in Europe/Stockholm and
// must never be shifted across a timezone or DST boundary. DATE-TIME values
// convert to the Europe/Stockholm calendar date.

export const ICS_TIMEZONE = "Europe/Stockholm";

export interface IcsEvent {
  uid: string;
  summary: string;
  status: string;
  startDate: string; // YYYY-MM-DD (incheckning)
  endDate: string; // YYYY-MM-DD (utcheckning, exklusiv i iCal = vår checkout_date)
}

/** Slår ihop radbrutna fält (fortsättningsrader börjar med mellanslag/tab). */
export function unfoldIcs(raw: string): string {
  return raw.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
}

function parseContentLine(line: string): { name: string; params: Record<string, string>; value: string } | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name, ...paramParts] = left.split(";");
  const params: Record<string, string> = {};
  for (const part of paramParts) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  return { name: name.toUpperCase(), params, value };
}

function utcToStockholmDate(isoUtc: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ICS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(isoUtc));
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  if (!year || !month || !day) return isoUtc.slice(0, 10);
  return `${year}-${month}-${day}`;
}

/** Civil DATE stays put. DATE-TIME in UTC becomes the Stockholm calendar date. */
export function icsDateToIso(value: string, params: Record<string, string> = {}): string | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, zulu] = match;
  const dateOnly =
    params.VALUE?.toUpperCase() === "DATE" || (!hour && /^\d{8}$/.test(trimmed));
  if (dateOnly || !hour) {
    return `${year}-${month}-${day}`;
  }
  const tzid = params.TZID ?? "";
  if (zulu === "Z" && (!tzid || tzid.toUpperCase() === "UTC")) {
    return utcToStockholmDate(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  }
  // TZID or floating time: the printed wall-clock date is the night.
  return `${year}-${month}-${day}`;
}

export function parseIcs(raw: string): IcsEvent[] {
  const lines = unfoldIcs(raw).split(/\r?\n/);
  const events: IcsEvent[] = [];
  let cur: Partial<IcsEvent> | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      cur = {};
      continue;
    }
    if (line === "END:VEVENT") {
      if (cur?.uid && cur.startDate && cur.endDate && cur.endDate > cur.startDate) {
        events.push({ summary: "", status: "CONFIRMED", ...cur } as IcsEvent);
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const parsed = parseContentLine(line);
    if (!parsed) continue;
    switch (parsed.name) {
      case "UID":
        cur.uid = parsed.value.trim();
        break;
      case "SUMMARY":
        cur.summary = parsed.value.trim();
        break;
      case "STATUS":
        cur.status = parsed.value.trim().toUpperCase();
        break;
      case "DTSTART":
        cur.startDate = icsDateToIso(parsed.value, parsed.params) ?? undefined;
        break;
      case "DTEND":
        cur.endDate = icsDateToIso(parsed.value, parsed.params) ?? undefined;
        break;
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

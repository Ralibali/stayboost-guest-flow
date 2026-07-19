// StayBoost: iCal-parsning (RFC 5545-subset för Airbnb/Booking.com-flöden).
// Ren TypeScript utan Deno-beroenden — delas av edge-funktionen ical-sync
// och av enhetstesterna i src/lib/fas1.test.ts.

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

function toDate(value: string): string | null {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
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
    const m = line.match(/^([A-Za-z-]+)(?:;[^:]*)?:(.*)$/);
    if (!m) continue;
    const [, name, value] = m;
    switch (name.toUpperCase()) {
      case "UID":
        cur.uid = value.trim();
        break;
      case "SUMMARY":
        cur.summary = value.trim();
        break;
      case "STATUS":
        cur.status = value.trim().toUpperCase();
        break;
      case "DTSTART":
        cur.startDate = toDate(value) ?? undefined;
        break;
      case "DTEND":
        cur.endDate = toDate(value) ?? undefined;
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

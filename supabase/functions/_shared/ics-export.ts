// StayBoost: iCal-generering (RFC 5545) för exportflödet per enhet.
// Ren TypeScript utan Deno-beroenden — delas av edge-funktionen
// ical-export och av enhetstesterna i src/lib/fas1.test.ts.

export interface IcsOutEvent {
  uid: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD (exklusiv, som i iCal)
  summary: string;
}

/** Escapar textvärden enligt RFC 5545 (kommatecken, semikolon, radbryt). */
export function icsEscape(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Vikter långa rader enligt RFC 5545 (max 75 tecken, fortsättningsrad med mellanslag). */
export function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  for (let i = 0; i < line.length; i += 74) {
    parts.push((i === 0 ? "" : " ") + line.slice(i, i + 74));
  }
  return parts.join("\r\n");
}

const toIcsDate = (iso: string) => iso.replace(/-/g, "");

export function buildIcs(events: IcsOutEvent[], calendarName: string): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//StayBoost//Calendar 1.0//SV",
    "CALSCALE:GREGORIAN",
    foldLine(`X-WR-CALNAME:${icsEscape(calendarName)}`),
  ];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      foldLine(`UID:${e.uid}`),
      `DTSTART;VALUE=DATE:${toIcsDate(e.startDate)}`,
      `DTEND;VALUE=DATE:${toIcsDate(e.endDate)}`,
      foldLine(`SUMMARY:${icsEscape(e.summary)}`),
      "STATUS:CONFIRMED",
      "TRANSP:OPAQUE",
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

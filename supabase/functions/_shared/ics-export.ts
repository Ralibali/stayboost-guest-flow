// StayBoost: iCal-generering (RFC 5545) för exportflödet per enhet.
// Ren TypeScript utan Deno-beroenden — delas av edge-funktionen
// ical-export och av enhetstesterna i src/lib/fas1.test.ts.

export interface IcsOutEvent {
  uid: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD (exklusiv, som i iCal)
  summary: string;
  status?: "CONFIRMED" | "CANCELLED";
  lastModified?: string;
}

/** Escapar textvärden enligt RFC 5545 (kommatecken, semikolon, radbryt). */
export function icsEscape(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** RFC 5545 §3.1: fold at 75 octets, CRLF + WSP. Do not split UTF-8 codepoints. */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const bytes = encoder.encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let offset = 0;
  let budget = 75;
  while (offset < bytes.length) {
    let end = Math.min(offset + budget, bytes.length);
    while (end > offset && (bytes[end] & 0xc0) === 0x80) end--;
    if (end === offset) end = Math.min(offset + budget, bytes.length);
    const chunk = decoder.decode(bytes.subarray(offset, end));
    parts.push(offset === 0 ? chunk : ` ${chunk}`);
    offset = end;
    budget = 74;
  }
  return parts.join("\r\n");
}

const toIcsDate = (iso: string) => iso.replace(/-/g, "");

function toIcsUtcStamp(iso: string): string {
  const d = new Date(iso);
  const y = d.getUTCFullYear().toString().padStart(4, "0");
  const m = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = d.getUTCDate().toString().padStart(2, "0");
  const hh = d.getUTCHours().toString().padStart(2, "0");
  const mm = d.getUTCMinutes().toString().padStart(2, "0");
  const ss = d.getUTCSeconds().toString().padStart(2, "0");
  return `${y}${m}${day}T${hh}${mm}${ss}Z`;
}

export function buildIcs(events: IcsOutEvent[], calendarName: string): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//StayBoost//Calendar 1.0//SV",
    "CALSCALE:GREGORIAN",
    foldLine(`X-WR-CALNAME:${icsEscape(calendarName)}`),
  ];
  const nowStamp = toIcsUtcStamp(new Date().toISOString());
  for (const e of events) {
    const status = e.status === "CANCELLED" ? "CANCELLED" : "CONFIRMED";
    const lastModified = toIcsUtcStamp(e.lastModified ?? new Date().toISOString());
    lines.push(
      "BEGIN:VEVENT",
      foldLine(`UID:${e.uid}`),
      `DTSTART;VALUE=DATE:${toIcsDate(e.startDate)}`,
      `DTEND;VALUE=DATE:${toIcsDate(e.endDate)}`,
      `DTSTAMP:${nowStamp}`,
      `LAST-MODIFIED:${lastModified}`,
      foldLine(`SUMMARY:${icsEscape(e.summary)}`),
      `STATUS:${status}`,
      "TRANSP:OPAQUE",
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

export type BusyIcsEvent = {
  uid: string;
  startDate: string;
  endDate: string;
  status?: "CONFIRMED" | "CANCELLED";
};

/** Shadow / tenant-native export: busy VEVENTs only. No guest or payment fields. */
export function buildBusyIcs(
  events: BusyIcsEvent[],
  calendarName: string,
  stamps?: { dtstamp?: string; lastModified?: string },
): string {
  const now = new Date().toISOString();
  const dtstamp = toIcsUtcStamp(stamps?.dtstamp ?? now);
  const lastModified = toIcsUtcStamp(stamps?.lastModified ?? stamps?.dtstamp ?? now);
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
      `DTSTAMP:${dtstamp}`,
      `LAST-MODIFIED:${lastModified}`,
      `STATUS:${e.status === "CANCELLED" ? "CANCELLED" : "CONFIRMED"}`,
      "SUMMARY:busy",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

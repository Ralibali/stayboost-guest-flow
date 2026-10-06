// StayBoost: iCal-generering (RFC 5545) för exportflödet per enhet.
// Ren TypeScript utan Deno-beroenden — delas av edge-funktionen
// ical-export och av enhetstesterna i src/lib/fas1.test.ts.

export interface IcsOutEvent {
  uid: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD (exklusiv, som i iCal)
  summary: string;
}

export interface IcsClosedRule {
  id: string;
  unit_id: string | null;
  kind: string;
  active: boolean;
  date_from: string;
  date_to: string;
}

/** Only closed nights can be represented by an opaque iCal event, not CTA/CTD. */
export function closedRuleEvents(rules: IcsClosedRule[], unitId: string): IcsOutEvent[] {
  const events = new Map<string, IcsOutEvent>();
  for (const rule of rules) {
    if (
      !rule.active ||
      rule.kind !== "closed" ||
      (rule.unit_id !== null && rule.unit_id !== unitId)
    )
      continue;
    const start = new Date(`${rule.date_from}T00:00:00Z`);
    const end = new Date(`${rule.date_to}T00:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(rule.date_from) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(rule.date_to) ||
      !Number.isFinite(start.getTime()) ||
      !Number.isFinite(end.getTime()) ||
      start.toISOString().slice(0, 10) !== rule.date_from ||
      end.toISOString().slice(0, 10) !== rule.date_to ||
      end < start
    )
      throw new Error("invalid_closed_range");
    // rate_rules.date_to is inclusive; RFC 5545 DTEND is exclusive. UTC avoids DST shifts.
    end.setUTCDate(end.getUTCDate() + 1);
    const endDate = end.toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new Error("invalid_closed_range");
    const uid = `closed-${rule.id}-${unitId}@stayboost`;
    const previous = events.get(uid);
    if (previous && (previous.startDate !== rule.date_from || previous.endDate !== endDate)) {
      throw new Error("conflicting_closed_range");
    }
    // Stable identity survives renames/date edits; never expose rule names or private notes.
    events.set(uid, { uid, startDate: rule.date_from, endDate, summary: "Closed" });
  }
  return [...events.values()];
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
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

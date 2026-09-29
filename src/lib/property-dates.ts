/** Booking dates belong to the property, regardless of the operator's device timezone. */
export const PROPERTY_TIME_ZONE = "Europe/Stockholm";

export function propertyDay(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PROPERTY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function shiftPropertyDay(day: string, offset: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function propertyDateLabel(day: string, options: Intl.DateTimeFormatOptions): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("sv-SE", {
    ...options,
    timeZone: PROPERTY_TIME_ZONE,
  });
}

export function propertyMonth(offset = 0, now = new Date()) {
  const [year, month] = propertyDay(now).split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1 + offset, 1, 12));
  const next = new Date(Date.UTC(year, month + offset, 1, 12));
  const monthStart = start.toISOString().slice(0, 10);
  const nextMonth = next.toISOString().slice(0, 10);
  return {
    monthStart,
    monthEnd: shiftPropertyDay(nextMonth, -1),
    nextMonth,
    label: propertyDateLabel(monthStart, { month: "long", year: "numeric" }),
  };
}

/** A supplied accounting date is represented as midnight at the property. */
export function propertyMidnight(day: string): string {
  const target = Date.parse(`${day}T00:00:00Z`);
  let instant = target;
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: PROPERTY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    const rendered = Date.parse(`${formatter.format(new Date(instant)).replace(" ", "T")}Z`);
    instant += target - rendered;
  }
  return new Date(instant).toISOString();
}

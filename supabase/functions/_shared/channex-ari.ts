import type { AriPayload, ChannelUnitMapping } from "./channex.ts";

type DateSelector = { date: string } | { date_from: string; date_to: string };
export type AriChanges = {
  availability: (Omit<AriPayload["availability"][number], "date"> & DateSelector)[];
  restrictions: (Pick<AriPayload["restrictions"][number], "property_id" | "rate_plan_id"> &
    Partial<Omit<AriPayload["restrictions"][number], "property_id" | "rate_plan_id" | "date">> &
    DateSelector)[];
};
export type AriState = {
  property_id: string;
  external_property_id: string;
  environment: string;
  acknowledged_snapshot: AriPayload | null;
  pending_snapshot: AriPayload | null;
  pending_payload: AriChanges | null;
  pending_dirty_at: string | null;
  pending_from: string | null;
  recovery_required: boolean;
};
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
};
/** JSONB can reorder object keys; preserve identical wire JSON across persisted retries. */
export const canonicalAriValue = (value: unknown): unknown => JSON.parse(canonical(value));
const orderedSnapshot = (value: AriPayload) => ({
  availability: [...value.availability].sort((a, b) =>
    `${a.property_id}:${a.room_type_id}:${a.date}`.localeCompare(
      `${b.property_id}:${b.room_type_id}:${b.date}`,
    ),
  ),
  restrictions: [...value.restrictions].sort((a, b) =>
    `${a.property_id}:${a.rate_plan_id}:${a.date}`.localeCompare(
      `${b.property_id}:${b.rate_plan_id}:${b.date}`,
    ),
  ),
});
export const sameAriSnapshot = (a: AriPayload | null, b: AriPayload) =>
  a !== null && canonical(orderedSnapshot(a)) === canonical(orderedSnapshot(b));
const nextDay = (date: string) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
function ranges<T extends { date: string }>(rows: T[]): (Omit<T, "date"> & DateSelector)[] {
  const result: (Omit<T, "date"> & DateSelector)[] = [];
  let previousKey = "";
  let previousDate = "";
  for (const row of rows) {
    const { date, ...values } = row;
    const key = canonical(values);
    const previous = result.at(-1);
    if (previous && key === previousKey && date === nextDay(previousDate)) {
      if ("date" in previous) {
        const first = previous.date;
        result[result.length - 1] = { ...values, date_from: first, date_to: date };
      } else previous.date_to = date;
    } else result.push({ ...values, date });
    previousKey = key;
    previousDate = date;
  }
  return result;
}
/** Absolute, idempotent changes. Expired dates are dropped; new horizon days are initialized. */
export function channexAriChanges(current: AriPayload, previous: AriPayload | null): AriChanges {
  const oldAvailability = new Map(
    previous?.availability.map((v) => [`${v.room_type_id}:${v.date}`, v]) ?? [],
  );
  const oldRestrictions = new Map(
    previous?.restrictions.map((v) => [`${v.rate_plan_id}:${v.date}`, v]) ?? [],
  );
  const availability = current.availability.filter(
    (v) =>
      !oldAvailability.has(`${v.room_type_id}:${v.date}`) ||
      oldAvailability.get(`${v.room_type_id}:${v.date}`)?.availability !== v.availability,
  );
  const restrictions = current.restrictions.flatMap((row) => {
    const old = oldRestrictions.get(`${row.rate_plan_id}:${row.date}`);
    const changed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (
        !["property_id", "rate_plan_id", "date"].includes(key) &&
        (!old || canonical(old[key as keyof typeof old]) !== canonical(value))
      )
        changed[key] = value;
    }
    return Object.keys(changed).length
      ? [
          {
            property_id: row.property_id,
            rate_plan_id: row.rate_plan_id,
            date: row.date,
            ...changed,
          },
        ]
      : [];
  });
  return { availability: ranges(availability), restrictions: ranges(restrictions) } as AriChanges;
}
/** Close precisely the inventory touched by an uncertain delta, so its stored absolute replay restores it. */
export function closeChangedAvailability(changes: AriChanges): AriChanges["availability"] {
  return changes.availability.map((row) => ({ ...row, availability: 0 }));
}
/** Restriction-only uncertainty needs full closure because delta replay cannot reopen untargeted inventory. */
export function restrictionInventoryCovered(
  changes: AriChanges,
  mappings: ChannelUnitMapping[],
): boolean {
  const bounds = (row: DateSelector) =>
    "date" in row ? [row.date, row.date] : [row.date_from, row.date_to];
  return changes.restrictions.every((restriction) => {
    const room = mappings.find(
      (mapping) => mapping.rate_plan_id === restriction.rate_plan_id,
    )?.room_type_id;
    if (!room) return false;
    const [from, to] = bounds(restriction);
    for (let date = from; date <= to; date = nextDay(date)) {
      if (
        !changes.availability.some((row) => {
          const [start, end] = bounds(row);
          return row.room_type_id === room && start <= date && end >= date;
        })
      )
        return false;
    }
    return true;
  });
}

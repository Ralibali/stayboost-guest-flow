/** The scheduler polls about every 15 minutes. Allow one normal poll plus five minutes. */
export const ICAL_MAX_AGE_MS = 20 * 60_000;
export type IcalFreshnessSource = {
  property_id: string;
  unit_id: string;
  paused: boolean;
  last_success_at: string | null;
  consecutive_failures: number;
};

export function icalSourceFresh(
  source: Omit<IcalFreshnessSource, "property_id" | "unit_id">,
  now = Date.now(),
): boolean {
  const success = source.last_success_at ? Date.parse(source.last_success_at) : NaN;
  return (
    source.paused === false &&
    source.consecutive_failures === 0 &&
    Number.isFinite(success) &&
    success <= now &&
    now - success <= ICAL_MAX_AGE_MS
  );
}

export function icalUnitFresh(
  sources: IcalFreshnessSource[],
  propertyId: string,
  unitId: string,
  now = Date.now(),
): boolean {
  return sources
    .filter((source) => source.property_id === propertyId && source.unit_id === unitId)
    .every((source) => icalSourceFresh(source, now));
}

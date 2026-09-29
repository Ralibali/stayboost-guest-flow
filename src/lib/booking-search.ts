import { nightsBetween, quoteStay, rangesOverlap } from "../../supabase/functions/_shared/pricing";
import {
  checkAvailabilityRules,
  minStayFromRules,
  type RateRule,
} from "../../supabase/functions/_shared/rate-rules";

export type SearchUnit = {
  id: string;
  name: string;
  maxGuests: number;
  minStay: number;
  basePrice: number;
  weekendPct: number;
  cleaningFee: number;
  monthlyMult: number[];
  booked: { from: string; to: string }[];
  rateRules: RateRule[];
};
export type StaySearch = {
  checkin: string;
  nights: number;
  guests: number;
  today: string;
  availableThrough: string;
  maxStay: number;
  bookingEnabled: boolean;
};
export type StaySuggestion = {
  unitId: string;
  name: string;
  checkin: string;
  checkout: string;
  nights: number;
  total: number;
};

export function addIsoDays(date: string, days: number): string {
  const time = Date.parse(`${date}T12:00:00Z`);
  return Number.isFinite(time) ? new Date(time + days * 86_400_000).toISOString().slice(0, 10) : "";
}

/** Search only inside the loaded availability window. Final booking is revalidated by the server. */
export function findAvailableStays(units: SearchUnit[], search: StaySearch) {
  const empty = { exact: [] as StaySuggestion[], nearby: [] as StaySuggestion[] };
  if (
    !search.bookingEnabled ||
    !Number.isInteger(search.nights) ||
    search.nights < 1 ||
    search.nights > Math.min(30, search.maxStay) ||
    !Number.isInteger(search.guests) ||
    search.guests < 1 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(search.checkin) ||
    addIsoDays(search.checkin, 0) !== search.checkin ||
    search.checkin < search.today ||
    search.checkin >= search.availableThrough
  )
    return empty;

  const onDate = (checkin: string): StaySuggestion[] => {
    const checkout = addIsoDays(checkin, search.nights);
    if (checkin < search.today || checkout > search.availableThrough) return [];
    const nights = nightsBetween(checkin, checkout);
    return units
      .flatMap((unit) => {
        const rules = unit.rateRules ?? [];
        if (
          unit.maxGuests < search.guests ||
          search.nights < Math.max(unit.minStay, minStayFromRules(rules, unit.id, nights)) ||
          checkAvailabilityRules(rules, unit.id, nights, checkout) ||
          unit.booked.some((r) => rangesOverlap(checkin, checkout, r.from, r.to))
        )
          return [];
        const quote = quoteStay(
          {
            base_price: unit.basePrice,
            weekend_pct: unit.weekendPct,
            cleaning_fee: unit.cleaningFee,
            monthly_mult: (unit.monthlyMult ?? []).map(Number),
          },
          checkin,
          checkout,
          { rules, unitId: unit.id },
        );
        if (!Number.isFinite(quote.total) || quote.total < 0) return [];
        return [
          {
            unitId: unit.id,
            name: unit.name,
            checkin,
            checkout,
            nights: search.nights,
            total: quote.total,
          },
        ];
      })
      .sort((a, b) => a.total - b.total || a.name.localeCompare(b.name));
  };
  const exact = onDate(search.checkin);
  if (exact.length) return { exact, nearby: [] };
  const nearby: StaySuggestion[] = [];
  for (let distance = 1; distance <= 14 && nearby.length < 3; distance++) {
    for (const offset of [distance, -distance]) {
      const options = onDate(addIsoDays(search.checkin, offset));
      if (options[0]) nearby.push(options[0]);
      if (nearby.length === 3) break;
    }
  }
  return { exact, nearby };
}

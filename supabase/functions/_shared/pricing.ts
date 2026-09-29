// StayBoost: prismotor för direktbokningar.
// Ren TypeScript utan Deno-beroenden — delas av edge-funktionen
// booking-engine, bokningssidan (/boka/$slug) och enhetstesterna.

import { applyPriceRules, type RateRule } from "./rate-rules.ts";

export interface UnitPricing {
  base_price: number;
  weekend_pct: number; // påslag fre/lör-nätter, i procent
  cleaning_fee: number;
  monthly_mult: number[]; // jan..dec, i procent av baspriset
  party_pricing_enabled?: boolean;
  adult_prices?: number[];
  child_price_per_night?: number;
  child_free_through_age?: number;
  child_max_age?: number;
}

export interface BookingParty {
  adults: number;
  childrenAges: number[];
}

export function partySize(party: BookingParty): number {
  return party.adults + party.childrenAges.length;
}

export function partyIssue(
  u: UnitPricing,
  party: BookingParty,
  maxGuests = 20,
): "invalid_party" | "capacity_exceeded" | "pricing_unavailable" | null {
  if (
    !Number.isInteger(party.adults) ||
    party.adults < 1 ||
    party.adults > 20 ||
    !Array.isArray(party.childrenAges) ||
    party.childrenAges.length > 19 ||
    party.childrenAges.some(
      (age) => !Number.isInteger(age) || age < 0 || age > (u.child_max_age ?? 12),
    )
  )
    return "invalid_party";
  if (partySize(party) > maxGuests) return "capacity_exceeded";
  if (
    u.party_pricing_enabled &&
    (!Number.isFinite(u.adult_prices?.[party.adults - 1]) ||
      Number(u.adult_prices?.[party.adults - 1]) < 0)
  )
    return "pricing_unavailable";
  return null;
}

export interface NightlyLine {
  date: string;
  price: number;
  source: "base" | "override" | "multiplier";
  ruleId?: string;
  adultPrice?: number;
  childPrice?: number;
}

export interface StayQuote {
  nights: number;
  nightly: NightlyLine[];
  subtotal: number;
  cleaningFee: number;
  total: number;
  party?: BookingParty;
  adultSubtotal?: number;
  childrenSubtotal?: number;
}

const parseIso = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
};

const isoOf = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Alla nätter i [checkin, checkout) som ISO-datum. */
export function nightsBetween(checkin: string, checkout: string): string[] {
  const valid = (iso: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(iso) &&
    Number.isFinite(Date.parse(`${iso}T12:00:00Z`)) &&
    new Date(`${iso}T12:00:00Z`).toISOString().slice(0, 10) === iso;
  if (!valid(checkin) || !valid(checkout) || checkout <= checkin) return [];
  const { y, m, d } = parseIso(checkin);
  const out: string[] = [];
  for (let t = Date.UTC(y, m - 1, d); isoOf(t) < checkout; t += 86400000) {
    out.push(isoOf(t));
  }
  return out;
}

/** Fredags- och lördagsnätter (veckodag ur datumet, tidszonssäkert). */
export function isWeekendNight(iso: string): boolean {
  const { y, m, d } = parseIso(iso);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 5 || wd === 6;
}

/** Bas × månadsfaktor × helgpåslag, avrundat till närmaste 5 kr. */
export function baseNightlyPrice(u: UnitPricing, iso: string, party?: BookingParty): number {
  const { m } = parseIso(iso);
  const mult = (u.monthly_mult[m - 1] ?? 100) / 100;
  const weekend = isWeekendNight(iso) ? 1 + u.weekend_pct / 100 : 1;
  const adultBase =
    u.party_pricing_enabled && party ? u.adult_prices?.[party.adults - 1] : u.base_price;
  if (adultBase == null || !Number.isFinite(adultBase) || adultBase < 0)
    throw new Error("pricing_unavailable");
  return Math.round((adultBase * mult * weekend) / 5) * 5;
}

/** Bakåtkompatibelt alias. */
export const nightlyPrice = baseNightlyPrice;

/**
 * Priset för en enskild natt: rate-rule (override eller multiplier) vinner
 * över standardberäkningen. Utan matchande regel = standardpris.
 */
export function nightlyPriceWithRules(
  u: UnitPricing,
  iso: string,
  rules: RateRule[],
  unitId: string,
  party?: BookingParty,
): NightlyLine {
  const base = baseNightlyPrice(u, iso, party);
  const enabled = Boolean(u.party_pricing_enabled && party);
  const applied = applyPriceRules(base, rules, unitId, iso, enabled ? party!.adults : undefined);
  const childPrice = enabled
    ? party!.childrenAges.filter((age) => age > (u.child_free_through_age ?? 3)).length *
      (u.child_price_per_night ?? 0)
    : 0;
  if (!Number.isFinite(childPrice) || childPrice < 0) throw new Error("pricing_unavailable");
  return {
    date: iso,
    price: applied.price + childPrice,
    source: applied.source,
    ruleId: applied.ruleId,
    ...(enabled ? { adultPrice: applied.price, childPrice } : {}),
  };
}

export function quoteStay(
  u: UnitPricing,
  checkin: string,
  checkout: string,
  opts?: { rules?: RateRule[]; unitId?: string; party?: BookingParty },
): StayQuote {
  const rules = opts?.rules ?? [];
  const unitId = opts?.unitId ?? "";
  const party = opts?.party;
  if (u.party_pricing_enabled && (!party || partyIssue(u, party)))
    throw new Error(party ? partyIssue(u, party)! : "invalid_party");
  const nightly = nightsBetween(checkin, checkout).map((date) =>
    nightlyPriceWithRules(u, date, rules, unitId, party),
  );
  const subtotal = nightly.reduce((s, n) => s + n.price, 0);
  return {
    nights: nightly.length,
    nightly,
    subtotal,
    cleaningFee: u.cleaning_fee,
    total: subtotal + u.cleaning_fee,
    ...(u.party_pricing_enabled && party
      ? {
          party: { adults: party.adults, childrenAges: [...party.childrenAges] },
          adultSubtotal: nightly.reduce((sum, night) => sum + (night.adultPrice ?? 0), 0),
          childrenSubtotal: nightly.reduce((sum, night) => sum + (night.childPrice ?? 0), 0),
        }
      : {}),
  };
}

/** Överlappar [aFrom,aTo) och [bFrom,bTo)? */
export function rangesOverlap(aFrom: string, aTo: string, bFrom: string, bTo: string): boolean {
  return aFrom < bTo && bFrom < aTo;
}

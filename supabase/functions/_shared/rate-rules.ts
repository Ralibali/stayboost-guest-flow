// StayBoost: prislogik + tillgänglighetskontroller för datumstyrda regler.
// Ren TypeScript utan Deno-beroenden — delas av booking-engine, admin-UI
// och enhetstesterna. Server-side är enda sanningskälla vid faktisk bokning.

export type RateRuleKind =
  "price_override" | "price_multiplier" | "min_stay" | "closed" | "no_arrival" | "no_departure";

export interface RateRule {
  id: string;
  unit_id: string | null; // null = hela anläggningen
  kind: RateRuleKind;
  date_from: string; // ISO YYYY-MM-DD, inklusive
  date_to: string; // ISO YYYY-MM-DD, inklusive
  fixed_price: number | null;
  adult_prices?: number[] | null;
  pct_delta: number | null;
  min_stay: number | null;
  priority: number;
  active: boolean;
  name?: string | null;
}

/** True om datumet ligger i regelns [date_from, date_to] (båda inklusive). */
export function ruleCoversDate(rule: RateRule, iso: string): boolean {
  return rule.active && iso >= rule.date_from && iso <= rule.date_to;
}

/** Regler som gäller för given enhet (unit-scope eller property-scope). */
export function rulesForUnit(rules: RateRule[], unitId: string): RateRule[] {
  return rules.filter((r) => r.active && (r.unit_id === null || r.unit_id === unitId));
}

/** Högsta priority vinner. Vid lika priority: senast i listan (nyast). */
function pickWinner<T extends { priority: number }>(matches: T[]): T | null {
  if (matches.length === 0) return null;
  let winner = matches[0];
  for (let i = 1; i < matches.length; i++) {
    if (matches[i].priority >= winner.priority) winner = matches[i];
  }
  return winner;
}

/** Prisjustering för en natt baserat på regler. Returnerar { price, source }. */
export function applyPriceRules(
  basePrice: number,
  rules: RateRule[],
  unitId: string,
  iso: string,
  adults?: number,
): { price: number; source: "base" | "override" | "multiplier"; ruleId?: string } {
  const relevant = rulesForUnit(rules, unitId).filter((r) => ruleCoversDate(r, iso));
  const override = pickWinner(
    relevant.filter(
      (r) =>
        r.kind === "price_override" &&
        (r.fixed_price !== null || Boolean(adults && r.adult_prices?.length)),
    ),
  );
  if (override) {
    const adultPrice =
      adults && override.adult_prices?.length
        ? override.adult_prices[adults - 1]
        : override.fixed_price;
    if (adultPrice == null || !Number.isFinite(adultPrice) || adultPrice < 0)
      throw new Error("pricing_unavailable");
    return { price: adultPrice, source: "override", ruleId: override.id };
  }
  const mult = pickWinner(
    relevant.filter((r) => r.kind === "price_multiplier" && r.pct_delta !== null),
  );
  if (mult) {
    const adjusted = Math.round((basePrice * (1 + mult.pct_delta! / 100)) / 5) * 5;
    return { price: Math.max(0, adjusted), source: "multiplier", ruleId: mult.id };
  }
  return { price: basePrice, source: "base" };
}

/** Minsta vistelse från regler som berör någon natt i vistelsen. */
export function minStayFromRules(rules: RateRule[], unitId: string, nights: string[]): number {
  let ms = 0;
  const scoped = rulesForUnit(rules, unitId);
  for (const iso of nights) {
    for (const r of scoped) {
      if (r.kind === "min_stay" && r.min_stay !== null && ruleCoversDate(r, iso)) {
        if (r.min_stay > ms) ms = r.min_stay;
      }
    }
  }
  return ms;
}

export type AvailabilityIssue =
  | { kind: "closed"; date: string }
  | { kind: "no_arrival"; date: string }
  | { kind: "no_departure"; date: string };

/**
 * Kontrollera stängda datum + CTA/CTD för en given vistelse.
 * `nights` = datum för varje natt (checkin ... checkout-1).
 * `checkoutDate` = utcheckningsdatum (inte en "natt", men CTD gäller det).
 */
export function checkAvailabilityRules(
  rules: RateRule[],
  unitId: string,
  nights: string[],
  checkoutDate: string,
): AvailabilityIssue | null {
  const scoped = rulesForUnit(rules, unitId);
  if (nights.length === 0) return null;

  for (const iso of nights) {
    for (const r of scoped) {
      if (r.kind === "closed" && ruleCoversDate(r, iso)) {
        return { kind: "closed", date: iso };
      }
    }
  }
  const arrival = nights[0];
  for (const r of scoped) {
    if (r.kind === "no_arrival" && ruleCoversDate(r, arrival)) {
      return { kind: "no_arrival", date: arrival };
    }
  }
  for (const r of scoped) {
    if (r.kind === "no_departure" && ruleCoversDate(r, checkoutDate)) {
      return { kind: "no_departure", date: checkoutDate };
    }
  }
  return null;
}

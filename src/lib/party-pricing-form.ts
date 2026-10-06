import type { Unit } from "./supabase";

export type PartyPricingDraft = {
  enabled: boolean;
  adultPrices: string[];
  childPriceBasis: "per_night" | "per_booking";
  childPricePerNight: string;
  childPricePerBooking: string;
  freeAge: string;
  maxAge: string;
};

/** Keep both stored prices when changing basis; age thresholds are independent. */
export function partyPricingUpdate(unit: Pick<Unit, "adult_prices">, draft: PartyPricingDraft) {
  const adults = draft.adultPrices.map(Number);
  if (
    draft.enabled &&
    (draft.adultPrices.some((price) => !price.trim()) ||
      adults.some((price) => !Number.isSafeInteger(price) || price < 0 || price > 1000000))
  )
    throw new Error("Ange ett nattpris i hela kronor för varje vuxenantal.");
  const childAmounts = [draft.childPricePerNight, draft.childPricePerBooking];
  const free = Number(draft.freeAge);
  const max = Number(draft.maxAge);
  if (
    !["per_night", "per_booking"].includes(draft.childPriceBasis) ||
    childAmounts.some(
      (raw) =>
        !raw.trim() ||
        !Number.isSafeInteger(Number(raw)) ||
        Number(raw) < 0 ||
        Number(raw) > 1000000,
    ) ||
    !draft.freeAge.trim() ||
    !draft.maxAge.trim() ||
    !Number.isInteger(free) ||
    !Number.isInteger(max) ||
    free < 0 ||
    max > 17 ||
    free > max
  )
    throw new Error(
      "Kontrollera barnpris och åldersgränser. Gratisåldern får inte överstiga barnets högsta ålder.",
    );
  return {
    party_pricing_enabled: draft.enabled,
    adult_prices: draft.enabled ? adults : (unit.adult_prices ?? []),
    child_price_basis: draft.childPriceBasis,
    child_price_per_night: Number(draft.childPricePerNight),
    child_price_per_booking: Number(draft.childPricePerBooking),
    child_free_through_age: free,
    child_max_age: max,
  };
}

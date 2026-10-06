import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PartyPricing } from "../components/app/PartyPricing";
import { quoteStay } from "../../supabase/functions/_shared/pricing";
import { partyPricingUpdate, type PartyPricingDraft } from "./party-pricing-form";
import { childSupplementLabel } from "./party-i18n";
import type { Unit } from "./supabase";

const unit = {
  id: "tent",
  property_id: "property",
  max_guests: 4,
  party_pricing_enabled: true,
  adult_prices: [700, 1295, 2195, 2795],
  child_price_per_night: 77,
  child_price_basis: "per_booking",
  child_price_per_booking: 329,
  child_free_through_age: 5,
  child_max_age: 15,
} as Unit;
const draft: PartyPricingDraft = {
  enabled: true,
  adultPrices: ["700", "1295", "2195", "2795"],
  childPriceBasis: "per_booking",
  childPricePerNight: "77",
  childPricePerBooking: "329",
  freeAge: "5",
  maxAge: "15",
};

describe("owner child-price basis", () => {
  it("keeps both independent amounts and verified age thresholds when switching basis", () => {
    const once = partyPricingUpdate(unit, draft);
    const nightly = partyPricingUpdate(unit, { ...draft, childPriceBasis: "per_night" });
    expect(once).toMatchObject({
      child_price_per_booking: 329,
      child_price_per_night: 77,
      child_free_through_age: 5,
      child_max_age: 15,
    });
    expect(nightly).toEqual({ ...once, child_price_basis: "per_night" });
    const quote = (settings: typeof once) =>
      quoteStay(
        { base_price: 700, weekend_pct: 0, cleaning_fee: 0, monthly_mult: [], ...settings },
        "2027-06-01",
        "2027-06-03",
        { party: { adults: 1, childrenAges: [5, 6] } },
      );
    expect(quote(once)).toMatchObject({
      total: 1729,
      childrenSubtotal: 329,
      childrenPerBookingSubtotal: 329,
    });
    expect(quote(nightly)).toMatchObject({
      total: 1554,
      childrenSubtotal: 154,
      childrenPerBookingSubtotal: 0,
    });
  });

  it("does not activate person pricing or erase adult prices when saving disabled settings", () => {
    expect(partyPricingUpdate(unit, { ...draft, enabled: false, adultPrices: [""] })).toMatchObject(
      {
        party_pricing_enabled: false,
        adult_prices: unit.adult_prices,
        child_price_basis: "per_booking",
      },
    );
  });

  it.each(["", "-1", "1.5", "1000001", "NaN"])(
    "rejects invalid child amount %s even in the inactive basis",
    (amount) => {
      expect(() => partyPricingUpdate(unit, { ...draft, childPricePerNight: amount })).toThrow();
      expect(() => partyPricingUpdate(unit, { ...draft, childPricePerBooking: amount })).toThrow();
    },
  );

  it("rejects invalid age ranges and shows the selected stored amount with the correct basis", () => {
    expect(() => partyPricingUpdate(unit, { ...draft, freeAge: "16" })).toThrow();
    const html = renderToStaticMarkup(<PartyPricing unit={unit} onSaved={() => {}} />);
    expect(html).toContain(
      '<option value="per_booking" selected="">Per barn och vistelse (en gång)</option>',
    );
    expect(html).toContain("Barnpris · kr/barn/vistelse");
    expect(html).toContain('value="329"');
    expect(html).not.toContain('value="77"');
  });

  it("labels child totals as once per stay or all nights in every public language", () => {
    expect(childSupplementLabel("per_booking", 2, "sv")).toBe("Barntillägg · en gång per vistelse");
    expect(childSupplementLabel("per_booking", 2, "en")).toBe("Child supplement · once per stay");
    expect(childSupplementLabel("per_booking", 2, "de")).toBe(
      "Kinderzuschlag · einmal pro Aufenthalt",
    );
    expect(childSupplementLabel(undefined, 2, "sv")).toBe("Barntillägg · 2 nätter");
    expect(childSupplementLabel("per_night", 1, "en")).toBe("Child supplement · 1 night");
  });
});

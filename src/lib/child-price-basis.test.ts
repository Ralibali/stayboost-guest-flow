import { describe, expect, it } from "vitest";
import { partyIssue, quoteStay, type UnitPricing } from "../../supabase/functions/_shared/pricing";
import { priceAddons, type Addon } from "../../supabase/functions/_shared/addons";

// Synthetic age boundaries: this feature must not select a policy for the property.
const unit: UnitPricing = {
  base_price: 1995,
  weekend_pct: 0,
  cleaning_fee: 0,
  monthly_mult: [],
  party_pricing_enabled: true,
  adult_prices: [995, 1995, 2895, 3495],
  child_price_per_night: 329,
  child_price_per_booking: 329,
  child_price_basis: "per_booking",
  child_free_through_age: 1,
  child_max_age: 9,
};
const quote = (pricing = unit, childrenAges = [6]) =>
  quoteStay(pricing, "2027-05-31", "2027-06-02", { party: { adults: 2, childrenAges } });

describe("separate per-booking child price", () => {
  it("charges 329 once over two nights and keeps adult/night prices separate", () => {
    expect(quote()).toMatchObject({
      nights: 2,
      adultSubtotal: 3990,
      childrenSubtotal: 329,
      childrenPerBookingSubtotal: 329,
      childrenPriceBasis: "per_booking",
      subtotal: 4319,
      total: 4319,
    });
    expect(
      quote().nightly.map((n) => ({ price: n.price, adult: n.adultPrice, child: n.childPrice })),
    ).toEqual([
      { price: 1995, adult: 1995, child: 0 },
      { price: 1995, adult: 1995, child: 0 },
    ]);
  });
  it("preserves legacy/default nightly charges of 658 and ignores the unused once-per-stay amount", () => {
    for (const child_price_basis of [undefined, "per_night"] as const)
      expect(quote({ ...unit, child_price_basis, child_price_per_booking: 900 })).toMatchObject({
        childrenSubtotal: 658,
        childrenPerBookingSubtotal: 0,
        childrenPriceBasis: "per_night",
        total: 4648,
      });
    expect(quote({ ...unit, child_price_per_night: 900 }).total).toBe(4319);
  });
  it("charges zero for no/free children and one configured fee for each chargeable child", () => {
    expect(quote(unit, [])).toMatchObject({ childrenSubtotal: 0, total: 3990 });
    expect(quote(unit, [0, 1])).toMatchObject({ childrenSubtotal: 0, total: 3990 });
    expect(quote(unit, [2, 9])).toMatchObject({ childrenSubtotal: 658, total: 4648 });
    expect(quote({ ...unit, child_price_per_booking: 0 }, [6])).toMatchObject({
      childrenSubtotal: 0,
      total: 3990,
    });
  });
  it("counts all free and paid children toward capacity four", () => {
    expect(partyIssue(unit, { adults: 2, childrenAges: [0, 6] }, 4)).toBeNull();
    expect(partyIssue(unit, { adults: 2, childrenAges: [0, 1, 6] }, 4)).toBe("capacity_exceeded");
    expect(partyIssue(unit, { adults: 2, childrenAges: [10] }, 4)).toBe("invalid_party");
  });
  it("does not alter disabled party pricing, empty stays or apply adult seasonal multipliers to the child fee", () => {
    expect(quote({ ...unit, party_pricing_enabled: false }).total).toBe(3990);
    expect(
      quoteStay(unit, "2027-06-02", "2027-06-02", { party: { adults: 2, childrenAges: [6] } })
        .childrenPerBookingSubtotal,
    ).toBe(0);
    expect(quote({ ...unit, monthly_mult: Array(12).fill(200) })).toMatchObject({
      adultSubtotal: 7980,
      childrenSubtotal: 329,
      total: 8309,
    });
  });
  it.each([-1, 0.5, Infinity, 1000001])("rejects an invalid selected child amount %s", (amount) => {
    expect(() => quote({ ...unit, child_price_per_booking: amount })).toThrow(
      "pricing_unavailable",
    );
  });
});

describe("explicit manual child-price catalog roles", () => {
  const child: Addon = {
    id: "manual",
    name: "Synthetic manual fee",
    description: null,
    price: 329,
    price_type: "per_booking",
    image_url: null,
    active: true,
    sort_order: 1,
    pricing_role: "manual_child_price",
  };
  const extra: Addon = { ...child, id: "ordinary", pricing_role: "extra" };
  const selections = [
    { id: child.id, quantity: 1 },
    { id: extra.id, quantity: 1 },
  ];
  it("excludes only marked manual child prices on party-priced reservations", () => {
    const stay = {
      checkin: "2027-05-31",
      checkout: "2027-06-02",
      unitId: "tent",
      partyPricingEnabled: true,
    };
    expect(priceAddons(selections, [child, extra], 2, stay).map((p) => p.addon.id)).toEqual([
      "ordinary",
    ]);
    expect(
      priceAddons(selections, [child, extra], 2, { ...stay, partyPricingEnabled: false }),
    ).toHaveLength(2);
    expect(priceAddons(selections, [child, extra], 2)).toHaveLength(2);
    expect(
      priceAddons(
        [{ id: child.id, quantity: 1 }],
        [{ ...child, pricing_role: undefined }],
        2,
        stay,
      ),
    ).toHaveLength(1);
  });
});

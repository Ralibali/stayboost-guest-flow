import { describe, expect, it } from "vitest";
import {
  partyIssue,
  partySize,
  quoteStay,
  type UnitPricing,
} from "../../supabase/functions/_shared/pricing";
import type { RateRule } from "../../supabase/functions/_shared/rate-rules";
import { findAvailableStays, type SearchUnit } from "./booking-search";
import { collectPages } from "../../supabase/functions/_shared/pagination";

const unit: UnitPricing = {
  base_price: 1295,
  weekend_pct: 0,
  cleaning_fee: 100,
  monthly_mult: [],
  party_pricing_enabled: true,
  adult_prices: [700, 1295, 2195, 2795],
  child_price_per_night: 329,
  child_free_through_age: 3,
  child_max_age: 12,
};
const rule = (changes: Partial<RateRule>): RateRule => ({
  id: "season",
  unit_id: null,
  kind: "price_override",
  date_from: "2027-05-01",
  date_to: "2027-09-30",
  fixed_price: null,
  adult_prices: [995, 1995, 2895, 3495],
  pct_delta: null,
  min_stay: null,
  priority: 1,
  active: true,
  ...changes,
});

describe("configured adult and child prices", () => {
  it.each([
    [1, 700],
    [2, 1295],
    [3, 2195],
    [4, 2795],
  ])(
    "quotes %d adults at the configured price without enabling historic rates",
    (adults, price) => {
      const quote = quoteStay(unit, "2026-09-28", "2026-09-30", {
        party: { adults, childrenAges: [] },
      });
      expect(quote.subtotal).toBe(price * 2);
      expect(quote.total).toBe(price * 2 + 100);
    },
  );
  it("charges children per night, preserves free infants, and snapshots all guests", () => {
    const party = { adults: 2, childrenAges: [3, 4] };
    const quote = quoteStay(unit, "2026-09-28", "2026-09-30", { party });
    expect(partySize(party)).toBe(4);
    expect(quote).toMatchObject({
      nights: 2,
      adultSubtotal: 2590,
      childrenSubtotal: 658,
      subtotal: 3248,
      cleaningFee: 100,
      total: 3348,
      party,
    });
    expect(quote.nightly[0]).toMatchObject({ adultPrice: 1295, childPrice: 329, price: 1624 });
    party.childrenAges[0] = 9;
    expect(quote.party?.childrenAges).toEqual([3, 4]);
  });
  it("requires explicit opt-in and retains existing flat nightly quotes", () => {
    expect(
      quoteStay({ ...unit, party_pricing_enabled: false }, "2026-09-28", "2026-09-30").total,
    ).toBe(2690);
    expect(() => quoteStay(unit, "2026-09-28", "2026-09-30")).toThrow("invalid_party");
  });
  it.each([-1, 13, 2.5, NaN])("rejects invalid child age %s", (age) => {
    expect(partyIssue(unit, { adults: 1, childrenAges: [age] }, 4)).toBe("invalid_party");
  });
  it("includes free children in physical capacity and requires an adult", () => {
    expect(partyIssue(unit, { adults: 2, childrenAges: [0, 1, 2] }, 4)).toBe("capacity_exceeded");
    expect(partyIssue(unit, { adults: 0, childrenAges: [12] }, 4)).toBe("invalid_party");
  });
  it("honors seasonal adult tables with existing priority and property/unit scopes", () => {
    const party = { adults: 2, childrenAges: [12] };
    const rules = [
      rule({}),
      rule({ id: "unit", unit_id: "tent", priority: 2, adult_prices: [1100, 2100, 3100, 4100] }),
      rule({ id: "other", unit_id: "other", priority: 99, adult_prices: [1, 2, 3, 4] }),
    ];
    const quote = quoteStay(unit, "2027-06-01", "2027-06-03", { unitId: "tent", party, rules });
    expect(quote.adultSubtotal).toBe(4200);
    expect(quote.childrenSubtotal).toBe(658);
    expect(quote.nightly[0].ruleId).toBe("unit");
  });
  it("blocks incomplete seasonal adult tables instead of falling back to a flat amount", () => {
    expect(() =>
      quoteStay(unit, "2027-06-01", "2027-06-02", {
        party: { adults: 4, childrenAges: [] },
        rules: [rule({ adult_prices: [995, 1995], fixed_price: 500 })],
      }),
    ).toThrow("pricing_unavailable");
    expect(
      quoteStay(unit, "2027-06-01", "2027-06-02", {
        party: { adults: 4, childrenAges: [] },
        rules: [rule({ adult_prices: null, fixed_price: 500 })],
      }).subtotal,
    ).toBe(500);
  });
  it("applies percentage/month/weekend changes to adult accommodation and adds configured child supplements", () => {
    const pricing = { ...unit, weekend_pct: 20, monthly_mult: Array(12).fill(110) };
    const quote = quoteStay(pricing, "2026-09-25", "2026-09-26", {
      party: { adults: 1, childrenAges: [4] },
      rules: [
        rule({
          kind: "price_multiplier",
          date_from: "2026-01-01",
          date_to: "2026-12-31",
          pct_delta: 10,
        }),
      ],
    });
    expect(quote.nightly[0]).toMatchObject({
      adultPrice: 1020,
      childPrice: 329,
      price: 1349,
      source: "multiplier",
    });
  });
  it("does not apply adult-only rules to flat-rate accommodation", () => {
    const quote = quoteStay({ ...unit, party_pricing_enabled: false }, "2027-06-01", "2027-06-02", {
      rules: [rule({})],
    });
    expect(quote.subtotal).toBe(1295);
  });
});

describe("search prices match the selected party", () => {
  const searchUnit: SearchUnit = {
    id: "tent",
    name: "Tält",
    maxGuests: 4,
    minStay: 1,
    basePrice: 1295,
    weekendPct: 0,
    cleaningFee: 100,
    monthlyMult: [],
    booked: [],
    rateRules: [],
    partyPricingEnabled: true,
    adultPrices: [700, 1295, 2195, 2795],
    childPricePerNight: 329,
    childFreeThroughAge: 3,
    childMaxAge: 12,
  };
  const search = {
    checkin: "2026-09-28",
    nights: 2,
    guests: 4,
    today: "2026-09-28",
    availableThrough: "2027-09-28",
    maxStay: 14,
    bookingEnabled: true,
    party: { adults: 2, childrenAges: [3, 4] },
  };
  it("quotes the same total as checkout and excludes smaller tents", () => {
    const result = findAvailableStays(
      [searchUnit, { ...searchUnit, id: "small", maxGuests: 2 }],
      search,
    );
    expect(result.exact).toHaveLength(1);
    expect(result.exact[0]).toMatchObject({ unitId: "tent", total: 3348 });
  });
  it("offers no dates until child ages and adult prices are valid", () => {
    expect(
      findAvailableStays([searchUnit], { ...search, party: { adults: 2, childrenAges: [-1] } })
        .exact,
    ).toEqual([]);
    expect(findAvailableStays([{ ...searchUnit, adultPrices: [] }], search).exact).toEqual([]);
  });
});

describe("public availability pagination", () => {
  it("keeps occupied dates beyond the default 1000-row cap", async () => {
    const source = Array.from({ length: 2003 }, (_, id) => ({ id }));
    const ranges: number[][] = [];
    const result = await collectPages(async (from, to) => {
      ranges.push([from, to]);
      return { data: source.slice(from, to + 1), error: null };
    });
    expect(result).toHaveLength(2003);
    expect(result.at(-1)).toEqual({ id: 2002 });
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });
  it("fails closed when any page cannot be read", async () => {
    await expect(
      collectPages(
        async (from) =>
          from === 0 ? { data: [1, 2], error: null } : { data: null, error: "offline" },
        2,
      ),
    ).rejects.toThrow("page_unavailable");
  });
});

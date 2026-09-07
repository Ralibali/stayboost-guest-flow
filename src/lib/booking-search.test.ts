import { describe, expect, it } from "vitest";
import { findAvailableStays, type SearchUnit, type StaySearch } from "./booking-search";
import type { RateRule } from "../../supabase/functions/_shared/rate-rules";
const unit: SearchUnit = {
  id: "tent",
  name: "Tält",
  maxGuests: 4,
  minStay: 1,
  basePrice: 1000,
  weekendPct: 0,
  cleaningFee: 200,
  monthlyMult: [],
  booked: [],
  rateRules: [],
};
const search: StaySearch = {
  checkin: "2026-09-12",
  nights: 2,
  guests: 4,
  today: "2026-09-07",
  availableThrough: "2027-09-07",
  maxStay: 30,
  bookingEnabled: true,
};
const rule = (kind: RateRule["kind"], from = "2026-09-12", to = "2026-09-13"): RateRule => ({
  id: kind,
  unit_id: null,
  kind,
  date_from: from,
  date_to: to,
  active: true,
  fixed_price: null,
  pct_delta: null,
  min_stay: null,
  priority: 1,
});
describe("available stays", () => {
  it("quotes the entire stay including cleaning using rate rules", () => {
    const r = findAvailableStays(
      [{ ...unit, rateRules: [{ ...rule("price_override"), fixed_price: 1500 }] }],
      search,
    );
    expect(r.exact[0]).toMatchObject({ checkout: "2026-09-14", total: 3200 });
    expect(r.nearby).toEqual([]);
  });
  it("keeps party size and duration when finding three nearest dates", () => {
    const r = findAvailableStays(
      [
        { ...unit, booked: [{ from: "2026-09-12", to: "2026-09-14" }] },
        { ...unit, id: "small", maxGuests: 2 },
      ],
      search,
    );
    expect(r.exact).toEqual([]);
    expect(r.nearby.map((s) => s.checkin)).toEqual(["2026-09-14", "2026-09-10", "2026-09-15"]);
    expect(r.nearby.every((s) => s.nights === 2 && s.unitId === "tent")).toBe(true);
  });
  it.each(["closed", "no_arrival", "no_departure"] as const)("respects %s", (kind) => {
    const rules = [rule(kind, "2026-09-12", "2026-09-14")];
    expect(findAvailableStays([{ ...unit, rateRules: rules }], search).exact).toEqual([]);
  });
  it("honors unit and date-specific min stay", () => {
    expect(findAvailableStays([{ ...unit, minStay: 3 }], search).nearby).toEqual([]);
    expect(
      findAvailableStays([{ ...unit, rateRules: [{ ...rule("min_stay"), min_stay: 3 }] }], search)
        .exact,
    ).toEqual([]);
  });
  it("permits arrival when a previous booking checks out", () => {
    expect(
      findAvailableStays([{ ...unit, booked: [{ from: "2026-09-10", to: "2026-09-12" }] }], search)
        .exact,
    ).toHaveLength(1);
  });
  it("never proposes unavailable, paused, past, invalid or excessive dates", () => {
    for (const change of [
      { bookingEnabled: false },
      { checkin: "2026-02-30" },
      { checkin: "2026-09-01" },
      { nights: 31 },
      { nights: 0 },
      { guests: 0 },
      { maxStay: 1 },
    ])
      expect(findAvailableStays([unit], { ...search, ...change })).toEqual({
        exact: [],
        nearby: [],
      });
    const r = findAvailableStays([unit], { ...search, availableThrough: "2026-09-13" });
    expect(r.exact).toEqual([]);
    expect(r.nearby.every((s) => s.checkin >= search.today && s.checkout <= "2026-09-13")).toBe(
      true,
    );
  });
});

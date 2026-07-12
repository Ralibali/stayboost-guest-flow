import { describe, expect, it } from "vitest";
import {
  FALLBACK_STATS,
  computeDerived,
  formatInt,
  formatPercent,
  formatSek,
  formatUpdatedAt,
  parseStatsResponse,
  type StayBoostStats,
} from "./stats";

const VALID_RESPONSE = {
  bookings2026: 120,
  uniqueGuests: 101,
  guestNights: 147,
  bookingValueSek: 252632,
  paidAddonOrders: 19,
  paidAddonRevenueSek: 7482,
  avgPaidAddonSek: 394,
  prearrivalMessages: { sent: 51, total: 120 },
  digitalCheckIns: 62,
  breakfastDeliveries: { done: 17, total: 17 },
  sms: { sent: 34, total: 40 },
  traffic: { pageViews: 12217, sessions: 774, clickEvents: 8515 },
  addonDistribution: [
    { slug: "breakfast", name: "Frukost", orders: 10, units: 25, revenue: 5205 },
    { slug: "late_checkout", name: "Sen utcheckning", orders: 3, units: 3, revenue: 1200 },
    { slug: "sup_rental", name: "SUP-uthyrning", orders: 4, units: 5, revenue: 500 },
    { slug: "early_checkin", name: "Tidig incheckning", orders: 1, units: 1, revenue: 399 },
    { slug: "fika_bag", name: "Fikapåse", orders: 1, units: 2, revenue: 178 },
  ],
  updatedAt: "2026-07-12T21:43:52.959Z",
};

describe("parseStatsResponse", () => {
  it("accepts a well-formed response", () => {
    const parsed = parseStatsResponse(VALID_RESPONSE);
    expect(parsed).not.toBeNull();
    expect(parsed?.bookings2026).toBe(120);
    expect(parsed?.addonDistribution).toHaveLength(5);
    expect(parsed?.breakfastDeliveries).toEqual({ done: 17, total: 17 });
  });

  it("accepts legacy breakfastDeliveries with 'sent' field", () => {
    const legacy = {
      ...VALID_RESPONSE,
      breakfastDeliveries: { sent: 9, total: 12 },
    };
    const parsed = parseStatsResponse(legacy);
    expect(parsed?.breakfastDeliveries).toEqual({ done: 9, total: 12 });
  });

  it("rejects null and non-objects", () => {
    expect(parseStatsResponse(null)).toBeNull();
    expect(parseStatsResponse("nope")).toBeNull();
    expect(parseStatsResponse(42)).toBeNull();
    expect(parseStatsResponse([])).toBeNull();
  });

  it("rejects missing required fields", () => {
    const { bookings2026: _drop, ...rest } = VALID_RESPONSE;
    expect(parseStatsResponse(rest)).toBeNull();
  });

  it("rejects negative or non-integer numbers", () => {
    expect(parseStatsResponse({ ...VALID_RESPONSE, bookings2026: -1 })).toBeNull();
    expect(parseStatsResponse({ ...VALID_RESPONSE, bookingValueSek: Number.NaN })).toBeNull();
  });

  it("rejects malformed addon rows", () => {
    const bad = {
      ...VALID_RESPONSE,
      addonDistribution: [{ slug: "x", name: "X", orders: "many", units: 1, revenue: 10 }],
    };
    expect(parseStatsResponse(bad)).toBeNull();
  });

  it("rejects invalid nested traffic shape", () => {
    const bad = {
      ...VALID_RESPONSE,
      traffic: { pageViews: 1, sessions: 1 },
    };
    expect(parseStatsResponse(bad)).toBeNull();
  });
});

describe("computeDerived", () => {
  it("computes shares and averages from live-shaped data", () => {
    const stats = parseStatsResponse(VALID_RESPONSE) as StayBoostStats;
    const d = computeDerived(stats);
    // 19 / 120 ≈ 0.1583
    expect(d.addonShareOfBookings).toBeCloseTo(19 / 120, 4);
    // breakfast 5205 / 7482 ≈ 0.6957
    expect(d.breakfastShareOfAddons).toBeCloseTo(5205 / 7482, 4);
    expect(d.avgPaidAddonSek).toBe(394);
    expect(d.maxAddonRevenue).toBe(5205);
  });

  it("falls back safely when totals are zero", () => {
    const empty: StayBoostStats = {
      ...FALLBACK_STATS,
      bookings2026: 0,
      paidAddonOrders: 0,
      paidAddonRevenueSek: 0,
      avgPaidAddonSek: 0,
      addonDistribution: [],
    };
    const d = computeDerived(empty);
    expect(d.addonShareOfBookings).toBe(0);
    expect(d.breakfastShareOfAddons).toBe(0);
    expect(d.avgPaidAddonSek).toBe(0);
    expect(d.maxAddonRevenue).toBe(1); // undviker div-by-zero i UI
  });

  it("derives avgPaidAddon from revenue/orders when API returns 0", () => {
    const stats: StayBoostStats = {
      ...FALLBACK_STATS,
      avgPaidAddonSek: 0,
      paidAddonOrders: 4,
      paidAddonRevenueSek: 1000,
    };
    expect(computeDerived(stats).avgPaidAddonSek).toBe(250);
  });
});

describe("formatting (sv-SE)", () => {
  it("formats integers with space thousands separator", () => {
    expect(formatInt(12217)).toBe("12 217");
    expect(formatInt(252632)).toBe("252 632");
    expect(formatInt(0)).toBe("0");
  });

  it("formats SEK with 'kr' suffix", () => {
    expect(formatSek(8318)).toBe("8 318 kr");
    expect(formatSek(0)).toBe("0 kr");
  });

  it("formats percent with comma as decimal separator", () => {
    expect(formatPercent(0.1667)).toBe("16,7 %");
    expect(formatPercent(0.5, 0)).toBe("50 %");
  });

  it("formats ISO datetime in Swedish", () => {
    const out = formatUpdatedAt("2026-07-12T21:43:52.959Z");
    expect(out).toMatch(/2026/);
    expect(out).not.toBe("–");
  });

  it("returns '–' for invalid input", () => {
    expect(formatUpdatedAt("not-a-date")).toBe("–");
    expect(formatInt(Number.NaN)).toBe("–");
  });
});

describe("FALLBACK_STATS", () => {
  it("passes its own validator", () => {
    expect(parseStatsResponse(FALLBACK_STATS)).not.toBeNull();
  });

  it("shows non-zero core numbers so the UI never renders zeros", () => {
    expect(FALLBACK_STATS.bookings2026).toBeGreaterThan(0);
    expect(FALLBACK_STATS.paidAddonRevenueSek).toBeGreaterThan(0);
    expect(FALLBACK_STATS.addonDistribution.length).toBeGreaterThan(0);
  });
});

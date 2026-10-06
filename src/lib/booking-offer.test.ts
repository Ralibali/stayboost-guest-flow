import { describe, expect, it, vi } from "vitest";
import { quoteStay } from "../../supabase/functions/_shared/pricing";
import {
  BookingOfferError,
  bookingAddonAvailable,
  bookingAddonAvailableForUnit,
  bookingDatesAvailable,
  bookingOfferNeedsRefresh,
  fetchBookingOffer,
  reconcileBookingAddonQuantities,
  type EngineAddon,
  type EngineData,
} from "./booking-offer";

const offer = (): EngineData => ({
  property: {
    name: "Glamping",
    slug: "glamping",
    bookingEnabled: true,
    maxStay: 30,
    checkinTime: "15:00",
    checkoutTime: "11:00",
    contactEmail: null,
    swishNumber: null,
    stripeAvailable: true,
    availableThrough: "2027-10-05",
  },
  units: [
    {
      id: "tent",
      name: "Tent",
      description: null,
      imageUrl: null,
      maxGuests: 4,
      bedDescription: null,
      sizeSqm: null,
      amenities: [],
      basePrice: 1500,
      weekendPct: 0,
      minStay: 1,
      cleaningFee: 0,
      monthlyMult: Array(12).fill(100),
      booked: [],
      rateRules: [],
    },
  ],
  addons: [],
});

describe("reconciling extras when accommodation changes", () => {
  const base: EngineAddon = {
    id: "breakfast",
    name: "Breakfast",
    description: null,
    price: 120,
    priceType: "per_booking",
    imageUrl: null,
    availableFrom: null,
    availableTo: null,
    maxQuantity: 4,
  };
  const catalog: EngineAddon[] = [
    base,
    { ...base, id: "pets", allowedUnitIds: ["tent-3"] },
    { ...base, id: "all", allowedUnitIds: null },
    { ...base, id: "unmapped", allowedUnitIds: [] },
  ];
  const change = (selected: Record<string, number>, unitId: string | null, addons = catalog) =>
    reconcileBookingAddonQuantities(addons, selected, "2027-07-01", "2027-07-03", unitId);

  it("removes pets when leaving its allowed tent without restoring them on a later return", () => {
    const tent3 = change({ breakfast: 2, pets: 1, all: 1, unmapped: 1 }, "tent-3");
    expect(tent3).toEqual({ breakfast: 2, pets: 1, all: 1 });
    const tent1 = change(tent3, "tent-1");
    expect(tent1).toEqual({ breakfast: 2, all: 1 });
    expect(change(tent1, "tent-3")).toEqual({ breakfast: 2, all: 1 });
  });

  it("removes a stale choice when refreshed settings restrict it to another tent", () => {
    const original = [{ ...base, id: "pets" }];
    expect(change({ pets: 1 }, "tent-1", original)).toEqual({ pets: 1 });
    expect(change({ pets: 1 }, "tent-1", catalog)).toEqual({});
  });

  it("fails closed for restricted extras when the selected accommodation disappears", () => {
    expect(change({ pets: 1, breakfast: 2 }, null)).toEqual({ breakfast: 2 });
    expect(change({ pets: 1, breakfast: 2 }, "replacement-tent")).toEqual({ breakfast: 2 });
  });
});
const total = (data: EngineData) => {
  const unit = data.units[0];
  return quoteStay(
    {
      base_price: unit.basePrice,
      weekend_pct: unit.weekendPct,
      cleaning_fee: unit.cleaningFee,
      monthly_mult: unit.monthlyMult,
    },
    "2027-05-10",
    "2027-05-12",
    { rules: unit.rateRules, unitId: unit.id },
  ).total;
};

describe("recovering an outdated booking offer", () => {
  it("removes unavailable extras and caps their selected quantity after a refresh", () => {
    const baseAddon = {
      name: "Breakfast",
      description: null,
      price: 120,
      priceType: "per_booking" as const,
      imageUrl: null,
      availableFrom: null,
      availableTo: null,
      maxQuantity: 2,
    };
    const addons = [
      { ...baseAddon, id: "breakfast" },
      { ...baseAddon, id: "seasonal", availableTo: "2027-04-30" },
    ];
    expect(
      reconcileBookingAddonQuantities(
        addons,
        { breakfast: 4, seasonal: 1, removed: 2 },
        "2027-05-10",
        "2027-05-12",
      ),
    ).toEqual({ breakfast: 2 });
  });
  it("replaces the old total with current server prices before a second attempt", async () => {
    const original = offer();
    const updated = offer();
    updated.units[0].basePrice = 1750;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(original)))
      .mockResolvedValueOnce(new Response(JSON.stringify(updated)));
    let current = await fetchBookingOffer("https://example.test", "glamping", undefined, fetcher);
    expect(total(current)).toBe(3000);

    const rejection = { error: "price_changed", grandTotal: 3500 };
    if (bookingOfferNeedsRefresh(rejection.error))
      current = await fetchBookingOffer("https://example.test", "glamping", undefined, fetcher);

    expect(total(current)).toBe(rejection.grandTotal);
    expect(bookingDatesAvailable(current.units[0], "2027-05-10", "2027-05-12")).toBe(true);
    expect(fetcher.mock.calls[1][1]?.cache).toBe("no-store");
  });

  it("invalidates selected dates when another guest books during checkout", async () => {
    const original = offer();
    expect(bookingDatesAvailable(original.units[0], "2027-05-10", "2027-05-12")).toBe(true);
    const updated = offer();
    updated.units[0].booked = [{ from: "2027-05-11", to: "2027-05-13" }];
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(updated)));
    expect(bookingOfferNeedsRefresh("unavailable")).toBe(true);
    const current = await fetchBookingOffer("https://example.test", "glamping", undefined, fetcher);
    expect(bookingDatesAvailable(current.units[0], "2027-05-10", "2027-05-12")).toBe(false);
    expect(bookingDatesAvailable(current.units[0], "2027-05-13", "2027-05-15")).toBe(true);
  });

  it.each(["closed", "no_arrival", "no_departure"] as const)(
    "revalidates refreshed %s restrictions",
    (kind) => {
      const current = offer();
      current.units[0].rateRules = [
        {
          id: "rule",
          unit_id: "tent",
          kind,
          active: true,
          date_from: kind === "no_departure" ? "2027-05-12" : "2027-05-10",
          date_to: "2027-05-12",
          priority: 1,
          fixed_price: null,
          pct_delta: null,
          min_stay: null,
        },
      ];
      expect(bookingOfferNeedsRefresh(kind)).toBe(true);
      expect(bookingDatesAvailable(current.units[0], "2027-05-10", "2027-05-12")).toBe(false);
    },
  );

  it("fails closed when the fresh offer cannot be verified", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ units: [] })));
    await expect(
      fetchBookingOffer("https://example.test", "glamping", undefined, fetcher),
    ).rejects.toMatchObject({ kind: "temporary" });
  });

  it("retains the host contact when channels become unavailable during checkout", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "channel_sync_required",
          property: { contactEmail: "host@example.test" },
        }),
        { status: 503 },
      ),
    );
    await expect(
      fetchBookingOffer("https://example.test", "glamping", undefined, fetcher),
    ).rejects.toEqual(new BookingOfferError("channel", "host@example.test"));
  });

  it.each(["invalid_phone", "terms_required", "email_required", "stripe_failed", "rate_limited"])(
    "keeps the offer when %s does not report a stale quote",
    (error) => {
      expect(bookingOfferNeedsRefresh(error)).toBe(false);
    },
  );
});

describe("manual child-price choices", () => {
  const addon: EngineAddon = {
    id: "child",
    name: "Any name",
    description: null,
    price: 329,
    priceType: "per_booking",
    imageUrl: null,
    availableFrom: null,
    availableTo: null,
    maxQuantity: 10,
    pricingRole: "manual_child_price",
  };
  const reconcile = (selected: Record<string, number>, enabled: boolean, catalog = [addon]) =>
    reconcileBookingAddonQuantities(catalog, selected, "2027-07-01", "2027-07-03", "tent", enabled);
  it("hides and removes manual child prices when switching to person pricing and does not restore a hidden selection", () => {
    expect(bookingAddonAvailable(addon, "2027-07-01", "2027-07-03", "tent", false)).toBe(true);
    expect(bookingAddonAvailable(addon, "2027-07-01", "2027-07-03", "tent", true)).toBe(false);
    const previous = reconcile({ child: 2 }, false);
    const next = reconcile(previous, true);
    expect(next).toEqual({});
    expect(reconcile(next, false)).toEqual({});
  });
  it("removes a stale selected addon when the refreshed catalog gains an explicit role, without inferring from names", () => {
    const legacy = { ...addon, pricingRole: undefined, name: "Barnpris" };
    expect(reconcile({ child: 1 }, true, [legacy])).toEqual({ child: 1 });
    expect(reconcile({ child: 1 }, true)).toEqual({});
    expect(reconcile({ child: 1 }, true, [{ ...addon, pricingRole: "extra" }])).toEqual({
      child: 1,
    });
  });
});

it("keeps dated choices during offer reload scope checks, while full stay validation still enforces dates", () => {
  const seasonal: EngineAddon = {
    id: "breakfast",
    name: "Breakfast",
    description: null,
    price: 209,
    priceType: "per_night",
    imageUrl: null,
    availableFrom: "2027-06-01",
    availableTo: "2027-08-31",
    maxQuantity: 4,
    allowedUnitIds: ["tent"],
    pricingRole: "extra",
  };
  expect(bookingAddonAvailableForUnit(seasonal, "tent", true)).toBe(true);
  expect(bookingAddonAvailable(seasonal, "2027-06-05", "2027-06-07", "tent", true)).toBe(true);
  expect(bookingAddonAvailable(seasonal, "2027-05-05", "2027-05-07", "tent", true)).toBe(false);
  expect(bookingAddonAvailableForUnit(seasonal, "other-tent", true)).toBe(false);
  expect(
    bookingAddonAvailableForUnit({ ...seasonal, pricingRole: "manual_child_price" }, "tent", true),
  ).toBe(false);
});

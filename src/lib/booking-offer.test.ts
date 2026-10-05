import { describe, expect, it, vi } from "vitest";
import { quoteStay } from "../../supabase/functions/_shared/pricing";
import {
  BookingOfferError,
  bookingDatesAvailable,
  bookingOfferNeedsRefresh,
  fetchBookingOffer,
  reconcileBookingAddonQuantities,
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

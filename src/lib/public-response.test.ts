import { describe, expect, it } from "vitest";
import { isBookingEngineResponse, isGuestResponse } from "./public-response";

const guest = {
  bookingStatus: "confirmed",
  guestName: "Example Guest",
  checkinDate: "2026-10-01",
  checkoutDate: "2026-10-03",
  property: {
    name: "Glamping",
    checkin_time: "15:00",
    checkout_time: "11:00",
    contact_phone: null,
  },
  unit: null,
  payment: { method: "swish", status: "pending", amount: 3348, ref: "SB-123", expiresAt: null },
};
const engine = {
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
  },
  units: [
    {
      id: "unit",
      name: "Tent",
      description: null,
      imageUrl: null,
      maxGuests: 4,
      bedDescription: null,
      sizeSqm: null,
      amenities: [],
      basePrice: 1000,
      weekendPct: 0,
      minStay: 1,
      cleaningFee: 0,
      monthlyMult: [],
      booked: [],
      rateRules: [],
    },
  ],
  addons: [],
};

describe("public API response resilience", () => {
  it.each([null, [], {}, "unexpected proxy response", { property: [] }])(
    "rejects malformed successful payload %j",
    (value) => {
      expect(isGuestResponse(value)).toBe(false);
      expect(isBookingEngineResponse(value)).toBe(false);
    },
  );
  it("accepts the guest contract, including optional fields from earlier deployments", () => {
    expect(isGuestResponse(guest)).toBe(true);
    expect(isGuestResponse({ ...guest, addons: [] })).toBe(true);
  });
  it("rejects fields that would crash the guest renderer on refresh", () => {
    expect(isGuestResponse({ ...guest, property: null })).toBe(false);
    expect(isGuestResponse({ ...guest, payment: { ...guest.payment, amount: {} } })).toBe(false);
    expect(isGuestResponse({ ...guest, addons: {} })).toBe(false);
    expect(isGuestResponse({ ...guest, unit: { name: "Tent", door_code: {} } })).toBe(false);
  });
  it("accepts the booking contract and properties with no available accommodation", () => {
    expect(isBookingEngineResponse(engine)).toBe(true);
    expect(isBookingEngineResponse({ ...engine, units: [] })).toBe(true);
  });
  it("validates unit restrictions while preserving legacy and empty-selection semantics", () => {
    const addon = {
      id: "pets",
      name: "Pets",
      description: null,
      imageUrl: null,
      price: 295,
      priceType: "per_booking",
      maxQuantity: 1,
      availableFrom: null,
      availableTo: null,
    };
    const response = (allowedUnitIds: unknown) => ({
      ...engine,
      addons: [{ ...addon, allowedUnitIds }],
    });
    for (const allowed of [undefined, null, [], ["tent-3"]])
      expect(isBookingEngineResponse(response(allowed))).toBe(true);
    for (const invalid of ["tent-3", {}, [null], [1], [""], ["  "]])
      expect(isBookingEngineResponse(response(invalid))).toBe(false);
  });
  it("rejects malformed addon translations or VAT before public rendering", () => {
    const addon = {
      id: "extra",
      name: "Extra",
      price: 100,
      priceType: "per_booking",
      maxQuantity: 1,
    };
    const response = (patch: object) => ({ ...engine, addons: [{ ...addon, ...patch }] });
    expect(
      isBookingEngineResponse(
        response({
          contentTranslations: { en: { name: "Full name", description: " Full text\n " } },
          vatRate: 12,
        }),
      ),
    ).toBe(true);
    for (const vatRate of [6, "12", false, {}])
      expect(isBookingEngineResponse(response({ vatRate }))).toBe(false);
    for (const contentTranslations of [
      [],
      { fr: { name: "Name", description: null } },
      { en: { name: "Name", description: null, source_id: "private" } },
    ])
      expect(isBookingEngineResponse(response({ contentTranslations }))).toBe(false);
  });
  it("validates optional localized content and the public gallery without accepting source metadata", () => {
    const content = { en: { name: " Tent ", description: " Full text\n\nSecond paragraph. " } };
    const gallery = [
      { id: "photo", url: "https://project.supabase.co/photo.jpg", altText: "View" },
    ];
    const response = (patch: object) => ({ ...engine, units: [{ ...engine.units[0], ...patch }] });
    expect(isBookingEngineResponse(response({ contentTranslations: content, gallery }))).toBe(true);
    expect(
      isBookingEngineResponse(
        response({ contentTranslations: { en: { ...content.en, private: "secret" } } }),
      ),
    ).toBe(false);
    expect(
      isBookingEngineResponse(response({ gallery: [{ ...gallery[0], source_url: "secret" }] })),
    ).toBe(false);
    expect(
      isBookingEngineResponse(
        response({ gallery: [{ ...gallery[0], url: "javascript:alert(1)" }] }),
      ),
    ).toBe(false);
  });
  it("rejects malformed availability and catalog arrays before rendering", () => {
    expect(isBookingEngineResponse({ ...engine, addons: null })).toBe(false);
    for (const field of ["booked", "rateRules", "monthlyMult", "amenities"])
      expect(
        isBookingEngineResponse({ ...engine, units: [{ ...engine.units[0], [field]: {} }] }),
      ).toBe(false);
    expect(isBookingEngineResponse({ ...engine, units: [{ ...engine.units[0], name: {} }] })).toBe(
      false,
    );
    expect(
      isBookingEngineResponse({ ...engine, property: { ...engine.property, maxStay: "30" } }),
    ).toBe(false);
  });
});

describe("child pricing public contract", () => {
  const withUnit = (fields: object) => ({ ...engine, units: [{ ...engine.units[0], ...fields }] });
  it("accepts both bases and omitted legacy fields, but rejects malformed pricing data", () => {
    expect(isBookingEngineResponse(engine)).toBe(true);
    for (const childPriceBasis of ["per_night", "per_booking"])
      expect(
        isBookingEngineResponse(
          withUnit({
            childPriceBasis,
            childPricePerBooking: 329,
            childPricePerNight: 77,
            partyPricingEnabled: true,
          }),
        ),
      ).toBe(true);
    for (const childPriceBasis of [null, "once", {}, 1, ["per_booking"]])
      expect(isBookingEngineResponse(withUnit({ childPriceBasis }))).toBe(false);
    for (const childPricePerBooking of [null, "329", -1, 0.5, 1000001, Infinity])
      expect(isBookingEngineResponse(withUnit({ childPricePerBooking }))).toBe(false);
    expect(isBookingEngineResponse(withUnit({ partyPricingEnabled: "false" }))).toBe(false);
  });
  it("accepts only explicit known addon roles or the legacy omission", () => {
    const response = (pricingRole: unknown) => ({
      ...engine,
      addons: [
        {
          id: "child",
          name: "Child",
          price: 329,
          priceType: "per_booking",
          maxQuantity: 1,
          pricingRole,
        },
      ],
    });
    for (const role of [undefined, "extra", "manual_child_price"])
      expect(isBookingEngineResponse(response(role))).toBe(true);
    for (const role of [null, "child", {}, 0, ["manual_child_price"]])
      expect(isBookingEngineResponse(response(role))).toBe(false);
  });
});

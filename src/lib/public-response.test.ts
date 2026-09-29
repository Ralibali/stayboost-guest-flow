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

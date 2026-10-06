import { isBookingEngineResponse } from "./public-response";
import type { AddonTranslations, VatRate } from "../../supabase/functions/_shared/addon-content";
import type {
  PublicUnitImage,
  UnitTranslations,
} from "../../supabase/functions/_shared/unit-content";
import { rangesOverlap } from "../../supabase/functions/_shared/pricing";
import { checkAvailabilityRules, type RateRule } from "../../supabase/functions/_shared/rate-rules";
import { nightsBetween } from "../../supabase/functions/_shared/pricing";
import {
  addonAvailableForStay,
  addonAvailableForUnit,
} from "../../supabase/functions/_shared/addons";

export type EngineUnit = {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  contentTranslations?: UnitTranslations;
  gallery?: PublicUnitImage[];
  maxGuests: number;
  bedDescription: string | null;
  sizeSqm: number | null;
  amenities: string[];
  basePrice: number;
  weekendPct: number;
  minStay: number;
  cleaningFee: number;
  monthlyMult: number[];
  booked: { from: string; to: string }[];
  rateRules: RateRule[];
  partyPricingEnabled?: boolean;
  adultPrices?: number[];
  childPricePerNight?: number;
  childFreeThroughAge?: number;
  childMaxAge?: number;
};

export type EngineAddon = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  priceType: "per_booking" | "per_night";
  imageUrl: string | null;
  availableFrom: string | null;
  availableTo: string | null;
  maxQuantity: number;
  fulfillmentType?: "arrival" | "each_morning" | "departure";
  allowedUnitIds?: string[] | null;
  contentTranslations?: AddonTranslations;
  vatRate?: VatRate | null;
};

export type EngineData = {
  property: {
    bookingEnabled: boolean;
    maxStay: number;
    contactEmail: string | null;
    bookingTermsUrl?: string | null;
    name: string;
    slug: string;
    checkinTime: string;
    checkoutTime: string;
    swishNumber: string | null;
    stripeAvailable: boolean;
    availableThrough?: string;
  };
  units: EngineUnit[];
  addons: EngineAddon[];
};

export class BookingOfferError extends Error {
  constructor(
    public kind: "notfound" | "temporary" | "channel",
    public contactEmail: string | null = null,
  ) {
    super(kind);
  }
}

/** Never reuse a cached offer after the server rejects its price or inventory. */
export async function fetchBookingOffer(
  baseUrl: string,
  slug: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<EngineData> {
  const response = await fetcher(
    `${baseUrl}/functions/v1/booking-engine?slug=${encodeURIComponent(slug)}`,
    {
      cache: "no-store",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
        : AbortSignal.timeout(20000),
    },
  );
  if (response.status === 404) throw new BookingOfferError("notfound");
  const payload = await response.json();
  if (!response.ok)
    throw new BookingOfferError(
      payload?.error === "channel_sync_required" ? "channel" : "temporary",
      typeof payload?.property?.contactEmail === "string" ? payload.property.contactEmail : null,
    );
  if (!isBookingEngineResponse(payload)) throw new BookingOfferError("temporary");
  return payload as EngineData;
}

export function bookingOfferNeedsRefresh(error: unknown): boolean {
  return [
    "price_changed",
    "unavailable",
    "closed",
    "no_arrival",
    "no_departure",
    "min_stay",
    "too_long",
    "outside_booking_window",
    "past_checkin",
    "invalid_addons",
    "capacity_exceeded",
    "pricing_unavailable",
    "payment_method_unavailable",
    "unit_not_found",
    "booking_paused",
    "channel_sync_required",
    "channel_sync_in_progress",
  ].includes(String(error));
}

/** A previously selected range must remain bookable after an offer refresh. */
export function bookingDatesAvailable(
  unit: EngineUnit,
  checkin: string,
  checkout: string,
): boolean {
  const nights = nightsBetween(checkin, checkout);
  return (
    nights.length > 0 &&
    !unit.booked.some((range) => rangesOverlap(checkin, checkout, range.from, range.to)) &&
    !checkAvailabilityRules(unit.rateRules ?? [], unit.id, nights, checkout)
  );
}

export function reconcileBookingAddonQuantities(
  addons: EngineAddon[],
  selected: Record<string, number>,
  checkin: string,
  checkout: string,
  unitId?: string | null,
): Record<string, number> {
  return Object.fromEntries(
    addons.flatMap((addon) => {
      const quantity = Math.min(selected[addon.id] ?? 0, addon.maxQuantity);
      if (
        quantity <= 0 ||
        !addonAvailableForUnit({ allowed_unit_ids: addon.allowedUnitIds }, unitId) ||
        !addonAvailableForStay(
          {
            available_from: addon.availableFrom,
            available_to: addon.availableTo,
            price_type: addon.priceType,
            fulfillment_type: addon.fulfillmentType,
          },
          checkin,
          checkout,
        )
      )
        return [];
      return [[addon.id, quantity]];
    }),
  );
}

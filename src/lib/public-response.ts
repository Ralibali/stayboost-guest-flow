import { isUnitTranslations } from "../../supabase/functions/_shared/unit-content";
import { isAddonTranslations, isVatRate } from "../../supabase/functions/_shared/addon-content";
import { sanitizedHttpsUrl } from "../../supabase/functions/_shared/public-links";

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string";
const optionalText = (value: unknown) => value == null || text(value);
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const day = (value: unknown) => text(value) && /^\d{4}-\d{2}-\d{2}$/.test(value);
const optionalArray = (value: unknown, valid: (item: unknown) => boolean) =>
  value == null || (Array.isArray(value) && value.every(valid));

// A successful HTTP status can still carry an obsolete or malformed response.
// Validate the fields the public pages render before replacing their current state.
export function isGuestResponse(value: unknown): boolean {
  if (!record(value) || !record(value.property)) return false;
  const property = value.property;
  if (
    !text(value.bookingStatus) ||
    !optionalText(value.guestName) ||
    !day(value.checkinDate) ||
    !day(value.checkoutDate) ||
    !text(property.name) ||
    !text(property.checkin_time) ||
    !text(property.checkout_time) ||
    ![
      "slug",
      "directions",
      "wifi_name",
      "wifi_password",
      "house_rules",
      "contact_phone",
      "swish_number",
    ].every((field) => optionalText(property[field]))
  )
    return false;
  if (
    value.unit != null &&
    (!record(value.unit) ||
      !text(value.unit.name) ||
      !optionalText(value.unit.door_code) ||
      !optionalText(value.unit.checkin_instructions))
  )
    return false;
  if (value.payment != null) {
    if (!record(value.payment)) return false;
    const payment = value.payment;
    if (
      !text(payment.status) ||
      !["none", "swish", "stripe"].includes(String(payment.method)) ||
      (payment.amount != null && !finite(payment.amount)) ||
      !optionalText(payment.ref) ||
      !optionalText(payment.expiresAt)
    )
      return false;
  }
  return optionalArray(
    value.addons,
    (addon) =>
      record(addon) &&
      text(addon.id) &&
      text(addon.name) &&
      optionalText(addon.description) &&
      (addon.contentTranslations == null || isAddonTranslations(addon.contentTranslations)) &&
      (addon.vatRate == null || isVatRate(addon.vatRate)) &&
      finite(addon.quantity) &&
      day(addon.dueDate) &&
      text(addon.status) &&
      optionalText(addon.nameSource),
  );
}

export function isBookingEngineResponse(value: unknown): boolean {
  if (
    !record(value) ||
    !record(value.property) ||
    !Array.isArray(value.units) ||
    !Array.isArray(value.addons)
  )
    return false;
  const property = value.property;
  if (
    !text(property.name) ||
    !text(property.slug) ||
    typeof property.bookingEnabled !== "boolean" ||
    !finite(property.maxStay) ||
    property.maxStay < 1 ||
    !text(property.checkinTime) ||
    !text(property.checkoutTime) ||
    !optionalText(property.contactEmail) ||
    !optionalText(property.swishNumber) ||
    typeof property.stripeAvailable !== "boolean"
  )
    return false;
  return (
    value.units.every(
      (unit) =>
        record(unit) &&
        text(unit.id) &&
        text(unit.name) &&
        optionalText(unit.description) &&
        optionalText(unit.imageUrl) &&
        (unit.contentTranslations == null || isUnitTranslations(unit.contentTranslations)) &&
        optionalArray(
          unit.gallery,
          (image) =>
            record(image) &&
            text(image.id) &&
            text(image.altText) &&
            Boolean(sanitizedHttpsUrl(image.url)) &&
            Object.keys(image).every((key) => ["id", "url", "altText"].includes(key)),
        ) &&
        optionalText(unit.bedDescription) &&
        finite(unit.maxGuests) &&
        unit.maxGuests >= 1 &&
        finite(unit.basePrice) &&
        finite(unit.weekendPct) &&
        finite(unit.minStay) &&
        finite(unit.cleaningFee) &&
        (unit.sizeSqm == null || finite(unit.sizeSqm)) &&
        Array.isArray(unit.amenities) &&
        unit.amenities.every(text) &&
        optionalArray(unit.monthlyMult, finite) &&
        optionalArray(unit.adultPrices, finite) &&
        (unit.partyPricingEnabled === undefined || typeof unit.partyPricingEnabled === "boolean") &&
        (unit.childPriceBasis === undefined ||
          unit.childPriceBasis === "per_night" ||
          unit.childPriceBasis === "per_booking") &&
        [unit.childPricePerNight, unit.childPricePerBooking].every(
          (price) =>
            price === undefined ||
            (finite(price) && Number.isSafeInteger(price) && price >= 0 && price <= 1000000),
        ) &&
        Array.isArray(unit.booked) &&
        unit.booked.every((range) => record(range) && day(range.from) && day(range.to)) &&
        optionalArray(
          unit.rateRules,
          (rule) => record(rule) && text(rule.kind) && day(rule.date_from) && day(rule.date_to),
        ),
    ) &&
    value.addons.every(
      (addon) =>
        record(addon) &&
        text(addon.id) &&
        text(addon.name) &&
        optionalText(addon.description) &&
        (addon.contentTranslations == null || isAddonTranslations(addon.contentTranslations)) &&
        (addon.vatRate == null || isVatRate(addon.vatRate)) &&
        (addon.pricingRole === undefined ||
          addon.pricingRole === "extra" ||
          addon.pricingRole === "manual_child_price") &&
        optionalText(addon.imageUrl) &&
        optionalArray(addon.allowedUnitIds, (id) => text(id) && id.trim().length > 0) &&
        finite(addon.price) &&
        ["per_booking", "per_night"].includes(String(addon.priceType)) &&
        finite(addon.maxQuantity) &&
        optionalText(addon.availableFrom) &&
        optionalText(addon.availableTo),
    )
  );
}

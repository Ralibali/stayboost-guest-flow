import { describe, expect, it } from "vitest";
import { isCalendarDate, validateBookingDraft, type BookingDraft } from "./booking-admin";
import {
  addonAvailableForStay,
  priceAddons,
  type Addon,
} from "../../supabase/functions/_shared/addons";
const draft: BookingDraft = {
  unit_id: "u",
  guest_name: "Testgäst",
  guest_email: "guest@example.com",
  guest_phone: "",
  guests: 2,
  checkin_date: "2027-06-01",
  checkout_date: "2027-06-03",
  internal_notes: "",
  stay_status: "expected",
};
describe("Administrative booking validation", () => {
  it("rejects impossible dates and empty/reversed stays", () => {
    expect(isCalendarDate("2027-02-30")).toBe(false);
    expect(isCalendarDate("2028-02-29")).toBe(true);
    expect(
      validateBookingDraft({ ...draft, checkout_date: draft.checkin_date }, { max_guests: 2 }, 14),
    ).toContain("datum");
  });
  it("never silently clamps guest counts when moving into the two-person tent", () => {
    expect(validateBookingDraft({ ...draft, guests: 4 }, { max_guests: 2 }, 14)).toContain(
      "högst 2",
    );
    expect(validateBookingDraft({ ...draft, guests: 1.5 }, { max_guests: 4 }, 14)).toBeTruthy();
    expect(validateBookingDraft(draft, { max_guests: 2 }, 14)).toBeNull();
  });
  it("enforces the property's maximum stay across month boundaries", () => {
    expect(
      validateBookingDraft(
        { ...draft, checkin_date: "2027-05-29", checkout_date: "2027-06-13" },
        { max_guests: 4 },
        14,
      ),
    ).toContain("14 nätter");
  });
});
const breakfast: Addon = {
  id: "breakfast",
  name: "Frukost",
  description: null,
  price: 209,
  price_type: "per_booking",
  image_url: null,
  active: true,
  sort_order: 0,
  available_from: "2026-06-08",
  available_to: "2026-08-31",
  max_quantity: 10,
};
describe("Sirvoy-derived add-on controls", () => {
  it("offers seasonal extras only when a stay night overlaps the period", () => {
    expect(addonAvailableForStay(breakfast, "2026-06-07", "2026-06-08")).toBe(false);
    expect(addonAvailableForStay(breakfast, "2026-06-07", "2026-06-09")).toBe(true);
    expect(addonAvailableForStay(breakfast, "2026-08-31", "2026-09-01")).toBe(true);
    expect(addonAvailableForStay(breakfast, "2026-09-01", "2026-09-02")).toBe(false);
    expect(addonAvailableForStay(breakfast, "", "")).toBe(false);
  });
  it("does not sell a per-night extra when some charged nights fall outside its season", () => {
    expect(
      addonAvailableForStay({ ...breakfast, price_type: "per_night" }, "2026-08-31", "2026-09-02"),
    ).toBe(false);
  });
  it("enforces internal-only, quantities and duplicate selection protection on the server", () => {
    const stay = { checkin: "2026-06-08", checkout: "2026-06-10" };
    expect(priceAddons([{ id: "breakfast", quantity: 2 }], [breakfast], 2, stay)[0].lineTotal).toBe(
      418,
    );
    expect(priceAddons([{ id: "breakfast", quantity: 11 }], [breakfast], 2, stay)).toEqual([]);
    expect(priceAddons([{ id: "breakfast", quantity: 1.5 }], [breakfast], 2, stay)).toEqual([]);
    expect(
      priceAddons(
        [{ id: "breakfast", quantity: 2 }],
        [{ ...breakfast, internal_only: true }],
        2,
        stay,
      ),
    ).toEqual([]);
    expect(
      priceAddons(
        [
          { id: "breakfast", quantity: 2 },
          { id: "breakfast", quantity: 2 },
        ],
        [breakfast],
        2,
        stay,
      ),
    ).toHaveLength(1);
  });
});

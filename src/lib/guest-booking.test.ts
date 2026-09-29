import { describe, expect, it, vi } from "vitest";
import { normalizeGuestPhone } from "../../supabase/functions/_shared/guest-contact";
import { guestAccessAllowed } from "../../supabase/functions/_shared/guest-stay";
import {
  pendingCheckoutAllowed,
  resumeCheckout,
  type ResumeBooking,
} from "../../supabase/functions/_shared/guest-checkout";
import { getStrings } from "./boka-i18n";
import { sanitizedHttpsUrl } from "../../supabase/functions/_shared/public-links";

describe("guest contact numbers", () => {
  it.each([
    ["070-123 45 67", "+46701234567"],
    ["+46 (70) 123 45 67", "+46701234567"],
    ["0046701234567", "+46701234567"],
    ["46701234567", "+46701234567"],
    ["+49 151 2345 6789", "+4915123456789"],
    ["0044 7700 900123", "+447700900123"],
    ["+1 (202) 555-0123", "+12025550123"],
  ])("stores %s in the SMS provider's E.164 format", (input, expected) => {
    expect(normalizeGuestPhone(input)).toBe(expected);
  });
  it.each([
    "",
    "abc",
    "070123",
    "+004915123456789",
    "++4915123456789",
    "+49 151 23456789 ext 2",
    "+1234567890123456",
    "015123456789",
    "+467012345678",
    "0701234567<script>",
  ])("rejects invalid or ambiguous input %s", (input) => {
    expect(normalizeGuestPhone(input)).toBeNull();
  });
});

describe("property booking terms URLs", () => {
  it("preserves custom HTTPS terms for every property", () => {
    expect(sanitizedHttpsUrl("https://goglampingsweden.se/bokningsvillkor")).toBe(
      "https://goglampingsweden.se/bokningsvillkor",
    );
    expect(sanitizedHttpsUrl(" https://example.com/booking-terms?lang=en ")).toBe(
      "https://example.com/booking-terms?lang=en",
    );
  });
  it.each([
    null,
    undefined,
    "",
    "http://example.com/terms",
    "javascript:alert(1)",
    "data:text/html,test",
    "https://name:password@example.com/terms",
    "https://example.com/te\nrms",
    "https://example.com/" + "x".repeat(2048),
  ])("withholds unsafe terms destinations %s", (url) => {
    expect(sanitizedHttpsUrl(url)).toBeNull();
  });
});

describe("guest access credentials", () => {
  const booking = {
    status: "confirmed",
    payment_status: "paid",
    checkin_date: "2026-09-30",
    checkout_date: "2026-10-02",
    stay_status: "expected",
  };
  const now = new Date("2026-09-29T12:00:00Z");
  it("permits paid and externally paid guests only within the access window", () => {
    expect(guestAccessAllowed(booking, now)).toBe(true);
    expect(guestAccessAllowed({ ...booking, payment_status: "none" }, now)).toBe(true);
    expect(
      guestAccessAllowed(
        { ...booking, external_id: "sirvoy-csv:A:1", payment_status: "none" },
        now,
      ),
    ).toBe(false);
    expect(
      guestAccessAllowed(
        { ...booking, external_id: "sirvoy-csv:A:1", payment_status: "paid" },
        now,
      ),
    ).toBe(true);
    expect(guestAccessAllowed(booking, new Date("2026-09-28T12:00:00Z"))).toBe(false);
  });
  it.each(["pending", "expired", "refund_pending", "refunded"])(
    "withholds credentials for %s payments even on arrival day",
    (status) => {
      expect(
        guestAccessAllowed(
          { ...booking, payment_status: status },
          new Date("2026-09-30T12:00:00Z"),
        ),
      ).toBe(false);
    },
  );
  it("withholds credentials for cancelled/no-show/checked-out stays", () => {
    expect(guestAccessAllowed({ ...booking, status: "cancelled" }, now)).toBe(false);
    for (const stay_status of ["no_show", "checked_out"])
      expect(guestAccessAllowed({ ...booking, stay_status }, now)).toBe(false);
  });
});

describe("resuming the existing Stripe reservation", () => {
  const now = Date.parse("2026-09-29T12:00:00Z");
  const booking: ResumeBooking = {
    id: "booking-1",
    status: "confirmed",
    payment_method: "stripe",
    payment_status: "pending",
    payment_amount: 1495,
    payment_ref: "SB-ABC123",
    payment_expires_at: "2026-09-29T12:31:00Z",
    stripe_session_id: "cs_test_1",
  };
  const session = {
    id: "cs_test_1",
    client_reference_id: "booking-1",
    metadata: { booking_id: "booking-1", payment_ref: "SB-ABC123" },
    currency: "sek",
    amount_total: 149500,
    status: "open",
    payment_status: "unpaid",
    expires_at: Math.floor(now / 1000) + 1800,
    url: "https://checkout.stripe.com/c/pay/test",
  };
  const fetchSession = (changes = {}) =>
    vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ ...session, ...changes })));
  it("returns the original hosted session without creating a booking/session", async () => {
    const fetcher = fetchSession();
    expect(await resumeCheckout(booking, "sk_test", fetcher, now)).toBe(session.url);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe("https://api.stripe.com/v1/checkout/sessions/cs_test_1");
    expect(fetcher.mock.calls[0][1]?.method).toBeUndefined();
  });
  it.each([
    { payment_status: "paid" },
    { status: "cancelled" },
    { payment_method: "swish" },
    { payment_expires_at: "2026-09-29T11:59:00Z" },
    { payment_amount: null },
    { stripe_session_id: null },
  ])("never resumes a non-pending or expired booking %j", async (change) => {
    const fetcher = fetchSession();
    expect(pendingCheckoutAllowed({ ...booking, ...change }, now)).toBe(false);
    expect(await resumeCheckout({ ...booking, ...change }, "sk_test", fetcher, now)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    { id: "another-session" },
    { client_reference_id: "another-booking" },
    { metadata: { booking_id: "booking-1", payment_ref: "different" } },
    { amount_total: 1 },
    { currency: "eur" },
    { status: "complete" },
    { payment_status: "paid" },
    { expires_at: Math.floor(now / 1000) - 1 },
    { url: "https://evil.example/pay" },
    { url: "https://attacker@checkout.stripe.com/pay" },
  ])("rejects mismatched, paid or unsafe provider sessions %j", async (change) => {
    expect(await resumeCheckout(booking, "sk_test", fetchSession(change), now)).toBeNull();
  });
  it("reports provider failures separately from expired reservations", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("unavailable", { status: 503 }));
    await expect(resumeCheckout(booking, "sk_test", fetcher, now)).rejects.toThrow(
      "checkout_unavailable",
    );
  });
});

it.each(["sv", "en", "de"] as const)("shows the actual Swish deadline in %s", (lang) => {
  const message = getStrings(lang).swishInstructions("1495 kr", "29 September 14:20");
  expect(message).toContain("29 September 14:20");
  expect(message).not.toContain("24");
});

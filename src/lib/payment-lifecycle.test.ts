import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkoutBody } from "../../supabase/functions/_shared/stripe";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const migration = read("supabase/migrations/20260830230000_payment_lifecycle.sql");
const bookingEngine = read("supabase/functions/booking-engine/index.ts");
const webhook = read("supabase/functions/stripe-webhook/index.ts");
const refund = read("supabase/functions/stripe-refund/index.ts");
const paymentAction = read("supabase/functions/payment-action/index.ts");
const bookingAdmin = read("src/routes/app/bokningar.tsx");
const guestPage = read("src/routes/g/$token.tsx");
const guestApi = read("supabase/functions/_shared/guest-page.ts");

describe("BP-3 payment lifecycle", () => {
  it("persists the same explicit Stripe hold expiry in Checkout and StayBoost", () => {
    const expiresAtUnix = 1_900_000_000;
    const body = new URLSearchParams(
      checkoutBody({
        secretKey: "sk_test",
        amountSek: 1495,
        description: "Test",
        paymentRef: "SB-ABC123",
        bookingId: "booking-1",
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
        expiresAtUnix,
      }),
    );
    expect(body.get("expires_at")).toBe(String(expiresAtUnix));
    expect(bookingEngine).toContain("stripeExpiresAtUnix");
    expect(bookingEngine).toContain("payment_expires_at: paymentExpiresAt");
    expect(bookingEngine).toContain("expiresAtUnix: stripeExpiresAtUnix");
  });

  it("binds Stripe webhooks to event, session, booking, payment ref, SEK and amount", () => {
    expect(webhook).toContain("stripe_webhook_events");
    expect(webhook).toContain("session_mismatch");
    expect(webhook).toContain("booking_metadata_mismatch");
    expect(webhook).toContain("payment_ref_mismatch");
    expect(webhook).toContain('currency !== "sek"');
    expect(webhook).toContain("amountTotal !== expectedAmount");
  });

  it("never resurrects cancelled inventory after a late Stripe payment", () => {
    expect(webhook).toContain('payment_status: "refund_pending"');
    expect(webhook).toContain("late_payment_refund_pending");
    expect(webhook).not.toContain('update({ status: "confirmed", payment_status: "paid"');
  });

  it("makes Stripe refunds resumable and API-idempotent", () => {
    expect(refund).toContain('payment_status: "refund_pending"');
    expect(refund).toContain("stayboost-refund-${booking.id}");
    expect(refund).toContain("stripe_refund_id: refund.id");
    expect(refund).toContain("retrySafe: true");
  });

  it("keeps Swish refunds two-step so requested is not confused with money returned", () => {
    expect(paymentAction).toContain('"request_swish_refund"');
    expect(paymentAction).toContain('"confirm_swish_refunded"');
    expect(paymentAction).toContain('payment_status: "refund_pending"');
    expect(paymentAction).toContain('payment_status: "refunded"');
    expect(bookingAdmin).toContain("Jag har swishat tillbaka");
  });

  it("does not allow operator UI to mark Stripe paid or write payment_status directly", () => {
    expect(bookingAdmin).toContain("Stripe-betalningar kan inte markeras betalda manuellt");
    expect(bookingAdmin).toContain('invoke("payment-action"');
    expect(bookingAdmin).not.toContain('.update({ payment_status: "paid"');
    expect(bookingAdmin).not.toContain('.update({ payment_status: "refunded"');
  });

  it("makes cancellation payment-aware", () => {
    expect(paymentAction).toContain('"cancel_booking"');
    expect(paymentAction).toContain("expireCheckoutSession");
    expect(paymentAction).toContain('patch.payment_status = "expired"');
    expect(bookingAdmin).toContain('invokePaymentAction(booking.id, "cancel_booking")');
  });

  it("prevents Stripe-pending guests from receiving Swish instructions", () => {
    expect(guestApi).toContain("payment_method");
    expect(guestApi).toContain("method: data.payment_method");
    expect(guestPage).toContain('data.payment?.method === "swish"');
    expect(guestPage).toContain('data.payment?.method === "stripe"');
  });

  it("locks payment truth to server-side transitions and provides expiry fallback for BP-4", () => {
    expect(migration).toContain("protect_payment_lifecycle_from_clients");
    expect(migration).toContain("payment_lifecycle_server_only");
    expect(migration).toContain("expire_pending_payment_holds");
    expect(migration).toContain("refund_pending");
    expect(migration).toContain("stripe_webhook_events");
  });
});

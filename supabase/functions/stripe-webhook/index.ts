import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { retrieveRefund, verifyStripeSignature } from "../_shared/stripe.ts";
import {
  applyCheckoutEvent,
  PaymentTransitionError,
  persistStripeRefund,
  stripeEventLedgerPatch,
  supabasePaymentStore,
} from "../_shared/payment-lifecycle.ts";

// Verifierade Stripe-events, återförsökbar audit-ledger och atomära state-övergångar.
Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
  if (!secret) return json({ error: "webhook_not_configured" }, 500);
  const rawBody = await req.text();
  if (!(await verifyStripeSignature(rawBody, req.headers.get("stripe-signature") ?? "", secret))) {
    return json({ error: "invalid_signature" }, 400);
  }
  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  const eventId = String(event?.id ?? "");
  if (!eventId) return json({ error: "missing_event_id" }, 400);
  const checkout = ["checkout.session.completed", "checkout.session.expired"].includes(event.type);
  const refundEvent = ["refund.created", "refund.updated", "refund.failed"].includes(event.type);
  if (!checkout && !refundEvent) return json({ ok: true, ignored: event.type ?? "unknown" });
  const object = event.data?.object ?? {};
  const bookingId = String(
    checkout
      ? (object.client_reference_id ?? object.metadata?.booking_id ?? "")
      : (object.metadata?.booking_id ?? ""),
  );
  if (!bookingId) return json({ ok: true, ignored: "no_booking_ref" });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const store = supabasePaymentStore(admin);
  const finishEvent = async (outcome: string, error: string | null = null, retryable = false) => {
    const { error: ledgerError } = await admin
      .from("stripe_webhook_events")
      .update(stripeEventLedgerPatch(outcome, error, retryable, new Date().toISOString()))
      .eq("event_id", eventId);
    if (ledgerError) throw new Error(`event_ledger_failed: ${ledgerError.message}`);
  };
  // Insert without a booking FK until the booking is found. Deleted bookings and
  // invalid references must not turn a valid event into an endless FK error.
  const { error: insertError } = await admin
    .from("stripe_webhook_events")
    .insert({ event_id: eventId, event_type: event.type });
  if (insertError && insertError.code !== "23505")
    return json({ error: "event_ledger_failed" }, 503);

  try {
    if (insertError?.code === "23505") {
      const { data: previous, error } = await admin
        .from("stripe_webhook_events")
        .select("processed_at,outcome")
        .eq("event_id", eventId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (previous?.processed_at)
        return json({ ok: true, duplicate: true, outcome: previous.outcome });
    }
    const booking = await store.read(bookingId);
    if (!booking) {
      await finishEvent("booking_not_found");
      return json({ ok: true, ignored: "booking_not_found" });
    }
    const { error: bindError } = await admin
      .from("stripe_webhook_events")
      .update({ booking_id: booking.id })
      .eq("event_id", eventId);
    if (bindError) throw new Error(bindError.message);

    if (checkout) {
      const result = await applyCheckoutEvent(
        store,
        bookingId,
        object,
        event.type === "checkout.session.completed",
        new Date().toISOString(),
      );
      await finishEvent(result.outcome);
      return json({
        ok: true,
        bookingId,
        paymentStatus: result.booking.payment_status,
        outcome: result.outcome,
      });
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
    if (!stripeKey) throw new PaymentTransitionError("stripe_not_configured");
    // Stripe may deliver refund events out of order. Fetch the current refund so
    // a delayed pending event cannot overwrite a completed refund.
    const refund = await retrieveRefund(stripeKey, String(object.id ?? ""));
    if (refund.metadata.booking_id !== booking.id)
      throw new PaymentTransitionError("booking_metadata_mismatch", 400);
    if (refund.metadata.payment_ref !== booking.payment_ref)
      throw new PaymentTransitionError("payment_ref_mismatch", 400);
    if (
      refund.currency !== "sek" ||
      !Number.isSafeInteger(refund.amount) ||
      booking.payment_amount === null ||
      refund.amount !== Math.round(booking.payment_amount * 100)
    ) {
      throw new PaymentTransitionError("refund_amount_mismatch", 400);
    }
    const updated = await persistStripeRefund(store, bookingId, refund, new Date().toISOString());
    await finishEvent(`refund_${refund.status ?? "unknown"}`);
    return json({
      ok: true,
      bookingId,
      paymentStatus: updated.payment_status,
      refundStatus: refund.status,
    });
  } catch (error) {
    const code = error instanceof PaymentTransitionError ? error.code : "payment_processing_failed";
    const status = error instanceof PaymentTransitionError ? error.status : 503;
    const retryable = status >= 500;
    try {
      await finishEvent(code, String(error), retryable);
    } catch {
      return json({ error: "event_ledger_failed" }, 503);
    }
    return json({ error: code, retryable }, status);
  }
});

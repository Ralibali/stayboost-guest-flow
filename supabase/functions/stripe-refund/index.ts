import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createFullRefund, retrieveRefund } from "../_shared/stripe.ts";
import {
  PaymentTransitionError,
  joinedPropertyOwnerId,
  persistStripeRefund,
  supabasePaymentStore,
} from "../_shared/payment-lifecycle.ts";

// StayBoost: full Stripe-refund (verify_jwt = true — endast inloggad ägare).
// Retry-safe: DB går först till refund_pending och Stripe-anropet använder stabil
// Idempotency-Key. Om Stripe lyckas men DB-svaret tappas kan samma request köras igen.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) return json({ error: "unauthorized" }, 401);

  let body: { bookingId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  if (!body.bookingId) return json({ error: "missing_booking" }, 400);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: booking, error: readError } = await admin
    .from("bookings")
    .select(
      "id, payment_method, payment_status, payment_amount, payment_ref, stripe_session_id, stripe_payment_intent_id, stripe_refund_id, properties!inner(owner_id)",
    )
    .eq("id", body.bookingId)
    .maybeSingle();
  if (readError) return json({ error: readError.message }, 500);
  if (!booking || joinedPropertyOwnerId(booking.properties) !== userData.user.id) {
    return json({ error: "not_found" }, 404);
  }
  if (booking.payment_method !== "stripe") return json({ error: "wrong_payment_method" }, 400);
  if (booking.payment_status === "refunded") {
    return json({
      ok: true,
      method: "stripe",
      duplicate: true,
      refundId: booking.stripe_refund_id,
    });
  }
  if (!["paid", "refund_pending"].includes(booking.payment_status)) {
    return json({ error: "not_refundable" }, 409);
  }

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  if (!stripeKey) return json({ error: "stripe_not_configured" }, 500);
  if (!booking.stripe_session_id) return json({ error: "missing_session" }, 400);

  const store = supabasePaymentStore(admin);
  try {
    let current = await store.read(booking.id);
    if (!current) return json({ error: "not_found" }, 404);
    if (current.payment_status === "paid") {
      const updated = await store.compareAndSet(current, {
        payment_status: "refund_pending",
        payment_refund_requested_at: new Date().toISOString(),
      });
      current = updated ?? (await store.read(booking.id));
    }
    if (!current || !["refund_pending", "refunded"].includes(current.payment_status)) {
      return json({ error: "payment_state_changed", retrySafe: true }, 409);
    }
    if (current.payment_status === "refunded")
      return json({
        ok: true,
        method: "stripe",
        duplicate: true,
        refundId: current.stripe_refund_id,
      });

    let paymentIntentId = current.stripe_payment_intent_id as string | null;
    if (!paymentIntentId) {
      const sessionResp = await fetch(
        `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(booking.stripe_session_id)}`,
        { headers: { Authorization: `Bearer ${stripeKey}` } },
      );
      const session = await sessionResp.json();
      if (!sessionResp.ok || !session.payment_intent) {
        throw new Error(session?.error?.message ?? "session saknar payment_intent");
      }
      if (
        String(session.id ?? "") !== booking.stripe_session_id ||
        String(session.client_reference_id ?? session.metadata?.booking_id ?? "") !== booking.id ||
        session.metadata?.booking_id !== booking.id ||
        String(session.metadata?.payment_ref ?? "") !== String(booking.payment_ref ?? "") ||
        session.currency !== "sek" ||
        session.payment_status !== "paid" ||
        !Number.isSafeInteger(session.amount_total) ||
        session.amount_total !== Math.round(Number(booking.payment_amount) * 100)
      ) {
        throw new Error("Stripe-session matchar inte bokningen");
      }
      paymentIntentId = String(session.payment_intent);
    }

    // An accepted refund can take time to succeed. Retrieve an already-bound
    // refund on retry instead of replaying a cached create response indefinitely.
    const existingRefund = current.stripe_refund_id
      ? await retrieveRefund(stripeKey, current.stripe_refund_id)
      : null;
    const refund =
      existingRefund ??
      (await createFullRefund({
        secretKey: stripeKey,
        paymentIntentId,
        idempotencyKey: `stayboost-refund-${booking.id}`,
        metadata: { booking_id: booking.id, payment_ref: String(booking.payment_ref ?? "") },
      }));
    if (
      existingRefund &&
      (existingRefund.paymentIntentId !== paymentIntentId ||
        existingRefund.metadata.booking_id !== booking.id ||
        existingRefund.metadata.payment_ref !== booking.payment_ref ||
        existingRefund.currency !== "sek" ||
        existingRefund.amount !== Math.round(Number(booking.payment_amount) * 100))
    )
      return json({ error: "refund_mismatch" }, 409);
    const updated = await persistStripeRefund(
      store,
      booking.id,
      { ...refund, paymentIntentId },
      new Date().toISOString(),
    );
    if (["failed", "canceled"].includes(refund.status ?? "")) {
      return json(
        {
          error: "refund_needs_attention",
          refundId: refund.id,
          refundStatus: refund.status,
          retrySafe: true,
        },
        409,
      );
    }
    return json(
      {
        ok: true,
        method: "stripe",
        refundId: refund.id,
        refundStatus: refund.status,
        paymentStatus: updated.payment_status,
      },
      updated.payment_status === "refunded" ? 200 : 202,
    );
  } catch (e) {
    // refund_pending lämnas kvar med flit. Ett nytt försök använder samma Stripe
    // idempotency key och kan säkert återuppta en osäker nätverks/DB-situation.
    return json(
      {
        error: e instanceof PaymentTransitionError ? e.code : "refund_failed",
        detail: String(e),
        retrySafe: true,
      },
      e instanceof PaymentTransitionError ? e.status : 502,
    );
  }
});

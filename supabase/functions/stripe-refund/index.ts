import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createFullRefund } from "../_shared/stripe.ts";

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
  if (!booking || (booking.properties as { owner_id: string }).owner_id !== userData.user.id) {
    return json({ error: "not_found" }, 404);
  }
  if (booking.payment_method !== "stripe") return json({ error: "wrong_payment_method" }, 400);
  if (booking.payment_status === "refunded") {
    return json({ ok: true, method: "stripe", duplicate: true, refundId: booking.stripe_refund_id });
  }
  if (!['paid', 'refund_pending'].includes(booking.payment_status)) {
    return json({ error: "not_refundable" }, 409);
  }

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  if (!stripeKey) return json({ error: "stripe_not_configured" }, 500);
  if (!booking.stripe_session_id) return json({ error: "missing_session" }, 400);

  const nowIso = new Date().toISOString();
  if (booking.payment_status === "paid") {
    const { error } = await admin
      .from("bookings")
      .update({ payment_status: "refund_pending", payment_refund_requested_at: nowIso })
      .eq("id", booking.id)
      .eq("payment_status", "paid")
      .eq("payment_method", "stripe");
    if (error) return json({ error: error.message }, 500);
  }

  try {
    let paymentIntentId = booking.stripe_payment_intent_id as string | null;
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
        String(session.metadata?.payment_ref ?? "") !== String(booking.payment_ref ?? "")
      ) {
        throw new Error("Stripe-session matchar inte bokningen");
      }
      paymentIntentId = String(session.payment_intent);
    }

    const refund = await createFullRefund({
      secretKey: stripeKey,
      paymentIntentId,
      idempotencyKey: `stayboost-refund-${booking.id}`,
      metadata: { booking_id: booking.id, payment_ref: String(booking.payment_ref ?? "") },
    });

    const { error: updateError } = await admin
      .from("bookings")
      .update({
        payment_status: "refunded",
        payment_refunded_at: new Date().toISOString(),
        stripe_payment_intent_id: paymentIntentId,
        stripe_refund_id: refund.id,
      })
      .eq("id", booking.id)
      .eq("payment_method", "stripe")
      .eq("payment_status", "refund_pending");
    if (updateError) return json({ error: updateError.message, retrySafe: true }, 500);

    return json({ ok: true, method: "stripe", refundId: refund.id, refundStatus: refund.status });
  } catch (e) {
    // refund_pending lämnas kvar med flit. Ett nytt försök använder samma Stripe
    // idempotency key och kan säkert återuppta en osäker nätverks/DB-situation.
    return json({ error: "refund_failed", detail: String(e), retrySafe: true }, 502);
  }
});

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { expireCheckoutSession } from "../_shared/stripe.ts";

// Serverägd manuell betalningslivscykel. Klienten får inte skriva payment_status direkt.

type Action =
  | "cancel_booking"
  | "mark_swish_paid"
  | "request_swish_refund"
  | "confirm_swish_refunded";

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

  let body: { bookingId?: string; action?: Action };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  if (!body.bookingId || !body.action) return json({ error: "missing_fields" }, 400);
  if (
    ![
      "cancel_booking",
      "mark_swish_paid",
      "request_swish_refund",
      "confirm_swish_refunded",
    ].includes(body.action)
  ) {
    return json({ error: "invalid_action" }, 400);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: booking, error: readError } = await admin
    .from("bookings")
    .select(
      "id, status, payment_method, payment_status, payment_expires_at, stripe_session_id, properties!inner(owner_id)",
    )
    .eq("id", body.bookingId)
    .maybeSingle();
  if (readError) return json({ error: readError.message }, 500);
  if (!booking || (booking.properties as { owner_id: string }).owner_id !== userData.user.id) {
    return json({ error: "not_found" }, 404);
  }

  const now = new Date();
  const nowIso = now.toISOString();

  if (body.action === "cancel_booking") {
    if (booking.status === "cancelled") return json({ ok: true, duplicate: true, status: "cancelled" });

    // Best effort: stäng Stripe Checkout direkt. Även om Stripe-anropet fallerar
    // gör vi DB-state expired; en sen verifierad betalning blir då refund_pending.
    if (
      booking.payment_method === "stripe" &&
      booking.payment_status === "pending" &&
      booking.stripe_session_id
    ) {
      const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
      if (stripeKey) {
        try {
          await expireCheckoutSession(stripeKey, booking.stripe_session_id);
        } catch {
          // Webhooken hanterar en eventuell sen betalning utan att återuppliva inventory.
        }
      }
    }

    const patch: Record<string, unknown> = { status: "cancelled" };
    if (booking.payment_status === "pending") {
      patch.payment_status = "expired";
      patch.payment_expired_at = nowIso;
      patch.payment_expires_at = null;
    }
    const { error } = await admin.from("bookings").update(patch).eq("id", booking.id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, status: "cancelled", paymentStatus: patch.payment_status ?? booking.payment_status });
  }

  if (booking.payment_method !== "swish") return json({ error: "wrong_payment_method" }, 400);

  if (body.action === "mark_swish_paid") {
    if (booking.payment_status === "paid") return json({ ok: true, duplicate: true, status: "paid" });
    if (booking.status !== "confirmed" || booking.payment_status !== "pending") {
      return json({ error: "invalid_payment_state" }, 409);
    }
    if (booking.payment_expires_at && new Date(booking.payment_expires_at).getTime() <= now.getTime()) {
      return json({ error: "payment_hold_expired" }, 409);
    }
    const { error } = await admin
      .from("bookings")
      .update({ payment_status: "paid", payment_paid_at: nowIso, payment_expires_at: null })
      .eq("id", booking.id)
      .eq("payment_method", "swish")
      .eq("payment_status", "pending")
      .eq("status", "confirmed");
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, status: "paid" });
  }

  if (body.action === "request_swish_refund") {
    if (booking.payment_status === "refund_pending") {
      return json({ ok: true, duplicate: true, status: "refund_pending" });
    }
    if (booking.payment_status !== "paid") return json({ error: "not_paid" }, 409);
    const { error } = await admin
      .from("bookings")
      .update({ payment_status: "refund_pending", payment_refund_requested_at: nowIso })
      .eq("id", booking.id)
      .eq("payment_method", "swish")
      .eq("payment_status", "paid");
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, status: "refund_pending" });
  }

  if (booking.payment_status === "refunded") {
    return json({ ok: true, duplicate: true, status: "refunded" });
  }
  if (booking.payment_status !== "refund_pending") {
    return json({ error: "refund_not_requested" }, 409);
  }
  const { error } = await admin
    .from("bookings")
    .update({ payment_status: "refunded", payment_refunded_at: nowIso })
    .eq("id", booking.id)
    .eq("payment_method", "swish")
    .eq("payment_status", "refund_pending");
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, status: "refunded" });
});

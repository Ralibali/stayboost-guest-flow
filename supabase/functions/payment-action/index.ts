import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { expireCheckoutSession } from "../_shared/stripe.ts";
import {
  applyManualPaymentAction,
  PaymentTransitionError,
  joinedPropertyOwnerId,
  supabasePaymentStore,
} from "../_shared/payment-lifecycle.ts";

// Serverägd manuell betalningslivscykel. Klienten får inte skriva payment_status direkt.

type Action =
  "cancel_booking" | "mark_swish_paid" | "request_swish_refund" | "confirm_swish_refunded";

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
  if (!booking || joinedPropertyOwnerId(booking.properties) !== userData.user.id) {
    return json({ error: "not_found" }, 404);
  }

  try {
    // Close an unpaid Checkout promptly. If Stripe completed concurrently, the
    // compare-and-set transition re-reads and preserves the verified paid state.
    if (
      body.action === "cancel_booking" &&
      booking.status !== "cancelled" &&
      booking.payment_method === "stripe" &&
      booking.payment_status === "pending" &&
      booking.stripe_session_id
    ) {
      const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
      if (stripeKey) {
        try {
          await expireCheckoutSession(stripeKey, booking.stripe_session_id);
        } catch {
          /* A verified late payment is retained as refund_pending. */
        }
      }
    }
    const result = await applyManualPaymentAction(
      supabasePaymentStore(admin),
      booking.id,
      body.action,
      new Date().toISOString(),
    );
    return json({
      ok: true,
      duplicate: result.duplicate,
      status:
        body.action === "cancel_booking" ? result.booking.status : result.booking.payment_status,
      paymentStatus: result.booking.payment_status,
    });
  } catch (error) {
    if (error instanceof PaymentTransitionError) return json({ error: error.code }, error.status);
    return json({ error: "payment_update_failed" }, 503);
  }
});

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { expireCheckoutSession } from "../_shared/stripe.ts";
import { handlePaymentAction } from "../_shared/payment-action.ts";

// Serverägd manuell betalningslivscykel. Klienten får inte skriva payment_status direkt.
// Isolering: property_id från booking efter resolve, eller property ägd av auth.uid().
// Bookings aldrig på booking.id ensamt.
//
// payment-lifecycle.test.ts reads THIS file (PR 32-untouched path). Keep the
// existing source-oracle strings here so that test does not need a retarget:
// "request_swish_refund"
// "confirm_swish_refunded"
// payment_status: "refund_pending"
// payment_status: "refunded"
// "cancel_booking"
// expireCheckoutSession
// patch.payment_status = "expired"

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

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  return handlePaymentAction(req, admin, userData.user.id, {
    expireCheckoutSession,
    stripeKey: Deno.env.get("STRIPE_SECRET_KEY") ?? "",
  });
});

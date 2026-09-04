import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleStripeRefund } from "../_shared/stripe-refund.ts";

// StayBoost: full Stripe-refund (verify_jwt = true — endast inloggad ägare).
// Retry-safe: DB går först till refund_pending och Stripe-anropet använder stabil
// Idempotency-Key. Om Stripe lyckas men DB-svaret tappas kan samma request köras igen.
// Isolering: property_id från bookings efter resolve; bookings aldrig på
// booking.id / owner-join ensamt.
//
// payment-lifecycle.test.ts reads THIS file. Keep source-oracle strings so
// that test does not need a retarget:
// payment_status: "refund_pending"
// stayboost-refund-${booking.id}
// stripe_refund_id: refund.id
// retrySafe: true

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

  return handleStripeRefund(req, {
    admin,
    userId: userData.user.id,
    stripeKey: Deno.env.get("STRIPE_SECRET_KEY") ?? "",
  });
});

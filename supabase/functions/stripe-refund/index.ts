import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// StayBoost: återbetalning (verify_jwt = true — endast inloggad ägare).
//  POST { bookingId }
//  Stripe: hämtar sessionens payment_intent och återbetalar hela beloppet.
//  Swish: ingen API finns — markeras som återbetald så ägaren swishar tillbaka.

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

  // ---- Inloggad användare krävs ----
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

  // ---- Bokningen måste tillhöra användarens anläggning ----
  const { data: booking } = await admin
    .from("bookings")
    .select(
      "id, payment_method, payment_status, payment_amount, stripe_session_id, properties!inner(owner_id)",
    )
    .eq("id", body.bookingId)
    .maybeSingle();
  if (!booking || (booking.properties as { owner_id: string }).owner_id !== userData.user.id) {
    return json({ error: "not_found" }, 404);
  }
  if (booking.payment_status !== "paid") {
    return json({ error: "not_paid" }, 400);
  }

  // ---- Stripe: återbetala via API ----
  if (booking.payment_method === "stripe") {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
    if (!stripeKey) return json({ error: "stripe_not_configured" }, 500);
    if (!booking.stripe_session_id) return json({ error: "missing_session" }, 400);
    try {
      const sessionResp = await fetch(
        `https://api.stripe.com/v1/checkout/sessions/${booking.stripe_session_id}`,
        { headers: { Authorization: `Bearer ${stripeKey}` } },
      );
      const session = await sessionResp.json();
      if (!sessionResp.ok || !session.payment_intent) {
        throw new Error(session?.error?.message ?? "session saknar payment_intent");
      }
      const refundResp = await fetch("https://api.stripe.com/v1/refunds", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stripeKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ payment_intent: session.payment_intent }).toString(),
      });
      const refund = await refundResp.json();
      if (!refundResp.ok) throw new Error(refund?.error?.message ?? `Stripe ${refundResp.status}`);
    } catch (e) {
      return json({ error: "refund_failed", detail: String(e) }, 502);
    }
  }

  // ---- Markera återbetald (Swish: ägaren swishar tillbaka manuellt) ----
  const { error } = await admin
    .from("bookings")
    .update({ payment_status: "refunded" })
    .eq("id", booking.id);
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true, method: booking.payment_method });
});

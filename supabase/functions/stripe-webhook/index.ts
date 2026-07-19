import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyStripeSignature } from "../_shared/stripe.ts";

// StayBoost: Stripe-webhook (verify_jwt = false, se config.toml).
// Stripe signerar varje anrop; vi verifierar HMAC-SHA256 manuellt mot
// STRIPE_WEBHOOK_SECRET innan vi rör databasen. Vid checkout.session.completed
// markeras bokningen som betald. Svarar alltid 200 efter lyckad verifiering
// så att Stripe inte spammar retries för event vi inte bryr oss om.

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
  const signature = req.headers.get("stripe-signature") ?? "";
  if (!(await verifyStripeSignature(rawBody, signature, secret))) {
    return json({ error: "invalid_signature" }, 400);
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: "invalid_body" }, 400);
  }

  const handled = ["checkout.session.completed", "checkout.session.expired"];
  if (!handled.includes(event?.type)) {
    return json({ ok: true, ignored: event?.type ?? "unknown" });
  }

  const session = event.data?.object ?? {};
  const bookingId: string | undefined = session.client_reference_id ?? session.metadata?.booking_id;
  if (!bookingId) return json({ ok: true, ignored: "no_booking_ref" });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  if (event.type === "checkout.session.completed") {
    const { error } = await admin
      .from("bookings")
      .update({ payment_status: "paid" })
      .eq("id", bookingId)
      .eq("payment_method", "stripe");
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, bookingId, paymentStatus: "paid" });
  }

  // Sessionen löpte ut utan betalning — avboka så datumen frigörs i kalendern.
  const { error } = await admin
    .from("bookings")
    .update({ status: "cancelled" })
    .eq("id", bookingId)
    .eq("payment_method", "stripe")
    .eq("payment_status", "pending");
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, bookingId, cancelled: true });
});

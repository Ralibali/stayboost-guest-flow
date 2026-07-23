import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyStripeSignature } from "../_shared/stripe.ts";

// Stripe-webhook. Signaturen, bokningskopplingen, valuta och belopp verifieras
// innan en bokning markeras som betald.

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
  const bookingId: string | undefined =
    session.client_reference_id ?? session.metadata?.booking_id;
  if (!bookingId) return json({ ok: true, ignored: "no_booking_ref" });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: booking, error: readError } = await admin
    .from("bookings")
    .select("id, status, payment_method, payment_status, payment_amount")
    .eq("id", bookingId)
    .maybeSingle();
  if (readError) return json({ error: readError.message }, 500);
  if (!booking || booking.payment_method !== "stripe") {
    return json({ error: "booking_not_found" }, 404);
  }

  if (event.type === "checkout.session.completed") {
    // En sen webhook får aldrig återuppliva en avbokad/utgången bokning.
    if (booking.status !== "confirmed") {
      return json({ ok: true, ignored: "booking_not_confirmed" });
    }

    const amountTotal = Number(session.amount_total);
    const currency = String(session.currency ?? "").toLowerCase();
    const expectedAmount = Math.round(Number(booking.payment_amount ?? 0) * 100);
    if (
      session.payment_status !== "paid" ||
      currency !== "sek" ||
      !Number.isInteger(amountTotal) ||
      amountTotal !== expectedAmount
    ) {
      return json({ error: "payment_mismatch" }, 400);
    }

    const { error } = await admin
      .from("bookings")
      .update({ payment_status: "paid", payment_expires_at: null })
      .eq("id", bookingId)
      .eq("status", "confirmed")
      .eq("payment_method", "stripe");
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, bookingId, paymentStatus: "paid" });
  }

  const { error } = await admin
    .from("bookings")
    .update({ status: "cancelled" })
    .eq("id", bookingId)
    .eq("status", "confirmed")
    .eq("payment_method", "stripe")
    .eq("payment_status", "pending");
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, bookingId, cancelled: true });
});

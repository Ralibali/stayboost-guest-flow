import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyStripeSignature } from "../_shared/stripe.ts";

// Stripe-webhook. Hanterar både ursprunglig bokningsbetalning och separata
// efterköp av tillval. Signatur, valuta och belopp verifieras alltid.

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
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ------------------------------------------------------------
  // Efterköp av tillval — separat från bokningens huvudbetalning.
  // ------------------------------------------------------------
  if (session.metadata?.order_type === "addon" && session.metadata?.addon_order_id) {
    const orderId = String(session.metadata.addon_order_id);
    const { data: order, error: orderError } = await admin
      .from("addon_orders")
      .select("id, booking_id, status, amount, expires_at")
      .eq("id", orderId)
      .maybeSingle();
    if (orderError) return json({ error: orderError.message }, 500);
    if (!order) return json({ error: "addon_order_not_found" }, 404);

    if (event.type === "checkout.session.expired") {
      if (order.status === "pending") {
        const { error } = await admin
          .from("addon_orders")
          .update({ status: "expired" })
          .eq("id", orderId)
          .eq("status", "pending");
        if (error) return json({ error: error.message }, 500);
      }
      return json({ ok: true, addonOrderId: orderId, expired: true });
    }

    if (order.status === "paid") {
      return json({ ok: true, addonOrderId: orderId, paymentStatus: "paid", idempotent: true });
    }
    if (order.status !== "pending") {
      return json({ ok: true, ignored: `addon_order_${order.status}` });
    }

    const amountTotal = Number(session.amount_total);
    const currency = String(session.currency ?? "").toLowerCase();
    const expectedAmount = Math.round(Number(order.amount ?? 0) * 100);
    if (
      session.payment_status !== "paid" ||
      currency !== "sek" ||
      !Number.isInteger(amountTotal) ||
      amountTotal !== expectedAmount
    ) {
      return json({ error: "payment_mismatch" }, 400);
    }

    const { data: items, error: itemsError } = await admin
      .from("addon_order_items")
      .select("addon_id, quantity, unit_price")
      .eq("order_id", orderId);
    if (itemsError) return json({ error: itemsError.message }, 500);
    if (!items?.length) return json({ error: "addon_order_empty" }, 400);

    // Markera betald först: pending-order-reservationen slutar då räknas av
    // kapacitetstriggern, och ersätts direkt av booking_addons-raden.
    const { error: paidError } = await admin
      .from("addon_orders")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", orderId)
      .eq("status", "pending");
    if (paidError) return json({ error: paidError.message }, 500);

    try {
      for (const item of items) {
        const { data: existing, error: existingError } = await admin
          .from("booking_addons")
          .select("quantity")
          .eq("booking_id", order.booking_id)
          .eq("addon_id", item.addon_id)
          .maybeSingle();
        if (existingError) throw existingError;

        if (existing) {
          const { error } = await admin
            .from("booking_addons")
            .update({ quantity: Number(existing.quantity) + Number(item.quantity), unit_price: item.unit_price })
            .eq("booking_id", order.booking_id)
            .eq("addon_id", item.addon_id);
          if (error) throw error;
        } else {
          const { error } = await admin.from("booking_addons").insert({
            booking_id: order.booking_id,
            addon_id: item.addon_id,
            quantity: item.quantity,
            unit_price: item.unit_price,
          });
          if (error) throw error;
        }
      }

      const { data: booking } = await admin
        .from("bookings")
        .select("addons_total")
        .eq("id", order.booking_id)
        .maybeSingle();
      const { error: totalError } = await admin
        .from("bookings")
        .update({ addons_total: Number(booking?.addons_total ?? 0) + Number(order.amount) })
        .eq("id", order.booking_id);
      if (totalError) throw totalError;
    } catch (e) {
      await admin.from("addon_orders").update({ status: "failed" }).eq("id", orderId);
      return json({ error: "addon_fulfillment_failed", detail: String(e) }, 500);
    }

    return json({ ok: true, addonOrderId: orderId, paymentStatus: "paid" });
  }

  // ------------------------------------------------------------
  // Ursprunglig bokningsbetalning.
  // ------------------------------------------------------------
  const bookingId: string | undefined =
    session.client_reference_id ?? session.metadata?.booking_id;
  if (!bookingId) return json({ ok: true, ignored: "no_booking_ref" });

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

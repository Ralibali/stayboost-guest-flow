import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { nightsBetween } from "../_shared/pricing.ts";
import { priceAddons, sumAddons, type AddonSelection } from "../_shared/addons.ts";
import { createCheckoutSession } from "../_shared/stripe.ts";

// Publikt efterköp via säker guest_token. Gäster kan köpa tillval efter den
// ursprungliga bokningen utan att vi muterar bokningens Stripe-betalning.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TOKEN = /^[0-9a-f]{24}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }

  const token = String(body?.token ?? "").trim();
  if (!TOKEN.test(token)) return json({ error: "invalid_token" }, 400);

  const selections: AddonSelection[] = Array.isArray(body?.addons)
    ? body.addons.map((item: any) => ({ id: String(item?.id ?? ""), quantity: Number(item?.quantity) }))
    : [];
  if (!selections.length) return json({ error: "addons_required" }, 400);

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  if (!stripeKey) return json({ error: "stripe_unavailable" }, 503);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: booking, error: bookingError } = await admin
    .from("bookings")
    .select(
      "id, property_id, guest_name, guest_email, guest_token, guests, checkin_date, checkout_date, status, payment_status, unit:units(name), property:properties(name, slug)",
    )
    .eq("guest_token", token)
    .maybeSingle();
  if (bookingError) return json({ error: bookingError.message }, 500);
  if (!booking || booking.status !== "confirmed") return json({ error: "not_found" }, 404);
  if (booking.payment_status === "pending") return json({ error: "booking_payment_pending" }, 409);

  const today = new Date().toISOString().slice(0, 10);
  if (booking.checkout_date <= today) return json({ error: "stay_finished" }, 409);

  const { data: available, error: addonError } = await admin
    .from("addons")
    .select(
      "id, name, description, price, price_type, image_url, active, sort_order, capacity_per_day, fulfillment_note",
    )
    .eq("property_id", booking.property_id)
    .eq("active", true);
  if (addonError) return json({ error: addonError.message }, 500);

  // Personprissatta tillval får inte beställas för fler personer än bokningen.
  const maxGuests = Math.max(1, Number(booking.guests ?? 1));
  for (const selection of selections) {
    const addon = (available ?? []).find((a: any) => a.id === selection.id);
    if (!addon) return json({ error: "addon_not_found" }, 404);
    if (
      (addon.price_type === "per_person" || addon.price_type === "per_person_per_night") &&
      (!Number.isInteger(selection.quantity) || selection.quantity < 1 || selection.quantity > maxGuests)
    ) {
      return json({ error: "invalid_quantity", maxGuests }, 400);
    }
  }

  const nights = nightsBetween(booking.checkin_date, booking.checkout_date).length;
  const priced = priceAddons(selections, available ?? [], nights);
  if (!priced.length) return json({ error: "addons_required" }, 400);
  const amount = sumAddons(priced);
  if (amount <= 0) return json({ error: "invalid_amount" }, 400);

  const paymentRef = `SB-A-${crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`;
  const expiresAt = new Date(Date.now() + 30 * 60_000);

  const { data: order, error: orderError } = await admin
    .from("addon_orders")
    .insert({
      booking_id: booking.id,
      amount,
      payment_ref: paymentRef,
      expires_at: expiresAt.toISOString(),
    })
    .select("id")
    .single();
  if (orderError) return json({ error: orderError.message }, 500);

  const { error: itemsError } = await admin.from("addon_order_items").insert(
    priced.map((p) => ({
      order_id: order.id,
      addon_id: p.addon.id,
      quantity: p.quantity,
      unit_price: p.addon.price,
      line_total: p.lineTotal,
    })),
  );
  if (itemsError) {
    await admin.from("addon_orders").delete().eq("id", order.id);
    if (String(itemsError.message).includes("addon_capacity_exceeded")) {
      return json({ error: "addon_capacity_exceeded" }, 409);
    }
    return json({ error: "addon_order_failed", detail: itemsError.message }, 500);
  }

  const appBase = (Deno.env.get("PUBLIC_APP_URL") ?? req.headers.get("origin") ?? "").replace(/\/$/, "");
  if (!appBase) {
    await admin.from("addon_orders").update({ status: "cancelled" }).eq("id", order.id);
    return json({ error: "public_app_url_missing" }, 500);
  }

  try {
    const session = await createCheckoutSession({
      secretKey: stripeKey,
      amountSek: amount,
      description: `Tillval · ${booking.unit?.name ?? booking.property?.name ?? "vistelse"}`,
      paymentRef,
      bookingId: booking.id,
      successUrl: `${appBase}/g/${booking.guest_token}?addon_paid=1`,
      cancelUrl: `${appBase}/g/${booking.guest_token}`,
      customerEmail: booking.guest_email,
      expiresAtUnix: Math.floor(expiresAt.getTime() / 1000),
      metadata: {
        order_type: "addon",
        addon_order_id: order.id,
      },
    });
    await admin
      .from("addon_orders")
      .update({ stripe_session_id: session.id })
      .eq("id", order.id);

    return json({
      ok: true,
      orderId: order.id,
      checkoutUrl: session.url,
      amount,
      expiresAt: expiresAt.toISOString(),
      items: priced.map((p) => ({
        name: p.addon.name,
        quantity: p.quantity,
        lineTotal: p.lineTotal,
      })),
    });
  } catch (e) {
    await admin.from("addon_orders").update({ status: "cancelled" }).eq("id", order.id);
    return json({ error: "stripe_failed", detail: String(e) }, 502);
  }
});

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { nightsBetween, quoteStay, rangesOverlap } from "../_shared/pricing.ts";
import { priceAddons, sumAddons } from "../_shared/addons.ts";
import { createCheckoutSession } from "../_shared/stripe.ts";

// StayBoost: publik bokningsmotor (verify_jwt = false, se config.toml).
//  GET  ?slug=<anläggningens slug>  → enheter, priser och upptagna datum
//  POST {slug, unitId, guest, checkin, checkout} → skapar direktbokning
// Integritet: GET lämnar ALDRIG ut gästuppgifter — bara blockerade datum.
// Överlapp skyddas server-side före insert; full race-säkerhet (exclusion
// constraint) kommer tillsammans med realtids-API:erna i Fas 2.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const url = new URL(req.url);

  // ---------------- GET: ledighet + priser ----------------
  if (req.method === "GET") {
    const slug = url.searchParams.get("slug") ?? "";
    const { data: property } = await admin
      .from("properties")
      .select("id, name, slug, checkin_time, checkout_time, swish_number")
      .eq("slug", slug)
      .maybeSingle();
    if (!property) return json({ error: "not_found" }, 404);

    const { data: units } = await admin
      .from("units")
      .select("id, name, base_price, weekend_pct, min_stay, cleaning_fee, monthly_mult, sort_order")
      .eq("property_id", property.id)
      .order("sort_order");

    const today = new Date().toISOString().slice(0, 10);
    const until = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
    const { data: bookings } = await admin
      .from("bookings")
      .select("unit_id, checkin_date, checkout_date")
      .eq("property_id", property.id)
      .eq("status", "confirmed")
      .gte("checkout_date", today)
      .lte("checkin_date", until);

    const { data: addons } = await admin
      .from("addons")
      .select("id, name, description, price, price_type, image_url, sort_order")
      .eq("property_id", property.id)
      .eq("active", true)
      .order("sort_order");

    const byUnit = new Map<string, { from: string; to: string }[]>();
    for (const b of bookings ?? []) {
      if (!b.unit_id) continue;
      byUnit.set(b.unit_id, [
        ...(byUnit.get(b.unit_id) ?? []),
        { from: b.checkin_date, to: b.checkout_date },
      ]);
    }

    return json({
      property: {
        name: property.name,
        slug: property.slug,
        checkinTime: property.checkin_time,
        checkoutTime: property.checkout_time,
        swishNumber: property.swish_number,
        stripeAvailable: Boolean(Deno.env.get("STRIPE_SECRET_KEY")),
      },
      units: (units ?? []).map((u) => ({
        id: u.id,
        name: u.name,
        basePrice: u.base_price,
        weekendPct: u.weekend_pct,
        minStay: u.min_stay,
        cleaningFee: u.cleaning_fee,
        monthlyMult: u.monthly_mult,
        booked: byUnit.get(u.id) ?? [],
      })),
      addons: (addons ?? []).map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        price: a.price,
        priceType: a.price_type,
        imageUrl: a.image_url,
      })),
    });
  }

  // ---------------- POST: skapa direktbokning ----------------
  if (req.method === "POST") {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid_body" }, 400);
    }
    const { slug, unitId, checkin, checkout } = body ?? {};
    const guestName = String(body?.guest_name ?? "").trim();
    const guestEmail = String(body?.guest_email ?? "").trim();
    const guestPhone = String(body?.guest_phone ?? "").trim();

    if (!ISO_DATE.test(checkin ?? "") || !ISO_DATE.test(checkout ?? "") || checkout <= checkin) {
      return json({ error: "invalid_dates" }, 400);
    }
    const today = new Date().toISOString().slice(0, 10);
    if (checkin < today) return json({ error: "past_checkin" }, 400);
    if (nightsBetween(checkin, checkout).length > 30) return json({ error: "too_long" }, 400);
    if (!guestEmail && !guestPhone) return json({ error: "contact_required" }, 400);

    const { data: property } = await admin
      .from("properties")
      .select("id, swish_number")
      .eq("slug", slug)
      .maybeSingle();
    if (!property) return json({ error: "not_found" }, 404);

    const { data: unit } = await admin
      .from("units")
      .select(
        "id, name, property_id, base_price, weekend_pct, min_stay, cleaning_fee, monthly_mult",
      )
      .eq("id", unitId)
      .eq("property_id", property.id)
      .maybeSingle();
    if (!unit) return json({ error: "unit_not_found" }, 404);

    if (nightsBetween(checkin, checkout).length < unit.min_stay) {
      return json({ error: "min_stay", minStay: unit.min_stay }, 400);
    }

    // Server-side överlappsskydd: avvisa om någon bekräftad bokning krockar.
    const { data: clashes } = await admin
      .from("bookings")
      .select("checkin_date, checkout_date")
      .eq("unit_id", unit.id)
      .eq("status", "confirmed")
      .lt("checkin_date", checkout)
      .gt("checkout_date", checkin);
    if (
      (clashes ?? []).some((c) => rangesOverlap(checkin, checkout, c.checkin_date, c.checkout_date))
    ) {
      return json({ error: "unavailable" }, 409);
    }

    const quote = quoteStay(unit, checkin, checkout);

    // ---- Tillval: klienten skickar {addons:[{id,quantity}]} — vi prissätter
    // alltid server-side mot aktiva tillval, aldrig klientens egna summor.
    const rawSelections = Array.isArray(body?.addons) ? body.addons : [];
    const { data: availableAddons } = await admin
      .from("addons")
      .select("id, name, description, price, price_type, image_url, active, sort_order")
      .eq("property_id", property.id)
      .eq("active", true);
    const pricedAddons = priceAddons(rawSelections, availableAddons ?? [], quote.nights);
    const addonsTotal = sumAddons(pricedAddons);
    const grandTotal = quote.total + addonsTotal;

    const guestsRaw = Number(body?.guests);
    const guests =
      Number.isInteger(guestsRaw) && guestsRaw > 0 && guestsRaw <= 20 ? guestsRaw : null;

    // ---- Betalningsval: gästen väljer, annars Stripe > Swish > ingen ----
    const requested = String(body?.paymentMethod ?? "");
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
    const stripeOk = Boolean(stripeKey);
    const swishOk = Boolean(property.swish_number);
    let paymentMethod: "none" | "swish" | "stripe" = "none";
    if (requested === "stripe" && stripeOk) paymentMethod = "stripe";
    else if (requested === "swish" && swishOk) paymentMethod = "swish";
    else if (requested) return json({ error: "payment_method_unavailable" }, 400);
    else if (stripeOk) paymentMethod = "stripe";
    else if (swishOk) paymentMethod = "swish";

    // Betalda flöden: bokningen skapas som 'pending' med kort betalningsmärke.
    // Swish: operatören markerar "Betald" manuellt. Stripe: webhooks gör det.
    const paymentRef = `SB-${crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`;
    const takesPayment = paymentMethod !== "none";

    const addonsNote = pricedAddons.length
      ? ` · Tillval: ${pricedAddons.map((p) => `${p.addon.name}×${p.quantity}`).join(", ")}`
      : "";
    const { data: booking, error } = await admin
      .from("bookings")
      .insert({
        property_id: property.id,
        unit_id: unit.id,
        source: "direct",
        guest_name: guestName || null,
        guest_email: guestEmail || null,
        guest_phone: guestPhone || null,
        checkin_date: checkin,
        checkout_date: checkout,
        guests,
        addons_total: addonsTotal,
        notes: `Direktbokning via bokningssidan · ${grandTotal} kr${addonsNote}`,
        payment_method: paymentMethod,
        ...(takesPayment
          ? { payment_status: "pending", payment_amount: grandTotal, payment_ref: paymentRef }
          : {}),
      })
      .select("id, guest_token")
      .single();
    if (error) return json({ error: error.message }, 500);

    // Spara valda tillval med fryst pris — historiken ändras aldrig i efterhand.
    if (pricedAddons.length) {
      const { error: addonError } = await admin.from("booking_addons").insert(
        pricedAddons.map((p) => ({
          booking_id: booking.id,
          addon_id: p.addon.id,
          quantity: p.quantity,
          unit_price: p.addon.price,
        })),
      );
      if (addonError) {
        await admin.from("bookings").delete().eq("id", booking.id);
        return json({ error: addonError.message }, 500);
      }
    }

    // Stripe: skapa Checkout Session och skicka gästen dit. Misslyckas det
    // rullar vi tillbaka bokningen så inga spökbokningar blockerar kalendern.
    if (paymentMethod === "stripe") {
      try {
        const appBase = Deno.env.get("PUBLIC_APP_URL") ?? req.headers.get("origin") ?? "";
        const session = await createCheckoutSession({
          secretKey: stripeKey,
          amountSek: grandTotal,
          description: `${unit.name} · ${checkin}–${checkout}`,
          paymentRef,
          bookingId: booking.id,
          successUrl: `${appBase}/g/${booking.guest_token}?paid=1`,
          cancelUrl: `${appBase}/boka/${slug}`,
          customerEmail: guestEmail || null,
        });
        await admin.from("bookings").update({ stripe_session_id: session.id }).eq("id", booking.id);
        return json({
          ok: true,
          bookingId: booking.id,
          guestToken: booking.guest_token,
          price: quote,
          addons: pricedAddons.map((p) => ({
            name: p.addon.name,
            quantity: p.quantity,
            lineTotal: p.lineTotal,
          })),
          grandTotal,
          paymentMethod: "stripe",
          checkoutUrl: session.url,
        });
      } catch (e) {
        await admin.from("bookings").delete().eq("id", booking.id);
        return json({ error: "stripe_failed", detail: String(e) }, 502);
      }
    }

    return json({
      ok: true,
      bookingId: booking.id,
      guestToken: booking.guest_token,
      price: quote,
      addons: pricedAddons.map((p) => ({
        name: p.addon.name,
        quantity: p.quantity,
        lineTotal: p.lineTotal,
      })),
      grandTotal,
      ...(paymentMethod === "swish"
        ? { swishNumber: property.swish_number, paymentRef, paymentAmount: grandTotal }
        : {}),
    });
  }

  return json({ error: "method_not_allowed" }, 405);
});

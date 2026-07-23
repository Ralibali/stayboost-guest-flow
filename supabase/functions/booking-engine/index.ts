import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { nightsBetween, quoteStay, rangesOverlap } from "../_shared/pricing.ts";
import {
  checkAvailabilityRules,
  minStayFromRules,
  rulesForUnit,
  type RateRule,
} from "../_shared/rate-rules.ts";
import { priceAddons, sumAddons } from "../_shared/addons.ts";
import { createCheckoutSession } from "../_shared/stripe.ts";

// Publik bokningsmotor. All prissättning, kapacitet och tillgänglighet
// verifieras server-side. Databastriggern serialiserar samtidiga direktbokningar.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Duplicerar src/lib/phone.ts — måste vara identisk med klientvalideringen.
function normalizePhoneSE(input: string): string | null {
  if (!input) return null;
  let n = input.replace(/[\s().\-]/g, "");
  if (!n) return null;
  if (n.startsWith("+")) n = n.slice(1);
  else if (n.startsWith("00")) n = n.slice(2);
  else if (n.startsWith("0")) n = "46" + n.slice(1);
  if (!/^\d+$/.test(n)) return null;
  if (!n.startsWith("46")) return null;
  const local = n.slice(2);
  if (!/^7\d{8}$/.test(local)) return null;
  return `+46${local}`;
}

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

  // ---------------- GET: ledighet + priser + boendeprofil ----------------
  if (req.method === "GET") {
    const slug = url.searchParams.get("slug") ?? "";
    const { data: property } = await admin
      .from("properties")
      .select("id, name, slug, checkin_time, checkout_time, swish_number, swish_hold_minutes")
      .eq("slug", slug)
      .maybeSingle();
    if (!property) return json({ error: "not_found" }, 404);

    const { data: units, error: unitsError } = await admin
      .from("units")
      .select(
        "id, name, description, image_url, max_guests, bed_description, size_sqm, amenities, base_price, weekend_pct, min_stay, cleaning_fee, monthly_mult, sort_order",
      )
      .eq("property_id", property.id)
      .eq("active", true)
      .order("sort_order");
    if (unitsError) return json({ error: unitsError.message }, 500);

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
        swishHoldMinutes: property.swish_hold_minutes,
        stripeAvailable: Boolean(Deno.env.get("STRIPE_SECRET_KEY")),
      },
      units: (units ?? []).map((u) => ({
        id: u.id,
        name: u.name,
        description: u.description,
        imageUrl: u.image_url,
        maxGuests: u.max_guests,
        bedDescription: u.bed_description,
        sizeSqm: u.size_sqm,
        amenities: u.amenities ?? [],
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

    // Honeypot: riktiga användare ser aldrig fältet.
    if (String(body?.website ?? "").trim()) return json({ error: "invalid_request" }, 400);

    // Begränsa automatiserade massbokningar utan att lagra IP-adressen i klartext.
    const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const ip = req.headers.get("cf-connecting-ip") ?? forwarded ?? req.headers.get("x-real-ip") ?? "unknown";
    const salt = Deno.env.get("RATE_LIMIT_SALT") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "stayboost";
    const ipHash = await sha256(`${salt}:${ip}`);
    const windowStart = new Date(Date.now() - 15 * 60_000).toISOString();
    const { count } = await admin
      .from("booking_attempts")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("created_at", windowStart);
    if ((count ?? 0) >= 12) return json({ error: "rate_limited" }, 429);
    await admin.from("booking_attempts").insert({ ip_hash: ipHash });
    await admin.from("booking_attempts").delete().lt("created_at", new Date(Date.now() - 86400000).toISOString());

    const { slug, unitId, checkin, checkout } = body ?? {};
    const guestName = String(body?.guest_name ?? "").trim();
    const guestEmail = String(body?.guest_email ?? "").trim().toLowerCase();
    const guestPhoneRaw = String(body?.guest_phone ?? "").trim();
    const normalizedPhone = guestPhoneRaw ? normalizePhoneSE(guestPhoneRaw) : null;

    if (!ISO_DATE.test(checkin ?? "") || !ISO_DATE.test(checkout ?? "") || checkout <= checkin) {
      return json({ error: "invalid_dates" }, 400);
    }
    const today = new Date().toISOString().slice(0, 10);
    if (checkin < today) return json({ error: "past_checkin" }, 400);
    if (nightsBetween(checkin, checkout).length > 30) return json({ error: "too_long" }, 400);
    if (guestName.length < 2 || guestName.length > 120) return json({ error: "name_required" }, 400);
    if (!EMAIL.test(guestEmail) || guestEmail.length > 254) return json({ error: "email_required" }, 400);
    if (guestPhoneRaw && !normalizedPhone) return json({ error: "invalid_phone" }, 400);
    if (body?.termsAccepted !== true) return json({ error: "terms_required" }, 400);

    const { data: property } = await admin
      .from("properties")
      .select("id, swish_number, swish_hold_minutes")
      .eq("slug", slug)
      .maybeSingle();
    if (!property) return json({ error: "not_found" }, 404);

    const { data: unit } = await admin
      .from("units")
      .select(
        "id, name, property_id, active, max_guests, base_price, weekend_pct, min_stay, cleaning_fee, monthly_mult",
      )
      .eq("id", unitId)
      .eq("property_id", property.id)
      .eq("active", true)
      .maybeSingle();
    if (!unit) return json({ error: "unit_not_found" }, 404);

    const guestsRaw = Number(body?.guests);
    if (!Number.isInteger(guestsRaw) || guestsRaw < 1 || guestsRaw > unit.max_guests) {
      return json({ error: "capacity_exceeded", maxGuests: unit.max_guests }, 400);
    }
    const guests = guestsRaw;

    if (nightsBetween(checkin, checkout).length < unit.min_stay) {
      return json({ error: "min_stay", minStay: unit.min_stay }, 400);
    }

    // Förkontroll för ett vänligt svar. Databastriggern gör samma kontroll atomärt.
    const { data: clashes } = await admin
      .from("bookings")
      .select("checkin_date, checkout_date")
      .eq("unit_id", unit.id)
      .eq("status", "confirmed")
      .lt("checkin_date", checkout)
      .gt("checkout_date", checkin);
    if ((clashes ?? []).some((c) => rangesOverlap(checkin, checkout, c.checkin_date, c.checkout_date))) {
      return json({ error: "unavailable" }, 409);
    }

    const quote = quoteStay(unit, checkin, checkout);

    const rawSelections = Array.isArray(body?.addons) ? body.addons : [];
    const { data: availableAddons } = await admin
      .from("addons")
      .select("id, name, description, price, price_type, image_url, active, sort_order")
      .eq("property_id", property.id)
      .eq("active", true);
    const pricedAddons = priceAddons(rawSelections, availableAddons ?? [], quote.nights);
    const addonsTotal = sumAddons(pricedAddons);
    const grandTotal = quote.total + addonsTotal;

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

    // Vid Swish krävs telefon för att kunna följa upp betalning och skicka SMS-påminnelse.
    if (paymentMethod === "swish" && !normalizedPhone) {
      return json({ error: "phone_required_for_swish" }, 400);
    }

    const paymentRef = `SB-${crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`;
    const takesPayment = paymentMethod !== "none";
    const paymentExpiresAt =
      paymentMethod === "swish"
        ? new Date(Date.now() + property.swish_hold_minutes * 60_000).toISOString()
        : null;

    const addonsNote = pricedAddons.length
      ? ` · Tillval: ${pricedAddons.map((p) => `${p.addon.name}×${p.quantity}`).join(", ")}`
      : "";

    const { data: booking, error } = await admin
      .from("bookings")
      .insert({
        property_id: property.id,
        unit_id: unit.id,
        source: "direct",
        guest_name: guestName,
        guest_email: guestEmail,
        guest_phone: normalizedPhone,
        checkin_date: checkin,
        checkout_date: checkout,
        guests,
        addons_total: addonsTotal,
        notes: `Direktbokning via bokningssidan · ${grandTotal} kr${addonsNote}`,
        payment_method: paymentMethod,
        payment_expires_at: paymentExpiresAt,
        ...(takesPayment
          ? { payment_status: "pending", payment_amount: grandTotal, payment_ref: paymentRef }
          : {}),
      })
      .select("id, guest_token")
      .single();

    if (error) {
      if (error.code === "23P01" || error.message.includes("booking_overlap")) {
        return json({ error: "unavailable" }, 409);
      }
      return json({ error: "booking_failed", detail: error.message }, 500);
    }

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
        return json({ error: "booking_failed", detail: addonError.message }, 500);
      }
    }

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
          customerEmail: guestEmail,
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
        ? {
            swishNumber: property.swish_number,
            paymentRef,
            paymentAmount: grandTotal,
            paymentExpiresAt,
            swishHoldMinutes: property.swish_hold_minutes,
          }
        : {}),
    });
  }

  return json({ error: "method_not_allowed" }, 405);
});

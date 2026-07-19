import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { nightsBetween, quoteStay, rangesOverlap } from "../_shared/pricing.ts";

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
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const url = new URL(req.url);

  // ---------------- GET: ledighet + priser ----------------
  if (req.method === "GET") {
    const slug = url.searchParams.get("slug") ?? "";
    const { data: property } = await admin
      .from("properties")
      .select("id, name, slug, checkin_time, checkout_time")
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
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (!property) return json({ error: "not_found" }, 404);

    const { data: unit } = await admin
      .from("units")
      .select("id, property_id, base_price, weekend_pct, min_stay, cleaning_fee, monthly_mult")
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
        notes: `Direktbokning via bokningssidan · ${quote.total} kr`,
      })
      .select("id, guest_token")
      .single();
    if (error) return json({ error: error.message }, 500);

    return json({
      ok: true,
      bookingId: booking.id,
      guestToken: booking.guest_token,
      price: quote,
    });
  }

  return json({ error: "method_not_allowed" }, 405);
});

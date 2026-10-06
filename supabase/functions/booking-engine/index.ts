import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  nightsBetween,
  partyIssue,
  partySize,
  quoteStay,
  rangesOverlap,
  type BookingParty,
} from "../_shared/pricing.ts";
import {
  checkAvailabilityRules,
  minStayFromRules,
  rulesForUnit,
  type RateRule,
} from "../_shared/rate-rules.ts";
import { priceAddons, sumAddons, type Addon } from "../_shared/addons.ts";
import { createCheckoutSession, expireCheckoutSession } from "../_shared/stripe.ts";
import { appBaseUrl } from "../_shared/app-url.ts";
import { normalizeGuestPhone } from "../_shared/guest-contact.ts";
import { stockholmDay } from "../_shared/guest-stay.ts";
import { collectPages } from "../_shared/pagination.ts";
import { sanitizedHttpsUrl } from "../_shared/public-links.ts";
import { channelInventoryFresh } from "../_shared/channel-freshness.ts";
import { projectUnitContent } from "../_shared/unit-content.ts";
import { localizedAddonText, projectAddonContent } from "../_shared/addon-content.ts";

// Publik bokningsmotor. All prissättning, kapacitet och tillgänglighet
// verifieras server-side. Databastriggern serialiserar samtidiga direktbokningar.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Stripe requires Checkout expiry to be at least 30 minutes from session creation.
// Use 31 minutes so DB work before the API call cannot push us below that minimum.
const STRIPE_HOLD_SECONDS = 31 * 60;

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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
  const channelInventoryReady = async (propertyId: string) => {
    try {
      const { data: connections, error } = await admin
        .from("channel_connections")
        .select("enabled, last_booking_sync_at, last_ari_sync_at, last_error")
        .eq("property_id", propertyId);
      return (
        !error &&
        Array.isArray(connections) &&
        connections.every((connection) => channelInventoryFresh(connection))
      );
    } catch {
      return false;
    }
  };
  const loadRules = (propertyId: string, fromDate: string) =>
    collectPages<RateRule>((from, to) =>
      admin
        .from("rate_rules")
        .select(
          "id, unit_id, kind, date_from, date_to, fixed_price, adult_prices, pct_delta, min_stay, priority, active, name",
        )
        .eq("property_id", propertyId)
        .eq("active", true)
        .gte("date_to", fromDate)
        .order("created_at")
        .order("id")
        .range(from, to),
    );
  const loadAddons = async (propertyId: string): Promise<Addon[]> => {
    const stored = await collectPages<
      Addon & {
        unit_scope: "all" | "selected";
        addon_units: { unit_id: string }[];
      }
    >((from, to) =>
      admin
        .from("addons")
        .select(
          "id, name, description, content_translations, vat_rate, price, price_type, fulfillment_type, image_url, active, sort_order, internal_only, available_from, available_to, max_quantity, unit_scope, addon_units(unit_id)",
        )
        .eq("property_id", propertyId)
        .eq("active", true)
        .order("sort_order")
        .order("id")
        .range(from, to),
    );
    return stored.map((addon) => ({
      ...addon,
      allowed_unit_ids:
        addon.unit_scope === "selected"
          ? (addon.addon_units ?? []).map((link) => link.unit_id)
          : null,
    }));
  };

  // ---------------- GET: ledighet + priser + boendeprofil ----------------
  if (req.method === "GET") {
    const slug = url.searchParams.get("slug") ?? "";
    const { data: property, error: propertyError } = await admin
      .from("properties")
      .select(
        "id, name, slug, checkin_time, checkout_time, swish_number, swish_hold_minutes, booking_enabled, max_stay, contact_email, booking_terms_url",
      )
      .eq("slug", slug)
      .maybeSingle();
    if (propertyError) return json({ error: "booking_unavailable" }, 503);
    if (!property) return json({ error: "not_found" }, 404);
    const { data: unmapped, error: channelError } = await admin
      .from("channel_booking_revisions")
      .select("revision_id")
      .eq("property_id", property.id)
      .eq("status", "pending_mapping")
      .limit(1);
    if (channelError || unmapped?.length || !(await channelInventoryReady(property.id)))
      return json(
        {
          error: "channel_sync_required",
          property: { name: property.name, contactEmail: property.contact_email },
        },
        503,
      );

    const { data: units, error: unitsError } = await admin
      .from("units")
      .select(
        "id, name, description, image_url, content_translations, gallery, max_guests, bed_description, size_sqm, amenities, base_price, weekend_pct, min_stay, cleaning_fee, monthly_mult, sort_order, party_pricing_enabled, adult_prices, child_price_per_night, child_free_through_age, child_max_age",
      )
      .eq("property_id", property.id)
      .eq("active", true)
      .order("sort_order");
    if (unitsError) return json({ error: unitsError.message }, 500);

    const today = stockholmDay();
    const until = stockholmDay(new Date(Date.now() + 365 * 86400000));
    let bookings: { unit_id: string | null; checkin_date: string; checkout_date: string }[];
    try {
      bookings = await collectPages((from, to) =>
        admin
          .from("bookings")
          .select("id, unit_id, checkin_date, checkout_date")
          .eq("property_id", property.id)
          .eq("status", "confirmed")
          .gte("checkout_date", today)
          .lte("checkin_date", until)
          .order("checkin_date")
          .order("id")
          .range(from, to),
      );
    } catch {
      return json({ error: "availability_unavailable" }, 503);
    }
    let addons: Addon[];
    let rules: RateRule[];
    try {
      addons = await loadAddons(property.id);
    } catch {
      return json({ error: "addons_unavailable" }, 503);
    }
    try {
      rules = await loadRules(property.id, today);
    } catch {
      return json({ error: "rules_unavailable" }, 503);
    }

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
        bookingEnabled: property.booking_enabled,
        availableThrough: until,
        maxStay: property.max_stay,
        contactEmail: property.contact_email,
        bookingTermsUrl: sanitizedHttpsUrl(property.booking_terms_url),
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
        imageUrl: sanitizedHttpsUrl(u.image_url),
        ...projectUnitContent(u, property.id, Deno.env.get("SUPABASE_URL")!),
        maxGuests: u.max_guests,
        bedDescription: u.bed_description,
        sizeSqm: u.size_sqm,
        amenities: u.amenities ?? [],
        basePrice: u.base_price,
        weekendPct: u.weekend_pct,
        minStay: u.min_stay,
        cleaningFee: u.cleaning_fee,
        monthlyMult: u.monthly_mult,
        partyPricingEnabled: u.party_pricing_enabled,
        adultPrices: u.adult_prices,
        childPricePerNight: u.child_price_per_night,
        childFreeThroughAge: u.child_free_through_age,
        childMaxAge: u.child_max_age,
        booked: byUnit.get(u.id) ?? [],
        rateRules: rulesForUnit(rules, u.id),
      })),
      addons: (addons ?? [])
        .filter((a) => !a.internal_only)
        .map((a) => ({
          id: a.id,
          name: a.name,
          description: a.description,
          price: a.price,
          priceType: a.price_type,
          imageUrl: a.image_url,
          availableFrom: a.available_from,
          availableTo: a.available_to,
          maxQuantity: a.max_quantity,
          fulfillmentType: a.fulfillment_type,
          allowedUnitIds: a.allowed_unit_ids,
          ...projectAddonContent(a),
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
    const ip =
      req.headers.get("cf-connecting-ip") ?? forwarded ?? req.headers.get("x-real-ip") ?? "unknown";
    const salt =
      Deno.env.get("RATE_LIMIT_SALT") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "stayboost";
    const ipHash = await sha256(`${salt}:${ip}`);
    const windowStart = new Date(Date.now() - 15 * 60_000).toISOString();
    const { count } = await admin
      .from("booking_attempts")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("created_at", windowStart);
    if ((count ?? 0) >= 12) return json({ error: "rate_limited" }, 429);
    await admin.from("booking_attempts").insert({ ip_hash: ipHash });
    await admin
      .from("booking_attempts")
      .delete()
      .lt("created_at", new Date(Date.now() - 86400000).toISOString());

    const { slug, unitId, checkin, checkout } = body ?? {};
    const guestName = String(body?.guest_name ?? "").trim();
    const guestEmail = String(body?.guest_email ?? "")
      .trim()
      .toLowerCase();
    const guestPhoneRaw = String(body?.guest_phone ?? "").trim();
    const normalizedPhone = guestPhoneRaw ? normalizeGuestPhone(guestPhoneRaw) : null;
    const language = ["sv", "en", "de"].includes(body?.language) ? body.language : "sv";

    if (!ISO_DATE.test(checkin ?? "") || !ISO_DATE.test(checkout ?? "") || checkout <= checkin) {
      return json({ error: "invalid_dates" }, 400);
    }
    const today = stockholmDay();
    if (checkin < today) return json({ error: "past_checkin" }, 400);
    if (checkout > stockholmDay(new Date(Date.now() + 365 * 86400000)))
      return json({ error: "outside_booking_window" }, 400);
    if (nightsBetween(checkin, checkout).length === 0) return json({ error: "invalid_dates" }, 400);
    if (nightsBetween(checkin, checkout).length > 30) return json({ error: "too_long" }, 400);
    if (guestName.length < 2 || guestName.length > 120)
      return json({ error: "name_required" }, 400);
    if (!EMAIL.test(guestEmail) || guestEmail.length > 254)
      return json({ error: "email_required" }, 400);
    if (guestPhoneRaw && !normalizedPhone) return json({ error: "invalid_phone" }, 400);
    if (body?.termsAccepted !== true) return json({ error: "terms_required" }, 400);

    const { data: property, error: propertyError } = await admin
      .from("properties")
      .select("id, swish_number, swish_hold_minutes, booking_enabled, max_stay, booking_terms_url")
      .eq("slug", slug)
      .maybeSingle();
    if (propertyError) return json({ error: "booking_unavailable" }, 503);
    if (!property) return json({ error: "not_found" }, 404);
    if (!property.booking_enabled) return json({ error: "booking_paused" }, 409);
    const { data: unmapped, error: channelError } = await admin
      .from("channel_booking_revisions")
      .select("revision_id")
      .eq("property_id", property.id)
      .eq("status", "pending_mapping")
      .limit(1);
    if (channelError || unmapped?.length || !(await channelInventoryReady(property.id)))
      return json({ error: "channel_sync_required" }, 503);
    if (nightsBetween(checkin, checkout).length > property.max_stay)
      return json({ error: "too_long", maxStay: property.max_stay }, 400);

    const { data: unit, error: unitError } = await admin
      .from("units")
      .select(
        "id, name, property_id, active, max_guests, base_price, weekend_pct, min_stay, cleaning_fee, monthly_mult, party_pricing_enabled, adult_prices, child_price_per_night, child_free_through_age, child_max_age",
      )
      .eq("id", unitId)
      .eq("property_id", property.id)
      .eq("active", true)
      .maybeSingle();
    if (unitError) return json({ error: "booking_unavailable" }, 503);
    if (!unit) return json({ error: "unit_not_found" }, 404);

    const party: BookingParty | null =
      unit.party_pricing_enabled || body?.adults != null || body?.childrenAges != null
        ? { adults: body?.adults, childrenAges: body?.childrenAges }
        : null;
    if (party) {
      const issue = partyIssue(unit, party, unit.max_guests);
      if (issue) return json({ error: issue, maxGuests: unit.max_guests }, 400);
    }
    const guestsRaw = party ? partySize(party) : Number(body?.guests);
    if (!Number.isInteger(guestsRaw) || guestsRaw < 1 || guestsRaw > unit.max_guests) {
      return json({ error: "capacity_exceeded", maxGuests: unit.max_guests }, 400);
    }
    const guests = guestsRaw;

    // Datumstyrda regler (opt-in): min-stay, closed, no-arrival, no-departure.
    let rules: RateRule[];
    try {
      rules = await loadRules(property.id, checkin);
    } catch {
      return json({ error: "rules_unavailable" }, 503);
    }

    const stayNights = nightsBetween(checkin, checkout);
    const ruleMinStay = minStayFromRules(rules, unit.id, stayNights);
    const requiredMinStay = Math.max(unit.min_stay, ruleMinStay);
    if (stayNights.length < requiredMinStay) {
      return json({ error: "min_stay", minStay: requiredMinStay }, 400);
    }

    const availabilityIssue = checkAvailabilityRules(rules, unit.id, stayNights, checkout);
    if (availabilityIssue) {
      return json({ error: availabilityIssue.kind, date: availabilityIssue.date }, 409);
    }

    // Förkontroll för ett vänligt svar. Databastriggern gör samma kontroll atomärt.
    const { data: clashes, error: clashesError } = await admin
      .from("bookings")
      .select("checkin_date, checkout_date")
      .eq("unit_id", unit.id)
      .eq("status", "confirmed")
      .lt("checkin_date", checkout)
      .gt("checkout_date", checkin);
    if (clashesError) return json({ error: "availability_unavailable" }, 503);
    if (
      (clashes ?? []).some((c) => rangesOverlap(checkin, checkout, c.checkin_date, c.checkout_date))
    ) {
      return json({ error: "unavailable" }, 409);
    }

    let quote;
    try {
      quote = quoteStay(unit, checkin, checkout, {
        rules,
        unitId: unit.id,
        ...(party ? { party } : {}),
      });
    } catch {
      return json({ error: "pricing_unavailable" }, 409);
    }

    const rawSelections = Array.isArray(body?.addons) ? body.addons : [];
    let availableAddons: Addon[];
    try {
      availableAddons = await loadAddons(property.id);
    } catch {
      return json({ error: "addons_unavailable" }, 503);
    }
    const pricedAddons = priceAddons(rawSelections, availableAddons ?? [], quote.nights, {
      checkin,
      checkout,
      unitId: unit.id,
    });
    if (pricedAddons.length !== rawSelections.length) return json({ error: "invalid_addons" }, 400);
    const addonsTotal = sumAddons(pricedAddons);
    const grandTotal = quote.total + addonsTotal;
    if (!Number.isSafeInteger(grandTotal) || grandTotal < 0)
      return json({ error: "pricing_unavailable" }, 409);
    if (
      body?.expectedTotal != null &&
      (!Number.isSafeInteger(body.expectedTotal) || body.expectedTotal !== grandTotal)
    ) {
      return json({ error: "price_changed", grandTotal }, 409);
    }

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
    const stripeExpiresAtUnix =
      paymentMethod === "stripe" ? Math.floor(Date.now() / 1000) + STRIPE_HOLD_SECONDS : null;
    const paymentExpiresAt =
      paymentMethod === "swish"
        ? new Date(Date.now() + property.swish_hold_minutes * 60_000).toISOString()
        : stripeExpiresAtUnix
          ? new Date(stripeExpiresAtUnix * 1000).toISOString()
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
        adults: party?.adults ?? guests,
        children_ages: party?.childrenAges ?? [],
        quote_snapshot: {
          version: 1,
          currency: "SEK",
          language,
          terms: {
            accepted: true,
            url: sanitizedHttpsUrl(property.booking_terms_url),
            acceptedAt: new Date().toISOString(),
          },
          party: party ?? { adults: guests, childrenAges: [] },
          ...quote,
          addons: pricedAddons.map((line) => {
            const content = projectAddonContent(line.addon);
            return {
              id: line.addon.id,
              ...localizedAddonText({ ...line.addon, ...content }, language),
              ...content,
              taxInclusive: content.vatRate == null ? null : true,
              quantity: line.quantity,
              unitPrice: line.addon.price,
              priceType: line.addon.price_type,
              fulfillmentType: line.addon.fulfillment_type ?? "arrival",
              lineTotal: line.lineTotal,
            };
          }),
          addonsTotal,
          grandTotal,
        },
        addons_total: addonsTotal,
        notes: `Direktbokning via bokningssidan · ${grandTotal} kr${addonsNote}`,
        payment_method: paymentMethod,
        payment_amount: grandTotal,
        payment_expires_at: paymentExpiresAt,
        ...(takesPayment ? { payment_status: "pending", payment_ref: paymentRef } : {}),
      })
      .select("id, guest_token")
      .single();

    if (error) {
      if (
        error.message.includes("channel_sync_in_progress") ||
        error.message.includes("channel_inventory_syncing")
      ) {
        return json({ error: "channel_sync_in_progress" }, 503);
      }
      if (error.message.includes("channel_sync_required"))
        return json({ error: "channel_sync_required" }, 503);
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
      let createdSessionId: string | null = null;
      try {
        const appBase = appBaseUrl(Deno.env.get("PUBLIC_APP_URL"), req.headers.get("origin"));
        const session = await createCheckoutSession({
          secretKey: stripeKey,
          amountSek: grandTotal,
          description: `${unit.name} · ${checkin}–${checkout}`,
          paymentRef,
          bookingId: booking.id,
          successUrl: `${appBase}/g/${booking.guest_token}?paid=1&lang=${language}`,
          cancelUrl: `${appBase}/g/${booking.guest_token}?cancelled=1&lang=${language}`,
          customerEmail: guestEmail,
          expiresAtUnix: stripeExpiresAtUnix,
          idempotencyKey: `stayboost-checkout-${booking.id}`,
        });
        createdSessionId = session.id;

        const { data: boundBooking, error: bindError } = await admin
          .from("bookings")
          .update({ stripe_session_id: session.id })
          .eq("id", booking.id)
          .eq("status", "confirmed")
          .eq("payment_method", "stripe")
          .eq("payment_status", "pending")
          .select("id")
          .maybeSingle();
        if (bindError) throw new Error(`kunde inte binda Stripe-session: ${bindError.message}`);
        if (!boundBooking) throw new Error("bokningen ändrades innan Stripe-sessionen bands");

        return json({
          ok: true,
          bookingId: booking.id,
          guestToken: booking.guest_token,
          price: quote,
          addons: pricedAddons.map((p) => ({
            name: localizedAddonText({ ...p.addon, ...projectAddonContent(p.addon) }, language)
              .name,
            quantity: p.quantity,
            lineTotal: p.lineTotal,
          })),
          grandTotal,
          paymentMethod: "stripe",
          paymentExpiresAt,
          checkoutUrl: session.url,
        });
      } catch (e) {
        // Om Stripe redan hunnit skapa en session måste den stängas innan vi tar bort
        // bokningen. Misslyckas stängningen behåller vi reservationen till dess DB-expiry
        // så en orphaned Checkout URL aldrig kan sälja samma datum parallellt.
        if (createdSessionId) {
          try {
            await expireCheckoutSession(stripeKey, createdSessionId);
            await admin
              .from("bookings")
              .delete()
              .eq("id", booking.id)
              .eq("status", "confirmed")
              .eq("payment_status", "pending");
          } catch {
            return json({ error: "stripe_binding_failed", detail: String(e) }, 502);
          }
        } else {
          await admin
            .from("bookings")
            .delete()
            .eq("id", booking.id)
            .eq("status", "confirmed")
            .eq("payment_status", "pending");
        }
        return json({ error: "stripe_failed", detail: String(e) }, 502);
      }
    }

    return json({
      ok: true,
      bookingId: booking.id,
      guestToken: booking.guest_token,
      price: quote,
      addons: pricedAddons.map((p) => ({
        name: localizedAddonText({ ...p.addon, ...projectAddonContent(p.addon) }, language).name,
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

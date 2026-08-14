import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Publik gästsida. Tokenen i länken är nyckeln; endast kuraterade fält lämnar servern.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function zonedLocalToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.slice(0, 5).split(":").map(Number);
  const wallClock = Date.UTC(y, m - 1, d, hh, mm, 0);

  const offsetAt = (utcMs: number) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(utcMs));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    return Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second"),
    ) - utcMs;
  };

  let utc = wallClock - offsetAt(wallClock);
  utc = wallClock - offsetAt(utc); // andra passet hanterar DST-skiften bättre
  return new Date(utc);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  let token = new URL(req.url).searchParams.get("token") ?? "";
  if (req.method === "POST" && !token) {
    try {
      token = (await req.json())?.token ?? "";
    } catch {
      // Tom body är okej.
    }
  }
  if (!/^[0-9a-f]{24}$/.test(token)) return json({ error: "invalid_token" }, 400);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data, error } = await admin
    .from("bookings")
    .select(
      "id, property_id, guest_name, guests, checkin_date, checkout_date, status, payment_status, payment_amount, payment_ref, payment_expires_at, unit:units(name, door_code, checkin_instructions), property:properties(name, checkin_time, checkout_time, directions, wifi_name, wifi_password, house_rules, contact_phone, swish_number, timezone, access_code_lead_minutes)",
    )
    .eq("guest_token", token)
    .maybeSingle();

  if (error) return json({ error: "server_error" }, 500);
  if (!data || data.status !== "confirmed") return json({ error: "not_found" }, 404);

  const property: any = data.property;
  const unit: any = data.unit;
  const timezone = property?.timezone || "Europe/Stockholm";
  const leadMinutes = Math.max(0, Number(property?.access_code_lead_minutes ?? 15));
  const checkinAt = zonedLocalToUtc(data.checkin_date, property?.checkin_time || "15:00", timezone);
  const accessAt = new Date(checkinAt.getTime() - leadMinutes * 60_000);
  const accessUnlocked = Date.now() >= accessAt.getTime();

  const [{ data: addons }, { data: purchased }] = await Promise.all([
    admin
      .from("addons")
      .select(
        "id, name, description, price, price_type, image_url, capacity_per_day, fulfillment_note, sort_order",
      )
      .eq("property_id", data.property_id)
      .eq("active", true)
      .order("sort_order"),
    admin
      .from("booking_addons")
      .select(
        "quantity, unit_price, addon:addons(id, name, price_type, fulfillment_note)",
      )
      .eq("booking_id", data.id),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const canBuyAddons =
    Boolean(Deno.env.get("STRIPE_SECRET_KEY")) &&
    data.payment_status !== "pending" &&
    data.checkout_date > today;

  return json({
    guestName: data.guest_name,
    guests: data.guests,
    checkinDate: data.checkin_date,
    checkoutDate: data.checkout_date,
    unit: unit
      ? {
          name: unit.name,
          door_code: accessUnlocked ? unit.door_code : null,
          checkin_instructions: unit.checkin_instructions,
        }
      : null,
    access: {
      unlocked: accessUnlocked,
      availableAt: accessAt.toISOString(),
      leadMinutes,
      timezone,
    },
    property: {
      name: property?.name,
      checkin_time: property?.checkin_time,
      checkout_time: property?.checkout_time,
      directions: property?.directions,
      wifi_name: property?.wifi_name,
      wifi_password: property?.wifi_password,
      house_rules: property?.house_rules,
      contact_phone: property?.contact_phone,
      swish_number: property?.swish_number,
    },
    payment: data.payment_status
      ? {
          status: data.payment_status,
          amount: data.payment_amount,
          ref: data.payment_ref,
          expiresAt: data.payment_expires_at,
        }
      : null,
    addons: canBuyAddons ? addons ?? [] : [],
    purchasedAddons: (purchased ?? []).map((row: any) => ({
      id: row.addon?.id,
      name: row.addon?.name,
      quantity: row.quantity,
      unitPrice: row.unit_price,
      priceType: row.addon?.price_type,
      fulfillmentNote: row.addon?.fulfillment_note,
    })),
    canBuyAddons,
  });
});

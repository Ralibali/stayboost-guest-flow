import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { mapSirvoyPayload } from "../_shared/sirvoy.ts";

// StayBoost: tar emot Sirvoys "Booking event webhook" (URL callback API).
// Klistra denna funktions URL + anläggningens sirvoy_webhook_token in i
// Sirvoy (Inställningar → Integrationer → URL callback API), så landar
// nya/ändrade/avbokade bokningar här i realtid.
// OBS: verify_jwt = false — token i länken är nyckeln (se config.toml).

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

  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!/^[0-9a-f]{24}$/.test(token)) return json({ error: "invalid_token" }, 400);

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }

  const booking = mapSirvoyPayload(payload);
  if (!booking) return json({ error: "unmappable_payload" }, 422);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: property } = await admin
    .from("properties")
    .select("id")
    .eq("sirvoy_webhook_token", token)
    .maybeSingle();
  if (!property) return json({ error: "not_found" }, 404);

  // Rumsmappning: units.external_ref ska matcha Sirvoys rum (id eller namn)
  let unitId: string | null = null;
  if (booking.roomRef) {
    const { data: unit } = await admin
      .from("units")
      .select("id")
      .eq("property_id", property.id)
      .ilike("external_ref", booking.roomRef)
      .maybeSingle();
    unitId = unit?.id ?? null;
  }

  const row = {
    property_id: property.id,
    unit_id: unitId,
    source: "sirvoy",
    external_id: booking.externalId,
    guest_name: booking.guestName,
    guest_email: booking.guestEmail,
    guest_phone: booking.guestPhone,
    checkin_date: booking.checkin,
    checkout_date: booking.checkout,
    status: booking.cancelled ? "cancelled" : "confirmed",
  };

  // Upsert på (property_id, external_id) — samma event kan komma om igen,
  // ändringar skriver över datum/status men rör aldrig operatörens anteckningar.
  const { data: existing } = await admin
    .from("bookings")
    .select("id")
    .eq("property_id", property.id)
    .eq("external_id", booking.externalId)
    .maybeSingle();

  if (existing) {
    const { error } = await admin.from("bookings").update(row).eq("id", existing.id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, action: "updated", id: existing.id });
  }

  const { data: created, error } = await admin
    .from("bookings")
    .insert(row)
    .select("id")
    .single();
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, action: "created", id: created.id });
});

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// StayBoost: publik gästsida. Gäster loggar aldrig in — token i länken är
// nyckeln (24 hex-tecken, 96 bitar entropi, unik per bokning).
// OBS: kräver verify_jwt = false för denna funktion (se supabase/config.toml).
// Ingen anon-RLS behövs: all läsning sker med service role här, och
// endast ett kuraterat urval fält lämnar servern.

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

  let token = new URL(req.url).searchParams.get("token") ?? "";
  if (req.method === "POST" && !token) {
    try {
      token = (await req.json())?.token ?? "";
    } catch {
      /* tomt body är ok */
    }
  }
  if (!/^[0-9a-f]{24}$/.test(token)) return json({ error: "invalid_token" }, 400);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const { data, error } = await admin
    .from("bookings")
    .select(
      "guest_name, checkin_date, checkout_date, status, unit:units(name, door_code), property:properties(name, checkin_time, checkout_time, directions, wifi_name, wifi_password, house_rules, contact_phone)"
    )
    .eq("guest_token", token)
    .maybeSingle();

  if (error) return json({ error: "server_error" }, 500);
  if (!data || data.status !== "confirmed") return json({ error: "not_found" }, 404);

  return json({
    guestName: data.guest_name,
    checkinDate: data.checkin_date,
    checkoutDate: data.checkout_date,
    unit: data.unit,
    property: data.property,
  });
});

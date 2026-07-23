import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Publik gästsida. Tokenen i länken är nyckeln; endast kuraterade fält lämnar servern.

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
      "guest_name, checkin_date, checkout_date, status, payment_status, payment_amount, payment_ref, payment_expires_at, unit:units(name, door_code, checkin_instructions), property:properties(name, checkin_time, checkout_time, directions, wifi_name, wifi_password, house_rules, contact_phone, swish_number)",
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
    payment: data.payment_status
      ? {
          status: data.payment_status,
          amount: data.payment_amount,
          ref: data.payment_ref,
          expiresAt: data.payment_expires_at,
        }
      : null,
  });
});

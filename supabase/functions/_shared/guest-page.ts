// StayBoost: publik gästsida. Tokenen i länken är nyckeln; endast kuraterade
// fält lämnar servern. Isolering: property_id härleds från token eller slug.
// Booking-raden hämtas aldrig på guest_token / ref ensamt.

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export type TenantQuery = {
  select: (columns: string) => TenantQuery;
  eq: (column: string, value: unknown) => TenantQuery;
  maybeSingle: () => Promise<{ data: any; error: any }>;
};

export type TenantAdmin = {
  from: (table: string) => TenantQuery;
};

const TOKEN_RE = /^[0-9a-f]{24}$/;

const GUEST_SELECT =
  "guest_name, checkin_date, checkout_date, status, payment_method, payment_status, payment_amount, payment_ref, payment_expires_at, unit:units(name, door_code, checkin_instructions), property:properties(name, checkin_time, checkout_time, directions, wifi_name, wifi_password, house_rules, contact_phone, swish_number)";

async function derivePropertyId(
  admin: TenantAdmin,
  token: string,
  slug: string,
): Promise<{ propertyId: string | null; error: boolean }> {
  if (slug) {
    const { data, error } = await admin.from("properties").select("id").eq("slug", slug).maybeSingle();
    if (error) return { propertyId: null, error: true };
    return { propertyId: data?.id ?? null, error: false };
  }
  const { data, error } = await admin
    .from("bookings")
    .select("property_id")
    .eq("guest_token", token)
    .maybeSingle();
  if (error) return { propertyId: null, error: true };
  return { propertyId: data?.property_id ?? null, error: false };
}

export async function handleGuestPage(req: Request, admin: TenantAdmin): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  const url = new URL(req.url);
  let token = url.searchParams.get("token") ?? "";
  let slug = (url.searchParams.get("slug") ?? "").trim();
  if (req.method === "POST" && (!token || !slug)) {
    try {
      const body = await req.json();
      if (!token) token = body?.token ?? "";
      if (!slug) slug = String(body?.slug ?? "").trim();
    } catch {
      // Tom body är okej.
    }
  }
  if (!TOKEN_RE.test(token)) return json({ error: "invalid_token" }, 400);

  const derived = await derivePropertyId(admin, token, slug);
  if (derived.error) return json({ error: "server_error" }, 500);
  if (!derived.propertyId) return json({ error: "not_found" }, 404);

  const { data, error } = await admin
    .from("bookings")
    .select(GUEST_SELECT)
    .eq("guest_token", token)
    .eq("property_id", derived.propertyId)
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
          method: data.payment_method,
          status: data.payment_status,
          amount: data.payment_amount,
          ref: data.payment_ref,
          expiresAt: data.payment_expires_at,
        }
      : null,
  });
}

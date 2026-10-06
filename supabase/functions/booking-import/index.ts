import { stripeReadiness } from "../_shared/stripe-config.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { emailProviderConfigured } from "../_shared/email-provider.ts";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
Deno.serve(async (req) => {
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!bearer) return json({ error: "not_authenticated" }, 401);
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const {
    data: { user },
    error: authError,
  } = await admin.auth.getUser(bearer);
  if (authError || !user) return json({ error: "not_authenticated" }, 401);
  let body: { propertyId?: string; rows?: unknown; action?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  const { data: property, error: propertyError } = await admin
    .from("properties")
    .select("id")
    .eq("id", body.propertyId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (propertyError) return json({ error: "database_unavailable" }, 503);
  if (!property) return json({ error: "not_authorized" }, 403);
  if (body.action === "readiness") {
    const { count: enabledSmsTemplates, error: templateError } = await admin
      .from("message_templates")
      .select("id", { count: "exact", head: true })
      .eq("property_id", property.id)
      .eq("enabled", true)
      .in("channel", ["sms", "both"]);
    if (templateError || enabledSmsTemplates == null)
      return json({ error: "readiness_unavailable" }, 503);
    // Configuration presence only. No key values, requests, emails or payments.
    return json({
      ...stripeReadiness(property.id, (name) => Deno.env.get(name)),
      emailConfigured: emailProviderConfigured((name) => Deno.env.get(name)),
      smsConfigured: Boolean(Deno.env.get("ELKS_API_USER") && Deno.env.get("ELKS_API_PASSWORD")),
      enabledSmsTemplates,
    });
  }
  if (!Array.isArray(body.rows) || body.rows.length < 1 || body.rows.length > 2000)
    return json({ error: "invalid_import" }, 400);
  const { data, error } = await admin.rpc("import_sirvoy_stays", {
    p_property: property.id,
    p_rows: body.rows,
  });
  if (error) {
    const reason = error.message.includes("booking_overlap")
      ? "booking_overlap"
      : error.message.includes("invalid_import")
        ? "invalid_import"
        : "import_failed";
    return json({ error: reason }, reason === "booking_overlap" ? 409 : 400);
  }
  return json({ ok: true, ...data });
});

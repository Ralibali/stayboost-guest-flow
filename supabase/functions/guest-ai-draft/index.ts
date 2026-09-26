import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildGuestAiSystemPrompt, normalizeAiDraft } from "../_shared/guest-ai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) return json({ error: "unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const apiUrl = Deno.env.get("GUEST_AI_API_URL") ?? "";
  const apiKey = Deno.env.get("GUEST_AI_API_KEY") ?? "";
  const model = Deno.env.get("GUEST_AI_MODEL") ?? "";

  if (!supabaseUrl || !anonKey) return json({ error: "server_not_configured" }, 500);
  if (!apiUrl || !apiKey || !model) return json({ error: "ai_not_configured" }, 503);

  let body: { messageId?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }

  const messageId = typeof body.messageId === "string" ? body.messageId.trim() : "";
  if (!messageId) return json({ error: "message_id_required" }, 400);

  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) return json({ error: "unauthorized" }, 401);

  const { data: message, error: messageError } = await client
    .from("chat_messages")
    .select("id,property_id,visitor_name,visitor_email,message")
    .eq("id", messageId)
    .single();
  if (messageError || !message) return json({ error: "message_not_found" }, 404);

  const [{ data: property, error: propertyError }, { data: units }, { data: knowledge }] = await Promise.all([
    client
      .from("properties")
      .select("id,name,guest_ai_enabled,guest_ai_instructions,checkin_time,checkout_time,directions,house_rules,contact_phone")
      .eq("id", message.property_id)
      .single(),
    client
      .from("units")
      .select("name,description,amenities,checkin_instructions")
      .eq("property_id", message.property_id)
      .eq("active", true)
      .order("sort_order"),
    client
      .from("guest_ai_knowledge")
      .select("question,answer")
      .eq("property_id", message.property_id)
      .eq("enabled", true)
      .order("created_at"),
  ]);

  if (propertyError || !property) return json({ error: "property_not_found" }, 404);
  if (!property.guest_ai_enabled) return json({ error: "ai_disabled" }, 409);

  const system = buildGuestAiSystemPrompt({
    propertyName: property.name,
    checkinTime: property.checkin_time,
    checkoutTime: property.checkout_time,
    directions: property.directions,
    houseRules: property.house_rules,
    contactPhone: property.contact_phone,
    operatorInstructions: property.guest_ai_instructions,
    units: (units ?? []).map((unit) => ({
      name: unit.name,
      description: unit.description,
      amenities: Array.isArray(unit.amenities) ? unit.amenities : [],
      checkinInstructions: unit.checkin_instructions,
    })),
    knowledge: knowledge ?? [],
  });

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 350,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: `Gäst: ${message.visitor_name ?? "okänd"}\nFråga:\n${message.message}\n\nSkriv endast svarsförslaget.`,
        },
      ],
    }),
  });

  if (!response.ok) {
    console.error("[guest-ai-draft] provider error", response.status, await response.text());
    return json({ error: "ai_provider_error" }, 502);
  }

  const payload = await response.json();
  const draft = normalizeAiDraft(payload?.choices?.[0]?.message?.content);
  if (!draft) return json({ error: "empty_ai_response" }, 502);

  const createdAt = new Date().toISOString();
  const { error: updateError } = await client
    .from("chat_messages")
    .update({ ai_draft: draft, ai_draft_created_at: createdAt })
    .eq("id", message.id);
  if (updateError) return json({ error: "draft_save_failed" }, 500);

  return json({ ok: true, draft, createdAt });
});

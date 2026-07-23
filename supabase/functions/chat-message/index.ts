import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chatEmailBody, chatEmailSubject, validateChatInput } from "../_shared/chat.ts";
import { sendBrevoEmail } from "../_shared/email.ts";

// StayBoost: publik chatt-endpoint (verify_jwt = false, se config.toml).
//  GET  ?slug=<anläggningens slug> → widgetens publika konfiguration
//  POST {slug, name, email, message, pageUrl, company?} → spara + mejla ägaren
// Integritet: GET lämnar bara ut det som syns i widgeten — aldrig chat_email.

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

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ---------------- GET: widget-konfiguration ----------------
  if (req.method === "GET") {
    const slug = new URL(req.url).searchParams.get("slug") ?? "";
    const { data: p } = await admin
      .from("properties")
      .select(
        "chat_enabled, chat_title, chat_greeting, chat_color, chat_position, chat_button_label",
      )
      .eq("slug", slug)
      .maybeSingle();
    if (!p || !p.chat_enabled) return json({ enabled: false });
    return json({
      enabled: true,
      title: p.chat_title,
      greeting: p.chat_greeting,
      color: p.chat_color,
      position: p.chat_position,
      buttonLabel: p.chat_button_label,
    });
  }

  // ---------------- POST: nytt meddelande ----------------
  if (req.method === "POST") {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid_body" }, 400);
    }

    const validated = validateChatInput(body ?? {});
    if (validated === "bot") return json({ ok: true }); // honeypot — låtsas att allt gick bra
    if (!validated) return json({ error: "invalid_input" }, 400);

    const slug = String(body.slug ?? "");
    const { data: p } = await admin
      .from("properties")
      .select("id, name, chat_enabled, chat_email")
      .eq("slug", slug)
      .maybeSingle();
    if (!p || !p.chat_enabled) return json({ error: "not_found" }, 404);

    // Enkel återkomst-spärr: max 10 meddelanden per e-postadress och timme.
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await admin
      .from("chat_messages")
      .select("id", { count: "exact", head: true })
      .eq("property_id", p.id)
      .eq("visitor_email", validated.email)
      .gte("created_at", since);
    if ((count ?? 0) >= 10) return json({ error: "too_many" }, 429);

    // Spara i inkorgen först — mejl får aldrig sänka ett meddelande.
    const { data: msg, error } = await admin
      .from("chat_messages")
      .insert({
        property_id: p.id,
        visitor_name: validated.name,
        visitor_email: validated.email,
        message: validated.message,
        page_url: validated.pageUrl,
      })
      .select("id")
      .single();
    if (error) return json({ error: error.message }, 500);

    // Mejla ägaren om mottagaradress + Brevo är konfigurerat.
    const brevoKey = Deno.env.get("BREVO_API_KEY") ?? "";
    if (p.chat_email && brevoKey) {
      try {
        await sendBrevoEmail({
          apiKey: brevoKey,
          senderEmail: Deno.env.get("BREVO_SENDER_EMAIL") ?? "",
          senderName: `${p.name} · chatt`,
          toEmail: p.chat_email,
          subject: chatEmailSubject(p.name, validated.name),
          text: chatEmailBody({
            propertyName: p.name,
            name: validated.name,
            email: validated.email,
            message: validated.message,
            pageUrl: validated.pageUrl,
          }),
          replyToEmail: validated.email,
          replyToName: validated.name ?? undefined,
        });
        await admin.from("chat_messages").update({ emailed: true }).eq("id", msg.id);
      } catch (e) {
        // Meddelandet är säkert i inkorgen — logga och svara ändå ok.
        console.error("chatt-mejl misslyckades", e);
      }
    }

    return json({ ok: true });
  }

  return json({ error: "method_not_allowed" }, 405);
});

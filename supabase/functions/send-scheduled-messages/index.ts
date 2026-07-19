import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { formatSvDate, renderTemplate } from "../_shared/templates.ts";

// StayBoost: skickar förfallna schemalagda meddelanden.
// Körs på cron var 5:e minut med x-cron-secret.
// Kontakt-gate: saknas e-post/telefon lämnas raden pending (operatören
// hinner fylla i) tills send_at är 7 dagar gammal ⇒ failed med tydligt fel.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  const secret = req.headers.get("x-cron-secret");
  const expected = Deno.env.get("CRON_SECRET");
  if (!expected || secret !== expected) return json({ error: "unauthorized" }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const baseUrl = (Deno.env.get("GUEST_PAGE_BASE_URL") ?? "").replace(/\/$/, "");

  const { data: due, error } = await admin
    .from("scheduled_messages")
    .select(
      "id, channel, send_at, template:message_templates(subject, body), booking:bookings(id, guest_name, guest_email, guest_phone, checkin_date, checkout_date, guest_token, unit:units(name), property:properties(name, checkin_time, checkout_time, directions, wifi_name, wifi_password, contact_phone, review_url))"
    )
    .eq("status", "pending")
    .lte("send_at", new Date().toISOString())
    .order("send_at", { ascending: true })
    .limit(50);
  if (error) return json({ error: error.message }, 500);

  let sent = 0,
    failed = 0,
    waitingContact = 0;
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  for (const row of due ?? []) {
    const b: any = row.booking;
    const p: any = b?.property;
    const tpl: any = row.template;
    if (!b || !p || !tpl) {
      await admin
        .from("scheduled_messages")
        .update({ status: "failed", error: "bokning eller mall saknas" })
        .eq("id", row.id);
      failed++;
      continue;
    }

    const contact = row.channel === "email" ? b.guest_email : b.guest_phone;
    if (!contact) {
      if (new Date(row.send_at).getTime() < sevenDaysAgo) {
        await admin
          .from("scheduled_messages")
          .update({ status: "failed", error: "saknar kontaktuppgift" })
          .eq("id", row.id);
        failed++;
      } else {
        waitingContact++;
      }
      continue;
    }

    const vars: Record<string, string> = {
      gäst_namn: b.guest_name || "gäst",
      anläggning: p.name ?? "",
      enhet: b.unit?.name ?? "",
      incheckning: formatSvDate(b.checkin_date),
      utcheckning: formatSvDate(b.checkout_date),
      incheckningstid: p.checkin_time ?? "",
      utcheckningstid: p.checkout_time ?? "",
      gästsida_länk: baseUrl ? `${baseUrl}/g/${b.guest_token}` : "",
      wifi_namn: p.wifi_name ?? "",
      wifi_lösenord: p.wifi_password ?? "",
      vägbeskrivning: p.directions ?? "",
      recensionslänk: p.review_url ?? "",
    };
    const body = renderTemplate(tpl.body ?? "", vars);
    const subject = renderTemplate(tpl.subject ?? "", vars);

    try {
      if (row.channel === "email") {
        const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: {
            "api-key": Deno.env.get("BREVO_API_KEY") ?? "",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sender: {
              email: Deno.env.get("BREVO_SENDER_EMAIL") ?? "",
              name: Deno.env.get("BREVO_SENDER_NAME") ?? p.name,
            },
            to: [{ email: contact, name: b.guest_name ?? undefined }],
            subject: subject || `Meddelande från ${p.name}`,
            textContent: body,
          }),
        });
        if (!resp.ok)
          throw new Error(`Brevo ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
      } else {
        const auth = btoa(
          `${Deno.env.get("ELKS_API_USER") ?? ""}:${Deno.env.get("ELKS_API_PASSWORD") ?? ""}`
        );
        const resp = await fetch("https://api.46elks.com/a1/sms", {
          method: "POST",
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            from: Deno.env.get("ELKS_SENDER") ?? "Gastklar",
            to: contact,
            message: body,
          }),
        });
        if (!resp.ok)
          throw new Error(`46elks ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
      }
      await admin
        .from("scheduled_messages")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", row.id);
      sent++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await admin
        .from("scheduled_messages")
        .update({ status: "failed", error: msg.slice(0, 500) })
        .eq("id", row.id);
      failed++;
    }
  }

  return json({ due: (due ?? []).length, sent, failed, waitingContact });
});

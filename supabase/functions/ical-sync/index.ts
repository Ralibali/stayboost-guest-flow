import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { guestNameFrom, isBlockEvent, parseIcs } from "../_shared/ics.ts";

// StayBoost: synkar bokningar från iCal-källor (Airbnb, Booking.com m.fl.).
// Auth: x-cron-secret (alla källor) ELLER användar-JWT (endast egna källor,
// för "Synka nu"-knappen i appen).
// Viktigt beteende:
//  - Kontaktuppgifter som operatören fyllt i skrivs ALDRIG över av synken.
//  - Event som försvunnit ur flödet ⇒ framtida bokningar avbokas
//    (kanalernas iCal tar bort avbokade event istället för att flagga dem).
//  - Block ("Not available"/"Closed") är inte bokningar och hoppas över.

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

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Auth: cron-hemlighet ⇒ alla källor; annars användarens JWT ⇒ egna källor.
  let ownerFilter: string | null = null;
  const cronSecret = req.headers.get("x-cron-secret");
  const expected = Deno.env.get("CRON_SECRET");
  if (!expected || cronSecret !== expected) {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "unauthorized" }, 401);
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: userData, error } = await userClient.auth.getUser();
    if (error || !userData?.user) return json({ error: "unauthorized" }, 401);
    ownerFilter = userData.user.id;
  }

  let query = admin
    .from("ical_sources")
    .select("id, property_id, unit_id, name, url, properties!inner(owner_id)");
  if (ownerFilter) query = query.eq("properties.owner_id", ownerFilter);
  const { data: sources, error: srcErr } = await query;
  if (srcErr) return json({ error: srcErr.message }, 500);

  const today = new Date().toISOString().slice(0, 10);
  const results: Array<Record<string, unknown>> = [];

  for (const src of sources ?? []) {
    let created = 0,
      updated = 0,
      cancelled = 0;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const resp = await fetch(src.url, { signal: controller.signal, redirect: "follow" });
      clearTimeout(timer);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const events = parseIcs(await resp.text()).filter(
        (e) => !isBlockEvent(e) && e.status !== "CANCELLED"
      );

      const { data: existing } = await admin
        .from("bookings")
        .select("id, ical_uid, guest_name, checkin_date, checkout_date, status")
        .eq("ical_source_id", src.id);
      const byUid = new Map((existing ?? []).map((b) => [b.ical_uid, b]));
      const feedUids = new Set(events.map((e) => e.uid));

      for (const ev of events) {
        const prev = byUid.get(ev.uid);
        if (!prev) {
          const { error } = await admin.from("bookings").insert({
            property_id: src.property_id,
            unit_id: src.unit_id,
            source: "ical",
            ical_source_id: src.id,
            ical_uid: ev.uid,
            guest_name: guestNameFrom(ev.summary),
            checkin_date: ev.startDate,
            checkout_date: ev.endDate,
          });
          if (!error) created++;
        } else if (
          prev.checkin_date !== ev.startDate ||
          prev.checkout_date !== ev.endDate ||
          prev.status !== "confirmed"
        ) {
          const patch: Record<string, unknown> = {
            checkin_date: ev.startDate,
            checkout_date: ev.endDate,
            status: "confirmed",
          };
          if (!prev.guest_name && guestNameFrom(ev.summary))
            patch.guest_name = guestNameFrom(ev.summary);
          const { error } = await admin.from("bookings").update(patch).eq("id", prev.id);
          if (!error) updated++;
        }
      }

      // Framtida bokningar som försvunnit ur flödet ⇒ avbokade i kanalen.
      for (const b of existing ?? []) {
        if (
          b.ical_uid &&
          !feedUids.has(b.ical_uid) &&
          b.status === "confirmed" &&
          b.checkin_date >= today
        ) {
          const { error } = await admin
            .from("bookings")
            .update({ status: "cancelled" })
            .eq("id", b.id);
          if (!error) cancelled++;
        }
      }

      await admin
        .from("ical_sources")
        .update({
          last_synced_at: new Date().toISOString(),
          last_status: `ok (${events.length} event, +${created} nya, ${updated} uppdaterade, ${cancelled} avbokade)`,
        })
        .eq("id", src.id);
      results.push({ source: src.name, ok: true, created, updated, cancelled });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await admin
        .from("ical_sources")
        .update({ last_synced_at: new Date().toISOString(), last_status: `fel: ${msg}` })
        .eq("id", src.id);
      results.push({ source: src.name, ok: false, error: msg });
    }
  }

  return json({ synced: results.length, results });
});

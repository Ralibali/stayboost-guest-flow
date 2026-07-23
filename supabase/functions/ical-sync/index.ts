import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { guestNameFrom, isBlockEvent, parseIcs } from "../_shared/ics.ts";

// Synkar bokningar från iCal-källor. Auth sker med cron-hemlighet eller användar-JWT.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

function isPrivateHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "::1" ||
    host.startsWith("fe80:") ||
    host.startsWith("fc") ||
    host.startsWith("fd")
  )
    return true;
  if (/^(0|10|127|169\.254|192\.168)\./.test(host)) return true;
  const match172 = host.match(/^172\.(\d+)\./);
  return Boolean(match172 && Number(match172[1]) >= 16 && Number(match172[1]) <= 31);
}

function safeFeedUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password &&
      !isPrivateHostname(url.hostname)
    );
  } catch {
    return false;
  }
}

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

  let ownerFilter: string | null = null;
  const cronSecret = req.headers.get("x-cron-secret");
  const expected = Deno.env.get("CRON_SECRET");
  if (!expected || cronSecret !== expected) {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "unauthorized" }, 401);
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error } = await userClient.auth.getUser();
    if (error || !userData?.user) return json({ error: "unauthorized" }, 401);
    ownerFilter = userData.user.id;
  }

  let query = admin
    .from("ical_sources")
    .select("id, property_id, unit_id, name, url, properties!inner(owner_id)");
  if (ownerFilter) query = query.eq("properties.owner_id", ownerFilter);
  const { data: sources, error: sourceError } = await query;
  if (sourceError) return json({ error: sourceError.message }, 500);

  const today = new Date().toISOString().slice(0, 10);
  const results: Array<Record<string, unknown>> = [];

  for (const source of sources ?? []) {
    let created = 0;
    let updated = 0;
    let cancelled = 0;
    try {
      if (!safeFeedUrl(source.url)) throw new Error("otillåten kalender-URL");

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      let response: Response;
      try {
        response = await fetch(source.url, {
          signal: controller.signal,
          redirect: "follow",
          headers: { "User-Agent": "StayBoost-iCal/1.0" },
        });
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!safeFeedUrl(response.url)) throw new Error("otillåten omdirigering");
      const declaredLength = Number(response.headers.get("content-length") ?? 0);
      if (declaredLength > 2_000_000) throw new Error("kalenderfilen är för stor");
      const rawCalendar = await response.text();
      if (rawCalendar.length > 2_000_000) throw new Error("kalenderfilen är för stor");

      const events = parseIcs(rawCalendar).filter(
        (event) => !isBlockEvent(event) && event.status !== "CANCELLED",
      );

      const { data: existing } = await admin
        .from("bookings")
        .select("id, ical_uid, guest_name, checkin_date, checkout_date, status")
        .eq("ical_source_id", source.id);
      const byUid = new Map((existing ?? []).map((booking) => [booking.ical_uid, booking]));
      const feedUids = new Set(events.map((event) => event.uid));

      for (const event of events) {
        const previous = byUid.get(event.uid);
        if (!previous) {
          const { error } = await admin.from("bookings").insert({
            property_id: source.property_id,
            unit_id: source.unit_id,
            source: "ical",
            ical_source_id: source.id,
            ical_uid: event.uid,
            guest_name: guestNameFrom(event.summary),
            checkin_date: event.startDate,
            checkout_date: event.endDate,
          });
          if (!error) created++;
        } else if (
          previous.checkin_date !== event.startDate ||
          previous.checkout_date !== event.endDate ||
          previous.status !== "confirmed"
        ) {
          const patch: Record<string, unknown> = {
            checkin_date: event.startDate,
            checkout_date: event.endDate,
            status: "confirmed",
          };
          if (!previous.guest_name && guestNameFrom(event.summary)) {
            patch.guest_name = guestNameFrom(event.summary);
          }
          const { error } = await admin.from("bookings").update(patch).eq("id", previous.id);
          if (!error) updated++;
        }
      }

      for (const booking of existing ?? []) {
        if (
          booking.ical_uid &&
          !feedUids.has(booking.ical_uid) &&
          booking.status === "confirmed" &&
          booking.checkin_date >= today
        ) {
          const { error } = await admin
            .from("bookings")
            .update({ status: "cancelled" })
            .eq("id", booking.id);
          if (!error) cancelled++;
        }
      }

      await admin
        .from("ical_sources")
        .update({
          last_synced_at: new Date().toISOString(),
          last_status: `ok (${events.length} event, +${created} nya, ${updated} uppdaterade, ${cancelled} avbokade)`,
        })
        .eq("id", source.id);
      results.push({ source: source.name, ok: true, created, updated, cancelled });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await admin
        .from("ical_sources")
        .update({ last_synced_at: new Date().toISOString(), last_status: `fel: ${message}` })
        .eq("id", source.id);
      results.push({ source: source.name, ok: false, error: message });
    }
  }

  return json({ synced: results.length, results });
});

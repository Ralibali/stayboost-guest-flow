import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isCronAuthorized } from "../_shared/cron-auth.ts";
import { guestNameFrom, isBlockEvent, parseIcs } from "../_shared/ics.ts";
import {
  classifyDisappearancePolicy,
  nextMissingObservation,
} from "../_shared/ical-reconciliation.ts";

// Synkar bokningar från iCal-källor. Auth sker med cron-hemlighet eller användar-JWT.
// Säkerhetsprincip: ett event som saknas i en enskild lyckad fetch är INTE bevis
// på avbokning. Inventory hålls stängd tills försvinnandet har bekräftats över tid.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

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

async function fetchFeed(
  initialUrl: string,
  options: { etag?: string | null; lastModified?: string | null; signal: AbortSignal },
) {
  let currentUrl = initialUrl;

  for (let redirects = 0; redirects <= 3; redirects++) {
    if (!safeFeedUrl(currentUrl)) throw new Error("otillåten kalender-URL");

    const headers: Record<string, string> = { "User-Agent": "StayBoost-iCal/1.0" };
    if (options.etag) headers["If-None-Match"] = options.etag;
    if (options.lastModified) headers["If-Modified-Since"] = options.lastModified;

    const response = await fetch(currentUrl, {
      signal: options.signal,
      redirect: "manual",
      headers,
    });

    if (!REDIRECT_STATUSES.has(response.status)) return response;

    const location = response.headers.get("location");
    if (!location) throw new Error("ogiltig kalender-omdirigering");
    const nextUrl = new URL(location, currentUrl).toString();
    if (!safeFeedUrl(nextUrl)) throw new Error("otillåten kalender-omdirigering");
    currentUrl = nextUrl;
  }

  throw new Error("för många kalender-omdirigeringar");
}

function assertCalendarDocument(rawCalendar: string) {
  if (!/BEGIN:VCALENDAR(?:\r?\n|$)/i.test(rawCalendar) || !/END:VCALENDAR/i.test(rawCalendar)) {
    throw new Error("svaret är inte en giltig iCal-kalender");
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
  if (!(await isCronAuthorized(admin, cronSecret))) {
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
    .select(
      "id, property_id, unit_id, name, url, channel_type, paused, consecutive_failures, http_etag, http_last_modified, properties!inner(owner_id)",
    )
    .eq("paused", false);
  if (ownerFilter) query = query.eq("properties.owner_id", ownerFilter);
  const { data: sources, error: sourceError } = await query;
  if (sourceError) return json({ error: sourceError.message }, 500);

  const today = new Date().toISOString().slice(0, 10);
  const results: Array<Record<string, unknown>> = [];

  for (const source of sources ?? []) {
    let created = 0;
    let updated = 0;
    let cancelled = 0;
    let conflicts = 0;
    let protectedMissing = 0;
    try {
      if (!safeFeedUrl(source.url)) throw new Error("otillåten kalender-URL");

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      let response: Response;
      try {
        response = await fetchFeed(source.url, {
          etag: source.http_etag,
          lastModified: source.http_last_modified,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      const nowIso = new Date().toISOString();

      if (response.status === 304) {
        await admin
          .from("ical_sources")
          .update({
            last_synced_at: nowIso,
            last_attempt_at: nowIso,
            last_success_at: nowIso,
            consecutive_failures: 0,
            last_status: "ok (304 not modified)",
          })
          .eq("id", source.id);
        results.push({
          source: source.name,
          ok: true,
          notModified: true,
          created: 0,
          updated: 0,
          cancelled: 0,
          conflicts: 0,
          protectedMissing: 0,
        });
        continue;
      }

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const declaredLength = Number(response.headers.get("content-length") ?? 0);
      if (declaredLength > 2_000_000) throw new Error("kalenderfilen är för stor");
      const rawCalendar = await response.text();
      if (rawCalendar.length > 2_000_000) throw new Error("kalenderfilen är för stor");
      assertCalendarDocument(rawCalendar);

      const reservationEvents = parseIcs(rawCalendar).filter((event) => !isBlockEvent(event));
      const activeEvents = reservationEvents.filter((event) => event.status !== "CANCELLED");
      const explicitCancelledEvents = reservationEvents.filter(
        (event) => event.status === "CANCELLED",
      );

      const { data: existing, error: existingError } = await admin
        .from("bookings")
        .select(
          "id, ical_uid, guest_name, checkin_date, checkout_date, status, ical_missing_since, ical_missing_count, ical_cancelled_at, ical_cancel_reason",
        )
        .eq("ical_source_id", source.id);
      if (existingError) throw existingError;

      const byUid = new Map((existing ?? []).map((booking) => [booking.ical_uid, booking]));
      const activeUids = new Set(activeEvents.map((event) => event.uid));
      const explicitCancelledUids = new Set(explicitCancelledEvents.map((event) => event.uid));

      for (const event of activeEvents) {
        const previous = byUid.get(event.uid);
        if (!previous) {
          // Externa krockar måste importeras, inte döljas. BP-1:s DB-lås serialiserar
          // skrivningen men tillåter extern source truth att representeras.
          if (source.unit_id) {
            const { data: overlapping, error: overlapError } = await admin
              .from("bookings")
              .select("id")
              .eq("unit_id", source.unit_id)
              .eq("status", "confirmed")
              .lt("checkin_date", event.endDate)
              .gt("checkout_date", event.startDate)
              .limit(1);
            if (overlapError) throw overlapError;
            if ((overlapping ?? []).length > 0) conflicts++;
          }

          const { error } = await admin.from("bookings").insert({
            property_id: source.property_id,
            unit_id: source.unit_id,
            source: "ical",
            ical_source_id: source.id,
            ical_uid: event.uid,
            guest_name: guestNameFrom(event.summary),
            checkin_date: event.startDate,
            checkout_date: event.endDate,
            ical_missing_since: null,
            ical_missing_count: 0,
            ical_cancelled_at: null,
            ical_cancel_reason: null,
          });
          if (error) throw error;
          created++;
          continue;
        }

        const patch: Record<string, unknown> = {};
        if (previous.checkin_date !== event.startDate) patch.checkin_date = event.startDate;
        if (previous.checkout_date !== event.endDate) patch.checkout_date = event.endDate;
        if (previous.status !== "confirmed") patch.status = "confirmed";
        if (!previous.guest_name && guestNameFrom(event.summary)) {
          patch.guest_name = guestNameFrom(event.summary);
        }
        if (previous.ical_missing_since) patch.ical_missing_since = null;
        if ((previous.ical_missing_count ?? 0) !== 0) patch.ical_missing_count = 0;
        if (previous.ical_cancelled_at) patch.ical_cancelled_at = null;
        if (previous.ical_cancel_reason) patch.ical_cancel_reason = null;

        if (Object.keys(patch).length > 0) {
          const { error } = await admin.from("bookings").update(patch).eq("id", previous.id);
          if (error) throw error;
          updated++;
        }
      }

      // STATUS:CANCELLED är uttryckligt källbevis och kan behandlas direkt.
      for (const event of explicitCancelledEvents) {
        const previous = byUid.get(event.uid);
        if (!previous || previous.status === "cancelled") continue;
        const { error } = await admin
          .from("bookings")
          .update({
            status: "cancelled",
            ical_missing_since: null,
            ical_missing_count: 0,
            ical_cancelled_at: nowIso,
            ical_cancel_reason: "explicit",
          })
          .eq("id", previous.id);
        if (error) throw error;
        cancelled++;
      }

      const futureConfirmed = (existing ?? []).filter(
        (booking) =>
          booking.ical_uid &&
          booking.status === "confirmed" &&
          booking.checkin_date >= today &&
          !explicitCancelledUids.has(booking.ical_uid),
      );
      const missingCandidates = futureConfirmed.filter(
        (booking) => booking.ical_uid && !activeUids.has(booking.ical_uid),
      );
      const disappearancePolicy = classifyDisappearancePolicy({
        channelType: source.channel_type,
        activeFeedEvents: activeEvents.length,
        confirmedFutureBookings: futureConfirmed.length,
        missingCandidates: missingCandidates.length,
      });

      for (const booking of missingCandidates) {
        const decision = nextMissingObservation({
          previousMissingSince: booking.ical_missing_since,
          previousMissingCount: booking.ical_missing_count,
          nowIso,
          policy: disappearancePolicy,
        });
        const patch: Record<string, unknown> = {
          ical_missing_since: decision.missingSince,
          ical_missing_count: decision.missingCount,
        };
        if (decision.shouldCancel) {
          patch.status = "cancelled";
          patch.ical_cancelled_at = nowIso;
          patch.ical_cancel_reason = "disappearance";
          cancelled++;
        } else {
          protectedMissing++;
        }
        const { error } = await admin.from("bookings").update(patch).eq("id", booking.id);
        if (error) throw error;
      }

      await admin
        .from("ical_sources")
        .update({
          last_synced_at: nowIso,
          last_attempt_at: nowIso,
          last_success_at: nowIso,
          http_etag: response.headers.get("etag") ?? source.http_etag,
          http_last_modified: response.headers.get("last-modified") ?? source.http_last_modified,
          consecutive_failures: 0,
          last_status: `ok (${activeEvents.length} aktiva event, +${created} nya, ${updated} uppdaterade, ${cancelled} avbokade${protectedMissing > 0 ? `, ⚠ ${protectedMissing} försvinnanden skyddade (${disappearancePolicy})` : ""}${conflicts > 0 ? `, ⚠ ${conflicts} konflikter importerade` : ""})`,
        })
        .eq("id", source.id);
      results.push({
        source: source.name,
        ok: true,
        created,
        updated,
        cancelled,
        conflicts,
        protectedMissing,
        disappearancePolicy: missingCandidates.length > 0 ? disappearancePolicy : undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const nowIso = new Date().toISOString();
      await admin
        .from("ical_sources")
        .update({
          last_synced_at: nowIso,
          last_attempt_at: nowIso,
          consecutive_failures: (source.consecutive_failures ?? 0) + 1,
          last_status: `fel: ${message}`,
        })
        .eq("id", source.id);
      results.push({ source: source.name, ok: false, error: message });
    }
  }

  return json({ synced: results.length, results });
});

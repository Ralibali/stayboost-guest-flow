import { createClient } from "@supabase/supabase-js";
import { buildBusyIcs } from "../../supabase/functions/_shared/ics-export";
import {
  eventsForDestinationExport,
  extractExportToken,
  hashExportToken,
  isExportTokenShape,
  type ShadowCalendarEvent,
  type ShadowChannel,
} from "../../supabase/functions/_shared/ics-shadow";

/** GET /calendar/export/{token}.ics — app-host path for the shadow export. */
export async function handleCalendarExportRequest(request: Request): Promise<Response> {
  if (request.method !== "GET") {
    return new Response("method_not_allowed", { status: 405 });
  }

  const token = extractExportToken(request.url);
  if (!isExportTokenShape(token)) {
    return new Response("invalid_token", { status: 400 });
  }

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return new Response("export_unconfigured", { status: 503 });
  }

  const admin = createClient(url, key);
  const tokenHash = await hashExportToken(token);
  const { data: row } = await admin
    .from("calendar_export_tokens")
    .select("tenant_id, unit_id, destination_channel, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!row || row.revoked_at) {
    return new Response("not_found", { status: 404 });
  }

  const destination = row.destination_channel as ShadowChannel;
  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const until = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
  const { data: events } = await admin
    .from("calendar_events")
    .select("tenant_id, unit_id, channel, origin_channel, ical_uid, checkin_date, checkout_date, status")
    .eq("tenant_id", row.tenant_id)
    .eq("unit_id", row.unit_id)
    .gte("checkout_date", since)
    .lte("checkin_date", until);

  const exported = eventsForDestinationExport((events ?? []) as ShadowCalendarEvent[], destination);
  const ics = buildBusyIcs(
    exported.map((event) => ({
      uid: event.ical_uid,
      startDate: event.checkin_date,
      endDate: event.checkout_date,
    })),
    "StayBoost",
  );
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="calendar.ics"',
      "Cache-Control": "no-store",
    },
  });
}

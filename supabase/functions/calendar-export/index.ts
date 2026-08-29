import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildBusyIcs } from "../_shared/ics-export.ts";
import {
  eventsForDestinationExport,
  extractExportToken,
  hashExportToken,
  isExportTokenShape,
  type ShadowCalendarEvent,
  type ShadowChannel,
} from "../_shared/ics-shadow.ts";

// GET /calendar/export/{token}.ics  (and /functions/v1/calendar-export/{token}.ics)
// Busy VEVENTs only. No guest names, email, phone, or payment.
// verify_jwt = false — the hashed token is the capability.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function icsResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="calendar.ics"',
      "Cache-Control": "no-store",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "GET") return new Response("method_not_allowed", { status: 405, headers: corsHeaders });

  const token = extractExportToken(req.url);
  if (!isExportTokenShape(token)) {
    return new Response("invalid_token", { status: 400, headers: corsHeaders });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const tokenHash = await hashExportToken(token);
  const { data: row } = await admin
    .from("calendar_export_tokens")
    .select("tenant_id, unit_id, destination_channel, revoked_at, units(name), properties:tenant_id(name)")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!row || row.revoked_at) {
    return new Response("not_found", { status: 404, headers: corsHeaders });
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
  const unitName = (row as { units?: { name?: string } }).units?.name ?? "unit";
  const propertyName =
    (row as { properties?: { name?: string } }).properties?.name ?? "StayBoost";
  const ics = buildBusyIcs(
    exported.map((event) => ({
      uid: event.ical_uid,
      startDate: event.checkin_date,
      endDate: event.checkout_date,
    })),
    `${propertyName} — ${unitName}`,
  );
  return icsResponse(ics);
});

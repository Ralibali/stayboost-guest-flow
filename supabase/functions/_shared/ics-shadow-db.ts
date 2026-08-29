// Persist shadow ICS apply against Supabase (or any client with from()).
// Never logs feed URLs. Never writes bookings / never cancels Sirvoy.

import {
  applyShadowFeed,
  nightsForStay,
  type ShadowCalendarEvent,
  type ShadowChannel,
} from "./ics-shadow.ts";

type FilterBuilder = {
  eq: (column: string, value: unknown) => FilterBuilder;
  then: Promise<{ data: unknown; error: { message: string } | null }>;
};

type TableBuilder = {
  select: (cols: string) => FilterBuilder;
  insert: (row: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  upsert: (row: Record<string, unknown>, opts?: { onConflict?: string }) => Promise<{ data: unknown; error: { message: string } | null }>;
  update: (row: Record<string, unknown>) => FilterBuilder;
  delete: () => FilterBuilder;
};

export type ShadowAdmin = {
  from: (table: string) => TableBuilder;
};

const ACTIVE = new Set(["NEW", "UPDATED", "UNCHANGED"]);

export async function persistShadowFeed(
  admin: ShadowAdmin,
  input: {
    tenantId: string;
    unitId: string;
    channel: ShadowChannel;
    sourceId: string | null;
    rawIcs: string;
  },
) {
  const { data, error } = await admin
    .from("calendar_events")
    .select("id, tenant_id, unit_id, channel, origin_channel, ical_uid, checkin_date, checkout_date, status")
    .eq("tenant_id", input.tenantId)
    .eq("unit_id", input.unitId)
    .eq("channel", input.channel);
  if (error) throw new Error(error.message);

  const store = ((data as ShadowCalendarEvent[]) ?? []).map((row) => ({ ...row }));
  const result = applyShadowFeed(store, {
    tenantId: input.tenantId,
    unitId: input.unitId,
    channel: input.channel,
    rawIcs: input.rawIcs,
  });

  for (const event of store) {
    const { error: upsertError } = await admin.from("calendar_events").upsert(
      {
        tenant_id: event.tenant_id,
        unit_id: event.unit_id,
        ical_source_id: input.sourceId,
        channel: event.channel,
        origin_channel: event.origin_channel,
        ical_uid: event.ical_uid,
        checkin_date: event.checkin_date,
        checkout_date: event.checkout_date,
        status: event.status,
      },
      { onConflict: "tenant_id,channel,unit_id,ical_uid" },
    );
    if (upsertError) throw new Error(upsertError.message);
  }

  const { data: saved, error: savedError } = await admin
    .from("calendar_events")
    .select("id, ical_uid, checkin_date, checkout_date, status")
    .eq("tenant_id", input.tenantId)
    .eq("unit_id", input.unitId)
    .eq("channel", input.channel);
  if (savedError) throw new Error(savedError.message);

  for (const row of (saved as Array<{
    id: string;
    ical_uid: string;
    checkin_date: string;
    checkout_date: string;
    status: string;
  }>) ?? []) {
    await admin.from("calendar_occupancy").delete().eq("event_id", row.id);
    if (!ACTIVE.has(row.status)) continue;
    for (const night of nightsForStay(row.checkin_date, row.checkout_date)) {
      const { error: occError } = await admin.from("calendar_occupancy").insert({
        tenant_id: input.tenantId,
        unit_id: input.unitId,
        night,
        event_id: row.id,
      });
      if (occError) {
        // Unique night owned by another event: leave the existing occupant.
        // Shadow mode records the conflict via the event row; do not touch bookings.
        continue;
      }
    }
  }

  return result;
}

export function originFromBookingSource(source: string): ShadowChannel {
  if (source === "sirvoy") return "sirvoy";
  if (source === "direct") return "direct";
  if (source === "ical") return "other";
  return "stayboost";
}

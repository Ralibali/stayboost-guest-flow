import { guestNameFrom, isBlockEvent, type IcsEvent } from "./ics.ts";
import { classifyDisappearancePolicy, nextMissingObservation } from "./ical-reconciliation.ts";

// Isolering: property_id härleds från ical_sources.property_id efter att
// källan resolvats. Booking-rader hämtas/uppdateras aldrig på
// ical_source_id / unit_id / booking.id ensamt.

export type IcalSyncQuery = {
  select: (columns: string) => IcalSyncQuery;
  insert: (row: Record<string, unknown>) => Promise<{ error: { message?: string } | null }>;
  update: (patch: Record<string, unknown>) => IcalSyncQuery;
  eq: (column: string, value: unknown) => IcalSyncQuery;
  lt: (column: string, value: unknown) => IcalSyncQuery;
  gt: (column: string, value: unknown) => IcalSyncQuery;
  limit: (count: number) => IcalSyncQuery;
  then: (
    resolve: (value: { data?: any; error: any }) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise<unknown>;
};

export type IcalSyncAdmin = {
  from: (table: string) => IcalSyncQuery;
};

export type IcalSyncSource = {
  id: string;
  property_id?: string | null;
  unit_id?: string | null;
  name?: string;
  channel_type?: string | null;
};

export type IcalSyncStats = {
  created: number;
  updated: number;
  cancelled: number;
  conflicts: number;
  protectedMissing: number;
  skipped: boolean;
  disappearancePolicy?: string;
};

const BOOKING_SELECT =
  "id, ical_uid, guest_name, checkin_date, checkout_date, status, ical_missing_since, ical_missing_count, ical_cancelled_at, ical_cancel_reason";

type BookingRow = {
  id: string;
  ical_uid?: string | null;
  guest_name?: string | null;
  checkin_date: string;
  checkout_date: string;
  status: string;
  ical_missing_since?: string | null;
  ical_missing_count?: number | null;
  ical_cancelled_at?: string | null;
  ical_cancel_reason?: string | null;
};

export function tenantPropertyId(source: IcalSyncSource): string | null {
  const propertyId = String(source.property_id ?? "").trim();
  return propertyId || null;
}

export async function syncIcalSourceBookings(
  admin: IcalSyncAdmin,
  source: IcalSyncSource,
  reservationEvents: IcsEvent[],
  opts: { today: string; nowIso: string },
): Promise<IcalSyncStats> {
  const propertyId = tenantPropertyId(source);
  if (!propertyId) {
    return {
      created: 0,
      updated: 0,
      cancelled: 0,
      conflicts: 0,
      protectedMissing: 0,
      skipped: true,
    };
  }

  const events = reservationEvents.filter((event) => !isBlockEvent(event));
  const activeEvents = events.filter((event) => event.status !== "CANCELLED");
  const explicitCancelledEvents = events.filter((event) => event.status === "CANCELLED");

  const { data: existing, error: existingError } = (await admin
    .from("bookings")
    .select(BOOKING_SELECT)
    .eq("ical_source_id", source.id)
    .eq("property_id", propertyId)) as { data?: BookingRow[]; error: { message?: string } | null };
  if (existingError) throw existingError;

  const byUid = new Map((existing ?? []).map((booking) => [booking.ical_uid, booking] as const));
  let created = 0;
  let updated = 0;
  let cancelled = 0;
  let conflicts = 0;
  let protectedMissing = 0;

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
          .eq("property_id", propertyId)
          .eq("status", "confirmed")
          .lt("checkin_date", event.endDate)
          .gt("checkout_date", event.startDate)
          .limit(1);
        if (overlapError) throw overlapError;
        if ((overlapping ?? []).length > 0) conflicts++;
      }

      const { error } = await admin.from("bookings").insert({
        property_id: propertyId,
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
      const { error } = await admin
        .from("bookings")
        .update(patch)
        .eq("id", previous.id)
        .eq("property_id", propertyId);
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
        ical_cancelled_at: opts.nowIso,
        ical_cancel_reason: "explicit",
      })
      .eq("id", previous.id)
      .eq("property_id", propertyId);
    if (error) throw error;
    cancelled++;
  }

  const futureConfirmed = (existing ?? []).filter(
    (booking) =>
      booking.ical_uid &&
      booking.status === "confirmed" &&
      booking.checkin_date >= opts.today &&
      !explicitCancelledEvents.some((event) => event.uid === booking.ical_uid),
  );
  const missingCandidates = futureConfirmed.filter(
    (booking) => booking.ical_uid && !activeEvents.some((event) => event.uid === booking.ical_uid),
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
      nowIso: opts.nowIso,
      policy: disappearancePolicy,
    });
    const patch: Record<string, unknown> = {
      ical_missing_since: decision.missingSince,
      ical_missing_count: decision.missingCount,
    };
    if (decision.shouldCancel) {
      patch.status = "cancelled";
      patch.ical_cancelled_at = opts.nowIso;
      patch.ical_cancel_reason = "disappearance";
      cancelled++;
    } else {
      protectedMissing++;
    }
    const { error } = await admin
      .from("bookings")
      .update(patch)
      .eq("id", booking.id)
      .eq("property_id", propertyId);
    if (error) throw error;
  }

  return {
    created,
    updated,
    cancelled,
    conflicts,
    protectedMissing,
    skipped: false,
    disappearancePolicy: missingCandidates.length > 0 ? disappearancePolicy : undefined,
  };
}

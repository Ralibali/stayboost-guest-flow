// StayBoost ICS V1 (SHADOW): tenant-native import/export helpers.
// Ren TypeScript — used by ical-sync (shadow write), calendar-export, and tests.
// Does not write bookings and does not cancel Sirvoy reservations.

import { isBlockEvent, parseIcs } from "./ics.ts";
import { nightsBetween } from "./pricing.ts";

export const SHADOW_CHANNELS = [
  "sirvoy",
  "booking",
  "airbnb",
  "other",
  "stayboost",
  "direct",
] as const;

export type ShadowChannel = (typeof SHADOW_CHANNELS)[number];

export type ShadowEventStatus = "NEW" | "UPDATED" | "CANCELLED" | "REMOVED" | "UNCHANGED";

export type ShadowCalendarEvent = {
  tenant_id: string;
  unit_id: string;
  channel: ShadowChannel;
  origin_channel: ShadowChannel;
  ical_uid: string;
  checkin_date: string;
  checkout_date: string;
  status: ShadowEventStatus;
};

export type ShadowApplyInput = {
  tenantId: string;
  unitId: string;
  channel: ShadowChannel;
  rawIcs: string;
};

export type ShadowApplyResult = {
  actions: ShadowEventStatus[];
  events: ShadowCalendarEvent[];
};

const ACTIVE: ShadowEventStatus[] = ["NEW", "UPDATED", "UNCHANGED"];

export function nightsForStay(checkin: string, checkout: string): string[] {
  return nightsBetween(checkin, checkout);
}

export function eventsForDestinationExport(
  events: ShadowCalendarEvent[],
  destinationChannel: ShadowChannel,
): ShadowCalendarEvent[] {
  return events.filter(
    (event) => ACTIVE.includes(event.status) && event.origin_channel !== destinationChannel,
  );
}

export function redactFeedUrl(_url: string): string {
  return "[feed-url-redacted]";
}

export function sanitizeFeedError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/https?:\/\/[^\s]+/gi, "[feed-url-redacted]");
}

export function feedHealthAfterFailure(error: string, fetchedAt: string) {
  return {
    health: "FAILED" as const,
    last_fetch: fetchedAt,
    last_error: error,
  };
}

export function feedHealthAfterSuccess(fetchedAt: string, etag?: string | null, lastModified?: string | null) {
  return {
    health: "HEALTHY" as const,
    last_fetch: fetchedAt,
    last_success: fetchedAt,
    last_error: null,
    http_etag: etag ?? null,
    http_last_modified: lastModified ?? null,
  };
}

function findEvent(
  store: ShadowCalendarEvent[],
  tenantId: string,
  channel: ShadowChannel,
  unitId: string,
  uid: string,
) {
  return store.find(
    (event) =>
      event.tenant_id === tenantId &&
      event.channel === channel &&
      event.unit_id === unitId &&
      event.ical_uid === uid,
  );
}

export function applyShadowFeed(store: ShadowCalendarEvent[], input: ShadowApplyInput): ShadowApplyResult {
  const actions: ShadowEventStatus[] = [];
  const parsed = parseIcs(input.rawIcs).filter((event) => !isBlockEvent(event));
  const feedUids = new Set(parsed.map((event) => event.uid));

  for (const event of parsed) {
    const previous = findEvent(store, input.tenantId, input.channel, input.unitId, event.uid);
    if (!previous) {
      if (event.status === "CANCELLED") continue;
      const created: ShadowCalendarEvent = {
        tenant_id: input.tenantId,
        unit_id: input.unitId,
        channel: input.channel,
        origin_channel: input.channel,
        ical_uid: event.uid,
        checkin_date: event.startDate,
        checkout_date: event.endDate,
        status: "NEW",
      };
      store.push(created);
      actions.push("NEW");
      continue;
    }
    if (event.status === "CANCELLED") {
      previous.status = "CANCELLED";
      actions.push("CANCELLED");
      continue;
    }
    if (previous.checkin_date !== event.startDate || previous.checkout_date !== event.endDate) {
      previous.checkin_date = event.startDate;
      previous.checkout_date = event.endDate;
      previous.status = "UPDATED";
      actions.push("UPDATED");
      continue;
    }
    if (previous.status === "CANCELLED" || previous.status === "REMOVED") {
      previous.status = "UPDATED";
      actions.push("UPDATED");
      continue;
    }
    previous.status = previous.status === "NEW" ? "NEW" : "UNCHANGED";
    actions.push("UNCHANGED");
  }

  for (const existing of store) {
    if (
      existing.tenant_id === input.tenantId &&
      existing.channel === input.channel &&
      existing.unit_id === input.unitId &&
      !feedUids.has(existing.ical_uid) &&
      existing.status !== "REMOVED"
    ) {
      existing.status = "REMOVED";
      actions.push("REMOVED");
    }
  }

  return { actions, events: store };
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 256-bit token. Raw value is returned once; persist only the SHA-256 hex. */
export function generateExportToken(): string {
  return randomHex(32);
}

export async function hashExportToken(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw.trim().toLowerCase()));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function extractExportToken(url: string): string {
  const parsed = new URL(url);
  const query = parsed.searchParams.get("token");
  if (query) return query;
  const match = parsed.pathname.match(/\/(?:calendar\/export\/|calendar-export\/)([^/?#]+?)(?:\.ics)?$/);
  return match?.[1] ?? "";
}

export function isExportTokenShape(token: string): boolean {
  return /^[0-9a-f]{64}$/i.test(token);
}

export type OccupancyNight = { tenant_id: string; unit_id: string; night: string; event_uid: string };

export function occupancyNightsForEvent(event: ShadowCalendarEvent): OccupancyNight[] {
  if (!ACTIVE.includes(event.status)) return [];
  return nightsForStay(event.checkin_date, event.checkout_date).map((night) => ({
    tenant_id: event.tenant_id,
    unit_id: event.unit_id,
    night,
    event_uid: event.ical_uid,
  }));
}

export function occupancyConflicts(existing: OccupancyNight[], incoming: OccupancyNight[]): OccupancyNight[] {
  const taken = new Set(existing.map((row) => `${row.tenant_id}|${row.unit_id}|${row.night}`));
  return incoming.filter((row) => {
    const key = `${row.tenant_id}|${row.unit_id}|${row.night}`;
    const sameEvent = existing.some(
      (cur) =>
        cur.tenant_id === row.tenant_id &&
        cur.unit_id === row.unit_id &&
        cur.night === row.night &&
        cur.event_uid === row.event_uid,
    );
    return taken.has(key) && !sameEvent;
  });
}

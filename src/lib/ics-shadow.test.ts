import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { parseIcs } from "../../supabase/functions/_shared/ics";
import {
  buildBusyIcs,
  icsEscape,
} from "../../supabase/functions/_shared/ics-export";
import {
  applyShadowFeed,
  eventsForDestinationExport,
  extractExportToken,
  feedHealthAfterFailure,
  feedHealthAfterSuccess,
  generateExportToken,
  hashExportToken,
  nightsForStay,
  occupancyConflicts,
  occupancyNightsForEvent,
  redactFeedUrl,
  sanitizeFeedError,
  type ShadowCalendarEvent,
} from "../../supabase/functions/_shared/ics-shadow";

const TZ = "Europe/Stockholm";

function ev(
  overrides: Partial<ShadowCalendarEvent> &
    Pick<ShadowCalendarEvent, "ical_uid" | "origin_channel">,
): ShadowCalendarEvent {
  return {
    tenant_id: "t1",
    unit_id: "u1",
    channel: overrides.origin_channel,
    checkin_date: "2026-08-10",
    checkout_date: "2026-08-13",
    status: "NEW",
    ...overrides,
  };
}

describe("DATE-only nights must not shift (Europe/Stockholm, DST)", () => {
  it("VALUE=DATE keeps the night on the DST spring-forward day", () => {
    const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:dst-spring@airbnb.com
DTSTART;VALUE=DATE:20260329
DTEND;VALUE=DATE:20260331
SUMMARY:Reserved
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR`;
    const parsed = parseIcs(ics);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].startDate).toBe("2026-03-29");
    expect(parsed[0].endDate).toBe("2026-03-31");
  });

  it("VALUE=DATE keeps the night on the DST fall-back day", () => {
    const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:dst-fall@booking.com
DTSTART;VALUE=DATE:20261025
DTEND;VALUE=DATE:20261027
SUMMARY:Reserved
END:VEVENT
END:VCALENDAR`;
    const parsed = parseIcs(ics);
    expect(parsed[0].startDate).toBe("2026-10-25");
    expect(parsed[0].endDate).toBe("2026-10-27");
  });

  it("UTC DATE-TIME converts to Europe/Stockholm calendar date", () => {
    // 28 Mar 2026 23:00Z = 29 Mar 00:00 CET (still UTC+1, before 02:00 jump).
    const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:utc-shift@airbnb.com
DTSTART:20260328T230000Z
DTEND:20260331T100000Z
SUMMARY:Reserved
END:VEVENT
END:VCALENDAR`;
    const parsed = parseIcs(ics);
    expect(parsed[0].startDate).toBe("2026-03-29");
    expect(parsed[0].endDate).toBe("2026-03-31");
  });

  it("TZID=Europe/Stockholm wall clock keeps the printed date", () => {
    const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:tzid@stayboost
DTSTART;TZID=${TZ}:20260329T150000
DTEND;TZID=${TZ}:20260331T110000
SUMMARY:Reserved
END:VEVENT
END:VCALENDAR`;
    const parsed = parseIcs(ics);
    expect(parsed[0].startDate).toBe("2026-03-29");
    expect(parsed[0].endDate).toBe("2026-03-31");
  });

  it("busy export is DATE-only and round-trips without shifting a DST night", () => {
    const ics = buildBusyIcs(
      [
        {
          uid: "dst-export@stayboost",
          startDate: "2026-03-29",
          endDate: "2026-03-31",
        },
      ],
      "StayBoost shadow",
      { dtstamp: "2026-03-01T12:00:00.000Z", lastModified: "2026-03-01T12:00:00.000Z" },
    );
    expect(ics).toContain("DTSTART;VALUE=DATE:20260329");
    expect(ics).toContain("DTEND;VALUE=DATE:20260331");
    expect(ics).not.toMatch(/DTSTART[^:]*:\d{8}T/);
    const parsed = parseIcs(ics);
    expect(parsed[0].startDate).toBe("2026-03-29");
    expect(parsed[0].endDate).toBe("2026-03-31");
  });
});

describe("origin_channel loop prevention", () => {
  it("export MUST NOT re-emit events whose origin_channel equals the destination", () => {
    const events = [
      ev({ ical_uid: "airbnb-1", origin_channel: "airbnb" }),
      ev({ ical_uid: "stayboost-1", origin_channel: "stayboost", checkin_date: "2026-08-20", checkout_date: "2026-08-22" }),
      ev({ ical_uid: "booking-1", origin_channel: "booking", checkin_date: "2026-09-01", checkout_date: "2026-09-04" }),
    ];
    const forAirbnb = eventsForDestinationExport(events, "airbnb");
    expect(forAirbnb.map((e) => e.ical_uid)).toEqual(["stayboost-1", "booking-1"]);
    expect(forAirbnb.some((e) => e.origin_channel === "airbnb")).toBe(false);

    const ics = buildBusyIcs(
      forAirbnb.map((e) => ({
        uid: e.ical_uid,
        startDate: e.checkin_date,
        endDate: e.checkout_date,
      })),
      "unit-export",
    );
    expect(ics).toContain("SUMMARY:busy");
    expect(ics).not.toContain("airbnb-1");
    expect(ics).toContain("stayboost-1");
    expect(ics).toContain("booking-1");
    expect(ics).not.toMatch(/guest|@|payment|phone|email/i);
  });

  it("same-channel cancelled/removed events stay out of every destination feed", () => {
    const events = [
      ev({ ical_uid: "gone", origin_channel: "stayboost", status: "REMOVED" }),
      ev({ ical_uid: "cx", origin_channel: "stayboost", status: "CANCELLED" }),
    ];
    expect(eventsForDestinationExport(events, "airbnb")).toEqual([]);
  });
});

describe("ICS generate (busy VEVENT only)", () => {
  it("emits UID, DATE-only DTSTART/DTEND, DTSTAMP, LAST-MODIFIED, STATUS, SUMMARY=busy", () => {
    const ics = buildBusyIcs(
      [{ uid: "evt-1@stayboost", startDate: "2026-08-10", endDate: "2026-08-13" }],
      "Bergs — Sjöbris",
      { dtstamp: "2026-08-01T08:00:00.000Z", lastModified: "2026-08-02T09:00:00.000Z" },
    );
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("UID:evt-1@stayboost");
    expect(ics).toContain("DTSTART;VALUE=DATE:20260810");
    expect(ics).toContain("DTEND;VALUE=DATE:20260813");
    expect(ics).toContain("DTSTAMP:20260801T080000Z");
    expect(ics).toContain("LAST-MODIFIED:20260802T090000Z");
    expect(ics).toContain("STATUS:CONFIRMED");
    expect(ics).toContain("SUMMARY:busy");
    expect(ics).not.toContain("Anna");
    expect(ics).not.toContain("Bokad");
    expect(icsEscape("busy")).toBe("busy");
  });
});

describe("ICS parse + shadow upsert lifecycle", () => {
  it("parses a feed and upserts NEW then UPDATED then CANCELLED then REMOVED", () => {
    const first = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:stay-1@airbnb.com
DTSTART;VALUE=DATE:20260810
DTEND;VALUE=DATE:20260813
SUMMARY:Reserved
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR`;
    const store: ShadowCalendarEvent[] = [];
    const created = applyShadowFeed(store, {
      tenantId: "t1",
      unitId: "u1",
      channel: "airbnb",
      rawIcs: first,
    });
    expect(created.actions).toEqual(["NEW"]);
    expect(store[0]).toMatchObject({
      ical_uid: "stay-1@airbnb.com",
      status: "NEW",
      origin_channel: "airbnb",
      tenant_id: "t1",
      checkin_date: "2026-08-10",
      checkout_date: "2026-08-13",
    });

    const updatedFeed = first.replace("20260813", "20260814");
    const updated = applyShadowFeed(store, {
      tenantId: "t1",
      unitId: "u1",
      channel: "airbnb",
      rawIcs: updatedFeed,
    });
    expect(updated.actions).toEqual(["UPDATED"]);
    expect(store[0].checkout_date).toBe("2026-08-14");
    expect(store[0].status).toBe("UPDATED");

    const cancelledFeed = updatedFeed.replace("CONFIRMED", "CANCELLED");
    const cancelled = applyShadowFeed(store, {
      tenantId: "t1",
      unitId: "u1",
      channel: "airbnb",
      rawIcs: cancelledFeed,
    });
    expect(cancelled.actions).toEqual(["CANCELLED"]);
    expect(store[0].status).toBe("CANCELLED");

    const empty = applyShadowFeed(store, {
      tenantId: "t1",
      unitId: "u1",
      channel: "airbnb",
      rawIcs: "BEGIN:VCALENDAR\nEND:VCALENDAR\n",
    });
    expect(empty.actions).toEqual(["REMOVED"]);
    expect(store[0].status).toBe("REMOVED");
  });

  it("duplicate import of the same UID is a no-op, not a second row", () => {
    const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:dup@airbnb.com
DTSTART;VALUE=DATE:20260901
DTEND;VALUE=DATE:20260903
SUMMARY:Reserved
END:VEVENT
END:VCALENDAR`;
    const store: ShadowCalendarEvent[] = [];
    applyShadowFeed(store, { tenantId: "t1", unitId: "u1", channel: "airbnb", rawIcs: ics });
    const again = applyShadowFeed(store, {
      tenantId: "t1",
      unitId: "u1",
      channel: "airbnb",
      rawIcs: ics,
    });
    expect(store).toHaveLength(1);
    expect(again.actions).toEqual(["UNCHANGED"]);
  });
});

describe("timezone, back-to-back, overlap, occupancy nights", () => {
  it("occupancy nights are [checkin, checkout) so back-to-back checkout/check-in is allowed", () => {
    expect(nightsForStay("2026-08-10", "2026-08-12")).toEqual(["2026-08-10", "2026-08-11"]);
    const a = new Set(nightsForStay("2026-08-10", "2026-08-12"));
    const b = new Set(nightsForStay("2026-08-12", "2026-08-14"));
    for (const night of a) expect(b.has(night)).toBe(false);
  });

  it("overlapping stays share a night and occupancyConflicts reports it", () => {
    const a = new Set(nightsForStay("2026-08-10", "2026-08-13"));
    const b = nightsForStay("2026-08-12", "2026-08-14");
    expect(b.some((night) => a.has(night))).toBe(true);
    const first = occupancyNightsForEvent(ev({ ical_uid: "a", origin_channel: "airbnb" }));
    const second = occupancyNightsForEvent(
      ev({
        ical_uid: "b",
        origin_channel: "booking",
        checkin_date: "2026-08-12",
        checkout_date: "2026-08-15",
      }),
    );
    expect(occupancyConflicts(first, second).map((row) => row.night)).toEqual(["2026-08-12"]);
  });
});

describe("feed health + token + secrets hygiene", () => {
  it("failed feed is FAILED with last_fetch and error; success is HEALTHY", () => {
    const failed = feedHealthAfterFailure("HTTP 503", "2026-08-29T12:00:00.000Z");
    expect(failed).toMatchObject({
      health: "FAILED",
      last_fetch: "2026-08-29T12:00:00.000Z",
      last_error: "HTTP 503",
    });
    expect(failed.last_success).toBeUndefined();

    const ok = feedHealthAfterSuccess("2026-08-29T12:05:00.000Z", "W/\"abc\"", "Sat, 29 Aug 2026 12:00:00 GMT");
    expect(ok).toMatchObject({
      health: "HEALTHY",
      last_fetch: "2026-08-29T12:05:00.000Z",
      last_success: "2026-08-29T12:05:00.000Z",
      last_error: null,
      http_etag: "W/\"abc\"",
      http_last_modified: "Sat, 29 Aug 2026 12:00:00 GMT",
    });
  });

  it("export token is high-entropy, stored hashed, rotatable", async () => {
    const first = generateExportToken();
    const second = generateExportToken();
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).not.toBe(first);
    const hash1 = await hashExportToken(first);
    const hash2 = await hashExportToken(first);
    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(first);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never dumps a feed URL in logs", () => {
    const url = "https://sirvoy.example/secret-feed.ics?token=abc";
    expect(redactFeedUrl(url)).toBe("[feed-url-redacted]");
    expect(redactFeedUrl(url)).not.toContain("sirvoy");
    expect(redactFeedUrl(url)).not.toContain("abc");
    expect(sanitizeFeedError(new Error(`fetch ${url} failed`))).toBe("fetch [feed-url-redacted] failed");
    const token = "a".repeat(64);
    expect(extractExportToken(`https://stayboost.se/calendar/export/${token}.ics`)).toBe(token);
  });
});

const AUTH_STUB = `
create schema auth;
create table auth.users (id uuid primary key);
insert into auth.users values ('00000000-0000-0000-0000-0000000000a1');
create or replace function auth.uid() returns uuid language sql stable as
$$ select '00000000-0000-0000-0000-0000000000a1'::uuid $$;
`;

const MIGRATION_FAS1 = readFileSync(
  join(__dirname, "../../supabase/migrations/20260719000000_fas1.sql"),
  "utf8",
);
const MIGRATION_ICAL = readFileSync(
  join(__dirname, "../../supabase/migrations/20260719120000_ical_export.sql"),
  "utf8",
);
const MIGRATION_HEALTH = readFileSync(
  join(__dirname, "../../supabase/migrations/20260723000000_ical_source_health.sql"),
  "utf8",
);
const MIGRATION_SHADOW = readFileSync(
  join(__dirname, "../../supabase/migrations/20260829000000_ics_shadow_tenant.sql"),
  "utf8",
);

async function shadowDb() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(AUTH_STUB);
  await db.exec(MIGRATION_FAS1);
  await db.exec(MIGRATION_ICAL);
  await db.exec(MIGRATION_HEALTH);
  await db.exec(MIGRATION_SHADOW);
  const prop = await db.query<{ id: string }>(
    "insert into properties (owner_id, name) values ('00000000-0000-0000-0000-0000000000a1', 'Founder') returning id",
  );
  const unit = await db.query<{ id: string }>(
    "insert into units (property_id, name) values ($1, 'Sjöbris') returning id",
    [prop.rows[0].id],
  );
  return { db, tenantId: prop.rows[0].id, unitId: unit.rows[0].id };
}

describe("ICS shadow schema (tenant_id, occupancy, tokens)", () => {
  it("maps founder property as tenant_id and enforces unique (tenant, unit, night)", async () => {
    const { db, tenantId, unitId } = await shadowDb();
    const src = await db.query<{ id: string; tenant_id: string }>(
      `insert into ical_sources (property_id, unit_id, name, url, channel_type)
       values ($1, $2, 'Airbnb', 'https://example.test/feed.ics', 'airbnb')
       returning id, tenant_id`,
      [tenantId, unitId],
    );
    expect(src.rows[0].tenant_id).toBe(tenantId);

    const event = await db.query<{ id: string }>(
      `insert into calendar_events
         (tenant_id, unit_id, ical_source_id, channel, origin_channel, ical_uid, checkin_date, checkout_date, status)
       values ($1, $2, $3, 'airbnb', 'airbnb', 'uid-1', '2026-08-10', '2026-08-12', 'NEW')
       returning id`,
      [tenantId, unitId, src.rows[0].id],
    );
    await db.query(
      `insert into calendar_occupancy (tenant_id, unit_id, night, event_id)
       values ($1, $2, '2026-08-10', $3), ($1, $2, '2026-08-11', $3)`,
      [tenantId, unitId, event.rows[0].id],
    );
    await expect(
      db.query(
        `insert into calendar_occupancy (tenant_id, unit_id, night, event_id)
         values ($1, $2, '2026-08-10', $3)`,
        [tenantId, unitId, event.rows[0].id],
      ),
    ).rejects.toThrow();

    const backToBack = await db.query<{ id: string }>(
      `insert into calendar_events
         (tenant_id, unit_id, channel, origin_channel, ical_uid, checkin_date, checkout_date, status)
       values ($1, $2, 'stayboost', 'stayboost', 'uid-2', '2026-08-12', '2026-08-14', 'NEW')
       returning id`,
      [tenantId, unitId],
    );
    await db.query(
      `insert into calendar_occupancy (tenant_id, unit_id, night, event_id)
       values ($1, $2, '2026-08-12', $3), ($1, $2, '2026-08-13', $3)`,
      [tenantId, unitId, backToBack.rows[0].id],
    );

    const sameUid = `insert into calendar_events
      (tenant_id, unit_id, channel, origin_channel, ical_uid, checkin_date, checkout_date, status)
      values ($1, $2, 'airbnb', 'airbnb', 'uid-1', '2026-09-01', '2026-09-03', 'NEW')`;
    await expect(db.query(sameUid, [tenantId, unitId])).rejects.toThrow();
  }, 30000);

  it("stores export tokens hashed, rotatable and revocable, never the raw token", async () => {
    const { db, tenantId, unitId } = await shadowDb();
    const raw = generateExportToken();
    const hash = await hashExportToken(raw);
    await db.query(
      `insert into calendar_export_tokens (tenant_id, unit_id, destination_channel, token_hash)
       values ($1, $2, 'airbnb', $3)`,
      [tenantId, unitId, hash],
    );
    const stored = await db.query<{ token_hash: string; revoked_at: string | null }>(
      "select token_hash, revoked_at from calendar_export_tokens where tenant_id = $1",
      [tenantId],
    );
    expect(stored.rows[0].token_hash).toBe(hash);
    expect(stored.rows[0].token_hash).not.toBe(raw);
    expect(stored.rows[0].revoked_at).toBeNull();

    const rotated = generateExportToken();
    const rotatedHash = await hashExportToken(rotated);
    await db.query(
      `update calendar_export_tokens
          set revoked_at = now(), rotated_at = now()
        where token_hash = $1`,
      [hash],
    );
    await db.query(
      `insert into calendar_export_tokens (tenant_id, unit_id, destination_channel, token_hash)
       values ($1, $2, 'airbnb', $3)`,
      [tenantId, unitId, rotatedHash],
    );
    const active = await db.query<{ n: number }>(
      "select count(*)::int as n from calendar_export_tokens where tenant_id = $1 and revoked_at is null",
      [tenantId],
    );
    expect(active.rows[0].n).toBe(1);
    const lookupOld = await db.query<{ n: number }>(
      "select count(*)::int as n from calendar_export_tokens where token_hash = $1 and revoked_at is null",
      [hash],
    );
    expect(lookupOld.rows[0].n).toBe(0);
  }, 30000);

  it("does not weaken the existing managed-booking overlap trigger", async () => {
    const migration = readFileSync(
      join(__dirname, "../../supabase/migrations/20260722100000_production_hardening.sql"),
      "utf8",
    );
    const shadow = readFileSync(
      join(__dirname, "../../supabase/migrations/20260829000000_ics_shadow_tenant.sql"),
      "utf8",
    );
    expect(migration).toContain("prevent_managed_booking_overlap");
    expect(shadow).not.toContain("drop function public.prevent_managed_booking_overlap");
    expect(shadow).not.toContain("source not in ('manual', 'direct')");
  });
});

describe("shadow path guards (source)", () => {
  it("ical-sync writes calendar_events, skips Sirvoy cancel, never logs feed URLs", () => {
    const sync = readFileSync(
      join(__dirname, "../../supabase/functions/ical-sync/index.ts"),
      "utf8",
    );
    expect(sync).toContain("persistShadowFeed");
    expect(sync).toContain('channel !== "sirvoy"');
    expect(sync).toContain("sanitizeFeedError");
    expect(sync).toContain("If-None-Match");
    expect(sync).not.toContain("results.push({ source: source.name, url:");
  });

  it("calendar-export is busy-only and looks up the hashed token", () => {
    const exp = readFileSync(
      join(__dirname, "../../supabase/functions/calendar-export/index.ts"),
      "utf8",
    );
    expect(exp).toContain("buildBusyIcs");
    expect(exp).toContain("hashExportToken");
    expect(exp).toContain("eventsForDestinationExport");
    expect(exp).not.toContain("guest_name");
    expect(exp).not.toContain("guest_email");
    expect(exp).not.toContain("guest_phone");
    expect(exp).not.toContain("payment_");
  });
});

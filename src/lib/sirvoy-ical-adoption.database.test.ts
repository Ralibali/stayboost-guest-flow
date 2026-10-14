import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import {
  parseSirvoySource,
  SIRVOY_SOURCE_HEADERS,
  type SirvoySourceFormat,
  type SirvoySourceScope,
} from "../../supabase/functions/_shared/sirvoy-source-parser";
const read = (name: string) =>
  readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");
const OWNER = "00000000-0000-0000-0000-000000000001";
const OTHER = "00000000-0000-0000-0000-000000000002";
let db: PGlite;
let property: string;
let otherProperty: string;
let serial = 0;
type Pair = { accommodationRecordId: string; bookingRecordId: string };
const row = async <T = Record<string, unknown>>(sql: string, values: unknown[] = []) =>
  (await db.query<T>(sql, values)).rows[0];
const service = () =>
  db.exec(
    "reset role; set test.actor=''; set request.jwt.claim.role='service_role'; set role service_role;",
  );
const owner = (actor = OWNER) =>
  db.exec(
    `reset role; set test.actor='${actor}'; set request.jwt.claim.role='authenticated'; set role authenticated;`,
  );
const importRows = (pairs: Pair[], actor = OWNER, pid = property) =>
  row<{ result: { imported: number; skipped: number; bookingIds: string[] } }>(
    "select import_sirvoy_source_calendar($1,$2,$3) result",
    [actor, pid, JSON.stringify(pairs)],
  );
const addDays = (start: string, offset: number) => {
  const day = new Date(`${start}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + offset);
  return day.toISOString().slice(0, 10);
};
const decimalSum = (amounts: string[]) => {
  const total = amounts.reduce((sum, amount) => {
    const [whole, fraction = ""] = amount.split(".");
    return sum + BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  }, 0n);
  return `${total / 100n}.${(total % 100n).toString().padStart(2, "0")}`;
};
async function source(
  format: SirvoySourceFormat,
  fields: Record<string, string>[],
  pid: string,
  actor: string,
  scope: SirvoySourceScope = "excluding_cancelled",
  coverage = "2099-01-01",
) {
  const headers = SIRVOY_SOURCE_HEADERS[format];
  const quote = (text: string) => `"${text.replaceAll('"', '""')}"`;
  const bytes = new TextEncoder().encode(
    [headers, ...fields.map((record) => headers.map((header) => record[header] ?? ""))]
      .map((cells) => cells.map(quote).join(","))
      .join("\r\n") + "\r\n",
  );
  const archive = await row<{ id: string; sha256: string }>(
    "insert into sirvoy_export_archives(property_id,created_by,filename,export_kind,file_bytes,coverage_from,coverage_to,coverage_filter) values($1,$2,'synthetic.csv',$3,$4,$5,'2099-12-31','noncancelled source') returning id,sha256",
    [pid, actor, format, bytes, coverage],
  );
  const parsed = parseSirvoySource(bytes, format, scope);
  const result = await row<{ result: { importId: string } }>(
    "select index_sirvoy_source($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) result",
    [
      actor,
      pid,
      archive.id,
      archive.sha256,
      format,
      scope,
      parsed.parserVersion,
      JSON.stringify(parsed.headers),
      JSON.stringify(parsed.records),
      JSON.stringify(parsed.warnings),
    ],
  );
  return (
    await db.query<{ id: string; record_kind: string }>(
      "select id,record_kind from sirvoy_source_records where import_id=$1 order by source_row",
      [result.result.importId],
    )
  ).rows;
}
async function fixture(
  options: {
    rooms?: string[];
    provider?: string;
    channelCode?: string;
    guests?: number;
    start?: string;
    nights?: number;
    amount?: string;
    paid?: string;
    pid?: string;
    actor?: string;
    scope?: SirvoySourceScope;
    mismatchedPeriod?: boolean;
    confirmed?: string;
    total?: string;
  } = {},
) {
  await service();
  const ref = `SYNTH-${++serial}`;
  const rooms = options.rooms ?? ["1"],
    guests = options.guests ?? 2;
  const start = options.start ?? addDays("2099-06-01", serial * 3),
    end = addDays(start, options.nights ?? 2);
  const amount = options.amount ?? "3304.20",
    total = options.total ?? decimalSum(rooms.map(() => amount));
  const pid = options.pid ?? property,
    actor = options.actor ?? OWNER;
  const common = {
    "Booking no.": ref,
    "Check-in": start,
    "Check-out": end,
    "First name": "Synthetic",
    "Last name": "Guest",
  };
  const expanded = await source(
    "bookings_expanded",
    rooms.map((room) => ({
      ...common,
      Type: "ACCOMM",
      "Room ID": room,
      Guests: String(guests),
      Total: amount,
    })),
    pid,
    actor,
    options.scope,
  );
  const basic = await source(
    "bookings_condensed",
    [
      {
        ...common,
        "Number of rooms": String(rooms.length),
        "Booking source": options.provider ?? "Booking.com",
        "Channel booking ID": options.channelCode ?? `OTA-${ref}`,
        "Number of guests": String(guests * rooms.length),
        Total: total,
        Paid: options.paid ?? "0",
        Confirmed: options.confirmed ?? "Ja",
        Email: "synthetic@example.com",
        Phone: "+46700000000",
      },
    ],
    pid,
    actor,
    options.scope,
    options.mismatchedPeriod ? "2099-02-01" : undefined,
  );
  return {
    pairs: expanded.map((record) => ({
      accommodationRecordId: record.id,
      bookingRecordId: basic[0].id,
    })),
    ref,
    start,
    end,
  };
}
beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key); insert into auth.users values('${OWNER}'),('${OTHER}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon,service_role; grant execute on function auth.uid() to public;`);
  for (const name of [
    "20260719000000_fas1.sql",
    "20260719120000_ical_export.sql",
    "20260719200000_direct_booking.sql",
    "20260720000000_sirvoy_swish.sql",
    "20260720120000_stripe.sql",
    "20260721000000_addons.sql",
    "20260721120000_chat.sql",
    "20260722100000_production_hardening.sql",
    "20260723000000_ical_source_health.sql",
    "20260830220000_ical_reconciliation_guard.sql",
    "20260830210000_canonical_booking_write_lock.sql",
    "20260830230000_payment_lifecycle.sql",
    "20260906233429_operator_management.sql",
    "20260914090500_guest_journey_queue_reconciliation.sql",
    "20260929190056_sirvoy_cutover.sql",
    "20260929190057_journey_trigger_permissions.sql",
    "20260929190353_party_pricing.sql",
    "20260929190700_channex_channel_manager.sql",
    "20260907162510_stay_operations_and_guest_fulfillment.sql",
  ])
    await db.exec(read(name));
  await db.exec(
    "grant select,insert,update,delete on properties,units,bookings,message_templates to authenticated; grant select on scheduled_messages to authenticated; grant all on all tables in schema public to service_role; alter default privileges in schema public grant all on tables to service_role;",
  );
  for (const name of [
    "20260929192056_imported_payment_reconciliation.sql",
    "20261005160835_sirvoy_source_archive.sql",
    "20261005172512_sirvoy_searchable_source_records.sql",
    "20261005174946_sirvoy_source_calendar_import.sql",
    "20261014133639_sirvoy_ical_adoption.sql",
  ])
    await db.exec(read(name));
  await service();
  property = (
    await row<{ id: string }>(
      "insert into properties(owner_id,name,booking_enabled) values($1,'Synthetic property',false) returning id",
      [OWNER],
    )
  ).id;
  otherProperty = (
    await row<{ id: string }>(
      "insert into properties(owner_id,name,booking_enabled) values($1,'Other property',false) returning id",
      [OTHER],
    )
  ).id;
  for (const pid of [property, otherProperty])
    for (const ref of ["1", "2", "3"])
      await db.query(
        "insert into units(property_id,name,external_ref,max_guests) values($1,$2,$3,$4)",
        [pid, `Tent ${ref}`, ref, ref === "3" ? 2 : 4],
      );
  await db.query(
    "insert into message_templates(property_id,trigger_type,offset_days,send_time,channel,body,enabled) values($1,'booking_created',0,'12:00','email','Synthetic test message',true)",
    [property],
  );
}, 120000);
beforeEach(async () => {
  await service();
  await db.exec("begin");
});
afterEach(async () => {
  await db.exec("rollback");
});
afterAll(async () => {
  await db?.close();
});

async function prepare(options: Parameters<typeof fixture>[0] = {}) {
  const source = await fixture(options);
  const booking = (await importRows(source.pairs)).result.bookingIds[0];
  const unit = (
    await row<{ unit_id: string }>("select unit_id from bookings where id=$1", [booking])
  ).unit_id;
  const feed = (
    await row<{ id: string }>(
      "insert into ical_sources(property_id,unit_id,name,url,channel_type,paused) values($1,$2,'Native Booking.com','https://calendar.example.test/private.ics','booking',true) returning id",
      [property, unit],
    )
  ).id;
  const evidence = {
    provider_reference: `OTA-${source.ref}`,
    native_event_uid: `opaque-native-${source.ref}@example`,
    sirvoy_booking_reference: source.ref,
    checkin_date: source.start,
    checkout_date: source.end,
    observed_at: new Date().toISOString(),
    feed_sha256: "a".repeat(64),
    feed_url_sha256: createHash("sha256")
      .update("https://calendar.example.test/private.ics")
      .digest("hex"),
    reference_evidence_sha256: "b".repeat(64),
    reference_evidence_kind: "booking_extranet",
  };
  return { ...source, booking, unit, feed, evidence };
}
type Fixture = Awaited<ReturnType<typeof prepare>>;
const adopt = async (f: Fixture, actor = OWNER, evidence: Record<string, unknown> = f.evidence) =>
  (
    await row<{ result: Record<string, unknown> }>(
      "select adopt_sirvoy_ical_booking($1,$2,$3,$4) result",
      [actor, f.booking, f.feed, evidence],
    )
  ).result;
const bookingRow = async (id: string) =>
  (
    await row<{ value: Record<string, unknown> }>(
      "select to_jsonb(b) value from bookings b where id=$1",
      [id],
    )
  ).value;
async function rejected(action: () => Promise<unknown>, pattern: string) {
  await db.exec("savepoint failure");
  await expect(action()).rejects.toThrow(pattern);
  await db.exec("rollback to savepoint failure; release savepoint failure");
}
describe("Explicit adoption of a source hold into a paused native iCal source", () => {
  it("changes only UID binding and normal timestamp; preserves every source, inventory, financial and communication field", async () => {
    const f = await prepare();
    const before = await bookingRow(f.booking);
    expect(await adopt(f)).toEqual({ adopted: true, duplicate: false, booking_id: f.booking });
    const after = await bookingRow(f.booking);
    for (const key of Object.keys(before))
      if (!["ical_source_id", "ical_uid", "updated_at"].includes(key))
        expect(after[key], key).toEqual(before[key]);
    expect(after).toMatchObject({
      ical_source_id: f.feed,
      ical_uid: f.evidence.native_event_uid,
      source: "manual",
      payment_amount: null,
      payment_status: "none",
      communications_enabled: false,
    });
    expect(await row("select count(*)::int count from bookings")).toEqual({ count: 1 });
    expect(await row("select count(*)::int count from scheduled_messages")).toEqual({ count: 0 });
    expect(await row("select evidence from ical_source_adoptions")).toEqual({
      evidence: f.evidence,
    });
    expect(await adopt(f)).toEqual({ adopted: true, duplicate: true, booking_id: f.booking });
    expect(await bookingRow(f.booking)).toEqual(after);
  });
  it.each(["anon", "authenticated"])(
    "does not expose binding or audit writes to %s",
    async (role) => {
      const f = await prepare();
      await db.exec(
        `set role ${role}; set test.actor='${OWNER}'; set request.jwt.claim.role='${role}'`,
      );
      await rejected(() => adopt(f), "permission denied");
      await rejected(() => db.query("delete from ical_source_adoptions"), "permission denied");
    },
  );
  it("checks actor and audit RLS; the service may not overwrite an audit", async () => {
    const f = await prepare();
    await rejected(() => adopt(f, OTHER), "not_authorized");
    await adopt(f);
    await owner();
    expect(await row("select count(*)::int count from ical_source_adoptions")).toEqual({
      count: 1,
    });
    await owner(OTHER);
    expect(await row("select count(*)::int count from ical_source_adoptions")).toEqual({
      count: 0,
    });
    await service();
    await rejected(
      () => db.query("update ical_source_adoptions set adopted_at=now()"),
      "permission denied",
    );
  });
  it.each([{ provider_reference: "wrong" }, { sirvoy_booking_reference: "wrong" }])(
    "requires immutable source identities, not date coincidence: %j",
    async (patch) => {
      const f = await prepare();
      const before = await bookingRow(f.booking);
      await rejected(
        () => adopt(f, OWNER, { ...f.evidence, ...patch }),
        "source_adoption_identity_mismatch",
      );
      expect(await bookingRow(f.booking)).toEqual(before);
    },
  );
  it.each([
    { feed_sha256: "missing" },
    { native_event_uid: "" },
    { native_event_uid: "unsafe\nuid" },
    { extra: "unexpected" },
    { reference_evidence_kind: "dates_only" },
    { feed_url_sha256: "f".repeat(64) },
  ])("requires bounded explicit native evidence: %j", async (patch) => {
    const f = await prepare();
    await rejected(
      () => adopt(f, OWNER, { ...f.evidence, ...patch }),
      "source_adoption_evidence_invalid",
    );
  });
  it("rejects stale evidence and changes to the first observed interval", async () => {
    const f = await prepare();
    await rejected(
      () => adopt(f, OWNER, { ...f.evidence, observed_at: "2020-01-01T12:00:00Z" }),
      "source_adoption_evidence_not_fresh",
    );
    await rejected(
      () => adopt(f, OWNER, { ...f.evidence, checkout_date: addDays(f.end, 1) }),
      "source_adoption_inventory_mismatch",
    );
  });
  it.each([{ provider: "Other" }, { channelCode: "" }, { rooms: ["1", "2"] }])(
    "rejects unsupported or ambiguous source evidence: %j",
    async (options) => {
      const f = await prepare(options);
      await rejected(() => adopt(f), "source_adoption_identity_mismatch");
    },
  );
  it("keeps future source holds blocked until every one is bound, then allows activation", async () => {
    const f = await prepare();
    await rejected(
      () => db.query("update ical_sources set paused=false where id=$1", [f.feed]),
      "ical_source_adoption_required",
    );
    await adopt(f);
    await db.query("update ical_sources set paused=false where id=$1", [f.feed]);
    expect(await row("select paused from ical_sources where id=$1", [f.feed])).toEqual({
      paused: false,
    });
  });
  it("requires sales paused and a paused Booking.com source on the right tent", async () => {
    const f = await prepare();
    await db.query("update properties set booking_enabled=true where id=$1", [property]);
    await rejected(() => adopt(f), "source_adoption_sales_must_be_closed");
    await db.query("update properties set booking_enabled=false where id=$1", [property]);
    await db.query("update ical_sources set channel_type='other' where id=$1", [f.feed]);
    await rejected(() => adopt(f), "source_adoption_paused_booking_source_required");
    await db.query(
      "update ical_sources set channel_type='booking',unit_id=(select id from units where property_id=$2 and external_ref='2') where id=$1",
      [f.feed, property],
    );
    await rejected(() => adopt(f), "source_adoption_booking_mismatch");
  });
  it("rejects a UID already imported as another booking instead of deleting either row", async () => {
    const f = await prepare();
    await db.query(
      "insert into bookings(property_id,unit_id,source,ical_source_id,ical_uid,checkin_date,checkout_date) values($1,$2,'ical',$3,$4,$5,$6)",
      [property, f.unit, f.feed, f.evidence.native_event_uid, f.start, f.end],
    );
    const before = await bookingRow(f.booking);
    await rejected(() => adopt(f), "source_adoption_uid_already_used");
    expect(await bookingRow(f.booking)).toEqual(before);
    expect(await row("select count(*)::int count from bookings")).toEqual({ count: 2 });
  });
  it("prevents owner binding even with forged context; makes bound source identity immutable", async () => {
    const f = await prepare();
    await owner();
    await db.exec(`set stayboost.ical_adoption_booking_id='${f.booking}'`);
    await rejected(
      () =>
        db.query("update bookings set ical_source_id=$1,ical_uid=$2 where id=$3", [
          f.feed,
          f.evidence.native_event_uid,
          f.booking,
        ]),
      "source_ical_binding_requires_adoption",
    );
    await service();
    await adopt(f);
    await rejected(
      () => db.query("update bookings set ical_uid='other' where id=$1", [f.booking]),
      "source_ical_binding_immutable",
    );
    await rejected(
      () =>
        db.query("update ical_sources set url='https://changed.example.test/feed' where id=$1", [
          f.feed,
        ]),
      "adopted_ical_source_identity_immutable",
    );
    await owner();
    await rejected(
      () => db.query("update bookings set checkout_date=checkout_date+1 where id=$1", [f.booking]),
      "external_booking_dates",
    );
  });
  it("lets the existing server sync update/cancel the same row without financial writes", async () => {
    const f = await prepare();
    await adopt(f);
    await rejected(
      () =>
        db.query(
          "update bookings set status='cancelled',ical_cancel_reason='disappearance' where id=$1",
          [f.booking],
        ),
      "source_ical_disappearance_protected",
    );
    await db.query("update bookings set checkout_date=checkout_date+1 where id=$1", [f.booking]);
    await db.query(
      "update bookings set status='cancelled',ical_cancel_reason='explicit',ical_cancelled_at=now() where id=$1",
      [f.booking],
    );
    expect(await bookingRow(f.booking)).toMatchObject({
      status: "cancelled",
      payment_amount: null,
      payment_status: "none",
      communications_enabled: false,
      source_booking_record_id: f.pairs[0].bookingRecordId,
      ical_uid: f.evidence.native_event_uid,
    });
    await rejected(
      () => db.query("update bookings set payment_amount=1 where id=$1", [f.booking]),
      "source_calendar_payment_unverified",
    );
    // The existing imported-payment trigger normalizes cancelled stays to false.
    await db.query("update bookings set communications_enabled=true where id=$1", [f.booking]);
    expect((await bookingRow(f.booking)).communications_enabled).toBe(false);
    await rejected(
      () => db.query("update bookings set source='ical' where id=$1", [f.booking]),
      "source_calendar_origin_immutable",
    );
  });
});

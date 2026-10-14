import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { beforeAll, afterAll, beforeEach, afterEach, expect, it } from "vitest";
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
    "grant select,insert,update,delete on properties,units,bookings,message_templates,ical_sources to authenticated; grant select on scheduled_messages to authenticated; grant all on all tables in schema public to service_role; alter default privileges in schema public grant all on tables to service_role;",
  );
  for (const name of [
    "20260929192056_imported_payment_reconciliation.sql",
    "20261005160835_sirvoy_source_archive.sql",
    "20261005172512_sirvoy_searchable_source_records.sql",
    "20261005174946_sirvoy_source_calendar_import.sql",
    "20261014133639_sirvoy_ical_adoption.sql",
    "20261014134140_ical_booking_freshness.sql",
    "20261014135301_ical_sync_claims.sql",
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

type Claim = { token: string; source: Record<string, unknown> };
const claim = async (feed: string, actor: string | null = null) =>
  (await row<{ result: Claim | null }>("select claim_ical_sync($1,$2) result", [feed, actor]))
    .result;
const write = async (
  feed: string,
  token: string,
  patch: Record<string, unknown>,
  booking: string | null = null,
  uid = "native-uid",
) =>
  (
    await row<{ id: string }>("select write_ical_sync_booking($1,$2,$3,$4,$5) id", [
      feed,
      token,
      booking,
      uid,
      patch,
    ])
  ).id;
const finish = (
  feed: string,
  token: string,
  success = true,
  status = "ok",
  etag: string | null = "etag1",
) => row("select finish_ical_sync($1,$2,$3,$4,$5,null) ok", [feed, token, success, status, etag]);
const health = (feed: string) =>
  row<{ last_success_at: string | null; consecutive_failures: number; http_etag: string | null }>(
    "select last_success_at,consecutive_failures,http_etag from ical_sources where id=$1",
    [feed],
  );
const event = { checkin_date: "2099-01-01", checkout_date: "2099-01-03", guest_name: null };
const expire = (feed: string) =>
  db.query(
    "update ical_sync_claims set expires_at=clock_timestamp()-interval '1 second' where source_id=$1",
    [feed],
  );
async function liveSource() {
  const unit = (
    await row<{ id: string }>(
      "select id from units where property_id=$1 order by external_ref limit 1",
      [property],
    )
  ).id;
  const feed = (
    await row<{ id: string }>(
      "insert into ical_sources(property_id,unit_id,name,url,channel_type,paused) values($1,$2,'Calendar','https://calendar.example.test/feed.ics','booking',false) returning id",
      [property, unit],
    )
  ).id;
  return { feed, unit };
}
it("claims exclusively and invalidates prior success before any event write", async () => {
  const { feed } = await liveSource();
  const first = (await claim(feed))!;
  await finish(feed, first.token);
  expect((await health(feed)).last_success_at).not.toBeNull();
  const second = (await claim(feed))!;
  expect(second.source.http_etag).toBe("etag1");
  expect((await health(feed)).last_success_at).toBeNull();
  expect(await claim(feed)).toBeNull();
  expect(second.token).not.toBe(first.token);
});
it("checks current owner and paused state at claim, not only at an earlier Edge read", async () => {
  const { feed } = await liveSource();
  expect(await claim(feed, OTHER)).toBeNull();
  await db.query("update ical_sources set paused=true where id=$1", [feed]);
  expect(await claim(feed, OWNER)).toBeNull();
});
it.each(["anon", "authenticated"])("denies %s tokens and all mutation RPCs", async (role) => {
  const { feed } = await liveSource();
  const c = (await claim(feed))!;
  await db.exec(`set local role ${role}`);
  await rejected(() => db.query("select * from ical_sync_claims"), "permission denied");
  await rejected(() => claim(feed), "permission denied");
  await rejected(() => write(feed, c.token, event), "permission denied");
  await rejected(() => finish(feed, c.token), "permission denied");
  await rejected(
    () => db.query("select require_ical_sync_claim($1,$2)", [feed, c.token]),
    "permission denied",
  );
});
it("fences an expired worker before takeover and after a successor becomes healthy", async () => {
  const { feed } = await liveSource();
  const old = (await claim(feed))!;
  const id = await write(feed, old.token, event);
  await expire(feed);
  await rejected(
    () => write(feed, old.token, { checkout_date: "2099-01-04" }, id),
    "ical_claim_lost",
  );
  const next = (await claim(feed))!;
  expect(next.source.http_etag).toBeNull();
  await write(feed, next.token, { checkout_date: "2099-01-05" }, id);
  await finish(feed, next.token);
  const before = await health(feed);
  await rejected(
    () => write(feed, old.token, { checkout_date: "2099-01-06" }, id),
    "ical_claim_lost",
  );
  await rejected(() => finish(feed, old.token), "ical_claim_lost");
  await rejected(() => finish(feed, old.token, false), "ical_claim_lost");
  expect(await health(feed)).toEqual(before);
  expect((await bookingRow(id)).checkout_date).toBe("2099-01-05");
});
it("never allows an old unfenced importer to publish freshness or change a claimed booking", async () => {
  const { feed } = await liveSource();
  const c = (await claim(feed))!;
  const id = await write(feed, c.token, event);
  await rejected(
    () => db.query("update bookings set checkout_date='2099-01-06' where id=$1", [id]),
    "ical_claim_required",
  );
  await rejected(
    () => db.query("update ical_sources set last_success_at=clock_timestamp() where id=$1", [feed]),
    "ical_claim_required",
  );
  expect((await health(feed)).last_success_at).toBeNull();
});
it("retains partial imported holds but does not become healthy when a later write fails", async () => {
  const { feed } = await liveSource();
  const c = (await claim(feed))!;
  const id = await write(feed, c.token, event);
  await rejected(
    () => write(feed, c.token, { ...event, checkout_date: "bad-date" }, null, "second"),
    "invalid input syntax",
  );
  expect((await health(feed)).last_success_at).toBeNull();
  await finish(feed, c.token, false, "failed", null);
  const next = (await claim(feed))!;
  expect(next.source.http_etag).toBeNull();
  expect((await bookingRow(id)).status).toBe("confirmed");
});
it("keeps failure closed even when the final success and error health writes both fail", async () => {
  const { feed } = await liveSource();
  const c = (await claim(feed))!;
  const id = await write(feed, c.token, event);
  await db.exec(
    `reset role; create function test_health_failure() returns trigger language plpgsql as $$begin raise exception 'injected health failure'; end$$; create trigger z_test_health_failure before update on ical_sources for each row execute function test_health_failure();set role service_role`,
  );
  await rejected(() => finish(feed, c.token), "injected health failure");
  await rejected(() => finish(feed, c.token, false), "injected health failure");
  expect((await health(feed)).last_success_at).toBeNull();
  expect((await bookingRow(id)).status).toBe("confirmed");
});
it("uses cached validators only after a wholly completed attempt, never a failed or abandoned one", async () => {
  const { feed } = await liveSource();
  const c = (await claim(feed))!;
  await finish(feed, c.token);
  const revalidation = (await claim(feed))!;
  expect(revalidation.source.http_etag).toBe("etag1");
  await expire(feed);
  const abandoned = (await claim(feed))!;
  expect(abandoned.source.http_etag).toBeNull();
  await finish(feed, abandoned.token, false, "failed", "must-not-retain");
  expect((await claim(feed))!.source.http_etag).toBeNull();
});
it.each(["paused=true", "url='https://calendar.example.test/new.ics'", "channel_type='other'"])(
  "invalidates the claim after source configuration changes: %s",
  async (patch) => {
    const { feed } = await liveSource();
    const c = (await claim(feed))!;
    await db.exec(`update ical_sources set ${patch} where id='${feed}'`);
    await rejected(() => write(feed, c.token, event), "ical_claim_lost");
    await rejected(() => finish(feed, c.token), "ical_claim_lost");
  },
);
it.each([false, true])(
  "allows owner pause/resume under an active or completed claim (completed=%s)",
  async (completed) => {
    const { feed } = await liveSource();
    const c = (await claim(feed))!;
    if (completed) await finish(feed, c.token);
    await owner();
    await db.query("update ical_sources set paused=true where id=$1", [feed]);
    await db.query("update ical_sources set paused=false where id=$1", [feed]);
    await service();
    await rejected(() => finish(feed, c.token), "ical_claim_lost");
    expect((await claim(feed))!.source.http_etag).toBeNull();
  },
);
it("limits writes to the exact source/unit/UID and existing calendar fields", async () => {
  const a = await liveSource(),
    b = await liveSource();
  const ca = (await claim(a.feed))!,
    cb = (await claim(b.feed))!;
  const id = await write(a.feed, ca.token, event);
  await rejected(() => write(b.feed, cb.token, event, id), "ical_booking_scope_mismatch");
  await rejected(
    () => write(a.feed, ca.token, event, id, "wrong-uid"),
    "ical_booking_scope_mismatch",
  );
  for (const key of [
    "payment_amount",
    "payment_status",
    "communications_enabled",
    "source_accommodation_record_id",
    "guests",
  ])
    await rejected(() => write(a.feed, ca.token, { [key]: "forbidden" }, id), "ical_patch_invalid");
});
it("preserves trusted SQL operator adoption without weakening the original owner/source guards", async () => {
  const f = await prepare();
  await db.exec("reset role; set request.jwt.claim.role='';");
  expect(await adopt(f)).toMatchObject({ adopted: true });
  await service();
  expect((await bookingRow(f.booking)).ical_uid).toBe(f.evidence.native_event_uid);
});
it("preserves original adoption audit, financial fields and disappearance guard through the fenced path", async () => {
  const f = await prepare();
  await adopt(f);
  const before = await bookingRow(f.booking);
  const audit = await row(
    "select to_jsonb(a) value from ical_source_adoptions a where booking_id=$1",
    [f.booking],
  );
  await db.query("update ical_sources set paused=false where id=$1", [f.feed]);
  const c = (await claim(f.feed))!;
  await rejected(
    () =>
      write(
        f.feed,
        c.token,
        { status: "cancelled", ical_cancel_reason: "disappearance" },
        f.booking,
        f.evidence.native_event_uid,
      ),
    "source_ical_disappearance_protected",
  );
  await write(
    f.feed,
    c.token,
    { checkout_date: addDays(f.end, 1) },
    f.booking,
    f.evidence.native_event_uid,
  );
  const after = await bookingRow(f.booking);
  for (const key of Object.keys(before))
    if (!["checkout_date", "updated_at"].includes(key))
      expect(after[key], key).toEqual(before[key]);
  expect(
    await row("select to_jsonb(a) value from ical_source_adoptions a where booking_id=$1", [
      f.booking,
    ]),
  ).toEqual(audit);
  await write(
    f.feed,
    c.token,
    {
      status: "cancelled",
      ical_cancel_reason: "explicit",
      ical_cancelled_at: new Date().toISOString(),
    },
    f.booking,
    f.evidence.native_event_uid,
  );
  expect((await bookingRow(f.booking)).communications_enabled).toBe(false);
});
it("holds canonical inventory locks and blocks direct booking until finish", async () => {
  const { feed, unit } = await liveSource();
  const c = (await claim(feed))!;
  await rejected(
    () =>
      db.query(
        "insert into bookings(property_id,unit_id,source,checkin_date,checkout_date) values($1,$2,'direct','2099-02-01','2099-02-03')",
        [property, unit],
      ),
    "ical_sync_required",
  );
  await write(feed, c.token, event);
  expect(
    (
      await row<{ count: number }>(
        "select count(*)::int count from pg_locks where locktype='advisory'",
      )
    ).count,
  ).toBeGreaterThanOrEqual(2);
  await finish(feed, c.token);
  await db.query(
    "insert into bookings(property_id,unit_id,source,checkin_date,checkout_date) values($1,$2,'direct','2099-02-01','2099-02-03')",
    [property, unit],
  );
});

it("preserves owner Remove-source behavior while retaining every imported booking field", async () => {
  const { feed } = await liveSource();
  const c = (await claim(feed))!;
  const id = await write(feed, c.token, event);
  const before = await bookingRow(id);
  await owner();
  await rejected(
    () => db.query("update bookings set ical_source_id=null where id=$1", [id]),
    "ical_claim_required",
  );
  await db.query("delete from ical_sources where id=$1", [feed]);
  await service();
  const after = await bookingRow(id);
  for (const key of Object.keys(before))
    if (!["ical_source_id", "updated_at"].includes(key))
      expect(after[key], key).toEqual(before[key]);
  expect(after.ical_source_id).toBeNull();
  expect(after.status).toBe("confirmed");
  expect(await row("select count(*)::int count from ical_sync_claims")).toEqual({ count: 0 });
  await rejected(() => write(feed, c.token, { status: "cancelled" }, id), "ical_claim_lost");
});
it("still rejects removing a source that has an immutable adoption audit", async () => {
  const f = await prepare();
  await adopt(f);
  const before = await bookingRow(f.booking);
  await owner();
  await db.exec("savepoint remove_adopted");
  await expect(db.query("delete from ical_sources where id=$1", [f.feed])).rejects.toThrow();
  await db.exec("rollback to savepoint remove_adopted;release savepoint remove_adopted");
  await service();
  expect(await bookingRow(f.booking)).toEqual(before);
  expect(
    await row("select count(*)::int count from ical_source_adoptions where source_id=$1", [f.feed]),
  ).toEqual({ count: 1 });
});

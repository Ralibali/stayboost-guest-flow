import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { beforeAll, afterAll, beforeEach, afterEach, expect, it } from "vitest";
const OWNER = "00000000-0000-4000-8000-000000000001";
let db: PGlite,
  property: string,
  otherProperty: string,
  unit: string,
  otherUnit: string,
  foreignUnit: string;
const row = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) =>
  (await db.query<T>(sql, args)).rows[0];
const read = (name: string) =>
  readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");
const source = async (patch = "", target = unit) =>
  (
    await row<{ id: string }>(
      `insert into ical_sources(property_id,unit_id,name,url${patch ? "," + patch.split("=")[0] : ""}) values($1,$2,'Source','https://example.test/feed.ics'${patch ? "," + patch.slice(patch.indexOf("=") + 1) : ""}) returning id`,
      [property, target],
    )
  ).id;
const healthy = (id: string) =>
  db.query(
    "update ical_sources set last_success_at=clock_timestamp()-interval '1 minute',consecutive_failures=0 where id=$1",
    [id],
  );
const book = async (target = unit, origin = "direct") =>
  (
    await row<{ id: string }>(
      "insert into bookings(property_id,unit_id,source,guest_name,guests,checkin_date,checkout_date,payment_status,payment_method) values($1,$2,$3,'Synthetic',2,'2099-06-01','2099-06-03','pending','stripe') returning id",
      [property, target, origin],
    )
  ).id;
beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${OWNER}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon,service_role;`,
  );
  for (const file of [
    "20260719000000_fas1.sql",
    "20260719120000_ical_export.sql",
    "20260719200000_direct_booking.sql",
    "20260720000000_sirvoy_swish.sql",
    "20260720120000_stripe.sql",
    "20260721000000_addons.sql",
    "20260721120000_chat.sql",
    "20260722100000_production_hardening.sql",
    "20260723000000_ical_source_health.sql",
    "20260830210000_canonical_booking_write_lock.sql",
    "20260830220000_ical_reconciliation_guard.sql",
    "20260830230000_payment_lifecycle.sql",
    "20260906233429_operator_management.sql",
    "20260929190353_party_pricing.sql",
    "20260929190700_channex_channel_manager.sql",
  ])
    await db.exec(read(file));
  await db.exec(
    "grant all on all tables in schema public to service_role;grant select,insert,update,delete on properties,units,bookings,ical_sources to authenticated;",
  );
  property = (
    await row<{ id: string }>(
      "insert into properties(owner_id,name) values($1,'Synthetic') returning id",
      [OWNER],
    )
  ).id;
  otherProperty = (
    await row<{ id: string }>(
      "insert into properties(owner_id,name) values($1,'Other') returning id",
      [OWNER],
    )
  ).id;
  unit = (
    await row<{ id: string }>(
      "insert into units(property_id,name,max_guests) values($1,'A',4) returning id",
      [property],
    )
  ).id;
  otherUnit = (
    await row<{ id: string }>(
      "insert into units(property_id,name,max_guests) values($1,'B',4) returning id",
      [property],
    )
  ).id;
  foreignUnit = (
    await row<{ id: string }>(
      "insert into units(property_id,name,max_guests) values($1,'Foreign',4) returning id",
      [otherProperty],
    )
  ).id;
  const existing = await source();
  await db.exec(read("20261014134140_ical_booking_freshness.sql"));
  expect(
    (await row<{ paused: boolean }>("select paused from ical_sources where id=$1", [existing]))
      .paused,
  ).toBe(false);
  await db.query("delete from ical_sources where id=$1", [existing]);
}, 60000);
beforeEach(async () => {
  await db.exec("begin;set local role service_role;");
});
afterEach(async () => {
  await db.exec("rollback;");
});
afterAll(async () => {
  await db?.close();
});

it("leaves properties without iCal unchanged and stages only newly created feeds", async () => {
  await book();
  const id = await source();
  expect(
    (await row<{ paused: boolean }>("select paused from ical_sources where id=$1", [id])).paused,
  ).toBe(true);
});
it.each([
  ["paused", "paused=true,last_success_at=clock_timestamp()"],
  ["never synced", "paused=false,last_success_at=null"],
  ["stale", "paused=false,last_success_at=clock_timestamp()-interval '21 minutes'"],
  ["latest error", "paused=false,last_success_at=clock_timestamp(),consecutive_failures=1"],
  ["future timestamp", "paused=false,last_success_at=clock_timestamp()+interval '1 minute'"],
  ["infinite timestamp", "paused=false,last_success_at='infinity'"],
])("rejects new direct inventory for %s inside the booking transaction", async (_label, patch) => {
  const id = await source("paused=false");
  await db.exec(`update ical_sources set ${patch} where id='${id}'`);
  await expect(book()).rejects.toThrow("ical_sync_required");
});
it("checks only the same property/unit and requires every configured feed to be healthy", async () => {
  await source();
  await book(otherUnit);
  const id = await source("paused=false", otherUnit);
  await healthy(id);
  await db.exec("delete from bookings;");
  await book(otherUnit);
  await source("", otherUnit);
  await db.exec("delete from bookings;");
  await expect(book(otherUnit)).rejects.toThrow("ical_sync_required");
});
it("allows fresh feeds and preserves the existing overlap guard", async () => {
  const id = await source("paused=false");
  await healthy(id);
  await book();
  await expect(book()).rejects.toThrow("booking_overlap");
});
it("catches a source failure after the public preflight, without creating bookings or messages", async () => {
  const id = await source("paused=false");
  await healthy(id);
  expect(
    (
      await row<{ healthy: boolean }>(
        "select not paused and consecutive_failures=0 and last_success_at>now()-interval '20 minutes' healthy from ical_sources where id=$1",
        [id],
      )
    ).healthy,
  ).toBe(true);
  await db.query("update ical_sources set consecutive_failures=1 where id=$1", [id]);
  await db.exec("savepoint before_booking");
  await expect(book()).rejects.toThrow("ical_sync_required");
  await db.exec("rollback to before_booking");
  expect((await row<{ count: number }>("select count(*)::int count from bookings")).count).toBe(0);
  expect(
    (await row<{ count: number }>("select count(*)::int count from scheduled_messages")).count,
  ).toBe(0);
});
it("does not prevent payment completion or cancellation of an existing hold after source failure", async () => {
  const id = await source("paused=false");
  await healthy(id);
  const booking = await book();
  await db.query("update ical_sources set consecutive_failures=1 where id=$1", [id]);
  await db.query("update bookings set payment_status='paid',status='confirmed' where id=$1", [
    booking,
  ]);
  await db.query("update bookings set status='cancelled' where id=$1", [booking]);
  expect(
    (
      await row<{ payment_status: string }>("select payment_status from bookings where id=$1", [
        booking,
      ])
    ).payment_status,
  ).toBe("paid");
  await expect(
    db.query("update bookings set status='confirmed' where id=$1", [booking]),
  ).rejects.toThrow("ical_sync_required");
});
it("blocks moving existing direct inventory into an unhealthy unit but permits external source truth", async () => {
  const booking = await book(otherUnit);
  await source();
  await db.exec("savepoint before_move");
  await expect(
    db.query("update bookings set unit_id=$1 where id=$2", [unit, booking]),
  ).rejects.toThrow("ical_sync_required");
  await db.exec("rollback to before_move");
  await book(unit, "ical");
});
it("rejects cross-property sources under the real owner role", async () => {
  await db.exec(`reset role;set local test.actor='${OWNER}';set local role authenticated;`);
  await expect(source("", foreignUnit)).rejects.toThrow("ical_unit_property_mismatch");
});
it("resuming or changing feed identity clears success and conditional-fetch cache", async () => {
  const id = await source();
  await db.query(
    "update ical_sources set last_success_at=now(),http_etag='old',http_last_modified='old' where id=$1",
    [id],
  );
  await db.query("update ical_sources set paused=false where id=$1", [id]);
  expect(
    await row("select last_success_at,http_etag,http_last_modified from ical_sources where id=$1", [
      id,
    ]),
  ).toEqual({ last_success_at: null, http_etag: null, http_last_modified: null });
  await healthy(id);
  await db.query("update ical_sources set url='https://example.test/replaced.ics' where id=$1", [
    id,
  ]);
  expect(
    (
      await row<{ last_success_at: null }>("select last_success_at from ical_sources where id=$1", [
        id,
      ])
    ).last_success_at,
  ).toBeNull();
});
it("takes the canonical property lock for source and direct-booking writes", async () => {
  const id = await source("paused=false");
  await healthy(id);
  await book();
  const locks = await db.query("select * from pg_locks where locktype='advisory' and granted");
  expect(locks.rows.length).toBeGreaterThanOrEqual(1);
});

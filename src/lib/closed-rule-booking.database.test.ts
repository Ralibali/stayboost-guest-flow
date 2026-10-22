import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { beforeAll, afterAll, beforeEach, afterEach, expect, it } from "vitest";
import {
  OWNER,
  PROPERTY,
  OTHER_PROPERTY,
  UNIT,
  OTHER_UNIT,
  FOREIGN_UNIT,
  fixtureSql,
  guardMigration,
  bookingSql,
  closureSql,
} from "./test-support/closed-rule-db";

let db: PGlite;
const row = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows[0];
beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(fixtureSql());
  // Reproduce the old database boundary: a prior API check alone cannot stop
  // a later closure. The remaining tests require the new migration to reject it.
  await db.exec("begin;");
  await db.exec(closureSql());
  expect((await db.query(bookingSql())).rows).toHaveLength(1);
  await db.exec("rollback;");
  await db.exec(guardMigration());
}, 60000);
beforeEach(async () => {
  await db.exec("begin; set local role service_role;");
});
afterEach(async () => {
  await db.exec("rollback;");
});
afterAll(async () => {
  await db?.close();
});

it.each([UNIT, null])(
  "rejects same-unit/property closure %s without booking or guest-message side effects",
  async (unit) => {
    await db.exec(closureSql(unit));
    await db.exec("savepoint booking;");
    await expect(db.exec(bookingSql())).rejects.toThrow("booking_closed");
    await db.exec("rollback to booking;");
    expect(
      await row(
        "select (select count(*)::int from bookings) bookings,(select count(*)::int from scheduled_messages) messages",
      ),
    ).toEqual({ bookings: 0, messages: 0 });
  },
);
it.each([
  ["other unit", closureSql(OTHER_UNIT)],
  ["other property", closureSql(FOREIGN_UNIT, OTHER_PROPERTY)],
  ["inactive", `${closureSql()} update rate_rules set active=false;`],
  ["non-closure", `${closureSql()} update rate_rules set kind='no_arrival';`],
  [
    "checkout only",
    `${closureSql()} update rate_rules set date_from='2099-06-03',date_to='2099-06-03';`,
  ],
  [
    "day before arrival",
    `${closureSql()} update rate_rules set date_from='2099-05-31',date_to='2099-05-31';`,
  ],
])("preserves closed-rule scope: %s does not close this stay", async (_label, sql) => {
  await db.exec(sql);
  expect((await db.query(bookingSql())).rows).toHaveLength(1);
});
it.each(["2099-06-01", "2099-06-02"])("includes the closed night %s", async (day) => {
  await db.exec(closureSql());
  await db.exec(`update rate_rules set date_from='${day}',date_to='${day}';`);
  await expect(db.exec(bookingSql())).rejects.toThrow("booking_closed");
});
it("rejects a closure committed after a successful public availability preflight", async () => {
  expect(
    (
      await row<{ count: number }>(
        "select count(*)::int count from rate_rules where active and kind='closed'",
      )
    ).count,
  ).toBe(0);
  await db.exec(closureSql());
  await expect(db.exec(bookingSql())).rejects.toThrow("booking_closed");
});
it("keeps payment completion, metadata updates and cancellation possible, but rejects reopening", async () => {
  const { id } = await row<{ id: string }>(bookingSql());
  await db.exec(closureSql());
  await db.exec(
    `update bookings set status='confirmed',payment_status='paid',notes='updated' where id='${id}';`,
  );
  await db.exec(`update bookings set status='cancelled' where id='${id}';`);
  expect(
    (await row<{ payment_status: string }>(`select payment_status from bookings where id='${id}'`))
      .payment_status,
  ).toBe("paid");
  await expect(db.exec(`update bookings set status='confirmed' where id='${id}';`)).rejects.toThrow(
    "booking_closed",
  );
});
it.each(["unit", "dates", "source"])("rechecks admission on a %s change", async (change) => {
  const { id } = await row<{ id: string }>(
    bookingSql(
      change === "unit" ? OTHER_UNIT : UNIT,
      change === "source" ? "ical" : "direct",
      change === "dates" ? "'2099-07-01','2099-07-03'" : undefined,
    ),
  );
  await db.exec(closureSql());
  const patch =
    change === "unit"
      ? `unit_id='${UNIT}'`
      : change === "source"
        ? "source='direct'"
        : "checkin_date='2099-06-01',checkout_date='2099-06-03'";
  await expect(db.exec(`update bookings set ${patch} where id='${id}';`)).rejects.toThrow(
    "booking_closed",
  );
});
it("preserves external source truth and the existing freshness/overlap guards", async () => {
  await db.exec(closureSql());
  await db.exec(bookingSql(UNIT, "ical"));
  await db.exec("delete from rate_rules;");
  await db.exec("savepoint overlap;");
  await expect(db.exec(bookingSql())).rejects.toThrow("booking_overlap");
  await db.exec("rollback to overlap; delete from bookings;");
  await db.exec(
    `insert into ical_sources(property_id,unit_id,name,url) values('${PROPERTY}','${UNIT}','Synthetic','https://example.invalid/calendar.ics');`,
  );
  await expect(db.exec(bookingSql())).rejects.toThrow("ical_sync_required");
});
it("also enforces the guard for the real authenticated owner, without opening anonymous privileges", async () => {
  await db.exec(`reset role; set local test.actor='${OWNER}'; set local role authenticated;`);
  await db.exec(closureSql());
  await expect(db.exec(bookingSql())).rejects.toThrow("booking_closed");
});
it("does not expose executable functions or security-definer authority", async () => {
  expect(
    (
      await db.query(
        `select proname,prosecdef,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('authenticated',oid,'execute') owner from pg_proc where proname in ('lock_closed_rule_inventory','require_open_dates_for_direct_booking') order by proname`,
      )
    ).rows,
  ).toEqual([
    { proname: "lock_closed_rule_inventory", prosecdef: false, anon: false, owner: false },
    {
      proname: "require_open_dates_for_direct_booking",
      prosecdef: false,
      anon: false,
      owner: false,
    },
  ]);
});

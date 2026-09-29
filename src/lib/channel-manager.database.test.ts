import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
const read = (name: string) =>
  readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");
const OWNER = "00000000-0000-0000-0000-000000000001";
const OTHER = "00000000-0000-0000-0000-000000000002";
let db: PGlite;
let pid: string;
let otherPid: string;
let connection: string;
let units: string[];
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
const room = (type: string, from = "2099-06-01", to = "2099-06-03") => ({
  room_type_id: type,
  rate_plan_id: `rate-${type}`,
  checkin_date: from,
  checkout_date: to,
  amount: "2000.00",
  occupancy: { adults: 2, children: 0, infants: 0 },
});
const revision = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  booking_id: "external-booking",
  property_id: "external-property",
  inserted_at: "2098-01-01T10:00:00Z",
  status: "new",
  currency: "SEK",
  amount: "4000.00",
  customer: { name: "Test", surname: "Gäst", mail: "guest@example.com", phone: "+46700000000" },
  rooms: [room("room-a"), room("room-b")],
  ...extra,
});
const apply = async (rev: Record<string, unknown>, cid = connection) =>
  (
    await row<{ result: Record<string, unknown> }>("select apply_channex_revision($1,$2) result", [
      cid,
      rev,
    ])
  ).result;

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
    "20260830210000_canonical_booking_write_lock.sql",
    "20260830230000_payment_lifecycle.sql",
    "20260906233429_operator_management.sql",
    "20260929190353_party_pricing.sql",
    "20260929190700_channex_channel_manager.sql",
  ])
    await db.exec(read(name));
  await db.exec(
    "grant select,insert,update,delete on properties,units,bookings,addons,ical_sources,message_templates to authenticated; grant all on all tables in schema public to service_role;",
  );
  await service();
  pid = (
    await row<{ id: string }>(
      "insert into properties(owner_id,name) values($1,'Test') returning id",
      [OWNER],
    )
  ).id;
  otherPid = (
    await row<{ id: string }>(
      "insert into properties(owner_id,name) values($1,'Other') returning id",
      [OTHER],
    )
  ).id;
  units = [];
  for (const name of ["A", "B"])
    units.push(
      (
        await row<{ id: string }>(
          "insert into units(property_id,name,max_guests) values($1,$2,4) returning id",
          [pid, name],
        )
      ).id,
    );
  connection = (
    await row<{ id: string }>(
      "insert into channel_connections(property_id,external_property_id) values($1,'external-property') returning id",
      [pid],
    )
  ).id;
  for (const [index, type] of ["room-a", "room-b"].entries())
    await db.query(
      "insert into channel_unit_mappings(connection_id,unit_id,room_type_id,rate_plan_id) values($1,$2,$3,$4)",
      [connection, units[index], type, `rate-${type}`],
    );
  await db.query(
    "update channel_connections set verified_at=now(),webhook_id='webhook',enabled=true where id=$1",
    [connection],
  );
}, 60000);
afterAll(async () => {
  await db?.close();
});

describe("Channex transactional booking revisions", () => {
  it("runs both public engine gate queries against the actual revision schema", async () => {
    await service();
    const engine = readFileSync(
      new URL("../../supabase/functions/booking-engine/index.ts", import.meta.url),
      "utf8",
    );
    const queries = [
      ...engine.matchAll(
        /\.from\("channel_booking_revisions"\)\s*\.select\("([a-z_]+)"\)\s*\.eq\("property_id", property\.id\)\s*\.eq\("status", "pending_mapping"\)\s*\.limit\(1\)/g,
      ),
    ];
    expect(queries).toHaveLength(2);
    for (const query of queries) {
      const response = await db.query(
        `select ${query[1]} from channel_booking_revisions where property_id=$1 and status='pending_mapping' limit 1`,
        [otherPid],
      );
      expect(response.rows).toEqual([]);
    }
  });
  it("creates all mapped rooms in one revision and strips card data", async () => {
    await service();
    const result = await apply(
      revision("rev-new", {
        guarantee: { card_number: "4111111111111111", cvv: "123" },
        customer: { name: "Test", card_number: "SECRET" },
        services: [
          { type: "Breakfast", name: "Breakfast", total_price: "200", guarantee: "SECRET" },
        ],
      }),
    );
    expect(result.applied).toBe(true);
    const rows = (
      await db.query<{ source: string; payment_status: string; guests: number }>(
        "select source,payment_status,guests from bookings where channel_connection_id=$1",
        [connection],
      )
    ).rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ source: "channex", payment_status: "none", guests: 2 });
    const ledger = await row<{ payload: unknown }>(
      "select payload from channel_booking_revisions where revision_id='rev-new'",
    );
    expect(JSON.stringify(ledger.payload)).not.toContain("411111");
    expect(JSON.stringify(ledger.payload)).not.toContain("SECRET");
    expect(JSON.stringify(ledger.payload)).toContain("Breakfast");
    expect(
      (
        await row<{ last_booking_sync_at: null }>(
          "select last_booking_sync_at from channel_connections where id=$1",
          [connection],
        )
      ).last_booking_sync_at,
    ).toBeNull();
  });
  it("retries duplicate safely and ignores an older revision", async () => {
    expect((await apply(revision("rev-new"))).duplicate).toBe(true);
    expect(
      (
        await apply(
          revision("rev-old", {
            inserted_at: "2097-01-01T10:00:00Z",
            rooms: [room("room-a", "2099-07-01", "2099-07-03")],
          }),
        )
      ).stale,
    ).toBe(true);
    const saved = await row<{ start: string; total: number }>(
      "select min(checkin_date)::text start,count(*)::int total from bookings where channel_connection_id=$1 and status='confirmed'",
      [connection],
    );
    expect(saved).toEqual({ start: "2099-06-01", total: 2 });
  });
  it("persists an unmapped revision without partial inventory changes and applies after mapping is repaired", async () => {
    const rev = revision("rev-mapping", {
      booking_id: "needs-map",
      inserted_at: "2098-01-02T10:00:00Z",
      rooms: [
        room("room-a", "2099-07-01", "2099-07-03"),
        room("unknown", "2099-07-01", "2099-07-03"),
      ],
    });
    expect((await apply(rev)).needs_mapping).toBe(true);
    expect(
      (await db.query("select id from bookings where channel_booking_id='needs-map'")).rows,
    ).toHaveLength(0);
    await expect(
      db.query(
        "insert into bookings(property_id,unit_id,source,guest_name,guests,checkin_date,checkout_date) values($1,$2,'direct','Guest',2,'2099-12-01','2099-12-03')",
        [pid, units[0]],
      ),
    ).rejects.toThrow("channel_sync_required");
    expect(
      (
        await row<{ status: string }>(
          "select status from channel_booking_revisions where revision_id='rev-mapping'",
        )
      ).status,
    ).toBe("pending_mapping");
    await db.query("update channel_connections set enabled=false where id=$1", [connection]);
    const unit = (
      await row<{ id: string }>(
        "insert into units(property_id,name,max_guests) values($1,'C',4) returning id",
        [pid],
      )
    ).id;
    await db.query(
      "insert into channel_unit_mappings(connection_id,unit_id,room_type_id,rate_plan_id) values($1,$2,'unknown','rate-unknown')",
      [connection, unit],
    );
    await db.query(
      "update channel_connections set verified_at=now(),webhook_id='webhook',enabled=true where id=$1",
      [connection],
    );
    expect((await apply(rev)).applied).toBe(true);
    expect(
      (await db.query("select id from bookings where channel_booking_id='needs-map'")).rows,
    ).toHaveLength(2);
  });
  it("modifies a multi-room booking and cancels removed rooms, then cancels all without rooms", async () => {
    const modification = revision("rev-modified", {
      status: "modified",
      inserted_at: "2098-01-03T10:00:00Z",
      rooms: [room("room-a", "2099-06-04", "2099-06-06")],
    });
    expect((await apply(modification)).applied).toBe(true);
    const rows = (
      await db.query<{ channel_room_key: string; status: string }>(
        "select channel_room_key,status from bookings where channel_booking_id='external-booking' order by channel_room_key",
      )
    ).rows;
    expect(rows).toEqual([
      { channel_room_key: "room-a", status: "confirmed" },
      { channel_room_key: "room-b", status: "cancelled" },
    ]);
    expect(
      (
        await apply(
          revision("rev-cancelled", {
            status: "cancelled",
            inserted_at: "2098-01-04T10:00:00Z",
            rooms: [],
          }),
        )
      ).applied,
    ).toBe(true);
    expect(
      (
        await db.query(
          "select id from bookings where channel_booking_id='external-booking' and status='confirmed'",
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("rejects a malformed room atomically and never commits a revision ledger entry", async () => {
    await expect(
      apply(
        revision("rev-invalid", {
          booking_id: "invalid",
          rooms: [room("room-a"), room("room-b", "2099-06-03", "2099-06-02")],
        }),
      ),
    ).rejects.toThrow("invalid_channel_dates");
    expect(
      (await db.query("select id from bookings where channel_booking_id='invalid'")).rows,
    ).toHaveLength(0);
    expect(
      (
        await db.query(
          "select revision_id from channel_booking_revisions where revision_id='rev-invalid'",
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("retains an OTA/direct collision as a pending incident without writing either OTA room", async () => {
    await service();
    await db.query(
      "update channel_connections set last_booking_sync_at=now(),last_ari_sync_at=now() where id=$1",
      [connection],
    );
    const direct = await row<{ id: string }>(
      "insert into bookings(property_id,unit_id,source,guest_name,guests,checkin_date,checkout_date) values($1,$2,'direct','Existing',2,'2099-09-01','2099-09-03') returning id",
      [pid, units[0]],
    );
    const rev = revision("rev-collision", {
      booking_id: "collision",
      rooms: [
        room("room-a", "2099-09-01", "2099-09-03"),
        room("room-b", "2099-09-01", "2099-09-03"),
      ],
    });
    expect(await apply(rev)).toMatchObject({
      applied: false,
      needs_mapping: true,
      inventory_conflict: true,
    });
    expect(
      (await db.query("select id from bookings where channel_booking_id='collision'")).rows,
    ).toHaveLength(0);
    expect(
      await row(
        "select status,last_error from channel_booking_revisions where revision_id='rev-collision'",
      ),
    ).toEqual({ status: "pending_mapping", last_error: "channel_inventory_conflict" });
    await db.query("update bookings set status='cancelled' where id=$1", [direct.id]);
    expect((await apply(rev)).applied).toBe(true);
    expect(
      await row(
        "select status,last_error from channel_booking_revisions where revision_id='rev-collision'",
      ),
    ).toEqual({ status: "applied", last_error: null });
  });
  it("changes the ARI version when the property's maximum stay changes", async () => {
    await service();
    await db.query("update channel_connections set sync_dirty_at=null where id=$1", [connection]);
    await owner();
    await db.query("update properties set max_stay=10 where id=$1", [pid]);
    await service();
    expect(
      (
        await row<{ dirty: string }>(
          "select sync_dirty_at::text dirty from channel_connections where id=$1",
          [connection],
        )
      ).dirty,
    ).toBeTruthy();
  });
});

describe("channel permissions and outgoing sync lease", () => {
  it("rejects browser RPC, metadata forgery and another owner's reads", async () => {
    await owner();
    await expect(apply(revision("forged"))).rejects.toThrow("permission denied");
    await expect(
      db.query("update channel_connections set verified_at=now() where id=$1", [connection]),
    ).rejects.toThrow("permission denied");
    await owner(OTHER);
    expect(
      (await db.query("select id from channel_connections where id=$1", [connection])).rows,
    ).toHaveLength(0);
    expect(
      (
        await db.query("select revision_id from channel_booking_revisions where connection_id=$1", [
          connection,
        ])
      ).rows,
    ).toHaveLength(0);
  });
  it("allows owner mapping edits only while disabled and rejects cross-property units", async () => {
    await owner();
    await expect(
      db.query(
        "update channel_unit_mappings set rate_plan_id='other-rate' where connection_id=$1",
        [connection],
      ),
    ).rejects.toThrow("disable_channel_before_mapping");
    await db.query("update channel_connections set enabled=false where id=$1", [connection]);
    await db.query(
      "update channel_unit_mappings set rate_plan_id='rate-room-a' where connection_id=$1 and room_type_id='room-a'",
      [connection],
    );
    await service();
    const unit = (
      await row<{ id: string }>(
        "insert into units(property_id,name) values($1,'Other') returning id",
        [otherPid],
      )
    ).id;
    await owner();
    await expect(
      db.query(
        "insert into channel_unit_mappings(connection_id,unit_id,room_type_id,rate_plan_id) values($1,$2,'other','other')",
        [connection, unit],
      ),
    ).rejects.toThrow();
    await service();
    await db.query(
      "update channel_connections set verified_at=now(),webhook_id='webhook',enabled=true where id=$1",
      [connection],
    );
  });
  it("prevents local cancellation/moving of channel inventory while allowing private notes", async () => {
    await service();
    const rev = revision("rev-protect", {
      booking_id: "protect",
      inserted_at: "2098-01-05T10:00:00Z",
      rooms: [room("room-a", "2099-08-01", "2099-08-03")],
    });
    await apply(rev);
    await owner();
    await expect(
      db.exec("update bookings set status='cancelled' where channel_booking_id='protect'"),
    ).rejects.toThrow("external_booking_dates");
    await expect(
      db.exec(
        "update bookings set channel_revision_id='forged' where channel_booking_id='protect'",
      ),
    ).rejects.toThrow("channel_booking_server_only");
    await db.exec(
      "update bookings set internal_notes='Privat anteckning' where channel_booking_id='protect'",
    );
  });
  it("serializes outgoing sync, protects a newer dirty marker, and backs off after failure", async () => {
    await service();
    const first = await row<{ token: string }>("select claim_channel_sync($1) token", [connection]);
    expect(first.token).toBeTruthy();
    const snapshot = await row<{ dirty: string }>(
      "select sync_dirty_at::text dirty from channel_connections where id=$1",
      [connection],
    );
    expect(
      (
        await row<{ ok: boolean }>(
          "select validate_channel_sync($1,$2,$3,'external-property','staging') ok",
          [connection, first.token, snapshot.dirty],
        )
      ).ok,
    ).toBe(true);
    expect(
      (
        await row<{ ok: boolean }>(
          "select validate_channel_sync($1,$2,$3,'wrong-property','staging') ok",
          [connection, first.token, snapshot.dirty],
        )
      ).ok,
    ).toBe(false);
    await expect(
      db.query(
        "insert into bookings(property_id,unit_id,source,guest_name,guests,checkin_date,checkout_date) values($1,$2,'manual','Guest',2,'2099-12-01','2099-12-03')",
        [pid, units[0]],
      ),
    ).rejects.toThrow("channel_sync_in_progress");
    await db.exec(
      "update bookings set internal_notes='Kontakt under synkning' where channel_booking_id='protect'",
    );
    await db.query("update channel_connections set sync_dirty_at=clock_timestamp() where id=$1", [
      connection,
    ]);
    expect(
      (
        await row<{ ok: boolean }>(
          "select validate_channel_sync($1,$2,$3,'external-property','staging') ok",
          [connection, first.token, snapshot.dirty],
        )
      ).ok,
    ).toBe(false);
    expect(
      (await row<{ token: null }>("select claim_channel_sync($1) token", [connection])).token,
    ).toBeNull();
    expect(
      (
        await row<{ ok: boolean }>("select complete_channel_sync($1,$2,'2000-01-01',null) ok", [
          connection,
          first.token,
        ])
      ).ok,
    ).toBe(true);
    expect(
      (
        await row<{ dirty: string }>(
          "select sync_dirty_at dirty from channel_connections where id=$1",
          [connection],
        )
      ).dirty,
    ).toBeTruthy();
    const second = await row<{ token: string }>("select claim_channel_sync($1) token", [
      connection,
    ]);
    await db.query("select complete_channel_sync($1,$2,now(),'provider unavailable')", [
      connection,
      second.token,
    ]);
    expect(
      (await row<{ token: null }>("select claim_channel_sync($1) token", [connection])).token,
    ).toBeNull();
    await db.query("update channel_connections set next_retry_at=null where id=$1", [connection]);
    const third = await row<{ token: string }>("select claim_channel_sync($1) token", [connection]);
    await db.query("select complete_channel_sync($1,$2,now(),null)", [connection, third.token]);
    expect(
      await row<{ dirty: null; failures: number }>(
        "select sync_dirty_at dirty,sync_failures failures from channel_connections where id=$1",
        [connection],
      ),
    ).toEqual({ dirty: null, failures: 0 });
  });
  it("keeps unconfirmed remote closure fatal across failed retries and releases sales only after full success", async () => {
    await service();
    await db.query(
      "update channel_connections set last_error='channel_inventory_closure_failed',next_retry_at=null where id=$1",
      [connection],
    );
    const lease = await row<{ token: string }>("select claim_channel_sync($1) token", [connection]);
    await db.query("select complete_channel_sync($1,$2,now(),'provider unavailable')", [
      connection,
      lease.token,
    ]);
    expect(
      (
        await row<{ last_error: string }>(
          "select last_error from channel_connections where id=$1",
          [connection],
        )
      ).last_error,
    ).toBe("channel_inventory_closure_failed");
    await expect(
      db.query(
        "insert into bookings(property_id,unit_id,source,guest_name,guests,checkin_date,checkout_date) values($1,$2,'manual','Guest',2,'2099-12-01','2099-12-03')",
        [pid, units[0]],
      ),
    ).rejects.toThrow("channel_sync_required");
    await db.query("update channel_connections set next_retry_at=null where id=$1", [connection]);
    const next = await row<{ token: string }>("select claim_channel_sync($1) token", [connection]);
    expect(
      (
        await row<{ ok: boolean }>("select complete_channel_sync($1,$2,now(),null) ok", [
          connection,
          next.token,
        ])
      ).ok,
    ).toBe(true);
    expect(
      (
        await row<{ last_error: null }>("select last_error from channel_connections where id=$1", [
          connection,
        ])
      ).last_error,
    ).toBeNull();
  });
  it("does not confirm ARI success after its lease expired", async () => {
    await service();
    const lease = await row<{ token: string }>("select claim_channel_sync($1) token", [connection]);
    await db.query(
      "update channel_connections set sync_lease_until=clock_timestamp()-interval '1 second' where id=$1",
      [connection],
    );
    expect(
      (
        await row<{ ok: boolean }>("select complete_channel_sync($1,$2,now(),null) ok", [
          connection,
          lease.token,
        ])
      ).ok,
    ).toBe(false);
    // Faults still persist if an outbound request exhausted the lease before returning.
    expect(
      (
        await row<{ ok: boolean }>(
          "select complete_channel_sync($1,$2,now(),'channel_inventory_closure_failed') ok",
          [connection, lease.token],
        )
      ).ok,
    ).toBe(true);
  });
  it("blocks managed inventory while feed or ARI is missing/stale, but lets a newly enabled channel synchronize", async () => {
    await service();
    await db.query(
      "update channel_connections set last_error=null,next_retry_at=null,last_booking_sync_at=null,last_ari_sync_at=null where id=$1",
      [connection],
    );
    for (const [feed, ari] of [
      [null, null],
      [null, "now()"],
      ["now()", null],
      ["now()-interval '6 minutes'", "now()"],
      ["now()", "now()-interval '27 hours'"],
    ]) {
      await db.query(
        `update channel_connections set last_booking_sync_at=${feed ?? "null"},last_ari_sync_at=${ari ?? "null"} where id=$1`,
        [connection],
      );
      for (const source of ["manual", "direct"]) {
        await expect(
          db.query(
            "insert into bookings(property_id,unit_id,source,guest_name,guests,checkin_date,checkout_date) values($1,$2,$3,'Guest',2,'2099-12-01','2099-12-03')",
            [pid, units[0], source],
          ),
        ).rejects.toThrow("channel_sync_required");
      }
    }
    await db.query(
      "update channel_connections set last_booking_sync_at=null,last_ari_sync_at=null where id=$1",
      [connection],
    );
    const lease = await row<{ token: string }>("select claim_channel_sync($1) token", [connection]);
    expect(lease.token).toBeTruthy();
    expect(
      (
        await apply(
          revision("rev-initial-feed", {
            booking_id: "initial-feed",
            rooms: [room("room-a", "2099-11-01", "2099-11-03")],
          }),
        )
      ).applied,
    ).toBe(true);
    await db.query("update channel_connections set last_booking_sync_at=now() where id=$1", [
      connection,
    ]);
    expect(
      (
        await row<{ ok: boolean }>("select complete_channel_sync($1,$2,now(),null) ok", [
          connection,
          lease.token,
        ])
      ).ok,
    ).toBe(true);
    const direct = await row<{ id: string }>(
      "insert into bookings(property_id,unit_id,source,guest_name,guests,checkin_date,checkout_date) values($1,$2,'manual','Fresh Guest',2,'2099-12-01','2099-12-03') returning id",
      [pid, units[0]],
    );
    await db.query(
      "update channel_connections set last_booking_sync_at=now()-interval '6 minutes' where id=$1",
      [connection],
    );
    await owner();
    await db.query(
      "update bookings set internal_notes='Contact permitted during outage' where id=$1",
      [direct.id],
    );
    await expect(
      db.query(
        "update bookings set checkin_date='2099-12-05',checkout_date='2099-12-07' where id=$1",
        [direct.id],
      ),
    ).rejects.toThrow("channel_sync_required");
  });
});

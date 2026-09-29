import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import {
  buildChannexAri,
  ChannexClient,
  ChannexError,
  type ChannelConnection,
} from "../../supabase/functions/_shared/channex";
import { channexAriChanges, sameAriSnapshot } from "../../supabase/functions/_shared/channex-ari";
import { syncChannelAri } from "../../supabase/functions/_shared/channex-runtime";

const OWNER = "00000000-0000-0000-0000-000000000001";
let db: PGlite;
const now = new Date("2026-09-29T12:00:00Z");
// PGlite returns SQL dates as Date; PostgREST returns these columns as ISO strings.
const restRow = <T>(row: T): T =>
  row && typeof row === "object"
    ? (Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key,
          value instanceof Date
            ? [
                "ari_horizon_date",
                "pending_from",
                "checkin_date",
                "checkout_date",
                "date_from",
                "date_to",
              ].includes(key)
              ? value.toISOString().slice(0, 10)
              : value.toISOString()
            : value,
        ]),
      ) as T)
    : row;
const one = async <T = Record<string, unknown>>(sql: string, values: unknown[] = []) =>
  restRow((await db.query<T>(sql, values)).rows[0]);
const service = () =>
  db.exec(
    "reset role; set test.actor=''; set request.jwt.claim.role='service_role'; set role service_role;",
  );
const admin = {
  from(table: string) {
    const filters: { field: string; op: string; value: unknown }[] = [];
    let patch: Record<string, unknown> | undefined;
    let limit = 10000;
    const run = async (single = false, offset = 0) => {
      const values: unknown[] = [];
      let sql = patch
        ? `update ${table} set ${Object.entries(patch)
            .map(([key, value]) => {
              values.push(value);
              return `${key}=$${values.length}`;
            })
            .join(",")}`
        : `select * from ${table}`;
      const conditions = filters.map(({ field, op, value }) => {
        values.push(value);
        return `${field} ${op} $${values.length}`;
      });
      if (conditions.length) sql += ` where ${conditions.join(" and ")}`;
      sql += patch ? " returning *" : ` limit ${single ? 1 : limit} offset ${offset}`;
      try {
        const rows = (await db.query(sql, values)).rows.map(restRow);
        return { data: single ? (rows[0] ?? null) : rows, error: null };
      } catch (error) {
        return { data: null, error: { message: String(error) } };
      }
    };
    const builder = {
      select() {
        return this;
      },
      order() {
        return this;
      },
      eq(field: string, value: unknown) {
        filters.push({ field, op: "=", value });
        return this;
      },
      lt(field: string, value: unknown) {
        filters.push({ field, op: "<", value });
        return this;
      },
      gt(field: string, value: unknown) {
        filters.push({ field, op: ">", value });
        return this;
      },
      gte(field: string, value: unknown) {
        filters.push({ field, op: ">=", value });
        return this;
      },
      limit(value: number) {
        limit = value;
        return this;
      },
      update(value: Record<string, unknown>) {
        patch = value;
        return this;
      },
      range(from: number, to: number) {
        limit = to - from + 1;
        return run(false, from);
      },
      maybeSingle() {
        return run(true);
      },
      then(resolve: (value: unknown) => unknown) {
        return run().then(resolve);
      },
    };
    return builder;
  },
  async rpc(name: string, args: Record<string, unknown>) {
    try {
      const keys = Object.keys(args);
      const data = await one<{ result: unknown }>(
        `select ${name}(${keys.map((key, index) => `${key}=>$${index + 1}`).join(",")}) result`,
        keys.map((key) => args[key]),
      );
      return { data: data.result, error: null };
    } catch (error) {
      return { data: null, error: { message: String(error) } };
    }
  },
};
const TASK = "88888888-8888-4888-8888-888888888888";
const reply = (status = 200) =>
  new Response(JSON.stringify({ data: [{ type: "task", id: TASK }], meta: { warnings: [] } }), {
    status,
  });
async function fixture() {
  await service();
  const { id: property } = await one<{ id: string }>(
    "insert into properties(owner_id,name) values($1,'Bergs delta test') returning id",
    [OWNER],
  );
  const { id: unit } = await one<{ id: string }>(
    "insert into units(property_id,name,max_guests,base_price,weekend_pct,monthly_mult) values($1,'Tent',4,1000,0,$2) returning id",
    [property, Array(12).fill(100)],
  );
  const external = crypto.randomUUID();
  const { id: connection } = await one<{ id: string }>(
    "insert into channel_connections(property_id,external_property_id,fees_configured) values($1,$2,true) returning id",
    [property, external],
  );
  await db.query(
    "insert into channel_unit_mappings(connection_id,unit_id,room_type_id,rate_plan_id) values($1,$2,$3,$4)",
    [connection, unit, crypto.randomUUID(), crypto.randomUUID()],
  );
  await db.query(
    "update channel_connections set verified_at=now(),webhook_id='mock-webhook',enabled=true where id=$1",
    [connection],
  );
  const transport = vi.fn<typeof fetch>().mockImplementation(async () => reply());
  const client = new ChannexClient("staging", "mock-key", transport);
  vi.spyOn(client, "verifyMappings").mockResolvedValue({
    propertyName: "Bergs",
    mappedUnits: 1,
    inventoryDays: 500,
  });
  vi.spyOn(client, "feed").mockResolvedValue([]);
  const current = () =>
    one<ChannelConnection>("select * from channel_connections where id=$1", [connection]);
  const state = () =>
    one<any>("select * from channel_ari_state where connection_id=$1", [connection]);
  const sync = async (options: { forceFull?: boolean; now?: Date } = {}) =>
    syncChannelAri(admin, await current(), client, { now, ...options });
  return { property, unit, connection, client, transport, current, state, sync };
}
beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key); insert into auth.users values('${OWNER}');
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
    "20260929211500_channex_ari_outbox.sql",
  ])
    await db.exec(
      readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8"),
    );
  await db.exec("grant all on all tables in schema public to service_role;");
}, 120000);
afterAll(async () => {
  await db?.close();
});

describe(
  "change-driven Channex ARI outbox, replay and acknowledged snapshots",
  { timeout: 20000 },
  () => {
    it("sends the first full snapshot, saves its acceptance and makes no ARI call for unchanged state", async () => {
      const f = await fixture();
      expect(await f.sync()).toMatchObject({
        mode: "full",
        submitted: true,
        receipts: { restrictions: [TASK], availability: [TASK] },
      });
      expect(f.transport).toHaveBeenCalledTimes(2);
      expect(await f.state()).toMatchObject({ pending_payload: null, recovery_required: false });
      expect((await f.current()).sync_dirty_at).toBeNull();
      f.transport.mockClear();
      expect(await f.sync()).toMatchObject({
        mode: "delta",
        submitted: false,
        availabilitySegments: 0,
        restrictionSegments: 0,
      });
      expect(f.transport).not.toHaveBeenCalled();
    });
    it.each(["verification", "local_read"])(
      "closes the previous known horizon after an early %s failure",
      async (kind) => {
        const f = await fixture();
        await f.sync();
        f.transport.mockClear();
        let selectedAdmin = admin;
        if (kind === "verification")
          vi.mocked(f.client.verifyMappings).mockRejectedValueOnce(
            new ChannexError("channel_capacity_mismatch"),
          );
        else
          selectedAdmin = {
            ...admin,
            from: (table: string) => {
              if (table === "units") throw new Error("mock read outage");
              return admin.from(table);
            },
          };
        await expect(
          syncChannelAri(selectedAdmin, await f.current(), f.client, {
            now: new Date("2026-09-30T12:00:00Z"),
          }),
        ).rejects.toThrow(
          kind === "verification" ? "channel_capacity_mismatch" : "channel_storage_error",
        );
        expect(f.transport).toHaveBeenCalledTimes(1);
        expect(new URL(String(f.transport.mock.calls[0][0])).pathname).toBe("/api/v1/availability");
        const values = JSON.parse(String(f.transport.mock.calls[0][1]?.body)).values;
        expect(values).toHaveLength(500);
        expect(values.every((v: { availability: number }) => v.availability === 0)).toBe(true);
        expect(values[0].date).toBe("2026-09-30");
        expect((await f.current()).last_ari_sync_at).toBeNull();
        expect(await f.state()).toMatchObject({
          acknowledged_snapshot: null,
          recovery_required: true,
        });
      },
    );
    it.each(["no_known_inventory", "invalid_closure_receipt"])(
      "keeps a sticky sales blocker after an early failure with %s",
      async (kind) => {
        const f = await fixture();
        if (kind === "invalid_closure_receipt") {
          await f.sync();
          f.transport.mockClear();
          f.transport.mockResolvedValueOnce(
            new Response(JSON.stringify({ data: [], meta: { warnings: [] } }), { status: 200 }),
          );
        }
        vi.mocked(f.client.verifyMappings).mockRejectedValueOnce(
          new ChannexError("channel_capacity_mismatch"),
        );
        await expect(f.sync()).rejects.toThrow("channel_inventory_closure_failed");
        expect((await f.current()).last_error).toBe("channel_inventory_closure_failed");
        expect(f.transport).toHaveBeenCalledTimes(kind === "no_known_inventory" ? 0 : 1);
        await expect(
          db.query(
            "insert into bookings(property_id,unit_id,source,guest_name,checkin_date,checkout_date,guests) values($1,$2,'manual','Guest','2026-10-01','2026-10-03',2)",
            [f.property, f.unit],
          ),
        ).rejects.toThrow("channel_sync_required");
      },
    );
    it("turns a real price edit into one batched rate-only call without resending inventory or restrictions", async () => {
      const f = await fixture();
      await f.sync();
      f.transport.mockClear();
      await db.query("update units set base_price=1500 where id=$1", [f.unit]);
      expect((await f.current()).sync_dirty_at).not.toBeNull();
      expect(await f.sync()).toMatchObject({
        mode: "delta",
        availabilitySegments: 0,
        restrictionSegments: 1,
      });
      expect(f.transport).toHaveBeenCalledTimes(1);
      expect(String(f.transport.mock.calls[0][0])).toContain("/restrictions");
      const values = JSON.parse(String(f.transport.mock.calls[0][1]?.body)).values;
      expect(values).toHaveLength(1);
      expect(values[0]).toMatchObject({ date_from: "2026-09-29", rate: "1500.00" });
      expect(Object.keys(values[0]).sort()).toEqual([
        "date_from",
        "date_to",
        "property_id",
        "rate",
        "rate_plan_id",
      ]);
    });
    it("initializes only new horizon dates and the date becoming bookable after midnight", async () => {
      const f = await fixture();
      await f.sync();
      f.transport.mockClear();
      expect(await f.sync({ now: new Date("2026-09-30T12:00:00Z") })).toMatchObject({
        mode: "delta",
        availabilitySegments: 2,
        restrictionSegments: 2,
      });
      const availability = JSON.parse(
        String(
          f.transport.mock.calls.find(([url]) => String(url).endsWith("/availability"))![1]?.body,
        ),
      ).values;
      expect(availability.map((row: { availability: number }) => row.availability)).toEqual([1, 0]);
      expect(availability.every((row: { date?: string }) => row.date !== "2026-09-29")).toBe(true);
      expect((await f.current()).ari_horizon_date).toBe("2026-09-30");
    });
    it("keeps the acknowledged baseline on provider failure and retries the exact persisted payload", async () => {
      const f = await fixture();
      await f.sync();
      const baseline = (await f.state()).acknowledged_snapshot;
      f.transport.mockClear();
      await db.query(
        "insert into bookings(property_id,unit_id,source,guest_name,checkin_date,checkout_date,guests) values($1,$2,'manual','Guest','2026-10-01','2026-10-03',2)",
        [f.property, f.unit],
      );
      f.transport.mockResolvedValueOnce(reply(503));
      await expect(f.sync()).rejects.toThrow("channex_api_error");
      const pending = await f.state();
      expect(pending.acknowledged_snapshot).toEqual(baseline);
      expect(pending.pending_payload.availability).toHaveLength(1);
      expect(pending.pending_payload.restrictions).toHaveLength(0);
      expect(pending.recovery_required).toBe(true);
      const original = String(f.transport.mock.calls[0][1]?.body);
      await db.query("update channel_connections set next_retry_at=null where id=$1", [
        f.connection,
      ]);
      expect(await f.sync()).toMatchObject({
        mode: "retry",
        availabilitySegments: 1,
        restrictionSegments: 0,
      });
      expect(String(f.transport.mock.calls[2][1]?.body)).toBe(original);
      expect((await f.state()).pending_payload).toBeNull();
    });
    it("closes all inventory after a restriction-only partial failure and requires full recovery", async () => {
      const f = await fixture();
      await f.sync();
      f.transport.mockClear();
      await db.query("update units set base_price=1600 where id=$1", [f.unit]);
      f.transport.mockResolvedValueOnce(reply(503));
      await expect(f.sync()).rejects.toThrow("channex_api_error");
      expect(f.transport).toHaveBeenCalledTimes(2);
      const closure = JSON.parse(String(f.transport.mock.calls[1][1]?.body)).values;
      expect(closure).toHaveLength(500);
      expect(closure.every((row: { availability: number }) => row.availability === 0)).toBe(true);
      expect(await f.state()).toMatchObject({
        acknowledged_snapshot: null,
        pending_payload: null,
        recovery_required: true,
      });
      expect((await f.current()).last_ari_sync_at).toBeNull();
      await db.query("update channel_connections set next_retry_at=null where id=$1", [
        f.connection,
      ]);
      expect(await f.sync()).toMatchObject({ mode: "full", submitted: true });
      expect((await f.state()).acknowledged_snapshot.restrictions[0].rate).toBe("1600.00");
    });
    it.each(["network", "warnings", "receipt", "missing_task"])(
      "does not acknowledge an uncertain %s result and safely replays inventory changes",
      async (kind) => {
        const f = await fixture();
        await f.sync();
        f.transport.mockClear();
        const baseline = (await f.state()).acknowledged_snapshot;
        await db.query(
          "insert into bookings(property_id,unit_id,source,guest_name,checkin_date,checkout_date,guests) values($1,$2,'manual','Guest','2026-10-01','2026-10-03',2)",
          [f.property, f.unit],
        );
        if (kind === "network") f.transport.mockRejectedValueOnce(new Error("simulated timeout"));
        if (kind === "warnings")
          f.transport.mockResolvedValueOnce(
            new Response(
              JSON.stringify({ meta: { warnings: [{ warning: "mock partial failure" }] } }),
              { status: 200 },
            ),
          );
        if (kind === "missing_task")
          f.transport.mockResolvedValueOnce(
            new Response(JSON.stringify({ data: [], meta: { warnings: [] } }), { status: 200 }),
          );
        const selectedAdmin =
          kind === "receipt"
            ? {
                ...admin,
                rpc: async (name: string, args: Record<string, unknown>) =>
                  name === "acknowledge_channel_ari"
                    ? { data: null, error: { message: "mock database receipt outage" } }
                    : admin.rpc(name, args),
              }
            : admin;
        await expect(
          syncChannelAri(selectedAdmin, await f.current(), f.client, { now }),
        ).rejects.toThrow(
          kind === "network"
            ? "channex_network_error"
            : kind === "warnings"
              ? "channex_partial_update"
              : kind === "missing_task"
                ? "channex_invalid_response"
                : "channel_outbox_ack_failed",
        );
        expect((await f.state()).acknowledged_snapshot).toEqual(baseline);
        const original = String(f.transport.mock.calls[0][1]?.body);
        await db.query("update channel_connections set next_retry_at=null where id=$1", [
          f.connection,
        ]);
        expect(await f.sync()).toMatchObject({
          mode: "retry",
          availabilitySegments: 1,
          restrictionSegments: 0,
        });
        expect(String(f.transport.mock.calls.at(-1)![1]?.body)).toBe(original);
        expect((await f.state()).pending_payload).toBeNull();
      },
    );
    it("invalidates the baseline and rebuilds after a committed source change during submission", async () => {
      const f = await fixture();
      await f.sync();
      f.transport.mockClear();
      await db.query("update units set base_price=1650 where id=$1", [f.unit]);
      let change = true;
      f.transport.mockImplementation(async () => {
        if (change) {
          change = false;
          await db.query("update units set base_price=1750 where id=$1", [f.unit]);
        }
        return reply();
      });
      expect(await f.sync()).toMatchObject({ mode: "full", submitted: true });
      expect(f.transport).toHaveBeenCalledTimes(4);
      expect(
        JSON.parse(String(f.transport.mock.calls[1][1]?.body)).values.every(
          (row: { availability: number }) => row.availability === 0,
        ),
      ).toBe(true);
      expect((await f.state()).acknowledged_snapshot.restrictions[0].rate).toBe("1750.00");
      expect((await f.current()).sync_dirty_at).toBeNull();
    });
    it("forces full recovery when the source changes during an uncertain pending request", async () => {
      const f = await fixture();
      await f.sync();
      await db.query("update units set base_price=1700 where id=$1", [f.unit]);
      f.transport.mockResolvedValueOnce(reply(503));
      await expect(f.sync()).rejects.toThrow("channex_api_error");
      await db.query("update units set base_price=1800 where id=$1", [f.unit]);
      await db.query("update channel_connections set next_retry_at=null where id=$1", [
        f.connection,
      ]);
      expect(await f.sync()).toMatchObject({ mode: "full", submitted: true });
      expect((await f.state()).acknowledged_snapshot.restrictions[0].rate).toBe("1800.00");
    });
    it("allows explicit full recovery even when no local values changed", async () => {
      const f = await fixture();
      await f.sync();
      f.transport.mockClear();
      expect(await f.sync({ forceFull: true })).toMatchObject({ mode: "full", submitted: true });
      expect(f.transport).toHaveBeenCalledTimes(2);
    });
    it("rejects late/stale acknowledgement without consuming newer dirty writes", async () => {
      const f = await fixture();
      const before = await f.current();
      const claimed = await admin.rpc("claim_channel_sync", { p_connection_id: f.connection });
      const args = {
        p_connection_id: f.connection,
        p_lease_token: claimed.data,
        p_dirty_at: before.sync_dirty_at,
        p_external_property_id: before.external_property_id,
        p_environment: before.environment,
      };
      expect(
        (
          await admin.rpc("prepare_channel_ari", {
            ...args,
            p_snapshot: { availability: [], restrictions: [] },
            p_payload: { availability: [], restrictions: [] },
            p_from: "2026-09-29",
          })
        ).data,
      ).toBe(true);
      await db.query("update units set base_price=1900 where id=$1", [f.unit]);
      const dirty = (await f.current()).sync_dirty_at;
      expect((await admin.rpc("acknowledge_channel_ari", { ...args, p_receipts: {} })).data).toBe(
        false,
      );
      expect((await f.current()).sync_dirty_at).toBe(dirty);
      expect((await f.state()).acknowledged_snapshot).toBeNull();
      await db.query(
        "update channel_connections set sync_lease_until=now()-interval '1 minute' where id=$1",
        [f.connection],
      );
      expect(
        (await admin.rpc("acknowledge_channel_ari", { ...args, p_dirty_at: dirty, p_receipts: {} }))
          .data,
      ).toBe(false);
    });
    it("preserves a newer inventory change after success and resets baseline when a connection is disabled", async () => {
      const f = await fixture();
      await f.sync();
      await db.query("update units set base_price=2000 where id=$1", [f.unit]);
      expect((await f.current()).sync_dirty_at).not.toBeNull();
      await db.query("update channel_connections set enabled=false where id=$1", [f.connection]);
      expect(await f.state()).toBeUndefined();
      expect((await f.current()).last_ari_sync_at).toBeNull();
      expect((await f.current()).ari_horizon_date).toBeNull();
    });
    it("keeps snapshots and outbox RPCs inaccessible to authenticated and anonymous clients", async () => {
      const f = await fixture();
      await f.sync();
      const external = (await f.current()).external_property_id;
      await db.exec(
        `reset role; set test.actor='${OWNER}'; set request.jwt.claim.role='authenticated'; set role authenticated;`,
      );
      await expect(db.query("select * from channel_ari_state")).rejects.toThrow(
        "permission denied",
      );
      expect(
        (
          await admin.rpc("invalidate_channel_ari", {
            p_connection_id: f.connection,
            p_lease_token: crypto.randomUUID(),
            p_external_property_id: external,
            p_environment: "staging",
            p_full: true,
          })
        ).error?.message,
      ).toContain("permission denied");
      await db.exec("reset role; set role anon;");
      await expect(db.query("select * from channel_ari_state")).rejects.toThrow(
        "permission denied",
      );
      await service();
    });
  },
);

describe("partial field and date range encoding", () => {
  it("combines adjacent absolute availability changes and leaves unchanged rates alone", () => {
    const base = {
      connection: {
        id: "c",
        property_id: "p",
        external_property_id: "e",
        environment: "staging",
        enabled: true,
      } as ChannelConnection,
      units: [
        {
          id: "u",
          property_id: "p",
          active: true,
          base_price: 1000,
          weekend_pct: 0,
          cleaning_fee: 0,
          monthly_mult: Array(12).fill(100),
          min_stay: 1,
          max_guests: 2,
        },
      ],
      mappings: [{ unit_id: "u", room_type_id: "r", rate_plan_id: "rate" }],
      rules: [],
      from: "2026-10-01",
      to: "2026-10-05",
      maxStay: 30,
    };
    const previous = buildChannexAri({ ...base, bookings: [] });
    expect(
      sameAriSnapshot(
        {
          availability: [...previous.availability].reverse(),
          restrictions: [...previous.restrictions].reverse(),
        },
        previous,
      ),
    ).toBe(true);
    const current = buildChannexAri({
      ...base,
      bookings: [
        {
          unit_id: "u",
          status: "confirmed",
          checkin_date: "2026-10-02",
          checkout_date: "2026-10-04",
        },
      ],
    });
    expect(channexAriChanges(current, previous)).toEqual({
      restrictions: [],
      availability: [
        {
          property_id: "e",
          room_type_id: "r",
          date_from: "2026-10-02",
          date_to: "2026-10-03",
          availability: 0,
        },
      ],
    });
  });
});

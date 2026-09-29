import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
const read = (name: string) =>
  readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");
let db: PGlite;
let pid: string;
let otherPid: string;
let unit: string;
let otherUnit: string;
const OWNER = "00000000-0000-0000-0000-000000000001";
const payload = (id: string, from = "2099-06-01", to = "2099-06-03") => ({
  external_id: `sirvoy-csv:${id}:1`,
  unit_id: unit,
  guest_name: "Test Guest",
  guest_email: "guest@example.com",
  guest_phone: "+491701234567",
  checkin_date: from,
  checkout_date: to,
  guests: 2,
  amount_sek: 2590,
  internal_notes: "Original Sirvoy",
});
const run = (rows: unknown[]) =>
  db.query<{ result: { imported: number; skipped: number } }>(
    "select import_sirvoy_stays($1,$2::jsonb) as result",
    [pid, JSON.stringify(rows)],
  );
beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${OWNER}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid() to public;create schema storage;`,
  );
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
    "20260907162510_stay_operations_and_guest_fulfillment.sql",
    "20260914090500_guest_journey_queue_reconciliation.sql",
    "20260926083000_guest_ai_assist.sql",
    "20260929190056_sirvoy_cutover.sql",
    "20260929190057_journey_trigger_permissions.sql",
    "20260929190353_party_pricing.sql",
    "20260929190700_channex_channel_manager.sql",
    "20260929191426_addon_delivery_schedule.sql",
    "20260929192056_imported_payment_reconciliation.sql",
    "20260929192153_property_booking_terms.sql",
    "20260929200000_scheduled_message_delivery.sql",
  ])
    await db.exec(read(name));
  await db.exec("grant all on all tables in schema public to service_role;");
  const properties = await db.query<{ id: string }>(
    `insert into properties(owner_id,name) values($1,'Glamping'),($1,'Other property') returning id`,
    [OWNER],
  );
  pid = properties.rows[0].id;
  otherPid = properties.rows[1].id;
  unit = (
    await db.query<{ id: string }>(
      "insert into units(property_id,name,max_guests) values($1,'Tent',4) returning id",
      [pid],
    )
  ).rows[0].id;
  otherUnit = (
    await db.query<{ id: string }>(
      "insert into units(property_id,name) values($1,'Other') returning id",
      [otherPid],
    )
  ).rows[0].id;
  await db.exec("set request.jwt.claim.role='service_role';set role service_role;");
}, 180000);
afterAll(async () => {
  await db?.close();
});
describe("Atomic Sirvoy import", () => {
  it("imports editable source-owned stays in SEK without pending communications", async () => {
    expect((await run([payload("A")])).rows[0].result).toEqual({ imported: 1, skipped: 0 });
    const saved = (
      await db.query<{ source: string; amount: number; pending: number }>(
        "select source,payment_amount as amount,(select count(*)::integer from scheduled_messages s where s.booking_id=b.id and s.status='pending') as pending from bookings b where external_id='sirvoy-csv:A:1'",
      )
    ).rows[0];
    expect(saved).toEqual({ source: "manual", amount: 2590, pending: 0 });
  });
  it("is idempotent and never overwrites an existing stay", async () => {
    expect((await run([{ ...payload("A"), guest_name: "Changed Name" }])).rows[0].result).toEqual({
      imported: 0,
      skipped: 1,
    });
    expect(
      (
        await db.query<{ guest_name: string }>(
          "select guest_name from bookings where external_id='sirvoy-csv:A:1'",
        )
      ).rows[0].guest_name,
    ).toBe("Test Guest");
  });
  it("rolls back every row if a later row conflicts", async () => {
    await expect(run([payload("B", "2099-06-10", "2099-06-12"), payload("C")])).rejects.toThrow(
      "booking_overlap",
    );
    expect(
      (await db.query("select id from bookings where external_id='sirvoy-csv:B:1'")).rows,
    ).toHaveLength(0);
  });
  it("rejects cross-property mapping and over-capacity batches", async () => {
    await expect(run([{ ...payload("D"), unit_id: otherUnit }])).rejects.toThrow(
      "invalid_import_row",
    );
    await expect(run([{ ...payload("E", "2099-07-01", "2099-07-03"), guests: 5 }])).rejects.toThrow(
      "capacity_exceeded",
    );
  });
  it("does not expose its service RPC or the journey trigger to guests/operators", async () => {
    for (const role of ["anon", "authenticated"]) {
      const permission = (
        await db.query<{ allowed: boolean }>(
          "select has_function_privilege($1,'public.import_sirvoy_stays(uuid,jsonb)','EXECUTE') as allowed",
          [role],
        )
      ).rows[0];
      expect(permission.allowed).toBe(false);
      expect(
        (
          await db.query<{ allowed: boolean }>(
            "select has_function_privilege($1,'public.reconcile_journey_template_queue()','EXECUTE') as allowed",
            [role],
          )
        ).rows[0].allowed,
      ).toBe(false);
    }
  });
  it("validates opt-in adult prices without modifying flat pricing", async () => {
    await expect(
      db.query("update units set party_pricing_enabled=true,adult_prices=$1 where id=$2", [
        [995, 1995],
        unit,
      ]),
    ).rejects.toThrow("units_party_prices");
    await db.query("update units set party_pricing_enabled=true,adult_prices=$1 where id=$2", [
      [995, 1995, 2895, 3495],
      unit,
    ]);
    await expect(
      db.query("update units set child_free_through_age=14,child_max_age=12 where id=$1", [unit]),
    ).rejects.toThrow("units_party_prices");
  });
  it("keeps direct quote snapshots immutable for browser updates", async () => {
    await db.exec(
      `reset role;grant select,update on bookings,properties,units to authenticated;set test.actor='${OWNER}';set request.jwt.claim.role='authenticated';set role authenticated;`,
    );
    await expect(
      db.exec("update bookings set quote_snapshot='{}'::jsonb where external_id='sirvoy-csv:A:1'"),
    ).rejects.toThrow("booking_quote_server_only");
    await db.exec(
      "reset role;set test.actor='';set request.jwt.claim.role='service_role';set role service_role;",
    );
  });
  it("accepts adult-only seasonal rates and rejects empty or multidimensional tables", async () => {
    await db.query(
      "insert into rate_rules(property_id,kind,date_from,date_to,adult_prices) values($1,'price_override','2099-01-01','2099-12-31',$2)",
      [pid, [995, 1995, 2895, 3495]],
    );
    await expect(
      db.query(
        "insert into rate_rules(property_id,kind,date_from,date_to,adult_prices) values($1,'price_override','2099-01-01','2099-12-31','{}')",
        [pid],
      ),
    ).rejects.toThrow();
    await expect(
      db.query("update units set adult_prices='{{995,1995},{2895,3495}}'::integer[] where id=$1", [
        unit,
      ]),
    ).rejects.toThrow("units_party_prices");
  });
  it("stores property-specific HTTPS terms and rejects credentials or insecure URLs", async () => {
    await db.query("update properties set booking_terms_url=$1 where id=$2", [
      "https://goglampingsweden.se/bokningsvillkor",
      pid,
    ]);
    for (const url of [
      "http://example.com/terms",
      "javascript:alert(1)",
      "https://user:secret@example.com/terms",
    ]) {
      await expect(
        db.query("update properties set booking_terms_url=$1 where id=$2", [url, pid]),
      ).rejects.toThrow("property_booking_terms_https");
    }
    await db.query("update properties set booking_terms_url=null where id=$1", [pid]);
  });
});

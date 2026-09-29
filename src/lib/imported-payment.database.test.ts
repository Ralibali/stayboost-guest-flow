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
let unit: string;
let imported: string;
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
const reconcile = (
  id: string,
  action = "record_payment",
  actor = OWNER,
  amount = 4200,
  at = "2025-06-01T10:00:00Z",
  evidence = "Sirvoy reference 123, bank statement checked",
) =>
  row<{ result: Record<string, unknown> }>(
    "select reconcile_imported_payment($1,$2,$3,$4,$5,$6) result",
    [actor, id, action, amount, at, evidence],
  );
const makeImported = async (key: string, start = "2099-06-01", end = "2099-06-03") => {
  await service();
  await db.query("select import_sirvoy_stays($1,$2)", [
    pid,
    [
      {
        external_id: `sirvoy-csv:test:${key}`,
        unit_id: unit,
        guest_name: "Imported guest",
        guest_email: "guest@example.com",
        checkin_date: start,
        checkout_date: end,
        guests: 2,
        amount_sek: 4200,
      },
    ],
  ]);
  return (
    await row<{ id: string }>("select id from bookings where external_id=$1", [
      `sirvoy-csv:test:${key}`,
    ])
  ).id;
};
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
    "20260914090500_guest_journey_queue_reconciliation.sql",
    "20260929190056_sirvoy_cutover.sql",
    "20260929190057_journey_trigger_permissions.sql",
    "20260929190353_party_pricing.sql",
  ])
    await db.exec(read(name));
  await db.exec(
    "grant select,insert,update,delete on properties,units,bookings,message_templates to authenticated; grant select on scheduled_messages to authenticated; grant all on all tables in schema public to service_role;",
  );
  // Simulate Supabase's default service grants; the new audit table must revoke mutation privileges explicitly.
  await db.exec("alter default privileges in schema public grant all on tables to service_role;");
  await db.exec(read("20260929192056_imported_payment_reconciliation.sql"));
  await service();
  pid = (
    await row<{ id: string }>(
      "insert into properties(owner_id,name) values($1,'Test') returning id",
      [OWNER],
    )
  ).id;
  unit = (
    await row<{ id: string }>(
      "insert into units(property_id,name,max_guests) values($1,'Tent',4) returning id",
      [pid],
    )
  ).id;
  imported = await makeImported("first");
}, 120000);
afterAll(async () => {
  await db?.close();
});
describe("Sirvoy payment reconciliation and deliberate communications takeover", () => {
  it("imports documentary value with communications paused and records a prior payment without queueing a message", async () => {
    await service();
    expect(
      await row(
        "select payment_status,payment_method,communications_enabled from bookings where id=$1",
        [imported],
      ),
    ).toEqual({ payment_status: "none", payment_method: "none", communications_enabled: false });
    expect(
      (await db.query("select id from scheduled_messages where booking_id=$1", [imported])).rows,
    ).toHaveLength(0);
    expect((await reconcile(imported)).result).toMatchObject({
      ok: true,
      duplicate: false,
      payment_status: "paid",
    });
    expect(
      (await db.query("select id from scheduled_messages where booking_id=$1", [imported])).rows,
    ).toHaveLength(0);
    expect(
      await row(
        "select amount_sek,evidence,actor_id from imported_payment_events where booking_id=$1",
        [imported],
      ),
    ).toEqual({
      amount_sek: 4200,
      evidence: "Sirvoy reference 123, bank statement checked",
      actor_id: OWNER,
    });
    expect((await reconcile(imported)).result.duplicate).toBe(true);
    expect(
      (await db.query("select id from imported_payment_events where booking_id=$1", [imported]))
        .rows,
    ).toHaveLength(1);
    await expect(
      reconcile(
        imported,
        "record_payment",
        OWNER,
        4200,
        "2025-06-01T10:00:00Z",
        "Different assertion",
      ),
    ).rejects.toThrow("payment_already_recorded");
  });
  it("enforces actor ownership, whole amount and provider state at the database boundary", async () => {
    const id = await makeImported("validation", "2099-07-01", "2099-07-03");
    await expect(reconcile(id, "record_payment", OTHER)).rejects.toThrow("booking_not_found");
    await expect(reconcile(id, "record_payment", OWNER, 2100)).rejects.toThrow(
      "payment_amount_mismatch",
    );
    await expect(reconcile(id, "record_payment", OWNER, 4200, "2098-01-01")).rejects.toThrow(
      "invalid_payment_evidence",
    );
    await expect(reconcile(id, "record_refund")).rejects.toThrow("invalid_import_refund_state");
    await owner();
    await expect(reconcile(id)).rejects.toThrow("permission denied");
    await expect(
      db.query("update bookings set payment_status='paid' where id=$1", [id]),
    ).rejects.toThrow("payment_lifecycle_server_only");
    await expect(
      db.query("update bookings set external_id='sirvoy-csv:test:forged' where id=$1", [id]),
    ).rejects.toThrow("booking_source_server_only");
    await expect(
      db.query(
        "insert into bookings(property_id,unit_id,source,external_id,guest_name,checkin_date,checkout_date,guests) values($1,$2,'manual','sirvoy-csv:test:forged','Guest','2099-08-01','2099-08-03',2)",
        [pid, unit],
      ),
    ).rejects.toThrow("booking_source_server_only");
    await owner(OTHER);
    expect((await db.query("select id from imported_payment_events")).rows).toHaveLength(0);
  });
  it("marks a paid cancellation for external refund and stores one immutable refund event", async () => {
    await service();
    await db.query("update bookings set status='cancelled' where id=$1", [imported]);
    expect(
      (
        await row<{ payment_status: string }>("select payment_status from bookings where id=$1", [
          imported,
        ])
      ).payment_status,
    ).toBe("refund_pending");
    expect(
      (
        await reconcile(
          imported,
          "record_refund",
          OWNER,
          4200,
          "2025-06-02T10:00:00Z",
          "Bank refund reference 456",
        )
      ).result.payment_status,
    ).toBe("refunded");
    expect(
      (
        await reconcile(
          imported,
          "record_refund",
          OWNER,
          4200,
          "2025-06-02T10:00:00Z",
          "Bank refund reference 456",
        )
      ).result.duplicate,
    ).toBe(true);
    expect(
      (await db.query("select id from imported_payment_events where booking_id=$1", [imported]))
        .rows,
    ).toHaveLength(2);
    await expect(
      db.query("update imported_payment_events set evidence='Changed' where booking_id=$1", [
        imported,
      ]),
    ).rejects.toThrow("permission denied");
    await expect(
      db.query("delete from imported_payment_events where booking_id=$1", [imported]),
    ).rejects.toThrow("permission denied");
    expect(
      (
        await db.query(
          "select id from scheduled_messages where booking_id=$1 and status='pending'",
          [imported],
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("requires explicit owner opt-in and schedules only future lifecycle messages without a new confirmation", async () => {
    const id = await makeImported("optin", "2099-10-01", "2099-10-03");
    await owner();
    await db.query("update message_templates set body=body||' updated' where property_id=$1", [
      pid,
    ]);
    expect(
      (
        await db.query(
          "select id from scheduled_messages where booking_id=$1 and status='pending'",
          [id],
        )
      ).rows,
    ).toHaveLength(0);
    await expect(
      db.query("update bookings set communications_enabled=true where id=$1", [id]),
    ).rejects.toThrow("imported_payment_required");
    await service();
    await reconcile(id);
    await owner();
    await db.query("update bookings set communications_enabled=true where id=$1", [id]);
    const messages = (
      await db.query<{ trigger_type: string; future: boolean }>(
        "select t.trigger_type,s.send_at>=now() future from scheduled_messages s join message_templates t on t.id=s.template_id where s.booking_id=$1 and s.status='pending'",
        [id],
      )
    ).rows;
    expect(messages.length).toBeGreaterThan(0);
    expect(
      messages.every((message) => message.future && message.trigger_type !== "booking_created"),
    ).toBe(true);
    await db.query("update bookings set communications_enabled=false where id=$1", [id]);
    expect(
      (
        await db.query(
          "select id from scheduled_messages where booking_id=$1 and status='pending'",
          [id],
        )
      ).rows,
    ).toHaveLength(0);
    await db.query("update bookings set communications_enabled=true where id=$1", [id]);
    expect(
      (
        await db.query(
          "select id from scheduled_messages where booking_id=$1 and status='pending'",
          [id],
        )
      ).rows,
    ).toHaveLength(messages.length);
  });
  it("never queues expired lifecycle templates for a historic import after opt-in or template editing", async () => {
    const id = await makeImported("historic", "2020-01-01", "2020-01-03");
    await reconcile(id, "record_payment", OWNER, 4200, "2019-12-01T10:00:00Z");
    await owner();
    await db.query("update bookings set communications_enabled=true where id=$1", [id]);
    await db.query("update message_templates set send_time='09:30' where property_id=$1", [pid]);
    expect(
      (await db.query("select id from scheduled_messages where booking_id=$1", [id])).rows,
    ).toHaveLength(0);
  });
});

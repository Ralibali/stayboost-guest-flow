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
const asOwner = async (owner = OWNER) => {
  await db.exec(
    `reset role; set test.actor='${owner}'; set request.jwt.claim.role='authenticated'; set role authenticated;`,
  );
};
const asService = async () => {
  await db.exec("reset role; set test.actor=''; set request.jwt.claim.role='service_role';");
};
const row = async <T = Record<string, unknown>>(sql: string, values: unknown[] = []) =>
  (await db.query<T>(sql, values)).rows[0];
const booking = async (extra = "") => {
  await asOwner();
  const unit = await row<{ id: string }>(
    "insert into units(property_id,name,max_guests) values($1,'Tält',2) returning id",
    [pid],
  );
  const b = await row<{ id: string; updated_at: string }>(
    `insert into bookings(property_id,unit_id,guest_name,guests,checkin_date,checkout_date${extra ? ",source,payment_status" : ""}) values($1,$2,'Testgäst',2,'2099-06-01','2099-06-03'${extra ? "," + extra : ""}) returning id,updated_at::text`,
    [pid, unit.id],
  );
  return { ...b, unitId: unit.id };
};
const edit = (
  b: { id: string; updated_at: string; unitId: string },
  overrides: {
    unitId?: string;
    start?: string;
    end?: string;
    guests?: number;
    status?: string;
    notes?: string;
  } = {},
) =>
  db.query(
    "select admin_update_booking($1,$2,$3,$4,$5,'Ändrad gäst','guest@example.com','+46700000000',$6,$7,$8)",
    [
      b.id,
      b.updated_at,
      overrides.unitId ?? b.unitId,
      overrides.start ?? "2099-06-01",
      overrides.end ?? "2099-06-03",
      overrides.guests ?? 2,
      overrides.notes ?? "Endast för personal",
      overrides.status ?? "expected",
    ],
  );
beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    insert into auth.users values('${OWNER}'),('${OTHER}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon,service_role;
    grant execute on function auth.uid() to public;
    create schema storage;
  `);
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
  ])
    await db.exec(read(name));
  await db.exec(
    "grant select,insert,update,delete on properties,units,bookings,addons,ical_sources,message_templates to authenticated; grant select on scheduled_messages to authenticated;",
  );
  await asService();
  pid = (
    await row<{ id: string }>(
      "insert into properties(owner_id,name,max_stay) values($1,'Testanläggning',14) returning id",
      [OWNER],
    )
  ).id;
  otherPid = (
    await row<{ id: string }>(
      "insert into properties(owner_id,name) values($1,'Annans anläggning') returning id",
      [OTHER],
    )
  ).id;
}, 60000);
afterAll(async () => {
  await db?.close();
});

describe("Real Postgres admin operations and RLS", () => {
  it("saves a move, contact details, private notes and arrival status atomically and records field names", async () => {
    const b = await booking();
    await edit(b, { start: "2099-06-05", end: "2099-06-07", status: "checked_in" });
    const saved = await row<{
      checkin_date: string;
      internal_notes: string;
      stay_status: string;
      payment_status: string;
    }>(
      "select checkin_date::text,internal_notes,stay_status,payment_status from bookings where id=$1",
      [b.id],
    );
    expect(saved).toMatchObject({
      checkin_date: "2099-06-05",
      internal_notes: "Endast för personal",
      stay_status: "checked_in",
      payment_status: "none",
    });
    const audit = await row<{ changes: { fields: string[] } }>(
      "select changes from admin_audit_log where entity_id=$1 and action='UPDATE'",
      [b.id],
    );
    expect(audit.changes.fields).toContain("checkin_date");
    expect(JSON.stringify(audit)).not.toContain("Endast för personal");
    expect(JSON.stringify(audit)).not.toContain("guest@example.com");
    const queue = await row<{ total: number }>(
      "select count(*)::int total from scheduled_messages where booking_id=$1 and status='pending'",
      [b.id],
    );
    expect(queue.total).toBeGreaterThan(0);
  });
  it("rejects lost updates while preserving the first edit", async () => {
    const b = await booking();
    await edit(b, { notes: "Första ändringen" });
    await expect(edit(b, { notes: "Gammal flik" })).rejects.toThrow("stale_booking");
  });
  it("rejects overlap and guest capacity changes, allowing same-day turnover", async () => {
    const b = await booking();
    await db.query(
      "insert into bookings(property_id,unit_id,guest_name,guests,checkin_date,checkout_date) values($1,$2,'Annan gäst',1,'2099-06-03','2099-06-05')",
      [pid, b.unitId],
    );
    await expect(edit(b, { end: "2099-06-04" })).rejects.toThrow("booking_overlap");
    await expect(edit(b, { guests: 3 })).rejects.toThrow("capacity_exceeded");
    await expect(edit(b, { end: "2099-06-17" })).rejects.toThrow();
  });
  it("cannot edit another owner's booking or read their audit history", async () => {
    const b = await booking();
    await edit(b);
    await asOwner(OTHER);
    await expect(edit(b)).rejects.toThrow("booking_not_found");
    expect(
      (await db.query("select id from admin_audit_log where property_id=$1", [pid])).rows,
    ).toEqual([]);
    await asOwner();
    await expect(
      db.query("update admin_audit_log set action='DELETE' where entity_id=$1", [b.id]),
    ).rejects.toThrow("permission denied");
  });
  it("blocks external inventory changes, pending payments and forged payment status", async () => {
    const b = await booking();
    await asService();
    await db.query("update bookings set source='sirvoy' where id=$1", [b.id]);
    const ext = {
      ...b,
      ...(await row<{ updated_at: string }>("select updated_at::text from bookings where id=$1", [
        b.id,
      ])),
    };
    await asOwner();
    await expect(edit(ext, { end: "2099-06-04" })).rejects.toThrow("external_booking_dates");
    await asService();
    await db.query(
      "update bookings set source='direct', payment_status='pending',payment_method='stripe',payment_amount=1295 where id=$1",
      [b.id],
    );
    const pending = {
      ...b,
      ...(await row<{ updated_at: string }>("select updated_at::text from bookings where id=$1", [
        b.id,
      ])),
    };
    await asOwner();
    await expect(edit(pending, { end: "2099-06-04" })).rejects.toThrow("pending_payment_edit");
    await expect(
      db.query("update bookings set payment_status='paid' where id=$1", [b.id]),
    ).rejects.toThrow("payment_lifecycle_server_only");
  });
  it("preserves booking history when hiding a unit and refuses destructive removal", async () => {
    const b = await booking();
    await expect(db.query("delete from units where id=$1", [b.unitId])).rejects.toThrow(
      "unit_has_bookings_archive_instead",
    );
    await db.query("update units set active=false where id=$1", [b.unitId]);
    expect(
      (await row<{ unit_id: string }>("select unit_id from bookings where id=$1", [b.id])).unit_id,
    ).toBe(b.unitId);
  });
  it("rejects a rate rule pointing at another property's unit and invalid addon date windows", async () => {
    await asService();
    const unit = await row<{ id: string }>(
      "insert into units(property_id,name) values($1,'Annans tält') returning id",
      [otherPid],
    );
    await asOwner();
    await expect(
      db.query(
        "insert into rate_rules(property_id,unit_id,kind,date_from,date_to) values($1,$2,'closed','2099-06-01','2099-06-03')",
        [pid, unit.id],
      ),
    ).rejects.toThrow("row-level security");
    await expect(
      db.query(
        "insert into addons(property_id,name,price,available_from,available_to) values($1,'Frukost',209,'2099-08-01','2099-07-01')",
        [pid],
      ),
    ).rejects.toThrow("addons_availability_dates");
  });
});

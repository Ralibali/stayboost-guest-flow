import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
let db: PGlite;
const owner = "00000000-0000-0000-0000-000000000001",
  other = "00000000-0000-0000-0000-000000000002";
const property = "10000000-0000-0000-0000-000000000001",
  otherProperty = "10000000-0000-0000-0000-000000000002";
const booking = "20000000-0000-0000-0000-000000000001",
  otherBooking = "20000000-0000-0000-0000-000000000002";
let message: string;
const actor = async (id = owner) =>
  db.exec(`reset role; set test.actor='${id}'; set role authenticated`);
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    grant usage on schema auth,public to anon,authenticated;
    create table public.properties(id uuid primary key, owner_id uuid);
    create table public.bookings(id uuid primary key,property_id uuid not null references properties(id));
    create function public.owns_property(pid uuid) returns boolean language sql stable as $$select exists(select 1 from public.properties where id=pid and owner_id=auth.uid())$$;
    grant select on properties to authenticated;
    insert into properties values('${property}','${owner}'),('${otherProperty}','${other}');
    insert into bookings values('${booking}','${property}'),('${otherBooking}','${otherProperty}');
    create table public.chat_messages(id uuid primary key default gen_random_uuid(), property_id uuid not null references properties(id),visitor_name text,visitor_email text not null,message text not null, read_at timestamptz);
    alter table chat_messages enable row level security;
    create policy owner_read on chat_messages for select to authenticated using(public.owns_property(property_id));
    create policy owner_update on chat_messages for update to authenticated using(public.owns_property(property_id)) with check(public.owns_property(property_id));
  `);
  await db.exec(
    readFileSync(
      new URL(
        "../../supabase/migrations/20261005151450_unified_inbox_workflow.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
}, 30000);
afterAll(async () => {
  await db?.close();
});
describe("Inbox real Postgres permissions and booking boundaries", () => {
  it("lets the property owner log an external message and manage its private workflow", async () => {
    await actor();
    const result = await db.query<{ id: string }>(
      `insert into chat_messages(property_id,visitor_name,visitor_email,visitor_phone,message,channel,logged_manually) values($1,'Guest','','+46701234567','Question','whatsapp',true) returning id`,
      [property],
    );
    message = result.rows[0].id;
    await db.query(
      `update chat_messages set booking_id=$1,inbox_status='waiting',assigned_to='Reception',internal_note='Private',followup_date='2026-10-05' where id=$2`,
      [booking, message],
    );
    const saved = await db.query(
      `select inbox_version,internal_note from chat_messages where id=$1`,
      [message],
    );
    expect(saved.rows[0]).toMatchObject({ inbox_version: 2, internal_note: "Private" });
    expect(
      (
        await db.query(
          `update chat_messages set internal_note='stale' where id=$1 and inbox_version=1 returning id`,
          [message],
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("blocks another owner from reading, changing or inserting another property's messages", async () => {
    await actor(other);
    expect(
      (await db.query(`select * from chat_messages where id=$1`, [message])).rows,
    ).toHaveLength(0);
    expect(
      (
        await db.query(`update chat_messages set internal_note='leak' where id=$1 returning id`, [
          message,
        ])
      ).rows,
    ).toHaveLength(0);
    await expect(
      db.query(
        `insert into chat_messages(property_id,visitor_name,visitor_email,message,channel,logged_manually) values($1,'Guest','guest@example.com','Question','email',true)`,
        [property],
      ),
    ).rejects.toThrow(/row-level security/);
  });
  it("rejects cross-property booking links, including for the owner of both properties", async () => {
    await db.exec(
      `reset role; update properties set owner_id='${owner}' where id='${otherProperty}'`,
    );
    await actor();
    await expect(
      db.query(`update chat_messages set booking_id=$1 where id=$2`, [otherBooking, message]),
    ).rejects.toThrow(/inbox_booking_same_property/);
  });
  it("does not allow a manual message to impersonate the automatic webchat source", async () => {
    await actor();
    await expect(
      db.query(
        `insert into chat_messages(property_id,visitor_name,visitor_email,message,channel,logged_manually) values($1,'Guest','guest@example.com','Question','webchat',false)`,
        [property],
      ),
    ).rejects.toThrow(/row-level security/);
  });
  it("preserves source identity and prevents moving a message to another property", async () => {
    await actor();
    await expect(
      db.query(`update chat_messages set channel='webchat',logged_manually=false where id=$1`, [
        message,
      ]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query(`update chat_messages set property_id=$1 where id=$2`, [otherProperty, message]),
    ).rejects.toThrow(/permission denied/);
    await expect(db.query(`delete from chat_messages where id=$1`, [message])).rejects.toThrow(
      /permission denied/,
    );
  });
  it("rejects fabricated telephone contacts", async () => {
    await actor();
    await expect(
      db.query(
        `insert into chat_messages(property_id,visitor_name,visitor_email,visitor_phone,message,channel,logged_manually) values($1,'Guest','','------','Question','sms',true)`,
        [property],
      ),
    ).rejects.toThrow(/row-level security/);
  });
  it("blocks anonymous reads and writes", async () => {
    await db.exec("reset role; set role anon");
    await expect(db.query("select * from chat_messages")).rejects.toThrow(/permission denied/);
    await expect(db.query("update chat_messages set inbox_status='resolved'")).rejects.toThrow(
      /permission denied/,
    );
  });
});

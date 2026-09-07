import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const db = new PGlite();
let checks = 0;
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to anon,authenticated,service_role;
create table public.properties(id uuid primary key,owner_id uuid);create table public.units(id uuid primary key,property_id uuid,name text);
create table public.bookings(id uuid primary key,property_id uuid references public.properties,unit_id uuid references public.units,guest_name text,checkin_date date,checkout_date date,status text,stay_status text,payment_status text);
create table public.addons(id uuid primary key,property_id uuid,name text,price_type text);
create table public.booking_addons(booking_id uuid references public.bookings,addon_id uuid references public.addons on delete cascade,quantity integer,unit_price integer,primary key(booking_id,addon_id));
create function public.owns_property(p uuid) returns boolean language sql security definer set search_path=public as $$select exists(select 1 from public.properties where id=p and owner_id=auth.uid())$$;
insert into public.properties values('${id(10)}','${id(1)}'),('${id(20)}','${id(2)}');insert into public.units values('${id(30)}','${id(10)}','Tält A'),('${id(31)}','${id(10)}','Tält B'),('${id(40)}','${id(20)}','Annat boende');
insert into public.bookings values('${id(100)}','${id(10)}','${id(30)}','Gäst',current_date,current_date+2,'confirmed','expected','paid'),('${id(200)}','${id(20)}','${id(40)}','Annan gäst',current_date,current_date+2,'confirmed','expected','none');
insert into public.addons values('${id(50)}','${id(10)}','Frukost','per_booking'),('${id(51)}','${id(10)}','Ved','per_booking'),('${id(60)}','${id(20)}','Privat','per_booking');
insert into public.booking_addons values('${id(100)}','${id(50)}',2,150);`);
await db.exec(
  readFileSync(
    new URL(
      "../supabase/migrations/20260907162510_stay_operations_and_guest_fulfillment.sql",
      import.meta.url,
    ),
    "utf8",
  ),
);
async function as(n, role = "authenticated") {
  await db.exec(
    `reset role;select set_config('request.jwt.claim.sub','${n ? id(n) : ""}',false);set role ${role}`,
  );
}
async function val(sql, args = []) {
  return Object.values((await db.query(sql, args)).rows[0])[0];
}
function eq(a, b) {
  assert.deepEqual(a, b);
  checks++;
}
async function fail(sql, args, rx) {
  await assert.rejects(db.query(sql, args), rx);
  checks++;
}
const from = await val("select current_date::text"),
  to = await val("select (current_date+14)::text");
const board = "select public.stay_operations_board($1,$2,$3)",
  change = "select public.change_stay_operation($1,$2,$3,$4)";
await as(null, "anon");
await fail(board, [id(10), from, to], /permission denied/);
await fail("select * from public.stay_operations", [], /permission denied/);
await as(2);
await fail(board, [id(10), from, to], /saknas/);
eq(await val("select count(*)::int from public.stay_operations"), 0);
await as(1);
let rows = await val(board, [id(10), from, to]);
eq(rows.length, 2);
eq((await val(board, [id(10), from, to])).length, 2);
let cleaning = rows.find((x) => x.kind === "cleaning"),
  addon = rows.find((x) => x.kind === "addon");
eq(addon.details.name_source, "current_catalog");
eq(addon.status, "pending");
eq(addon.details.price_type, null);
eq(addon.details.unit_price, 150);
await fail("update public.stay_operations set status=$1", ["done"], /permission denied/);
await fail(change, [cleaning.id, 1, "status", { status: "done", note: "skip" }], /inte tillåten/);
cleaning = await val(change, [cleaning.id, 1, "assign", { assigned_to: "Anna" }]);
eq(cleaning.assigned_to, "Anna");
await fail(change, [cleaning.id, 1, "assign", { assigned_to: "Stale" }], /ändrats/);
cleaning = await val(change, [
  cleaning.id,
  cleaning.revision,
  "status",
  { status: "in_progress", note: "Förbereder städningen" },
]);
await fail(
  change,
  [cleaning.id, cleaning.revision, "status", { status: "done", note: "Klar" }],
  /utcheckning/,
);
await db.exec("reset role");
await db.query("update public.bookings set stay_status='checked_out' where id=$1", [id(100)]);
await as(1);
cleaning = await val(change, [
  cleaning.id,
  cleaning.revision,
  "status",
  { status: "done", note: "Städat och kontrollerat" },
]);
eq(cleaning.status, "done");
eq(cleaning.history.length, 3);
await db.exec("reset role");
await db.query("update public.bookings set unit_id=$1 where id=$2", [id(31), id(100)]);
await as(1);
rows = await val(board, [id(10), from, to]);
eq(rows.find((x) => x.id === cleaning.id).context_changed, true);
await fail(change, [cleaning.id, cleaning.revision, "assign", { assigned_to: "B" }], /ändrats/);
await fail(change, [cleaning.id, cleaning.revision, "reset", { note: "" }], /Beskriv/);
cleaning = await val(change, [
  cleaning.id,
  cleaning.revision,
  "reset",
  { note: "Gästen flyttade till tält B" },
]);
eq(cleaning.status, "pending");
eq(cleaning.details.unit_id, id(31));
eq(cleaning.history.length, 4);
eq(cleaning.history[3].previous_basis.unit_id, id(30));
eq(cleaning.history[3].previous_status, "done");
await as(2);
await fail(change, [cleaning.id, cleaning.revision, "reset", { note: "Intrång" }], /saknas/);
await db.exec("reset role");
await db.query("insert into public.booking_addons values($1,$2,$3,$4)", [id(100), id(51), 1, 75]);
await fail(
  "insert into public.booking_addons values($1,$2,$3,$4)",
  [id(100), id(60), 1, 1],
  /tillhör inte/,
);
await fail(
  "update public.booking_addons set quantity=3 where addon_id=$1",
  [id(51)],
  /skrivas över/,
);
await as(1);
rows = await val(board, [id(10), from, to]);
let purchased = rows.find((x) => x.title === "Ved");
eq(purchased.details.name_source, "purchase");
eq(purchased.details.price_type, "per_booking");
eq(purchased.details.quantity, 1);
await db.exec("reset role");
await db.query("delete from public.addons where id=$1", [id(51)]);
await as(1);
rows = await val(board, [id(10), from, to]);
eq(
  rows.some((x) => x.id === purchased.id),
  true,
);
purchased = await val(change, [
  purchased.id,
  purchased.revision,
  "status",
  { status: "in_progress", note: "Packar ved" },
]);
purchased = await val(change, [
  purchased.id,
  purchased.revision,
  "status",
  { status: "done", note: "Levererad vid tältet" },
]);
eq(purchased.status, "done");
eq(purchased.details.unit_price, 75);
await db.exec("reset role");
await db.query("update public.bookings set status='cancelled' where id=$1", [id(100)]);
await as(1);
await fail(change, [purchased.id, purchased.revision, "reset", { note: "Avbokad" }], /avbokad/);
rows = await val(board, [id(10), from, to]);
eq(rows.find((x) => x.id === purchased.id).status, "done");
eq(rows.find((x) => x.id === purchased.id).booking.status, "cancelled");
await db.close();
console.log(`PASS: ${checks} stay operations DB checks.`);

import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, expect, it } from "vitest";
import { addonAvailableForStay, priceAddons } from "../../supabase/functions/_shared/addons";

let db: PGlite;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select '${id(1)}'::uuid$$;
    create table properties(id uuid primary key, owner_id uuid);
    create table units(id uuid primary key, name text);
    create table bookings(id uuid primary key,property_id uuid,unit_id uuid,guest_name text,checkin_date date,checkout_date date,status text,stay_status text,payment_status text);
    create table addons(id uuid primary key,property_id uuid,name text,price_type text);
    create table booking_addons(booking_id uuid,addon_id uuid,quantity integer,unit_price integer,primary key(booking_id,addon_id));
    create function owns_property(p uuid) returns boolean language sql as $$select p='${id(10)}'::uuid$$;
    insert into properties values('${id(10)}','${id(1)}');insert into units values('${id(20)}','Tent');
    insert into bookings values('${id(30)}','${id(10)}','${id(20)}','Guest','2099-06-01','2099-06-04','confirmed','expected','paid');
    insert into addons values('${id(40)}','${id(10)}','Legacy breakfast','per_night'),('${id(41)}','${id(10)}','Breakfast','per_night'),('${id(42)}','${id(10)}','Late checkout','per_booking');
    insert into booking_addons values('${id(30)}','${id(40)}',2,209);`);
  for (const file of [
    "20260907162510_stay_operations_and_guest_fulfillment.sql",
    "20260929191426_addon_delivery_schedule.sql",
  ])
    await db.exec(
      readFileSync(new URL(`../../supabase/migrations/${file}`, import.meta.url), "utf8"),
    );
  await db.exec(
    `update addons set fulfillment_type='each_morning' where id in ('${id(40)}','${id(41)}');update addons set fulfillment_type='departure' where id='${id(42)}';`,
  );
}, 60000);
afterAll(async () => {
  await db?.close();
});

it("retains old purchases and creates one immutable delivery per purchased morning", async () => {
  expect((await db.query("select id from stay_operations")).rows).toHaveLength(1);
  await db.exec(
    `insert into booking_addons values('${id(30)}','${id(41)}',2,209),('${id(30)}','${id(42)}',1,400);`,
  );
  const rows = (
    await db.query<{ due_date: string; quantity: number }>(
      "select due_date::text, (details->>'quantity')::integer as quantity from stay_operations where title='Breakfast' order by due_date",
    )
  ).rows;
  expect(rows).toEqual(
    ["2099-06-02", "2099-06-03", "2099-06-04"].map((due_date) => ({ due_date, quantity: 2 })),
  );
  expect(
    (
      await db.query<{ day: string }>(
        "select due_date::text as day from stay_operations where title='Late checkout'",
      )
    ).rows[0].day,
  ).toBe("2099-06-04");
  await db.exec(
    `update addons set name='Changed catalog',fulfillment_type='arrival' where id='${id(41)}';update booking_addons set quantity=quantity where addon_id='${id(41)}';`,
  );
  expect(
    (await db.query("select id from stay_operations where title='Breakfast'")).rows,
  ).toHaveLength(3);
  await expect(
    db.exec(`update booking_addons set quantity=3 where addon_id='${id(41)}'`),
  ).rejects.toThrow("inte skrivas över");
});

it("keeps morning dates on reopening and requires an explicit valid date after a move", async () => {
  const task = (
    await db.query<{ id: string; revision: number }>(
      "select id,revision from stay_operations where title='Breakfast' order by due_date limit 1",
    )
  ).rows[0];
  await db.query("select change_stay_operation($1,$2,'reset','{\"note\":\"Reviewed\"}')", [
    task.id,
    task.revision,
  ]);
  expect(
    (
      await db.query<{ due: string }>(
        "select due_date::text as due from stay_operations where id=$1",
        [task.id],
      )
    ).rows[0].due,
  ).toBe("2099-06-02");
  await db.exec(
    `update bookings set checkin_date='2099-07-01',checkout_date='2099-07-03' where id='${id(30)}';`,
  );
  await expect(
    db.query("select change_stay_operation($1,2,'reset','{\"note\":\"Moved\"}')", [task.id]),
  ).rejects.toThrow("nytt leveransdatum");
  await db.query(
    'select change_stay_operation($1,2,\'reset\',\'{"note":"Confirmed with guest","due_date":"2099-07-02"}\')',
    [task.id],
  );
  const saved = (
    await db.query<{ due: string; original: string }>(
      "select due_date::text as due,details->>'purchase_checkin_date' as original from stay_operations where id=$1",
      [task.id],
    )
  ).rows[0];
  expect(saved).toEqual({ due: "2099-07-02", original: "2099-06-01" });
});

it("checks the breakfast delivery dates against the season and charges quantity per morning", () => {
  const breakfast = {
    id: "breakfast",
    name: "Breakfast",
    description: null,
    image_url: null,
    price: 209,
    price_type: "per_night" as const,
    active: true,
    sort_order: 0,
    fulfillment_type: "each_morning" as const,
    available_from: "2027-06-08",
    available_to: "2027-08-31",
  };
  expect(addonAvailableForStay(breakfast, "2027-06-07", "2027-06-09")).toBe(true);
  expect(addonAvailableForStay(breakfast, "2027-08-31", "2027-09-01")).toBe(false);
  expect(
    priceAddons([{ id: "breakfast", quantity: 2 }], [breakfast], 2, {
      checkin: "2027-06-07",
      checkout: "2027-06-09",
    })[0].lineTotal,
  ).toBe(836);
});

it("rejects a daily delivery schedule with a one-time price", async () => {
  await expect(
    db.exec(`update addons set fulfillment_type='each_morning' where id='${id(42)}'`),
  ).rejects.toThrow("addons_fulfillment_type_valid");
});

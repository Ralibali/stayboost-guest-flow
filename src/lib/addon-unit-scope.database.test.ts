import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const OWNER = id(1),
  OTHER = id(2),
  PROPERTY = id(10),
  SECOND = id(11),
  FOREIGN = id(12);
const TENT1 = id(20),
  TENT3 = id(23),
  OTHER_UNIT = id(24),
  ADDON = id(30);
let db: PGlite;
const details = {
  name: "Pet",
  price: 499,
  price_type: "per_booking",
  fulfillment_type: "arrival",
  max_quantity: 1,
};
const owner = (actor = OWNER) =>
  db.exec(`reset role; set test.actor='${actor}';set role authenticated;`);
const admin = () => db.exec("reset role;set test.actor='';");
const save = (
  unitIds: string[] | null,
  options: { property?: string; addon?: string | null; data?: unknown } = {},
) =>
  db.query<{ id: string }>("select save_addon_with_units($1,$2,$3,$4) id", [
    options.property ?? PROPERTY,
    options.addon === undefined ? ADDON : options.addon,
    JSON.stringify(options.data ?? details),
    unitIds,
  ]);
const state = async () =>
  (
    await db.query<{ name: string; price: number; unit_scope: string }>(
      "select name,price,unit_scope from addons where id=$1",
      [ADDON],
    )
  ).rows[0];

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.actor',true),'')::uuid$$;
    create table properties(id uuid primary key,owner_id uuid);
    create function owns_property(p uuid) returns boolean language sql stable security definer set search_path='' as $$
      select exists(select 1 from public.properties where id=p and owner_id=auth.uid())$$;
    create table units(id uuid primary key,property_id uuid references properties(id));
    create table bookings(id uuid primary key,property_id uuid,unit_id uuid references units(id),status text default 'confirmed');
    grant usage on schema public,auth to authenticated,service_role;
    grant select,insert,update,delete on properties,units,bookings to authenticated,service_role;
    alter table units enable row level security;create policy owner_units on units for all to authenticated
      using(owns_property(property_id)) with check(owns_property(property_id));
    alter table bookings enable row level security;create policy owner_bookings on bookings for all to authenticated
      using(owns_property(property_id)) with check(owns_property(property_id));`);
  const addons = readFileSync(
    new URL("../../supabase/migrations/20260721000000_addons.sql", import.meta.url),
    "utf8",
  );
  // The original migration also adds these columns to the booking table.
  await db.exec(addons);
  await db.exec(`alter table addons add column internal_only boolean not null default false,
    add column available_from date,add column available_to date,
    add column max_quantity integer not null default 20 check(max_quantity between 1 and 20),
    add column fulfillment_type text not null default 'arrival' check(fulfillment_type in ('arrival','each_morning','departure'));
    grant select,insert,update,delete on addons,booking_addons to authenticated,service_role;`);
  await db.exec(
    readFileSync(
      new URL("../../supabase/migrations/20261006170847_addon_unit_scope.sql", import.meta.url),
      "utf8",
    ),
  );
}, 60000);
beforeEach(async () => {
  await admin();
  await db.exec(`truncate booking_addons,addon_units,addons,bookings,units,properties cascade;
    insert into properties values('${PROPERTY}','${OWNER}'),('${SECOND}','${OWNER}'),('${FOREIGN}','${OTHER}');
    insert into units values('${TENT1}','${PROPERTY}'),('${TENT3}','${PROPERTY}'),('${OTHER_UNIT}','${SECOND}');
    insert into addons(id,property_id,name,price) values('${ADDON}','${PROPERTY}','Pet',499);
    insert into bookings(id,property_id,unit_id) values('${id(40)}','${PROPERTY}','${TENT1}'),('${id(43)}','${PROPERTY}','${TENT3}');`);
});
afterAll(async () => {
  await db?.close();
});

describe("add-on unit scope in the database", () => {
  it("keeps legacy catalog items unrestricted", async () => {
    expect((await state()).unit_scope).toBe("all");
    await db.exec(
      `insert into booking_addons values('${id(40)}','${ADDON}',1,499),('${id(43)}','${ADDON}',1,499)`,
    );
    expect((await db.query("select * from booking_addons")).rows).toHaveLength(2);
  });

  it("saves catalog details and selected units atomically and can return to all units", async () => {
    await owner();
    await save([TENT3]);
    expect(await state()).toMatchObject({ unit_scope: "selected", price: 499 });
    expect((await db.query("select unit_id from addon_units")).rows).toEqual([{ unit_id: TENT3 }]);
    await save(null);
    expect((await state()).unit_scope).toBe("all");
    expect((await db.query("select * from addon_units")).rows).toEqual([]);
    const created = await save([TENT1, TENT3], { addon: null });
    expect(
      (await db.query("select unit_id from addon_units where addon_id=$1", [created.rows[0].id]))
        .rows,
    ).toHaveLength(2);
  });

  it("rejects cross-property assignments even for an owner of both properties, without partial saves", async () => {
    await owner();
    await save([TENT3]);
    await expect(save([OTHER_UNIT], { data: { ...details, price: 10 } })).rejects.toThrow(
      "invalid_addon_units",
    );
    expect(await state()).toMatchObject({ price: 499, unit_scope: "selected" });
    await expect(
      db.query("insert into addon_units values($1,$2,$3)", [PROPERTY, ADDON, OTHER_UNIT]),
    ).rejects.toThrow(/foreign key/);
    await expect(
      db.query("insert into addon_units values($1,$2,$3)", [SECOND, ADDON, OTHER_UNIT]),
    ).rejects.toThrow(/foreign key/);
    await expect(
      db.query("update units set property_id=$1 where id=$2", [SECOND, TENT3]),
    ).rejects.toThrow(/foreign key/);
    await expect(save([OTHER_UNIT], { property: SECOND })).rejects.toThrow(
      "addon_property_forbidden",
    );
  });

  it("denies another owner and anonymous calls", async () => {
    await owner(OTHER);
    await expect(save([TENT3])).rejects.toThrow("addon_property_forbidden");
    await expect(
      db.query("insert into addon_units values($1,$2,$3)", [PROPERTY, ADDON, TENT3]),
    ).rejects.toThrow(/row-level security/);
    expect((await db.query("select * from addon_units")).rows).toEqual([]);
    await db.exec("reset role;set role anon");
    await expect(save([TENT3])).rejects.toThrow(/permission denied/);
  });

  it("rejects empty, duplicate, missing and malformed unit selections", async () => {
    await owner();
    for (const ids of [[], [TENT3, TENT3], [id(999)]]) {
      await expect(save(ids)).rejects.toThrow("invalid_addon_units");
    }
    await expect(save([TENT3], { data: { ...details, property_id: SECOND } })).rejects.toThrow(
      "invalid_addon_data",
    );
    expect((await state()).unit_scope).toBe("all");
  });

  it("blocks service purchase attempts on a disallowed unit and allows the mapped unit", async () => {
    await owner();
    await save([TENT3]);
    await admin();
    await db.exec("set role service_role");
    await expect(
      db.exec(`insert into booking_addons values('${id(40)}','${ADDON}',1,499)`),
    ).rejects.toThrow("addon_unit_not_allowed");
    await db.exec(`insert into booking_addons values('${id(43)}','${ADDON}',1,499)`);
    expect((await db.query("select * from booking_addons")).rows).toHaveLength(1);
  });

  it("blocks moving a purchased restricted add-on into another unit while preserving ordinary edits", async () => {
    await owner();
    await save([TENT3]);
    await admin();
    await db.exec(`insert into booking_addons values('${id(43)}','${ADDON}',1,499)`);
    await owner();
    await expect(
      db.query("update bookings set unit_id=$1 where id=$2", [TENT1, id(43)]),
    ).rejects.toThrow("booking_addon_unit_not_allowed");
    await db.query("update bookings set status='cancelled' where id=$1", [id(43)]);
    await save([TENT1, TENT3]);
    await db.query("update bookings set unit_id=$1 where id=$2", [TENT1, id(43)]);
  });

  it("keeps an item restricted when its last mapped unit is removed", async () => {
    await owner();
    await save([TENT3]);
    await admin();
    await db.query("delete from bookings where unit_id=$1", [TENT3]);
    await db.query("delete from units where id=$1", [TENT3]);
    expect((await state()).unit_scope).toBe("selected");
    expect((await db.query("select * from addon_units")).rows).toEqual([]);
    await expect(
      db.exec(`insert into booking_addons values('${id(40)}','${ADDON}',1,499)`),
    ).rejects.toThrow("addon_unit_not_allowed");
  });
});

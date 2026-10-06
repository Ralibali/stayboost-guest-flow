import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const OWNER = id(1),
  OTHER = id(2),
  PROPERTY = id(10),
  SECOND = id(11),
  FOREIGN = id(12);
const TENT = id(20),
  TENT2 = id(21),
  OTHER_TENT = id(22),
  ADDON = id(30),
  BOOKING = id(40);
let db: PGlite;
type Catalog = {
  name: string;
  description: string | null;
  price: number;
  active: boolean;
  sort_order: number;
  unit_scope: string;
  content_translations: unknown;
  vat_rate: number | null;
  catalog_revision: number;
  pricing_role: string;
};
type Operation = { title: string; due_date: string; details: Record<string, unknown> };
const translations = {
  sv: { name: "  Frukost – åäö 🥐  ", description: " Rad ett\nRad två  " },
  en: { name: "Breakfast", description: "Fresh bread\nCoffee" },
  de: { name: "Frühstück", description: null },
  da: { name: "Morgenmad", description: "" },
  no: { name: "Frokost", description: "Æ Ø Å" },
};
const draft = {
  name: translations.sv.name,
  description: translations.sv.description,
  price: 499,
  price_type: "per_booking",
  fulfillment_type: "arrival",
  max_quantity: 1,
  content_translations: translations,
  vat_rate: 12,
};
const migrate = (name: string) =>
  db.exec(readFileSync(new URL(`../../supabase/migrations/${name}.sql`, import.meta.url), "utf8"));
const admin = () => db.exec("reset role;set test.actor='';set request.jwt.claim.role='';");
const owner = (actor = OWNER) =>
  db.exec(
    `reset role;set test.actor='${actor}';set request.jwt.claim.role='authenticated';set role authenticated;`,
  );
const state = async () =>
  (
    await db.query<Catalog>(
      "select name,description,price,price_type,fulfillment_type,max_quantity,active,sort_order,unit_scope,content_translations,vat_rate,catalog_revision,pricing_role from addons where id=$1",
      [ADDON],
    )
  ).rows[0];
const operations = async () =>
  (
    await db.query<Operation>(
      "select title,due_date::text,details from stay_operations where booking_id=$1 and kind='addon' order by due_date",
      [BOOKING],
    )
  ).rows;
const save = (
  revision: unknown,
  data: unknown = draft,
  units: string[] | null = null,
  addon: string | null = ADDON,
  property = PROPERTY,
) =>
  db.query<{ id: string }>("select save_addon_catalog($1,$2,$3,$4,$5) id", [
    property,
    addon,
    revision === null ? null : JSON.stringify(revision),
    JSON.stringify(data),
    units,
  ]);
const purchase = () =>
  db.query(
    "insert into booking_addons(booking_id,addon_id,quantity,unit_price) values($1,$2,1,499)",
    [BOOKING, ADDON],
  );
const quoteLine = () => ({
  id: ADDON,
  name: "Breakfast",
  description: "Bought description",
  quantity: 1,
  unitPrice: 499,
  lineTotal: 998,
  priceType: "per_night",
  fulfillmentType: "each_morning",
  contentTranslations: translations,
  vatRate: 12,
  taxInclusive: true,
});
const setQuote = (addons: unknown) =>
  db.query("update bookings set quote_snapshot=$1 where id=$2", [
    JSON.stringify({ addons, partyPricingEnabled: true }),
    BOOKING,
  ]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.actor',true),'')::uuid$$;
    create table properties(id uuid primary key,owner_id uuid);
    create function owns_property(p uuid) returns boolean language sql stable security definer set search_path='' as $$
      select exists(select 1 from public.properties where id=p and owner_id=auth.uid())$$;
    create table units(id uuid primary key,property_id uuid references properties(id),name text default 'Tent',description text,image_url text,party_pricing_enabled boolean not null default false,child_price_per_night integer not null default 329,child_free_through_age integer not null default 1,child_max_age integer not null default 9);
    create table bookings(id uuid primary key,property_id uuid,unit_id uuid references units(id),
      status text default 'confirmed',guest_name text default 'Synthetic guest',stay_status text default 'expected',
      payment_status text default 'none',checkin_date date default '2027-06-01',checkout_date date default '2027-06-03',quote_snapshot jsonb,adults integer,children_ages integer[] not null default '{}');
    grant usage on schema public,auth to authenticated,service_role;
    grant select,insert,update,delete on properties,units,bookings to authenticated,service_role;
    alter table units enable row level security;create policy owner_units on units for all to authenticated
      using(owns_property(property_id)) with check(owns_property(property_id));
    alter table bookings enable row level security;create policy owner_bookings on bookings for all to authenticated
      using(owns_property(property_id)) with check(owns_property(property_id));`);
  await migrate("20260721000000_addons");
  await db.exec(`alter table addons add column internal_only boolean not null default false,
    add column available_from date,add column available_to date,
    add column max_quantity integer not null default 20 check(max_quantity between 1 and 20);
    grant select,insert,update,delete on addons,booking_addons to authenticated,service_role;`);
  await migrate("20260907162510_stay_operations_and_guest_fulfillment");
  await migrate("20260929191426_addon_delivery_schedule");
  await migrate("20261005174957_unit_localized_content_gallery");
  await migrate("20261006170847_addon_unit_scope");
  // An actual pre-upgrade purchase proves that applying this migration does not backfill history.
  await db.exec(`insert into properties values('${PROPERTY}','${OWNER}');
    insert into units(id,property_id) values('${TENT}','${PROPERTY}');
    insert into bookings(id,property_id,unit_id) values('${BOOKING}','${PROPERTY}','${TENT}');
    insert into addons(id,property_id,name,price) values('${ADDON}','${PROPERTY}','Old purchase',499);
    insert into booking_addons values('${BOOKING}','${ADDON}',1,499);`);
  const before = await operations();
  await migrate("20261006172015_addon_content_vat_snapshot");
  await migrate("20261006173748_child_price_basis");
  const protection = readFileSync(
    new URL("../../supabase/migrations/20260929190353_party_pricing.sql", import.meta.url),
    "utf8",
  );
  await db.exec(
    protection.slice(
      protection.indexOf("create or replace function public.protect_booking_quote()"),
    ),
  );
  expect(await operations()).toEqual(before);
  expect((await operations())[0].details).not.toHaveProperty("vat_rate");
}, 60000);
beforeEach(async () => {
  await admin();
  await db.exec(`truncate booking_addons,stay_operations,addon_units,addons,bookings,units,properties cascade;
    insert into properties values('${PROPERTY}','${OWNER}'),('${SECOND}','${OWNER}'),('${FOREIGN}','${OTHER}');
    insert into units(id,property_id) values('${TENT}','${PROPERTY}'),('${TENT2}','${PROPERTY}'),('${OTHER_TENT}','${SECOND}');
    insert into addons(id,property_id,name,price,active,sort_order) values('${ADDON}','${PROPERTY}','Pet',499,false,7);
    insert into bookings(id,property_id,unit_id) values('${BOOKING}','${PROPERTY}','${TENT}');`);
});
afterAll(async () => {
  await db?.close();
});

describe("child price basis and purchase boundaries in the database", () => {
  it("retains old nightly amounts, age boundaries, disabled pricing and unclassified extras", async () => {
    const rows = (
      await db.query(
        "select party_pricing_enabled,child_price_per_night,child_price_per_booking,child_price_basis,child_free_through_age,child_max_age from units",
      )
    ).rows;
    expect(rows).toHaveLength(3);
    for (const row of rows)
      expect(row).toEqual({
        party_pricing_enabled: false,
        child_price_per_night: 329,
        child_price_per_booking: 0,
        child_price_basis: "per_night",
        child_free_through_age: 1,
        child_max_age: 9,
      });
    expect((await state()).pricing_role).toBe("extra");
  });
  it("allows owner-scoped separate amounts and rejects invalid model or price values", async () => {
    await owner();
    await db.query(
      "update units set child_price_basis='per_booking',child_price_per_booking=329 where id=$1",
      [TENT],
    );
    expect(
      (
        await db.query(
          "select child_price_per_booking,child_price_per_night,party_pricing_enabled from units where id=$1",
          [TENT],
        )
      ).rows[0],
    ).toEqual({
      child_price_per_booking: 329,
      child_price_per_night: 329,
      party_pricing_enabled: false,
    });
    for (const sql of [
      "update units set child_price_basis='unknown'",
      "update units set child_price_per_booking=-1",
      "update units set child_price_per_booking=1000001",
    ])
      await expect(db.exec(sql)).rejects.toThrow(/check constraint/);
    await owner(OTHER);
    expect(
      (
        await db.query("update units set child_price_per_booking=1 where id=$1 returning id", [
          TENT,
        ])
      ).rows,
    ).toEqual([]);
  });
  it("saves explicit manual-child classification through CAS and preserves it for older callers", async () => {
    await owner();
    await save({ revision: 1 }, { ...draft, pricing_role: "manual_child_price" }, [TENT]);
    expect(await state()).toMatchObject({
      pricing_role: "manual_child_price",
      content_translations: translations,
      vat_rate: 12,
      unit_scope: "selected",
    });
    const revision = (await state()).catalog_revision;
    await db.query("select save_addon_with_units($1,$2,$3,$4)", [
      PROPERTY,
      ADDON,
      JSON.stringify({ name: "Legacy edit", price: 499 }),
      [TENT],
    ]);
    expect((await state()).pricing_role).toBe("manual_child_price");
    await expect(save({ revision }, { ...draft, pricing_role: "extra" })).rejects.toThrow(
      "addon_catalog_conflict",
    );
    for (const role of [null, "other", true])
      await expect(
        save({ revision: (await state()).catalog_revision }, { ...draft, pricing_role: role }),
      ).rejects.toThrow("invalid_addon_pricing_role");
    const created = await save(
      null,
      { ...draft, pricing_role: "manual_child_price" },
      [TENT],
      null,
    );
    expect(
      (await db.query("select pricing_role from addons where id=$1", [created.rows[0].id])).rows[0],
    ).toEqual({ pricing_role: "manual_child_price" });
  });
  it("blocks marked manual child prices when the frozen quote used party pricing, even after catalog/unit changes", async () => {
    await setQuote([quoteLine()]);
    await db.exec("update addons set pricing_role='manual_child_price'");
    await db.exec("set role service_role");
    await expect(purchase()).rejects.toThrow("manual_child_price_already_included");
    expect((await db.query("select * from booking_addons")).rows).toEqual([]);
    expect(await operations()).toEqual([]);
  });
  it("uses current party pricing for service purchases without a quote and retains ordinary extras", async () => {
    await db.exec(
      "update units set party_pricing_enabled=true;update addons set pricing_role='manual_child_price'",
    );
    await db.exec("set role service_role");
    await expect(purchase()).rejects.toThrow("manual_child_price_already_included");
    await db.exec("update addons set pricing_role='extra'");
    await purchase();
    expect((await db.query("select * from booking_addons")).rows).toHaveLength(1);
  });
  it("retains a frozen flat-price purchase even if the unit later enables party pricing", async () => {
    await db.query("update bookings set quote_snapshot=$1 where id=$2", [
      JSON.stringify({ partyPricingEnabled: false, addons: [quoteLine()] }),
      BOOKING,
    ]);
    await db.exec(
      "update units set party_pricing_enabled=true;update addons set pricing_role='manual_child_price'",
    );
    await purchase();
    const before = await operations();
    await db.exec("update booking_addons set quantity=quantity");
    expect(await operations()).toEqual(before);
  });
  it("prevents an authenticated owner from forging the quote flag to bypass child-price protection", async () => {
    await setQuote([quoteLine()]);
    await owner();
    await expect(
      db.query(
        "update bookings set quote_snapshot=quote_snapshot||'{\"partyPricingEnabled\":false}'::jsonb where id=$1",
        [BOOKING],
      ),
    ).rejects.toThrow("booking_quote_server_only");
    await expect(purchase()).rejects.toThrow(/row-level security/);
  });
});

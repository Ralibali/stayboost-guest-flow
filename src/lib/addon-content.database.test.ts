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
const admin = () => db.exec("reset role;set test.actor='';");
const owner = (actor = OWNER) =>
  db.exec(`reset role;set test.actor='${actor}';set role authenticated;`);
const state = async () =>
  (
    await db.query<Catalog>(
      "select name,description,price,price_type,fulfillment_type,max_quantity,active,sort_order,unit_scope,content_translations,vat_rate,catalog_revision from addons where id=$1",
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
    JSON.stringify({ addons }),
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
    create table units(id uuid primary key,property_id uuid references properties(id),name text default 'Tent',description text,image_url text);
    create table bookings(id uuid primary key,property_id uuid,unit_id uuid references units(id),
      status text default 'confirmed',guest_name text default 'Synthetic guest',stay_status text default 'expected',
      payment_status text default 'none',checkin_date date default '2027-06-01',checkout_date date default '2027-06-03',quote_snapshot jsonb);
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

describe("add-on catalog content and atomic owner revisions", () => {
  it("keeps prices and legacy defaults, stores five exact languages and allows zero/unknown VAT", async () => {
    expect(await state()).toMatchObject({
      price: 499,
      vat_rate: null,
      content_translations: {},
      catalog_revision: 1,
    });
    await owner();
    await save({ revision: 1 }, draft, [TENT]);
    expect(await state()).toMatchObject({
      ...draft,
      active: false,
      sort_order: 7,
      unit_scope: "selected",
    });
    for (const vat of [0, null, 25]) {
      await save({ revision: (await state()).catalog_revision }, { ...draft, vat_rate: vat }, [
        TENT,
      ]);
      expect(await state()).toMatchObject({
        price: 499,
        vat_rate: vat,
        name: translations.sv.name,
      });
    }
    const created = await save(null, draft, [TENT, TENT2], null);
    expect(
      (await db.query("select unit_id from addon_units where addon_id=$1", [created.rows[0].id]))
        .rows,
    ).toHaveLength(2);
  });

  it("rejects malformed content, unsupported VAT and mismatched Swedish text without partial saves", async () => {
    await owner();
    const original = await state();
    const cases = [
      { ...draft, vat_rate: 6 },
      { ...draft, vat_rate: 12.5 },
      { ...draft, vat_rate: "12" },
      { ...draft, content_translations: { fr: { name: "Bonjour", description: null } } },
      { ...draft, content_translations: { en: { name: "  ", description: null } } },
      {
        ...draft,
        content_translations: { en: { name: "Hello", description: null, secret: "ignored?" } },
      },
      { ...draft, content_translations: null },
      { ...draft, description: 123 },
      { ...draft, name: "Not the Swedish text" },
    ];
    for (const data of cases) {
      await expect(save({ revision: 1 }, data, [TENT])).rejects.toThrow();
      expect(await state()).toEqual(original);
    }
    expect((await db.query("select * from addon_units")).rows).toEqual([]);
    await expect(db.exec("update addons set vat_rate=6")).rejects.toThrow(/check constraint/);
    await expect(db.exec("update addons set content_translations='[]'")).rejects.toThrow(
      /check constraint/,
    );
  });

  it("accepts names through the shared 2000-character boundary without trimming and rejects longer values", async () => {
    await owner();
    const name = " " + "å".repeat(1998) + " ";
    const data = {
      ...draft,
      name,
      content_translations: { sv: { name, description: draft.description } },
    };
    await save({ revision: 1 }, data);
    expect((await state()).name).toBe(name);
    const original = await state();
    await expect(
      save(
        { revision: original.catalog_revision },
        { ...data, name: name + " ", content_translations: {} },
      ),
    ).rejects.toThrow("invalid_addon_content");
    expect(await state()).toEqual(original);
  });

  it("requires an exact revision, owner and same-property unit mapping", async () => {
    await owner();
    for (const original of [
      null,
      {},
      { revision: 0 },
      { revision: "1" },
      { revision: 1.5 },
      { revision: 1, other: true },
    ])
      await expect(save(original)).rejects.toThrow("invalid_addon_original");
    await expect(save({ revision: 1 }, draft, [OTHER_TENT])).rejects.toThrow("invalid_addon_units");
    await expect(save({ revision: 1 }, draft, null, ADDON, SECOND)).rejects.toThrow(
      "addon_property_forbidden",
    );
    await expect(save({ revision: 1 }, draft, null, null)).rejects.toThrow(
      "invalid_addon_original",
    );
    await owner(OTHER);
    await expect(save({ revision: 1 })).rejects.toThrow("addon_property_forbidden");
    await admin();
    await db.exec("set role anon");
    await expect(save({ revision: 1 })).rejects.toThrow(/permission denied/);
  });

  it("detects legacy saves and direct edits, even attempted revision spoofing", async () => {
    await owner();
    await save({ revision: 1 }, draft);
    const original = await state();
    await db.query("select save_addon_with_units($1,$2,$3,null)", [
      PROPERTY,
      ADDON,
      JSON.stringify({ name: "Legacy edit", price: 700 }),
    ]);
    expect(await state()).toMatchObject({
      content_translations: translations,
      vat_rate: 12,
      price: 700,
    });
    await expect(save({ revision: original.catalog_revision })).rejects.toThrow(
      "addon_catalog_conflict",
    );
    const latest = await state();
    await db.query("update addons set active=true,catalog_revision=1 where id=$1", [ADDON]);
    expect((await state()).catalog_revision).toBe(latest.catalog_revision + 1);
    await expect(save({ revision: latest.catalog_revision })).rejects.toThrow(
      "addon_catalog_conflict",
    );
    expect(await state()).toMatchObject({ active: true, price: 700 });
  });

  it("detects direct relation insert/delete and service updates, rolling back stale relation replacements", async () => {
    await owner();
    await save({ revision: 1 }, draft, [TENT]);
    let revision = (await state()).catalog_revision;
    await db.query("insert into addon_units values($1,$2,$3)", [PROPERTY, ADDON, TENT2]);
    await expect(save({ revision }, draft, [TENT])).rejects.toThrow("addon_catalog_conflict");
    expect((await db.query("select * from addon_units")).rows).toHaveLength(2);
    revision = (await state()).catalog_revision;
    await db.query("delete from addon_units where unit_id=$1", [TENT2]);
    await expect(save({ revision }, draft, [TENT, TENT2])).rejects.toThrow(
      "addon_catalog_conflict",
    );
    revision = (await state()).catalog_revision;
    await admin();
    await db.exec("set role service_role");
    await db.query("update addon_units set unit_id=$1 where addon_id=$2", [TENT2, ADDON]);
    await owner();
    await expect(save({ revision }, draft, [TENT])).rejects.toThrow("addon_catalog_conflict");
    expect((await db.query("select unit_id from addon_units")).rows).toEqual([{ unit_id: TENT2 }]);
  });

  it("advances both revisions if service moves a restriction and still permits catalog deletion", async () => {
    await owner();
    await save({ revision: 1 }, draft, [TENT]);
    const created = await save(null, draft, null, null);
    const secondAddon = created.rows[0].id;
    const before = (
      await db.query<{ id: string; catalog_revision: number }>(
        "select id,catalog_revision from addons order by id",
      )
    ).rows;
    await admin();
    await db.exec("set role service_role");
    await db.query("update addon_units set addon_id=$1 where addon_id=$2", [secondAddon, ADDON]);
    const after = (
      await db.query<{ id: string; catalog_revision: number }>(
        "select id,catalog_revision from addons order by id",
      )
    ).rows;
    expect(after).toEqual(
      before.map((row) => ({ ...row, catalog_revision: row.catalog_revision + 1 })),
    );
    await db.query("delete from addons where id=$1", [secondAddon]);
    expect((await db.query("select * from addon_units")).rows).toEqual([]);
  });
});

describe("frozen add-on purchase metadata", () => {
  it("uses the original quote when catalog text, VAT and fulfillment change before purchase insertion", async () => {
    await setQuote([quoteLine()]);
    await db.query(
      "update addons set name='New catalog',description='New description',content_translations='{}',vat_rate=25,price_type='per_booking',fulfillment_type='arrival' where id=$1",
      [ADDON],
    );
    await purchase();
    const rows = await operations();
    expect(rows.map((r) => r.due_date)).toEqual(["2027-06-02", "2027-06-03"]);
    for (const row of rows)
      expect(row).toMatchObject({
        title: "Breakfast",
        details: {
          description: "Bought description",
          content_translations: translations,
          vat_rate: 12,
          tax_inclusive: true,
          price_type: "per_night",
          fulfillment_type: "each_morning",
          unit_price: 499,
          quantity: 1,
        },
      });
    await db.exec(
      "update addons set vat_rate=0,description='Changed again';update booking_addons set quantity=quantity;",
    );
    expect(await operations()).toEqual(rows);
    await expect(db.exec("update booking_addons set quantity=2")).rejects.toThrow(
      "Ett registrerat tillval kan inte skrivas över",
    );
    expect(await operations()).toEqual(rows);
  });

  it("retains old quoted name and leaves missing historical metadata unknown instead of copying the catalog", async () => {
    await setQuote([
      {
        id: ADDON,
        name: "Bought old name",
        quantity: 1,
        unitPrice: 499,
        lineTotal: 499,
        fulfillmentType: "arrival",
      },
    ]);
    await db.query("update addons set content_translations=$1,vat_rate=25 where id=$2", [
      JSON.stringify(translations),
      ADDON,
    ]);
    await purchase();
    expect((await operations())[0]).toMatchObject({
      title: "Bought old name",
      details: {
        description: null,
        content_translations: {},
        vat_rate: null,
        tax_inclusive: null,
        price_type: null,
      },
    });
  });

  it("freezes service-created purchases with unknown VAT or known zero VAT without altering the price", async () => {
    await purchase();
    const original = await operations();
    expect(original[0].details).toMatchObject({
      vat_rate: null,
      tax_inclusive: null,
      unit_price: 499,
    });
    await db.query("update addons set content_translations=$1,vat_rate=0 where id=$2", [
      JSON.stringify(translations),
      ADDON,
    ]);
    await db.exec("update booking_addons set quantity=quantity");
    expect(await operations()).toEqual(original);
    await db.exec("delete from booking_addons;delete from stay_operations;");
    await purchase();
    expect((await operations())[0].details).toMatchObject({
      vat_rate: 0,
      tax_inclusive: true,
      unit_price: 499,
      content_translations: translations,
    });
  });

  it("accepts a modern quote with explicitly unknown VAT", async () => {
    await setQuote([{ ...quoteLine(), vatRate: null, taxInclusive: null }]);
    await purchase();
    expect((await operations())[0].details).toMatchObject({
      vat_rate: null,
      tax_inclusive: null,
      content_translations: translations,
    });
  });

  it("rejects contradictory, incomplete or forged quote lines atomically", async () => {
    const line = quoteLine();
    const { vatRate: _removed, ...missingVat } = line;
    const invalid = [
      null,
      {},
      [],
      [line, line],
      [{ ...line, id: id(999) }],
      [{ ...line, quantity: 2 }],
      [{ ...line, unitPrice: 500 }],
      [{ ...line, quantity: null }],
      [{ ...line, unitPrice: null }],
      [{ ...line, name: null }],
      [{ ...line, vatRate: 12.5 }],
      [{ ...line, vatRate: "12" }],
      [{ ...line, taxInclusive: false }],
      [{ ...line, vatRate: null, taxInclusive: true }],
      [missingVat],
      [{ ...line, contentTranslations: null }],
      [{ ...line, priceType: null }],
      [{ ...line, fulfillmentType: "invalid" }],
      [{ ...line, priceType: "per_booking" }],
    ];
    for (const addons of invalid) {
      await setQuote(addons);
      await expect(purchase()).rejects.toThrow();
      expect((await db.query("select * from booking_addons")).rows).toEqual([]);
      expect(await operations()).toEqual([]);
    }
  });

  it("retains ownership and unit restrictions for purchases with valid snapshots", async () => {
    await owner();
    await save({ revision: 1 }, draft, [TENT2]);
    await admin();
    await setQuote([quoteLine()]);
    await db.exec("set role service_role");
    await expect(purchase()).rejects.toThrow("addon_unit_not_allowed");
    await admin();
    await db.query("update bookings set property_id=$1,unit_id=$2 where id=$3", [
      SECOND,
      OTHER_TENT,
      BOOKING,
    ]);
    await expect(purchase()).rejects.toThrow("addon_unit_not_allowed");
    expect(await operations()).toEqual([]);
  });
});

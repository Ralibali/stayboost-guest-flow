import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const db = new PGlite();
const owner = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const property = "11111111-1111-1111-1111-111111111111";
const unit = "22222222-2222-2222-2222-222222222222";
const other = "33333333-3333-3333-3333-333333333333";
const image = "44444444-4444-4444-4444-444444444444";
const gallery = [{ id: image, storage_path: `${property}/${unit}/${image}.jpg`, alt_text: "Bild" }];
const exact = "  Fullständig text æøäöü\n\n" + "Lång beskrivning. ".repeat(150) + "\n ";
const translations = Object.fromEntries(
  ["sv", "en", "de", "da", "no"].map((lang) => [
    lang,
    { name: ` ${lang} namn `, description: exact },
  ]),
);
const unitTable = readFileSync(
  new URL("../../supabase/migrations/20260719000000_fas1.sql", import.meta.url),
  "utf8",
).match(/create table public\.units \([\s\S]*?\n\);/)?.[0];
if (!unitTable) throw new Error("The real units table definition was not found");

beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table public.properties(id uuid primary key, owner_id uuid not null);
    ${unitTable}
    alter table units add column description text, add column image_url text, add column base_price integer default 700;
    alter table public.units enable row level security;
    create policy owner_units on public.units for all to authenticated
      using(exists(select 1 from properties p where p.id=property_id and p.owner_id=current_setting('test.owner')::uuid))
      with check(exists(select 1 from properties p where p.id=property_id and p.owner_id=current_setting('test.owner')::uuid));
    grant select on properties to authenticated;
    grant select,insert,update on units to authenticated;
    insert into properties values('${property}','${owner}');
    insert into units(id,property_id,name) values('${unit}','${property}','Existing tent');`);
  await db.exec(
    readFileSync(
      new URL(
        "../../supabase/migrations/20261005174957_unit_localized_content_gallery.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
}, 30000);
afterAll(() => db.close());

describe("catalogue migration constraints and ownership", () => {
  it("adds empty defaults without altering existing names", async () => {
    const result = await db.query("select name,content_translations,gallery from units");
    expect(result.rows[0]).toEqual({
      name: "Existing tent",
      content_translations: {},
      gallery: [],
    });
  });
  it("stores exact full text for five languages and ordered gallery JSON", async () => {
    await db.query(
      "update units set content_translations=$1::jsonb,gallery=$2::jsonb where id=$3",
      [JSON.stringify(translations), JSON.stringify(gallery), unit],
    );
    const result = await db.query("select content_translations,gallery from units");
    expect(result.rows[0]).toEqual({ content_translations: translations, gallery });
  });
  it("the existing units name column preserves full imported names without a length limit", async () => {
    const fullName =
      "Tält 1 - Sjöbrisretreatet - (Barn 0-2 och 3-12 lägger ni till i tillval. Från 13 år vuxenpris)";
    await db.query("update units set name=$1 where id=$2", [fullName, unit]);
    expect((await db.query("select name from units where id=$1", [unit])).rows[0]).toEqual({
      name: fullName,
    });
    expect(
      (
        await db.query(
          "select data_type,character_maximum_length from information_schema.columns where table_schema='public' and table_name='units' and column_name='name'",
        )
      ).rows[0],
    ).toEqual({ data_type: "text", character_maximum_length: null });
  });
  it.each([
    { fr: { name: "Name", description: null } },
    { sv: { name: "", description: null } },
    { sv: { name: "Name" } },
    { sv: { name: "Name", description: "Text", csrf: "secret" } },
  ])("rejects invalid translation entries without overwriting valid text", async (bad) => {
    await expect(
      db.query("update units set content_translations=$1::jsonb where id=$2", [
        JSON.stringify(bad),
        unit,
      ]),
    ).rejects.toThrow();
    const result = await db.query("select content_translations from units");
    expect(result.rows[0]).toEqual({ content_translations: translations });
  });
  it.each([
    [{ ...gallery[0], storage_path: `${other}/${unit}/${image}.jpg` }],
    [{ ...gallery[0], storage_path: `${property}/${other}/${image}.jpg` }],
    [{ ...gallery[0], storage_path: `${gallery[0].storage_path}?secret=1` }],
    [...gallery, ...gallery],
    [{ ...gallery[0], source_url: "secret" }],
  ])("rejects foreign, signed and malformed image paths", async (...rows) => {
    // Vitest spreads array table entries into the argument list.
    await expect(
      db.query("update units set gallery=$1::jsonb where id=$2", [JSON.stringify(rows), unit]),
    ).rejects.toThrow();
  });
  const snapshot = async () =>
    (
      await db.query<Record<string, unknown>>(
        "select name,description,image_url,content_translations,gallery from units where id=$1",
        [unit],
      )
    ).rows[0];
  const save = async (original: object, draft: object) =>
    (
      await db.query<{ saved: boolean }>(
        "select public.save_unit_content($1,$2,$3::jsonb,$4::jsonb) as saved",
        [unit, property, JSON.stringify(original), JSON.stringify(draft)],
      )
    ).rows[0].saved;
  it.each([
    ["name", "Changed by an old client"],
    ["description", "Changed legacy text"],
    ["image_url", "https://example.test/new.jpg"],
    ["content_translations", { de: { name: "Neu", description: null } }],
    ["gallery", []],
  ])("refuses a stale snapshot after a concurrent change to %s", async (field, value) => {
    const original = await snapshot();
    // These identifiers come only from the fixed test table above.
    await db.query(
      `update units set ${field}=$1${typeof value === "object" ? "::jsonb" : ""} where id=$2`,
      [typeof value === "object" ? JSON.stringify(value) : value, unit],
    );
    const newer = await snapshot();
    await db.exec(`set role authenticated; set test.owner='${owner}';`);
    try {
      expect(await save(original, { ...original, description: "Stale overwrite" })).toBe(false);
      expect(await snapshot()).toEqual(newer);
    } finally {
      await db.exec("reset role");
    }
  });
  it("saves exact long text for the owner while preserving unrelated price changes", async () => {
    const original = await snapshot();
    const draft = {
      ...original,
      name: "Tält " + "Fullständigt namn ".repeat(10),
      description: exact,
      content_translations: translations,
      gallery,
    };
    await db.exec("update units set base_price=1295");
    await db.exec(`set role authenticated; set test.owner='${owner}';`);
    try {
      expect(await save(original, draft)).toBe(true);
      expect(await snapshot()).toEqual(draft);
      expect((await db.query("select base_price from units")).rows[0]).toEqual({
        base_price: 1295,
      });
      await expect(save(draft, { ...draft, door_code: "unexpected" })).rejects.toThrow(
        "invalid_unit_content",
      );
    } finally {
      await db.exec("reset role");
    }
  });
  it("leaves unit content inaccessible to another owner and to anon", async () => {
    const original = await snapshot();
    await db.exec(`set role authenticated; set test.owner='${other}';`);
    expect(await save(original, { ...original, name: "Wrong owner" })).toBe(false);
    expect((await db.query("select id from units")).rows).toEqual([]);
    expect(
      (await db.query("update units set content_translations='{}' returning id")).rows,
    ).toEqual([]);
    await db.exec(`reset role; set role anon;`);
    await expect(save(original, original)).rejects.toThrow();
    await expect(db.query("select content_translations,gallery from units")).rejects.toThrow();
    await db.exec("reset role");
  });
});

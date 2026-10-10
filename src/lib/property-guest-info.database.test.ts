import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const db = new PGlite();
const owner = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const other = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const property = "11111111-1111-4111-8111-111111111111";
const foreignProperty = "22222222-2222-4222-8222-222222222222";
const original = {
  directions: "  Older directions\n",
  house_rules: null,
  guest_info_translations: {},
};
const translations = Object.fromEntries(
  ["sv", "en", "de", "da", "no"].map((lang) => [
    lang,
    { directions: `  ${lang} directions\næø😀 `, house_rules: `${lang} rules\n` },
  ]),
);
const translated = { ...translations.sv, guest_info_translations: translations };
const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20261009202743_property_guest_info_translations.sql",
    import.meta.url,
  ),
  "utf8",
);
const table = readFileSync(
  new URL("../../supabase/migrations/20260719000000_fas1.sql", import.meta.url),
  "utf8",
).match(/create table public\.properties \([\s\S]*?\n\);/)?.[0];
if (!table) throw new Error("Missing real properties table");
const snapshot = async (id = property) =>
  (
    await db.query<Record<string, unknown>>(
      "select directions,house_rules,guest_info_translations from properties where id=$1",
      [id],
    )
  ).rows[0];
const save = async (before: object, draft: object, id = property) =>
  (
    await db.query<{ saved: boolean }>(
      "select public.save_property_guest_info($1,$2::jsonb,$3::jsonb) as saved",
      [id, JSON.stringify(before), JSON.stringify(draft)],
    )
  ).rows[0].saved;
async function asOwner(id: string, fn: () => Promise<void>) {
  await db.exec(`set role authenticated; set request.jwt.claim.sub='${id}';`);
  try {
    await fn();
  } finally {
    await db.exec("reset role; reset request.jwt.claim.sub;");
  }
}
beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
    ${table}
    alter table properties enable row level security;
    create policy "Owners manage own properties" on public.properties for all
      using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
    grant select,insert,update on properties to authenticated, service_role;
    insert into auth.users values('${owner}'),('${other}');
    insert into properties(id,owner_id,name,directions,house_rules,wifi_password) values
      ('${property}','${owner}','Example','  Older directions' || chr(10),null,'private'),
      ('${foreignProperty}','${other}','Other',null,null,null);`);
  await db.exec(migration);
}, 30000);
afterAll(() => db.close());

describe("property guest information owner CAS and backward compatibility", () => {
  it("adds empty translations without backfilling or changing old text", async () => {
    expect(await snapshot()).toEqual(original);
  });
  it("keeps legacy-only updates working until translations are added", async () => {
    await asOwner(owner, async () => {
      expect(await save(original, { ...original, house_rules: "Legacy edit" })).toBe(true);
      expect(await save(await snapshot(), original)).toBe(true);
    });
  });
  it("atomically saves all five exact texts and only the three owned fields", async () => {
    await asOwner(owner, async () => {
      expect(await save(original, translated)).toBe(true);
    });
    expect(await snapshot()).toEqual(translated);
    expect(
      (await db.query("select name,wifi_password from properties where id=$1", [property])).rows[0],
    ).toEqual({ name: "Example", wifi_password: "private" });
  });
  it("rejects an older open Settings legacy-only update without partial changes", async () => {
    await asOwner(owner, async () => {
      await expect(
        db.query("update properties set directions='stale',name='also stale' where id=$1", [
          property,
        ]),
      ).rejects.toThrow("guest_info_use_language_editor");
    });
    expect(await snapshot()).toEqual(translated);
    expect((await db.query("select name from properties where id=$1", [property])).rows[0]).toEqual(
      { name: "Example" },
    );
  });
  it("rejects the actual old full-row Settings pattern with stale empty and nonempty maps", async () => {
    await asOwner(owner, async () => {
      for (const stale of [
        original,
        {
          ...translated,
          guest_info_translations: { sv: { directions: "Older Swedish", house_rules: null } },
        },
      ]) {
        await expect(
          db.query(
            "update properties set name='stale general field',directions=$1,house_rules=$2,guest_info_translations=$3::jsonb where id=$4",
            [
              stale.directions,
              stale.house_rules,
              JSON.stringify(stale.guest_info_translations),
              property,
            ],
          ),
        ).rejects.toThrow("guest_info_use_language_editor");
      }
    });
    expect(await snapshot()).toEqual(translated);
    expect((await db.query("select name from properties where id=$1", [property])).rows[0]).toEqual(
      { name: "Example" },
    );
  });
  it("restores RPC context so a later stale whole-row write in the same transaction stays blocked", async () => {
    await asOwner(owner, async () => {
      await db.exec("begin");
      try {
        expect(await save(translated, translated)).toBe(true);
        expect(
          (await db.query("select current_setting('stayboost.guest_info_write',true) as marker"))
            .rows[0],
        ).toEqual({ marker: "" });
        await expect(
          db.query(
            "update properties set guest_info_translations='{}',directions=null where id=$1",
            [property],
          ),
        ).rejects.toThrow("guest_info_use_language_editor");
      } finally {
        await db.exec("rollback");
      }
    });
    expect(await snapshot()).toEqual(translated);
  });
  it("accepts unrelated Settings changes and refuses a stale content snapshot", async () => {
    await asOwner(owner, async () => {
      await db.query("update properties set contact_phone='updated' where id=$1", [property]);
      expect(await save(original, original)).toBe(false);
      expect(await save(translated, translated)).toBe(true);
    });
    expect(await snapshot()).toEqual(translated);
  });
  it("supports explicit translation removal with unchanged legacy fallback and re-add", async () => {
    const removed = { ...translated, guest_info_translations: {} };
    await asOwner(owner, async () => {
      expect(await save(translated, removed)).toBe(true);
      expect(await snapshot()).toEqual(removed);
      expect(await save(removed, translated)).toBe(true);
    });
  });
  it("only one of two editors with the same snapshot can save, including a non-Swedish edit", async () => {
    const first = {
      ...translated,
      guest_info_translations: {
        ...translations,
        en: { directions: "New arrival", house_rules: null },
      },
    };
    const second = {
      ...translated,
      guest_info_translations: {
        ...translations,
        de: { directions: "Stale arrival", house_rules: null },
      },
    };
    await asOwner(owner, async () => {
      expect(await save(translated, first)).toBe(true);
      expect(await save(translated, second)).toBe(false);
      expect(await snapshot()).toEqual(first);
      expect(await save(first, translated)).toBe(true);
    });
  });
  it("lets trusted service imports mirror Swedish text without granting anonymous writes", async () => {
    const next = { ...translations, sv: { directions: "", house_rules: null } };
    await db.exec("set role service_role");
    try {
      await db.query("update properties set guest_info_translations=$1::jsonb where id=$2", [
        JSON.stringify(next),
        property,
      ]);
      expect(await snapshot()).toEqual({
        directions: "",
        house_rules: null,
        guest_info_translations: next,
      });
      await db.query("update properties set guest_info_translations=$1::jsonb where id=$2", [
        JSON.stringify(translations),
        property,
      ]);
    } finally {
      await db.exec("reset role");
    }
  });
  it.each([
    null,
    [],
    { en: null },
    { en: {} },
    { fr: { directions: null, house_rules: null } },
    { sv: { directions: 5, house_rules: null } },
    { sv: { directions: null, house_rules: null, wifi_password: "private" } },
    { sv: { directions: "x".repeat(100001), house_rules: null } },
  ])("rejects invalid stored translation JSON atomically", async (value) => {
    await expect(
      db.query("update properties set guest_info_translations=$1::jsonb where id=$2", [
        JSON.stringify(value),
        property,
      ]),
    ).rejects.toThrow();
    expect(await snapshot()).toEqual(translated);
  });
  it("rejects malformed RPC snapshots, inconsistent Swedish text and private-field injection", async () => {
    await asOwner(owner, async () => {
      for (const draft of [
        { ...translated, wifi_password: "bad" },
        { ...translated, directions: "inconsistent" },
        { guest_info_translations: {} },
        { ...translated, guest_info_translations: null },
      ]) {
        await expect(save(translated, draft)).rejects.toThrow("invalid_property_guest_info");
      }
    });
    expect(await snapshot()).toEqual(translated);
  });
  it("blocks cross-owner, cross-property, missing identity and anon access", async () => {
    await asOwner(other, async () => {
      expect(await save(translated, translated)).toBe(false);
      expect(await snapshot()).toBeUndefined();
    });
    await asOwner(owner, async () => {
      expect(
        await save(
          { directions: null, house_rules: null, guest_info_translations: {} },
          original,
          foreignProperty,
        ),
      ).toBe(false);
    });
    await asOwner("", async () => {
      expect(await save(translated, translated)).toBe(false);
    });
    await db.exec("set role anon");
    try {
      await expect(save(translated, translated)).rejects.toThrow("permission denied");
    } finally {
      await db.exec("reset role");
    }
  });
});

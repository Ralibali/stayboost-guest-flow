import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const db = new PGlite();
const owner = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const otherOwner = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const property = "11111111-1111-1111-1111-111111111111";
const otherProperty = "22222222-2222-2222-2222-222222222222";
const unit = "33333333-3333-3333-3333-333333333333";
const ownPath = `${property}/${unit}/44444444-4444-4444-4444-444444444444.jpg`;
const foreignPath = `${otherProperty}/${unit}/55555555-5555-5555-5555-555555555555.jpg`;
const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20261006172820_fix_image_storage_owner_scope.sql",
    import.meta.url,
  ),
  "utf8",
);
const source = (filename: string) =>
  readFileSync(new URL(`../../supabase/migrations/${filename}`, import.meta.url), "utf8");
const asRole = async <T>(
  role: "authenticated" | "anon",
  user: string | null,
  run: () => Promise<T>,
) => {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user ?? ""]);
  await db.exec(`set role ${role}`);
  try {
    return await run();
  } finally {
    await db.exec("reset role");
  }
};
const insert = (bucket: string, name: string) =>
  db.query("insert into storage.objects(bucket_id,name) values($1,$2) returning name", [
    bucket,
    name,
  ]);
let originalOwnerUploadRejected = false;
let originalReadPolicies: unknown[];

beforeAll(async () => {
  await db.exec(`
    create role authenticated; create role anon;
    create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select current_user::text $$;
    create function storage.foldername(name text) returns text[] language sql immutable as
      $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
    create table properties(id uuid primary key, owner_id uuid not null, name text not null);
    alter table properties enable row level security;
    create policy owner_properties on properties for all
      using(owner_id=auth.uid()) with check(owner_id=auth.uid());
    create table storage.buckets(id text primary key, name text not null, public boolean not null);
    create table storage.objects(
      id uuid primary key default gen_random_uuid(),
      bucket_id text not null references storage.buckets(id),
      name text not null,
      metadata jsonb not null default '{}',
      unique(bucket_id,name)
    );
    alter table storage.objects enable row level security;
    grant usage on schema public,auth,storage to authenticated,anon;
    grant select,update on properties to authenticated,anon;
    grant select,insert,update,delete on storage.objects to authenticated,anon;
    insert into properties values
      ('${property}','${owner}','Bergs slussar glamping'),
      ('${otherProperty}','${otherOwner}','Another property');
    insert into storage.buckets values('unrelated-bucket','unrelated-bucket',false);
  `);
  // Run the actual original storage migrations, including the public read policies.
  await db.exec(
    source("20260721000000_addons.sql")
      .split("-- ---------- Bildlagring")[1]
      .slice(
        source("20260721000000_addons.sql").split("-- ---------- Bildlagring")[1].indexOf("do $$"),
      ),
  );
  await db.exec(
    source("20260722100000_production_hardening.sql").slice(
      source("20260722100000_production_hardening.sql").indexOf(
        "do $$",
        source("20260722100000_production_hardening.sql").indexOf("-- Bildlagring"),
      ),
    ),
  );
  try {
    await asRole("authenticated", owner, () => insert("unit-images", ownPath));
  } catch (error) {
    originalOwnerUploadRejected = String(error).includes("row-level security");
  }
  originalReadPolicies = (
    await db.query(
      "select policyname,roles,qual from pg_policies where schemaname='storage' and cmd='SELECT' order by policyname",
    )
  ).rows;
  await db.exec(migration);
}, 30000);

beforeEach(async () => {
  await db.exec("delete from storage.objects");
  await db.query("update properties set name=$1 where id=$2", ["Bergs slussar glamping", property]);
});
afterAll(() => db.close());

describe("image Storage policies run as the authenticated owner, not the database administrator", () => {
  it("reproduces the original failure and only changes the six write predicates", async () => {
    expect(originalOwnerUploadRejected).toBe(true);
    expect(
      (
        await db.query(
          "select policyname,roles,qual from pg_policies where schemaname='storage' and cmd='SELECT' order by policyname",
        )
      ).rows,
    ).toEqual(originalReadPolicies);
    expect(
      (
        await db.query(
          "select policyname,roles,cmd from pg_policies where schemaname='storage' order by policyname",
        )
      ).rows,
    ).toHaveLength(8);
    // Reapplying is safe; existing object contents are not changed.
    await insert("unit-images", ownPath);
    await db.exec(migration);
    expect((await db.query("select name from storage.objects")).rows).toEqual([{ name: ownPath }]);
  });

  describe.each(["unit-images", "addon-images"])("%s", (bucket) => {
    it("allows owner upload and replacement while preserving public reads", async () => {
      await asRole("authenticated", owner, async () => {
        expect((await insert(bucket, ownPath)).rows).toEqual([{ name: ownPath }]);
        expect(
          (
            await db.query(
              "insert into storage.objects(bucket_id,name,metadata) values($1,$2,'{\"updated\":true}') on conflict(bucket_id,name) do update set metadata=excluded.metadata returning metadata",
              [bucket, ownPath],
            )
          ).rows,
        ).toEqual([{ metadata: { updated: true } }]);
      });
      expect(
        await asRole(
          "anon",
          null,
          async () =>
            (await db.query("select name from storage.objects where bucket_id=$1", [bucket])).rows,
        ),
      ).toEqual([{ name: ownPath }]);
    });

    it.each([
      foreignPath,
      "99999999-9999-9999-9999-999999999999/image.jpg",
      "image.jpg",
      `/${property}/image.jpg`,
    ])("rejects upload outside the owner's property folder: %s", async (path) => {
      await expect(asRole("authenticated", owner, () => insert(bucket, path))).rejects.toThrow(
        "row-level security",
      );
    });

    it("allows the other owner only in their own property, and denies anonymous writes", async () => {
      await expect(
        asRole("authenticated", otherOwner, () => insert(bucket, ownPath)),
      ).rejects.toThrow("row-level security");
      await asRole("authenticated", otherOwner, () => insert(bucket, foreignPath));
      await expect(asRole("anon", null, () => insert(bucket, ownPath))).rejects.toThrow(
        "row-level security",
      );
    });

    it("does not let a crafted property name authorize foreign paths", async () => {
      // The old unqualified name looked at this owner-editable value instead of the object.
      await asRole("authenticated", owner, () =>
        db.query("update properties set name=$1 where id=$2", [`${property}/anything`, property]),
      );
      await asRole("authenticated", owner, () => insert(bucket, ownPath));
      await expect(
        asRole("authenticated", owner, () => insert(bucket, foreignPath)),
      ).rejects.toThrow("row-level security");
    });

    it("allows own rename/delete, rejects a foreign destination, and never mutates another owner's object", async () => {
      await insert(bucket, ownPath);
      await insert(bucket, foreignPath);
      const renamed = `${property}/${unit}/renamed.jpg`;
      await asRole("authenticated", owner, async () => {
        await expect(
          db.query("update storage.objects set name=$1 where bucket_id=$2 and name=$3", [
            `${otherProperty}/stolen.jpg`,
            bucket,
            ownPath,
          ]),
        ).rejects.toThrow("row-level security");
        expect(
          (
            await db.query(
              "update storage.objects set name=$1 where bucket_id=$2 and name=$3 returning name",
              [renamed, bucket, ownPath],
            )
          ).rows,
        ).toEqual([{ name: renamed }]);
        expect(
          (
            await db.query(
              "update storage.objects set metadata='{\"stolen\":true}' where bucket_id=$1 and name=$2 returning name",
              [bucket, foreignPath],
            )
          ).rows,
        ).toEqual([]);
        expect(
          (
            await db.query(
              "delete from storage.objects where bucket_id=$1 and name=$2 returning name",
              [bucket, foreignPath],
            )
          ).rows,
        ).toEqual([]);
        await expect(
          db.query(
            "insert into storage.objects(bucket_id,name,metadata) values($1,$2,'{\"stolen\":true}') on conflict(bucket_id,name) do update set metadata=excluded.metadata",
            [bucket, foreignPath],
          ),
        ).rejects.toThrow("row-level security");
        expect(
          (
            await db.query(
              "delete from storage.objects where bucket_id=$1 and name=$2 returning name",
              [bucket, renamed],
            )
          ).rows,
        ).toEqual([{ name: renamed }]);
      });
      expect((await db.query("select name,metadata from storage.objects")).rows).toEqual([
        { name: foreignPath, metadata: {} },
      ]);
    });

    it("denies anonymous updates/deletes even for publicly readable images", async () => {
      await insert(bucket, ownPath);
      await asRole("anon", null, async () => {
        expect(
          (
            await db.query(
              "update storage.objects set metadata='{\"changed\":true}' returning name",
            )
          ).rows,
        ).toEqual([]);
        expect((await db.query("delete from storage.objects returning name")).rows).toEqual([]);
      });
      expect((await db.query("select name,metadata from storage.objects")).rows).toEqual([
        { name: ownPath, metadata: {} },
      ]);
    });

    it("cannot move an allowed image into an unrelated bucket", async () => {
      await insert(bucket, ownPath);
      await expect(
        asRole("authenticated", owner, () =>
          db.query("update storage.objects set bucket_id='unrelated-bucket' where bucket_id=$1", [
            bucket,
          ]),
        ),
      ).rejects.toThrow("row-level security");
      expect((await db.query("select bucket_id from storage.objects")).rows).toEqual([
        { bucket_id: bucket },
      ]);
    });
  });

  it("does not grant writes to other buckets even for the owner's folder", async () => {
    await expect(
      asRole("authenticated", owner, () => insert("unrelated-bucket", ownPath)),
    ).rejects.toThrow("row-level security");
  });
});

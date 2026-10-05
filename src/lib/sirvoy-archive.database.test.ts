import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { archiveSha256 } from "../../supabase/functions/_shared/sirvoy-archive";

const OWNER = "00000000-0000-0000-0000-000000000001";
const OTHER = "00000000-0000-0000-0000-000000000002";
const PROPERTY = "00000000-0000-0000-0000-000000000003";
const SOURCE = new Uint8Array([239, 187, 191, 65, 44, 66, 13, 10, 49, 44, 50, 13, 10]);
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    insert into auth.users values('${OWNER}'),('${OTHER}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create table public.properties(id uuid primary key,owner_id uuid not null references auth.users);
    insert into properties values('${PROPERTY}','${OWNER}');
    grant usage on schema public,auth to anon,authenticated,service_role;
    grant select on properties to authenticated,service_role;
  `);
  await db.exec(
    readFileSync(
      new URL(
        "../../supabase/migrations/20261005160835_sirvoy_source_archive.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec("set role service_role");
  await db.query(
    "insert into sirvoy_export_archives(property_id,created_by,filename,export_kind,file_bytes) values($1,$2,'original.csv','bookings_expanded',$3)",
    [PROPERTY, OWNER, SOURCE],
  );
  await db.exec("reset role");
}, 30000);
afterAll(async () => {
  await db?.close();
});
const asRole = async (role: string, actor = "") => {
  await db.exec(`reset role; set test.actor='${actor}'; set role ${role};`);
};

describe("immutable owner-only Sirvoy source archives", () => {
  it("derives the actual checksum and retains every byte in the database", async () => {
    await asRole("service_role");
    const { rows } = await db.query<{ file_bytes: Uint8Array; sha256: string; byte_count: number }>(
      "select file_bytes,sha256,byte_count from sirvoy_export_archives",
    );
    expect(rows[0].file_bytes).toEqual(SOURCE);
    expect(rows[0].sha256).toBe(await archiveSha256(SOURCE));
    expect(rows[0].byte_count).toBe(SOURCE.length);
  });
  it("allows only the property owner to read raw exports with an authenticated role", async () => {
    await asRole("authenticated", OWNER);
    expect((await db.query("select file_bytes from sirvoy_export_archives")).rows).toHaveLength(1);
    await asRole("authenticated", OTHER);
    expect((await db.query("select file_bytes from sirvoy_export_archives")).rows).toEqual([]);
    await asRole("authenticated");
    expect((await db.query("select file_bytes from sirvoy_export_archives")).rows).toEqual([]);
    await asRole("anon");
    await expect(db.query("select file_bytes from sirvoy_export_archives")).rejects.toThrow(
      "permission denied",
    );
  });
  it("rejects direct client inserts, overwrites and deletion, including by the owner", async () => {
    for (const role of ["anon", "authenticated"]) {
      await asRole(role, OWNER);
      await expect(
        db.query(
          "insert into sirvoy_export_archives(property_id,created_by,filename,export_kind,file_bytes) values($1,$2,'injected.csv','other',$3)",
          [PROPERTY, OWNER, SOURCE],
        ),
      ).rejects.toThrow("permission denied");
      await expect(
        db.query("update sirvoy_export_archives set filename='changed.csv'"),
      ).rejects.toThrow("permission denied");
      await expect(db.query("delete from sirvoy_export_archives")).rejects.toThrow(
        "permission denied",
      );
    }
  });
  it("also denies service-role overwrite/delete and prevents duplicate source copies", async () => {
    await asRole("service_role");
    await expect(
      db.query("update sirvoy_export_archives set filename='changed.csv'"),
    ).rejects.toThrow("permission denied");
    await expect(db.query("delete from sirvoy_export_archives")).rejects.toThrow(
      "permission denied",
    );
    await expect(
      db.query(
        "insert into sirvoy_export_archives(property_id,created_by,filename,export_kind,file_bytes) values($1,$2,'renamed.csv','other',$3)",
        [PROPERTY, OWNER, SOURCE],
      ),
    ).rejects.toThrow("duplicate key");
  });
  it("does not permit a caller-supplied checksum or invalid coverage", async () => {
    await asRole("service_role");
    await expect(
      db.query(
        "insert into sirvoy_export_archives(property_id,created_by,filename,export_kind,file_bytes,sha256) values($1,$2,'other.csv','other',$3,'fake')",
        [PROPERTY, OWNER, new Uint8Array([1])],
      ),
    ).rejects.toThrow("non-DEFAULT");
    await expect(
      db.query(
        "insert into sirvoy_export_archives(property_id,created_by,filename,export_kind,file_bytes,coverage_from,coverage_to) values($1,$2,'other.csv','other',$3,'2026-10-05','2026-01-01')",
        [PROPERTY, OWNER, new Uint8Array([1])],
      ),
    ).rejects.toThrow("sirvoy_archive_coverage_order");
  });
  it("preserves existing explicit property deletion without adding an archive deletion API", async () => {
    await db.exec("reset role");
    const otherProperty = "00000000-0000-0000-0000-000000000005";
    await db.query("insert into properties values($1,$2)", [otherProperty, OTHER]);
    await asRole("service_role");
    await db.query(
      "insert into sirvoy_export_archives(property_id,created_by,filename,export_kind,file_bytes) values($1,$2,'other.csv','other',$3)",
      [otherProperty, OTHER, SOURCE],
    );
    await db.exec("reset role");
    await db.query("delete from properties where id=$1", [otherProperty]);
    expect(
      (
        await db.query("select id from sirvoy_export_archives where property_id=$1", [
          otherProperty,
        ])
      ).rows,
    ).toEqual([]);
  });
});

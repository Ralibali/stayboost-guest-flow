import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  parseSirvoySource,
  SIRVOY_SOURCE_HEADERS,
  type SirvoySourceFormat,
  type SirvoySourceScope,
} from "../../supabase/functions/_shared/sirvoy-source-parser";

const OWNER = "00000000-0000-0000-0000-000000000001";
const OTHER = "00000000-0000-0000-0000-000000000002";
const PROPERTY = "00000000-0000-0000-0000-000000000003";
const OTHER_PROPERTY = "00000000-0000-0000-0000-000000000004";
let db: PGlite;
let counter = 0;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    insert into auth.users values('${OWNER}'),('${OTHER}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create table public.properties(id uuid primary key,owner_id uuid not null references auth.users);
    insert into properties values('${PROPERTY}','${OWNER}'),('${OTHER_PROPERTY}','${OTHER}');
    grant usage on schema public,auth to anon,authenticated,service_role;
    grant select on properties to authenticated,service_role;
    create table bookings(id uuid); create table payments(id uuid); create table message_logs(id uuid);`);
  for (const file of [
    "20261005160835_sirvoy_source_archive.sql",
    "20261005172512_sirvoy_searchable_source_records.sql",
  ]) {
    await db.exec(
      readFileSync(new URL(`../../supabase/migrations/${file}`, import.meta.url), "utf8"),
    );
  }
}, 60000);
afterAll(async () => {
  await db?.close();
});
const role = async (name: string, actor = "") => {
  await db.exec(`reset role; set test.actor='${actor}'; set role ${name};`);
};
function csv(format: SirvoySourceFormat, rows: Record<string, string>[]) {
  const headers = SIRVOY_SOURCE_HEADERS[format];
  const snapshot = String(++counter);
  rows = rows.map((row) => ({ "Internal note": `snapshot ${snapshot}`, ...row }));
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return new TextEncoder().encode(
    [headers, ...rows.map((row) => headers.map((header) => row[header] ?? ""))]
      .map((row) => row.map(quote).join(","))
      .join("\r\n") + "\r\n",
  );
}
async function archive(
  rows: Record<string, string>[],
  format: SirvoySourceFormat = "bookings_expanded",
  scope: SirvoySourceScope = "excluding_cancelled",
  property = PROPERTY,
  actor = OWNER,
) {
  await role("service_role");
  const bytes = csv(format, rows);
  const original = (
    await db.query<{ id: string; sha256: string }>(
      "insert into sirvoy_export_archives(property_id,created_by,filename,export_kind,file_bytes) values($1,$2,'source.csv',$3,$4) returning id,sha256",
      [property, actor, format, bytes],
    )
  ).rows[0];
  const parsed = parseSirvoySource(bytes, format, scope);
  const args = [
    actor,
    property,
    original.id,
    original.sha256,
    format,
    scope,
    parsed.parserVersion,
    JSON.stringify(parsed.headers),
    JSON.stringify(parsed.records),
    JSON.stringify(parsed.warnings),
  ];
  return { args, parsed, bytes, original };
}
const index = async (args: unknown[]) =>
  (
    await db.query<{
      result: { ok: boolean; duplicate: boolean; importId: string; rowCount: number };
    }>("select index_sirvoy_source($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as result", args)
  ).rows[0].result;
type ReadResult = {
  rows: (Record<string, unknown> & {
    id: string;
    payment_ref: string | null;
    needs_review: boolean;
  })[];
  total: number;
  hasMore: boolean;
  headers: string[];
  archive_sha256: string;
  roomRefs: string[];
};
const read = async (
  view: string,
  search = "",
  kind = "",
  scope = "",
  offset = 0,
  record: string | null = null,
) =>
  (
    await db.query<{ result: ReadResult }>(
      "select read_sirvoy_source($1,$2,$3,$4,$5,$6,$7,$8) as result",
      [OWNER, PROPERTY, view, search, kind, scope, offset, record],
    )
  ).rows[0].result;
const payment = (ref: string, amount = "-1200.50", status = "Genomförd") => ({
  Type: "PAYMENT",
  "Booking no.": "9001",
  Total: amount,
  Reference: ref,
  Status: status,
  Date: "2026-06-01 12:30",
});

describe("Sirvoy searchable source storage and payment evidence", () => {
  it("retains exact source cells and decimals, indexes once and rejects changed source declarations", async () => {
    const source = await archive([
      {
        ...payment("ch_exact", "-9007199254740993.25"),
        "Internal note": 'Two lines\n100% original, "quoted"',
        "Guest name": "Synthetic Gäst",
      },
    ]);
    const first = await index(source.args);
    expect(first).toMatchObject({ ok: true, duplicate: false, rowCount: 1 });
    expect(await index(source.args)).toMatchObject({
      duplicate: true,
      importId: first.importId,
      rowCount: 1,
    });
    await expect(
      index(source.args.map((value, i) => (i === 5 ? "cancelled" : value))),
    ).rejects.toThrow("source_already_indexed_differently");
    const stored = (
      await db.query<{ amount_decimal: string; fields: string[]; id: string }>(
        "select * from sirvoy_source_records where import_id=$1",
        [first.importId],
      )
    ).rows[0];
    expect(stored.amount_decimal).toBe("-9007199254740993.25");
    expect(stored.fields).toEqual(source.parsed.records[0].fields);
    const detail = await read("detail", "", "", "", 0, stored.id);
    expect(detail.headers).toEqual(source.parsed.headers);
    expect(detail.archive_sha256).toBe(source.original.sha256);
    expect(
      (
        await db.query<{ file_bytes: Uint8Array }>(
          "select file_bytes from sirvoy_export_archives where id=$1",
          [source.original.id],
        )
      ).rows[0].file_bytes,
    ).toEqual(source.bytes);
    expect((await read("records", "100% original")).total).toBe(1);
    expect((await read("records", "'; select * from auth.users; --")).total).toBe(0);
  });
  it("links repeated payment references across snapshots once and never treats other formats or invoices as payments", async () => {
    await index((await archive([payment("ch_repeat")])).args);
    await index((await archive([payment("ch_repeat")], "bookings_expanded", "cancelled")).args);
    await index(
      (
        await archive(
          [{ "Booking no.": "9001", Total: "2200.50", Paid: "1200.50", Confirmed: "Ja" }],
          "bookings_condensed",
          "cancelled",
        )
      ).args,
    );
    await index(
      (
        await archive(
          [{ "Booking ID": "9001", "Room ID": "1", "Nightly price": "1200.50" }],
          "sirvoy_compatible",
        )
      ).args,
    );
    await index(
      (await archive([{ Type: "INVOICE 111", "Booking no.": "9001", Total: "1200.50" }])).args,
    );
    const result = await read("payments", "ch_repeat");
    expect(result.total).toBe(1);
    expect(result.rows[0]).toMatchObject({
      amount_decimal: "-1200.50",
      source_copies: 2,
      source_variants: 1,
      needs_review: false,
      currency: null,
    });
    expect(result.rows[0].source_scopes).toEqual(["cancelled", "excluding_cancelled"]);
    expect(result.rows[0].sources).toHaveLength(2);
    expect((await read("records", "", "INVOICE 111")).total).toBe(1);
    expect((await read("records", "", "BOOKING", "cancelled")).total).toBe(1);
    expect((await read("payments", "INVOICE")).total).toBe(0);
  });
  it("exposes conflicting copies, blank-status refund rows and missing references without guessing financial status", async () => {
    for (const row of [
      payment("ch_conflict", "-10"),
      payment("ch_conflict", "-11"),
      payment("re_refund", "200.50", ""),
      payment("", "-7"),
      payment("", "-7"),
      payment("raw_conflict", "1,50"),
      payment("raw_conflict", "unparsed"),
    ]) {
      await index((await archive([row])).args);
    }
    expect((await read("payments", "ch_conflict")).rows[0]).toMatchObject({
      amount_decimal: null,
      amount_raw: null,
      source_variants: 2,
      needs_review: true,
    });
    expect((await read("payments", "re_refund")).rows[0]).toMatchObject({
      amount_decimal: "200.50",
      payment_status: null,
      needs_review: true,
    });
    expect((await read("payments", "raw_conflict")).rows[0]).toMatchObject({
      amount_decimal: null,
      amount_raw: null,
      source_variants: 2,
      needs_review: true,
    });
    const anonymous = (await read("payments")).rows.filter(
      (entry: { payment_ref: string | null }) => !entry.payment_ref,
    );
    expect(anonymous).toHaveLength(2);
    expect(anonymous.every((entry: { needs_review: boolean }) => entry.needs_review)).toBe(true);
  });
  it("enforces owner isolation in both tables and the ledger view, and restricts RPCs to service role", async () => {
    await index(
      (await archive([payment("other_owner")], "bookings_expanded", "all", OTHER_PROPERTY, OTHER))
        .args,
    );
    await role("authenticated", OWNER);
    for (const table of [
      "sirvoy_source_imports",
      "sirvoy_source_records",
      "sirvoy_source_payment_ledger",
    ]) {
      const results = await db.query<{ property_id: string }>(`select property_id from ${table}`);
      expect(results.rows.length).toBeGreaterThan(0);
      expect(results.rows.every((row) => row.property_id === PROPERTY)).toBe(true);
    }
    await expect(read("summary")).rejects.toThrow("permission denied");
    await role("authenticated", OTHER);
    expect(
      (
        await db.query<{ property_id: string }>(
          "select property_id from sirvoy_source_payment_ledger",
        )
      ).rows,
    ).toEqual([{ property_id: OTHER_PROPERTY }]);
    await role("authenticated");
    expect((await db.query("select * from sirvoy_source_records")).rows).toEqual([]);
    await role("anon");
    await expect(db.query("select * from sirvoy_source_records")).rejects.toThrow(
      "permission denied",
    );
    await role("service_role");
    await expect(db.query("select read_sirvoy_source($1,$2)", [OTHER, PROPERTY])).rejects.toThrow(
      "not_authorized",
    );
  });
  it("prevents source overwrites and deletes even through the service role", async () => {
    for (const name of ["authenticated", "service_role"]) {
      await role(name, OWNER);
      for (const table of ["sirvoy_source_imports", "sirvoy_source_records"]) {
        await expect(db.query(`update ${table} set property_id=$1`, [PROPERTY])).rejects.toThrow(
          "permission denied",
        );
        await expect(db.query(`delete from ${table}`)).rejects.toThrow("permission denied");
      }
    }
  });
  it("rejects foreign archives, incorrect hashes and malformed record batches atomically", async () => {
    const source = await archive([payment("invalid_batch")]);
    await expect(
      index(source.args.map((value, i) => (i === 3 ? "0".repeat(64) : value))),
    ).rejects.toThrow("archive_integrity_failed");
    await expect(index(source.args.map((value, i) => (i === 0 ? OTHER : value)))).rejects.toThrow(
      "not_authorized",
    );
    const foreign = [...source.args];
    foreign[0] = OTHER;
    foreign[1] = OTHER_PROPERTY;
    await expect(index(foreign)).rejects.toThrow("archive_not_found");
    const badRecord = [...source.args];
    badRecord[8] = JSON.stringify([{ ...source.parsed.records[0], rowNumber: 2 }]);
    await expect(index(badRecord)).rejects.toThrow("invalid_source_data");
    const badDate = [...source.args];
    badDate[8] = JSON.stringify([{ ...source.parsed.records[0], checkIn: "invalid" }]);
    await expect(index(badDate)).rejects.toThrow();
    expect(
      (
        await db.query("select * from sirvoy_source_imports where archive_id=$1", [
          source.original.id,
        ])
      ).rows,
    ).toEqual([]);
  });
  it("returns every paginated source row and preserves booking-level payments across rooms", async () => {
    const rows = Array.from({ length: 101 }, (_, i) => ({
      Type: "ACCOMM",
      "Booking no.": `page-${i.toString().padStart(3, "0")}`,
      "Room ID": String((i % 3) + 1),
      Total: "1000.25",
    }));
    await index((await archive(rows)).args);
    const pages = await Promise.all(
      [0, 50, 100].map((offset) => read("records", "page-", "ACCOMM", "", offset)),
    );
    expect(pages.map((page) => page.rows.length)).toEqual([50, 50, 1]);
    expect(pages.map((page) => page.hasMore)).toEqual([true, true, false]);
    expect(
      new Set(pages.flatMap((page) => page.rows.map((row: { id: string }) => row.id))).size,
    ).toBe(101);
    expect((await read("summary")).roomRefs).toEqual(["1", "2", "3"]);
    await index(
      (
        await archive([
          { Type: "ACCOMM", "Booking no.": "multi", "Room ID": "1" },
          { Type: "ACCOMM", "Booking no.": "multi", "Room ID": "2" },
          { ...payment("ch_multi"), "Booking no.": "multi" },
        ])
      ).args,
    );
    expect((await read("payments", "ch_multi")).rows[0].source_copies).toBe(1);
    await db.exec("reset role");
    for (const table of ["bookings", "payments", "message_logs"])
      expect((await db.query(`select * from ${table}`)).rows).toEqual([]);
  });
  it("retains property deletion lifecycle with source cascade", async () => {
    await db.exec("reset role");
    await db.query("delete from properties where id=$1", [OTHER_PROPERTY]);
    for (const table of [
      "sirvoy_export_archives",
      "sirvoy_source_imports",
      "sirvoy_source_records",
    ])
      expect(
        (await db.query(`select * from ${table} where property_id=$1`, [OTHER_PROPERTY])).rows,
      ).toEqual([]);
  });
});

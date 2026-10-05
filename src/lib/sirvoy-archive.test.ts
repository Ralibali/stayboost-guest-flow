import { describe, expect, it, vi } from "vitest";
import { createSirvoyArchiveHandler } from "../../supabase/functions/_shared/sirvoy-archive-handler";
import {
  archiveBytesToHex,
  archiveHexToBytes,
  archiveRowCount,
  archiveSha256,
  SIRVOY_ARCHIVE_COLUMNS,
} from "../../supabase/functions/_shared/sirvoy-archive";

const OWNER = "00000000-0000-0000-0000-000000000001";
const PROPERTY = "00000000-0000-0000-0000-000000000002";
const OTHER_PROPERTY = "00000000-0000-0000-0000-000000000003";
const ARCHIVE = "00000000-0000-0000-0000-000000000004";
const bytes = new TextEncoder().encode(
  '\uFEFFType,Booking no.,Note,\r\nACCOMM,TEST,"Two\r\nlines",\r\nPAYMENT,TEST,"Quoted ""value""",\r\n',
);

type QueryResult = {
  data: Record<string, unknown> | Record<string, unknown>[] | null;
  error: { code: string } | null;
};
type TestQuery = PromiseLike<QueryResult> & {
  select(fields: string): TestQuery;
  eq(key: string, value: unknown): TestQuery;
  order(): TestQuery;
  range(start: number, end: number): TestQuery;
  insert(row: Record<string, unknown>): TestQuery;
  single(): Promise<QueryResult>;
  maybeSingle(): Promise<QueryResult>;
};

function service(authorized = true, signedIn = true) {
  const stored: Record<string, unknown>[] = [];
  const reads: Array<{ table: string; fields?: string; filters: [string, unknown][] }> = [];
  const client = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: signedIn ? { id: OWNER } : null },
        error: null,
      })),
    },
    from(table: string) {
      const read: { table: string; fields?: string; filters: [string, unknown][] } = {
        table,
        filters: [],
      };
      reads.push(read);
      let inserted: Record<string, unknown> | null = null;
      let range: [number, number] | null = null;
      const result = async (): Promise<QueryResult> => {
        if (table === "properties")
          return {
            data:
              authorized && read.filters.some(([k, v]) => k === "id" && v === PROPERTY)
                ? { id: PROPERTY }
                : null,
            error: null,
          };
        if (inserted) {
          const sha256 = await archiveSha256(archiveHexToBytes(String(inserted.file_bytes)));
          if (
            stored.some((row) => row.sha256 === sha256 && row.property_id === inserted!.property_id)
          )
            return { data: null, error: { code: "23505" } };
          const row = {
            ...inserted,
            id: ARCHIVE,
            sha256,
            byte_count: archiveHexToBytes(String(inserted.file_bytes)).length,
          };
          stored.push(row);
          return { data: row, error: null };
        }
        const matched = stored.filter((row) =>
          read.filters.every(([key, value]) => row[key] === value),
        );
        return { data: range ? matched.slice(range[0], range[1] + 1) : matched, error: null };
      };
      const query: TestQuery = {
        select(fields: string) {
          read.fields = fields;
          return query;
        },
        eq(key: string, value: unknown) {
          read.filters.push([key, value]);
          return query;
        },
        order() {
          return query;
        },
        range(start, end) {
          range = [start, end];
          return query;
        },
        insert(row: Record<string, unknown>) {
          inserted = row;
          return query;
        },
        async single() {
          return result();
        },
        async maybeSingle() {
          const response = await result();
          return {
            ...response,
            data: Array.isArray(response.data) ? (response.data[0] ?? null) : response.data,
          };
        },
        then(resolve, reject) {
          return result().then(resolve, reject);
        },
      };
      return query;
    },
  };
  return { handler: createSirvoyArchiveHandler(client), stored, reads, client };
}
const request = (body: unknown, token = "owner") =>
  new Request("https://example.test/sirvoy-archive", {
    method: "POST",
    headers: token
      ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
      : { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const upload = (content = bytes, filename = "sirvoy.csv", propertyId = PROPERTY) => {
  const form = new FormData();
  form.set("propertyId", propertyId);
  form.set("action", "upload");
  form.set("exportKind", "bookings_expanded");
  form.set("coverageFilter", "Older export; not complete/current");
  form.set("file", new File([content as Uint8Array<ArrayBuffer>], filename, { type: "text/csv" }));
  return new Request("https://example.test/sirvoy-archive", {
    method: "POST",
    headers: { Authorization: "Bearer owner" },
    body: form,
  });
};

describe("original export bytes", () => {
  it("roundtrips a large binary export without string argument or regex stack limits", () => {
    const large = new Uint8Array(1024 * 1024).map((_, index) => index % 256);
    expect(archiveHexToBytes(archiveBytesToHex(large))).toEqual(large);
  });
  it("retains BOM, CRLF, quoted newlines and empty trailing CSV fields", () => {
    expect(archiveHexToBytes(archiveBytesToHex(bytes))).toEqual(bytes);
    expect(archiveRowCount(bytes, "sirvoy.csv").rowCount).toBe(2);
  });
  it("counts UTF-16 exports without changing their source encoding", () => {
    const utf16 = Uint8Array.from([
      255,
      254,
      ...Array.from("A;B\r\n1;2\r\n", (value) => [value.charCodeAt(0), 0]).flat(),
    ]);
    expect(archiveRowCount(utf16, "export.csv").rowCount).toBe(1);
    expect(archiveHexToBytes(archiveBytesToHex(utf16))).toEqual(utf16);
  });
  it("preserves malformed or unknown encodings without claiming a verified row count", () => {
    expect(
      archiveRowCount(new TextEncoder().encode('A,B\n"unfinished'), "export.csv").rowCount,
    ).toBeNull();
    expect(archiveRowCount(Uint8Array.from([255, 128, 2]), "export.csv").rowCount).toBeNull();
    expect(archiveRowCount(bytes, "settings.txt").rowCount).toBeNull();
  });
});

describe("Sirvoy archive authorization and roundtrip", () => {
  it("returns every archived file over multiple pages without losing the final page", async () => {
    const api = service();
    for (let index = 0; index < 101; index++)
      api.stored.push({ id: String(index), property_id: PROPERTY });
    const ids: string[] = [];
    for (const offset of [0, 50, 100]) {
      const response = await api.handler(request({ action: "list", propertyId: PROPERTY, offset }));
      const data = await response.json();
      expect(data.archives).toHaveLength(offset === 100 ? 1 : 50);
      expect(data.hasMore).toBe(offset < 100);
      ids.push(...data.archives.map((entry: { id: string }) => entry.id));
    }
    expect(new Set(ids).size).toBe(101);
  });
  it("denies missing and invalid sessions before reading any archive", async () => {
    const unauthenticated = service();
    expect(
      (await unauthenticated.handler(request({ action: "list", propertyId: PROPERTY }, ""))).status,
    ).toBe(401);
    expect(unauthenticated.reads).toEqual([]);
    const invalid = service(true, false);
    expect((await invalid.handler(request({ action: "list", propertyId: PROPERTY }))).status).toBe(
      401,
    );
    expect(invalid.reads).toEqual([]);
  });
  it("denies a different owner/property before listing, uploading or downloading", async () => {
    const api = service(false);
    for (const body of [
      request({ action: "list", propertyId: PROPERTY }),
      request({ action: "download", propertyId: PROPERTY, archiveId: ARCHIVE }),
      upload(),
    ])
      expect((await api.handler(body)).status).toBe(403);
    expect(api.reads.every((read) => read.table === "properties")).toBe(true);
    expect(api.stored).toEqual([]);
  });
  it("archives and downloads the exact original and deduplicates without overwriting", async () => {
    const api = service();
    const saved = await api.handler(upload());
    expect(saved.status).toBe(201);
    const metadata = await saved.json();
    expect(metadata.archive.sha256).toBe(await archiveSha256(bytes));
    expect(api.stored[0].coverage_filter).toBe("Older export; not complete/current");
    const duplicate = await api.handler(upload(bytes, "renamed.csv"));
    expect((await duplicate.json()).duplicate).toBe(true);
    expect(api.stored).toHaveLength(1);
    expect(api.stored[0].filename).toBe("sirvoy.csv");
    const downloaded = await api.handler(
      request({ action: "download", propertyId: PROPERTY, archiveId: ARCHIVE }),
    );
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(bytes);
    expect(downloaded.headers.get("Content-Type")).toBe("application/octet-stream");
  });
  it("filters lists and downloads by the authorized property and omits file bytes from list queries", async () => {
    const api = service();
    await api.handler(upload());
    await api.handler(request({ action: "list", propertyId: PROPERTY }));
    const listRead = api.reads.at(-1)!;
    expect(listRead.fields).toBe(SIRVOY_ARCHIVE_COLUMNS);
    expect(listRead.fields).not.toContain("file_bytes");
    expect(listRead.filters).toContainEqual(["property_id", PROPERTY]);
    api.stored[0].property_id = OTHER_PROPERTY;
    expect(
      (await api.handler(request({ action: "download", propertyId: PROPERTY, archiveId: ARCHIVE })))
        .status,
    ).toBe(404);
  });
  it("retains a malformed CSV as an original with row count unverified", async () => {
    const api = service();
    const original = new TextEncoder().encode('A,B\n"unfinished');
    expect((await api.handler(upload(original))).status).toBe(201);
    expect(api.stored[0].row_count).toBeNull();
    expect(archiveHexToBytes(String(api.stored[0].file_bytes))).toEqual(original);
  });
  it("refuses a corrupted archive download", async () => {
    const api = service();
    await api.handler(upload());
    api.stored[0].file_bytes = "\\x00";
    const response = await api.handler(
      request({ action: "download", propertyId: PROPERTY, archiveId: ARCHIVE }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "archive_integrity_failed" });
  });
});

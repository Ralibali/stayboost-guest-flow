import { describe, expect, it, vi } from "vitest";
import { createSirvoyRecordsHandler } from "../../supabase/functions/_shared/sirvoy-records-handler";
import { archiveBytesToHex, archiveSha256 } from "../../supabase/functions/_shared/sirvoy-archive";
import {
  parseSirvoySource,
  SIRVOY_SOURCE_HEADERS,
} from "../../supabase/functions/_shared/sirvoy-source-parser";

const OWNER = "00000000-0000-0000-0000-000000000001";
const PROPERTY = "00000000-0000-0000-0000-000000000002";
const OTHER_PROPERTY = "00000000-0000-0000-0000-000000000003";
const ARCHIVE = "00000000-0000-0000-0000-000000000004";
const OTHER_OWNER = "00000000-0000-0000-0000-000000000005";
const RECORD = "00000000-0000-0000-0000-000000000006";
const syntheticFields: Record<string, string> = {
  Type: "PAYMENT",
  "Booking no.": "9001",
  "Check-in": "2026-06-05",
  "Check-out": "2026-06-07",
  "First name": "Synthetic",
  "Last name": "Guest",
  Date: "2026-06-01 12:30",
  Units: "1",
  "Unit price": "-1200.50",
  Total: "-1200.50",
  Reference: "ch_synthetic",
  Status: "",
};
const bytes = new TextEncoder().encode(
  [
    SIRVOY_SOURCE_HEADERS.bookings_expanded.join(","),
    SIRVOY_SOURCE_HEADERS.bookings_expanded.map((h) => syntheticFields[h] ?? "").join(","),
  ].join("\r\n") + "\r\n",
);

type Result = { data: Record<string, unknown> | null; error: { message?: string } | null };
type Query = {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  maybeSingle(): Promise<Result>;
};

async function service() {
  const reads: { table: string; columns: string; filters: [string, unknown][] }[] = [];
  const state = {
    signedIn: true,
    queryError: null as string | null,
    rpcError: null as string | null,
    thrownError: null as string | null,
    rpcData: { ok: true, rowCount: 1 } as Record<string, unknown> | null,
    archives: [
      {
        id: ARCHIVE,
        property_id: PROPERTY,
        export_kind: "bookings_expanded",
        file_bytes: archiveBytesToHex(bytes),
        sha256: await archiveSha256(bytes),
      },
    ],
  };
  const properties = [
    { id: PROPERTY, owner_id: OWNER },
    { id: OTHER_PROPERTY, owner_id: OTHER_OWNER },
  ];
  const client = {
    auth: {
      getUser: vi.fn(async (token: string) => ({
        data: {
          user:
            state.signedIn && ["owner", "other"].includes(token)
              ? { id: token === "owner" ? OWNER : OTHER_OWNER }
              : null,
        },
        error: null,
      })),
    },
    from(table: string): Query {
      const read = { table, columns: "", filters: [] as [string, unknown][] };
      reads.push(read);
      const query: Query = {
        select(columns) {
          read.columns = columns;
          return query;
        },
        eq(column, value) {
          read.filters.push([column, value]);
          return query;
        },
        async maybeSingle() {
          if (state.thrownError) throw new Error(state.thrownError);
          if (state.queryError) return { data: null, error: { message: state.queryError } };
          const rows: Record<string, unknown>[] =
            table === "properties" ? properties : state.archives;
          return {
            data:
              rows.find((row) => read.filters.every(([column, value]) => row[column] === value)) ??
              null,
            error: null,
          };
        },
      };
      return query;
    },
    rpc: vi.fn(
      async (_name: string, _args: Record<string, unknown>): Promise<Result> => ({
        data: state.rpcData,
        error: state.rpcError ? { message: state.rpcError } : null,
      }),
    ),
  };
  const parse = vi.fn(parseSirvoySource);
  return { state, client, reads, parse, handler: createSirvoyRecordsHandler(client, parse) };
}

const request = (body: unknown, token = "owner", headers: Record<string, string> = {}) =>
  new Request("https://example.invalid/sirvoy-records", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
const indexBody = { action: "index", propertyId: PROPERTY, archiveId: ARCHIVE, scope: "cancelled" };

describe("Sirvoy source records owner boundary", () => {
  it("rejects absent and invalid sessions before property or source reads", async () => {
    for (const token of ["", "invalid"]) {
      const api = await service();
      const response = await api.handler(request(indexBody, token));
      expect(response.status).toBe(401);
      expect(api.reads).toEqual([]);
      expect(api.client.rpc).not.toHaveBeenCalled();
      expect(api.parse).not.toHaveBeenCalled();
    }
  });

  it("rejects other owners before archive and source record access", async () => {
    const api = await service();
    for (const action of ["index", "summary", "records", "payments", "detail"]) {
      const response = await api.handler(
        request({ ...indexBody, action, recordId: RECORD }, "other"),
      );
      expect(response.status).toBe(403);
    }
    expect(api.reads.every((read) => read.table === "properties")).toBe(true);
    expect(
      api.reads.every((read) =>
        read.filters.some(([k, v]) => k === "owner_id" && v === OTHER_OWNER),
      ),
    ).toBe(true);
    expect(api.client.rpc).not.toHaveBeenCalled();
    expect(api.parse).not.toHaveBeenCalled();
  });

  it("does not retrieve an archive belonging to another property owned by another user", async () => {
    const api = await service();
    api.state.archives[0].property_id = OTHER_PROPERTY;
    const response = await api.handler(request(indexBody));
    expect(response.status).toBe(404);
    expect(api.reads.at(-1)?.filters).toContainEqual(["property_id", PROPERTY]);
    expect(api.reads.at(-1)?.filters).toContainEqual(["id", ARCHIVE]);
    expect(api.parse).not.toHaveBeenCalled();
    expect(api.client.rpc).not.toHaveBeenCalled();
  });

  it("handles preflight without auth and prevents GET mutation", async () => {
    const api = await service();
    const preflight = await api.handler(
      new Request("https://example.invalid", { method: "OPTIONS" }),
    );
    expect(preflight.status).toBe(200);
    expect(preflight.headers.get("Cache-Control")).toBe("no-store");
    expect((await api.handler(new Request("https://example.invalid"))).status).toBe(405);
    expect(api.client.auth.getUser).not.toHaveBeenCalled();
    expect(api.reads).toEqual([]);
  });
});

describe("Sirvoy source server-side indexing", () => {
  it("parses verified original bytes and ignores caller replacement rows, format and actor", async () => {
    const api = await service();
    const response = await api.handler(
      request({
        ...indexBody,
        records: [{ amountDecimal: "999999", recordKind: "FAKE" }],
        actor: OTHER_OWNER,
        format: "guests",
        headers: ["fake"],
      }),
    );
    expect(response.status).toBe(200);
    expect(api.parse).toHaveBeenCalledExactlyOnceWith(bytes, "bookings_expanded", "cancelled");
    const [name, args] = api.client.rpc.mock.calls[0];
    expect(name).toBe("index_sirvoy_source");
    expect(args.p_actor).toBe(OWNER);
    expect(args.p_property).toBe(PROPERTY);
    expect(args.p_archive).toBe(ARCHIVE);
    expect(args.p_archive_sha256).toBe(await archiveSha256(bytes));
    expect(args.p_headers).toEqual(SIRVOY_SOURCE_HEADERS.bookings_expanded);
    expect(args.p_records).toEqual(
      parseSirvoySource(bytes, "bookings_expanded", "cancelled").records,
    );
    expect(args.p_scope).toBe("cancelled");
    expect(args.p_parser_version).toBe("sirvoy-csv-v1");
  });

  it("checks the archive checksum before invoking the parser or database mutation", async () => {
    const api = await service();
    api.state.archives[0].sha256 = "0".repeat(64);
    const response = await api.handler(request(indexBody));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "archive_integrity_failed" });
    expect(api.parse).not.toHaveBeenCalled();
    expect(api.client.rpc).not.toHaveBeenCalled();
  });

  it("rejects unsupported archive formats and malformed source schemas while preserving original storage", async () => {
    const api = await service();
    api.state.archives[0].export_kind = "settings";
    expect((await api.handler(request(indexBody))).status).toBe(400);
    expect(api.parse).not.toHaveBeenCalled();
    api.state.archives[0].export_kind = "bookings_expanded";
    api.parse.mockImplementation(() => {
      throw new Error("synthetic private source value");
    });
    const response = await api.handler(request(indexBody));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "source_format_requires_review" });
    expect(api.client.rpc).not.toHaveBeenCalled();
    expect(api.state.archives[0].file_bytes).toBe(archiveBytesToHex(bytes));
  });

  it("limits metadata by received bytes independently of declared content length", async () => {
    const api = await service();
    const response = await api.handler(
      request({ ...indexBody, padding: "å".repeat(9000) }, "owner", { "Content-Length": "1" }),
    );
    expect(response.status).toBe(413);
    expect(api.reads).toEqual([]);
    expect(api.parse).not.toHaveBeenCalled();
    expect(api.client.rpc).not.toHaveBeenCalled();
  });

  it("accepts exactly 16KiB metadata but rejects the following byte", async () => {
    const api = await service();
    const body = { ...indexBody, padding: "" };
    body.padding = "x".repeat(16384 - new TextEncoder().encode(JSON.stringify(body)).length);
    expect((await api.handler(request(body))).status).toBe(200);
    expect((await api.handler(request({ ...body, padding: body.padding + "x" }))).status).toBe(413);
    expect(api.client.rpc).toHaveBeenCalledTimes(1);
  });

  it("sanitizes database errors and returns a specific immutable-scope conflict", async () => {
    const api = await service();
    api.state.rpcError = "database failed around synthetic private source value";
    const failed = await api.handler(request(indexBody));
    expect(failed.status).toBe(409);
    expect(await failed.json()).toEqual({ error: "source_index_failed" });
    api.state.rpcError = "source_already_indexed_differently: synthetic private source value";
    const conflict = await api.handler(request(indexBody));
    expect(await conflict.json()).toEqual({ error: "source_already_indexed_differently" });
    api.state.thrownError = "synthetic private source value";
    const thrown = await api.handler(request(indexBody));
    expect(await thrown.json()).toEqual({ error: "source_unavailable" });
  });
});

describe("Sirvoy source read parameters", () => {
  it("bounds views and filters before any read RPC", async () => {
    const api = await service();
    for (const overrides of [
      { action: "delete" },
      { action: "index", scope: "confirmed" },
      { action: "index", archiveId: "invalid" },
      { propertyId: "invalid" },
      { search: "x".repeat(201) },
      { kind: "x".repeat(101) },
      { scope: "paid" },
      { offset: -1 },
      { offset: 0.5 },
      { offset: 1000001 },
      { action: "detail", recordId: "invalid" },
    ]) {
      const response = await api.handler(
        request({ ...indexBody, action: "records", ...overrides }),
      );
      expect(response.status).toBe(400);
    }
    expect(api.client.rpc).not.toHaveBeenCalled();
    expect(api.parse).not.toHaveBeenCalled();
  });

  it("passes only authorized property and normalized supported read parameters", async () => {
    const api = await service();
    const response = await api.handler(
      request({
        action: "detail",
        propertyId: PROPERTY,
        recordId: RECORD,
        search: "  synthetic  ",
        kind: "PAYMENT",
        scope: "cancelled",
        offset: 1000000,
        actor: OTHER_OWNER,
        records: [{ fake: true }],
      }),
    );
    expect(response.status).toBe(200);
    expect(api.client.rpc).toHaveBeenCalledExactlyOnceWith("read_sirvoy_source", {
      p_actor: OWNER,
      p_property: PROPERTY,
      p_view: "detail",
      p_search: "synthetic",
      p_kind: "PAYMENT",
      p_scope: "cancelled",
      p_offset: 1000000,
      p_record: RECORD,
    });
    expect(api.reads).toHaveLength(1);
    expect(api.reads[0].table).toBe("properties");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("does not expose private RPC errors for a missing record or failed summary", async () => {
    const api = await service();
    api.state.rpcError = "record_not_found private database context";
    const missing = await api.handler(
      request({ action: "detail", propertyId: PROPERTY, recordId: RECORD }),
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "record_not_found" });
    api.state.rpcError = "private database context";
    const failed = await api.handler(request({ action: "summary", propertyId: PROPERTY }));
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ error: "source_unavailable" });
  });
});

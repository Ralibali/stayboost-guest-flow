import { archiveHexToBytes, archiveSha256 } from "./sirvoy-archive.ts";
import {
  parseSirvoySource,
  type SirvoySourceFormat,
  type SirvoySourceScope,
} from "./sirvoy-source-parser.ts";

type Result = { data: Record<string, unknown> | null; error: { message?: string } | null };
type Query = {
  eq(column: string, value: unknown): Query;
  maybeSingle(): PromiseLike<Result>;
};
export type SirvoyRecordsAdmin = {
  auth: {
    getUser(token: string): PromiseLike<{ data: { user: { id: string } | null }; error: unknown }>;
  };
  from(table: string): { select(columns: string): Query };
  rpc(name: string, args: Record<string, unknown>): PromiseLike<Result>;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const formats: readonly string[] = ["bookings_condensed", "bookings_expanded", "sirvoy_compatible"];
const scopes: readonly string[] = ["excluding_cancelled", "cancelled", "all", "unknown"];
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,x-client-info,apikey,content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Cache-Control": "no-store",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

// All source content comes from the immutable archive. The caller cannot submit
// replacement rows, payment assertions or operational booking changes.
export function createSirvoyRecordsHandler(admin: SirvoyRecordsAdmin, parse = parseSirvoySource) {
  return async (request: Request) => {
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return json({ error: "not_authenticated" }, 401);
    try {
      const auth = await admin.auth.getUser(token);
      if (auth.error || !auth.data.user) return json({ error: "not_authenticated" }, 401);
      const reader = request.body?.getReader();
      if (!reader) return json({ error: "invalid_request" }, 400);
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 16384) {
          await reader.cancel();
          return json({ error: "request_too_large" }, 413);
        }
        chunks.push(chunk.value);
      }
      const bytes = new Uint8Array(size);
      let position = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, position);
        position += chunk.length;
      }
      let body: Record<string, unknown>;
      try {
        const parsed = JSON.parse(new TextDecoder().decode(bytes));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
        body = parsed;
      } catch {
        return json({ error: "invalid_request" }, 400);
      }
      if (typeof body.propertyId !== "string" || !UUID.test(body.propertyId))
        return json({ error: "invalid_request" }, 400);
      const property = await admin
        .from("properties")
        .select("id")
        .eq("id", body.propertyId)
        .eq("owner_id", auth.data.user.id)
        .maybeSingle();
      if (property.error) return json({ error: "source_unavailable" }, 503);
      if (!property.data) return json({ error: "not_authorized" }, 403);

      if (body.action === "index") {
        if (
          typeof body.archiveId !== "string" ||
          !UUID.test(body.archiveId) ||
          typeof body.scope !== "string" ||
          !scopes.includes(body.scope)
        )
          return json({ error: "invalid_request" }, 400);
        const archive = await admin
          .from("sirvoy_export_archives")
          .select("id,export_kind,file_bytes,sha256")
          .eq("id", body.archiveId)
          .eq("property_id", body.propertyId)
          .maybeSingle();
        if (archive.error) return json({ error: "source_unavailable" }, 503);
        if (!archive.data) return json({ error: "archive_not_found" }, 404);
        if (
          typeof archive.data.export_kind !== "string" ||
          !formats.includes(archive.data.export_kind)
        )
          return json({ error: "unsupported_source_format" }, 400);
        if (typeof archive.data.file_bytes !== "string" || typeof archive.data.sha256 !== "string")
          return json({ error: "archive_integrity_failed" }, 503);
        const original = archiveHexToBytes(archive.data.file_bytes);
        if ((await archiveSha256(original)) !== archive.data.sha256)
          return json({ error: "archive_integrity_failed" }, 503);
        let source;
        try {
          source = parse(
            original,
            archive.data.export_kind as SirvoySourceFormat,
            body.scope as SirvoySourceScope,
          );
        } catch {
          return json({ error: "source_format_requires_review" }, 400);
        }
        const indexed = await admin.rpc("index_sirvoy_source", {
          p_actor: auth.data.user.id,
          p_property: body.propertyId,
          p_archive: body.archiveId,
          p_archive_sha256: archive.data.sha256,
          p_format: source.format,
          p_scope: source.scope,
          p_parser_version: source.parserVersion,
          p_headers: source.headers,
          p_records: source.records,
          p_warnings: source.warnings,
        });
        if (indexed.error)
          return json(
            {
              error: indexed.error.message?.includes("source_already_indexed_differently")
                ? "source_already_indexed_differently"
                : "source_index_failed",
            },
            409,
          );
        if (!indexed.data?.ok) return json({ error: "source_index_failed" }, 503);
        return json({ ...indexed.data, warnings: source.warnings });
      }
      if (!["summary", "records", "payments", "detail"].includes(String(body.action)))
        return json({ error: "invalid_request" }, 400);
      const search = body.search ?? "",
        kind = body.kind ?? "",
        scope = body.scope ?? "",
        offset = body.offset ?? 0;
      if (
        typeof search !== "string" ||
        search.length > 200 ||
        typeof kind !== "string" ||
        kind.length > 100 ||
        typeof scope !== "string" ||
        (scope !== "" && !scopes.includes(scope)) ||
        !Number.isSafeInteger(offset) ||
        Number(offset) < 0 ||
        Number(offset) > 1000000 ||
        (body.action === "detail" &&
          (typeof body.recordId !== "string" || !UUID.test(body.recordId)))
      )
        return json({ error: "invalid_request" }, 400);
      const result = await admin.rpc("read_sirvoy_source", {
        p_actor: auth.data.user.id,
        p_property: body.propertyId,
        p_view: body.action,
        p_search: search.trim(),
        p_kind: kind,
        p_scope: scope,
        p_offset: offset,
        p_record: body.action === "detail" ? body.recordId : null,
      });
      if (result.error)
        return json(
          {
            error: result.error.message?.includes("record_not_found")
              ? "record_not_found"
              : "source_unavailable",
          },
          result.error.message?.includes("record_not_found") ? 404 : 503,
        );
      return json(result.data);
    } catch {
      // Source exports contain private guest data; never include raw errors.
      return json({ error: "source_unavailable" }, 503);
    }
  };
}

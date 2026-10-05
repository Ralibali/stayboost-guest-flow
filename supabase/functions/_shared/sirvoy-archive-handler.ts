import {
  archiveBytesToHex,
  archiveDate,
  archiveHexToBytes,
  archiveRowCount,
  archiveSha256,
  SIRVOY_ARCHIVE_COLUMNS,
  SIRVOY_ARCHIVE_KINDS,
  SIRVOY_ARCHIVE_MAX_BYTES,
} from "./sirvoy-archive.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,x-client-info,apikey,content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Expose-Headers": "X-Archive-SHA256",
  "Cache-Control": "no-store",
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

// Injected client keeps auth/ownership and byte-for-byte behavior directly testable.
export function createSirvoyArchiveHandler(admin: any) {
  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!bearer) return json({ error: "not_authenticated" }, 401);
    try {
      const { data: auth, error: authError } = await admin.auth.getUser(bearer);
      if (authError || !auth?.user) return json({ error: "not_authenticated" }, 401);
      // Bound the body before parsing a multipart upload, including dishonest Content-Length.
      const reader = request.body?.getReader();
      if (!reader) return json({ error: "invalid_request" }, 400);
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > SIRVOY_ARCHIVE_MAX_BYTES + 65536) {
          await reader.cancel();
          return json({ error: "file_too_large" }, 413);
        }
        chunks.push(next.value);
      }
      const bodyBytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bodyBytes.set(chunk, offset);
        offset += chunk.length;
      }
      const bodyRequest = new Request(request.url, {
        method: "POST",
        headers: request.headers,
        body: bodyBytes,
      });
      const multipart = request.headers.get("content-type")?.startsWith("multipart/form-data");
      const form = multipart ? await bodyRequest.formData() : null;
      const body = form ? Object.fromEntries(form.entries()) : await bodyRequest.json();
      const propertyId = body?.propertyId;
      if (typeof propertyId !== "string" || !UUID.test(propertyId))
        return json({ error: "invalid_request" }, 400);
      const { data: property, error: propertyError } = await admin
        .from("properties")
        .select("id")
        .eq("id", propertyId)
        .eq("owner_id", auth.user.id)
        .maybeSingle();
      if (propertyError) return json({ error: "archive_unavailable" }, 503);
      if (!property) return json({ error: "not_authorized" }, 403);

      if (body.action === "list") {
        const start = Number(body.offset ?? 0);
        if (!Number.isSafeInteger(start) || start < 0)
          return json({ error: "invalid_request" }, 400);
        const { data, error } = await admin
          .from("sirvoy_export_archives")
          .select(SIRVOY_ARCHIVE_COLUMNS)
          .eq("property_id", propertyId)
          .order("created_at", { ascending: false })
          .order("id")
          .range(start, start + 49);
        return error
          ? json({ error: "archive_unavailable" }, 503)
          : json({ archives: data ?? [], hasMore: data?.length === 50 });
      }
      if (body.action === "download") {
        if (typeof body.archiveId !== "string" || !UUID.test(body.archiveId))
          return json({ error: "invalid_request" }, 400);
        const { data, error } = await admin
          .from("sirvoy_export_archives")
          .select("file_bytes,sha256")
          .eq("id", body.archiveId)
          .eq("property_id", propertyId)
          .maybeSingle();
        if (error) return json({ error: "archive_unavailable" }, 503);
        if (!data) return json({ error: "not_found" }, 404);
        const bytes = archiveHexToBytes(data.file_bytes);
        if ((await archiveSha256(bytes)) !== data.sha256)
          return json({ error: "archive_integrity_failed" }, 503);
        return new Response(bytes as Uint8Array<ArrayBuffer>, {
          headers: {
            ...cors,
            "Content-Type": "application/octet-stream",
            "X-Archive-SHA256": data.sha256,
          },
        });
      }
      if (body.action !== "upload" || !form) return json({ error: "invalid_request" }, 400);
      const file = form.get("file");
      if (!(file instanceof File) || file.size < 1 || file.size > SIRVOY_ARCHIVE_MAX_BYTES)
        return json(
          {
            error:
              file instanceof File && file.size > SIRVOY_ARCHIVE_MAX_BYTES
                ? "file_too_large"
                : "invalid_file",
          },
          400,
        );
      if (!SIRVOY_ARCHIVE_KINDS.includes(body.exportKind))
        return json({ error: "invalid_metadata" }, 400);
      const filename = file.name;
      if (!filename || filename.length > 255 || /[\x00-\x1f/\\]/.test(filename))
        return json({ error: "invalid_file" }, 400);
      const coverageFrom = archiveDate(body.coverageFrom);
      const coverageTo = archiveDate(body.coverageTo);
      const coverageFilter = String(body.coverageFilter ?? "").trim();
      if ((coverageFrom && coverageTo && coverageTo < coverageFrom) || coverageFilter.length > 300)
        return json({ error: "invalid_metadata" }, 400);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const checksum = await archiveSha256(bytes);
      const counts = archiveRowCount(bytes, filename);
      const { data, error } = await admin
        .from("sirvoy_export_archives")
        .insert({
          property_id: propertyId,
          created_by: auth.user.id,
          filename,
          media_type: file.type.slice(0, 120) || "application/octet-stream",
          export_kind: body.exportKind,
          coverage_from: coverageFrom,
          coverage_to: coverageTo,
          coverage_filter: coverageFilter || null,
          row_count: counts.rowCount,
          row_count_note: counts.rowCountNote,
          file_bytes: archiveBytesToHex(bytes),
        })
        .select(SIRVOY_ARCHIVE_COLUMNS)
        .single();
      if (error?.code === "23505") {
        const existing = await admin
          .from("sirvoy_export_archives")
          .select(SIRVOY_ARCHIVE_COLUMNS)
          .eq("property_id", propertyId)
          .eq("sha256", checksum)
          .maybeSingle();
        if (existing.error || !existing.data) return json({ error: "archive_unavailable" }, 503);
        return json({ archive: existing.data, duplicate: true });
      }
      if (error || !data || data.sha256 !== checksum)
        return json({ error: "archive_unavailable" }, 503);
      return json({ archive: data, duplicate: false }, 201);
    } catch (error) {
      // Never include uploaded records, database details or guest information in errors/logs.
      return json(
        {
          error:
            error instanceof Error && error.message === "invalid_coverage"
              ? "invalid_metadata"
              : "archive_unavailable",
        },
        400,
      );
    }
  };
}

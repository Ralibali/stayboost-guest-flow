import { useCallback, useEffect, useRef, useState } from "react";
import { Archive, Download, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  archiveSha256,
  SIRVOY_ARCHIVE_MAX_BYTES,
  type SirvoyArchive as ArchiveEntry,
  type SirvoyArchiveKind,
} from "../../../supabase/functions/_shared/sirvoy-archive";

const labels: Record<SirvoyArchiveKind, string> = {
  bookings_condensed: "Bokningar – Condensed / Basic info",
  bookings_expanded: "Bokningar – Expanded / Booking content",
  sirvoy_compatible: "Sirvoy-compatible",
  guests: "Gästregister",
  payments: "Betalningar och återbetalningar",
  accounting: "Bokföring och fakturor",
  settings: "Inställningar",
  other: "Annan export",
};
const errors: Record<string, string> = {
  not_authenticated: "Logga in igen för att öppna arkivet.",
  not_authorized: "Du saknar behörighet till anläggningens arkiv.",
  file_too_large: "Filen får vara högst 10 MB.",
  invalid_file: "Välj en fil med ett giltigt filnamn och innehåll.",
  invalid_metadata: "Kontrollera exporttyp, datum och urval.",
  archive_integrity_failed: "Filens kontrollsumma stämmer inte. Nedladdningen avbröts.",
};
async function archiveRequest(body: Record<string, unknown> | FormData) {
  if (!supabase) throw new Error("Logga in för att öppna arkivet.");
  const result = await supabase.functions.invoke("sirvoy-archive", { body });
  if (result.error || result.data?.error) {
    const response = (result.error as { context?: Response } | null)?.context;
    const detail = response?.json ? await response.json().catch(() => null) : null;
    throw new Error(
      errors[detail?.error ?? result.data?.error] ??
        "Arkivet kunde inte nås. Försök igen om en stund.",
    );
  }
  return result.data;
}

export function SirvoyArchive({ propertyId }: { propertyId: string }) {
  const [entries, setEntries] = useState<ArchiveEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [kind, setKind] = useState<SirvoyArchiveKind>("bookings_expanded");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [filter, setFilter] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const loadGeneration = useRef({ value: 0 });
  const load = useCallback(
    async (offset = 0) => {
      const generation = ++loadGeneration.current.value;
      setLoading(true);
      try {
        const result = await archiveRequest({ action: "list", propertyId, offset });
        if (generation !== loadGeneration.current.value) return;
        if (!Array.isArray(result?.archives)) throw new Error("Arkivlistan kunde inte läsas.");
        setEntries((current) => (offset ? [...current, ...result.archives] : result.archives));
        setHasMore(result.hasMore === true);
      } catch (failure) {
        if (generation === loadGeneration.current.value) setError((failure as Error).message);
      } finally {
        if (generation === loadGeneration.current.value) setLoading(false);
      }
    },
    [propertyId],
  );
  useEffect(() => {
    const generation = loadGeneration.current;
    setEntries([]);
    void load();
    return () => {
      generation.value++;
    };
  }, [load]);

  const upload = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError("");
    setNotice("");
    const file = fileInput.current?.files?.[0];
    if (!file || file.size === 0) {
      setError("Välj en exportfil som innehåller data.");
      return;
    }
    if (file.size > SIRVOY_ARCHIVE_MAX_BYTES) {
      setError(errors.file_too_large);
      return;
    }
    if (from && to && to < from) {
      setError(errors.invalid_metadata);
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      body.set("action", "upload");
      body.set("propertyId", propertyId);
      body.set("exportKind", kind);
      body.set("coverageFrom", from);
      body.set("coverageTo", to);
      body.set("coverageFilter", filter);
      body.set("file", file);
      const result = await archiveRequest(body);
      if (!result?.archive?.sha256) throw new Error("Arkiveringen kunde inte verifieras.");
      const checksum = await archiveSha256(new Uint8Array(await file.arrayBuffer()));
      if (result.archive.sha256 !== checksum) throw new Error(errors.archive_integrity_failed);
      setNotice(
        result.duplicate
          ? "Samma originalfil finns redan i arkivet. Den befintliga filen har behållits."
          : "Originalfilen är arkiverad och kontrollsumman verifierad. Bokningar har inte importerats av arkiveringen.",
      );
      if (fileInput.current) fileInput.current.value = "";
      await load();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const download = async (entry: ArchiveEntry) => {
    if (downloading) return;
    setDownloading(entry.id);
    setError("");
    try {
      const file = await archiveRequest({ action: "download", propertyId, archiveId: entry.id });
      if (!(file instanceof Blob)) throw new Error("Originalfilen kunde inte hämtas.");
      if ((await archiveSha256(new Uint8Array(await file.arrayBuffer()))) !== entry.sha256)
        throw new Error(errors.archive_integrity_failed);
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      link.download = entry.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setDownloading(null);
    }
  };

  return (
    <section className="card-surface space-y-5 p-5 sm:p-6">
      <div>
        <h2 className="flex items-center gap-2 font-semibold">
          <Archive size={20} /> Originalarkiv från Sirvoy
        </h2>
        <p className="mt-2 text-sm text-ink/65">
          Bevara exporterna med alla ursprungliga uppgifter, även historik, avbokningar och
          betalningsrader. Arkiverade filer kan hämtas av anläggningens ägare. De visas separat från
          importerade bokningar.
        </p>
        <button
          type="button"
          disabled={loading}
          onClick={() => {
            setError("");
            void load();
          }}
          className="mt-3 text-sm font-semibold text-forest disabled:opacity-50"
        >
          {loading ? "Hämtar…" : "Uppdatera arkivlistan"}
        </button>
      </div>
      <form onSubmit={upload} className="space-y-4 rounded-xl border border-line p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">
            Originalfil, högst 10 MB
            <input ref={fileInput} type="file" required className="mt-1 block w-full text-sm" />
          </label>
          <label className="text-sm">
            Exporttyp
            <select
              className="mt-1 w-full rounded-lg border border-line bg-white p-2"
              value={kind}
              onChange={(event) => setKind(event.target.value as SirvoyArchiveKind)}
            >
              {Object.entries(labels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Exportens period från (valfritt)
            <input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="mt-1 w-full rounded-lg border border-line p-2"
            />
          </label>
          <label className="text-sm">
            Till och med (valfritt)
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(event) => setTo(event.target.value)}
              className="mt-1 w-full rounded-lg border border-line p-2"
            />
          </label>
        </div>
        <label className="block text-sm">
          Exportens urval (valfritt)
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            maxLength={300}
            placeholder="Till exempel alla bokningsstatusar, filtrerat på ankomst"
            className="mt-1 w-full rounded-lg border border-line p-2"
          />
        </label>
        <p className="text-xs text-ink/60">
          Period och urval är dina uppgifter om exporten. Arkivering verifierar filen, inte att
          exporten täcker allt i Sirvoy.
        </p>
        <button
          type="submit"
          disabled={busy}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-forest px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy && <Loader2 size={16} className="animate-spin" />}
          {busy ? "Arkiverar…" : "Arkivera originalfil"}
        </button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-forest">
          {notice}
        </p>
      )}
      {entries.length === 0 && !error && (
        <p className="text-sm text-ink/60">
          {loading ? "Hämtar arkivet…" : "Inga originalfiler har arkiverats här ännu."}
        </p>
      )}
      <ul className="divide-y divide-line">
        {entries.map((entry) => (
          <li key={entry.id} className="flex flex-wrap items-start justify-between gap-3 py-4">
            <div className="min-w-0 flex-1">
              <p className="break-all text-sm font-semibold">{entry.filename}</p>
              <p className="mt-1 text-xs text-ink/65">
                {labels[entry.export_kind]} ·{" "}
                {(entry.byte_count / 1024).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} KB
                ·{" "}
                {entry.row_count == null
                  ? "Radantal ej verifierat"
                  : `${entry.row_count} dataposter`}
              </p>
              {(entry.coverage_from || entry.coverage_to) && (
                <p className="mt-1 text-xs">
                  Angiven period: {entry.coverage_from ?? "—"} – {entry.coverage_to ?? "—"}
                </p>
              )}
              {entry.coverage_filter && (
                <p className="mt-1 text-xs">Angivet urval: {entry.coverage_filter}</p>
              )}
              <details className="mt-2 text-xs text-ink/60">
                <summary className="cursor-pointer">Filkontroll och arkiveringsdatum</summary>
                <p className="mt-1">
                  {new Date(entry.created_at).toLocaleString("sv-SE", {
                    timeZone: "Europe/Stockholm",
                  })}
                </p>
                <p className="mt-1 break-all font-mono">SHA-256: {entry.sha256}</p>
                <p className="mt-1">{entry.row_count_note}</p>
              </details>
            </div>
            <button
              type="button"
              onClick={() => void download(entry)}
              disabled={Boolean(downloading)}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line px-3 text-sm disabled:opacity-50"
            >
              {downloading === entry.id ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Download size={16} />
              )}{" "}
              Hämta original
            </button>
          </li>
        ))}
      </ul>
      {hasMore && (
        <button
          type="button"
          disabled={loading}
          onClick={() => void load(entries.length)}
          className="text-sm font-semibold text-forest"
        >
          {loading ? "Hämtar…" : "Visa fler filer"}
        </button>
      )}
    </section>
  );
}

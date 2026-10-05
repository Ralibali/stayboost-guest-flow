import { useCallback, useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { SirvoyArchive } from "../../../supabase/functions/_shared/sirvoy-archive";

type Scope = "excluding_cancelled" | "cancelled" | "all" | "unknown";
const scopeLabels: Record<Scope, string> = {
  excluding_cancelled: "Avbokade undantagna i exporten",
  cancelled: "Endast avbokade i exporten",
  all: "Alla statusar i exporten",
  unknown: "Exportens statusurval är okänt",
};
const formatLabels: Record<string, string> = {
  bookings_condensed: "Basic info",
  bookings_expanded: "Booking content",
  sirvoy_compatible: "Sirvoy-compatible",
};
type Import = {
  id: string;
  archive_id: string;
  filename: string;
  format: string;
  scope: Scope;
  row_count: number;
  warnings: string[];
};
type Summary = {
  sourceRows: number;
  bookingCount: number;
  roomRefs: string[];
  paymentCount: number;
  paymentsNeedingReview: number;
  imports: Import[];
};
type SourceRow = {
  id: string;
  booking_ref: string;
  record_kind: string;
  room_ref: string | null;
  guest_name: string | null;
  checkin_date: string | null;
  checkout_date: string | null;
  amount_raw: string | null;
  amount_decimal: string | null;
  cancellation_scope: Scope;
  source_format: string;
  filename: string;
  source_row: number;
  fields?: string[];
};
type PaymentRow = {
  transaction_key: string;
  booking_ref: string;
  payment_ref: string | null;
  amount_decimal: string | null;
  amount_raw: string | null;
  payment_status: string | null;
  occurred_raw: string | null;
  needs_review: boolean;
  source_copies: number;
  source_variants: number;
  source_scopes: Scope[];
  sources: { id: string; archive_id: string; source_row: number }[];
};
type Page = { rows: SourceRow[] | PaymentRow[]; total: number; hasMore: boolean };
type Detail = {
  record: SourceRow & { fields: string[] };
  headers: string[];
  scope: Scope;
  filename: string;
  format: string;
  archive_sha256: string;
};
const inputClass = "mt-1 w-full rounded-lg border border-line bg-white p-2";
const errors: Record<string, string> = {
  not_authenticated: "Logga in igen för att läsa Sirvoy-uppgifterna.",
  not_authorized: "Bara anläggningens ägare kan läsa uppgifterna.",
  source_format_requires_review:
    "Exportens format behöver granskas. Originalfilen är bevarad i arkivet.",
  unsupported_source_format:
    "Den här exporttypen kan bevaras i arkivet men stöds ännu inte för sökning.",
  source_already_indexed_differently:
    "Filen är redan registrerad med ett annat urval. Uppgifterna har inte ändrats.",
  record_not_found: "Källraden kunde inte hittas.",
  archive_integrity_failed: "Originalfilens kontrollsumma stämmer inte. Inläsningen avbröts.",
};
async function request<T>(body: Record<string, unknown>, endpoint = "sirvoy-records"): Promise<T> {
  if (!supabase) throw new Error("Logga in för att läsa Sirvoy-uppgifterna.");
  const result = await supabase.functions.invoke(endpoint, { body });
  if (result.error || result.data?.error) {
    const response = (result.error as { context?: Response } | null)?.context;
    const detail = response?.json ? await response.json().catch(() => null) : null;
    throw new Error(
      errors[detail?.error ?? result.data?.error] ??
        "Sirvoy-uppgifterna kunde inte hämtas. Försök igen om en stund.",
    );
  }
  return result.data as T;
}

export function SirvoySourceRecords({ propertyId }: { propertyId: string }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [storedPage, setPage] = useState<Page & { queryKey: string }>({
    queryKey: "",
    rows: [],
    total: 0,
    hasMore: false,
  });
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [query, setQuery] = useState({ search: "", kind: "", scope: "", offset: 0 });
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [archives, setArchives] = useState<SirvoyArchive[]>([]);
  const [archivesMore, setArchivesMore] = useState(false);
  const [archivesLoading, setArchivesLoading] = useState(false);
  const [selectedArchive, setSelectedArchive] = useState("");
  const [indexScope, setIndexScope] = useState<Scope>("unknown");
  const [indexing, setIndexing] = useState(false);
  const generation = useRef({ property: 0, rows: 0, detail: 0, archives: 0, summary: 0 });
  const payments = query.kind === "ledger";
  const queryKey = JSON.stringify([propertyId, query]);
  const page: Page =
    storedPage.queryKey === queryKey ? storedPage : { rows: [], total: 0, hasMore: false };
  const refreshSummary = useCallback(async () => {
    const current = ++generation.current.summary;
    try {
      const result = await request<Summary>({ action: "summary", propertyId });
      if (current === generation.current.summary) setSummary(result);
    } catch (failure) {
      if (current === generation.current.summary) setError((failure as Error).message);
    }
  }, [propertyId]);
  const refreshRows = useCallback(async () => {
    const current = ++generation.current.rows;
    setLoading(true);
    const requestedKey = JSON.stringify([propertyId, query]);
    setPage({ queryKey: requestedKey, rows: [], total: 0, hasMore: false });
    try {
      const result = await request<Page>({
        action: query.kind === "ledger" ? "payments" : "records",
        propertyId,
        ...query,
        kind: query.kind === "ledger" ? "" : query.kind,
      });
      if (current === generation.current.rows) setPage({ ...result, queryKey: requestedKey });
    } catch (failure) {
      if (current === generation.current.rows) setError((failure as Error).message);
    } finally {
      if (current === generation.current.rows) setLoading(false);
    }
  }, [propertyId, query]);
  useEffect(() => {
    const state = generation.current;
    setSummary(null);
    setArchives([]);
    setArchivesMore(false);
    setSelectedArchive("");
    setIndexScope("unknown");
    setDetail(null);
    setError("");
    setNotice("");
    setSearch("");
    setQuery({ search: "", kind: "", scope: "", offset: 0 });
    setIndexing(false);
    setArchivesLoading(false);
    setDetailLoading(false);
    void refreshSummary();
    return () => {
      state.property++;
      state.summary++;
      state.rows++;
      state.detail++;
      state.archives++;
    };
  }, [refreshSummary]);
  useEffect(() => {
    void refreshRows();
  }, [refreshRows, refreshRevision]);
  const openDetail = async (id: string) => {
    const current = ++generation.current.detail;
    setDetail(null);
    setDetailLoading(true);
    setError("");
    try {
      const result = await request<Detail>({ action: "detail", propertyId, recordId: id });
      if (current === generation.current.detail) setDetail(result);
    } catch (failure) {
      if (current === generation.current.detail) setError((failure as Error).message);
    } finally {
      if (current === generation.current.detail) setDetailLoading(false);
    }
  };
  const loadArchives = async (offset = 0) => {
    const current = ++generation.current.archives;
    setArchivesLoading(true);
    setError("");
    try {
      const result = await request<{ archives: SirvoyArchive[]; hasMore: boolean }>(
        { action: "list", propertyId, offset },
        "sirvoy-archive",
      );
      if (current !== generation.current.archives) return;
      setArchives((previous) => (offset ? [...previous, ...result.archives] : result.archives));
      setArchivesMore(result.hasMore);
    } catch (failure) {
      if (current === generation.current.archives) setError((failure as Error).message);
    } finally {
      if (current === generation.current.archives) setArchivesLoading(false);
    }
  };
  const index = async (event: React.FormEvent) => {
    event.preventDefault();
    if (indexing || !selectedArchive) return;
    const current = generation.current.property;
    setIndexing(true);
    setError("");
    setNotice("");
    try {
      const result = await request<{ rowCount: number; duplicate: boolean; warnings: string[] }>({
        action: "index",
        propertyId,
        archiveId: selectedArchive,
        scope: indexScope,
      });
      if (current !== generation.current.property) return;
      setNotice(
        `${result.rowCount} källrader ${result.duplicate ? "är redan sökbara" : "är nu sökbara"}.${result.warnings.length ? " Vissa uppgifter behöver granskas; originalvärdena är bevarade." : ""}`,
      );
      setRefreshRevision((revision) => revision + 1);
      await refreshSummary();
    } catch (failure) {
      if (current === generation.current.property) setError((failure as Error).message);
    } finally {
      if (current === generation.current.property) setIndexing(false);
    }
  };
  return (
    <section className="card-surface space-y-5 p-5 sm:p-6">
      <div>
        <h2 className="flex items-center gap-2 font-semibold">
          <Search size={20} /> Sökbara uppgifter från Sirvoy
        </h2>
        <p className="mt-2 text-sm text-ink/65">
          Sök i bokningar, gäster, tält, tillval, fakturarader och betalningar från de inlästa
          exporterna. Varje uppgift kan spåras till originalfilen. Uppgifterna här skapar inga
          aktiva bokningar eller gästmeddelanden i StayBoost.
        </p>
      </div>
      {summary && (
        <div className="space-y-2 rounded-xl bg-mist p-4 text-sm">
          <p>
            <strong>{summary.bookingCount}</strong> bokningsnummer ·{" "}
            <strong>{summary.sourceRows}</strong> källrader · Rums-ID:{" "}
            {summary.roomRefs.join(", ") || "saknas"}
          </p>
          <p>
            {summary.paymentCount} betalningsreferenser eller betalningsrader utan referens.{" "}
            {summary.paymentsNeedingReview} behöver granskas.
          </p>
          <p className="text-ink/65">
            Antalen gäller endast inlästa filer. Samma bokning kan ha flera källrader och finnas i
            flera exportformat. Historiska datum och exportens statusurval visas utan att anta
            aktuell bokningsstatus.
          </p>
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setError("");
          setQuery((previous) => ({ ...previous, search, offset: 0 }));
        }}
        className="grid items-end gap-3 sm:grid-cols-2"
      >
        <label className="text-sm">
          {payments ? "Bokningsnummer eller betalningsreferens" : "Sök i alla originaluppgifter"}
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            maxLength={200}
            className={inputClass}
          />
        </label>
        <label className="text-sm">
          Visa
          <select
            value={query.kind}
            onChange={(event) => {
              setSearch("");
              setQuery((previous) => ({
                ...previous,
                kind: event.target.value,
                search: "",
                offset: 0,
              }));
            }}
            className={inputClass}
          >
            <option value="">Alla källrader, även fakturor</option>
            <option value="BOOKING">Bokningar och gästuppgifter</option>
            <option value="ACCOMM">Tält och vistelser</option>
            <option value="EXTRAS">Tillval</option>
            <option value="ledger">Betalningar med sammanlänkade källor</option>
          </select>
        </label>
        <label className="text-sm">
          Exportens statusurval
          <select
            value={query.scope}
            onChange={(event) =>
              setQuery((previous) => ({ ...previous, scope: event.target.value, offset: 0 }))
            }
            className={inputClass}
          >
            <option value="">Alla exporturval</option>
            {Object.entries(scopeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? "Hämtar…" : "Sök"}
        </button>
      </form>
      {payments && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
          Beloppen behåller Sirvoys tecken. Negativa och positiva belopp är källuppgifter, inte
          bekräftelse på genomförd betalning eller återbetalning. Valuta saknas i exporten. Basic
          info-fältet Paid och fakturarader räknas inte som ytterligare betalningar.
        </p>
      )}
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
      <div aria-busy={loading} className="space-y-3">
        {!loading && page.rows.length === 0 && (
          <p className="text-sm text-ink/65">
            Inga källrader matchar sökningen. Läs in en arkiverad export nedan om inga filer är
            sökbara ännu.
          </p>
        )}
        {payments
          ? (page.rows as PaymentRow[]).map((row) => (
              <article
                key={row.transaction_key}
                className="rounded-xl border border-line p-4 text-sm"
              >
                <p className="font-semibold">
                  Bokning {row.booking_ref} ·{" "}
                  {row.amount_decimal ?? row.amount_raw ?? "Belopp behöver granskas"}
                </p>
                <p className="break-all">Referens: {row.payment_ref || "saknas"}</p>
                <p>
                  Status i källan: {row.payment_status || "saknas"} · Datum:{" "}
                  {row.occurred_raw || "saknas"}
                </p>
                <p>{row.source_scopes.map((scope) => scopeLabels[scope]).join(" · ")}</p>
                {row.needs_review && (
                  <p className="mt-1 text-amber-800">
                    Behöver granskas
                    {row.source_variants > 1
                      ? ": källorna innehåller olika uppgifter."
                      : ": referens, belopp eller status saknas."}
                  </p>
                )}
                <p className="mt-2 text-ink/65">
                  {row.source_copies} källrader är länkade till denna post.
                </p>
                <div className="mt-2 flex flex-wrap gap-3">
                  {row.sources.map((source, position) => (
                    <button
                      key={source.id}
                      type="button"
                      className="font-semibold text-forest"
                      onClick={() => void openDetail(source.id)}
                    >
                      Visa källa {position + 1} (rad {source.source_row})
                    </button>
                  ))}
                </div>
              </article>
            ))
          : (page.rows as SourceRow[]).map((row) => (
              <article key={row.id} className="rounded-xl border border-line p-4 text-sm">
                <p className="font-semibold">
                  Bokning {row.booking_ref} · {row.record_kind}
                </p>
                <p>
                  {row.guest_name || "Gästnamn saknas i denna rad"}
                  {row.room_ref ? ` · Rums-ID ${row.room_ref}` : ""}
                </p>
                {(row.checkin_date || row.checkout_date) && (
                  <p>
                    {row.checkin_date || "?"} – {row.checkout_date || "?"}
                  </p>
                )}
                {row.amount_raw !== null && (
                  <p>
                    Belopp i källan: {row.amount_raw}
                    {row.source_format === "sirvoy_compatible" ? " (pris per natt)" : ""}
                  </p>
                )}
                <p className="text-ink/65">
                  {scopeLabels[row.cancellation_scope]} · {formatLabels[row.source_format]} ·{" "}
                  {row.filename}, datarad {row.source_row}
                </p>
                <button
                  type="button"
                  onClick={() => void openDetail(row.id)}
                  className="mt-2 font-semibold text-forest"
                >
                  Visa alla originalfält
                </button>
              </article>
            ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span>
          {loading
            ? "Hämtar källrader…"
            : `${page.total ? query.offset + 1 : 0}–${page.rows.length ? query.offset + page.rows.length : 0} av ${page.total}`}
        </span>
        <div className="flex gap-4">
          <button
            type="button"
            disabled={loading || query.offset === 0}
            onClick={() =>
              setQuery((previous) => ({ ...previous, offset: Math.max(0, previous.offset - 50) }))
            }
            className="font-semibold text-forest disabled:opacity-40"
          >
            Föregående
          </button>
          <button
            type="button"
            disabled={loading || !page.hasMore}
            onClick={() => setQuery((previous) => ({ ...previous, offset: previous.offset + 50 }))}
            className="font-semibold text-forest disabled:opacity-40"
          >
            Nästa
          </button>
        </div>
      </div>
      <Dialog
        open={detail !== null || detailLoading}
        onOpenChange={(open) => {
          if (!open) {
            generation.current.detail++;
            setDetail(null);
            setDetailLoading(false);
          }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogTitle className="pr-6">
            {detail
              ? `${detail.filename}, datarad ${detail.record.source_row}`
              : "Hämtar originalfält…"}
          </DialogTitle>
          <DialogDescription>
            {detail
              ? `${scopeLabels[detail.scope]} · ${formatLabels[detail.format]}. Tomma fält visas som ”tomt”.`
              : "Läser källraden från den arkiverade exporten."}
          </DialogDescription>
          {detail && (
            <dl className="divide-y divide-line">
              {detail.headers.map((header, index) => (
                <div key={index} className="grid gap-1 py-2 text-sm sm:grid-cols-3">
                  <dt className="font-semibold">{header || `Kolumn ${index + 1} (utan rubrik)`}</dt>
                  <dd className="whitespace-pre-wrap break-words sm:col-span-2">
                    {detail.record.fields[index] === "" ? (
                      <span className="text-ink/40">tomt</span>
                    ) : (
                      detail.record.fields[index]
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </DialogContent>
      </Dialog>
      <details className="rounded-xl border border-line p-4 text-sm">
        <summary className="cursor-pointer font-semibold">
          Inlästa originalfiler ({summary?.imports.length ?? 0})
        </summary>
        <ul className="mt-3 space-y-2">
          {summary?.imports.map((entry) => (
            <li key={entry.id}>
              <strong>{entry.filename}</strong> · {entry.row_count} rader ·{" "}
              {scopeLabels[entry.scope]}
              {entry.warnings.length > 0 && (
                <p className="text-amber-800">
                  Vissa uppgifter behöver granskas; samtliga originalfält är bevarade.
                </p>
              )}
            </li>
          ))}
        </ul>
      </details>
      <details className="rounded-xl border border-line p-4 text-sm">
        <summary className="cursor-pointer font-semibold">
          Gör en arkiverad bokningsexport sökbar
        </summary>
        <p className="mt-3 text-ink/65">
          Arkivera originalfilen nedan först. Välj sedan exakt det statusurval som användes vid
          exporten i Sirvoy. En registrerad fils urval kan inte skrivas över.
        </p>
        <button
          type="button"
          disabled={archivesLoading}
          onClick={() => void loadArchives()}
          className="mt-3 font-semibold text-forest disabled:opacity-40"
        >
          {archivesLoading ? "Hämtar…" : "Hämta originalfiler från arkivet"}
        </button>
        {archivesMore && (
          <button
            type="button"
            disabled={archivesLoading}
            onClick={() => void loadArchives(archives.length)}
            className="ml-4 font-semibold text-forest disabled:opacity-40"
          >
            Visa fler originalfiler
          </button>
        )}
        <form onSubmit={index} className="mt-3 space-y-3">
          <label className="block">
            Originalfil
            <select
              value={selectedArchive}
              onChange={(event) => setSelectedArchive(event.target.value)}
              required
              className={inputClass}
            >
              <option value="">Välj fil</option>
              {archives
                .filter((entry) => entry.export_kind in formatLabels)
                .map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.filename} · {entry.coverage_filter || "urval inte angivet"}
                  </option>
                ))}
            </select>
          </label>
          <label className="block">
            Statusurval vid exporten
            <select
              value={indexScope}
              onChange={(event) => setIndexScope(event.target.value as Scope)}
              className={inputClass}
            >
              {Object.entries(scopeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={indexing || !selectedArchive} className="btn-primary">
            {indexing ? "Läser originalfilen…" : "Gör exporten sökbar"}
          </button>
        </form>
      </details>
    </section>
  );
}

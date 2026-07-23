import { createFileRoute } from "@tanstack/react-router";
import { Link2, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { supabase, useProperty, useSession, type IcalSource } from "@/lib/supabase";

export const Route = createFileRoute("/app/kallor")({
  component: SourcesPage,
});

function validFeedUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password &&
      host !== "localhost" &&
      !host.endsWith(".local") &&
      !/^(0|10|127|169\.254|192\.168)\./.test(host) &&
      !/^172\.(1[6-9]|2\d|3[01])\./.test(host)
    );
  } catch {
    return false;
  }
}

function SourcesPage() {
  const session = useSession();
  const { property, units } = useProperty(session);
  const [sources, setSources] = useState<IcalSource[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [unitId, setUnitId] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !property) return;
    const { data, error } = await supabase
      .from("ical_sources")
      .select("*, unit:units(name)")
      .eq("property_id", property.id)
      .order("created_at");
    if (error) setError(error.message);
    setSources((data as IcalSource[]) ?? []);
  }, [property]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!unitId && units.length > 0) setUnitId(units[0].id);
  }, [units, unitId]);

  const add = async () => {
    if (!supabase || !property || !name.trim() || !url.trim() || !unitId) return;
    setError(null);
    if (!validFeedUrl(url.trim())) {
      setError("Ange en publik http- eller https-länk till en .ics-kalender.");
      return;
    }
    const { error } = await supabase.from("ical_sources").insert({
      property_id: property.id,
      unit_id: unitId,
      name: name.trim(),
      url: url.trim(),
    });
    if (error) setError(error.message);
    else {
      setName("");
      setUrl("");
      load();
    }
  };

  const remove = async (source: IcalSource) => {
    if (!supabase) return;
    if (!window.confirm(`Ta bort kalenderkällan ${source.name}? Importerade bokningar behålls.`)) return;
    const { error } = await supabase.from("ical_sources").delete().eq("id", source.id);
    if (error) setError(error.message);
    else load();
  };

  const syncNow = async () => {
    if (!supabase) return;
    setSyncing(true);
    setSyncResult(null);
    setError(null);
    const { data, error } = await supabase.functions.invoke("ical-sync", { body: {} });
    setSyncing(false);
    if (error) {
      setError(error.message);
    } else {
      const results =
        (
          data as {
            results?: {
              source: string;
              ok: boolean;
              created?: number;
              updated?: number;
              cancelled?: number;
              error?: string;
            }[];
          }
        )?.results ?? [];
      setSyncResult(
        results.length === 0
          ? "Inga källor att synka."
          : results
              .map((result) =>
                result.ok
                  ? `${result.source}: +${result.created ?? 0} nya, ${result.updated ?? 0} uppdaterade, ${result.cancelled ?? 0} avbokade`
                  : `${result.source}: fel — ${result.error}`,
              )
              .join("\n"),
      );
    }
    load();
  };

  if (!property) return null;

  return (
    <div className="mx-auto max-w-3xl">
      <p className="eyebrow">Integrationer</p>
      <h1 className="mt-2 font-[Fraunces] text-3xl font-semibold">iCal-källor</h1>
      <p className="mt-1 text-[14px] text-[color:var(--ink)]/65">
        Lägg till en exportkalender per boende och kanal. Automatisk synkning bör köras var femtonde minut.
      </p>

      <div className="card-surface mt-6 p-5">
        <div className="grid gap-2.5 sm:grid-cols-[1fr_1fr_1.4fr_auto]">
          <select value={unitId} onChange={(e) => setUnitId(e.target.value)} className="inp">
            {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
          </select>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Airbnb eller Booking.com" className="inp" />
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/calendar.ics" inputMode="url" className="inp" />
          <button onClick={add} disabled={!name.trim() || !url.trim() || !unitId} className="btn-primary !rounded-xl !px-4 !py-2.5 text-[13px] disabled:opacity-40">
            <Link2 size={15} /> Lägg till
          </button>
        </div>
        {error && <p className="mt-3 rounded-xl bg-red-50 px-3.5 py-2.5 text-[13px] text-red-700">{error}</p>}
      </div>

      <div className="mt-4 space-y-3">
        {sources.length === 0 ? (
          <p className="card-surface p-6 text-center text-[14px] text-[color:var(--ink)]/55">Inga källor ännu.</p>
        ) : (
          sources.map((source) => {
            const failed = source.last_status?.toLowerCase().startsWith("fel");
            return (
              <div key={source.id} className={`card-surface flex items-center gap-3 p-4 ${failed ? "ring-1 ring-red-300" : ""}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[15px] font-semibold">{source.name}</span>
                    <span className="rounded-full bg-[color:var(--bg)] px-2 py-0.5 text-[11px] font-semibold text-[color:var(--ink)]/60">{source.unit?.name}</span>
                  </div>
                  <p className="mt-0.5 truncate text-[12px] text-[color:var(--ink)]/50">{source.url}</p>
                  <p className={`mt-1 text-[12px] ${failed ? "text-red-700" : "text-[color:var(--ink)]/60"}`}>
                    {source.last_synced_at
                      ? `Synkad ${new Date(source.last_synced_at).toLocaleString("sv-SE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} — ${source.last_status ?? ""}`
                      : "Inte synkad ännu"}
                  </p>
                </div>
                <button onClick={() => remove(source)} className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[color:var(--ink)]/40 hover:bg-red-50 hover:text-red-600" aria-label="Ta bort källa">
                  <Trash2 size={16} />
                </button>
              </div>
            );
          })
        )}
      </div>

      {sources.length > 0 && (
        <div className="mt-5">
          <button onClick={syncNow} disabled={syncing} className="btn-primary !rounded-xl !px-5 !py-3 text-[14px] disabled:opacity-50">
            <RefreshCw size={15} className={syncing ? "animate-spin" : ""} />
            {syncing ? "Synkar…" : "Synka nu"}
          </button>
          {syncResult && <pre className="card-surface mt-3 whitespace-pre-wrap p-4 text-[13px] text-[color:var(--ink)]/75">{syncResult}</pre>}
        </div>
      )}
    </div>
  );
}

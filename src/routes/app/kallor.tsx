import { createFileRoute } from "@tanstack/react-router";
import { Link2, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { supabase, useProperty, useSession, type IcalSource } from "@/lib/supabase";

export const Route = createFileRoute("/app/kallor")({
  component: SourcesPage,
});

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
    const { data } = await supabase
      .from("ical_sources")
      .select("*, unit:units(name)")
      .eq("property_id", property.id)
      .order("created_at");
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
    const { error } = await supabase
      .from("ical_sources")
      .insert({ property_id: property.id, unit_id: unitId, name: name.trim(), url: url.trim() });
    if (error) setError(error.message);
    else {
      setName("");
      setUrl("");
      load();
    }
  };

  const remove = async (id: string) => {
    if (!supabase) return;
    await supabase.from("ical_sources").delete().eq("id", id);
    load();
  };

  const syncNow = async () => {
    if (!supabase) return;
    setSyncing(true);
    setSyncResult(null);
    const { data, error } = await supabase.functions.invoke("ical-sync", { body: {} });
    setSyncing(false);
    if (error) {
      setSyncResult(`Fel: ${error.message}`);
    } else {
      const r =
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
        r.length === 0
          ? "Inga källor att synka."
          : r
              .map((x) =>
                x.ok
                  ? `${x.source}: +${x.created} nya, ${x.updated} uppdaterade, ${x.cancelled} avbokade`
                  : `${x.source}: fel — ${x.error}`,
              )
              .join("\n"),
      );
    }
    load();
  };

  if (!property) return null;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-[Fraunces] text-2xl font-semibold">iCal-källor</h1>
      <p className="mt-1 text-[14px] text-[color:var(--ink)]/65">
        En källa per <strong>enhet och kanal</strong>. På Airbnb: Kalender → Tillgänglighet →
        "Exportera kalender". På Booking.com: Kalender → Synkronisera kalendrar → Exportera.
        Bokningar hämtas automatiskt var 15:e minut.
      </p>

      <div className="card-surface mt-6 p-5">
        <div className="grid gap-2.5 sm:grid-cols-[1fr_1fr_1.4fr_auto]">
          <select value={unitId} onChange={(e) => setUnitId(e.target.value)} className="inp">
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Namn — t.ex. Airbnb"
            className="inp"
          />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…/calendar.ics"
            className="inp"
          />
          <button
            onClick={add}
            disabled={!name.trim() || !url.trim() || !unitId}
            className="btn-primary !rounded-xl !px-4 !py-2.5 text-[13px] disabled:opacity-40"
          >
            <Link2 size={15} /> Lägg till
          </button>
        </div>
        {error && <p className="mt-2 text-[13px] text-red-600">{error}</p>}
      </div>

      <div className="mt-4 space-y-3">
        {sources.length === 0 ? (
          <p className="card-surface p-6 text-center text-[14px] text-[color:var(--ink)]/55">
            Inga källor ännu — lägg till din första ovan.
          </p>
        ) : (
          sources.map((s) => (
            <div key={s.id} className="card-surface flex items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[15px] font-semibold">{s.name}</span>
                  <span className="rounded-full bg-[color:var(--bg)] px-2 py-0.5 text-[11px] font-semibold text-[color:var(--ink)]/60">
                    {s.unit?.name}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[12px] text-[color:var(--ink)]/50">{s.url}</p>
                <p className="mt-1 text-[12px] text-[color:var(--ink)]/60">
                  {s.last_synced_at
                    ? `Synkad ${new Date(s.last_synced_at).toLocaleString("sv-SE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} — ${s.last_status ?? ""}`
                    : "Inte synkad ännu"}
                </p>
              </div>
              <button
                onClick={() => remove(s.id)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[color:var(--ink)]/40 hover:bg-red-50 hover:text-red-600"
                aria-label="Ta bort källa"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))
        )}
      </div>

      {sources.length > 0 && (
        <div className="mt-5">
          <button
            onClick={syncNow}
            disabled={syncing}
            className="btn-primary !rounded-xl !px-5 !py-3 text-[14px] disabled:opacity-50"
          >
            <RefreshCw size={15} className={syncing ? "animate-spin" : ""} />
            {syncing ? "Synkar…" : "Synka nu"}
          </button>
          {syncResult && (
            <pre className="card-surface mt-3 whitespace-pre-wrap p-4 text-[13px] text-[color:var(--ink)]/75">
              {syncResult}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

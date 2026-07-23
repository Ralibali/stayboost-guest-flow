import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, Link2, Pause, Play, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CHANNEL_LABELS,
  classifyIcalHealth,
  inferChannelType,
  supabase,
  useProperty,
  useSession,
  type IcalChannelType,
  type IcalHealth,
  type IcalSource,
} from "@/lib/supabase";

export const Route = createFileRoute("/app/kallor")({
  component: SourcesPage,
});

const CHANNEL_OPTIONS: IcalChannelType[] = ["sirvoy", "booking", "airbnb", "other"];

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

const HEALTH_STYLES: Record<IcalHealth, { dot: string; label: string; tone: string }> = {
  green: { dot: "bg-emerald-500", label: "Frisk", tone: "text-emerald-700" },
  yellow: { dot: "bg-amber-500", label: "Varning", tone: "text-amber-700" },
  red: { dot: "bg-red-500", label: "Kritisk", tone: "text-red-700" },
  paused: { dot: "bg-slate-400", label: "Pausad", tone: "text-slate-600" },
};

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("sv-SE", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SourcesPage() {
  const session = useSession();
  const { property, units } = useProperty(session);
  const [sources, setSources] = useState<IcalSource[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [unitId, setUnitId] = useState("");
  const [channelType, setChannelType] = useState<IcalChannelType>("sirvoy");
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
      channel_type: channelType,
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
    if (
      !window.confirm(
        `Ta bort kalenderkällan "${source.name}"?\n\nRedan importerade bokningar behålls, men källan går inte att återskapa. Om du bara vill stänga av synken tillfälligt — använd Paus i stället.`,
      )
    )
      return;
    const { error } = await supabase.from("ical_sources").delete().eq("id", source.id);
    if (error) setError(error.message);
    else load();
  };

  const togglePause = async (source: IcalSource) => {
    if (!supabase) return;
    const { error } = await supabase
      .from("ical_sources")
      .update({ paused: !source.paused })
      .eq("id", source.id);
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
          ? "Inga aktiva källor att synka."
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

  const sirvoySources = useMemo(
    () =>
      sources.filter(
        (source) => (source.channel_type ?? inferChannelType(source)) === "sirvoy",
      ),
    [sources],
  );
  const lastSirvoySync = useMemo(() => {
    const times = sirvoySources
      .map((source) => source.last_success_at ?? source.last_synced_at)
      .filter((value): value is string => Boolean(value))
      .map((value) => new Date(value).getTime());
    return times.length ? new Date(Math.max(...times)).toISOString() : null;
  }, [sirvoySources]);
  const unhealthyUnits = useMemo(() => {
    const map = new Map<string, string>();
    for (const source of sources) {
      const health = classifyIcalHealth(source);
      if (health === "red" && source.unit?.name) map.set(source.unit_id, source.unit.name);
    }
    return Array.from(map.values());
  }, [sources]);

  if (!property) return null;

  return (
    <div className="mx-auto max-w-3xl">
      <p className="eyebrow">Integrationer</p>
      <h1 className="mt-2 font-[Fraunces] text-3xl font-semibold">iCal-källor</h1>
      <p className="mt-1 text-[14px] text-[color:var(--ink)]/65">
        Lägg till en exportkalender per boende och kanal. Automatisk synkning bör köras var femtonde minut.
      </p>

      <div className="card-surface mt-5 border-l-4 border-[color:var(--forest)] p-5">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-[color:var(--forest)]">
          Sirvoy-parallelläge
        </p>
        <p className="mt-1.5 text-[14px] leading-relaxed text-[color:var(--ink)]/80">
          Sirvoy är fortsatt primär channel manager mot Booking.com och Airbnb. StayBoost tar
          emot direktbokningar och importerar Sirvoys iCal-flöden för att blockera dubbelbokningar.
        </p>
        <p className="mt-2 text-[13px] text-[color:var(--ink)]/60">
          Senaste lyckade Sirvoy-synk: <strong>{formatDateTime(lastSirvoySync)}</strong>
          {sirvoySources.length === 0 && " — ingen Sirvoy-källa registrerad ännu."}
        </p>
        {unhealthyUnits.length > 0 && (
          <div className="mt-3 flex items-start gap-2 rounded-xl bg-red-50 px-3.5 py-2.5 text-[13px] text-red-800">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>
              Överväg att pausa direktbokningar för <strong>{unhealthyUnits.join(", ")}</strong> tills
              kalendersynken fungerar igen — annars riskerar du dubbelbokning.
            </span>
          </div>
        )}
      </div>

      <div className="card-surface mt-4 p-5">
        <div className="grid gap-2.5 sm:grid-cols-[1fr_1fr_1fr_1.3fr_auto]">
          <select value={unitId} onChange={(e) => setUnitId(e.target.value)} className="inp">
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </select>
          <select
            value={channelType}
            onChange={(e) => setChannelType(e.target.value as IcalChannelType)}
            className="inp"
          >
            {CHANNEL_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {CHANNEL_LABELS[c]}
              </option>
            ))}
          </select>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Etikett, t.ex. Sirvoy Sjöbris"
            className="inp"
          />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…/calendar.ics"
            inputMode="url"
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
        {error && (
          <p className="mt-3 rounded-xl bg-red-50 px-3.5 py-2.5 text-[13px] text-red-700">{error}</p>
        )}
      </div>

      <div className="mt-4 space-y-3">
        {sources.length === 0 ? (
          <p className="card-surface p-6 text-center text-[14px] text-[color:var(--ink)]/55">
            Inga källor ännu.
          </p>
        ) : (
          sources.map((source) => {
            const health = classifyIcalHealth(source);
            const styles = HEALTH_STYLES[health];
            const channel = source.channel_type ?? inferChannelType(source);
            const failures = source.consecutive_failures ?? 0;
            return (
              <div
                key={source.id}
                className={`card-surface flex flex-col gap-3 p-4 sm:flex-row sm:items-center ${
                  health === "red" ? "ring-1 ring-red-300" : ""
                } ${source.paused ? "opacity-70" : ""}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 text-[12px] font-semibold ${styles.tone}`}>
                      <span className={`h-2 w-2 rounded-full ${styles.dot}`} />
                      {styles.label}
                    </span>
                    <span className="text-[15px] font-semibold">{source.name}</span>
                    <span className="rounded-full bg-[color:var(--forest)]/10 px-2 py-0.5 text-[11px] font-semibold text-[color:var(--forest)]">
                      {CHANNEL_LABELS[channel]}
                    </span>
                    <span className="rounded-full bg-[color:var(--bg)] px-2 py-0.5 text-[11px] font-semibold text-[color:var(--ink)]/60">
                      {source.unit?.name}
                    </span>
                    {source.paused && (
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                        Pausad
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate text-[12px] text-[color:var(--ink)]/50">{source.url}</p>
                  <dl className="mt-2 grid gap-x-4 gap-y-0.5 text-[12px] text-[color:var(--ink)]/60 sm:grid-cols-3">
                    <div>
                      <dt className="inline font-semibold text-[color:var(--ink)]/50">Senaste försök: </dt>
                      <dd className="inline">{formatDateTime(source.last_attempt_at ?? source.last_synced_at)}</dd>
                    </div>
                    <div>
                      <dt className="inline font-semibold text-[color:var(--ink)]/50">Senast lyckad: </dt>
                      <dd className="inline">{formatDateTime(source.last_success_at)}</dd>
                    </div>
                    <div>
                      <dt className="inline font-semibold text-[color:var(--ink)]/50">Fel i följd: </dt>
                      <dd className="inline">{failures}</dd>
                    </div>
                  </dl>
                  {source.last_status && (
                    <p
                      className={`mt-1 text-[12px] ${
                        health === "red" || health === "yellow" ? "text-red-700" : "text-[color:var(--ink)]/60"
                      }`}
                    >
                      {source.last_status}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    onClick={() => togglePause(source)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--line)] px-3 py-1.5 text-[12px] font-semibold text-[color:var(--ink)]/70 hover:bg-[color:var(--bg)]"
                    aria-label={source.paused ? "Återaktivera källa" : "Pausa källa"}
                  >
                    {source.paused ? <Play size={13} /> : <Pause size={13} />}
                    {source.paused ? "Återaktivera" : "Pausa"}
                  </button>
                  <button
                    onClick={() => remove(source)}
                    className="grid h-9 w-9 place-items-center rounded-full text-[color:var(--ink)]/40 hover:bg-red-50 hover:text-red-600"
                    aria-label="Ta bort källa"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          })
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

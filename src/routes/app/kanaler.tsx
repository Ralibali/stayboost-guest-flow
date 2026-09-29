import { Link, createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Link2, RefreshCw } from "lucide-react";
import { supabase, useProperty, useSession, type Unit } from "@/lib/supabase";
import {
  channelError,
  channelStatus,
  type ChannelConnection,
  type ChannelMapping,
  type ChannelRevision,
} from "@/lib/channel-manager";
import { PROPERTY_TIME_ZONE } from "@/lib/property-dates";
export const Route = createFileRoute("/app/kanaler")({ component: ChannelsPage });
const input = "inp mt-1";
const button = "rounded-xl border bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40";
const timestamp = (value: string | null) =>
  value
    ? new Date(value).toLocaleString("sv-SE", {
        timeZone: PROPERTY_TIME_ZONE,
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Inte synkat";
function ChannelsPage() {
  const session = useSession();
  const { property, units } = useProperty(session);
  const [connections, setConnections] = useState<ChannelConnection[]>([]);
  const [mappings, setMappings] = useState<ChannelMapping[]>([]);
  const [revisions, setRevisions] = useState<ChannelRevision[]>([]);
  const [externalId, setExternalId] = useState("");
  const [environment, setEnvironment] = useState<"staging" | "production">("staging");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const propertyId = property?.id;
  const load = useCallback(async () => {
    if (!supabase || !propertyId) return;
    setLoading(true);
    try {
      const { data, error: failure } = await supabase
        .from("channel_connections")
        .select("*")
        .eq("property_id", propertyId)
        .order("created_at");
      if (failure) throw failure;
      const rows = (data ?? []) as ChannelConnection[];
      const ids = rows.map((connection) => connection.id);
      const [mappingResult, revisionResult] = ids.length
        ? await Promise.all([
            supabase.from("channel_unit_mappings").select("*").in("connection_id", ids),
            supabase
              .from("channel_booking_revisions")
              .select("revision_id,connection_id,status,created_at,last_error,acknowledged_at")
              .in("connection_id", ids)
              .eq("status", "pending_mapping")
              .order("created_at"),
          ])
        : [
            { data: [], error: null },
            { data: [], error: null },
          ];
      if (mappingResult.error || revisionResult.error)
        throw mappingResult.error ?? revisionResult.error;
      setConnections(rows);
      setMappings((mappingResult.data ?? []) as ChannelMapping[]);
      setRevisions((revisionResult.data ?? []) as ChannelRevision[]);
    } catch (failure) {
      setError(channelError(failure as { message?: string }));
    } finally {
      setLoading(false);
    }
  }, [propertyId]);
  useEffect(() => {
    void load();
  }, [load]);
  const act = async (key: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    setError("");
    setMessage("");
    try {
      await action();
      await load();
    } catch (failure) {
      setError(channelError(failure as { message?: string }));
    } finally {
      setBusy("");
    }
  };
  const create = (event: React.FormEvent) => {
    event.preventDefault();
    void act("create", async () => {
      if (!supabase || !propertyId) return;
      const result = await supabase
        .from("channel_connections")
        .insert({
          property_id: propertyId,
          provider: "channex",
          environment,
          external_property_id: externalId.trim(),
        })
        .select("id")
        .single();
      if (result.error) throw result.error;
      setExternalId("");
      setMessage("Kopplingen är skapad och pausad. Lägg till rums- och priskopplingar.");
    });
  };
  const invoke = (connection: ChannelConnection, action: string) =>
    void act(`${connection.id}:${action}`, async () => {
      if (!supabase) return;
      const result = await supabase.functions.invoke("channel-sync", {
        body: { connectionId: connection.id, action },
      });
      if (result.error) {
        const response = (result.error as { context?: Response }).context;
        if (response?.json) {
          const detail = await response.json().catch(() => null);
          const failures = detail?.results
            ?.filter((item: { ok?: boolean; error?: string }) => item.ok === false)
            .map((item: { error?: string }) => item.error)
            .filter(Boolean)
            .join("; ");
          throw new Error(detail?.detail ?? detail?.error ?? failures ?? result.error.message);
        }
        throw result.error;
      }
      if (result.data?.error) throw new Error(result.data.error);
      if (result.data?.ok === false)
        throw new Error(
          result.data.results
            ?.map((item: { error?: string }) => item.error)
            .filter(Boolean)
            .join("; ") || "Synkningen behöver åtgärdas.",
        );
      setMessage(
        action === "verify"
          ? "Rum och prisplaner har verifierats mot Channex."
          : action === "register_webhook"
            ? "Bokningsaviseringar är registrerade."
            : "Synkningen är genomförd. Kontrollera status och eventuella öppna revisioner nedan.",
      );
    });
  const toggle = (connection: ChannelConnection) =>
    void act(`${connection.id}:toggle`, async () => {
      if (!supabase) return;
      const result = await supabase
        .from("channel_connections")
        .update({ enabled: !connection.enabled })
        .eq("id", connection.id)
        .select("id")
        .single();
      if (result.error) throw result.error;
      setMessage(
        connection.enabled
          ? "Synken har pausats. Försäljningen i kanalerna stängs inte automatiskt; kontrollera att den är stängd via Channex."
          : "Kopplingen har aktiverats. Kör full synkning och kontrollera kanalerna innan försäljningen öppnas.",
      );
    });
  if (!property) return null;
  return (
    <div className="mx-auto max-w-5xl space-y-6" data-private="true">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Distribution</p>
          <h1 className="mt-2 font-[Fraunces] text-3xl font-semibold">Bokningskanaler</h1>
          <p className="mt-2 text-sm text-black/60">
            Anslut Channex för att utbyta bokningar, priser och tillgänglighet med bokningskanaler.
          </p>
        </div>
        <button className={button} disabled={loading || Boolean(busy)} onClick={() => void load()}>
          <RefreshCw size={14} className="mr-2 inline" />
          Uppdatera
        </button>
      </header>
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
        <p className="flex items-center gap-2 font-semibold">
          <AlertTriangle size={17} />
          Verifiera hela kedjan före byte från Sirvoy
        </p>
        <p className="mt-2">
          Anslut Booking.com och Airbnb hos Channex och bekräfta partnerbehörighet där. Varje
          fysiskt tält ska ha ett eget rum med ett exemplar. Testa en bokning, ändring och avbokning
          i testmiljön först. API-nycklar och webhook-hemligheter konfigureras på servern.
        </p>
        <p className="mt-2">
          Testmiljön skriver testbokningar i den valda anläggningens databas. Använd en separat
          testanläggning och testboenden.
        </p>
      </div>
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">
          {message}
        </p>
      )}
      {loading ? (
        <p role="status" className="rounded-xl border bg-white p-5">
          Hämtar kopplingar…
        </p>
      ) : (
        connections.map((connection) => {
          const ownMappings = mappings.filter((mapping) => mapping.connection_id === connection.id);
          const pending = revisions.filter((revision) => revision.connection_id === connection.id);
          const mapped = units.filter(
            (unit) => unit.active && ownMappings.some((mapping) => mapping.unit_id === unit.id),
          ).length;
          const status = channelStatus(
            connection,
            pending.length,
            mapped,
            units.filter((unit) => unit.active).length,
          );
          return (
            <section key={connection.id} className="rounded-2xl border bg-white p-5 space-y-5">
              <header className="flex flex-wrap justify-between gap-3">
                <div>
                  <h2 className="font-semibold">
                    Channex · {connection.environment === "production" ? "Produktion" : "Testmiljö"}
                  </h2>
                  <p className="mt-1 break-all text-xs text-black/55">
                    Anläggnings-ID: {connection.external_property_id}
                  </p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${status.tone === "green" ? "bg-emerald-50 text-emerald-800" : status.tone === "amber" ? "bg-amber-50 text-amber-800" : "bg-black/5 text-black/60"}`}
                >
                  {status.label}
                </span>
              </header>
              <div className="grid gap-2 text-xs sm:grid-cols-2">
                <p>Senaste bokningssynk: {timestamp(connection.last_booking_sync_at)}</p>
                <p>Senaste pris och tillgänglighet: {timestamp(connection.last_ari_sync_at)}</p>
                <p>
                  Verifierade rum:{" "}
                  {connection.verified_at ? timestamp(connection.verified_at) : "Återstår"}
                </p>
                <p>Bokningsaviseringar: {connection.webhook_id ? "Registrerade" : "Återstår"}</p>
              </div>
              {connection.last_error && (
                <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
                  {channelError(connection.last_error)}
                </p>
              )}
              {connection.next_retry_at && (
                <p className="text-xs text-amber-900">
                  Nästa automatiska återförsök tidigast {timestamp(connection.next_retry_at)}.
                </p>
              )}
              <div>
                <h3 className="font-semibold text-sm">Boenden och prisplaner</h3>
                <p className="mt-1 text-xs text-black/55">
                  Koppla varje tält till dess room type ID och rate plan ID från Channex. Pausa
                  innan något ändras, verifiera därefter på nytt.
                </p>
                <div className="mt-3 space-y-3">
                  {units
                    .filter(
                      (unit) =>
                        unit.active || ownMappings.some((mapping) => mapping.unit_id === unit.id),
                    )
                    .map((unit) => (
                      <MappingRow
                        key={`${connection.id}:${unit.id}:${ownMappings.find((mapping) => mapping.unit_id === unit.id)?.rate_plan_id}`}
                        unit={unit}
                        connection={connection}
                        mapping={ownMappings.find((mapping) => mapping.unit_id === unit.id)}
                        disabled={Boolean(busy)}
                        onSave={(type, plan) =>
                          void act(`${connection.id}:${unit.id}`, async () => {
                            if (!supabase) return;
                            const mapping = ownMappings.find((item) => item.unit_id === unit.id);
                            const result = mapping
                              ? await supabase
                                  .from("channel_unit_mappings")
                                  .update({ room_type_id: type, rate_plan_id: plan })
                                  .eq("id", mapping.id)
                                  .select("id")
                                  .single()
                              : await supabase
                                  .from("channel_unit_mappings")
                                  .insert({
                                    connection_id: connection.id,
                                    unit_id: unit.id,
                                    room_type_id: type,
                                    rate_plan_id: plan,
                                  })
                                  .select("id")
                                  .single();
                            if (result.error) throw result.error;
                            setMessage(
                              "Rums- och priskopplingen är sparad. Verifiera och registrera bokningsaviseringar på nytt.",
                            );
                          })
                        }
                      />
                    ))}
                </div>
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={connection.fees_configured}
                  disabled={Boolean(busy) || connection.enabled}
                  onChange={(event) => {
                    const fees = event.target.checked;
                    void act(`${connection.id}:fees`, async () => {
                      if (!supabase) return;
                      const result = await supabase
                        .from("channel_connections")
                        .update({ fees_configured: fees })
                        .eq("id", connection.id);
                      if (result.error) throw result.error;
                    });
                  }}
                />
                <span>
                  Jag har kontrollerat städavgift, barnavgift, barnåldrar och kapacitet i varje
                  ansluten kanals prisplan.{" "}
                  <span className="block mt-1 text-xs text-black/55">
                    Vuxenpriser skickas per antal vuxna. Barnens avgift och åldersgränser ska stämma
                    med StayBoost i respektive kanal. Separat städavgift ingår inte i nattpriset.
                    Synkningen stoppas om avgiftsupplägget inte är bekräftat när det behövs.
                  </span>
                </span>
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  className={button}
                  disabled={Boolean(busy) || connection.enabled}
                  onClick={() => invoke(connection, "verify")}
                >
                  <CheckCircle2 size={14} className="mr-1 inline" />
                  Verifiera rum och priser
                </button>
                <button
                  className={button}
                  disabled={Boolean(busy) || !connection.verified_at}
                  onClick={() => invoke(connection, "register_webhook")}
                >
                  <Link2 size={14} className="mr-1 inline" />
                  Registrera bokningsaviseringar
                </button>
                <button
                  className={button}
                  disabled={
                    Boolean(busy) ||
                    (!connection.enabled && (!connection.verified_at || !connection.webhook_id))
                  }
                  onClick={() => toggle(connection)}
                >
                  {connection.enabled ? "Pausa synken" : "Aktivera koppling"}
                </button>
                <button
                  className={`${button} bg-[#173c2b] text-white`}
                  disabled={Boolean(busy) || !connection.enabled}
                  onClick={() => invoke(connection, "sync_all")}
                >
                  {busy.startsWith(connection.id)
                    ? "Arbetar…"
                    : "Synka bokningar, priser och tillgänglighet"}
                </button>
              </div>
              <p className="text-xs text-ink/65">
                Stäng först försäljningen i kanalerna via Channex innan du pausar synken eller
                ändrar rumskopplingarna.
              </p>
              {pending.length > 0 && (
                <div role="alert" className="rounded-xl bg-amber-50 p-4 text-sm">
                  <p className="font-semibold">{pending.length} kanalrevisioner väntar på åtgärd</p>
                  <p className="mt-1">
                    Direktbokningar stoppas tills mottagna bokningar har sparats. Kontrollera
                    rumskopplingarna, verifiera på nytt och kör full synkning.
                  </p>
                  {pending.slice(0, 10).map((revision) => (
                    <p key={revision.revision_id} className="mt-2 break-all text-xs">
                      {revision.revision_id} · {timestamp(revision.created_at)}
                      {revision.last_error && ` · ${channelError(revision.last_error)}`}
                    </p>
                  ))}
                </div>
              )}
            </section>
          );
        })
      )}
      {!loading && (
        <form onSubmit={create} className="rounded-2xl border bg-white p-5 space-y-4">
          <h2 className="font-semibold">Lägg till Channex-koppling</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Miljö
              <select
                className={input}
                value={environment}
                onChange={(event) => setEnvironment(event.target.value as "staging" | "production")}
              >
                <option value="staging">Testmiljö</option>
                <option value="production">Produktion</option>
              </select>
            </label>
            <label className="text-sm">
              Channex property ID
              <input
                className={input}
                required
                maxLength={128}
                value={externalId}
                onChange={(event) => setExternalId(event.target.value)}
              />
            </label>
          </div>
          <p className="text-xs text-black/55">
            En koppling per miljö och anläggning. Nya kopplingar är pausade tills rum, prisplaner
            och bokningsaviseringar har verifierats.
          </p>
          <button
            className={button}
            disabled={
              Boolean(busy) ||
              connections.some((connection) => connection.environment === environment)
            }
          >
            Skapa pausad koppling
          </button>
        </form>
      )}
      <section className="rounded-2xl border bg-white p-5 space-y-3">
        <h2 className="font-semibold">Google och BookVisit</h2>
        <p className="text-sm text-black/65">
          Google Hotel Ads med StayBoosts egen bokningsmotor kräver ett godkänt upplägg med eget
          Hotel Center eller partner. Channex standardkoppling till Google använder deras
          bokningsmotor. Status är därför inte klar här.
        </p>
        <p className="text-sm text-black/65">
          BookVisit behöver bekräfta partnerkoppling, API-åtkomst och stöd för er anläggning. En
          iframe ger ingen synkning av rum, priser eller bokningar.
        </p>
        <p className="text-xs">
          <a
            className="font-semibold underline"
            href="https://docs.channex.io/google/google-hotel-ads"
            target="_blank"
            rel="noreferrer"
          >
            Channex villkor för Google
          </a>{" "}
          ·{" "}
          <Link to="/app/startklart" className="font-semibold underline">
            Kontrollera lanseringsberedskap
          </Link>
        </p>
      </section>
    </div>
  );
}
function MappingRow({
  unit,
  connection,
  mapping,
  disabled,
  onSave,
}: {
  unit: Unit;
  connection: ChannelConnection;
  mapping?: ChannelMapping;
  disabled: boolean;
  onSave: (type: string, plan: string) => void;
}) {
  const [type, setType] = useState(mapping?.room_type_id ?? "");
  const [plan, setPlan] = useState(mapping?.rate_plan_id ?? "");
  return (
    <form
      className="grid items-end gap-2 rounded-xl bg-[#f5f6f3] p-3 sm:grid-cols-[1fr_1fr_1fr_auto]"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(type.trim(), plan.trim());
      }}
    >
      <p className="pb-2 text-sm font-semibold">{unit.name}</p>
      <label className="text-xs">
        Room type ID
        <input
          className={input}
          required
          maxLength={128}
          value={type}
          disabled={disabled || connection.enabled}
          onChange={(event) => setType(event.target.value)}
        />
      </label>
      <label className="text-xs">
        Rate plan ID
        <input
          className={input}
          required
          maxLength={128}
          value={plan}
          disabled={disabled || connection.enabled}
          onChange={(event) => setPlan(event.target.value)}
        />
      </label>
      <button className={button} disabled={disabled || connection.enabled}>
        Spara
      </button>
    </form>
  );
}

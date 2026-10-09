import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Circle, FileUp, Loader2, RefreshCw } from "lucide-react";
import { supabase, useProperty, useSession } from "@/lib/supabase";
import { prepareSirvoyImport } from "@/lib/sirvoy-cutover";
import { SirvoyArchive } from "@/components/app/SirvoyArchive";
import { SirvoySourceRecords } from "@/components/app/SirvoySourceRecords";
import { StripeReadinessDetails } from "@/components/app/StripeReadinessDetails";
import { StripeConnectionCheck } from "@/components/app/StripeConnectionCheck";
import { StripeCheckoutCheck } from "@/components/app/StripeCheckoutCheck";
import { sanitizedHttpsUrl } from "../../../supabase/functions/_shared/public-links";
import {
  isLaunchReadiness,
  smsLaunchReadiness,
  type LaunchReadiness,
} from "@/lib/launch-readiness";

export const Route = createFileRoute("/app/startklart")({ component: LaunchPage });
function LaunchPage() {
  const session = useSession();
  const { property, units } = useProperty(session);
  const [content, setContent] = useState("");
  const [basic, setBasic] = useState("");
  const [guestCounts, setGuestCounts] = useState<Record<string, number>>({});
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);
  const [connections, setConnections] = useState<LaunchReadiness | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const propertyId = property?.id;
  const refresh = useCallback(async () => {
    if (!supabase || !propertyId) return;
    setConnectionError(null);
    try {
      const { data, error: loadError } = await supabase.functions.invoke("booking-import", {
        body: { propertyId, action: "readiness" },
      });
      if (loadError || !isLaunchReadiness(data))
        throw new Error(
          "Startkontrollen kunde inte hämtas. Kontrollera att senaste versionen är publicerad.",
        );
      setConnections(data);
    } catch (e) {
      setConnections(null);
      setConnectionError((e as Error).message);
    }
  }, [propertyId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const preview = useMemo(() => {
    if (!content) return null;
    try {
      return prepareSirvoyImport(content, basic, mapping);
    } catch (e) {
      return { stays: [], rooms: [], errors: [(e as Error).message], warnings: [] };
    }
  }, [content, basic, mapping]);
  const loadFile = async (file: File | undefined, target: "content" | "basic") => {
    if (!file) return;
    setError(null);
    setResult(null);
    setChecked(false);
    if (file.size > 10 * 1024 * 1024) {
      setError("Filen får vara högst 10 MB.");
      return;
    }
    try {
      const text = await file.text();
      if (target === "content") {
        setContent(text);
        setMapping({});
        setGuestCounts({});
      } else setBasic(text);
    } catch {
      setError("Filen kunde inte läsas. Välj en sparad CSV-export från Sirvoy.");
    }
  };
  const runImport = async () => {
    if (!supabase || !property || !preview || preview.errors.length || !checked || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const { data, error: saveError } = await supabase.functions.invoke("booking-import", {
        body: {
          propertyId: property.id,
          rows: preview.stays.map((s) => ({
            ...s,
            guests: guestCounts[s.external_id] ?? s.guests,
          })),
        },
      });
      if (saveError || !data?.ok) {
        let reason = data?.error;
        if (saveError && "context" in saveError) {
          try {
            reason = (await (saveError.context as Response).json()).error;
          } catch {
            /* no JSON response */
          }
        }
        throw new Error(
          reason === "booking_overlap"
            ? "Importen innehåller en överlappande bokning. Ingen vistelse har importerats. Kontrollera datumen och befintliga bokningar."
            : "Importen kunde inte slutföras. Ingen del av denna import har sparats. Kontrollera filer och publicerad version.",
        );
      }
      setResult(
        `${data.imported} vistelser importerades. ${data.skipped} fanns redan och lämnades kvar. Inga gästmeddelanden skickades.`,
      );
      setChecked(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!property) return null;
  const smsReadiness = smsLaunchReadiness(connections);
  const checks = [
    {
      label: "Aktiva boenden har kapacitet och pris",
      ok:
        units.some((u) => u.active) &&
        units.filter((u) => u.active).every((u) => u.max_guests > 0 && u.base_price > 0),
      href: "/app/installningar" as const,
    },
    {
      label: "Kontaktuppgifter för gäster",
      ok: Boolean(property.contact_email && property.contact_phone),
      href: "/app/installningar" as const,
    },
    {
      label: "Boendets egna bokningsvillkor",
      ok: Boolean(sanitizedHttpsUrl(property.booking_terms_url)),
      href: "/app/installningar" as const,
    },
    {
      label: "Bokningsbetalning ansluten",
      ok: Boolean(
        property.swish_number ||
        (connections?.stripeConfigured && connections?.stripeWebhookConfigured),
      ),
      href: "/app/installningar" as const,
    },
    {
      label: "Bekräftelsemejl konfigurerat",
      ok: connections?.emailConfigured === true,
      href: "/app/mallar" as const,
    },
    {
      label: smsReadiness.label,
      ok: smsReadiness.ok,
      href: "/app/mallar" as const,
    },
    {
      label: "Bokningssidan är öppen",
      ok: property.booking_enabled,
      href: "/app/installningar" as const,
    },
  ];
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <p className="eyebrow">Från Sirvoy till StayBoost</p>
        <h1 className="mt-2 font-[Fraunces] text-3xl font-semibold">Gör klart för bokningar</h1>
        <p className="mt-2 text-sm text-ink/65">
          Stäm av boenden, bokningar och anslutningar innan hemsidans bokningsknapp byts.
        </p>
      </header>
      <section className="card-surface p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">Startkontroll</h2>
          <button
            type="button"
            onClick={() => void refresh()}
            className="inline-flex items-center gap-2 text-sm text-forest"
          >
            <RefreshCw size={16} /> Uppdatera
          </button>
        </div>
        <p className="mt-2 text-sm text-ink/60">
          Kontrollen visar sparade inställningar. Betalning och meddelandeleverans verifieras med en
          genomförd provbokning.
        </p>
        {connectionError ? (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {connectionError}
          </p>
        ) : null}
        <ul className="mt-4 divide-y divide-line">
          {checks.map((c) => (
            <li key={c.label} className="flex items-center gap-3 py-3">
              {c.ok ? (
                <CheckCircle2 size={20} className="shrink-0 text-forest" />
              ) : (
                <Circle size={20} className="shrink-0 text-amber-600" />
              )}
              <span className="flex-1 text-sm">
                {c.label}
                <span className="ml-2 text-xs text-ink/50">
                  {c.ok ? "Kontrollerat" : "Återstår"}
                </span>
              </span>
              <Link to={c.href} className="text-sm font-semibold text-forest">
                Öppna
              </Link>
            </li>
          ))}
        </ul>
        <StripeReadinessDetails readiness={connections} />
        <StripeConnectionCheck
          key={`${session?.user.id}:${property.id}`}
          propertyId={property.id}
        />
        <StripeCheckoutCheck key={`${session?.user.id}:${property.id}`} propertyId={property.id} />
        {smsReadiness.required && !smsReadiness.ok && (
          <p role="alert" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
            Aktiva gästmeddelanden använder SMS, men SMS-tjänsten är inte konfigurerad. Anslut
            46elks, eller ändra dessa mallar till endast mejl under Gästresa. SMS ersätts inte
            automatiskt med mejl.
          </p>
        )}
        <p className="mt-4 text-sm text-ink/65">
          Kalenderflöden blockerar upptagna datum. Pris-, kanal- och bokningssynk för Booking.com,
          Airbnb, BookVisit och Google Hotel Ads måste stämmas av separat innan deras
          Sirvoy-kopplingar stängs.
        </p>
      </section>
      <SirvoySourceRecords propertyId={property.id} />
      <SirvoyArchive propertyId={property.id} />
      <section className="card-surface space-y-5 p-5 sm:p-6">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <FileUp size={20} /> Importera vistelser från Sirvoy
          </h2>
          <p className="mt-2 text-sm text-ink/65">
            Ladda upp Booking content och Basic info från samma aktuella export. Varje tältvistelse
            blir en bokning som kan hanteras i StayBoost. Befintliga bokningar skrivs aldrig över.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ["content", "Booking content (vistelser)"],
              ["basic", "Basic info (gästuppgifter)"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="rounded-xl border border-line p-4 text-sm font-medium">
              {label}
              <input
                type="file"
                accept=".csv,text/csv"
                disabled={busy}
                className="mt-3 block w-full text-xs"
                onChange={(e) => void loadFile(e.target.files?.[0], key)}
              />
            </label>
          ))}
        </div>
        {preview?.rooms.length ? (
          <fieldset className="space-y-3">
            <legend className="mb-2 font-medium">Koppla Sirvoys rum till rätt boende</legend>
            {preview.rooms.map((room) => (
              <label key={room} className="flex flex-wrap items-center gap-3 text-sm">
                <span className="w-24">Room ID {room}</span>
                <select
                  disabled={busy}
                  value={mapping[room] ?? ""}
                  className="min-w-48 flex-1 rounded-lg border border-line bg-white p-2"
                  onChange={(e) => {
                    setMapping((m) => ({ ...m, [room]: e.target.value }));
                    setChecked(false);
                  }}
                >
                  <option value="">Välj boende</option>
                  {units
                    .filter((u) => u.active)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} · max {u.max_guests} gäster
                      </option>
                    ))}
                </select>
              </label>
            ))}
          </fieldset>
        ) : null}
        {preview ? (
          <>
            <div aria-live="polite">
              <p className="text-sm font-semibold">
                {preview.stays.length} vistelser i förhandsgranskningen
              </p>
              {preview.errors.length ? (
                <ul className="mt-2 space-y-1 text-sm text-red-700">
                  {preview.errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              ) : null}
              {preview.warnings.length ? (
                <ul className="mt-3 space-y-1 text-sm text-amber-800">
                  {preview.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                  <li>
                    Originalets tillval sparas som intern anteckning. Betalningar och
                    leveransuppgifter behöver stämmas av.
                  </li>
                </ul>
              ) : null}
            </div>
            <div className="max-h-80 overflow-auto rounded-xl border border-line">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-bg">
                  <tr>
                    {["Sirvoy", "Gäst", "Boende", "Ankomst", "Avresa", "Gäster"].map((h) => (
                      <th key={h} className="p-3 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.stays.map((s) => (
                    <tr key={s.external_id} className="border-t border-line">
                      <td className="p-3">{s.external_id.split(":")[1]}</td>
                      <td className="p-3">{s.guest_name}</td>
                      <td className="p-3">
                        {units.find((u) => u.id === s.unit_id)?.name ?? "Välj boende"}
                      </td>
                      <td className="p-3">{s.checkin_date}</td>
                      <td className="p-3">{s.checkout_date}</td>
                      <td className="p-3">
                        <input
                          type="number"
                          min={1}
                          max={units.find((u) => u.id === s.unit_id)?.max_guests ?? 20}
                          aria-label={`Alla gäster i bokning ${s.external_id.split(":")[1]}, rum ${s.room_ref}`}
                          disabled={busy}
                          value={guestCounts[s.external_id] ?? s.guests}
                          onChange={(e) => {
                            setGuestCounts((c) => ({
                              ...c,
                              [s.external_id]: Number(e.target.value),
                            }));
                            setChecked(false);
                          }}
                          className="w-16 rounded border border-line p-1"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={checked}
                disabled={busy}
                className="mt-1"
                onChange={(e) => setChecked(e.target.checked)}
              />
              <span>
                Jag har granskat datum, bokningsstatus, rum och gästantal mot Sirvoy. Gästantalet
                inkluderar alla barn och småbarn. Jag stämmer av betalning, barn och tillval innan
                ankomst.
              </span>
            </label>
            <button
              type="button"
              disabled={
                busy ||
                !checked ||
                preview.errors.length > 0 ||
                !preview.stays.length ||
                preview.stays.some((s) => {
                  const n = guestCounts[s.external_id] ?? s.guests;
                  return (
                    !Number.isInteger(n) ||
                    n < 1 ||
                    n > (units.find((u) => u.id === s.unit_id)?.max_guests ?? 20)
                  );
                })
              }
              onClick={() => void runImport()}
              className="btn-primary inline-flex items-center gap-2 disabled:opacity-40"
            >
              {busy ? <Loader2 size={18} className="animate-spin" /> : <FileUp size={18} />}{" "}
              Importera granskade vistelser
            </button>
          </>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        ) : null}
        {result ? (
          <p role="status" className="rounded-xl bg-forest/10 p-4 text-sm text-forest">
            {result}{" "}
            <Link to="/app/bokningar" className="underline">
              Öppna bokningarna
            </Link>
          </p>
        ) : null}
      </section>
    </div>
  );
}

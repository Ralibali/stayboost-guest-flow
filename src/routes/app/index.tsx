import { Link, createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Home,
  MailWarning,
  RefreshCw,
  Users,
  WalletCards,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, useProperty, useSession, type Booking, type IcalSource } from "@/lib/supabase";

export const Route = createFileRoute("/app/")({
  component: DashboardPage,
});

type MessageHealth = {
  id: string;
  status: "pending" | "sent" | "failed" | "cancelled";
  error: string | null;
  send_at: string;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const fmtKr = (n: number) => `${Math.round(n).toLocaleString("sv-SE")} kr`;
const svDate = (value: string) =>
  new Date(value + "T12:00:00").toLocaleDateString("sv-SE", { day: "numeric", month: "short" });

function nightsOverlap(from: string, to: string, windowFrom: string, windowTo: string) {
  const start = new Date(`${from > windowFrom ? from : windowFrom}T00:00:00Z`).getTime();
  const end = new Date(`${to < windowTo ? to : windowTo}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((end - start) / 86400000));
}

function DashboardPage() {
  const session = useSession();
  const { property, units } = useProperty(session);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [messages, setMessages] = useState<MessageHealth[]>([]);
  const [sources, setSources] = useState<IcalSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !property) return;
    setLoading(true);
    setLoadError(null);
    const today = iso(new Date());
    const future = new Date();
    future.setDate(future.getDate() + 60);

    const [bookingResult, messageResult, sourceResult] = await Promise.all([
      supabase
        .from("bookings")
        .select("*, unit:units(name,max_guests)")
        .eq("property_id", property.id)
        .gte("checkout_date", today)
        .lte("checkin_date", iso(future))
        .order("checkin_date"),
      supabase
        .from("scheduled_messages")
        .select("id,status,error,send_at,booking:bookings!inner(property_id)")
        .eq("booking.property_id", property.id)
        .in("status", ["pending", "failed"])
        .order("send_at"),
      supabase
        .from("ical_sources")
        .select("*, unit:units(name)")
        .eq("property_id", property.id)
        .order("created_at"),
    ]);

    const firstError = bookingResult.error ?? messageResult.error ?? sourceResult.error;
    if (firstError) setLoadError(firstError.message);
    setBookings((bookingResult.data as Booking[]) ?? []);
    setMessages((messageResult.data as unknown as MessageHealth[]) ?? []);
    setSources((sourceResult.data as IcalSource[]) ?? []);
    setLoading(false);
  }, [property]);

  useEffect(() => {
    load();
  }, [load]);

  const metrics = useMemo(() => {
    const today = iso(new Date());
    const in30Date = new Date();
    in30Date.setDate(in30Date.getDate() + 30);
    const in30 = iso(in30Date);
    const confirmed = bookings.filter((b) => b.status === "confirmed");
    const activeUnits = units.filter((u) => u.active);
    const occupiedNights = confirmed.reduce(
      (sum, b) => sum + nightsOverlap(b.checkin_date, b.checkout_date, today, in30),
      0,
    );
    const capacityNights = Math.max(1, activeUnits.length * 30);
    const occupancy = Math.min(100, Math.round((occupiedNights / capacityNights) * 100));
    const arrivals = confirmed.filter((b) => b.checkin_date === today);
    const departures = confirmed.filter((b) => b.checkout_date === today);
    const pendingPayments = confirmed.filter((b) => b.payment_status === "pending");
    const paidValue = confirmed
      .filter((b) => b.payment_status === "paid")
      .reduce((sum, b) => sum + (b.payment_amount ?? 0), 0);
    const addonRevenue = confirmed
      .filter((b) => b.payment_status === "paid")
      .reduce((sum, b) => sum + (b.addons_total ?? 0), 0);

    let conflicts = 0;
    for (let i = 0; i < confirmed.length; i++) {
      for (let j = i + 1; j < confirmed.length; j++) {
        const a = confirmed[i];
        const b = confirmed[j];
        if (
          a.unit_id &&
          a.unit_id === b.unit_id &&
          a.checkin_date < b.checkout_date &&
          a.checkout_date > b.checkin_date
        )
          conflicts++;
      }
    }

    return {
      today,
      in30,
      confirmed,
      occupancy,
      arrivals,
      departures,
      pendingPayments,
      paidValue,
      addonRevenue,
      conflicts,
    };
  }, [bookings, units]);

  if (!property) return null;

  const failedMessages = messages.filter((m) => m.status === "failed");
  const sourceErrors = sources.filter((s) => s.last_status?.toLowerCase().startsWith("fel"));
  const alerts = [
    metrics.conflicts > 0
      ? {
          label: `${metrics.conflicts} kalenderkonflikt${metrics.conflicts === 1 ? "" : "er"}`,
          to: "/app/bokningar" as const,
          icon: AlertTriangle,
        }
      : null,
    metrics.pendingPayments.length > 0
      ? {
          label: `${metrics.pendingPayments.length} betalning${metrics.pendingPayments.length === 1 ? "" : "ar"} väntar`,
          to: "/app/bokningar" as const,
          icon: Clock3,
        }
      : null,
    failedMessages.length > 0
      ? {
          label: `${failedMessages.length} utskick misslyckades`,
          to: "/app/bokningar" as const,
          icon: MailWarning,
        }
      : null,
    sourceErrors.length > 0
      ? {
          label: `${sourceErrors.length} kalenderkälla${sourceErrors.length === 1 ? "" : "or"} har fel`,
          to: "/app/kallor" as const,
          icon: RefreshCw,
        }
      : null,
  ].filter(Boolean) as {
    label: string;
    to: "/app/bokningar" | "/app/kallor";
    icon: typeof AlertTriangle;
  }[];

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Ägaröversikt</p>
          <h1 className="mt-2 font-[Fraunces] text-3xl font-semibold">{property.name}</h1>
          <p className="mt-1 text-[14px] text-[color:var(--ink)]/55">
            Verklig data från bokningar, betalningar, utskick och kalenderkopplingar.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="btn-ghost !rounded-xl !px-4 !py-2.5 text-[13px] disabled:opacity-50"
        >
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} /> Uppdatera
        </button>
      </div>

      {loadError && (
        <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          Dashboarden kunde inte läsa all data: {loadError}
        </div>
      )}

      {alerts.length > 0 ? (
        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          {alerts.map((a) => (
            <Link
              key={a.label}
              to={a.to}
              className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] font-semibold text-amber-900"
            >
              <a.icon size={17} />
              <span className="flex-1">{a.label}</span>
              <ArrowRight size={15} />
            </Link>
          ))}
        </div>
      ) : (
        <div className="mt-6 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] font-semibold text-emerald-900">
          <CheckCircle2 size={17} /> Allt ser bra ut — inga konflikter, betalningsköer eller
          integrationsfel.
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          icon={Home}
          label="Beläggning 30 dagar"
          value={`${metrics.occupancy} %`}
          sub={`${units.filter((u) => u.active).length} aktiva boenden`}
        />
        <Kpi
          icon={Banknote}
          label="Betalt bokningsvärde"
          value={fmtKr(metrics.paidValue)}
          sub={`Tillval ${fmtKr(metrics.addonRevenue)}`}
        />
        <Kpi
          icon={CalendarCheck}
          label="Ankomster i dag"
          value={String(metrics.arrivals.length)}
          sub={`${metrics.departures.length} avresor`}
        />
        <Kpi
          icon={WalletCards}
          label="Väntande betalningar"
          value={String(metrics.pendingPayments.length)}
          sub={metrics.pendingPayments.length ? "Kräver kontroll" : "Inga att hantera"}
        />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <section className="card-surface overflow-hidden">
          <div className="flex items-center justify-between border-b border-[color:var(--line)] px-5 py-4">
            <div>
              <h2 className="text-[15px] font-bold">Kommande vistelser</h2>
              <p className="text-[12px] text-[color:var(--ink)]/50">
                Närmaste bekräftade bokningarna
              </p>
            </div>
            <Link
              to="/app/bokningar"
              className="text-[12px] font-semibold text-[color:var(--brass)] hover:underline"
            >
              Visa alla
            </Link>
          </div>
          <div className="divide-y divide-[color:var(--line)]">
            {loading ? (
              <p className="px-5 py-10 text-center text-[13px] text-[color:var(--ink)]/45">
                Laddar…
              </p>
            ) : metrics.confirmed.length === 0 ? (
              <p className="px-5 py-10 text-center text-[13px] text-[color:var(--ink)]/45">
                Inga kommande bokningar.
              </p>
            ) : (
              metrics.confirmed.slice(0, 7).map((b) => (
                <div key={b.id} className="flex items-center gap-3 px-5 py-3.5">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[color:var(--forest)] text-[12px] font-bold text-white">
                    {(b.guest_name ?? "?")
                      .split(" ")
                      .map((n) => n[0])
                      .slice(0, 2)
                      .join("")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold">
                      {b.guest_name ?? "Okänd gäst"}
                    </p>
                    <p className="truncate text-[12px] text-[color:var(--ink)]/50">
                      {b.unit?.name ?? "Ingen enhet"} · {svDate(b.checkin_date)}–
                      {svDate(b.checkout_date)} · {b.guests ?? "?"} gäster
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-1 text-[10px] font-semibold ${b.payment_status === "paid" ? "bg-emerald-100 text-emerald-800" : b.payment_status === "pending" ? "bg-amber-100 text-amber-800" : "bg-[color:var(--bg)] text-[color:var(--ink)]/55"}`}
                  >
                    {b.payment_status === "paid"
                      ? "Betald"
                      : b.payment_status === "pending"
                        ? "Väntar"
                        : b.source}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="card-surface p-5">
          <h2 className="text-[15px] font-bold">I dag</h2>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <MiniStat icon={Users} label="Ankomster" value={metrics.arrivals.length} />
            <MiniStat icon={CalendarDays} label="Avresor" value={metrics.departures.length} />
          </div>
          <div className="mt-5 border-t border-[color:var(--line)] pt-4">
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[color:var(--ink)]/50">
              Snabblänkar
            </h3>
            <div className="mt-2 space-y-1">
              <QuickLink to="/app/bokningar" label="Skapa eller hantera bokning" />
              <QuickLink to="/app/tillval" label="Redigera tillval" />
              <QuickLink to="/app/installningar" label="Redigera boenden och maxgäster" />
              <QuickLink to="/app/mallar" label="Kontrollera automatiska utskick" />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Home;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="card-surface p-4 sm:p-5">
      <div className="flex items-center gap-2 text-[color:var(--ink)]/45">
        <Icon size={16} />
        <span className="text-[11px] font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-3 font-[Fraunces] text-2xl font-semibold sm:text-3xl">{value}</p>
      <p className="mt-1 text-[11px] text-[color:var(--ink)]/45">{sub}</p>
    </div>
  );
}

function MiniStat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-2xl bg-[color:var(--bg)] p-4">
      <Icon size={17} className="text-[color:var(--forest)]" />
      <p className="mt-3 font-[Fraunces] text-2xl font-semibold">{value}</p>
      <p className="text-[11px] text-[color:var(--ink)]/50">{label}</p>
    </div>
  );
}

function QuickLink({
  to,
  label,
}: {
  to: "/app/bokningar" | "/app/tillval" | "/app/installningar" | "/app/mallar";
  label: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center justify-between rounded-xl px-2 py-2 text-[13px] font-medium hover:bg-[color:var(--bg)]"
    >
      {label}
      <ArrowRight size={14} className="text-[color:var(--ink)]/35" />
    </Link>
  );
}

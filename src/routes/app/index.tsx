import { Link, createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Home,
  MailWarning,
  PackagePlus,
  RefreshCw,
  Sparkles,
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
          description: "Två bokningar verkar ligga på samma boende.",
          to: "/app/bokningar" as const,
          icon: AlertTriangle,
        }
      : null,
    metrics.pendingPayments.length > 0
      ? {
          label: `${metrics.pendingPayments.length} betalning${metrics.pendingPayments.length === 1 ? "" : "ar"} väntar`,
          description: "Kontrollera Swish eller utgående betalningslänkar.",
          to: "/app/bokningar" as const,
          icon: Clock3,
        }
      : null,
    failedMessages.length > 0
      ? {
          label: `${failedMessages.length} utskick misslyckades`,
          description: "Ett gästmeddelande behöver din uppmärksamhet.",
          to: "/app/bokningar" as const,
          icon: MailWarning,
        }
      : null,
    sourceErrors.length > 0
      ? {
          label: `${sourceErrors.length} kalenderkälla${sourceErrors.length === 1 ? "" : "or"} har fel`,
          description: "Synkningen mot en extern kanal behöver kontrolleras.",
          to: "/app/kallor" as const,
          icon: RefreshCw,
        }
      : null,
  ].filter(Boolean) as {
    label: string;
    description: string;
    to: "/app/bokningar" | "/app/kallor";
    icon: typeof AlertTriangle;
  }[];

  const hour = new Date().getHours();
  const greeting = hour < 11 ? "God morgon" : hour < 17 ? "God eftermiddag" : "God kväll";
  const todayLabel = new Date().toLocaleDateString("sv-SE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[26px] bg-[#173c2b] text-white shadow-[0_20px_60px_rgba(16,37,27,0.16)]">
        <div className="relative px-5 py-6 sm:px-7 sm:py-7">
          <div className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full bg-white/[0.06]" />
          <div className="pointer-events-none absolute right-36 top-8 h-24 w-24 rounded-full bg-[#d9b85f]/10 blur-2xl" />
          <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">
                <Sparkles size={13} /> {todayLabel}
              </div>
              <h1 className="mt-3 font-[Fraunces] text-[32px] font-semibold leading-tight text-white sm:text-[38px]">
                {greeting}.
              </h1>
              <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-white/60 sm:text-[14px]">
                Här är läget för <span className="font-semibold text-white/85">{property.name}</span> just nu — bokningar,
                gäster, betalningar och det som faktiskt behöver din uppmärksamhet.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                to="/app/bokningar"
                className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-[12px] font-bold text-[#173c2b] shadow-sm transition hover:-translate-y-0.5"
              >
                <CalendarDays size={15} /> Hantera bokningar
              </Link>
              {property.slug && (
                <a
                  href={`/boka/${property.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.07] px-4 py-2.5 text-[12px] font-semibold text-white/80 transition hover:bg-white/[0.12] hover:text-white"
                >
                  Bokningssidan <ExternalLink size={14} />
                </a>
              )}
              <button
                onClick={load}
                disabled={loading}
                className="grid h-10 w-10 place-items-center rounded-xl border border-white/15 bg-white/[0.07] text-white/70 transition hover:bg-white/[0.12] hover:text-white disabled:opacity-40"
                title="Uppdatera"
              >
                <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
              </button>
            </div>
          </div>
        </div>
      </section>

      {loadError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          Dashboarden kunde inte läsa all data: {loadError}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi icon={Home} label="Beläggning · 30 dagar" value={`${metrics.occupancy} %`} sub={`${units.filter((u) => u.active).length} aktiva boenden`} />
        <Kpi icon={Banknote} label="Betalt · kommande" value={fmtKr(metrics.paidValue)} sub={`Tillval ${fmtKr(metrics.addonRevenue)}`} />
        <Kpi icon={CalendarCheck} label="Ankomster idag" value={String(metrics.arrivals.length)} sub={`${metrics.departures.length} avresor idag`} />
        <Kpi icon={WalletCards} label="Betalningar väntar" value={String(metrics.pendingPayments.length)} sub={metrics.pendingPayments.length ? "Behöver följas upp" : "Allt är avstämt"} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.75fr)]">
        <section className="overflow-hidden rounded-[24px] border border-black/[0.07] bg-white shadow-[0_8px_28px_rgba(25,40,31,0.05)]">
          <div className="flex items-center justify-between border-b border-black/[0.06] px-5 py-4 sm:px-6">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[color:var(--ink)]/35">Nästa på tur</p>
              <h2 className="mt-1 font-[Fraunces] text-[21px] font-semibold">Kommande vistelser</h2>
            </div>
            <Link to="/app/bokningar" className="inline-flex items-center gap-1.5 text-[12px] font-bold text-[#2d684c] hover:underline">
              Visa alla <ArrowRight size={13} />
            </Link>
          </div>
          <div className="divide-y divide-black/[0.055]">
            {loading ? (
              <p className="px-5 py-12 text-center text-[13px] text-[color:var(--ink)]/40">Laddar bokningar…</p>
            ) : metrics.confirmed.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <CalendarCheck className="mx-auto text-[color:var(--ink)]/20" size={28} />
                <p className="mt-3 text-[13px] font-semibold text-[color:var(--ink)]/55">Inga kommande bokningar ännu.</p>
              </div>
            ) : (
              metrics.confirmed.slice(0, 8).map((b) => (
                <div key={b.id} className="group flex items-center gap-3 px-5 py-3.5 transition hover:bg-[#f8f9f6] sm:px-6">
                  <div className="w-[54px] shrink-0 rounded-xl bg-[#eef2ed] px-2 py-2 text-center">
                    <span className="block text-[9px] font-bold uppercase tracking-wider text-[#2d684c]/60">
                      {new Date(b.checkin_date + "T12:00:00").toLocaleDateString("sv-SE", { month: "short" })}
                    </span>
                    <span className="block font-[Fraunces] text-[20px] font-semibold leading-none text-[#173c2b]">
                      {new Date(b.checkin_date + "T12:00:00").getDate()}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-[13px] font-bold sm:text-[14px]">{b.guest_name ?? "Okänd gäst"}</p>
                      {b.payment_status === "pending" && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-bold text-amber-700">Väntar betalning</span>}
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-[color:var(--ink)]/45 sm:text-[12px]">
                      {b.unit?.name ?? "Ingen enhet"} · {svDate(b.checkin_date)}–{svDate(b.checkout_date)} · {b.guests ?? "?"} gäster
                    </p>
                  </div>
                  <div className="hidden text-right sm:block">
                    <p className="text-[11px] font-semibold text-[color:var(--ink)]/55">
                      {b.payment_amount ? fmtKr(b.payment_amount) : b.source === "direct" ? "Direktbokning" : b.source}
                    </p>
                    <p className={`mt-0.5 text-[10px] font-bold ${b.payment_status === "paid" ? "text-emerald-700" : "text-[color:var(--ink)]/35"}`}>
                      {b.payment_status === "paid" ? "Betald" : b.payment_status === "pending" ? "Ej betald" : "Ingen betaldata"}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <div className="space-y-5">
          <section className="rounded-[24px] border border-black/[0.07] bg-white p-5 shadow-[0_8px_28px_rgba(25,40,31,0.05)] sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[color:var(--ink)]/35">Driftläge</p>
                <h2 className="mt-1 font-[Fraunces] text-[21px] font-semibold">Idag</h2>
              </div>
              <span className="rounded-full bg-[#edf3ee] px-2.5 py-1 text-[10px] font-bold text-[#2d684c]">Live</span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <MiniStat icon={Users} label="Ankomster" value={metrics.arrivals.length} />
              <MiniStat icon={CalendarDays} label="Avresor" value={metrics.departures.length} />
            </div>
          </section>

          <section className="rounded-[24px] border border-black/[0.07] bg-white p-5 shadow-[0_8px_28px_rgba(25,40,31,0.05)] sm:p-6">
            <div className="flex items-center gap-2">
              <AlertTriangle size={15} className={alerts.length ? "text-amber-600" : "text-emerald-600"} />
              <h2 className="text-[13px] font-bold">Behöver din uppmärksamhet</h2>
            </div>
            <div className="mt-3 space-y-2">
              {alerts.length === 0 ? (
                <div className="flex items-start gap-3 rounded-2xl bg-emerald-50/70 p-3.5">
                  <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-700" />
                  <div>
                    <p className="text-[12px] font-bold text-emerald-900">Allt ser bra ut</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-emerald-800/65">Inga konflikter, betalningsköer eller integrationsfel just nu.</p>
                  </div>
                </div>
              ) : (
                alerts.map((a) => (
                  <Link key={a.label} to={a.to} className="group flex items-start gap-3 rounded-2xl bg-amber-50/75 p-3.5 transition hover:bg-amber-50">
                    <a.icon size={16} className="mt-0.5 shrink-0 text-amber-700" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-bold text-amber-950">{a.label}</p>
                      <p className="mt-0.5 text-[10px] leading-relaxed text-amber-900/55">{a.description}</p>
                    </div>
                    <ArrowRight size={13} className="mt-1 text-amber-800/30 transition group-hover:translate-x-0.5" />
                  </Link>
                ))
              )}
            </div>
          </section>

          <section className="rounded-[24px] border border-black/[0.07] bg-white p-5 shadow-[0_8px_28px_rgba(25,40,31,0.05)] sm:p-6">
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[color:var(--ink)]/35">Snabbt vidare</p>
            <div className="mt-2 space-y-1">
              <QuickLink to="/app/bokningar" label="Skapa eller hantera bokning" icon={CalendarCheck} />
              <QuickLink to="/app/tillval" label="Optimera tillval" icon={PackagePlus} />
              <QuickLink to="/app/mallar" label="Gästkommunikation" icon={MailWarning} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub }: { icon: typeof Home; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-[20px] border border-black/[0.065] bg-white p-4 shadow-[0_6px_24px_rgba(25,40,31,0.04)] sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-[#eef2ed] text-[#2d684c]">
          <Icon size={15} />
        </span>
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500/70" />
      </div>
      <p className="mt-4 font-[Fraunces] text-[25px] font-semibold leading-none text-[#173c2b] sm:text-[29px]">{value}</p>
      <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.11em] text-[color:var(--ink)]/40">{label}</p>
      <p className="mt-1 text-[10px] text-[color:var(--ink)]/38">{sub}</p>
    </div>
  );
}

function MiniStat({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-[#f4f6f2] p-4">
      <Icon size={15} className="text-[#2d684c]" />
      <p className="mt-3 font-[Fraunces] text-[26px] font-semibold leading-none text-[#173c2b]">{value}</p>
      <p className="mt-1.5 text-[10px] font-semibold text-[color:var(--ink)]/42">{label}</p>
    </div>
  );
}

function QuickLink({
  to,
  label,
  icon: Icon,
}: {
  to: "/app/bokningar" | "/app/tillval" | "/app/mallar";
  label: string;
  icon: typeof CalendarCheck;
}) {
  return (
    <Link to={to} className="group flex items-center gap-3 rounded-xl px-2 py-2.5 text-[12px] font-semibold transition hover:bg-[#f4f6f2]">
      <Icon size={14} className="text-[#2d684c]/70" />
      <span className="flex-1">{label}</span>
      <ArrowRight size={13} className="text-[color:var(--ink)]/25 transition group-hover:translate-x-0.5" />
    </Link>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowUpRight,
  Banknote,
  BedDouble,
  CalendarRange,
  CircleDollarSign,
  Gauge,
  Percent,
  RefreshCw,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase, useProperty, useSession, type Booking } from "@/lib/supabase";

export const Route = createFileRoute("/app/intakter")({
  component: RevenuePage,
});

const DAY = 86400000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const fmtKr = (n: number) => `${Math.round(n).toLocaleString("sv-SE")} kr`;
const fmtPct = (n: number) => `${Math.round(n)} %`;

function nightsBetween(from: string, to: string) {
  return Math.max(0, Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / DAY));
}

function overlapNights(from: string, to: string, windowFrom: string, windowTo: string) {
  const start = from > windowFrom ? from : windowFrom;
  const end = to < windowTo ? to : windowTo;
  return end > start ? nightsBetween(start, end) : 0;
}

function RevenuePage() {
  const session = useSession();
  const { property, units } = useProperty(session);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [windowDays, setWindowDays] = useState<30 | 60 | 90>(30);

  const load = useCallback(async () => {
    if (!supabase || !property) return;
    setLoading(true);
    setError(null);
    const start = new Date();
    start.setDate(start.getDate() - 120);
    const end = new Date();
    end.setDate(end.getDate() + 180);
    const { data, error: loadError } = await supabase
      .from("bookings")
      .select("*, unit:units(name,max_guests)")
      .eq("property_id", property.id)
      .gte("checkout_date", iso(start))
      .lte("checkin_date", iso(end))
      .order("checkin_date");
    if (loadError) setError(loadError.message);
    setBookings((data as Booking[]) ?? []);
    setLoading(false);
  }, [property]);

  useEffect(() => {
    load();
  }, [load]);

  const stats = useMemo(() => {
    const today = iso(new Date());
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + windowDays);
    const windowEnd = iso(endDate);
    const activeUnits = units.filter((u) => u.active);
    const confirmed = bookings.filter((b) => b.status === "confirmed");
    const relevant = confirmed.filter((b) => b.checkout_date > today && b.checkin_date < windowEnd);
    const occupiedNights = relevant.reduce((sum, b) => sum + overlapNights(b.checkin_date, b.checkout_date, today, windowEnd), 0);
    const capacityNights = Math.max(1, activeUnits.length * windowDays);
    const occupancy = (occupiedNights / capacityNights) * 100;

    const knownRevenueBookings = relevant.filter((b) => (b.payment_amount ?? 0) > 0 && b.payment_status !== "refunded");
    const knownRevenue = knownRevenueBookings.reduce((sum, b) => sum + (b.payment_amount ?? 0), 0);
    const knownNights = knownRevenueBookings.reduce((sum, b) => sum + overlapNights(b.checkin_date, b.checkout_date, today, windowEnd), 0);
    const adr = knownNights > 0 ? knownRevenue / knownNights : 0;
    const revpar = knownRevenue / capacityNights;
    const addonRevenue = knownRevenueBookings.reduce((sum, b) => sum + (b.addons_total ?? 0), 0);
    const direct = relevant.filter((b) => b.source === "direct").length;
    const directShare = relevant.length ? (direct / relevant.length) * 100 : 0;
    const avgStay = relevant.length
      ? relevant.reduce((sum, b) => sum + nightsBetween(b.checkin_date, b.checkout_date), 0) / relevant.length
      : 0;
    const pending = relevant.filter((b) => b.payment_status === "pending");
    const pendingValue = pending.reduce((sum, b) => sum + (b.payment_amount ?? 0), 0);

    const daily = Array.from({ length: windowDays }, (_, index) => {
      const d = new Date();
      d.setDate(d.getDate() + index);
      const day = iso(d);
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      const nextDay = iso(next);
      const dayBookings = relevant.filter((b) => b.checkin_date < nextDay && b.checkout_date > day);
      const occupied = dayBookings.length;
      const revenue = dayBookings.reduce((sum, b) => {
        if (!b.payment_amount || b.payment_status === "refunded") return sum;
        const totalNights = Math.max(1, nightsBetween(b.checkin_date, b.checkout_date));
        return sum + b.payment_amount / totalNights;
      }, 0);
      return {
        date: d.toLocaleDateString("sv-SE", { day: "numeric", month: "short" }),
        occupancy: activeUnits.length ? Math.min(100, (occupied / activeUnits.length) * 100) : 0,
        revenue,
      };
    });

    const bySource = ["direct", "sirvoy", "ical", "manual"].map((source) => ({
      source,
      count: relevant.filter((b) => b.source === source).length,
    }));

    return {
      relevant,
      occupancy,
      knownRevenue,
      adr,
      revpar,
      addonRevenue,
      directShare,
      avgStay,
      pendingValue,
      daily,
      bySource,
      activeUnits: activeUnits.length,
    };
  }, [bookings, units, windowDays]);

  if (!property) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#2d684c]">
            <Sparkles size={13} /> Revenue intelligence
          </div>
          <h1 className="mt-2 font-[Fraunces] text-[34px] font-semibold leading-tight">Intäkter & efterfrågan</h1>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-[color:var(--ink)]/50">
            Se vad som faktiskt driver bokningsvärde, beläggning och direktförsäljning för {property.name}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl border border-black/[0.07] bg-white p-1">
            {([30, 60, 90] as const).map((days) => (
              <button
                key={days}
                onClick={() => setWindowDays(days)}
                className={`rounded-lg px-3 py-2 text-[11px] font-bold transition ${windowDays === days ? "bg-[#173c2b] text-white" : "text-[color:var(--ink)]/45 hover:bg-[#f3f5f2]"}`}
              >
                {days} dagar
              </button>
            ))}
          </div>
          <button onClick={load} disabled={loading} className="grid h-10 w-10 place-items-center rounded-xl border border-black/[0.07] bg-white text-[color:var(--ink)]/50 hover:text-[color:var(--ink)] disabled:opacity-40" title="Uppdatera">
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">Kunde inte läsa all bokningsdata: {error}</div> : null}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Metric icon={Percent} label={`Beläggning · ${windowDays} d`} value={fmtPct(stats.occupancy)} sub={`${stats.activeUnits} aktiva boenden`} />
        <Metric icon={Banknote} label="Känd bokningsintäkt" value={fmtKr(stats.knownRevenue)} sub="Exkl. bokningar utan registrerat belopp" />
        <Metric icon={Gauge} label="Känd ADR" value={fmtKr(stats.adr)} sub="Intäkt per bokad natt med känt belopp" />
        <Metric icon={TrendingUp} label="Känd RevPAR" value={fmtKr(stats.revpar)} sub="Känd intäkt / tillgängliga nätter" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,.7fr)]">
        <section className="rounded-[24px] border border-black/[0.07] bg-white p-5 shadow-[0_8px_28px_rgba(25,40,31,0.05)] sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[color:var(--ink)]/35">Framåtblick</p>
              <h2 className="mt-1 font-[Fraunces] text-[22px] font-semibold">Beläggning kommande {windowDays} dagar</h2>
            </div>
            <span className="rounded-full bg-[#edf3ef] px-3 py-1.5 text-[10px] font-bold text-[#2d684c]">{stats.relevant.length} bokningar</span>
          </div>
          <div className="mt-6 h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.daily} margin={{ top: 5, right: 5, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="occ" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#2d684c" stopOpacity={0.25} /><stop offset="95%" stopColor="#2d684c" stopOpacity={0.02} /></linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="rgba(20,40,30,.07)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#7a817c" }} tickLine={false} axisLine={false} minTickGap={30} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "#7a817c" }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
                <Tooltip formatter={(value: number) => [`${Math.round(value)} %`, "Beläggning"]} contentStyle={{ borderRadius: 14, border: "1px solid rgba(20,40,30,.1)", fontSize: 12 }} />
                <Area type="monotone" dataKey="occupancy" stroke="#2d684c" strokeWidth={2.2} fill="url(#occ)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="rounded-[24px] border border-black/[0.07] bg-[#173c2b] p-5 text-white shadow-[0_12px_35px_rgba(16,37,27,0.12)] sm:p-6">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/35">Revenue pulse</p>
          <h2 className="mt-1 font-[Fraunces] text-[22px] font-semibold text-white">Vad sticker ut?</h2>
          <div className="mt-5 space-y-3">
            <Pulse icon={ArrowUpRight} label="Direktbokningsandel" value={fmtPct(stats.directShare)} hint="Högre andel ger mer kontroll över kundresan." />
            <Pulse icon={CircleDollarSign} label="Tillvalsintäkt" value={fmtKr(stats.addonRevenue)} hint="Upsell på bokningar med registrerat belopp." />
            <Pulse icon={CalendarRange} label="Genomsnittlig vistelse" value={`${stats.avgStay.toFixed(1).replace(".0", "")} nätter`} hint="Påverkar både drift och lönsamhet." />
            <Pulse icon={Banknote} label="Väntande betalningar" value={fmtKr(stats.pendingValue)} hint="Pengar som ännu inte är avstämda." />
          </div>
        </section>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-[24px] border border-black/[0.07] bg-white p-5 sm:p-6">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[color:var(--ink)]/35">Kanalbild</p>
          <h2 className="mt-1 font-[Fraunces] text-[21px] font-semibold">Var kommer bokningarna ifrån?</h2>
          <div className="mt-5 space-y-3">
            {stats.bySource.map((row) => {
              const share = stats.relevant.length ? (row.count / stats.relevant.length) * 100 : 0;
              const label = row.source === "direct" ? "Direkt" : row.source === "sirvoy" ? "Sirvoy" : row.source === "ical" ? "iCal / kanal" : "Manuell";
              return (
                <div key={row.source}>
                  <div className="flex items-center justify-between text-[12px]"><span className="font-semibold">{label}</span><span className="font-bold">{row.count} · {fmtPct(share)}</span></div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#edf0eb]"><div className="h-full rounded-full bg-[#2d684c]" style={{ width: `${Math.max(0, Math.min(100, share))}%` }} /></div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-[24px] border border-black/[0.07] bg-white p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#edf3ef] text-[#2d684c]"><BedDouble size={18} /></span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[color:var(--ink)]/35">Datakvalitet</p>
              <h2 className="mt-1 font-[Fraunces] text-[21px] font-semibold">En viktig sak om siffrorna</h2>
            </div>
          </div>
          <p className="mt-4 text-[12px] leading-relaxed text-[color:var(--ink)]/55">
            Beläggningen räknas på alla bekräftade bokningar. ADR, RevPAR och intäkt bygger däremot bara på bokningar där ett belopp finns registrerat i StayBoost. Externa bokningar utan belopp gör därför intäktssiffrorna försiktiga — aldrig konstgjort höga.
          </p>
        </section>
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value, sub }: { icon: typeof Percent; label: string; value: string; sub: string }) {
  return <div className="rounded-[22px] border border-black/[0.07] bg-white p-4 shadow-[0_5px_18px_rgba(25,40,31,0.035)] sm:p-5"><div className="flex items-center gap-2 text-[color:var(--ink)]/38"><Icon size={15} /><span className="text-[9px] font-bold uppercase tracking-[0.14em]">{label}</span></div><p className="mt-3 font-[Fraunces] text-[25px] font-semibold leading-none sm:text-[29px]">{value}</p><p className="mt-2 text-[10px] leading-relaxed text-[color:var(--ink)]/38">{sub}</p></div>;
}

function Pulse({ icon: Icon, label, value, hint }: { icon: typeof ArrowUpRight; label: string; value: string; hint: string }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4"><div className="flex items-center gap-2 text-white/45"><Icon size={14} /><span className="text-[10px] font-bold uppercase tracking-[0.12em]">{label}</span></div><p className="mt-2 font-[Fraunces] text-[24px] font-semibold text-white">{value}</p><p className="mt-1 text-[10px] leading-relaxed text-white/40">{hint}</p></div>;
}

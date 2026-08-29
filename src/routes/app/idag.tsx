import { Link, createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  CalendarCheck,
  CheckCircle2,
  Clock3,
  DoorOpen,
  Mail,
  Phone,
  RefreshCw,
  Sparkles,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { guestPageUrl, supabase, useProperty, useSession, type Booking } from "@/lib/supabase";

export const Route = createFileRoute("/app/idag")({
  component: TodayPage,
});

type OpsBooking = Booking & {
  unit?: {
    name: string;
    max_guests?: number;
    door_code?: string | null;
    checkin_instructions?: string | null;
  } | null;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const fmtKr = (n: number) => `${Math.round(n).toLocaleString("sv-SE")} kr`;
const dateLabel = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString("sv-SE", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

function TodayPage() {
  const session = useSession();
  const { property } = useProperty(session);
  const [bookings, setBookings] = useState<OpsBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !property) return;
    setLoading(true);
    setError(null);
    const start = new Date();
    start.setDate(start.getDate() - 1);
    const end = new Date();
    end.setDate(end.getDate() + 3);
    const { data, error: loadError } = await supabase
      .from("bookings")
      .select("*, unit:units(name,max_guests,door_code,checkin_instructions)")
      .eq("property_id", property.id)
      .eq("status", "confirmed")
      .gte("checkout_date", iso(start))
      .lte("checkin_date", iso(end))
      .order("checkin_date");
    if (loadError) setError(loadError.message);
    setBookings((data as OpsBooking[]) ?? []);
    setLoading(false);
  }, [property]);

  useEffect(() => {
    load();
  }, [load]);

  const board = useMemo(() => {
    const today = iso(new Date());
    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrow = iso(tomorrowDate);
    const arrivals = bookings.filter((b) => b.checkin_date === today);
    const departures = bookings.filter((b) => b.checkout_date === today);
    const tomorrowArrivals = bookings.filter((b) => b.checkin_date === tomorrow);
    const inHouse = bookings.filter((b) => b.checkin_date <= today && b.checkout_date > today);
    const attention = bookings.filter(
      (b) =>
        (b.checkin_date === today || b.checkin_date === tomorrow) &&
        (b.payment_status === "pending" || !b.guest_email || !b.guest_phone),
    );
    const pendingValue = attention
      .filter((b) => b.payment_status === "pending")
      .reduce((sum, b) => sum + (b.payment_amount ?? 0), 0);
    return {
      today,
      tomorrow,
      arrivals,
      departures,
      tomorrowArrivals,
      inHouse,
      attention,
      pendingValue,
    };
  }, [bookings]);

  if (!property) return null;

  const todayLong = new Date().toLocaleDateString("sv-SE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#2d684c]">
            <Sparkles size={13} /> Operations board
          </div>
          <h1 className="mt-2 font-[Fraunces] text-[34px] font-semibold leading-tight">Idag</h1>
          <p className="mt-1 text-[13px] capitalize text-[color:var(--ink)]/45">
            {todayLong} · {property.name}
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 self-start rounded-xl border border-black/[0.07] bg-white px-4 py-2.5 text-[11px] font-bold text-[color:var(--ink)]/55 hover:text-[color:var(--ink)] disabled:opacity-40"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Uppdatera
        </button>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          Kunde inte läsa driftläget: {error}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat
          icon={CalendarCheck}
          label="Ankomster idag"
          value={board.arrivals.length}
          sub={`${board.tomorrowArrivals.length} imorgon`}
        />
        <Stat
          icon={DoorOpen}
          label="Avresor idag"
          value={board.departures.length}
          sub="Att vända efter utcheckning"
        />
        <Stat
          icon={Users}
          label="Gäster på plats"
          value={board.inHouse.length}
          sub="Aktiva vistelser idag"
        />
        <Stat
          icon={AlertTriangle}
          label="Kräver koll"
          value={board.attention.length}
          sub={board.pendingValue ? `${fmtKr(board.pendingValue)} väntar` : "Kontakt/betalning"}
          attention={board.attention.length > 0}
        />
      </div>

      {board.attention.length > 0 ? (
        <section className="rounded-[24px] border border-amber-200 bg-amber-50 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-amber-700/60">
                Prioriterat
              </p>
              <h2 className="mt-1 font-[Fraunces] text-[21px] font-semibold text-amber-950">
                Det här bör lösas först
              </h2>
            </div>
            <span className="rounded-full bg-white/70 px-3 py-1 text-[10px] font-bold text-amber-800">
              {board.attention.length} saker
            </span>
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-2">
            {board.attention.map((b) => (
              <Link
                key={b.id}
                to="/app/bokningar"
                className="rounded-2xl border border-amber-200 bg-white/75 p-4 transition hover:bg-white"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[13px] font-bold">{b.guest_name ?? "Okänd gäst"}</p>
                  <span className="text-[10px] font-bold text-amber-700">
                    {dateLabel(b.checkin_date)}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-amber-950/55">
                  {b.unit?.name ?? "Ingen enhet"}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {b.payment_status === "pending" ? (
                    <Tag
                      text={`Betalning ${b.payment_amount ? fmtKr(b.payment_amount) : "väntar"}`}
                    />
                  ) : null}
                  {!b.guest_email ? <Tag text="Saknar e-post" /> : null}
                  {!b.guest_phone ? <Tag text="Saknar mobil" /> : null}
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3.5 text-[12px] font-semibold text-emerald-900">
          <CheckCircle2 size={17} /> Inga betalnings- eller kontaktproblem för dagens och
          morgondagens ankomster.
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        <StayList
          title="Ankommer idag"
          subtitle="Gäster som ska checka in"
          bookings={board.arrivals}
          empty="Inga ankomster idag."
        />
        <StayList
          title="Åker idag"
          subtitle="Utcheckningar och vändningar"
          bookings={board.departures}
          empty="Inga avresor idag."
          departure
        />
      </div>

      <section className="overflow-hidden rounded-[24px] border border-black/[0.07] bg-white shadow-[0_8px_28px_rgba(25,40,31,0.04)]">
        <div className="flex items-center justify-between border-b border-black/[0.06] px-5 py-4 sm:px-6">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[color:var(--ink)]/35">
              Förbered
            </p>
            <h2 className="mt-1 font-[Fraunces] text-[20px] font-semibold">
              Morgondagens ankomster
            </h2>
          </div>
          <span className="text-[11px] font-bold text-[color:var(--ink)]/40">
            {board.tomorrowArrivals.length} gäster
          </span>
        </div>
        <div className="divide-y divide-black/[0.055]">
          {board.tomorrowArrivals.length ? (
            board.tomorrowArrivals.map((b) => <BookingRow key={b.id} booking={b} />)
          ) : (
            <Empty text="Inga ankomster imorgon." />
          )}
        </div>
      </section>
    </div>
  );
}

function StayList({
  title,
  subtitle,
  bookings,
  empty,
  departure = false,
}: {
  title: string;
  subtitle: string;
  bookings: OpsBooking[];
  empty: string;
  departure?: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-[24px] border border-black/[0.07] bg-white shadow-[0_8px_28px_rgba(25,40,31,0.04)]">
      <div className="border-b border-black/[0.06] px-5 py-4 sm:px-6">
        <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[color:var(--ink)]/35">
          {subtitle}
        </p>
        <h2 className="mt-1 font-[Fraunces] text-[20px] font-semibold">{title}</h2>
      </div>
      <div className="divide-y divide-black/[0.055]">
        {bookings.length ? (
          bookings.map((b) => <BookingRow key={b.id} booking={b} departure={departure} />)
        ) : (
          <Empty text={empty} />
        )}
      </div>
    </section>
  );
}

function BookingRow({
  booking: b,
  departure = false,
}: {
  booking: OpsBooking;
  departure?: boolean;
}) {
  return (
    <div className="px-5 py-4 sm:px-6">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#edf3ef] text-[#2d684c]">
          <Users size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[13px] font-bold">{b.guest_name ?? "Okänd gäst"}</p>
            {b.payment_status === "pending" ? (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-bold text-amber-700">
                Betalning väntar
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-[11px] text-[color:var(--ink)]/45">
            {b.unit?.name ?? "Ingen enhet"} · {b.guests ?? "?"} gäster ·{" "}
            {departure ? `ut ${dateLabel(b.checkout_date)}` : `in ${dateLabel(b.checkin_date)}`}
          </p>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-semibold text-[color:var(--ink)]/40">
            {b.guest_phone ? (
              <span className="inline-flex items-center gap-1">
                <Phone size={11} /> {b.guest_phone}
              </span>
            ) : null}
            {b.guest_email ? (
              <span className="inline-flex items-center gap-1">
                <Mail size={11} /> {b.guest_email}
              </span>
            ) : null}
            {!departure && b.unit?.door_code ? (
              <span className="inline-flex items-center gap-1">
                <DoorOpen size={11} /> Kod finns
              </span>
            ) : null}
          </div>
        </div>
        <a
          href={guestPageUrl(b.guest_token)}
          target="_blank"
          rel="noreferrer"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-black/[0.07] text-[color:var(--ink)]/35 hover:text-[#2d684c]"
          title="Öppna gästsidan"
        >
          <ArrowRight size={14} />
        </a>
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  sub,
  attention = false,
}: {
  icon: typeof CalendarCheck;
  label: string;
  value: number;
  sub: string;
  attention?: boolean;
}) {
  return (
    <div
      className={`rounded-[22px] border p-4 sm:p-5 ${attention ? "border-amber-200 bg-amber-50" : "border-black/[0.07] bg-white"}`}
    >
      <div
        className={`flex items-center gap-2 ${attention ? "text-amber-700" : "text-[color:var(--ink)]/38"}`}
      >
        <Icon size={15} />
        <span className="text-[9px] font-bold uppercase tracking-[0.14em]">{label}</span>
      </div>
      <p className="mt-3 font-[Fraunces] text-[28px] font-semibold leading-none">{value}</p>
      <p className="mt-2 text-[10px] text-[color:var(--ink)]/38">{sub}</p>
    </div>
  );
}

function Tag({ text }: { text: string }) {
  return (
    <span className="rounded-full bg-amber-100 px-2 py-1 text-[9px] font-bold text-amber-800">
      {text}
    </span>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="px-5 py-10 text-center">
      <Clock3 className="mx-auto text-[color:var(--ink)]/15" size={23} />
      <p className="mt-2 text-[12px] font-medium text-[color:var(--ink)]/35">{text}</p>
    </div>
  );
}

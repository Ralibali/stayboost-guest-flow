import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import {
  Banknote,
  BedDouble,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Globe,
  Percent,
  Plus,
  Sparkles,
  TrendingUp,
  X,
} from "lucide-react";
import { fmtDate, fmtKr, unitOf } from "@/lib/demo-data";
import {
  BOOKING_UNITS,
  addDays,
  addSessionBooking,
  allBookings,
  dateKey,
  isNightBooked,
  occupancyPct,
  rangeTotal,
  startOfDay,
  type Booking,
} from "@/lib/booking-data";

export const Route = createFileRoute("/demo/bokningar")({
  component: BookingAdmin,
});

const DAYS = 14;

function BookingAdmin() {
  const today = startOfDay(new Date());
  const [offset, setOffset] = useState(0);
  const [version, setVersion] = useState(0); // ökar när manuell bokning läggs till
  const [modalOpen, setModalOpen] = useState(false);
  const startDay = addDays(today, offset);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const bookings = useMemo(() => allBookings(), [version]);

  const kpis = useMemo(() => {
    const upcoming = bookings.filter((b) => +addDays(b.start, b.nights) >= +today);
    const revenue30 = upcoming
      .filter((b) => +b.start < +addDays(today, 30))
      .reduce((s, b) => s + b.total, 0);
    const newWeek = bookings.filter((b) => b.createdDaysAgo <= 6).length;
    const adr = Math.round(
      revenue30 /
        Math.max(
          1,
          upcoming.reduce((s, b) => s + b.nights, 0),
        ),
    );
    return { revenue30, newWeek, adr, occupancy: occupancyPct(DAYS) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const days = Array.from({ length: DAYS }, (_, i) => addDays(startDay, i));

  /** Bokning som täcker en viss natt för en enhet. */
  const bookingAt = (unitId: string, date: Date): Booking | null => {
    const key = dateKey(date);
    return (
      bookings.find((b) => {
        if (b.unitId !== unitId) return false;
        for (let n = 0; n < b.nights; n++) {
          if (dateKey(addDays(b.start, n)) === key) return true;
        }
        return false;
      }) ?? null
    );
  };

  const listBookings = useMemo(
    () =>
      [...bookings]
        .filter((b) => +addDays(b.start, b.nights) >= +today)
        .sort((a, b) => +a.start - +b.start)
        .slice(0, 12),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version],
  );

  return (
    <div>
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Bokningsadmin</p>
            <h1 className="mt-2 text-3xl">Kalender & bokningar</h1>
            <p className="mt-1 text-[14px] text-[color:var(--ink)]/60">
              Synkas mot Sirvoy och Booking.com — direktbokningar från er egen motor är alltid
              provisionsfria.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={() => setModalOpen(true)}
              className="flex items-center gap-2 rounded-full bg-[color:var(--brass)] px-4 py-2 text-[13px] font-semibold text-white transition hover:brightness-105"
            >
              <Plus size={15} strokeWidth={2.5} />
              Ny bokning
            </button>
            <span className="flex items-center gap-2 rounded-full bg-[color:var(--forest)] px-4 py-2 text-[13px] font-semibold text-white">
              <Globe size={15} />
              Kanalhanterare aktiv
            </span>
          </div>
        </div>
      </motion.div>

      {/* KPI:er */}
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          icon={Banknote}
          label="Bokat värde · 30 dgr"
          value={fmtKr(kpis.revenue30)}
          sub="Alla kanaler"
          accent
        />
        <Kpi
          icon={Percent}
          label={`Beläggning · ${DAYS} dgr`}
          value={`${kpis.occupancy} %`}
          sub="Helgerna fylls först"
        />
        <Kpi icon={TrendingUp} label="Snittpris per natt" value={fmtKr(kpis.adr)} sub="ADR" />
        <Kpi
          icon={CalendarDays}
          label="Nya bokningar · 7 dgr"
          value={String(kpis.newWeek)}
          sub="Varav 0 avbokade"
        />
      </div>

      {/* Beläggningskalender */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="card-surface mt-6 p-5 sm:p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-sans text-[17px] font-bold">Beläggningskalender</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setOffset((o) => o - DAYS)}
              className="grid h-8 w-8 place-items-center rounded-full border border-[color:var(--line)] transition hover:bg-[color:var(--bg)]"
              aria-label="Tidigare period"
            >
              <ChevronLeft size={15} />
            </button>
            <button
              onClick={() => setOffset(0)}
              className="rounded-full border border-[color:var(--line)] px-3 py-1.5 text-[12px] font-semibold transition hover:bg-[color:var(--bg)]"
            >
              I dag
            </button>
            <button
              onClick={() => setOffset((o) => o + DAYS)}
              className="grid h-8 w-8 place-items-center rounded-full border border-[color:var(--line)] transition hover:bg-[color:var(--bg)]"
              aria-label="Senare period"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <div className="min-w-[860px]">
            {/* Dagar */}
            <div className="grid grid-cols-[150px_repeat(14,1fr)] gap-1">
              <div />
              {days.map((d) => {
                const isToday = dateKey(d) === dateKey(today);
                return (
                  <div
                    key={dateKey(d)}
                    className={`rounded-lg py-1.5 text-center ${isToday ? "bg-[color:var(--brass)] text-white" : ""}`}
                  >
                    <div
                      className={`text-[10px] font-semibold uppercase ${isToday ? "text-white/85" : "text-[color:var(--ink)]/45"}`}
                    >
                      {d.toLocaleDateString("sv-SE", { weekday: "short" })}
                    </div>
                    <div className={`text-[13px] font-bold ${isToday ? "" : ""}`}>
                      {d.getDate()}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Enheter */}
            <div className="mt-1 space-y-1">
              {BOOKING_UNITS.map((u) => (
                <div
                  key={u.id}
                  className="grid grid-cols-[150px_repeat(14,1fr)] items-center gap-1"
                >
                  <div className="flex items-center gap-2 pr-2">
                    <span className="text-lg">{u.imageEmoji}</span>
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-bold">{u.name}</div>
                      <div className="text-[11px] text-[color:var(--ink)]/50">
                        {u.capacity} bäddar
                      </div>
                    </div>
                  </div>
                  {days.map((d) => {
                    const b = bookingAt(u.id, d);
                    const isStart = b && dateKey(b.start) === dateKey(d);
                    const isPast = d < today;
                    return (
                      <div
                        key={dateKey(d)}
                        title={
                          b
                            ? `${b.guestName} · ${b.nights} ${b.nights === 1 ? "natt" : "nätter"} · ${b.source} · ${fmtKr(b.total)}`
                            : "Ledig"
                        }
                        className={`flex h-10 items-center overflow-hidden px-1.5 ${
                          b
                            ? b.isNew
                              ? "bg-[color:var(--brass)] text-white"
                              : b.source === "Direkt"
                                ? "bg-[color:var(--forest)] text-white"
                                : "bg-[#5b7fa6] text-white"
                            : isPast
                              ? "bg-[color:var(--line)]/30"
                              : "bg-[color:var(--bg)]"
                        } ${isStart ? "rounded-l-lg" : ""} ${
                          b && !isNightBooked(u.id, addDays(d, 1)) ? "rounded-r-lg" : ""
                        } ${b ? "" : "rounded-lg"}`}
                      >
                        {isStart && (
                          <span className="truncate text-[10px] font-semibold leading-tight">
                            {b.isNew ? `★ ${b.guestName.split(" ")[0]}` : b.guestName.split(" ")[0]}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Legend */}
            <div className="mt-4 flex flex-wrap gap-4 text-[12px] text-[color:var(--ink)]/60">
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded bg-[color:var(--forest)]" /> Direktbokning
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded bg-[#5b7fa6]" /> Booking.com / Sirvoy
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded bg-[color:var(--brass)]" /> Ny i detta demo
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded bg-[color:var(--bg)] ring-1 ring-[color:var(--line)]" />{" "}
                Ledig
              </span>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Bokningslista */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="card-surface mt-5 p-5 sm:p-6"
      >
        <h2 className="font-sans text-[17px] font-bold">Kommande bokningar</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-[14px]">
            <thead>
              <tr className="border-b border-[color:var(--line)] text-left text-[12px] font-semibold uppercase tracking-wide text-[color:var(--ink)]/50">
                <th className="pb-3 pr-4">Gäst</th>
                <th className="pb-3 pr-4">Enhet</th>
                <th className="pb-3 pr-4">Datum</th>
                <th className="pb-3 pr-4">Källa</th>
                <th className="pb-3 pr-4">Status</th>
                <th className="pb-3 text-right">Belopp</th>
              </tr>
            </thead>
            <tbody>
              {listBookings.map((b) => (
                <tr
                  key={b.id + b.unitId + dateKey(b.start)}
                  className={`border-b border-[color:var(--line)]/60 last:border-0 ${b.isNew ? "bg-amber-50/60" : ""}`}
                >
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-2.5">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[color:var(--forest)]/10 text-[11px] font-bold text-[color:var(--forest)]">
                        {b.guestName
                          .split(" ")
                          .map((n) => n[0])
                          .slice(0, 2)
                          .join("")}
                      </span>
                      <div>
                        <div className="font-semibold">
                          {b.guestName}
                          {b.isNew && (
                            <span className="ml-2 rounded-full bg-[color:var(--brass)] px-2 py-0.5 text-[10px] font-bold text-white">
                              NY
                            </span>
                          )}
                        </div>
                        <div className="text-[12px] text-[color:var(--ink)]/50">{b.id}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 pr-4">
                    <span className="flex items-center gap-1.5">
                      <BedDouble size={14} className="text-[color:var(--ink)]/40" />
                      {unitOf(b.unitId).name}
                    </span>
                  </td>
                  <td className="py-3 pr-4 tabular-nums">
                    {fmtDate(b.start)} · {b.nights} {b.nights === 1 ? "natt" : "nätter"}
                  </td>
                  <td className="py-3 pr-4">
                    <span
                      className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${
                        b.source === "Direkt"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-blue-50 text-blue-700"
                      }`}
                    >
                      {b.source}
                    </span>
                  </td>
                  <td className="py-3 pr-4">
                    <span
                      className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${
                        b.status === "Betald"
                          ? "bg-[color:var(--bg)] text-[color:var(--ink)]/70"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {b.status}
                    </span>
                  </td>
                  <td className="py-3 text-right font-semibold tabular-nums">{fmtKr(b.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 flex items-center gap-1.5 text-[13px] text-[color:var(--ink)]/55">
          <Sparkles size={14} className="text-[color:var(--brass)]" />
          Direktbokningar sparar ~15 % provision per bokning jämfört med OTA-kanalerna.
        </p>
      </motion.div>

      {/* Modal: manuell bokning */}
      <ManualBookingModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={() => {
          setVersion((v) => v + 1);
          setModalOpen(false);
        }}
      />
    </div>
  );
}

function ManualBookingModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const today = startOfDay(new Date());
  const [unitId, setUnitId] = useState(BOOKING_UNITS[0].id);
  const [start, setStart] = useState(dateKey(today));
  const [nights, setNights] = useState(2);
  const [name, setName] = useState("");
  const [source, setSource] = useState<"Telefon" | "Direkt" | "Walk-in">("Telefon");

  if (!open) return null;

  const unit = BOOKING_UNITS.find((u) => u.id === unitId)!;
  const startDate = new Date(start + "T12:00:00");
  const total = rangeTotal(unit, startDate, nights) + 295;
  const valid = name.trim().length > 1 && start >= dateKey(today);

  const create = () => {
    addSessionBooking({
      id: `SB-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      unitId,
      guestName: name,
      start: startDate,
      nights,
      source: "Direkt",
      status: "Delbetald",
      total,
      createdDaysAgo: 0,
      isNew: true,
    });
    onCreated();
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-50 bg-black/45"
      />
      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-[24px] bg-white p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-sans text-lg font-bold">Ny bokning manuellt</h3>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full hover:bg-[color:var(--bg)]"
            aria-label="Stäng"
          >
            <X size={17} />
          </button>
        </div>
        <p className="mt-1 text-[13px] text-[color:var(--ink)]/55">
          För telefonbokningar och walk-ins — hamnar direkt i kalendern.
        </p>

        <div className="mt-5 space-y-4">
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-[color:var(--ink)]/70">
              Gästens namn
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Karin Svensson"
              className="w-full rounded-xl border border-[color:var(--line)] bg-[color:var(--bg)] px-4 py-2.5 text-[14px] outline-none focus:border-[color:var(--brass)]"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-[13px] font-semibold text-[color:var(--ink)]/70">
                Enhet
              </label>
              <select
                value={unitId}
                onChange={(e) => setUnitId(e.target.value)}
                className="w-full rounded-xl border border-[color:var(--line)] bg-[color:var(--bg)] px-3 py-2.5 text-[14px] outline-none"
              >
                {BOOKING_UNITS.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-[13px] font-semibold text-[color:var(--ink)]/70">
                Källa
              </label>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value as typeof source)}
                className="w-full rounded-xl border border-[color:var(--line)] bg-[color:var(--bg)] px-3 py-2.5 text-[14px] outline-none"
              >
                <option>Telefon</option>
                <option>Direkt</option>
                <option>Walk-in</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-[13px] font-semibold text-[color:var(--ink)]/70">
                Ankomst
              </label>
              <input
                type="date"
                value={start}
                min={dateKey(today)}
                onChange={(e) => setStart(e.target.value)}
                className="w-full rounded-xl border border-[color:var(--line)] bg-[color:var(--bg)] px-3 py-2.5 text-[14px] outline-none"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[13px] font-semibold text-[color:var(--ink)]/70">
                Nätter
              </label>
              <input
                type="number"
                min={1}
                max={14}
                value={nights}
                onChange={(e) => setNights(Math.max(1, Number(e.target.value)))}
                className="w-full rounded-xl border border-[color:var(--line)] bg-[color:var(--bg)] px-3 py-2.5 text-[14px] outline-none"
              />
            </div>
          </div>
          <div className="flex items-baseline justify-between rounded-xl bg-[color:var(--bg)] px-4 py-3 text-[14px]">
            <span>Uppskattat värde</span>
            <span className="font-semibold tabular-nums">{fmtKr(total)}</span>
          </div>
          <button
            onClick={create}
            disabled={!valid}
            className="btn-primary w-full !rounded-xl !py-3 text-[15px] disabled:opacity-40"
          >
            <Plus size={16} /> Skapa bokning
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: typeof Banknote;
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className={`card-surface p-5 ${accent ? "!border-[color:var(--brass)]/50 !bg-gradient-to-br !from-white !to-amber-50/60" : ""}`}
    >
      <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-[color:var(--ink)]/55">
        <Icon size={14} className="text-[color:var(--brass)]" />
        {label}
      </div>
      <div className="mt-2 font-[Fraunces] text-[26px] font-semibold leading-none tabular-nums">
        {value}
      </div>
      <div className="mt-1.5 text-[12px] text-[color:var(--ink)]/55">{sub}</div>
    </motion.div>
  );
}

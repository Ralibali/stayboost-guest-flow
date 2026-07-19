import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import {
  ArrowDownLeft,
  ArrowUpRight,
  BedDouble,
  Bike,
  Check,
  ClipboardList,
  Croissant,
  Sailboat,
  Sparkles,
} from "lucide-react";
import { ADDONS, GUESTS, PROPERTY, fmtDateLong, unitOf } from "@/lib/demo-data";
import { RESOURCES, addDays, resourceBooked, startOfDay } from "@/lib/booking-data";
import { getAssignee } from "@/lib/staff-data";

export const Route = createFileRoute("/demo/dagsoversikt")({
  component: Manifest,
});

const SAUNA_SLOTS = ["16:00", "17:30", "19:00", "20:30"];
const SAUNA_BOOKED: Record<string, string> = {
  "17:30": "Familj Schneider",
  "19:00": "Anna Lindqvist",
};

function Manifest() {
  const today = startOfDay(new Date());
  const [dayOffset, setDayOffset] = useState(0);
  const day = addDays(today, dayOffset);

  const arrivals = useMemo(
    () => GUESTS.filter((g) => +startOfDay(g.checkIn) === +day),
    [dayOffset], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const departures = useMemo(
    () => GUESTS.filter((g) => +startOfDay(g.checkOut) === +day),
    [dayOffset], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const staying = useMemo(
    () => GUESTS.filter((g) => +startOfDay(g.checkIn) < +day && +startOfDay(g.checkOut) > +day),
    [dayOffset], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Att förbereda: tillval kopplade till dagens ankomster (deterministiskt)
  const prepItems = useMemo(() => {
    const items: { addon: (typeof ADDONS)[number]; qty: number; forGuest: string; unit: string }[] =
      [];
    arrivals.forEach((g, i) => {
      const unit = unitOf(g.unitId);
      if (i % 2 === 0)
        items.push({
          addon: ADDONS.find((a) => a.id === "frukost")!,
          qty: g.guests,
          forGuest: g.name,
          unit: unit.name,
        });
      if (g.guests > 2)
        items.push({
          addon: ADDONS.find((a) => a.id === "ved")!,
          qty: 1,
          forGuest: g.name,
          unit: unit.name,
        });
    });
    return items;
  }, [arrivals]);

  const saunaStatus = SAUNA_SLOTS.map((t) => ({
    time: t,
    bookedBy: dayOffset === 0 ? SAUNA_BOOKED[t] : t === "19:00" ? "Erik & Malin Berg" : undefined,
  }));

  return (
    <div className="mx-auto max-w-4xl">
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Dagens manifest</p>
            <h1 className="mt-2 text-3xl capitalize">{fmtDateLong(day)}</h1>
            <p className="mt-1 text-[14px] text-[color:var(--ink)]/60">
              Allt teamet behöver veta — ankomster, avresor, kapacitet och förberedelser.
            </p>
          </div>
          <div className="flex rounded-full border border-[color:var(--line)] bg-white p-1 text-[13px] font-semibold">
            {["I dag", "I morgon"].map((label, i) => (
              <button
                key={label}
                onClick={() => setDayOffset(i)}
                className={`rounded-full px-4 py-1.5 transition ${
                  dayOffset === i
                    ? "bg-[color:var(--forest)] text-white"
                    : "text-[color:var(--ink)]/60"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Sammanfattning */}
        <div className="mt-6 grid grid-cols-3 gap-3">
          <Summary
            icon={ArrowUpRight}
            value={String(arrivals.length)}
            label="ankomster"
            color="text-emerald-600"
          />
          <Summary
            icon={ArrowDownLeft}
            value={String(departures.length)}
            label="avresor"
            color="text-[color:var(--brass)]"
          />
          <Summary
            icon={BedDouble}
            value={String(staying.length)}
            label="inneboende"
            color="text-[color:var(--forest)]"
          />
        </div>
      </motion.div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        {/* Ankomster */}
        <Section title={`Ankomster (från ${PROPERTY.checkInTime})`} icon={ArrowUpRight}>
          {arrivals.length === 0 && <Empty text="Inga ankomster" />}
          {arrivals.map((g) => (
            <GuestLine
              key={g.id}
              guest={g}
              badge={g.checkedIn ? "Incheckad ✓" : "Väntas"}
              ok={g.checkedIn}
            />
          ))}
        </Section>

        {/* Avresor */}
        <Section title={`Avresor (senast ${PROPERTY.checkOutTime})`} icon={ArrowDownLeft}>
          {departures.length === 0 && <Empty text="Inga avresor" />}
          {departures.map((g) => (
            <GuestLine key={g.id} guest={g} badge="Städ efter" ok={false} />
          ))}
        </Section>
      </div>

      {/* Att förbereda */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="card-surface mt-5 p-6"
      >
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-sans text-[17px] font-bold">
            <ClipboardList size={17} className="text-[color:var(--brass)]" /> Att förbereda till
            ankommande gäster
          </h2>
          <AssigneeChip taskKey="manifest-prep" />
        </div>
        {prepItems.length === 0 ? (
          <p className="mt-3 text-[14px] text-[color:var(--ink)]/55">Inget att förbereda 🎉</p>
        ) : (
          <div className="mt-4 space-y-2.5">
            {prepItems.map((p, i) => (
              <PrepRow key={i} item={p} />
            ))}
          </div>
        )}
      </motion.div>

      {/* Kapacitet i dag */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="card-surface mt-5 p-6"
      >
        <h2 className="flex items-center gap-2 font-sans text-[17px] font-bold">
          <Sparkles size={17} className="text-[color:var(--brass)]" /> Kapacitet —{" "}
          {dayOffset === 0 ? "i dag" : "i morgon"}
        </h2>

        {/* Bastu tider */}
        <div className="mt-5">
          <div className="text-[12px] font-semibold uppercase tracking-wide text-[color:var(--ink)]/50">
            Bastu (1 plats per tid)
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {saunaStatus.map((s) => (
              <div
                key={s.time}
                className={`rounded-xl border p-3 text-center ${
                  s.bookedBy
                    ? "border-[color:var(--forest)]/30 bg-[color:var(--forest)] text-white"
                    : "border-[color:var(--line)] bg-[color:var(--bg)]"
                }`}
              >
                <div className="font-semibold tabular-nums">{s.time}</div>
                <div
                  className={`mt-0.5 truncate text-[11px] ${s.bookedBy ? "text-white/80" : "text-[color:var(--ink)]/50"}`}
                >
                  {s.bookedBy ?? "Ledig"}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Resurser */}
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {RESOURCES.map((r) => {
            const booked = resourceBooked(r.id, day);
            const pct = Math.round((booked / r.total) * 100);
            const Icon = r.id === "cyklar" ? Bike : Sailboat;
            return (
              <div key={r.id} className="rounded-xl border border-[color:var(--line)] p-4">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-[14px] font-semibold">
                    <Icon size={16} className="text-[color:var(--brass)]" /> {r.name}
                  </span>
                  <span className="text-[13px] font-semibold tabular-nums">
                    {booked}/{r.total} bokade
                  </span>
                </div>
                <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-[color:var(--line)]/60">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.5 }}
                    className={`h-full rounded-full ${pct >= 100 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-[color:var(--success)]"}`}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Frukost i morgon */}
        <div className="mt-5 flex items-center gap-3 rounded-xl bg-[color:var(--bg)] p-4">
          <Croissant size={18} className="shrink-0 text-[color:var(--brass)]" />
          <p className="flex-1 text-[13px] text-[color:var(--ink)]/70">
            <strong>Frukostteamet:</strong> se Frukostvyn för morgondagens portioner och allergier —
            den uppdateras automatiskt när gäster beställer.
          </p>
          <AssigneeChip taskKey="frukost" />
        </div>
      </motion.div>
    </div>
  );
}

function PrepRow({
  item,
}: {
  item: { addon: (typeof ADDONS)[number]; qty: number; forGuest: string; unit: string };
}) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => setDone((d) => !d)}
      className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${
        done
          ? "border-emerald-200 bg-emerald-50/60"
          : "border-[color:var(--line)] hover:bg-[color:var(--bg)]/60"
      }`}
    >
      <span className="text-xl">{item.addon.emoji}</span>
      <div className="min-w-0 flex-1">
        <div
          className={`text-[14px] font-semibold ${done ? "text-[color:var(--ink)]/45 line-through" : ""}`}
        >
          {item.addon.name} × {item.qty}
        </div>
        <div className="text-[12px] text-[color:var(--ink)]/55">
          {item.forGuest} · {item.unit}
        </div>
      </div>
      <span
        className={`grid h-6 w-6 place-items-center rounded-full ${
          done ? "bg-emerald-500 text-white" : "border border-[color:var(--line)]"
        }`}
      >
        {done && <Check size={13} strokeWidth={3} />}
      </span>
    </button>
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof ArrowUpRight;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 }}
      className="card-surface p-6"
    >
      <h2 className="flex items-center gap-2 font-sans text-[16px] font-bold">
        <Icon size={17} className="text-[color:var(--brass)]" /> {title}
      </h2>
      <div className="mt-4 space-y-3">{children}</div>
    </motion.div>
  );
}

function GuestLine({
  guest,
  badge,
  ok,
}: {
  guest: (typeof GUESTS)[number];
  badge: string;
  ok: boolean;
}) {
  const unit = unitOf(guest.unitId);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[color:var(--line)] bg-[color:var(--bg)]/60 p-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[color:var(--forest)] text-[12px] font-bold text-white">
        {guest.name
          .split(" ")
          .map((n) => n[0])
          .slice(0, 2)
          .join("")}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold">{guest.name}</div>
        <div className="truncate text-[12px] text-[color:var(--ink)]/55">
          {unit.name} · {guest.guests} gäster
        </div>
      </div>
      <span
        className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
          ok ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
        }`}
      >
        {badge}
      </span>
    </div>
  );
}

function Summary({
  icon: Icon,
  value,
  label,
  color,
}: {
  icon: typeof ArrowUpRight;
  value: string;
  label: string;
  color: string;
}) {
  return (
    <div className="card-surface p-4 text-center">
      <Icon size={18} className={`mx-auto ${color}`} />
      <div className="mt-1.5 font-[Fraunces] text-2xl font-semibold">{value}</div>
      <div className="text-[12px] text-[color:var(--ink)]/55">{label}</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-2 text-[14px] text-[color:var(--ink)]/50">{text}</p>;
}

function AssigneeChip({ taskKey }: { taskKey: string }) {
  const a = getAssignee(taskKey);
  return (
    <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-[color:var(--line)] bg-white py-1 pl-1 pr-2.5 text-[11px] font-semibold">
      <span
        className="grid h-5 w-5 place-items-center rounded-full text-[9px] font-bold text-white"
        style={{ background: a.color }}
      >
        {a.name
          .split(" ")
          .map((n) => n[0])
          .slice(0, 2)
          .join("")}
      </span>
      Ansvarig: {a.name.split(" ")[0]}
    </span>
  );
}

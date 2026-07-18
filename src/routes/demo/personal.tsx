import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import {
  ClipboardList,
  Croissant,
  Phone,
  RefreshCw,
  Sparkles,
  UserCheck,
  Users,
} from "lucide-react";
import { CLEANING, unitOf } from "@/lib/demo-data";
import {
  CLEANING_TASK_KEYS,
  STAFF,
  getAssigneeId,
  setAssignee,
  staffById,
  type StaffMember,
} from "@/lib/staff-data";

export const Route = createFileRoute("/demo/personal")({
  component: StaffView,
});

const WEEKDAYS = ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"];

function StaffView() {
  const [, forceRender] = useState(0);
  const refresh = () => forceRender((n) => n + 1);

  const cleaningStaff = STAFF.filter((s) => s.role === "Städ");

  const loadFor = (staffId: string) =>
    CLEANING_TASK_KEYS.filter((k) => getAssigneeId(k) === staffId).length +
    (staffId === getAssigneeId("frukost") ? 1 : 0);

  return (
    <div className="mx-auto max-w-4xl">
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Personalresurser</p>
            <h1 className="mt-2 text-3xl">Teamet i dag</h1>
            <p className="mt-1 text-[14px] text-[color:var(--ink)]/60">
              Koppla uppgifter till rätt person — städ, frukost och reception ser bara sin egen vy.
            </p>
          </div>
          <span className="flex items-center gap-2 rounded-full bg-[color:var(--forest)] px-4 py-2 text-[13px] font-semibold text-white">
            <Users size={15} />
            {STAFF.length} aktiva
          </span>
        </div>
      </motion.div>

      {/* Teamkort */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {STAFF.map((s, i) => (
          <StaffCard key={s.id} staff={s} load={loadFor(s.id)} delay={i * 0.06} />
        ))}
      </div>

      {/* Tilldelning */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="card-surface mt-6 p-6"
      >
        <h2 className="flex items-center gap-2 font-sans text-[17px] font-bold">
          <UserCheck size={17} className="text-[color:var(--brass)]" /> Dagens tilldelning
        </h2>
        <p className="mt-1 text-[13px] text-[color:var(--ink)]/55">
          Klicka för att rotera vem som tar uppgiften — uppdateras direkt i Städvyn och Manifestet.
        </p>

        <div className="mt-5 space-y-3">
          {CLEANING.map((t) => {
            const key = `stad-${t.unitId}`;
            const unit = unitOf(t.unitId);
            const assigneeId = getAssigneeId(key);
            const assignee = staffById(assigneeId);
            return (
              <div
                key={t.unitId}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-[color:var(--line)] p-3.5"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[color:var(--bg)]">
                  <ClipboardList size={17} className="text-[color:var(--forest)]" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold">Städ · {unit.name}</div>
                  <div className="text-[12px] text-[color:var(--ink)]/55">
                    {t.window} · {t.checklist.length} punkter
                  </div>
                </div>
                <AssigneePicker
                  current={assignee}
                  candidates={cleaningStaff}
                  onChange={(id) => {
                    setAssignee(key, id);
                    refresh();
                  }}
                />
              </div>
            );
          })}

          {/* Frukost */}
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[color:var(--line)] p-3.5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[color:var(--bg)]">
              <Croissant size={17} className="text-[color:var(--forest)]" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold">Frukost · alla leveranser</div>
              <div className="text-[12px] text-[color:var(--ink)]/55">3 enheter i morgon bitti</div>
            </div>
            <AssigneePicker
              current={staffById(getAssigneeId("frukost"))}
              candidates={STAFF.filter((s) => s.role === "Frukost" || s.role === "Reception")}
              onChange={(id) => {
                setAssignee("frukost", id);
                refresh();
              }}
            />
          </div>
        </div>

        <p className="mt-5 flex items-start gap-2 rounded-xl bg-[color:var(--bg)] p-4 text-[13px] text-[color:var(--ink)]/65">
          <Sparkles size={15} className="mt-0.5 shrink-0 text-[color:var(--brass)]" />
          StayBoost föreslår automatiskt tilldelning utifrån veckoschemat — och meddelar personen på
          SMS när en ny uppgift landar hos dem.
        </p>
      </motion.div>
    </div>
  );
}

function StaffCard({ staff, load, delay }: { staff: StaffMember; load: number; delay: number }) {
  const initials = staff.name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("");
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="card-surface p-5"
    >
      <div className="flex items-center gap-3.5">
        <span
          className="grid h-12 w-12 shrink-0 place-items-center rounded-full text-[15px] font-bold text-white"
          style={{ background: staff.color }}
        >
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-bold">{staff.name}</div>
          <div className="flex items-center gap-2 text-[12px] text-[color:var(--ink)]/55">
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white"
              style={{ background: staff.color }}
            >
              {staff.role}
            </span>
            <span className="flex items-center gap-1">
              <Phone size={11} /> {staff.phone}
            </span>
          </div>
        </div>
        <div className="text-right">
          <div className="font-[Fraunces] text-2xl font-semibold">{load}</div>
          <div className="text-[11px] text-[color:var(--ink)]/50">uppgifter</div>
        </div>
      </div>
      <div className="mt-4 flex gap-1">
        {WEEKDAYS.map((d, i) => (
          <span
            key={d}
            className={`flex-1 rounded-md py-1 text-center text-[10px] font-semibold ${
              staff.weeklyShifts[i]
                ? "text-white"
                : "bg-[color:var(--bg)] text-[color:var(--ink)]/35"
            }`}
            style={staff.weeklyShifts[i] ? { background: staff.color } : undefined}
          >
            {d}
          </span>
        ))}
      </div>
    </motion.div>
  );
}

function AssigneePicker({
  current,
  candidates,
  onChange,
}: {
  current: StaffMember;
  candidates: StaffMember[];
  onChange: (id: string) => void;
}) {
  const next = () => {
    const idx = candidates.findIndex((c) => c.id === current.id);
    onChange(candidates[(idx + 1) % candidates.length].id);
  };
  return (
    <button
      onClick={next}
      className="flex items-center gap-2.5 rounded-full border border-[color:var(--line)] bg-white py-1.5 pl-1.5 pr-3 transition hover:bg-[color:var(--bg)]"
      title="Klicka för att byta ansvarig"
    >
      <span
        className="grid h-8 w-8 place-items-center rounded-full text-[12px] font-bold text-white"
        style={{ background: current.color }}
      >
        {current.name
          .split(" ")
          .map((n) => n[0])
          .slice(0, 2)
          .join("")}
      </span>
      <span className="text-[13px] font-semibold">{current.name.split(" ")[0]}</span>
      <RefreshCw size={13} className="text-[color:var(--ink)]/40" />
    </button>
  );
}

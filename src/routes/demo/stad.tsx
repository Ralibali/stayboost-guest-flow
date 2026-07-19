import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import {
  BedDouble,
  Check,
  CheckCircle2,
  Circle,
  Clock3,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { CLEANING, unitOf } from "@/lib/demo-data";

export const Route = createFileRoute("/demo/stad")({
  component: CleaningView,
});

type TaskStatus = "väntar" | "pågår" | "klar";

const TYPE_LABEL: Record<string, string> = {
  avresa: "Avresestädning",
  storstäd: "Storstädning",
  påsläpp: "Påsläpp",
};

function CleaningView() {
  const [tasks, setTasks] = useState(CLEANING);
  const [reported, setReported] = useState<Record<string, boolean>>({});

  const doneCount = tasks.filter((t) => t.status === "klar").length;

  const setStatus = (unitId: string, status: TaskStatus) =>
    setTasks((ts) => ts.map((t) => (t.unitId === unitId ? { ...t, status } : t)));

  const toggleItem = (unitId: string, idx: number) =>
    setTasks((ts) =>
      ts.map((t) =>
        t.unitId === unitId
          ? {
              ...t,
              checklist: t.checklist.map((c, i) => (i === idx ? { ...c, done: !c.done } : c)),
            }
          : t,
      ),
    );

  return (
    <div className="mx-auto max-w-3xl">
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Städvyn</p>
            <h1 className="mt-2 text-3xl">Dagens städning</h1>
            <p className="mt-1 text-[14px] text-[color:var(--ink)]/60">
              {doneCount} av {tasks.length} enheter klara
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full bg-[color:var(--forest)] px-4 py-2 text-[13px] font-semibold text-white">
            <Sparkles size={15} />
            Städteamet
          </div>
        </div>
      </motion.div>

      <div className="mt-6 space-y-5">
        {tasks.map((t, i) => {
          const unit = unitOf(t.unitId);
          const done = t.checklist.filter((c) => c.done).length;
          const pct = Math.round((done / t.checklist.length) * 100);
          return (
            <motion.div
              key={t.unitId}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.07 * i }}
              className={`card-surface overflow-hidden transition ${t.status === "klar" ? "opacity-75" : ""}`}
            >
              {/* Huvudrad */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-5 pb-4">
                <div className="flex items-center gap-4">
                  <span
                    className={`grid h-12 w-12 place-items-center rounded-2xl ${
                      t.status === "klar"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-[color:var(--forest)] text-white"
                    }`}
                  >
                    {t.status === "klar" ? <CheckCircle2 size={22} /> : <BedDouble size={22} />}
                  </span>
                  <div>
                    <h2 className="font-sans text-[17px] font-bold">{unit.name}</h2>
                    <p className="flex items-center gap-2 text-[13px] text-[color:var(--ink)]/55">
                      <span className="font-medium text-[color:var(--ink)]/75">
                        {TYPE_LABEL[t.type]}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock3 size={12} /> {t.window}
                      </span>
                    </p>
                  </div>
                </div>

                {/* Statusknappar */}
                <div className="flex rounded-full border border-[color:var(--line)] bg-[color:var(--bg)] p-1 text-[12px] font-semibold">
                  {(["väntar", "pågår", "klar"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setStatus(t.unitId, s)}
                      className={`rounded-full px-3.5 py-1.5 capitalize transition ${
                        t.status === s
                          ? s === "klar"
                            ? "bg-emerald-600 text-white"
                            : "bg-[color:var(--forest)] text-white"
                          : "text-[color:var(--ink)]/55 hover:text-[color:var(--ink)]"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {t.note && (
                <div className="mx-5 mb-4 flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-2.5 text-[13px] text-amber-800 ring-1 ring-amber-200">
                  <TriangleAlert size={15} className="mt-0.5 shrink-0" />
                  {t.note}
                </div>
              )}

              {/* Checklista */}
              <div className="border-t border-[color:var(--line)] px-5 py-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-[12px] font-semibold uppercase tracking-wide text-[color:var(--ink)]/50">
                    Checklista
                  </span>
                  <span className="text-[12px] font-semibold tabular-nums text-[color:var(--ink)]/60">
                    {done}/{t.checklist.length}
                  </span>
                </div>
                <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-[color:var(--line)]/60">
                  <motion.div
                    className={`h-full rounded-full ${pct === 100 ? "bg-emerald-500" : "bg-[color:var(--brass)]"}`}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.4 }}
                  />
                </div>
                <ul className="space-y-1">
                  {t.checklist.map((c, idx) => (
                    <li key={idx}>
                      <button
                        onClick={() => toggleItem(t.unitId, idx)}
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] transition hover:bg-[color:var(--bg)]"
                      >
                        {c.done ? (
                          <Check
                            size={18}
                            className="shrink-0 rounded-full bg-emerald-100 p-0.5 text-emerald-700"
                          />
                        ) : (
                          <Circle size={18} className="shrink-0 text-[color:var(--ink)]/25" />
                        )}
                        <span className={c.done ? "text-[color:var(--ink)]/45 line-through" : ""}>
                          {c.label}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => setReported((r) => ({ ...r, [t.unitId]: true }))}
                  className="mt-3 text-[13px] font-medium text-[color:var(--ink)]/50 underline decoration-dotted underline-offset-2 hover:text-[color:var(--ink)]"
                >
                  {reported[t.unitId]
                    ? "✓ Problem rapporterat till ägaren"
                    : "Rapportera problem (t.ex. trasigt, saknas)"}
                </button>
              </div>
            </motion.div>
          );
        })}
      </div>

      <p className="mt-6 text-center text-[13px] text-[color:var(--ink)]/50">
        Städteamet ser bara sin egen vy — på sitt eget språk — och ägaren följer status i realtid
        från dashboarden.
      </p>
    </div>
  );
}

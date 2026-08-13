import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import {
  BedDouble,
  Check,
  CheckCircle2,
  Circle,
  Clock3,
  PartyPopper,
  Sparkles,
  Timer,
  TriangleAlert,
} from "lucide-react";
import { CLEANING, fmtTime, unitOf } from "@/lib/demo-data";

export const Route = createFileRoute("/demo/stad")({
  component: CleaningView,
});

type TaskStatus = "väntar" | "pågår" | "klar";
type Filter = "alla" | TaskStatus;

const TYPE_LABEL: Record<string, string> = {
  avresa: "Avresestädning",
  storstäd: "Storstädning",
  påsläpp: "Påsläpp",
};

const FILTERS: { key: Filter; label: string }[] = [
  { key: "alla", label: "Alla" },
  { key: "väntar", label: "Väntar" },
  { key: "pågår", label: "Pågår" },
  { key: "klar", label: "Klara" },
];

function CleaningView() {
  const [tasks, setTasks] = useState(CLEANING);
  const [reported, setReported] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<Filter>("alla");
  const [startedAt, setStartedAt] = useState<Record<string, string>>({});
  const [finishedAt, setFinishedAt] = useState<Record<string, string>>({});

  const doneCount = tasks.filter((t) => t.status === "klar").length;
  const remainingMin = tasks
    .filter((t) => t.status !== "klar")
    .reduce((sum, t) => sum + t.estMin, 0);
  const allDone = tasks.length > 0 && doneCount === tasks.length;
  const dayPct = tasks.length === 0 ? 0 : Math.round((doneCount / tasks.length) * 100);

  const counts: Record<Filter, number> = {
    alla: tasks.length,
    väntar: tasks.filter((t) => t.status === "väntar").length,
    pågår: tasks.filter((t) => t.status === "pågår").length,
    klar: doneCount,
  };
  const visible = filter === "alla" ? tasks : tasks.filter((t) => t.status === filter);

  const setStatus = (id: string, status: TaskStatus) => {
    const now = fmtTime(new Date());
    if (status === "pågår") setStartedAt((s) => (s[id] ? s : { ...s, [id]: now }));
    if (status === "klar") setFinishedAt((s) => ({ ...s, [id]: now }));
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, status } : t)));
  };

  const toggleItem = (id: string, idx: number) =>
    setTasks((ts) =>
      ts.map((t) =>
        t.id === id
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
              {allDone
                ? "Allt klart — dags att andas ut"
                : `${doneCount} av ${tasks.length} enheter klara · ≈ ${remainingMin} min kvar`}
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full bg-[color:var(--forest)] px-4 py-2 text-[13px] font-semibold text-white">
            <Sparkles size={15} />
            Städteamet
          </div>
        </div>

        {/* Dagens totala progress */}
        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-[color:var(--line)]/60">
          <motion.div
            className={`h-full rounded-full ${allDone ? "bg-[color:var(--success)]" : "bg-[color:var(--brass)]"}`}
            animate={{ width: `${dayPct}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>

        {/* Filter */}
        <div className="mt-4 flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition ${
                filter === f.key
                  ? "bg-[color:var(--forest)] text-white"
                  : "border border-[color:var(--line)] bg-white text-[color:var(--ink)]/60 hover:text-[color:var(--ink)]"
              }`}
            >
              {f.label}
              <span className={filter === f.key ? " text-white/70" : " text-[color:var(--ink)]/40"}>
                {" "}
                {counts[f.key]}
              </span>
            </button>
          ))}
        </div>
      </motion.div>

      {/* Allt-klart-banner */}
      <AnimatePresence>
        {allDone && (
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="mt-6 flex items-center gap-3 rounded-2xl bg-[color:var(--forest)] p-5 text-white"
          >
            <PartyPopper size={22} className="shrink-0 text-[color:var(--brass)]" />
            <div>
              <p className="font-[Fraunces] text-lg font-semibold">
                Alla enheter klara — snyggt jobbat!
              </p>
              <p className="text-[13px] text-white/70">
                Ägaren notifieras automatiskt och ankommande gäster kan checka in.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-6 space-y-5">
        {visible.map((t, i) => {
          const unit = unitOf(t.unitId);
          const done = t.checklist.filter((c) => c.done).length;
          const pct = Math.round((done / t.checklist.length) * 100);
          return (
            <motion.div
              key={t.id}
              layout
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
                    <p className="flex flex-wrap items-center gap-2 text-[13px] text-[color:var(--ink)]/55">
                      <span className="font-medium text-[color:var(--ink)]/75">
                        {TYPE_LABEL[t.type]}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock3 size={12} /> {t.window}
                      </span>
                      <span className="flex items-center gap-1 rounded-full bg-[color:var(--bg)] px-2 py-0.5 text-[12px] font-medium">
                        <Timer size={11} /> ≈ {t.estMin} min
                      </span>
                    </p>
                  </div>
                </div>

                {/* Statusknappar + tidsstämpel */}
                <div className="flex flex-col items-end gap-1">
                  <div className="flex rounded-full border border-[color:var(--line)] bg-[color:var(--bg)] p-1 text-[12px] font-semibold">
                    {(["väntar", "pågår", "klar"] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => setStatus(t.id, s)}
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
                  {t.status === "pågår" && startedAt[t.id] && (
                    <span className="text-[11px] font-medium text-[color:var(--ink)]/45">
                      Påbörjad {startedAt[t.id]}
                    </span>
                  )}
                  {t.status === "klar" && finishedAt[t.id] && (
                    <span className="text-[11px] font-medium text-emerald-700">
                      Klar {finishedAt[t.id]}
                    </span>
                  )}
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
                        onClick={() => toggleItem(t.id, idx)}
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
                  onClick={() => setReported((r) => ({ ...r, [t.id]: true }))}
                  className="mt-3 text-[13px] font-medium text-[color:var(--ink)]/50 underline decoration-dotted underline-offset-2 hover:text-[color:var(--ink)]"
                >
                  {reported[t.id]
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
        från översikten.
      </p>
    </div>
  );
}

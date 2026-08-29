import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { AlertTriangle, Check, ChefHat, Clock3, Croissant, Truck } from "lucide-react";
import { BREAKFAST, fmtDateLong, unitOf } from "@/lib/demo-data";

export const Route = createFileRoute("/produkten/frukost")({
  component: BreakfastView,
});

type Status = "att_laga" | "lagas" | "levererad";

const STATUS_META: Record<Status, { label: string; next: string; color: string }> = {
  att_laga: {
    label: "Att laga",
    next: "Börja laga",
    color: "bg-[color:var(--line)]/70 text-[color:var(--ink)]/70",
  },
  lagas: { label: "Pågår", next: "Markera levererad", color: "bg-amber-100 text-amber-800" },
  levererad: { label: "Levererad", next: "Klar ✓", color: "bg-emerald-100 text-emerald-800" },
};

const NEXT: Record<Status, Status> = {
  att_laga: "lagas",
  lagas: "levererad",
  levererad: "levererad",
};

const ALLERGY_SHORT: Record<string, string> = {
  gluten: "gluten",
  laktos: "laktos",
  nötter: "nötter",
};

function BreakfastView() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [statuses, setStatuses] = useState<Record<string, Status>>(
    Object.fromEntries(BREAKFAST.map((b) => [b.id, b.status])),
  );

  const totalPortions = BREAKFAST.reduce((s, b) => s + b.portions, 0);
  const allergyCount = BREAKFAST.filter((b) => b.allergies.length > 0).length;
  const delivered = Object.values(statuses).filter((s) => s === "levererad").length;
  const progress = Math.round((delivered / BREAKFAST.length) * 100);

  const specialKost = useMemo(() => {
    const byCombo = new Map<string, number>();
    for (const b of BREAKFAST) {
      if (b.allergies.length === 0) continue;
      const base = [...b.allergies].sort().map((a) => ALLERGY_SHORT[a] ?? a);
      const combo =
        base.length === 1
          ? `${base[0]}fria`
          : `${base.slice(0, -1).join("- & ")}- & ${base[base.length - 1]}fria`;
      byCombo.set(combo, (byCombo.get(combo) ?? 0) + b.portions);
    }
    return [...byCombo.entries()];
  }, []);

  const sorted = useMemo(
    () => [...BREAKFAST].sort((a, b) => a.deliveryTime.localeCompare(b.deliveryTime)),
    [],
  );

  return (
    <div className="mx-auto max-w-3xl">
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Frukostvyn</p>
            <h1 className="mt-2 text-3xl">Leveranser — {fmtDateLong(tomorrow)}</h1>
          </div>
          <div className="flex items-center gap-2 rounded-full bg-[color:var(--forest)] px-4 py-2 text-[13px] font-semibold text-white">
            <ChefHat size={15} />
            Frukostteamet
          </div>
        </div>

        {/* Sammanfattning */}
        <div className="mt-6 grid grid-cols-3 gap-3">
          <SummaryCard icon={Croissant} value={String(totalPortions)} label="portioner totalt" />
          <SummaryCard
            icon={AlertTriangle}
            value={String(allergyCount)}
            label="med allergier"
            warn
          />
          <SummaryCard icon={Truck} value={`${delivered}/${BREAKFAST.length}`} label="levererade" />
        </div>

        {/* Progress */}
        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-[color:var(--line)]/60">
          <motion.div
            className="h-full rounded-full bg-[color:var(--success)]"
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>

        {/* Specialkost-att-förbereda */}
        {specialKost.length > 0 && (
          <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-red-50 px-4 py-3 text-[13px] text-red-800 ring-1 ring-red-200">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <p>
              <strong className="font-semibold">Att förbereda separat:</strong>{" "}
              {specialKost.map(([combo, portions]) => `${portions} portioner ${combo}`).join(" · ")}
            </p>
          </div>
        )}

        {/* Lista */}
        <div className="mt-6 space-y-4">
          {sorted.map((b, i) => {
            const unit = unitOf(b.unitId);
            const status = statuses[b.id];
            const meta = STATUS_META[status];
            return (
              <motion.div
                key={b.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.07 * i }}
                className={`card-surface p-5 transition ${status === "levererad" ? "opacity-70" : ""}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-4">
                    <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[color:var(--forest)] font-[Fraunces] text-lg font-semibold text-white">
                      {b.portions}
                    </span>
                    <div>
                      <h2 className="font-sans text-[17px] font-bold">{unit.name}</h2>
                      <p className="text-[13px] text-[color:var(--ink)]/55">{b.guestName}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1.5 rounded-full bg-[color:var(--bg)] px-3 py-1.5 text-[13px] font-semibold">
                      <Clock3 size={14} className="text-[color:var(--brass)]" />
                      {b.deliveryTime}
                    </span>
                    <span
                      className={`rounded-full px-3 py-1.5 text-[12px] font-semibold ${meta.color}`}
                    >
                      {meta.label}
                    </span>
                  </div>
                </div>

                {(b.allergies.length > 0 || b.note) && (
                  <div className="mt-4 space-y-2">
                    {b.allergies.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2">
                        <AlertTriangle size={14} className="text-red-600" />
                        {b.allergies.map((a) => (
                          <span
                            key={a}
                            className="rounded-full bg-red-50 px-3 py-1 text-[12px] font-bold uppercase tracking-wide text-red-700 ring-1 ring-red-200"
                          >
                            {a}
                          </span>
                        ))}
                      </div>
                    )}
                    {b.note && (
                      <p className="text-[13px] italic text-[color:var(--ink)]/60">”{b.note}”</p>
                    )}
                  </div>
                )}

                <button
                  onClick={() => setStatuses((s) => ({ ...s, [b.id]: NEXT[status] }))}
                  disabled={status === "levererad"}
                  className={`mt-4 w-full rounded-xl py-3 text-[14px] font-semibold transition ${
                    status === "levererad"
                      ? "cursor-default bg-emerald-50 text-emerald-700"
                      : "bg-[color:var(--forest)] text-white hover:brightness-110"
                  }`}
                >
                  {status === "levererad" ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Check size={16} /> Levererad {b.deliveryTime}
                    </span>
                  ) : (
                    meta.next
                  )}
                </button>
              </motion.div>
            );
          })}
        </div>

        <p className="mt-6 text-center text-[13px] text-[color:var(--ink)]/50">
          Nya frukostbeställningar från gästhubben dyker upp här automatiskt — senast kl 20:00
          kvällen före.
        </p>
      </motion.div>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  value,
  label,
  warn,
}: {
  icon: typeof Croissant;
  value: string;
  label: string;
  warn?: boolean;
}) {
  return (
    <div className="card-surface p-4 text-center">
      <Icon
        size={18}
        className={`mx-auto ${warn ? "text-red-600" : "text-[color:var(--brass)]"}`}
      />
      <div className="mt-1.5 font-[Fraunces] text-2xl font-semibold">{value}</div>
      <div className="text-[12px] text-[color:var(--ink)]/55">{label}</div>
    </div>
  );
}

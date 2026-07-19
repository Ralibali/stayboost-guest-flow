import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Banknote, BedDouble, CircleX, Download, TrendingUp } from "lucide-react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtKr } from "@/lib/demo-data";
import { REPORT } from "@/lib/channels-data";

export const Route = createFileRoute("/demo/rapporter")({
  component: ReportsView,
});

function ReportsView() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const growthPct = Math.round((REPORT.revenueYTD / REPORT.revenueLastYearYTD - 1) * 100);

  return (
    <div>
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Rapporter</p>
            <h1 className="mt-2 text-3xl">Så går verksamheten</h1>
            <p className="mt-1 text-[14px] text-[color:var(--ink)]/60">
              Samma administrativa överblick som BookSpot — fast byggd för små boenden.
            </p>
          </div>
          <button className="btn-ghost !rounded-full !px-4 !py-2 text-[13px]">
            <Download size={15} /> Exportera CSV
          </button>
        </div>
      </motion.div>

      {/* KPI:er */}
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          icon={Banknote}
          label="Intäkter i år"
          value={fmtKr(REPORT.revenueYTD)}
          sub={`+${growthPct} % mot förra året`}
          accent
        />
        <Kpi
          icon={BedDouble}
          label="ADR — snittpris/natt"
          value={fmtKr(REPORT.adr)}
          sub="Såld natt"
        />
        <Kpi
          icon={TrendingUp}
          label="RevPAR"
          value={fmtKr(REPORT.revpar)}
          sub="Per tillgänglig natt"
        />
        <Kpi
          icon={CircleX}
          label="Avbokningsgrad"
          value={`${REPORT.cancelPct} %`}
          sub="Branschsnitt ~18 %"
        />
      </div>

      {/* Huvudgraf */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="card-surface mt-6 p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-sans text-[17px] font-bold">Bokningsvärde över tid</h2>
            <p className="text-[13px] text-[color:var(--ink)]/55">
              Per månad — streckad linje visar förra året
            </p>
          </div>
          <div className="flex items-center gap-4 text-[12px] text-[color:var(--ink)]/60">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-[#1e3a2d]" /> I år
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 border-t-2 border-dashed border-[#b08d3e]" /> Förra året
            </span>
          </div>
        </div>
        <div className="mt-5 h-64">
          {mounted && (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={REPORT.monthly}
                margin={{ top: 4, right: 4, left: -10, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e4ddd0" vertical={false} />
                <XAxis
                  dataKey="man"
                  tick={{ fontSize: 12, fill: "#14241c" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: "#14241c99" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  formatter={(v, name) => [
                    fmtKr(Number(v)),
                    name === "forra" ? "Förra året" : "I år",
                  ]}
                  contentStyle={{ borderRadius: 12, border: "1px solid #e4ddd0", fontSize: 13 }}
                />
                <Bar dataKey="iAr" radius={[7, 7, 0, 0]} fill="#1e3a2d" />
                <Line
                  type="monotone"
                  dataKey="forra"
                  stroke="#b08d3e"
                  strokeWidth={2}
                  strokeDasharray="6 5"
                  dot={{ r: 3, fill: "#b08d3e" }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </motion.div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {/* Kanalfördelning */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="card-surface p-6"
        >
          <h2 className="font-sans text-[17px] font-bold">Kanalfördelning</h2>
          <p className="text-[13px] text-[color:var(--ink)]/55">Bokningar i juli per kanal</p>
          <div className="mt-2 flex items-center">
            <div className="h-48 w-1/2">
              {mounted && (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={REPORT.channelSplit}
                      dataKey="value"
                      innerRadius={46}
                      outerRadius={72}
                      paddingAngle={3}
                      strokeWidth={0}
                    >
                      {REPORT.channelSplit.map((c) => (
                        <Cell key={c.name} fill={c.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v) => `${v} %`}
                      contentStyle={{ borderRadius: 12, fontSize: 13 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="flex-1 space-y-2.5">
              {REPORT.channelSplit.map((c) => (
                <div key={c.name} className="flex items-center gap-2.5 text-[13px]">
                  <span className="h-3 w-3 rounded-full" style={{ background: c.color }} />
                  <span className="flex-1 font-medium">{c.name}</span>
                  <span className="font-semibold tabular-nums">{c.value} %</span>
                </div>
              ))}
              <p className="pt-2 text-[12px] leading-snug text-[color:var(--ink)]/55">
                Målet: 50 %+ direkt. Varje procentenhet dit är ~900 kr mindre provision per månad.
              </p>
            </div>
          </div>
        </motion.div>

        {/* Tillval per intäkt */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="card-surface p-6"
        >
          <h2 className="font-sans text-[17px] font-bold">Topp tillval — intäkt i juli</h2>
          <div className="mt-4 space-y-3">
            {REPORT.addonRevenue.map((a, i) => {
              const max = REPORT.addonRevenue[0].kr;
              return (
                <div key={a.name}>
                  <div className="flex justify-between text-[13px]">
                    <span className="font-semibold">
                      {i + 1}. {a.name}
                    </span>
                    <span className="tabular-nums text-[color:var(--ink)]/60">{fmtKr(a.kr)}</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-[color:var(--line)]/60">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${(a.kr / max) * 100}%` }}
                      transition={{ duration: 0.6, delay: 0.2 + i * 0.07 }}
                      className="h-full rounded-full bg-[color:var(--brass)]"
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-4 border-t border-[color:var(--line)] pt-3 text-[13px] text-[color:var(--ink)]/60">
            💡 Tillvalen står för <strong>20 %</strong> av totala intäkterna — utan att du behövt
            sälja en enda själv.
          </p>
        </motion.div>
      </div>
    </div>
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
      <div className="mt-2 font-[Fraunces] text-[24px] font-semibold leading-none tabular-nums">
        {value}
      </div>
      <div className="mt-1.5 text-[12px] text-[color:var(--ink)]/55">{sub}</div>
    </motion.div>
  );
}

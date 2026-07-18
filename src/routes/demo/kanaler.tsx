import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import {
  ArrowLeftRight,
  Banknote,
  Check,
  Copy,
  Globe,
  Link2,
  Percent,
  PiggyBank,
  RefreshCw,
  Zap,
} from "lucide-react";
import { fmtKr, unitOf } from "@/lib/demo-data";
import {
  CHANNELS,
  COMMISSION_SAVED_MONTH,
  DIRECT_SHARE_PCT,
  ICAL_FEEDS,
} from "@/lib/channels-data";

export const Route = createFileRoute("/demo/kanaler")({
  component: ChannelsView,
});

function ChannelsView() {
  const [channels, setChannels] = useState(CHANNELS);
  const [copied, setCopied] = useState<string | null>(null);

  const toggle = (id: string) =>
    setChannels((cs) => cs.map((c) => (c.id === id ? { ...c, connected: !c.connected } : c)));

  const copy = (url: string) => {
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopied(url);
    setTimeout(() => setCopied(null), 1500);
  };

  const otaBookings = channels
    .filter((c) => c.id !== "direkt")
    .reduce((s, c) => s + c.bookingsMonth, 0);
  const otaCommission = channels
    .filter((c) => c.id !== "direkt")
    .reduce((s, c) => s + Math.round(c.revenueMonth * (c.commissionPct / 100)), 0);

  return (
    <div className="mx-auto max-w-4xl">
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Kanalhanterare</p>
            <h1 className="mt-2 text-3xl">Alla kanaler, ett lager</h1>
            <p className="mt-1 max-w-xl text-[14px] text-[color:var(--ink)]/60">
              StayBoost synkar tillgänglighet åt alla håll i realtid — så du kan köra din egen motor
              bredvid OTA-kanalerna utan risk för dubbelbokningar.
            </p>
          </div>
          <span className="flex items-center gap-2 rounded-full bg-emerald-100 px-4 py-2 text-[13px] font-semibold text-emerald-800">
            <RefreshCw size={14} className="animate-[spin_4s_linear_infinite]" />
            Realtidssynk aktiv
          </span>
        </div>

        {/* KPI:er */}
        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi
            icon={PiggyBank}
            label="Sparad provision i juli"
            value={fmtKr(COMMISSION_SAVED_MONTH)}
            sub="Tack vare direktbokningar"
            accent
          />
          <Kpi
            icon={Zap}
            label="Direktbokningar"
            value={`${DIRECT_SHARE_PCT} %`}
            sub="Andel av alla bokningar"
          />
          <Kpi
            icon={Globe}
            label="OTA-bokningar i juli"
            value={String(otaBookings)}
            sub={`Kostar ${fmtKr(otaCommission)} i provision`}
          />
          <Kpi
            icon={ArrowLeftRight}
            label="Synktid"
            value="< 1 min"
            sub="Blockeringar åt alla håll"
          />
        </div>
      </motion.div>

      {/* Kanalkort */}
      <div className="mt-6 space-y-3">
        {channels.map((c, i) => (
          <motion.div
            key={c.id}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.06 * i }}
            className={`card-surface p-5 transition ${!c.connected ? "opacity-70" : ""}`}
          >
            <div className="flex flex-wrap items-center gap-4">
              <span
                className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-2xl"
                style={{ background: `${c.color}18` }}
              >
                {c.emoji}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-sans text-[16px] font-bold">{c.name}</h2>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                      c.connected
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-[color:var(--line)]/70 text-[color:var(--ink)]/55"
                    }`}
                  >
                    {c.connected ? "● Ansluten" : "Ej ansluten"}
                  </span>
                  {c.commissionPct > 0 && (
                    <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-[11px] font-semibold text-red-700">
                      {c.commissionPct} % provision
                    </span>
                  )}
                  {c.commissionPct === 0 && (
                    <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                      0 % provision
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[13px] text-[color:var(--ink)]/55">
                  {c.connected
                    ? c.id === "direkt"
                      ? "Din egen bokningsmotor — alltid provisionsfri"
                      : `Synkad för ${c.lastSyncMin} min sedan · ${c.bookingsMonth} bokningar i juli`
                    : "Koppla för att ta emot bokningar härifrån"}
                </p>
              </div>
              {c.connected && c.revenueMonth > 0 && (
                <div className="text-right">
                  <div className="font-[Fraunces] text-xl font-semibold tabular-nums">
                    {fmtKr(c.revenueMonth)}
                  </div>
                  <div className="text-[11px] text-[color:var(--ink)]/50">i juli</div>
                </div>
              )}
              {c.id !== "direkt" && (
                <button
                  onClick={() => toggle(c.id)}
                  role="switch"
                  aria-checked={c.connected}
                  className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                    c.connected ? "bg-[color:var(--success)]" : "bg-[color:var(--line)]"
                  }`}
                >
                  <span
                    className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${
                      c.connected ? "left-6" : "left-1"
                    }`}
                  />
                </button>
              )}
            </div>
          </motion.div>
        ))}
      </div>

      {/* iCal-flöden */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="card-surface mt-6 p-6"
      >
        <h2 className="flex items-center gap-2 font-sans text-[17px] font-bold">
          <Link2 size={17} className="text-[color:var(--brass)]" /> iCal-synk per enhet
        </h2>
        <p className="mt-1 text-[13px] text-[color:var(--ink)]/55">
          Klistra in dessa länkar i Booking.com/Airbnb — och deras iCal-länkar hos oss. Klart på tio
          minuter.
        </p>
        <div className="mt-4 space-y-2">
          {ICAL_FEEDS.map((f) => (
            <div
              key={f.unitId}
              className="flex items-center gap-3 rounded-xl border border-[color:var(--line)] bg-[color:var(--bg)]/60 p-3"
            >
              <span className="w-28 shrink-0 text-[13px] font-semibold">
                {unitOf(f.unitId).name}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-[color:var(--ink)]/60">
                {f.url}
              </span>
              <button
                onClick={() => copy(f.url)}
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-[color:var(--line)] px-3 py-1.5 text-[12px] font-semibold transition hover:bg-white"
              >
                {copied === f.url ? (
                  <>
                    <Check size={13} className="text-[color:var(--success)]" /> Kopierad
                  </>
                ) : (
                  <>
                    <Copy size={13} /> Kopiera
                  </>
                )}
              </button>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Besparingskort */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="mt-5 overflow-hidden rounded-[20px] bg-[color:var(--forest)] p-6 text-white"
      >
        <div className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-[color:var(--brass)]">
          <Banknote size={15} /> Räkneexempel
        </div>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-white/85">
          Med {fmtKr(90710)} i bokningsintäkter i juli hade rena OTA-bokningar kostat{" "}
          <strong className="text-white">{fmtKr(13600)}</strong> i provision. Med {DIRECT_SHARE_PCT}{" "}
          % direktbokningar betalade du bara {fmtKr(otaCommission)} —{" "}
          <strong className="text-[color:var(--brass)]">
            {fmtKr(COMMISSION_SAVED_MONTH)} rakt ner i egen ficka, varje månad.
          </strong>
        </p>
        <p className="mt-3 flex items-center gap-1.5 text-[13px] text-white/60">
          <Percent size={13} /> Det är därför ägaren av Bergs Slussar säger att systemet "betalar
          sig självt första veckan".
        </p>
      </motion.div>
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

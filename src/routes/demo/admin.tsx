import { useEffect, useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  BedDouble,
  CalendarClock,
  CalendarRange,
  Clock,
  Gift,
  Handshake,
  MessageSquareText,
  Percent,
  Plus,
  ShoppingBag,
  TrendingUp,
  X,
  Zap,
} from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ADDON_CATEGORY_LABELS,
  ADMIN_STATS,
  AUTOMATIONS,
  GUESTS,
  ORDERS,
  PROPERTY,
  addAddonToStore,
  fmtDate,
  fmtKr,
  fmtTime,
  getAddons,
  partnerCommissionMonth,
  toggleAddonInStore,
  unitOf,
  type Addon,
  type AddonCategory,
} from "@/lib/demo-data";
import { GIFT_CARDS, getSessionGiftCards } from "@/lib/upsell-data";

export const Route = createFileRoute("/demo/admin")({
  component: AdminDashboard,
});

function AdminDashboard() {
  const [automations, setAutomations] = useState(AUTOMATIONS);
  const [mounted, setMounted] = useState(false);
  const [, setTick] = useState(0);
  const [addonFilter, setAddonFilter] = useState<AddonCategory | "alla">("alla");
  const [modalOpen, setModalOpen] = useState(false);
  useEffect(() => setMounted(true), []);

  const addons = getAddons();
  const filteredAddons =
    addonFilter === "alla" ? addons : addons.filter((a) => a.category === addonFilter);
  const partnerAddons = addons.filter((a) => a.partner);

  const toggleAddon = (id: string) => {
    toggleAddonInStore(id);
    setTick((t) => t + 1);
  };

  const createAddon = (a: Omit<Addon, "soldThisMonth">) => {
    addAddonToStore(a);
    setTick((t) => t + 1);
    setModalOpen(false);
  };
  const toggleAutomation = (id: string) =>
    setAutomations((as) => as.map((a) => (a.id === id ? { ...a, active: !a.active } : a)));

  const addonById = useMemo(() => Object.fromEntries(addons.map((a) => [a.id, a])), [addons]);
  const recentGiftCards = [...getSessionGiftCards(), ...GIFT_CARDS];

  const arrivalsToday = GUESTS.filter(
    (g) => g.checkIn.toDateString() === new Date().toDateString(),
  );
  const departuresToday = GUESTS.filter(
    (g) => g.checkOut.toDateString() === new Date().toDateString(),
  );

  const topSellers = [...addons].sort((a, b) => b.soldThisMonth - a.soldThisMonth).slice(0, 3);
  const maxSold = topSellers[0]?.soldThisMonth ?? 1;

  return (
    <div>
      {/* Titel */}
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Ägaröversikt</p>
            <h1 className="mt-2 text-3xl">{PROPERTY.name}</h1>
            <p className="mt-1 text-[14px] text-[color:var(--ink)]/60">{PROPERTY.place}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <Link
              to="/demo/bokningar"
              className="flex items-center gap-2 rounded-full bg-[color:var(--forest)] px-4 py-2 text-[13px] font-semibold text-white transition hover:brightness-110"
            >
              <CalendarRange size={15} />
              Kalender & bokningar
            </Link>
            <span className="flex items-center gap-2 rounded-full bg-emerald-100 px-4 py-2 text-[13px] font-semibold text-emerald-800">
              <span className="relative flex h-2 w-2">
                <span className="absolute h-full w-full animate-ping rounded-full bg-emerald-500 opacity-70" />
                <span className="h-2 w-2 rounded-full bg-emerald-600" />
              </span>
              Live — uppdateras i realtid
            </span>
          </div>
        </div>
      </motion.div>

      {/* KPI:er */}
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          icon={Banknote}
          label="Merförsäljning i juli"
          value={fmtKr(ADMIN_STATS.addonRevenueMonth)}
          sub="+31 % mot juni"
          accent
        />
        <Kpi
          icon={ShoppingBag}
          label="Ordrar i juli"
          value={String(ADMIN_STATS.addonOrdersMonth)}
          sub="Snitt 104 kr/order"
        />
        <Kpi
          icon={Percent}
          label="Tackar ja till tillval"
          value={`${ADMIN_STATS.conversionPct} %`}
          sub="Av alla gäster"
        />
        <Kpi
          icon={Clock}
          label="Tid sparad"
          value={`${ADMIN_STATS.hoursSavedWeek} h/v`}
          sub="Färre samtal & lappar"
        />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-5">
        {/* Graf */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="card-surface p-6 lg:col-span-3"
        >
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-sans text-[17px] font-bold">Tillvalsintäkter per vecka</h2>
              <p className="text-[13px] text-[color:var(--ink)]/55">Senaste fyra veckorna</p>
            </div>
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-[13px] font-semibold text-emerald-700">
              <TrendingUp size={15} /> +79 %
            </span>
          </div>
          <div className="mt-5 h-56">
            {mounted && (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={ADMIN_STATS.revenueByWeek}
                  margin={{ top: 4, right: 4, left: -18, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e4ddd0" vertical={false} />
                  <XAxis
                    dataKey="vecka"
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
                      name === "forra" ? "Förra perioden" : "Intäkt",
                    ]}
                    contentStyle={{ borderRadius: 12, border: "1px solid #e4ddd0", fontSize: 13 }}
                  />
                  <Bar dataKey="kr" radius={[8, 8, 0, 0]} fill="#1e3a2d" />
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
          <div className="mt-3 flex items-center gap-4 text-[12px] text-[color:var(--ink)]/60">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-[#1e3a2d]" /> Denna period
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 border-t-2 border-dashed border-[#b08d3e]" /> Förra
              perioden
            </span>
          </div>
          <p className="mt-3 border-t border-[color:var(--line)] pt-3 text-[13px] text-[color:var(--ink)]/60">
            💡 Prenumerationen (449 kr/mån) betalades tillbaka efter <strong>första veckan</strong>.
          </p>
        </motion.div>

        {/* Orderfeed */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="card-surface flex flex-col p-6 lg:col-span-2"
        >
          <h2 className="font-sans text-[17px] font-bold">Orderflöde</h2>
          <p className="text-[13px] text-[color:var(--ink)]/55">Betalningar i realtid</p>
          <div className="mt-4 flex-1 space-y-3 overflow-y-auto">
            {ORDERS.map((o) => {
              const a = addonById[o.addonId];
              return (
                <div
                  key={o.id}
                  className="flex items-center gap-3 rounded-xl border border-[color:var(--line)] bg-[color:var(--bg)]/60 p-3"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-lg shadow-sm">
                    {a?.emoji}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-semibold">
                      {a?.name}
                      {o.qty > 1 && ` × ${o.qty}`}
                    </div>
                    <div className="truncate text-[12px] text-[color:var(--ink)]/55">
                      {o.guestName} · {o.unitName} · {fmtTime(o.time)}
                    </div>
                  </div>
                  <span className="shrink-0 text-[14px] font-bold text-[color:var(--success)]">
                    +{fmtKr(o.total)}
                  </span>
                </div>
              );
            })}
          </div>
        </motion.div>
      </div>

      {/* Ankomster & avresor */}
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="card-surface p-6"
        >
          <h2 className="flex items-center gap-2 font-sans text-[17px] font-bold">
            <ArrowUpRight size={18} className="text-[color:var(--success)]" /> Ankomster i dag
          </h2>
          <div className="mt-4 space-y-3">
            {arrivalsToday.map((g) => (
              <GuestRow
                key={g.id}
                guest={g}
                badge={`Incheckat ${PROPERTY.checkInTime}`}
                badgeType={g.checkedIn ? "ok" : "wait"}
              />
            ))}
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="card-surface p-6"
        >
          <h2 className="flex items-center gap-2 font-sans text-[17px] font-bold">
            <ArrowDownLeft size={18} className="text-[color:var(--brass)]" /> Avresor i dag
          </h2>
          <div className="mt-4 space-y-3">
            {departuresToday.map((g) => (
              <GuestRow
                key={g.id}
                guest={g}
                badge={`Utcheckning ${PROPERTY.checkOutTime}`}
                badgeType="wait"
              />
            ))}
          </div>
        </motion.div>
      </div>

      {/* Tillval + automationer */}
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="card-surface p-6"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-sans text-[17px] font-bold">Dina tillval</h2>
              <p className="text-[13px] text-[color:var(--ink)]/55">
                {addons.length} tillval · {partnerAddons.length} via partners — gästhubben
                uppdateras direkt
              </p>
            </div>
            <button
              onClick={() => setModalOpen(true)}
              className="btn-primary shrink-0 !rounded-xl !px-3.5 !py-2 text-[13px]"
            >
              <Plus size={15} /> Nytt tillval
            </button>
          </div>

          {/* Kategorifilter */}
          <div className="scrollbar-none -mx-1 mt-4 flex gap-1.5 overflow-x-auto px-1 pb-1">
            {[
              { id: "alla" as const, label: "Alla" },
              ...(Object.keys(ADDON_CATEGORY_LABELS) as AddonCategory[]).map((c) => ({
                id: c,
                label: ADDON_CATEGORY_LABELS[c],
              })),
            ].map((g) => {
              const n =
                g.id === "alla" ? addons.length : addons.filter((a) => a.category === g.id).length;
              return (
                <button
                  key={g.id}
                  onClick={() => setAddonFilter(g.id)}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-[12px] font-medium transition ${
                    addonFilter === g.id
                      ? "bg-[color:var(--forest)] text-white"
                      : "bg-[color:var(--bg)] text-[color:var(--ink)]/60 hover:bg-[color:var(--line)]/60"
                  }`}
                >
                  {g.label} <span className="opacity-60">{n}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-2 max-h-[380px] divide-y divide-[color:var(--line)] overflow-y-auto pr-1">
            {filteredAddons.map((a) => (
              <div key={a.id} className="flex items-center gap-3 py-3">
                <span className="text-xl">{a.emoji}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[14px] font-semibold">{a.name}</span>
                    {a.partner && (
                      <span className="rounded-full bg-[color:var(--brass)]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[color:var(--brass)]">
                        🤝 {a.partner.sharePct}%
                      </span>
                    )}
                  </div>
                  <div className="text-[12px] text-[color:var(--ink)]/55">
                    {fmtKr(a.price)} · {ADDON_CATEGORY_LABELS[a.category]} · {a.soldThisMonth} sålda
                    i juli
                    {a.partner && (
                      <span className="text-[color:var(--brass)]"> · {a.partner.name}</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => toggleAddon(a.id)}
                  role="switch"
                  aria-checked={a.active}
                  className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                    a.active ? "bg-[color:var(--success)]" : "bg-[color:var(--line)]"
                  }`}
                >
                  <span
                    className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${
                      a.active ? "left-6" : "left-1"
                    }`}
                  />
                </button>
              </div>
            ))}
          </div>

          {/* Partnerprovision */}
          <div className="mt-4 flex items-center gap-3 rounded-2xl bg-[color:var(--brass)]/8 p-4">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[color:var(--brass)]/15">
              <Handshake size={18} className="text-[color:var(--brass)]" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold">Partnerprovision i juli</div>
              <div className="text-[12px] text-[color:var(--ink)]/55">
                {partnerAddons.map((p) => p.partner!.name).join(" · ")}
              </div>
            </div>
            <span className="font-[Fraunces] text-lg font-semibold text-[color:var(--brass)]">
              {fmtKr(partnerCommissionMonth())}
            </span>
          </div>
        </motion.div>

        <div className="space-y-5">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="card-surface p-6"
          >
            <h2 className="flex items-center gap-2 font-sans text-[17px] font-bold">
              <Zap size={17} className="text-[color:var(--brass)]" /> Meddelandeautomation
            </h2>
            <div className="mt-4 space-y-3">
              {automations.map((a) => (
                <div key={a.id} className="flex items-center gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[color:var(--bg)]">
                    <MessageSquareText size={16} className="text-[color:var(--forest)]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-semibold">{a.name}</div>
                    <div className="text-[12px] text-[color:var(--ink)]/55">
                      {a.when} kl {a.time} · {a.sent30d} skickade/30 dgr
                    </div>
                  </div>
                  <button
                    onClick={() => toggleAutomation(a.id)}
                    role="switch"
                    aria-checked={a.active}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                      a.active ? "bg-[color:var(--success)]" : "bg-[color:var(--line)]"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                        a.active ? "left-[22px]" : "left-0.5"
                      }`}
                    />
                  </button>
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="card-surface p-6"
          >
            <h2 className="flex items-center gap-2 font-sans text-[17px] font-bold">
              <CalendarClock size={17} className="text-[color:var(--brass)]" /> Bäst säljande
            </h2>
            <div className="mt-4 space-y-3">
              {topSellers.map((a, i) => (
                <div key={a.id}>
                  <div className="flex justify-between text-[13px]">
                    <span className="font-semibold">
                      {i + 1}. {a.emoji} {a.name}
                    </span>
                    <span className="text-[color:var(--ink)]/60">{a.soldThisMonth} st</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-[color:var(--line)]/60">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${(a.soldThisMonth / maxSold) * 100}%` }}
                      transition={{ duration: 0.6, delay: 0.2 + i * 0.1 }}
                      className="h-full rounded-full bg-[color:var(--brass)]"
                    />
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Presentkort, paket & garanti */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45 }}
            className="card-surface p-6"
          >
            <h2 className="flex items-center gap-2 font-sans text-[17px] font-bold">
              <Gift size={17} className="text-[color:var(--brass)]" /> Presentkort & paket
            </h2>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-[color:var(--bg)] p-3">
                <div className="font-[Fraunces] text-xl font-semibold">
                  {ADMIN_STATS.giftCardsSoldMonth}
                </div>
                <div className="text-[11px] text-[color:var(--ink)]/55">presentkort</div>
              </div>
              <div className="rounded-xl bg-[color:var(--bg)] p-3">
                <div className="font-[Fraunces] text-xl font-semibold">
                  {ADMIN_STATS.bundlesSoldMonth}
                </div>
                <div className="text-[11px] text-[color:var(--ink)]/55">paket</div>
              </div>
              <div className="rounded-xl bg-[color:var(--bg)] p-3">
                <div className="font-[Fraunces] text-xl font-semibold">
                  {ADMIN_STATS.rebookingSoldMonth}
                </div>
                <div className="text-[11px] text-[color:var(--ink)]/55">garantier</div>
              </div>
            </div>
            <div className="mt-3 flex justify-between rounded-xl border border-[color:var(--line)] px-4 py-2.5 text-[13px]">
              <span className="text-[color:var(--ink)]/60">Presentkortsförsäljning i juli</span>
              <span className="font-semibold text-[color:var(--success)]">
                +{fmtKr(ADMIN_STATS.giftCardsRevenueMonth)}
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {recentGiftCards.slice(0, 3).map((g) => (
                <div
                  key={g.code}
                  className="flex items-center gap-2.5 rounded-xl border border-[color:var(--line)] bg-[color:var(--bg)]/60 px-3 py-2"
                >
                  <span className="font-mono text-[12px] font-bold">{g.code}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-[color:var(--ink)]/55">
                    till {g.recipient}
                  </span>
                  <span className="text-[12px] font-semibold tabular-nums">{fmtKr(g.amount)}</span>
                  {g.soldDaysAgo === 0 && (
                    <span className="rounded-full bg-[color:var(--brass)] px-1.5 py-0.5 text-[10px] font-bold text-white">
                      NY
                    </span>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>

      {modalOpen && <AddonModal onClose={() => setModalOpen(false)} onCreate={createAddon} />}
    </div>
  );
}

const EMOJI_CHOICES = [
  "🥐",
  "🍖",
  "🧀",
  "🍷",
  "☕",
  "🧺",
  "🥂",
  "🍫",
  "🛶",
  "🚣",
  "🎣",
  "🧖",
  "💆",
  "🧘",
  "🏊",
  "🚴",
  "🚲",
  "🏄",
  "🐟",
  "⛵",
  "🎿",
  "🛷",
  "🔭",
  "🪵",
  "😴",
  "🕛",
  "🍼",
  "🐕",
  "🧸",
  "🅿️",
  "🔌",
  "🧺",
];

function AddonModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (a: Omit<Addon, "soldThisMonth">) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("199");
  const [emoji, setEmoji] = useState("🥐");
  const [category, setCategory] = useState<AddonCategory>("mat");
  const [hasPartner, setHasPartner] = useState(false);
  const [partnerName, setPartnerName] = useState("");
  const [sharePct, setSharePct] = useState("15");

  const valid =
    name.trim().length > 1 && Number(price) > 0 && (!hasPartner || partnerName.trim().length > 1);

  const submit = () => {
    if (!valid) return;
    onCreate({
      id: `eget-${name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")}-${Date.now() % 10000}`,
      name: name.trim(),
      description: description.trim() || "Eget tillval — beskriv det gärna för gästen.",
      price: Math.round(Number(price)),
      emoji,
      category,
      active: true,
      ...(hasPartner
        ? {
            partner: {
              name: partnerName.trim(),
              sharePct: Math.min(50, Math.max(1, Number(sharePct) || 15)),
            },
          }
        : {}),
    });
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/45"
      />
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="fixed left-1/2 top-1/2 z-50 max-h-[88vh] w-[min(480px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[24px] bg-white p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-[Fraunces] text-xl font-semibold">Nytt tillval</h3>
          <button
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-full bg-[color:var(--bg)] transition hover:bg-[color:var(--line)]/60"
            aria-label="Stäng"
          >
            <X size={17} />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <div>
            <label className="text-[12px] font-semibold uppercase tracking-wide text-[color:var(--ink)]/55">
              Ikon
            </label>
            <div className="mt-2 grid grid-cols-8 gap-1.5">
              {EMOJI_CHOICES.map((e, i) => (
                <button
                  key={`${e}-${i}`}
                  onClick={() => setEmoji(e)}
                  className={`grid h-9 place-items-center rounded-xl text-lg transition ${
                    emoji === e
                      ? "bg-[color:var(--forest)]/15 ring-2 ring-[color:var(--forest)]"
                      : "bg-[color:var(--bg)] hover:bg-[color:var(--line)]/60"
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-[1fr_110px] gap-3">
            <div>
              <label className="text-[12px] font-semibold uppercase tracking-wide text-[color:var(--ink)]/55">
                Namn
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="T.ex. Laddbox elbil"
                className="mt-1.5 w-full rounded-xl border border-[color:var(--line)] bg-white px-3.5 py-2.5 text-[14px] outline-none focus:border-[color:var(--forest)]"
              />
            </div>
            <div>
              <label className="text-[12px] font-semibold uppercase tracking-wide text-[color:var(--ink)]/55">
                Pris (kr)
              </label>
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value.replace(/[^0-9]/g, ""))}
                inputMode="numeric"
                className="mt-1.5 w-full rounded-xl border border-[color:var(--line)] bg-white px-3.5 py-2.5 text-[14px] outline-none focus:border-[color:var(--forest)]"
              />
            </div>
          </div>

          <div>
            <label className="text-[12px] font-semibold uppercase tracking-wide text-[color:var(--ink)]/55">
              Kategori
            </label>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {(Object.keys(ADDON_CATEGORY_LABELS) as AddonCategory[]).map((c) => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className={`rounded-xl border px-3 py-2.5 text-[13px] font-semibold transition ${
                    category === c
                      ? "border-[color:var(--forest)] bg-[color:var(--forest)] text-white"
                      : "border-[color:var(--line)] hover:bg-[color:var(--bg)]"
                  }`}
                >
                  {ADDON_CATEGORY_LABELS[c]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[12px] font-semibold uppercase tracking-wide text-[color:var(--ink)]/55">
              Beskrivning
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Kort, säljande text som gästen ser i hubben."
              className="mt-1.5 w-full resize-none rounded-xl border border-[color:var(--line)] bg-white px-3.5 py-2.5 text-[14px] outline-none focus:border-[color:var(--forest)]"
            />
          </div>

          {/* Partner */}
          <div className="rounded-2xl bg-[color:var(--bg)] p-4">
            <button
              onClick={() => setHasPartner((v) => !v)}
              className="flex w-full items-center gap-3 text-left"
            >
              <span
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                  hasPartner ? "bg-[color:var(--success)]" : "bg-[color:var(--line)]"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                    hasPartner ? "left-[22px]" : "left-0.5"
                  }`}
                />
              </span>
              <span>
                <span className="block text-[14px] font-semibold">Säljs via lokal partner</span>
                <span className="text-[12px] text-[color:var(--ink)]/55">
                  Partnern levererar — du tar provision på varje såld
                </span>
              </span>
            </button>
            {hasPartner && (
              <div className="mt-3 grid grid-cols-[1fr_90px] gap-3 border-t border-[color:var(--line)] pt-3">
                <input
                  value={partnerName}
                  onChange={(e) => setPartnerName(e.target.value)}
                  placeholder="Partnerns namn"
                  className="w-full rounded-xl border border-[color:var(--line)] bg-white px-3.5 py-2.5 text-[14px] outline-none focus:border-[color:var(--forest)]"
                />
                <div className="relative">
                  <input
                    value={sharePct}
                    onChange={(e) => setSharePct(e.target.value.replace(/[^0-9]/g, ""))}
                    inputMode="numeric"
                    className="w-full rounded-xl border border-[color:var(--line)] bg-white px-3.5 py-2.5 pr-7 text-[14px] outline-none focus:border-[color:var(--forest)]"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-[color:var(--ink)]/45">
                    %
                  </span>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={submit}
            disabled={!valid}
            className="btn-primary w-full justify-center !rounded-xl !py-3 text-[15px] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {emoji} Publicera tillvalet
          </button>
          <p className="text-center text-[12px] text-[color:var(--ink)]/45">
            Syns direkt i gästhubben och bokningsflödet
          </p>
        </div>
      </motion.div>
    </>
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

function GuestRow({
  guest,
  badge,
  badgeType,
}: {
  guest: (typeof GUESTS)[number];
  badge: string;
  badgeType: "ok" | "wait";
}) {
  const unit = unitOf(guest.unitId);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[color:var(--line)] bg-[color:var(--bg)]/60 p-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[color:var(--forest)] text-[13px] font-bold text-white">
        {guest.name
          .split(" ")
          .map((n) => n[0])
          .slice(0, 2)
          .join("")}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold">{guest.name}</div>
        <div className="truncate text-[12px] text-[color:var(--ink)]/55">
          <BedDouble size={12} className="mr-1 inline-block align-[-2px]" />
          {unit.name} · {guest.guests} gäster · {fmtDate(guest.checkIn)}–{fmtDate(guest.checkOut)}
        </div>
      </div>
      <span
        className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
          badgeType === "ok" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
        }`}
      >
        {badge}
      </span>
    </div>
  );
}

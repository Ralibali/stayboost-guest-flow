import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import {
  Crown,
  Download,
  Mail,
  Phone,
  Search,
  ShieldCheck,
  Star,
  StickyNote,
  Users,
  X,
} from "lucide-react";
import { fmtKr } from "@/lib/demo-data";
import { CRM_GUESTS, type CrmGuest } from "@/lib/channels-data";

export const Route = createFileRoute("/demo/gaster")({
  component: GuestsView,
});

const TAGS = ["Alla", "VIP", "Återkommande", "Ny"] as const;

function GuestsView() {
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<(typeof TAGS)[number]>("Alla");
  const [selected, setSelected] = useState<CrmGuest | null>(null);

  const filtered = useMemo(
    () =>
      CRM_GUESTS.filter(
        (g) =>
          (tag === "Alla" || g.tag === tag) &&
          (query === "" || g.name.toLowerCase().includes(query.toLowerCase())),
      ).sort((a, b) => b.spent - a.spent),
    [query, tag],
  );

  const returningPct = Math.round(
    (CRM_GUESTS.filter((g) => g.stays > 1).length / CRM_GUESTS.length) * 100,
  );

  return (
    <div className="mx-auto max-w-3xl">
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Gästregister</p>
            <h1 className="mt-2 text-3xl">Dina gäster, på riktigt</h1>
            <p className="mt-1 text-[14px] text-[color:var(--ink)]/60">
              {returningPct} % kommer tillbaka — känn igen dem, notera allt, gör dem till
              ambassadörer.
            </p>
          </div>
          <button className="btn-ghost !rounded-full !px-4 !py-2 text-[13px]">
            <Download size={15} /> Exportera
          </button>
        </div>

        {/* Sök + filter */}
        <div className="mt-6 flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search
              size={16}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-[color:var(--ink)]/40"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Sök gäst…"
              className="w-full rounded-full border border-[color:var(--line)] bg-white py-2.5 pl-11 pr-4 text-[14px] outline-none focus:border-[color:var(--brass)]"
            />
          </div>
          <div className="flex rounded-full border border-[color:var(--line)] bg-white p-1 text-[13px] font-semibold">
            {TAGS.map((t) => (
              <button
                key={t}
                onClick={() => setTag(t)}
                className={`rounded-full px-3.5 py-1.5 transition ${
                  tag === t ? "bg-[color:var(--forest)] text-white" : "text-[color:var(--ink)]/60"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </motion.div>

      {/* Lista */}
      <div className="mt-5 space-y-2.5">
        {filtered.map((g, i) => (
          <motion.button
            key={g.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.04 * i }}
            onClick={() => setSelected(g)}
            className="card-surface flex w-full items-center gap-4 p-4 text-left transition hover:-translate-y-0.5 hover:shadow-[0_12px_30px_rgba(20,36,28,0.1)]"
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[color:var(--forest)] text-[13px] font-bold text-white">
              {g.name
                .split(" ")
                .map((n) => n[0])
                .slice(0, 2)
                .join("")}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[15px] font-bold">{g.name}</span>
                <span>{g.country}</span>
                <TagBadge tag={g.tag} />
              </div>
              <div className="mt-0.5 text-[13px] text-[color:var(--ink)]/55">
                {g.stays} {g.stays === 1 ? "vistelse" : "vistelser"} · {g.nights} nätter · senast{" "}
                {g.lastStay}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="font-[Fraunces] text-lg font-semibold tabular-nums">
                {fmtKr(g.spent)}
              </div>
              <div className="text-[11px] text-[color:var(--ink)]/50">totalt spenderat</div>
            </div>
          </motion.button>
        ))}
        {filtered.length === 0 && (
          <p className="py-8 text-center text-[14px] text-[color:var(--ink)]/50">
            Inga gäster matchar — prova ett annat sökord.
          </p>
        )}
      </div>

      <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-[12px] text-[color:var(--ink)]/45">
        <ShieldCheck size={13} /> Gästdata lagras i EU med full GDPR-hantering
      </p>

      {/* Detalj-drawer */}
      <AnimatePresence>
        {selected && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelected(null)}
              className="fixed inset-0 z-50 bg-black/45"
            />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="fixed right-0 top-0 z-50 h-full w-full max-w-md overflow-y-auto bg-white p-6 shadow-2xl"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3.5">
                  <span className="grid h-14 w-14 place-items-center rounded-full bg-[color:var(--forest)] text-lg font-bold text-white">
                    {selected.name
                      .split(" ")
                      .map((n) => n[0])
                      .slice(0, 2)
                      .join("")}
                  </span>
                  <div>
                    <h2 className="font-sans text-xl font-bold">
                      {selected.name} {selected.country}
                    </h2>
                    <TagBadge tag={selected.tag} />
                  </div>
                </div>
                <button
                  onClick={() => setSelected(null)}
                  className="grid h-9 w-9 place-items-center rounded-full hover:bg-[color:var(--bg)]"
                  aria-label="Stäng"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="mt-6 grid grid-cols-3 gap-2 text-center">
                <Stat value={String(selected.stays)} label="vistelser" />
                <Stat value={String(selected.nights)} label="nätter" />
                <Stat value={fmtKr(selected.spent)} label="spenderat" />
              </div>

              <div className="mt-5 space-y-2.5">
                <div className="flex items-center gap-3 rounded-xl border border-[color:var(--line)] p-3.5 text-[14px]">
                  <Phone size={16} className="text-[color:var(--brass)]" /> {selected.phone}
                </div>
                <div className="flex items-center gap-3 rounded-xl border border-[color:var(--line)] p-3.5 text-[14px]">
                  <Mail size={16} className="text-[color:var(--brass)]" /> {selected.email}
                </div>
              </div>

              {selected.note && (
                <div className="mt-4 rounded-xl bg-amber-50/70 p-4 ring-1 ring-amber-200">
                  <div className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide text-amber-800">
                    <StickyNote size={13} /> Intern notering
                  </div>
                  <p className="mt-1.5 text-[14px] text-[color:var(--ink)]/75">{selected.note}</p>
                </div>
              )}

              <h3 className="mt-6 text-[13px] font-bold uppercase tracking-wide text-[color:var(--ink)]/50">
                Bokningshistorik
              </h3>
              <div className="mt-2.5 space-y-2">
                {selected.history.map((h, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-xl bg-[color:var(--bg)]/70 px-4 py-3 text-[14px]"
                  >
                    <span className="font-medium">{h.unit}</span>
                    <span className="text-[color:var(--ink)]/55">{h.period}</span>
                    <span className="font-semibold tabular-nums">{fmtKr(h.total)}</span>
                  </div>
                ))}
              </div>

              <button className="btn-primary mt-6 w-full !rounded-2xl !py-3.5 text-[15px]">
                <Star size={16} /> Skicka personligt erbjudande
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function TagBadge({ tag }: { tag: CrmGuest["tag"] }) {
  const meta = {
    VIP: { icon: Crown, cls: "bg-amber-100 text-amber-800" },
    Återkommande: { icon: Users, cls: "bg-emerald-100 text-emerald-800" },
    Ny: { icon: Star, cls: "bg-blue-100 text-blue-800" },
  }[tag];
  const Icon = meta.icon;
  return (
    <span
      className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${meta.cls}`}
    >
      <Icon size={11} /> {tag}
    </span>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl bg-[color:var(--bg)] p-3">
      <div className="font-[Fraunces] text-xl font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] text-[color:var(--ink)]/55">{label}</div>
    </div>
  );
}

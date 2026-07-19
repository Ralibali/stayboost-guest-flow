import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import {
  Banknote,
  Check,
  ChevronDown,
  Clock,
  DoorOpen,
  KeyRound,
  LogIn,
  MapPin,
  Minus,
  Plus,
  Receipt,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Wifi,
} from "lucide-react";
import {
  ADDON_CATEGORY_LABELS,
  GUESTS,
  PROPERTY,
  fmtDate,
  fmtKr,
  getAddonById,
  getAddons,
  unitOf,
  type AddonCategory,
} from "@/lib/demo-data";

export const Route = createFileRoute("/demo/gast")({
  component: GuestHub,
});

type Cart = Record<string, number>;

const guest = GUESTS[0]; // Anna Lindqvist
const unit = unitOf(guest.unitId);

function GuestHub() {
  const [cart, setCart] = useState<Cart>({});
  const [payOpen, setPayOpen] = useState(false);
  const [paid, setPaid] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [group, setGroup] = useState<AddonCategory | "alla">("alla");

  const addons = getAddons();
  const activeAddons = addons.filter((a) => a.active);
  const visibleAddons =
    group === "alla" ? activeAddons : activeAddons.filter((a) => a.category === group);
  const partnerCount = activeAddons.filter((a) => a.partner).length;

  const cartItems = useMemo(
    () =>
      Object.entries(cart)
        .map(([id, qty]) => ({ addon: getAddonById(id)!, qty }))
        .filter((r) => r.qty > 0 && r.addon),
    [cart],
  );
  const total = cartItems.reduce((s, r) => s + r.addon.price * r.qty, 0);
  const count = cartItems.reduce((s, r) => s + r.qty, 0);

  const add = (id: string) => setCart((c) => ({ ...c, [id]: (c[id] ?? 0) + 1 }));
  const remove = (id: string) =>
    setCart((c) => {
      const qty = (c[id] ?? 0) - 1;
      const next = { ...c };
      if (qty <= 0) delete next[id];
      else next[id] = qty;
      return next;
    });

  const pay = () => {
    setPaid(true);
    setPayOpen(false);
  };

  return (
    <div className="mx-auto max-w-md">
      {/* Gäst-kort */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="overflow-hidden rounded-[24px] bg-[color:var(--forest)] text-white shadow-[0_20px_50px_rgba(20,36,28,0.25)]"
      >
        <div className="p-6 pb-5">
          <div className="flex items-center gap-1.5 text-[13px] text-white/70">
            <MapPin size={13} />
            {PROPERTY.place}
          </div>
          <h1 className="mt-1.5 font-[Fraunces] text-[26px] font-semibold leading-tight text-white">
            {PROPERTY.name}
          </h1>
          <div className="mt-4 flex items-center justify-between rounded-2xl bg-white/10 px-4 py-3">
            <div>
              <div className="text-[12px] uppercase tracking-wide text-white/60">Gäst</div>
              <div className="font-semibold">{guest.name}</div>
            </div>
            <div className="text-right">
              <div className="text-[12px] uppercase tracking-wide text-white/60">{unit.name}</div>
              <div className="font-semibold">
                {fmtDate(guest.checkIn)} – {fmtDate(guest.checkOut)}
              </div>
            </div>
          </div>
        </div>

        {/* Incheckningsstatus */}
        <div className="flex items-center justify-between bg-[color:var(--brass)] px-6 py-3.5">
          <div className="flex items-center gap-2.5 text-[14px] font-medium">
            <Clock size={16} />
            Incheckning från {PROPERTY.checkInTime} i dag
          </div>
          <Link
            to="/demo/incheckning"
            className="flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-[13px] font-semibold text-[color:var(--ink)] transition hover:bg-white/90"
          >
            <LogIn size={14} />
            Checka in
          </Link>
        </div>
      </motion.div>

      {/* Info-rutor */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <InfoCard
          icon={KeyRound}
          label="Portkod"
          value="••••"
          hint="Syns efter incheckning"
          locked
        />
        <InfoCard icon={Wifi} label="Wifi" value={unit.wifi} hint={`Lösen: ${unit.wifiPassword}`} />
        <InfoCard
          icon={DoorOpen}
          label="Incheckning"
          value={PROPERTY.checkInTime}
          hint={fmtDate(guest.checkIn)}
        />
        <InfoCard
          icon={Clock}
          label="Utcheckning"
          value={PROPERTY.checkOutTime}
          hint={fmtDate(guest.checkOut)}
        />
      </div>

      {/* Tillval */}
      <div className="mt-8">
        <div className="flex items-end justify-between px-1">
          <div>
            <p className="eyebrow">Tillval</p>
            <h2 className="mt-1 text-2xl">Gör vistelsen ännu bättre</h2>
            <p className="mt-1 text-[12px] text-[color:var(--ink)]/50">
              {activeAddons.length} tillval · {partnerCount} från lokala partners 🤝
            </p>
          </div>
        </div>

        {/* Kategorifilter */}
        <div className="scrollbar-none -mx-1 mt-4 flex gap-2 overflow-x-auto px-1 pb-1">
          {[
            { id: "alla" as const, label: "Alla", emoji: "✨" },
            { id: "mat" as const, label: ADDON_CATEGORY_LABELS.mat, emoji: "🧺" },
            { id: "upplevelse" as const, label: ADDON_CATEGORY_LABELS.upplevelse, emoji: "🛶" },
            { id: "hyra" as const, label: ADDON_CATEGORY_LABELS.hyra, emoji: "🚲" },
            { id: "praktiskt" as const, label: ADDON_CATEGORY_LABELS.praktiskt, emoji: "🧸" },
          ].map((g) => {
            const n =
              g.id === "alla"
                ? activeAddons.length
                : activeAddons.filter((a) => a.category === g.id).length;
            return (
              <button
                key={g.id}
                onClick={() => setGroup(g.id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-medium transition ${
                  group === g.id
                    ? "bg-[color:var(--forest)] text-white shadow-sm"
                    : "bg-[color:var(--line)]/40 text-[color:var(--ink)]/60 hover:bg-[color:var(--line)]/70"
                }`}
              >
                <span>{g.emoji}</span>
                {g.label}
                <span className={group === g.id ? "text-white/60" : "text-[color:var(--ink)]/40"}>
                  {n}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-4 space-y-3">
          {visibleAddons.map((a, i) => {
            const qty = cart[a.id] ?? 0;
            return (
              <motion.div
                key={a.id}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 * i }}
                className={`card-surface flex items-center gap-4 p-4 transition ${
                  qty > 0 ? "ring-2 ring-[color:var(--brass)]" : ""
                }`}
              >
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[color:var(--bg)] text-2xl">
                  {a.emoji}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="font-sans text-[15px] font-semibold">{a.name}</h3>
                    <span className="shrink-0 text-[15px] font-semibold text-[color:var(--brass)]">
                      {fmtKr(a.price)}
                    </span>
                  </div>
                  {a.partner && (
                    <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-[color:var(--brass)]/10 px-2 py-0.5 text-[10px] font-semibold text-[color:var(--brass)]">
                      🤝 {a.partner.name}
                    </span>
                  )}
                  <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-[color:var(--ink)]/60">
                    {a.description}
                  </p>
                </div>
                {qty === 0 ? (
                  <button
                    onClick={() => add(a.id)}
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[color:var(--forest)] text-white transition hover:scale-105"
                    aria-label={`Lägg till ${a.name}`}
                  >
                    <Plus size={18} />
                  </button>
                ) : (
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => remove(a.id)}
                      className="grid h-8 w-8 place-items-center rounded-full border border-[color:var(--line)] bg-white transition hover:bg-[color:var(--bg)]"
                      aria-label="Minska"
                    >
                      <Minus size={15} />
                    </button>
                    <span className="w-5 text-center font-semibold tabular-nums">{qty}</span>
                    <button
                      onClick={() => add(a.id)}
                      className="grid h-8 w-8 place-items-center rounded-full bg-[color:var(--forest)] text-white transition hover:scale-105"
                      aria-label="Öka"
                    >
                      <Plus size={15} />
                    </button>
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Vanliga frågor */}
      <div className="mt-8">
        <p className="eyebrow px-1">Bra att veta</p>
        <div className="card-surface mt-3 divide-y divide-[color:var(--line)]">
          {[
            {
              q: "Hur fungerar eldstaden?",
              a: "Ved finns i boden bredvid entrén. Första säcken ingår — fler säckar bokar du som tillval ovan. Tänd alltid från toppen för renaste förbränning.",
            },
            {
              q: "Var parkerar vi?",
              a: "På grusplanen vid slussen, 80 m från er enhet. Skyltat med enhetens namn. Elbilsladdning finns vid stora stugan.",
            },
            {
              q: "Kan vi få sen utcheckning?",
              a: "Ja! Mot 150 kr kan ni stanna till kl 13:00. Boka som tillval ovan — det bekräftas direkt via sms.",
            },
          ].map((f, i) => (
            <div key={i}>
              <button
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
                className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left text-[15px] font-semibold"
              >
                {f.q}
                <ChevronDown
                  size={17}
                  className={`shrink-0 text-[color:var(--ink)]/50 transition-transform ${openFaq === i ? "rotate-180" : ""}`}
                />
              </button>
              <AnimatePresence initial={false}>
                {openFaq === i && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className="overflow-hidden"
                  >
                    <p className="px-5 pb-5 text-[14px] leading-relaxed text-[color:var(--ink)]/70">
                      {f.a}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>

      <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-[12px] text-[color:var(--ink)]/45">
        <ShieldCheck size={13} />
        Säker betalning via StayBoost · Swish eller kort
      </p>

      {/* Kundvagnsfält */}
      <AnimatePresence>
        {count > 0 && !paid && (
          <motion.div
            initial={{ y: 90, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 90, opacity: 0 }}
            className="fixed inset-x-4 bottom-4 z-40 mx-auto max-w-md"
          >
            <button
              onClick={() => setPayOpen(true)}
              className="flex w-full items-center justify-between rounded-2xl bg-[color:var(--brass)] px-5 py-4 text-white shadow-[0_16px_40px_rgba(176,141,62,0.45)] transition hover:brightness-105"
            >
              <span className="flex items-center gap-2.5 font-semibold">
                <ShoppingBag size={18} />
                {count} {count === 1 ? "tillval" : "tillval"}
              </span>
              <span className="font-semibold">Betala {fmtKr(total)} →</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Betalnings-sheet */}
      <AnimatePresence>
        {payOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setPayOpen(false)}
              className="fixed inset-0 z-40 bg-black/45"
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-md rounded-t-[28px] bg-white p-6 pb-8 shadow-2xl"
            >
              <div className="mx-auto mb-5 h-1.5 w-12 rounded-full bg-[color:var(--line)]" />
              <h3 className="text-xl">Bekräfta tillval</h3>
              <div className="mt-4 space-y-2.5">
                {cartItems.map(({ addon, qty }) => (
                  <div key={addon.id} className="flex justify-between text-[15px]">
                    <span>
                      {addon.emoji} {addon.name} {qty > 1 && `× ${qty}`}
                    </span>
                    <span className="font-semibold tabular-nums">{fmtKr(addon.price * qty)}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t border-[color:var(--line)] pt-3 text-[16px] font-semibold">
                  <span>Totalt</span>
                  <span className="tabular-nums">{fmtKr(total)}</span>
                </div>
              </div>
              <div className="mt-6 grid grid-cols-2 gap-3">
                <button onClick={pay} className="btn-primary !rounded-xl !px-4 !py-3.5 text-[15px]">
                  <Smartphone size={17} /> Swish
                </button>
                <button onClick={pay} className="btn-ghost !rounded-xl !px-4 !py-3.5 text-[15px]">
                  <Banknote size={17} /> Kort
                </button>
              </div>
              <p className="mt-3 text-center text-[12px] text-[color:var(--ink)]/50">
                Demo — ingen riktig betalning sker
              </p>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Kvitto */}
      <AnimatePresence>
        {paid && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-50 grid place-items-center bg-[color:var(--bg)]/97 p-6"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="card-surface w-full max-w-sm p-8 text-center"
            >
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", delay: 0.15 }}
                className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[color:var(--success)] text-white"
              >
                <Check size={30} strokeWidth={3} />
              </motion.span>
              <h3 className="mt-5 text-2xl">Klart, Anna!</h3>
              <p className="mt-2 text-[15px] text-[color:var(--ink)]/65">
                Din beställning är betald och bekräftad. Vi skickar kvitto via sms — och
                frukostansvarig ser din order direkt i sin vy.
              </p>
              <div className="mt-5 rounded-2xl bg-[color:var(--bg)] p-4 text-left text-[14px]">
                <div className="flex items-center gap-2 font-semibold">
                  <Receipt size={15} /> Order #SB-1042
                </div>
                <div className="mt-2 space-y-1 text-[color:var(--ink)]/70">
                  {cartItems.map(({ addon, qty }) => (
                    <div key={addon.id} className="flex justify-between">
                      <span>
                        {addon.name} {qty > 1 && `× ${qty}`}
                      </span>
                      <span className="tabular-nums">{fmtKr(addon.price * qty)}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex justify-between border-t border-[color:var(--line)] pt-2 font-semibold">
                  <span>Betalt</span>
                  <span className="tabular-nums">{fmtKr(total)}</span>
                </div>
              </div>
              <button
                onClick={() => {
                  setPaid(false);
                  setCart({});
                }}
                className="btn-ghost mt-6 w-full !rounded-xl !py-3 text-[15px]"
              >
                Stäng kvittot
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function InfoCard({
  icon: Icon,
  label,
  value,
  hint,
  locked,
}: {
  icon: typeof KeyRound;
  label: string;
  value: string;
  hint: string;
  locked?: boolean;
}) {
  return (
    <div className="card-surface p-4">
      <div className="flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-wide text-[color:var(--ink)]/50">
        <Icon size={13} />
        {label}
      </div>
      <div
        className={`mt-1.5 font-[Fraunces] text-xl font-semibold ${locked ? "text-[color:var(--ink)]/40" : ""}`}
      >
        {value}
      </div>
      <div className="text-[12px] text-[color:var(--ink)]/50">{hint}</div>
    </div>
  );
}

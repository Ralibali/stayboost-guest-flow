import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleX,
  KeyRound,
  Loader2,
  Minus,
  PartyPopper,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  Users,
} from "lucide-react";
import { fmtDate, fmtDateLong, fmtKr, getAddonById, getAddons, unitOf } from "@/lib/demo-data";
import { addDays, startOfDay } from "@/lib/booking-data";
import { MonthGrid } from "@/components/demo/MonthGrid";
import {
  addAddonToBooking,
  cancel,
  daysUntilArrival,
  findMyBooking,
  rebook,
  type MyBooking,
} from "@/lib/selfservice";

export const Route = createFileRoute("/demo/min-sida")({
  component: MinSida,
});

type View = "oversikt" | "omboka" | "tillval";

function MinSida() {
  const [ref, setRef] = useState("");
  const [error, setError] = useState(false);
  const [booking, setBooking] = useState<MyBooking | null>(null);
  const [view, setView] = useState<View>("oversikt");
  const [, forceRender] = useState(0);

  const refresh = () => forceRender((n) => n + 1);

  const login = () => {
    const b = findMyBooking(ref);
    if (b) {
      setBooking(b);
      setError(false);
    } else {
      setError(true);
    }
  };

  if (!booking) {
    return (
      <div className="mx-auto max-w-md">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
          <p className="eyebrow">Min sida</p>
          <h1 className="mt-2 text-3xl">Hantera din bokning</h1>
          <p className="mt-3 text-[15px] text-[color:var(--ink)]/65">
            Ange ditt bokningsnummer från bekräftelsen — boka om, lägg till tillval eller avboka,
            helt utan att ringa receptionen.
          </p>

          <div className="card-surface mt-6 p-6">
            <label className="mb-1.5 block text-[13px] font-semibold text-[color:var(--ink)]/70">
              Bokningsnummer
            </label>
            <div className="flex gap-2">
              <input
                value={ref}
                onChange={(e) => {
                  setRef(e.target.value.toUpperCase());
                  setError(false);
                }}
                onKeyDown={(e) => e.key === "Enter" && login()}
                placeholder="SB-XXXXX"
                className="w-full rounded-xl border border-[color:var(--line)] bg-[color:var(--bg)] px-4 py-3 font-mono text-[15px] uppercase tracking-widest outline-none focus:border-[color:var(--brass)]"
              />
              <button
                onClick={login}
                className="btn-primary shrink-0 !rounded-xl !px-4 !py-3 text-[14px]"
              >
                <Search size={16} /> Hitta
              </button>
            </div>
            {error && (
              <p className="mt-2 text-[13px] text-red-600">
                Hittade ingen bokning — prova{" "}
                <button onClick={() => setRef("SB-DEMO")} className="font-mono font-bold underline">
                  SB-DEMO
                </button>{" "}
                eller bokningsnumret du fick i bokningsflödet.
              </p>
            )}
            <p className="mt-4 rounded-xl bg-[color:var(--bg)] px-4 py-3 text-[13px] text-[color:var(--ink)]/60">
              💡 Tips: boka en vistelse i{" "}
              <Link to="/demo/boka" className="font-semibold underline">
                bokningsflödet
              </Link>{" "}
              — ditt nya bokningsnummer fungerar här direkt.
            </p>
          </div>
        </motion.div>
      </div>
    );
  }

  const unit = unitOf(booking.unitId);
  const cancelled = booking.status === "Avbokad";

  return (
    <div className="mx-auto max-w-2xl">
      {/* Bokningskort */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="overflow-hidden rounded-[24px] bg-[color:var(--forest)] text-white"
      >
        <div className="p-6 pb-5">
          <div className="flex items-center justify-between">
            <span className="rounded-full bg-white/15 px-3 py-1 font-mono text-[12px] font-bold tracking-widest">
              {booking.ref}
            </span>
            <span
              className={`rounded-full px-3 py-1 text-[12px] font-semibold ${
                cancelled ? "bg-red-400/90" : "bg-[color:var(--brass)]"
              }`}
            >
              {booking.status}
            </span>
          </div>
          <h1 className="mt-4 font-[Fraunces] text-2xl font-semibold text-white">
            {unit.name} — {fmtDateLong(booking.start)}
          </h1>
          <div className="mt-4 grid grid-cols-3 gap-3 text-[13px]">
            <div className="rounded-xl bg-white/10 p-3">
              <CalendarDays size={15} className="text-[color:var(--brass)]" />
              <div className="mt-1 font-semibold">
                {fmtDate(booking.start)} → {fmtDate(addDays(booking.start, booking.nights))}
              </div>
              <div className="text-white/60">{booking.nights} nätter</div>
            </div>
            <div className="rounded-xl bg-white/10 p-3">
              <Users size={15} className="text-[color:var(--brass)]" />
              <div className="mt-1 font-semibold">{booking.guests} gäster</div>
              <div className="text-white/60">{booking.guestName}</div>
            </div>
            <div className="rounded-xl bg-white/10 p-3">
              <KeyRound size={15} className="text-[color:var(--brass)]" />
              <div className="mt-1 font-semibold">Portkod {unit.doorCode}</div>
              <div className="text-white/60">Wifi: {unit.wifi}</div>
            </div>
          </div>
        </div>
        {booking.hasGuarantee && !cancelled && (
          <div className="flex items-center gap-2 bg-[color:var(--brass)] px-6 py-2.5 text-[13px] font-medium">
            <ShieldCheck size={15} />
            Ombokningsgaranti aktiv — boka om kostnadsfritt till 7 dagar före ankomst
          </div>
        )}
      </motion.div>

      {/* Tillval på bokningen */}
      <div className="card-surface mt-4 p-5">
        <div className="flex justify-between text-[14px]">
          <span className="font-semibold">Bokat</span>
          <span className="font-semibold tabular-nums">{fmtKr(booking.total)}</span>
        </div>
        <div className="mt-2 space-y-1.5 text-[13px] text-[color:var(--ink)]/65">
          <div className="flex justify-between">
            <span>
              {unit.name} · {booking.nights} nätter · städning
            </span>
          </div>
          {booking.addons.map((a) => (
            <div key={a.name} className="flex justify-between">
              <span>
                + {a.name} × {a.qty}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Åtgärder */}
      {!cancelled && (
        <div className="mt-4 grid grid-cols-3 gap-3">
          <ActionBtn
            icon={CalendarDays}
            label="Boka om"
            active={view === "omboka"}
            onClick={() => setView(view === "omboka" ? "oversikt" : "omboka")}
          />
          <ActionBtn
            icon={ShoppingBag}
            label="Lägg till tillval"
            active={view === "tillval"}
            onClick={() => setView(view === "tillval" ? "oversikt" : "tillval")}
          />
          <ActionBtn icon={CircleX} label="Avboka" danger onClick={() => setView("oversikt")} />
        </div>
      )}

      <AnimatePresence mode="wait">
        {/* BOKA OM */}
        {view === "omboka" && !cancelled && (
          <RebookPanel
            key="om"
            booking={booking}
            onDone={() => setView("oversikt")}
            refresh={refresh}
          />
        )}

        {/* TILLVAL */}
        {view === "tillval" && !cancelled && (
          <AddonsPanel key="tv" booking={booking} refresh={refresh} />
        )}

        {/* AVBOKA */}
        {view === "oversikt" && !cancelled && (
          <CancelSection key="av" booking={booking} refresh={refresh} />
        )}

        {cancelled && (
          <motion.div
            key="k"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="card-surface mt-4 p-6 text-center"
          >
            <CircleX size={28} className="mx-auto text-red-500" />
            <h2 className="mt-3 text-xl">Bokningen är avbokad</h2>
            <p className="mt-2 text-[14px] text-[color:var(--ink)]/65">
              Återbetalningen sker inom 3–5 bankdagar. Hoppas vi ses en annan gång! 🌲
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---------- Boka om ---------- */
function RebookPanel({
  booking,
  onDone,
  refresh,
}: {
  booking: MyBooking;
  onDone: () => void;
  refresh: () => void;
}) {
  const today = startOfDay(new Date());
  const [monthOffset, setMonthOffset] = useState(0);
  const [newStart, setNewStart] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [fel, setFel] = useState<string | null>(null);

  const free = booking.hasGuarantee || daysUntilArrival(booking) >= 14;
  const fee = free ? 0 : 250;

  const confirm = () => {
    if (!newStart) return;
    setBusy(true);
    setTimeout(() => {
      const res = rebook(booking, newStart);
      setBusy(false);
      if (res.ok) {
        setDone(true);
        refresh();
      } else {
        setFel(res.reason ?? "Något gick fel.");
      }
    }, 900);
  };

  if (done) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="card-surface mt-4 p-6 text-center"
      >
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring" }}
          className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[color:var(--success)] text-white"
        >
          <PartyPopper size={24} />
        </motion.span>
        <h2 className="mt-4 text-2xl">Ombokningen är klar!</h2>
        <p className="mt-2 text-[15px] text-[color:var(--ink)]/65">
          Nya datum: <strong>{fmtDateLong(booking.start)}</strong> →{" "}
          {fmtDate(addDays(booking.start, booking.nights))}. Bekräftelse skickad via e-post och sms
          — och ägarens kalender är redan uppdaterad.
        </p>
        <button onClick={onDone} className="btn-primary mt-5 !rounded-2xl !px-6 !py-3 text-[15px]">
          <Check size={16} /> Toppen
        </button>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      className="card-surface mt-4 p-6"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-sans text-lg font-bold">Välj nytt ankomstdatum</h2>
        <span
          className={`rounded-full px-3 py-1 text-[12px] font-semibold ${
            free ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
          }`}
        >
          {free ? "Kostnadsfri ombokning" : `Ombokningsavgift ${fmtKr(fee)}`}
        </span>
      </div>
      <p className="mt-1 text-[13px] text-[color:var(--ink)]/60">
        Samma enhet och {booking.nights} nätter — välj bara ny start.
      </p>

      <div className="mt-4 flex items-center justify-between">
        <button
          onClick={() => setMonthOffset((m) => Math.max(0, m - 1))}
          disabled={monthOffset === 0}
          className="grid h-9 w-9 place-items-center rounded-full border border-[color:var(--line)] transition hover:bg-[color:var(--bg)] disabled:opacity-30"
          aria-label="Föregående månad"
        >
          <ChevronLeft size={17} />
        </button>
        <div className="flex items-center gap-2 text-[14px] font-semibold">
          <CalendarDays size={16} className="text-[color:var(--brass)]" />
          Bläddra månader
        </div>
        <button
          onClick={() => setMonthOffset((m) => Math.min(2, m + 1))}
          className="grid h-9 w-9 place-items-center rounded-full border border-[color:var(--line)] transition hover:bg-[color:var(--bg)]"
          aria-label="Nästa månad"
        >
          <ChevronRight size={17} />
        </button>
      </div>

      <div className="mt-3 grid gap-6 sm:grid-cols-2">
        {[0, 1].map((off) => (
          <MonthGrid
            key={off}
            base={new Date(today.getFullYear(), today.getMonth() + monthOffset + off, 1)}
            today={today}
            checkIn={newStart}
            checkOut={newStart ? addDays(newStart, booking.nights) : null}
            onPick={(d) => {
              setNewStart(d);
              setFel(null);
            }}
          />
        ))}
      </div>

      {fel && <p className="mt-3 text-[13px] font-medium text-red-600">{fel}</p>}

      <div className="mt-4 flex items-center justify-between rounded-xl bg-[color:var(--bg)] px-4 py-3 text-[14px]">
        <span>
          {newStart
            ? `${fmtDateLong(newStart)} → ${fmtDate(addDays(newStart, booking.nights))}`
            : "Inget datum valt"}
        </span>
        <span className="font-semibold">{free ? "0 kr" : fmtKr(fee)}</span>
      </div>

      <button
        onClick={confirm}
        disabled={!newStart || busy}
        className="btn-primary mt-4 w-full !rounded-2xl disabled:opacity-40"
      >
        {busy ? (
          <>
            <Loader2 size={17} className="animate-spin" /> Bokar om…
          </>
        ) : (
          <>
            <Check size={17} /> Bekräfta ombokning
          </>
        )}
      </button>
    </motion.div>
  );
}

/* ---------- Tillval ---------- */
function AddonsPanel({ booking, refresh }: { booking: MyBooking; refresh: () => void }) {
  const [cart, setCart] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const items = Object.entries(cart)
    .map(([id, qty]) => ({ addon: getAddonById(id)!, qty }))
    .filter((r) => r.qty > 0);
  const total = items.reduce((s, r) => s + r.addon.price * r.qty, 0);

  const setQty = (id: string, qty: number) =>
    setCart((c) => {
      const next = { ...c };
      if (qty <= 0) delete next[id];
      else next[id] = qty;
      return next;
    });

  const buy = () => {
    setBusy(true);
    setTimeout(() => {
      items.forEach(({ addon, qty }) => addAddonToBooking(booking, addon.name, qty, addon.price));
      setBusy(false);
      setDone(true);
      refresh();
    }, 1000);
  };

  if (done) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="card-surface mt-4 p-6 text-center"
      >
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[color:var(--success)] text-white">
          <Check size={24} strokeWidth={3} />
        </span>
        <h2 className="mt-4 text-2xl">Tillvalen är tillagda!</h2>
        <p className="mt-2 text-[15px] text-[color:var(--ink)]/65">
          Kvittot skickas via sms. Personalen ser din beställning direkt i sina vyer.
        </p>
        <button
          onClick={() => setDone(false)}
          className="btn-ghost mt-5 !rounded-2xl !px-6 !py-3 text-[14px]"
        >
          Lägg till mer
        </button>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      className="card-surface mt-4 p-6"
    >
      <h2 className="font-sans text-lg font-bold">Lägg till på din bokning</h2>
      <div className="mt-4 space-y-2.5">
        {getAddons()
          .filter((a) => a.active)
          .map((a) => {
            const qty = cart[a.id] ?? 0;
            return (
              <div key={a.id} className="flex items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[color:var(--bg)] text-xl">
                  {a.emoji}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold">{a.name}</div>
                  <div className="text-[12px] text-[color:var(--ink)]/55">{fmtKr(a.price)}</div>
                </div>
                {qty === 0 ? (
                  <button
                    onClick={() => setQty(a.id, 1)}
                    className="grid h-9 w-9 place-items-center rounded-full bg-[color:var(--forest)] text-white"
                    aria-label={`Lägg till ${a.name}`}
                  >
                    <Plus size={16} />
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setQty(a.id, qty - 1)}
                      className="grid h-8 w-8 place-items-center rounded-full border border-[color:var(--line)]"
                      aria-label="Minska"
                    >
                      <Minus size={14} />
                    </button>
                    <span className="w-5 text-center font-semibold tabular-nums">{qty}</span>
                    <button
                      onClick={() => setQty(a.id, qty + 1)}
                      className="grid h-8 w-8 place-items-center rounded-full bg-[color:var(--forest)] text-white"
                      aria-label="Öka"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
      </div>
      <button
        onClick={buy}
        disabled={total === 0 || busy}
        className="btn-primary mt-5 w-full !rounded-2xl disabled:opacity-40"
      >
        {busy ? (
          <>
            <Loader2 size={17} className="animate-spin" /> Behandlar…
          </>
        ) : (
          <>
            <ShoppingBag size={17} /> Betala tillval {total > 0 && fmtKr(total)}
          </>
        )}
      </button>
    </motion.div>
  );
}

/* ---------- Avboka ---------- */
function CancelSection({ booking, refresh }: { booking: MyBooking; refresh: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const days = daysUntilArrival(booking);
  const fullRefund = booking.hasGuarantee || days >= 14;

  if (confirming) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="card-surface mt-4 border-red-200 p-6"
      >
        <h2 className="font-sans text-lg font-bold text-red-700">Avboka vistelsen?</h2>
        <p className="mt-2 text-[14px] text-[color:var(--ink)]/70">
          {fullRefund
            ? `Du får full återbetalning (${booking.hasGuarantee ? "ombokningsgarantin gäller" : `${days} dagar kvar till ankomst`}).`
            : `Det är ${days} dagar kvar till ankomst — 50 % återbetalas enligt villkoren.`}
        </p>
        <div className="mt-4 flex gap-3">
          <button
            onClick={() => setConfirming(false)}
            className="btn-ghost flex-1 !rounded-2xl !py-3 text-[14px]"
          >
            <ArrowLeft size={15} /> Behåll bokningen
          </button>
          <button
            onClick={() => {
              cancel(booking);
              refresh();
            }}
            className="flex-1 rounded-2xl bg-red-600 py-3 text-[14px] font-semibold text-white transition hover:bg-red-700"
          >
            Ja, avboka
          </button>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="mt-4 text-center">
      <button
        onClick={() => setConfirming(true)}
        className="text-[13px] font-medium text-[color:var(--ink)]/45 underline decoration-dotted underline-offset-4 hover:text-red-600"
      >
        Jag behöver avboka min vistelse
      </button>
    </div>
  );
}

/* ---------- Åtgärdsknapp ---------- */
function ActionBtn({
  icon: Icon,
  label,
  onClick,
  active,
  danger,
}: {
  icon: typeof CalendarDays;
  label: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`card-surface flex flex-col items-center gap-2 p-4 text-[13px] font-semibold transition ${
        active
          ? "ring-2 ring-[color:var(--brass)]"
          : danger
            ? "text-red-600/80 hover:text-red-700"
            : "hover:-translate-y-0.5 hover:shadow-[0_12px_30px_rgba(20,36,28,0.1)]"
      }`}
    >
      <Icon size={20} className={danger ? "" : "text-[color:var(--brass)]"} />
      {label}
    </button>
  );
}

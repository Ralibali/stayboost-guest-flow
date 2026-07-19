import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  BedDouble,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Gift,
  Loader2,
  Mail,
  MessageSquareText,
  Minus,
  PartyPopper,
  Phone,
  Plus,
  ShieldCheck,
  Smartphone,
  Tag,
  User,
  Users,
} from "lucide-react";
import {
  ADDON_CATEGORY_LABELS,
  PROPERTY,
  fmtDate,
  fmtDateLong,
  fmtKr,
  getAddonById,
  getAddons,
  type AddonCategory,
} from "@/lib/demo-data";
import {
  BOOKING_UNITS,
  CLEANING_FEE,
  PROMO_CODES,
  addSessionBooking,
  isRangeAvailable,
  rangeTotal,
  RESOURCES,
  resourceLeft,
  seasonLabel,
  startOfDay,
} from "@/lib/booking-data";
import { BUNDLES, REBOOKING_GUARANTEE, REDEEMABLE, type Bundle } from "@/lib/upsell-data";
import { MonthGrid } from "@/components/demo/MonthGrid";

export const Route = createFileRoute("/demo/boka")({
  component: BookingFlow,
});

const STEPS = ["Datum", "Boende", "Tillval", "Betalning", "Klart"];
const SAUNA_TIMES = ["16:00", "17:30", "19:00", "20:30"];

type Cart = Record<string, number>;

function BookingFlow() {
  const [step, setStep] = useState(0);
  const [monthOffset, setMonthOffset] = useState(0);
  const [checkIn, setCheckIn] = useState<Date | null>(null);
  const [checkOut, setCheckOut] = useState<Date | null>(null);
  const [guests, setGuests] = useState(2);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [cart, setCart] = useState<Cart>({});
  const [saunaTime, setSaunaTime] = useState(SAUNA_TIMES[1]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [promo, setPromo] = useState("");
  const [promoApplied, setPromoApplied] = useState<number | null>(null);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [rebooking, setRebooking] = useState(false);
  const [payTab, setPayTab] = useState<"vanlig" | "presentkort">("vanlig");
  const [giftCode, setGiftCode] = useState("");
  const [giftStatus, setGiftStatus] = useState<"idle" | "ok" | "fel">("idle");
  const [giftApplied, setGiftApplied] = useState(0);
  const [paying, setPaying] = useState(false);
  const [bookingRef, setBookingRef] = useState<string | null>(null);
  const [addonGroup, setAddonGroup] = useState<AddonCategory | "alla">("alla");

  const today = startOfDay(new Date());
  const nights = checkIn && checkOut ? Math.round((+checkOut - +checkIn) / 86400000) : 0;
  const unit = BOOKING_UNITS.find((u) => u.id === unitId) ?? null;

  const cartItems = useMemo(
    () =>
      Object.entries(cart)
        .map(([id, qty]) => ({ addon: getAddonById(id)!, qty }))
        .filter((r) => r.qty > 0),
    [cart],
  );

  const lodging = unit && nights > 0 ? rangeTotal(unit, checkIn!, nights) : 0;
  const addonsTotal =
    cartItems.reduce((s, r) => s + r.addon.price * r.qty, 0) +
    (bundle?.price ?? 0) +
    (rebooking ? REBOOKING_GUARANTEE.price : 0);
  const discount = promoApplied ? Math.round((lodging + CLEANING_FEE) * promoApplied) : 0;
  const subtotal = unit && nights > 0 ? lodging + CLEANING_FEE + addonsTotal - discount : 0;
  const giftDeduction = Math.min(giftApplied, subtotal);
  const total = subtotal - giftDeduction;

  const pickDate = (d: Date) => {
    if (!checkIn || (checkIn && checkOut)) {
      setCheckIn(d);
      setCheckOut(null);
      setUnitId(null);
      return;
    }
    if (d <= checkIn) {
      setCheckIn(d);
      return;
    }
    setCheckOut(d);
    setUnitId(null);
  };

  const setQty = (id: string, qty: number) =>
    setCart((c) => {
      const next = { ...c };
      if (qty <= 0) delete next[id];
      else next[id] = qty;
      return next;
    });

  const applyPromo = () => {
    const code = promo.trim().toUpperCase();
    setPromoApplied(PROMO_CODES[code] ?? null);
  };

  const applyGiftCard = () => {
    const code = giftCode.trim().toUpperCase();
    const balance = REDEEMABLE[code];
    if (balance) {
      setGiftApplied(balance);
      setGiftStatus("ok");
    } else {
      setGiftApplied(0);
      setGiftStatus("fel");
    }
  };

  const detailsValid =
    name.trim().length > 1 && /\S+@\S+\.\S+/.test(email) && phone.trim().length >= 7;

  const pay = () => {
    if (!unit || !checkIn || !checkOut) return;
    setPaying(true);
    setTimeout(() => {
      const ref = `SB-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
      addSessionBooking({
        id: ref,
        unitId: unit.id,
        guestName: name,
        start: checkIn,
        nights,
        source: "Direkt",
        status: "Betald",
        total,
        createdDaysAgo: 0,
        isNew: true,
      });
      setBookingRef(ref);
      setPaying(false);
      setStep(4);
    }, 1400);
  };

  const canNext =
    step === 0 ? nights > 0 : step === 1 ? unitId !== null : step === 3 ? detailsValid : true;

  const stepHint =
    step === 0
      ? !checkIn
        ? "Välj incheckningsdatum i kalendern"
        : !checkOut
          ? "Välj utcheckningsdatum"
          : `${nights} ${nights === 1 ? "natt vald" : "nätter valda"}`
      : step === 1
        ? "Välj ett boende ovan"
        : step === 3
          ? "Fyll i namn, mejl och mobilnummer"
          : "Lägg till tillval — eller fortsätt direkt";

  return (
    <div className="mx-auto max-w-5xl">
      {/* Stegindikator */}
      {step < 4 && (
        <div className="mb-8">
          <div className="flex items-center gap-1.5 sm:gap-2">
            {STEPS.slice(0, 4).map((s, i) => (
              <div key={s} className="flex flex-1 flex-col gap-1.5">
                <div
                  className={`h-1.5 rounded-full transition-colors ${
                    i <= step ? "bg-[color:var(--brass)]" : "bg-[color:var(--line)]"
                  }`}
                />
                <span
                  className={`text-[11px] font-medium ${
                    i <= step ? "text-[color:var(--ink)]" : "text-[color:var(--ink)]/40"
                  }`}
                >
                  {s}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={step < 4 ? "grid gap-6 pb-24 lg:grid-cols-[1fr_340px] lg:pb-0" : ""}>
        {/* ---------- Vänster: steg ---------- */}
        <div>
          <AnimatePresence mode="wait">
            {/* STEG 1 — Datum */}
            {step === 0 && (
              <StepShell key="s0">
                <StepTitle
                  eyebrow="Steg 1 av 4"
                  title="När vill du bo hos oss?"
                  sub="Priserna i kalendern är lägsta nattpris. Helgerna bokas först."
                />
                <div className="card-surface mt-6 p-4 sm:p-6">
                  <div className="mb-4 flex items-center justify-between">
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
                      {monthName(today, monthOffset)} — {monthName(today, monthOffset + 1)}
                    </div>
                    <button
                      onClick={() => setMonthOffset((m) => Math.min(2, m + 1))}
                      className="grid h-9 w-9 place-items-center rounded-full border border-[color:var(--line)] transition hover:bg-[color:var(--bg)]"
                      aria-label="Nästa månad"
                    >
                      <ChevronRight size={17} />
                    </button>
                  </div>

                  <div className="grid gap-6 md:grid-cols-2">
                    {[0, 1].map((off) => (
                      <MonthGrid
                        key={off}
                        base={addMonths(today, monthOffset + off)}
                        today={today}
                        checkIn={checkIn}
                        checkOut={checkOut}
                        onPick={pickDate}
                      />
                    ))}
                  </div>

                  {/* Säsongspriser */}
                  {[0, 1].some((off) => seasonLabel(addMonths(today, monthOffset + off))) && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {[0, 1].map((off) => {
                        const d = addMonths(today, monthOffset + off);
                        const label = seasonLabel(d);
                        return label ? (
                          <span
                            key={off}
                            className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-700"
                          >
                            {d.toLocaleDateString("sv-SE", { month: "long" })}: {label}
                          </span>
                        ) : null;
                      })}
                    </div>
                  )}

                  <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-[color:var(--line)] pt-5">
                    <div className="flex items-center gap-3">
                      <Users size={17} className="text-[color:var(--ink)]/60" />
                      <span className="text-[14px] font-medium">Antal gäster</span>
                      <div className="flex items-center gap-2">
                        <RoundBtn onClick={() => setGuests((g) => Math.max(1, g - 1))} label="−" />
                        <span className="w-6 text-center font-semibold tabular-nums">{guests}</span>
                        <RoundBtn onClick={() => setGuests((g) => Math.min(6, g + 1))} label="+" />
                      </div>
                    </div>
                    <div className="text-[14px]">
                      {nights > 0 ? (
                        <span className="font-semibold text-[color:var(--success)]">
                          ✓ {fmtDate(checkIn!)} → {fmtDate(checkOut!)} · {nights}{" "}
                          {nights === 1 ? "natt" : "nätter"}
                        </span>
                      ) : (
                        <span className="text-[color:var(--ink)]/50">
                          Välj inchecknings- och utcheckningsdatum
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </StepShell>
            )}

            {/* STEG 2 — Enhet */}
            {step === 1 && (
              <StepShell key="s1">
                <StepTitle
                  eyebrow="Steg 2 av 4"
                  title="Välj ditt boende"
                  sub={`${nights} ${nights === 1 ? "natt" : "nätter"} · ${fmtDate(checkIn!)} – ${fmtDate(checkOut!)} · ${guests} gäster`}
                />
                <div className="mt-6 space-y-4">
                  {BOOKING_UNITS.map((u) => {
                    const fits = u.capacity >= guests;
                    const free = fits && isRangeAvailable(u.id, checkIn!, nights);
                    const price = free ? rangeTotal(u, checkIn!, nights) : 0;
                    const selected = unitId === u.id;
                    return (
                      <button
                        key={u.id}
                        disabled={!free}
                        onClick={() => setUnitId(u.id)}
                        className={`card-surface flex w-full items-center gap-4 p-4 text-left transition sm:gap-5 sm:p-5 ${
                          selected
                            ? "ring-2 ring-[color:var(--brass)]"
                            : free
                              ? "hover:-translate-y-0.5 hover:shadow-[0_14px_35px_rgba(20,36,28,0.1)]"
                              : "cursor-not-allowed opacity-50"
                        }`}
                      >
                        <span
                          className={`grid h-20 w-20 shrink-0 place-items-center rounded-[20px] text-4xl ring-1 ring-[color:var(--line)] ${
                            u.type === "stuga"
                              ? "bg-gradient-to-br from-[color:var(--forest)]/12 to-[color:var(--brass)]/15"
                              : "bg-gradient-to-br from-amber-100/70 to-emerald-100/60"
                          }`}
                        >
                          {u.imageEmoji}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-sans text-[16px] font-bold">{u.name}</h3>
                            <span className="rounded-full bg-[color:var(--bg)] px-2 py-0.5 text-[11px] font-medium text-[color:var(--ink)]/60">
                              {u.type === "stuga" ? "Stuga" : "Tält"} · {u.capacity} bäddar
                            </span>
                          </div>
                          <p className="mt-0.5 line-clamp-1 text-[13px] text-[color:var(--ink)]/60">
                            {u.blurb}
                          </p>
                          {!fits && (
                            <p className="mt-1 text-[12px] font-medium text-red-600">
                              För litet för {guests} gäster
                            </p>
                          )}
                          {fits && !free && (
                            <p className="mt-1 text-[12px] font-medium text-red-600">
                              Ej ledig dessa datum
                            </p>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          {free ? (
                            <>
                              <div className="font-[Fraunces] text-xl font-semibold">
                                {fmtKr(price)}
                              </div>
                              <div className="text-[11px] text-[color:var(--ink)]/50">
                                {fmtKr(Math.round(price / nights))}/natt
                              </div>
                            </>
                          ) : (
                            <span className="text-[12px] text-[color:var(--ink)]/45">—</span>
                          )}
                        </div>
                        {selected && (
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[color:var(--brass)] text-white">
                            <Check size={15} strokeWidth={3} />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-4 text-[13px] text-[color:var(--ink)]/55">
                  Städavgift {fmtKr(CLEANING_FEE)} tillkommer alltid — lakan och handdukar ingår.
                </p>
              </StepShell>
            )}

            {/* STEG 3 — Tillval */}
            {step === 2 && (
              <StepShell key="s2">
                <StepTitle
                  eyebrow="Steg 3 av 4"
                  title="Tillval till vistelsen"
                  sub="Gör vistelsen komplett — frukost, upplevelser och smarta paket."
                />

                {/* Paket (bundles) */}
                <div className="mt-6 grid gap-3 sm:grid-cols-3">
                  {BUNDLES.map((b) => {
                    const active = bundle?.id === b.id;
                    return (
                      <button
                        key={b.id}
                        onClick={() => setBundle(active ? null : b)}
                        className={`relative rounded-[18px] border p-4 text-left transition ${
                          active
                            ? "border-[color:var(--brass)] bg-amber-50/60 ring-2 ring-[color:var(--brass)]"
                            : "border-[color:var(--line)] bg-white hover:-translate-y-0.5 hover:shadow-[0_12px_30px_rgba(20,36,28,0.1)]"
                        }`}
                      >
                        <span className="absolute right-3 top-3 rounded-full bg-[color:var(--success)] px-2 py-0.5 text-[11px] font-bold text-white">
                          Spara {fmtKr(b.compareAt - b.price)}
                        </span>
                        <span className="text-2xl">{b.emoji}</span>
                        <h3 className="mt-2 font-sans text-[15px] font-bold">{b.name}</h3>
                        <p className="mt-1 line-clamp-3 text-[12px] leading-snug text-[color:var(--ink)]/60">
                          {b.tagline}
                        </p>
                        <div className="mt-3 flex items-baseline gap-2">
                          <span className="font-[Fraunces] text-lg font-semibold">
                            {fmtKr(b.price)}
                          </span>
                          <span className="text-[12px] text-[color:var(--ink)]/45 line-through">
                            {fmtKr(b.compareAt)}
                          </span>
                        </div>
                        <span
                          className={`mt-3 block rounded-full py-1.5 text-center text-[12px] font-semibold ${
                            active ? "bg-[color:var(--brass)] text-white" : "bg-[color:var(--bg)]"
                          }`}
                        >
                          {active ? "✓ Tillagt" : "Lägg till paket"}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Kategorifilter */}
                {(() => {
                  const activeAddons = getAddons().filter((a) => a.active);
                  const visible =
                    addonGroup === "alla"
                      ? activeAddons
                      : activeAddons.filter((a) => a.category === addonGroup);
                  const tabs = [
                    { id: "alla" as const, label: "Alla", emoji: "✨" },
                    { id: "mat" as const, label: ADDON_CATEGORY_LABELS.mat, emoji: "🧺" },
                    {
                      id: "upplevelse" as const,
                      label: ADDON_CATEGORY_LABELS.upplevelse,
                      emoji: "🛶",
                    },
                    { id: "hyra" as const, label: ADDON_CATEGORY_LABELS.hyra, emoji: "🚲" },
                    {
                      id: "praktiskt" as const,
                      label: ADDON_CATEGORY_LABELS.praktiskt,
                      emoji: "🧸",
                    },
                  ];
                  return (
                    <>
                      <div className="scrollbar-none -mx-1 mt-5 flex gap-2 overflow-x-auto px-1 pb-1">
                        {tabs.map((g) => {
                          const n =
                            g.id === "alla"
                              ? activeAddons.length
                              : activeAddons.filter((a) => a.category === g.id).length;
                          return (
                            <button
                              key={g.id}
                              onClick={() => setAddonGroup(g.id)}
                              className={`flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-medium transition ${
                                addonGroup === g.id
                                  ? "bg-[color:var(--forest)] text-white shadow-sm"
                                  : "bg-[color:var(--line)]/40 text-[color:var(--ink)]/60 hover:bg-[color:var(--line)]/70"
                              }`}
                            >
                              <span>{g.emoji}</span>
                              {g.label}
                              <span
                                className={
                                  addonGroup === g.id
                                    ? "text-white/60"
                                    : "text-[color:var(--ink)]/40"
                                }
                              >
                                {n}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      <div className="mt-4 space-y-3">
                        {visible.map((a) => {
                          const qty = cart[a.id] ?? 0;
                          const resource = RESOURCES.find((r) => r.addonId === a.id);
                          const stock =
                            resource && checkIn ? resourceLeft(resource.id, checkIn) : null;
                          const soldOut = stock !== null && stock === 0;
                          return (
                            <div
                              key={a.id}
                              className={`card-surface p-4 transition ${qty > 0 ? "ring-2 ring-[color:var(--brass)]" : ""} ${soldOut ? "opacity-55" : ""}`}
                            >
                              <div className="flex items-center gap-4">
                                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[color:var(--bg)] text-2xl">
                                  {a.emoji}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-baseline justify-between gap-2">
                                    <h3 className="font-sans text-[15px] font-semibold">
                                      {a.name}
                                    </h3>
                                    <span className="shrink-0 text-[15px] font-semibold text-[color:var(--brass)]">
                                      {fmtKr(a.price)}
                                    </span>
                                  </div>
                                  <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-[color:var(--ink)]/60">
                                    {a.description}
                                  </p>
                                  {a.partner && (
                                    <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-[color:var(--brass)]/10 px-2 py-0.5 text-[10px] font-semibold text-[color:var(--brass)]">
                                      🤝 {a.partner.name}
                                    </span>
                                  )}
                                  {stock !== null && (
                                    <span
                                      className={`mt-1.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                        soldOut
                                          ? "bg-red-50 text-red-700"
                                          : stock <= 2
                                            ? "bg-amber-100 text-amber-800"
                                            : "bg-[color:var(--bg)] text-[color:var(--ink)]/60"
                                      }`}
                                    >
                                      {soldOut ? "Slut för dagen" : `${stock} kvar för dina datum`}
                                    </span>
                                  )}
                                </div>
                                {qty === 0 ? (
                                  <button
                                    onClick={() => setQty(a.id, 1)}
                                    disabled={soldOut}
                                    className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[color:var(--forest)] text-white transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-30"
                                    aria-label={`Lägg till ${a.name}`}
                                  >
                                    <Plus size={18} />
                                  </button>
                                ) : (
                                  <div className="flex shrink-0 items-center gap-2">
                                    <RoundBtn
                                      onClick={() => setQty(a.id, qty - 1)}
                                      label="−"
                                      small
                                    />
                                    <span className="w-5 text-center font-semibold tabular-nums">
                                      {qty}
                                    </span>
                                    <button
                                      onClick={() => setQty(a.id, qty + 1)}
                                      className="grid h-8 w-8 place-items-center rounded-full bg-[color:var(--forest)] text-white"
                                      aria-label="Öka"
                                    >
                                      <Plus size={15} />
                                    </button>
                                  </div>
                                )}
                              </div>
                              {/* Tidsspecifikt tillval — bastu */}
                              {a.id === "bastu" && qty > 0 && (
                                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[color:var(--line)] pt-3">
                                  <span className="text-[12px] font-medium text-[color:var(--ink)]/60">
                                    Välj tid (ankomstdagen):
                                  </span>
                                  {SAUNA_TIMES.map((t) => (
                                    <button
                                      key={t}
                                      onClick={() => setSaunaTime(t)}
                                      className={`rounded-full px-3 py-1.5 text-[13px] font-semibold transition ${
                                        saunaTime === t
                                          ? "bg-[color:var(--forest)] text-white"
                                          : "border border-[color:var(--line)] hover:bg-[color:var(--bg)]"
                                      }`}
                                    >
                                      {t}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  );
                })()}

                {/* Ombokningsgaranti */}
                <button
                  onClick={() => setRebooking((r) => !r)}
                  className={`mt-4 flex w-full items-center gap-4 rounded-[18px] border p-4 text-left transition ${
                    rebooking
                      ? "border-[color:var(--brass)] bg-amber-50/60 ring-2 ring-[color:var(--brass)]"
                      : "border-[color:var(--line)] bg-white hover:bg-[color:var(--bg)]/50"
                  }`}
                >
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[color:var(--forest)]/10 text-2xl">
                    {REBOOKING_GUARANTEE.emoji}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="font-sans text-[15px] font-semibold">
                        {REBOOKING_GUARANTEE.name}
                      </h3>
                      <span className="text-[15px] font-semibold text-[color:var(--brass)]">
                        {fmtKr(REBOOKING_GUARANTEE.price)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[13px] leading-snug text-[color:var(--ink)]/60">
                      {REBOOKING_GUARANTEE.description}
                    </p>
                  </div>
                  <span
                    className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 transition ${
                      rebooking
                        ? "border-[color:var(--brass)] bg-[color:var(--brass)] text-white"
                        : "border-[color:var(--line)]"
                    }`}
                  >
                    {rebooking && <Check size={15} strokeWidth={3} />}
                  </span>
                </button>
              </StepShell>
            )}

            {/* STEG 4 — Uppgifter & betalning */}
            {step === 3 && (
              <StepShell key="s3">
                <StepTitle
                  eyebrow="Steg 4 av 4"
                  title="Dina uppgifter"
                  sub="Bekräftelsen landar direkt som mejl och SMS."
                />
                <div className="card-surface mt-6 space-y-4 p-6">
                  <Field icon={User} label="Fullständigt namn">
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Anna Lindqvist"
                      className="w-full rounded-xl border border-[color:var(--line)] bg-[color:var(--bg)] px-4 py-3 text-[15px] outline-none focus:border-[color:var(--brass)]"
                    />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field icon={Mail} label="E-post">
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="anna@example.se"
                        className="w-full rounded-xl border border-[color:var(--line)] bg-[color:var(--bg)] px-4 py-3 text-[15px] outline-none focus:border-[color:var(--brass)]"
                      />
                    </Field>
                    <Field icon={Phone} label="Mobilnummer">
                      <input
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="070 123 45 67"
                        className="w-full rounded-xl border border-[color:var(--line)] bg-[color:var(--bg)] px-4 py-3 text-[15px] outline-none focus:border-[color:var(--brass)]"
                      />
                    </Field>
                  </div>
                  <Field icon={Tag} label="Kampanjkod (valfritt — testa KANAL10)">
                    <div className="flex gap-2">
                      <input
                        value={promo}
                        onChange={(e) => {
                          setPromo(e.target.value.toUpperCase());
                          setPromoApplied(null);
                        }}
                        placeholder="KANAL10"
                        className="w-full rounded-xl border border-[color:var(--line)] bg-[color:var(--bg)] px-4 py-3 text-[15px] uppercase tracking-widest outline-none focus:border-[color:var(--brass)]"
                      />
                      <button
                        onClick={applyPromo}
                        disabled={!promo.trim()}
                        className="btn-ghost shrink-0 !rounded-xl !px-4 !py-3 text-[14px]"
                      >
                        Aktivera
                      </button>
                    </div>
                    {promoApplied && (
                      <p className="mt-1.5 text-[13px] font-semibold text-[color:var(--success)]">
                        ✓ {promoApplied * 100} % rabatt aktiverad
                      </p>
                    )}
                    {promoApplied === null && promo.trim() && (
                      <p className="mt-1.5 text-[13px] text-[color:var(--ink)]/50">
                        Koden är inte giltig — prova KANAL10
                      </p>
                    )}
                  </Field>
                </div>

                {/* Betalsätt */}
                <div className="mt-5 grid grid-cols-2 gap-2 rounded-2xl border border-[color:var(--line)] bg-white p-1.5">
                  <button
                    onClick={() => setPayTab("vanlig")}
                    className={`flex items-center justify-center gap-2 rounded-xl py-2.5 text-[14px] font-semibold transition ${
                      payTab === "vanlig"
                        ? "bg-[color:var(--forest)] text-white"
                        : "text-[color:var(--ink)]/60"
                    }`}
                  >
                    <Smartphone size={15} /> Swish / kort
                  </button>
                  <button
                    onClick={() => setPayTab("presentkort")}
                    className={`flex items-center justify-center gap-2 rounded-xl py-2.5 text-[14px] font-semibold transition ${
                      payTab === "presentkort"
                        ? "bg-[color:var(--forest)] text-white"
                        : "text-[color:var(--ink)]/60"
                    }`}
                  >
                    <Gift size={15} /> Presentkort
                  </button>
                </div>

                {payTab === "presentkort" && (
                  <div className="card-surface mt-3 p-4">
                    <div className="flex gap-2">
                      <input
                        value={giftCode}
                        onChange={(e) => {
                          setGiftCode(e.target.value.toUpperCase());
                          setGiftStatus("idle");
                          setGiftApplied(0);
                        }}
                        placeholder="Presentkortskod — prova SOMMAR26"
                        className="w-full rounded-xl border border-[color:var(--line)] bg-[color:var(--bg)] px-4 py-3 font-mono text-[14px] uppercase tracking-widest outline-none focus:border-[color:var(--brass)]"
                      />
                      <button
                        onClick={applyGiftCard}
                        disabled={!giftCode.trim()}
                        className="btn-ghost shrink-0 !rounded-xl !px-4 !py-3 text-[14px]"
                      >
                        Lös in
                      </button>
                    </div>
                    {giftStatus === "ok" && (
                      <p className="mt-2 text-[13px] font-semibold text-[color:var(--success)]">
                        ✓ {fmtKr(giftApplied)} inlöst från presentkortet
                      </p>
                    )}
                    {giftStatus === "fel" && (
                      <p className="mt-2 text-[13px] text-red-600">
                        Koden hittades inte — prova SOMMAR26 eller KANAL500
                      </p>
                    )}
                  </div>
                )}

                <button
                  onClick={pay}
                  disabled={!detailsValid || paying}
                  className="btn-primary mt-6 w-full !rounded-2xl !py-4 text-[16px] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {paying ? (
                    <>
                      <Loader2 size={18} className="animate-spin" /> Behandlar betalning…
                    </>
                  ) : total === 0 ? (
                    <>
                      <Check size={18} /> Bekräfta bokning — allt betalt med presentkort
                    </>
                  ) : (
                    <>
                      <ShieldCheck size={18} /> Betala {fmtKr(total)}
                      {giftDeduction > 0 ? " — resterande via Swish/kort" : " — Swish eller kort"}
                    </>
                  )}
                </button>
                <p className="mt-3 flex items-center justify-center gap-4 text-[12px] text-[color:var(--ink)]/50">
                  <span className="flex items-center gap-1">
                    <Smartphone size={13} /> Swish
                  </span>
                  <span className="flex items-center gap-1">
                    <Banknote size={13} /> Kort
                  </span>
                  <span className="flex items-center gap-1">
                    <Gift size={13} /> Presentkort
                  </span>
                  <span>Demo</span>
                </p>
              </StepShell>
            )}

            {/* STEG 5 — Bekräftelse */}
            {step === 4 && bookingRef && (
              <motion.div
                key="s4"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                className="mx-auto max-w-lg text-center"
              >
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", delay: 0.15 }}
                  className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-[color:var(--success)] text-white"
                >
                  <PartyPopper size={34} />
                </motion.span>
                <h1 className="mt-5 text-3xl">Bokningen är klar!</h1>
                <p className="mt-2 text-[15px] text-[color:var(--ink)]/65">
                  Vi ser fram emot att välkomna dig, {name.split(" ")[0]}!
                </p>

                <div className="card-surface mt-6 p-6 text-left">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-semibold uppercase tracking-wide text-[color:var(--ink)]/50">
                      Bokningsnummer
                    </span>
                    <span className="rounded-full bg-[color:var(--forest)] px-3 py-1 font-mono text-[13px] font-bold text-white">
                      {bookingRef}
                    </span>
                  </div>
                  <div className="mt-4 space-y-2 text-[14px]">
                    <Row k="Boende" v={`${unit?.imageEmoji} ${unit?.name}`} />
                    <Row k="Datum" v={`${fmtDateLong(checkIn!)} → ${fmtDate(checkOut!)}`} />
                    <Row k="Gäster" v={String(guests)} />
                    {bundle && <Row k={`${bundle.emoji} ${bundle.name}`} v={fmtKr(bundle.price)} />}
                    {rebooking && (
                      <Row
                        k={`${REBOOKING_GUARANTEE.emoji} ${REBOOKING_GUARANTEE.name}`}
                        v={fmtKr(REBOOKING_GUARANTEE.price)}
                      />
                    )}
                    {cartItems.map(({ addon, qty }) => (
                      <Row
                        key={addon.id}
                        k={addon.name}
                        v={`×${qty}${addon.id === "bastu" ? ` · kl ${saunaTime}` : ""}`}
                      />
                    ))}
                    {giftDeduction > 0 && (
                      <div className="flex justify-between text-[color:var(--success)]">
                        <span>🎁 Presentkort inlöst</span>
                        <span className="font-semibold">−{fmtKr(giftDeduction)}</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-[color:var(--line)] pt-3 font-semibold">
                      <span>{total === 0 ? "Betalt med presentkort" : "Betalt"}</span>
                      <span className="tabular-nums">{fmtKr(total)}</span>
                    </div>
                  </div>
                </div>

                {/* StayBoost-automationen tar vid */}
                <div className="card-surface mt-4 p-5 text-left">
                  <div className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-wide text-[color:var(--brass)]">
                    <MessageSquareText size={15} /> Det här händer nu — automatiskt
                  </div>
                  <ul className="mt-3 space-y-2.5 text-[13px] text-[color:var(--ink)]/70">
                    <li className="flex gap-2.5">
                      <Check size={15} className="mt-0.5 shrink-0 text-[color:var(--success)]" />
                      Bekräftelse skickad till {email || "din mejl"} och {phone || "din mobil"}
                    </li>
                    <li className="flex gap-2.5">
                      <Check size={15} className="mt-0.5 shrink-0 text-[color:var(--success)]" />
                      Bokningen syns direkt i ägarens dashboard och kalender
                    </li>
                    <li className="flex gap-2.5">
                      <Check size={15} className="mt-0.5 shrink-0 text-[color:var(--success)]" />
                      Två dagar före ankomst: välkomst-SMS med all info
                    </li>
                    <li className="flex gap-2.5">
                      <Check size={15} className="mt-0.5 shrink-0 text-[color:var(--success)]" />
                      På ankomstdagen: incheckningslänk och portkod
                    </li>
                  </ul>
                </div>

                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  <Link
                    to="/demo/gast"
                    className="btn-primary flex-1 !rounded-2xl !py-3.5 text-[15px]"
                  >
                    Öppna din gästsida <ArrowRight size={16} />
                  </Link>
                  <Link
                    to="/demo/bokningar"
                    className="btn-ghost flex-1 !rounded-2xl !py-3.5 text-[15px]"
                  >
                    Se i ägarkalendern
                  </Link>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Navigationsknappar */}
          {step < 3 && (
            <div className="mt-6 hidden flex-col gap-2 lg:flex">
              <div className="flex gap-3">
                {step > 0 && (
                  <button onClick={() => setStep((s) => s - 1)} className="btn-ghost !rounded-2xl">
                    <ArrowLeft size={17} />
                  </button>
                )}
                <button
                  onClick={() => setStep((s) => s + 1)}
                  disabled={!canNext}
                  className="btn-primary flex-1 !rounded-2xl disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {step === 2 ? "Till betalning" : "Fortsätt"} <ArrowRight size={17} />
                </button>
              </div>
              {!canNext && <p className="text-[13px] text-[color:var(--ink)]/50">{stepHint}</p>}
            </div>
          )}
          {step === 3 && (
            <button
              onClick={() => setStep(2)}
              className="mt-4 flex items-center gap-1.5 text-[14px] font-medium text-[color:var(--ink)]/60 hover:text-[color:var(--ink)]"
            >
              <ArrowLeft size={15} /> Ändra tillval
            </button>
          )}
        </div>

        {/* ---------- Höger: prissammanfattning ---------- */}
        {step < 4 && (
          <aside className="lg:sticky lg:top-32 lg:self-start">
            <div className="card-surface p-5">
              <h2 className="flex items-center gap-2 font-sans text-[15px] font-bold">
                <BedDouble size={16} className="text-[color:var(--brass)]" />
                Din bokning
              </h2>
              <div className="mt-3 space-y-2 text-[14px]">
                <Row
                  k="Datum"
                  v={
                    checkIn && checkOut
                      ? `${fmtDate(checkIn)} → ${fmtDate(checkOut)}`
                      : "Inte valt än"
                  }
                />
                <Row k="Nätter" v={nights > 0 ? String(nights) : "—"} />
                <Row k="Gäster" v={String(guests)} />
                <Row k="Boende" v={unit ? `${unit.imageEmoji} ${unit.name}` : "Inte valt än"} />
              </div>
              <div className="mt-4 space-y-2 border-t border-[color:var(--line)] pt-4 text-[14px]">
                {lodging > 0 && <Row k="Boende" v={fmtKr(lodging)} />}
                {lodging > 0 && <Row k="Städavgift" v={fmtKr(CLEANING_FEE)} />}
                {bundle && <Row k={`${bundle.emoji} ${bundle.name}`} v={fmtKr(bundle.price)} />}
                {rebooking && (
                  <Row
                    k={`${REBOOKING_GUARANTEE.emoji} ${REBOOKING_GUARANTEE.name}`}
                    v={fmtKr(REBOOKING_GUARANTEE.price)}
                  />
                )}
                {cartItems.map(({ addon, qty }) => (
                  <Row
                    key={addon.id}
                    k={`${addon.name}${qty > 1 ? ` × ${qty}` : ""}`}
                    v={fmtKr(addon.price * qty)}
                  />
                ))}
                {discount > 0 && (
                  <div className="flex justify-between text-[color:var(--success)]">
                    <span>Rabatt ({promo})</span>
                    <span className="font-semibold">−{fmtKr(discount)}</span>
                  </div>
                )}
                {giftDeduction > 0 && (
                  <div className="flex justify-between text-[color:var(--success)]">
                    <span>🎁 Presentkort</span>
                    <span className="font-semibold">−{fmtKr(giftDeduction)}</span>
                  </div>
                )}
              </div>
              <div className="mt-4 flex items-baseline justify-between border-t border-[color:var(--line)] pt-4">
                <span className="font-semibold">Totalt</span>
                <span className="font-[Fraunces] text-2xl font-semibold tabular-nums">
                  {fmtKr(total)}
                </span>
              </div>
              <p className="mt-2 text-[12px] text-[color:var(--ink)]/50">
                Fri avbokning till 14 dagar före ankomst. Moms ingår.
              </p>
            </div>
          </aside>
        )}
      </div>
      {/* Mobil: klistrad totalrad så priset alltid syns medan man väljer */}
      {step < 4 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[color:var(--line)] bg-white/92 px-4 py-3 backdrop-blur lg:hidden">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
            <div className="min-w-0">
              {total > 0 ? (
                <>
                  <p className="text-[11px] font-medium text-[color:var(--ink)]/55">
                    Totalt{nights > 0 ? ` · ${nights} ${nights === 1 ? "natt" : "nätter"}` : ""}
                  </p>
                  <p className="font-[Fraunces] text-xl font-semibold leading-tight tabular-nums">
                    {fmtKr(total)}
                  </p>
                </>
              ) : (
                <p className="text-[13px] font-medium text-[color:var(--ink)]/60">{stepHint}</p>
              )}
            </div>
            {step < 3 ? (
              <button
                onClick={() => setStep((s) => s + 1)}
                disabled={!canNext}
                className="btn-primary shrink-0 !rounded-2xl !px-5 !py-3 text-[15px] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {step === 2 ? "Till betalning" : "Fortsätt"} <ArrowRight size={16} />
              </button>
            ) : (
              <span className="shrink-0 text-[12px] text-[color:var(--ink)]/50">inkl. moms</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Små komponenter ---------- */
function StepShell({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.28 }}
    >
      {children}
    </motion.div>
  );
}

function StepTitle({ eyebrow, title, sub }: { eyebrow: string; title: string; sub: string }) {
  return (
    <div>
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="mt-2 text-3xl">{title}</h1>
      <p className="mt-2 text-[15px] text-[color:var(--ink)]/65">{sub}</p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-[color:var(--ink)]/60">{k}</span>
      <span className="text-right font-medium tabular-nums">{v}</span>
    </div>
  );
}

function RoundBtn({
  onClick,
  label,
  small,
}: {
  onClick: () => void;
  label: string;
  small?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`grid place-items-center rounded-full border border-[color:var(--line)] transition hover:bg-[color:var(--bg)] ${
        small ? "h-8 w-8 text-sm" : "h-9 w-9"
      }`}
      aria-label={label === "+" ? "Öka" : "Minska"}
    >
      {label === "+" ? <Plus size={15} /> : <Minus size={15} />}
    </button>
  );
}

function Field({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof User;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-[color:var(--ink)]/70">
        <Icon size={14} />
        {label}
      </label>
      {children}
    </div>
  );
}

function addMonths(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function monthName(today: Date, offset: number) {
  const d = addMonths(today, offset);
  return d.toLocaleDateString("sv-SE", { month: "long" });
}

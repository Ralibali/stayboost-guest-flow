import { Link, createFileRoute } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronLeft, ChevronRight, Copy, Loader2, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { LOCALES, LANGS, detectLang, getStrings, persistLang, type Lang } from "@/lib/boka-i18n";
import {
  nightlyPrice,
  quoteStay,
  rangesOverlap,
  type UnitPricing,
} from "../../../supabase/functions/_shared/pricing";

export const Route = createFileRoute("/boka/$slug")({
  component: PublicBookingPage,
});

/* ---------- Design: skandinavisk minimalism ---------- */

const C = {
  bg: "#FAFAF8",
  ink: "#1B1B19",
  muted: "#8B8B85",
  line: "#E7E7E1",
  soft: "#F1F1EC",
} as const;

const eyebrow = "text-[11px] font-semibold uppercase tracking-[0.18em]";
const hairline = "border-[#E7E7E1]";
const divideHairline = "divide-[#E7E7E1]";

/* ---------- Typer + API ---------- */

type EngineUnit = {
  id: string;
  name: string;
  maxGuests: number;
  basePrice: number;
  weekendPct: number;
  minStay: number;
  cleaningFee: number;
  monthlyMult: number[];
  booked: { from: string; to: string }[];
};

type EngineAddonPriceType =
  | "per_booking"
  | "per_night"
  | "per_person"
  | "per_person_per_night";

type EngineAddon = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  priceType: EngineAddonPriceType;
  imageUrl: string | null;
  capacityPerDay?: number | null;
};

type EngineData = {
  property: {
    name: string;
    slug: string;
    checkinTime: string;
    checkoutTime: string;
    swishNumber: string | null;
    stripeAvailable: boolean;
  };
  units: EngineUnit[];
  addons: EngineAddon[];
};

const FUNCTIONS_BASE = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(
  /\/$/,
  "",
);

const isoToday = () => new Date().toISOString().slice(0, 10);
const isoOf = (d: Date) => d.toISOString().slice(0, 10);
const isPersonAddon = (addon: EngineAddon) =>
  addon.priceType === "per_person" || addon.priceType === "per_person_per_night";

const pricingOf = (u: EngineUnit): UnitPricing => ({
  base_price: u.basePrice,
  weekend_pct: u.weekendPct,
  cleaning_fee: u.cleaningFee,
  monthly_mult: (u.monthlyMult ?? []).map(Number),
});

const isBooked = (u: EngineUnit, iso: string) => u.booked.some((r) => iso >= r.from && iso < r.to);
const rangeFree = (u: EngineUnit, from: string, to: string) =>
  !u.booked.some((r) => rangesOverlap(from, to, r.from, r.to));

function PublicBookingPage() {
  const { slug } = Route.useParams();
  const [lang, setLangState] = useState<Lang>(detectLang);
  const t = getStrings(lang);
  const locale = LOCALES[lang];
  const setLang = (l: Lang) => {
    setLangState(l);
    persistLang(l);
  };

  const svDate = (iso: string) =>
    new Date(iso + "T12:00:00").toLocaleDateString(locale, { day: "numeric", month: "short" });
  const svLong = (iso: string) =>
    new Date(iso + "T12:00:00").toLocaleDateString(locale, {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  const fmtKr = (n: number) => `${n.toLocaleString(locale)} kr`;
  const addonSuffix = (a: EngineAddon) => {
    if (a.priceType === "per_night") return t.perNight;
    if (a.priceType === "per_person") return lang === "sv" ? "/person" : "/person";
    if (a.priceType === "per_person_per_night")
      return lang === "sv" ? "/person & dygn" : "/person & day";
    return "";
  };

  const [data, setData] = useState<EngineData | null>(null);
  const [error, setError] = useState(false);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [monthOffset, setMonthOffset] = useState(0);
  const [checkin, setCheckin] = useState<string | null>(null);
  const [checkout, setCheckout] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [guests, setGuests] = useState(2);
  const [addonQty, setAddonQty] = useState<Record<string, number>>({});
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [payChoice, setPayChoice] = useState<"stripe" | "swish" | null>(null);
  const [done, setDone] = useState<{
    token: string;
    total: number;
    swishNumber?: string;
    paymentRef?: string;
  } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!FUNCTIONS_BASE) {
      setError(true);
      return;
    }
    fetch(`${FUNCTIONS_BASE}/functions/v1/booking-engine?slug=${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: EngineData) => {
        setData(d);
        if (d.units.length > 0) {
          setUnitId(d.units[0].id);
          setGuests(Math.min(2, d.units[0].maxGuests || 2));
        }
      })
      .catch(() => setError(true));
  }, [slug]);

  const unit = data?.units.find((u) => u.id === unitId) ?? null;
  const pricing = unit ? pricingOf(unit) : null;

  const quote = useMemo(
    () => (pricing && checkin && checkout ? quoteStay(pricing, checkin, checkout) : null),
    [pricing, checkin, checkout],
  );

  const chosenAddons = useMemo(() => {
    if (!data || !quote) return [];
    return data.addons
      .filter((a) => (addonQty[a.id] ?? 0) > 0)
      .map((a) => {
        const qty = addonQty[a.id];
        const repeatsByNight = a.priceType === "per_night" || a.priceType === "per_person_per_night";
        const lineTotal = a.price * qty * (repeatsByNight ? quote.nights : 1);
        return { ...a, qty, lineTotal };
      });
  }, [data, quote, addonQty]);
  const addonsTotal = chosenAddons.reduce((s, a) => s + a.lineTotal, 0);
  const grandTotal = (quote?.total ?? 0) + addonsTotal;

  const pick = (iso: string) => {
    if (!unit) return;
    if (!checkin || (checkin && checkout) || iso < checkin) {
      setCheckin(iso);
      setCheckout(null);
      return;
    }
    if (iso === checkin) return;
    if (!rangeFree(unit, checkin, iso)) return;
    setCheckout(iso);
  };

  const minStayOk = !quote || !unit || quote.nights >= unit.minStay;
  const payMethods = data
    ? ([
        ...(data.property.stripeAvailable ? (["stripe"] as const) : []),
        ...(data.property.swishNumber ? (["swish"] as const) : []),
      ] as ("stripe" | "swish")[])
    : [];
  const payMethod = payChoice && payMethods.includes(payChoice) ? payChoice : (payMethods[0] ?? null);
  const canSubmit =
    Boolean(unit && quote && minStayOk && name.trim().length >= 2 && email.trim()) &&
    (payMethod !== "swish" || Boolean(phone.trim())) &&
    !sending;

  const submit = async () => {
    if (!canSubmit || !unit || !checkin || !checkout) return;
    setSending(true);
    setFormError(null);
    try {
      const r = await fetch(`${FUNCTIONS_BASE}/functions/v1/booking-engine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          unitId: unit.id,
          checkin,
          checkout,
          guest_name: name.trim(),
          guest_email: email.trim(),
          guest_phone: phone.trim(),
          guests,
          addons: Object.entries(addonQty)
            .filter(([, q]) => q > 0)
            .map(([id, quantity]) => ({ id, quantity })),
          ...(payMethod ? { paymentMethod: payMethod } : {}),
          termsAccepted: true,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setFormError(
          d.error === "unavailable"
            ? t.errUnavailable
            : d.error === "min_stay"
              ? t.errMinStay(d.minStay)
              : d.error === "capacity_exceeded"
                ? t.errGeneric
                : d.error === "addon_capacity_exceeded"
                  ? lang === "sv"
                    ? "Det valda tillvalet är fullbokat någon av dagarna."
                    : "The selected extra is sold out for one of the days."
                  : d.error === "contact_required" || d.error === "email_required"
                    ? t.errContact
                    : d.error === "stripe_failed"
                      ? t.errStripe
                      : t.errGeneric,
        );
      } else if (d.checkoutUrl) {
        window.location.href = d.checkoutUrl;
        return;
      } else {
        setDone({
          token: d.guestToken,
          total: d.grandTotal ?? d.price.total,
          swishNumber: d.swishNumber,
          paymentRef: d.paymentRef,
        });
        window.scrollTo({ top: 0 });
      }
    } catch {
      setFormError(t.errGeneric);
    }
    setSending(false);
  };

  if (error) {
    return (
      <div className="grid min-h-screen place-items-center px-6 text-center" style={{ background: C.bg, color: C.ink }}>
        <div>
          <p className="font-[Fraunces] text-3xl">{t.notFoundTitle}</p>
          <p className="mt-3 text-[15px]" style={{ color: C.muted }}>{t.notFoundBody}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="grid min-h-screen place-items-center" style={{ background: C.bg }}>
        <Loader2 className="animate-spin" style={{ color: C.muted }} size={28} />
      </div>
    );
  }

  const guestUrl = done ? `${window.location.origin}/g/${done.token}` : null;

  return (
    <div className="min-h-screen pb-24" style={{ background: C.bg, color: C.ink }}>
      <div className="absolute right-5 top-5 flex gap-1 text-[11px] font-semibold tracking-wider">
        {LANGS.map((l) => (
          <button key={l.id} onClick={() => setLang(l.id)} className="rounded-full px-2.5 py-1 transition" style={{ color: lang === l.id ? "#fff" : C.muted, background: lang === l.id ? C.ink : "transparent" }}>
            {l.label}
          </button>
        ))}
      </div>

      <div className="mx-auto max-w-xl px-5 pt-14">
        <header className={`border-b pb-8 ${hairline}`}>
          <p className={eyebrow} style={{ color: C.muted }}>{t.bookDirect}</p>
          <h1 className="mt-3 font-[Fraunces] text-[38px] leading-[1.1]">{data.property.name}</h1>
          <p className="mt-3 text-[14px]" style={{ color: C.muted }}>
            {t.checkinFrom(data.property.checkinTime)} &nbsp;·&nbsp; {t.checkoutAt(data.property.checkoutTime)}
          </p>
        </header>

        {done ? (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="pt-12 text-center">
            <span className="mx-auto grid h-16 w-16 place-items-center rounded-full" style={{ border: `1px solid ${C.ink}` }}><Check size={24} /></span>
            <h2 className="mt-6 font-[Fraunces] text-3xl">{t.thankYou}</h2>
            <p className="mx-auto mt-3 max-w-sm text-[15px] leading-relaxed" style={{ color: C.muted }}>
              {unit?.name} · {svLong(checkin!)} – {svLong(checkout!)} · {fmtKr(done.total)}<br />{t.confirmationOnWay}
            </p>

            {done.swishNumber && (
              <div className={`mt-8 border-y py-6 text-left ${hairline}`}>
                <p className={eyebrow} style={{ color: C.muted }}>{t.payWithSwish}</p>
                <p className="mt-3 text-[14px] leading-relaxed" style={{ color: C.muted }}>{t.swishInstructions(fmtKr(done.total))}</p>
                <div className="mt-4 space-y-2">
                  {[
                    { label: t.swishNumber, value: done.swishNumber, key: "nr" },
                    { label: t.messageLabel, value: done.paymentRef!, key: "ref" },
                  ].map((r) => (
                    <button key={r.key} onClick={() => { navigator.clipboard.writeText(r.value); setCopied(r.key); setTimeout(() => setCopied(null), 1500); }} className="flex w-full items-center justify-between py-2.5 text-left" style={{ borderBottom: `1px solid ${C.line}` }}>
                      <span><span className="block text-[11px]" style={{ color: C.muted }}>{r.label} — {t.tapToCopy}</span><span className="font-mono text-[16px] tracking-wide">{r.value}</span></span>
                      {copied === r.key ? <Check size={15} /> : <Copy size={15} style={{ color: C.muted }} />}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button onClick={() => { navigator.clipboard.writeText(guestUrl!); setCopied("link"); setTimeout(() => setCopied(null), 1500); }} className="mt-8 w-full rounded-full py-4 text-[15px] font-semibold text-white transition hover:opacity-85" style={{ background: C.ink }}>
              {copied === "link" ? t.linkCopied : t.copyGuestLink}
            </button>
            <a href={guestUrl!} className="mt-4 inline-block text-[14px] underline underline-offset-4" style={{ color: C.muted }}>{t.openGuestPage}</a>
          </motion.div>
        ) : (
          <>
            {data.units.length > 1 && (
              <section className="pt-10">
                <p className={eyebrow} style={{ color: C.muted }}>{t.lodging}</p>
                <div className={`mt-4 divide-y border-y ${hairline} ${divideHairline}`}>
                  {data.units.map((u) => {
                    const lowestMult = Math.min(...(u.monthlyMult ?? [70]).map(Number));
                    const selected = u.id === unitId;
                    return (
                      <button key={u.id} onClick={() => { setUnitId(u.id); setCheckin(null); setCheckout(null); setGuests(Math.min(2, u.maxGuests || 2)); setAddonQty({}); }} className="flex w-full items-center gap-4 py-4 text-left">
                        <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full" style={{ border: `1.5px solid ${selected ? C.ink : C.line}` }}>
                          {selected && <span className="h-[9px] w-[9px] rounded-full" style={{ background: C.ink }} />}
                        </span>
                        <span className="flex-1 text-[15px] font-medium">{u.name}</span>
                        <span className="text-[13px]" style={{ color: C.muted }}>{t.fromPerNight(fmtKr(Math.round((u.basePrice * lowestMult) / 100)))}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {unit && (
              <section className="pt-10">
                <p className={eyebrow} style={{ color: C.muted }}>{t.chooseDates}</p>
                <div className={`mt-4 border-y py-5 ${hairline}`}>
                  <div className="flex items-center justify-between px-1">
                    <button onClick={() => setMonthOffset((o) => Math.max(0, o - 1))} disabled={monthOffset === 0} className="grid h-9 w-9 place-items-center rounded-full transition disabled:opacity-25" aria-label={t.prevMonth}><ChevronLeft size={17} /></button>
                    <span className="text-[13px] font-semibold uppercase tracking-[0.14em]">
                      {new Date(new Date().getFullYear(), new Date().getMonth() + monthOffset, 1).toLocaleDateString(locale, { month: "long", year: "numeric" })}
                    </span>
                    <button onClick={() => setMonthOffset((o) => Math.min(11, o + 1))} className="grid h-9 w-9 place-items-center rounded-full" aria-label={t.nextMonth}><ChevronRight size={17} /></button>
                  </div>
                  <MonthCalendar monthOffset={monthOffset} unit={unit} pricing={pricing!} checkin={checkin} checkout={checkout} onPick={pick} weekdays={t.weekdays} locale={locale} />
                  <div className="mt-3 flex items-center justify-between px-1 text-[12px]" style={{ color: C.muted }}><span>{t.minStay(unit.minStay)}</span><span>{t.weekendUplift(unit.weekendPct)}</span></div>
                </div>
              </section>
            )}

            {unit && data.addons.length > 0 && (
              <section className="pt-10">
                <p className={eyebrow} style={{ color: C.muted }}>{t.addonsTitle}</p>
                <div className={`mt-4 divide-y border-y ${hairline} ${divideHairline}`}>
                  {data.addons.map((a) => {
                    const qty = addonQty[a.id] ?? 0;
                    const maxQty = isPersonAddon(a)
                      ? Math.max(1, guests)
                      : Math.min(20, a.capacityPerDay ?? 20);
                    return (
                      <div key={a.id} className="flex items-center gap-4 py-4">
                        {a.imageUrl ? <img src={a.imageUrl} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" /> : <div className="grid h-14 w-14 shrink-0 place-items-center rounded-lg" style={{ background: C.soft, color: C.muted }}><Plus size={16} /></div>}
                        <div className="min-w-0 flex-1">
                          <p className="text-[15px] font-medium">{a.name}</p>
                          {a.description && <p className="mt-0.5 line-clamp-1 text-[13px]" style={{ color: C.muted }}>{a.description}</p>}
                          <p className="mt-0.5 text-[13px]" style={{ color: C.muted }}>{fmtKr(a.price)}{addonSuffix(a)}</p>
                        </div>
                        {qty === 0 ? (
                          <button onClick={() => setAddonQty({ ...addonQty, [a.id]: 1 })} className="shrink-0 rounded-full px-4 py-2 text-[13px] font-semibold transition hover:opacity-70" style={{ border: `1px solid ${C.ink}` }}>{t.add}</button>
                        ) : (
                          <div className="flex shrink-0 items-center gap-3">
                            <button onClick={() => setAddonQty({ ...addonQty, [a.id]: qty - 1 })} className="grid h-8 w-8 place-items-center rounded-full text-[16px]" style={{ border: `1px solid ${C.line}` }} aria-label={t.decrease}>−</button>
                            <span className="w-4 text-center text-[14px] font-semibold">{qty}</span>
                            <button onClick={() => setAddonQty({ ...addonQty, [a.id]: Math.min(maxQty, qty + 1) })} disabled={qty >= maxQty} className="grid h-8 w-8 place-items-center rounded-full text-[16px] disabled:opacity-30" style={{ border: `1px solid ${C.line}` }} aria-label={t.increase}>+</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            <AnimatePresence>
              {quote && unit && (
                <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="pt-10">
                  <p className={eyebrow} style={{ color: C.muted }}>{t.yourBooking}</p>
                  <div className={`mt-4 border-y py-5 ${hairline}`}>
                    <div className="space-y-1.5 text-[14px]">
                      <div className="flex justify-between"><span style={{ color: C.muted }}>{unit.name} · {quote.nights} {t.nights(quote.nights)} · {svDate(checkin!)}–{svDate(checkout!)}</span><span>{fmtKr(quote.subtotal)}</span></div>
                      {quote.cleaningFee > 0 && <div className="flex justify-between"><span style={{ color: C.muted }}>{t.cleaning}</span><span>{fmtKr(quote.cleaningFee)}</span></div>}
                      {chosenAddons.map((a) => <div key={a.id} className="flex justify-between"><span style={{ color: C.muted }}>{a.name} ×{a.qty}</span><span>{fmtKr(a.lineTotal)}</span></div>)}
                    </div>
                    <div className="mt-4 flex items-baseline justify-between pt-4" style={{ borderTop: `1px solid ${C.line}` }}><span className="text-[14px] font-semibold">{t.total}</span><span className="font-[Fraunces] text-2xl">{fmtKr(grandTotal)}</span></div>
                  </div>

                  {!minStayOk && <p className="mt-4 text-[13px]" style={{ color: "#A35D2A" }}>{t.minStayWarning(unit.name, unit.minStay)}</p>}

                  <div className="mt-6 space-y-1">
                    <div className="grid grid-cols-[1fr_auto] gap-6">
                      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t.name} className="field" />
                      <select
                        value={guests}
                        onChange={(e) => {
                          const next = Number(e.target.value);
                          setGuests(next);
                          setAddonQty((current) => {
                            const updated = { ...current };
                            for (const addon of data.addons) {
                              if (isPersonAddon(addon) && (updated[addon.id] ?? 0) > next) updated[addon.id] = next;
                            }
                            return updated;
                          });
                        }}
                        className="field"
                        aria-label="Antal gäster"
                      >
                        {Array.from({ length: Math.max(1, unit.maxGuests) }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{t.guests(n)}</option>)}
                      </select>
                    </div>
                    <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t.emailPlaceholder} type="email" className="field" />
                    <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t.phonePlaceholder} type="tel" className="field" />
                  </div>

                  {payMethods.length > 0 && (
                    <div className="mt-6">
                      <p className={eyebrow} style={{ color: C.muted }}>{t.payment}</p>
                      <div className={`mt-3 divide-y border-y ${hairline} ${divideHairline}`}>
                        {([
                          { id: "stripe", label: t.card, hint: t.cardHint },
                          { id: "swish", label: "Swish", hint: t.swishHint },
                        ] as const).filter((m) => payMethods.includes(m.id)).map((m) => {
                          const selected = payMethod === m.id;
                          return (
                            <button key={m.id} type="button" onClick={() => setPayChoice(m.id)} className="flex w-full items-center gap-4 py-3.5 text-left">
                              <span className="grid h-[18px] w-[18px] place-items-center rounded-full" style={{ border: `1.5px solid ${selected ? C.ink : C.line}` }}>{selected && <span className="h-[9px] w-[9px] rounded-full" style={{ background: C.ink }} />}</span>
                              <span className="flex-1 text-[15px] font-medium">{m.label}</span><span className="text-[12px]" style={{ color: C.muted }}>{m.hint}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {formError && <p className="mt-4 text-[13px]" style={{ color: "#A33B2A" }}>{formError}</p>}

                  <button onClick={submit} disabled={!canSubmit} className="mt-6 w-full rounded-full py-4 text-[15px] font-semibold text-white transition hover:opacity-85 disabled:opacity-30" style={{ background: C.ink }}>
                    {sending ? t.booking : payMethod === "stripe" ? t.payWithCard(fmtKr(grandTotal)) : t.bookFor(fmtKr(grandTotal))}
                  </button>
                  <p className="mt-3 text-center text-[12px]" style={{ color: C.muted }}>
                    {payMethod === "stripe" ? t.stripeFineprint : payMethod === "swish" ? t.swishFineprint : t.noPaymentFineprint}
                  </p>
                </motion.section>
              )}
            </AnimatePresence>
          </>
        )}

        <p className="mt-16 text-center text-[12px]" style={{ color: C.muted }}><Link to="/" className="hover:underline">{t.poweredBy}</Link></p>
      </div>
    </div>
  );
}

function MonthCalendar({
  monthOffset,
  unit,
  pricing,
  checkin,
  checkout,
  onPick,
  weekdays,
  locale,
}: {
  monthOffset: number;
  unit: EngineUnit;
  pricing: UnitPricing;
  checkin: string | null;
  checkout: string | null;
  onPick: (iso: string) => void;
  weekdays: readonly string[];
  locale: string;
}) {
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const year = base.getFullYear();
  const month = base.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadBlanks = (new Date(year, month, 1).getDay() + 6) % 7;
  const today = isoToday();

  const cells: (string | null)[] = [
    ...Array.from({ length: leadBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => isoOf(new Date(Date.UTC(year, month, i + 1)))),
  ];

  return (
    <div className="mt-4">
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.muted }}>
        {weekdays.map((d) => <div key={d}>{d}</div>)}
      </div>
      <div className="mt-1.5 grid grid-cols-7 gap-1">
        {cells.map((iso, i) => {
          if (!iso) return <div key={`b${i}`} />;
          const past = iso < today;
          const booked = isBooked(unit, iso);
          const disabled = past || booked;
          const isStart = iso === checkin;
          const isEnd = iso === checkout;
          const inRange = checkin && checkout && iso > checkin && iso < checkout;
          const price = disabled ? null : nightlyPrice(pricing, iso);
          return (
            <button key={iso} disabled={disabled} onClick={() => onPick(iso)} className="flex min-h-[56px] flex-col items-center justify-center rounded-full transition" style={{ background: isStart || isEnd ? C.ink : inRange ? C.soft : "transparent", color: isStart || isEnd ? "#fff" : booked ? C.line : past ? C.line : C.ink }}>
              <span className="text-[13px] font-medium" style={{ textDecoration: booked ? "line-through" : undefined }}>{Number(iso.slice(8))}</span>
              <span className="text-[10px]" style={{ color: isStart || isEnd ? "rgba(255,255,255,0.75)" : C.muted }}>{booked ? "" : price ? price.toLocaleString(locale) : ""}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

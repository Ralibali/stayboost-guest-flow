import { Link, createFileRoute } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import {
  BedDouble,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Loader2,
  Maximize2,
  Plus,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  nightlyPrice,
  quoteStay,
  rangesOverlap,
  type UnitPricing,
} from "../../../supabase/functions/_shared/pricing";
import {
  checkAvailabilityRules,
  minStayFromRules,
  type RateRule,
} from "../../../supabase/functions/_shared/rate-rules";
import { nightsBetween } from "../../../supabase/functions/_shared/pricing";
import { normalizePhoneSE } from "@/lib/phone";

export const Route = createFileRoute("/boka/$slug")({
  component: PublicBookingPage,
});

const C = {
  bg: "#FAFAF8",
  ink: "#1B1B19",
  muted: "#777772",
  line: "#E2E2DC",
  soft: "#F1F1EC",
} as const;

const eyebrow = "text-[11px] font-semibold uppercase tracking-[0.18em]";
const hairline = "border-[#E2E2DC]";
const divideHairline = "divide-[#E2E2DC]";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type EngineUnit = {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  maxGuests: number;
  bedDescription: string | null;
  sizeSqm: number | null;
  amenities: string[];
  basePrice: number;
  weekendPct: number;
  minStay: number;
  cleaningFee: number;
  monthlyMult: number[];
  booked: { from: string; to: string }[];
  rateRules?: RateRule[];
};

type EngineAddon = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  priceType: "per_booking" | "per_night";
  imageUrl: string | null;
};

type EngineData = {
  property: {
    name: string;
    slug: string;
    checkinTime: string;
    checkoutTime: string;
    swishNumber: string | null;
    swishHoldMinutes: number;
    stripeAvailable: boolean;
  };
  units: EngineUnit[];
  addons: EngineAddon[];
};

const FUNCTIONS_BASE = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, "");
const isoToday = () => new Date().toISOString().slice(0, 10);
const isoOf = (d: Date) => d.toISOString().slice(0, 10);
const svDate = (iso: string) =>
  new Date(iso + "T12:00:00").toLocaleDateString("sv-SE", { day: "numeric", month: "short" });
const svLong = (iso: string) =>
  new Date(iso + "T12:00:00").toLocaleDateString("sv-SE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
const fmtKr = (n: number) => `${n.toLocaleString("sv-SE")} kr`;

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
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [website, setWebsite] = useState("");
  const [done, setDone] = useState<{
    token: string;
    total: number;
    swishNumber?: string;
    paymentRef?: string;
    swishHoldMinutes?: number;
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
          setGuests(Math.min(2, d.units[0].maxGuests));
        }
      })
      .catch(() => setError(true));
  }, [slug]);

  const unit = data?.units.find((u) => u.id === unitId) ?? null;
  const pricing = unit ? pricingOf(unit) : null;

  useEffect(() => {
    if (unit) setGuests((n) => Math.min(Math.max(1, n), unit.maxGuests));
  }, [unit]);

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
        const lineTotal =
          a.priceType === "per_night" ? a.price * qty * quote.nights : a.price * qty;
        return { ...a, qty, lineTotal };
      });
  }, [data, quote, addonQty]);

  const addonsTotal = chosenAddons.reduce((s, a) => s + a.lineTotal, 0);
  const grandTotal = (quote?.total ?? 0) + addonsTotal;

  const pick = (iso: string) => {
    if (!unit) return;
    if (!checkin || checkout || iso < checkin) {
      setCheckin(iso);
      setCheckout(null);
      setFormError(null);
      return;
    }
    if (iso === checkin) return;
    if (!rangeFree(unit, checkin, iso)) return;
    setCheckout(iso);
    setFormError(null);
  };

  const minStayOk = !quote || !unit || quote.nights >= unit.minStay;
  const emailOk = EMAIL.test(email.trim());
  const normalizedPhone = phone.trim() ? normalizePhoneSE(phone.trim()) : null;
  const phoneOk = !phone.trim() || normalizedPhone !== null;

  const payMethods = data
    ? ([
        ...(data.property.stripeAvailable ? (["stripe"] as const) : []),
        ...(data.property.swishNumber ? (["swish"] as const) : []),
      ] as ("stripe" | "swish")[])
    : [];
  const payMethod = payChoice && payMethods.includes(payChoice) ? payChoice : (payMethods[0] ?? null);
  const phoneRequired = payMethod === "swish";

  const canSubmit = Boolean(
    unit &&
      quote &&
      minStayOk &&
      name.trim().length >= 2 &&
      emailOk &&
      phoneOk &&
      (!phoneRequired || normalizedPhone) &&
      guests >= 1 &&
      guests <= unit.maxGuests &&
      termsAccepted &&
      !sending,
  );

  const submit = async () => {
    if (!canSubmit || !unit || !checkin || !checkout) return;
    setSending(true);
    setFormError(null);

    // Slutlig tillgänglighetskontroll strax före betalning — undviker onödiga
    // Stripe-sessioner och Swish-hålltider när någon annan hunnit boka datumen.
    try {
      const fresh = await fetch(
        `${FUNCTIONS_BASE}/functions/v1/booking-engine?slug=${encodeURIComponent(slug)}`,
      ).then((r) => (r.ok ? r.json() : null));
      const freshUnit = fresh?.units?.find((u: EngineUnit) => u.id === unit.id);
      if (freshUnit) {
        setData(fresh);
        const stillFree = !(freshUnit.booked as { from: string; to: string }[]).some((r) =>
          rangesOverlap(checkin, checkout, r.from, r.to),
        );
        if (!stillFree) {
          setCheckin(null);
          setCheckout(null);
          setFormError("Datumen hann tyvärr bokas av någon annan just nu. Välj andra datum.");
          setSending(false);
          return;
        }
      }
    } catch {
      // Ignorera — servern gör samma kontroll atomärt.
    }

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
          guest_phone: normalizedPhone ?? "",
          guests,
          termsAccepted,
          website,
          addons: Object.entries(addonQty)
            .filter(([, q]) => q > 0)
            .map(([id, quantity]) => ({ id, quantity })),
          ...(payMethod ? { paymentMethod: payMethod } : {}),
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        const message: Record<string, string> = {
          unavailable: "Datumen hann tyvärr bokas av någon annan. Välj andra datum.",
          min_stay: `Minsta vistelse är ${d.minStay ?? unit.minStay} nätter.`,
          capacity_exceeded: `Det här boendet tar högst ${d.maxGuests ?? unit.maxGuests} gäster.`,
          name_required: "Ange ditt fullständiga namn.",
          email_required: "Ange en giltig e-postadress.",
          invalid_phone: "Kontrollera mobilnumret — svenskt format (t.ex. 070-123 45 67).",
          phone_required_for_swish: "Ange mobilnummer — vi behöver kunna nå dig om Swish-betalningen.",
          terms_required: "Godkänn bokningsvillkoren innan du fortsätter.",
          rate_limited: "För många bokningsförsök. Vänta en stund och försök igen.",
          past_checkin: "Incheckningsdatumet har passerat. Välj ett nytt datum.",
          invalid_dates: "Kontrollera in- och utcheckningsdatumen.",
          too_long: "Vistelsen kan vara max 30 nätter.",
          stripe_failed: "Kortbetalningen kunde inte startas. Försök igen eller välj Swish.",
          payment_method_unavailable: "Den valda betalmetoden är inte tillgänglig just nu.",
          booking_failed: "Bokningen kunde inte sparas. Försök igen om en stund.",
        };
        setFormError(message[d.error] ?? "Något gick fel. Kontrollera uppgifterna och försök igen.");
      } else if (d.checkoutUrl) {
        window.location.href = d.checkoutUrl;
        return;
      } else {
        setDone({
          token: d.guestToken,
          total: d.grandTotal ?? d.price.total,
          swishNumber: d.swishNumber,
          paymentRef: d.paymentRef,
          swishHoldMinutes: d.swishHoldMinutes,
        });
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch {
      setFormError("Något gick fel. Kontrollera din anslutning och försök igen.");
    }
    setSending(false);
  };

  // Enkel 3-stegs indikator: 1) välj boende, 2) välj datum, 3) uppgifter + betala.
  const currentStep: 1 | 2 | 3 = !unitId ? 1 : !(checkin && checkout) ? 2 : 3;


  if (error) {
    return (
      <div className="grid min-h-screen place-items-center px-6 text-center" style={{ background: C.bg, color: C.ink }}>
        <div>
          <p className="font-[Fraunces] text-3xl">Bokningssidan kunde inte laddas</p>
          <p className="mt-3 text-[15px]" style={{ color: C.muted }}>
            Kontrollera länken eller kontakta boendet så hjälper de dig.
          </p>
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

  if (data.units.length === 0) {
    return (
      <div className="grid min-h-screen place-items-center px-6 text-center" style={{ background: C.bg, color: C.ink }}>
        <div>
          <p className="font-[Fraunces] text-3xl">Inga bokningsbara boenden just nu</p>
          <p className="mt-3 text-[15px]" style={{ color: C.muted }}>
            Kontakta {data.property.name} direkt för hjälp.
          </p>
        </div>
      </div>
    );
  }

  const guestUrl = done ? `${window.location.origin}/g/${done.token}` : null;

  return (
    <div className="min-h-screen pb-24" style={{ background: C.bg, color: C.ink }}>
      <main className="mx-auto max-w-2xl px-5 pt-12 sm:pt-16">
        <header className={`border-b pb-8 ${hairline}`}>
          <p className={eyebrow} style={{ color: C.muted }}>Boka direkt</p>
          <h1 className="mt-3 font-[Fraunces] text-[38px] leading-[1.1] sm:text-[46px]">{data.property.name}</h1>
          <p className="mt-3 text-[14px]" style={{ color: C.muted }}>
            Incheckning från {data.property.checkinTime} · Utcheckning senast {data.property.checkoutTime}
          </p>
        </header>

        {!done && (
          <ol
            className="mt-6 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em]"
            aria-label="Bokningssteg"
          >
            {[
              { n: 1 as const, label: "Boende" },
              { n: 2 as const, label: "Datum" },
              { n: 3 as const, label: "Uppgifter" },
            ].map((s) => {
              const state = s.n < currentStep ? "done" : s.n === currentStep ? "active" : "todo";
              return (
                <li
                  key={s.n}
                  aria-current={state === "active" ? "step" : undefined}
                  className="flex flex-1 items-center gap-2"
                >
                  <span
                    className="grid h-6 w-6 place-items-center rounded-full text-[11px]"
                    style={{
                      background: state === "active" ? C.ink : "transparent",
                      color: state === "active" ? "#fff" : state === "done" ? C.ink : C.muted,
                      border: `1.5px solid ${state === "todo" ? C.line : C.ink}`,
                    }}
                  >
                    {state === "done" ? "✓" : s.n}
                  </span>
                  <span style={{ color: state === "todo" ? C.muted : C.ink }}>{s.label}</span>
                  {s.n < 3 && <span aria-hidden className="flex-1 border-t" style={{ borderColor: C.line }} />}
                </li>
              );
            })}
          </ol>
        )}



        {done ? (
          <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="pt-12 text-center" aria-live="polite">
            <span className="mx-auto grid h-16 w-16 place-items-center rounded-full" style={{ border: `1px solid ${C.ink}` }}>
              <Check size={24} />
            </span>
            <h2 className="mt-6 font-[Fraunces] text-3xl">Tack för din bokning</h2>
            <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed" style={{ color: C.muted }}>
              {unit?.name} · {svLong(checkin!)}–{svLong(checkout!)} · {guests} {guests === 1 ? "gäst" : "gäster"} · {fmtKr(done.total)}
              <br />Bekräftelsen skickas till {email}.
            </p>

            {done.swishNumber && (
              <div className={`mx-auto mt-8 max-w-md border-y py-6 text-left ${hairline}`}>
                <p className={eyebrow} style={{ color: C.muted }}>Betala med Swish</p>
                <p className="mt-3 text-[14px] leading-relaxed" style={{ color: C.muted }}>
                  Swisha <strong style={{ color: C.ink }}>{fmtKr(done.total)}</strong> inom {done.swishHoldMinutes ?? data.property.swishHoldMinutes} minuter. Därefter släpps datumen automatiskt om betalningen inte markerats som mottagen.
                </p>
                <div className="mt-4 space-y-2">
                  {[
                    { label: "Swish-nummer", value: done.swishNumber, key: "nr" },
                    { label: "Meddelande", value: done.paymentRef!, key: "ref" },
                  ].map((r) => (
                    <button
                      key={r.key}
                      onClick={() => {
                        navigator.clipboard.writeText(r.value);
                        setCopied(r.key);
                        setTimeout(() => setCopied(null), 1500);
                      }}
                      className="flex w-full items-center justify-between py-2.5 text-left"
                      style={{ borderBottom: `1px solid ${C.line}` }}
                    >
                      <span>
                        <span className="block text-[11px]" style={{ color: C.muted }}>{r.label} — tryck för att kopiera</span>
                        <span className="font-mono text-[16px] tracking-wide">{r.value}</span>
                      </span>
                      {copied === r.key ? <Check size={15} /> : <Copy size={15} style={{ color: C.muted }} />}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={() => {
                navigator.clipboard.writeText(guestUrl!);
                setCopied("link");
                setTimeout(() => setCopied(null), 1500);
              }}
              className="mt-8 w-full max-w-md rounded-full py-4 text-[15px] font-semibold text-white transition hover:opacity-85"
              style={{ background: C.ink }}
            >
              {copied === "link" ? "Gästlänk kopierad" : "Kopiera din gästlänk"}
            </button>
            <a href={guestUrl!} className="mt-4 block text-[14px] underline underline-offset-4" style={{ color: C.muted }}>
              Öppna din gästsida
            </a>
          </motion.section>
        ) : (
          <>
            <section className="pt-10">
              <p className={eyebrow} style={{ color: C.muted }}>Välj boende</p>
              <div className="mt-4 grid gap-4">
                {data.units.map((u) => {
                  const lowestMult = Math.min(...(u.monthlyMult ?? [100]).map(Number));
                  const selected = u.id === unitId;
                  return (
                    <button
                      key={u.id}
                      onClick={() => {
                        setUnitId(u.id);
                        setCheckin(null);
                        setCheckout(null);
                        setGuests(Math.min(2, u.maxGuests));
                        setFormError(null);
                      }}
                      className="overflow-hidden rounded-2xl text-left transition"
                      style={{ border: `1.5px solid ${selected ? C.ink : C.line}`, background: "white" }}
                    >
                      {u.imageUrl && <img src={u.imageUrl} alt={u.name} className="h-44 w-full object-cover sm:h-52" />}
                      <div className="p-5">
                        <div className="flex items-start gap-4">
                          <span className="mt-1 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full" style={{ border: `1.5px solid ${selected ? C.ink : C.line}` }}>
                            {selected && <span className="h-[9px] w-[9px] rounded-full" style={{ background: C.ink }} />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <h2 className="font-[Fraunces] text-2xl">{u.name}</h2>
                              <span className="text-[13px] font-medium">från {fmtKr(Math.round((u.basePrice * lowestMult) / 100))}/natt</span>
                            </div>
                            {u.description && <p className="mt-2 text-[14px] leading-relaxed" style={{ color: C.muted }}>{u.description}</p>}
                            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[12px]" style={{ color: C.muted }}>
                              <span className="flex items-center gap-1.5"><Users size={14} /> Upp till {u.maxGuests} gäster</span>
                              {u.bedDescription && <span className="flex items-center gap-1.5"><BedDouble size={14} /> {u.bedDescription}</span>}
                              {u.sizeSqm && <span className="flex items-center gap-1.5"><Maximize2 size={14} /> {u.sizeSqm} m²</span>}
                            </div>
                            {u.amenities.length > 0 && (
                              <div className="mt-3 flex flex-wrap gap-1.5">
                                {u.amenities.map((a) => <span key={a} className="rounded-full px-2.5 py-1 text-[11px]" style={{ background: C.soft }}>{a}</span>)}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            {unit && (
              <section className="pt-10">
                <p className={eyebrow} style={{ color: C.muted }}>Välj datum</p>
                <div className={`mt-4 border-y py-5 ${hairline}`}>
                  <div className="flex items-center justify-between px-1">
                    <button onClick={() => setMonthOffset((o) => Math.max(0, o - 1))} disabled={monthOffset === 0} className="grid h-9 w-9 place-items-center rounded-full disabled:opacity-25" aria-label="Föregående månad">
                      <ChevronLeft size={17} />
                    </button>
                    <span className="text-[13px] font-semibold uppercase tracking-[0.14em]">
                      {new Date(new Date().getFullYear(), new Date().getMonth() + monthOffset, 1).toLocaleDateString("sv-SE", { month: "long", year: "numeric" })}
                    </span>
                    <button onClick={() => setMonthOffset((o) => Math.min(11, o + 1))} disabled={monthOffset === 11} className="grid h-9 w-9 place-items-center rounded-full disabled:opacity-25" aria-label="Nästa månad">
                      <ChevronRight size={17} />
                    </button>
                  </div>
                  <MonthCalendar monthOffset={monthOffset} unit={unit} pricing={pricing!} checkin={checkin} checkout={checkout} onPick={pick} />
                  <div className="mt-3 flex items-center justify-between px-1 text-[12px]" style={{ color: C.muted }}>
                    <span>Minst {unit.minStay} {unit.minStay === 1 ? "natt" : "nätter"}</span>
                    <span>Helgpåslag +{unit.weekendPct}% fre/lör</span>
                  </div>
                </div>
              </section>
            )}

            {unit && data.addons.length > 0 && (
              <section className="pt-10">
                <p className={eyebrow} style={{ color: C.muted }}>Gör vistelsen ännu bättre</p>
                <div className={`mt-4 divide-y border-y ${hairline} ${divideHairline}`}>
                  {data.addons.map((a) => {
                    const qty = addonQty[a.id] ?? 0;
                    return (
                      <div key={a.id} className="flex items-center gap-4 py-4">
                        {a.imageUrl ? <img src={a.imageUrl} alt={a.name} className="h-16 w-16 shrink-0 rounded-xl object-cover" /> : <div className="grid h-16 w-16 shrink-0 place-items-center rounded-xl" style={{ background: C.soft, color: C.muted }}><Plus size={16} /></div>}
                        <div className="min-w-0 flex-1">
                          <p className="text-[15px] font-medium">{a.name}</p>
                          {a.description && <p className="mt-0.5 line-clamp-2 text-[13px]" style={{ color: C.muted }}>{a.description}</p>}
                          <p className="mt-0.5 text-[13px]" style={{ color: C.muted }}>{fmtKr(a.price)}{a.priceType === "per_night" && " per natt"}</p>
                        </div>
                        {qty === 0 ? (
                          <button onClick={() => setAddonQty({ ...addonQty, [a.id]: 1 })} className="shrink-0 rounded-full px-4 py-2 text-[13px] font-semibold" style={{ border: `1px solid ${C.ink}` }}>Lägg till</button>
                        ) : (
                          <div className="flex shrink-0 items-center gap-3">
                            <button onClick={() => setAddonQty({ ...addonQty, [a.id]: qty - 1 })} className="grid h-8 w-8 place-items-center rounded-full" style={{ border: `1px solid ${C.line}` }} aria-label="Minska">−</button>
                            <span className="w-4 text-center text-[14px] font-semibold">{qty}</span>
                            <button onClick={() => setAddonQty({ ...addonQty, [a.id]: Math.min(20, qty + 1) })} className="grid h-8 w-8 place-items-center rounded-full" style={{ border: `1px solid ${C.line}` }} aria-label="Öka">+</button>
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
                  <p className={eyebrow} style={{ color: C.muted }}>Din bokning</p>
                  <div className={`mt-4 border-y py-5 ${hairline}`}>
                    <div className="space-y-1.5 text-[14px]">
                      <div className="flex justify-between gap-3">
                        <span style={{ color: C.muted }}>{unit.name} · {quote.nights} {quote.nights === 1 ? "natt" : "nätter"} · {svDate(checkin!)}–{svDate(checkout!)}</span>
                        <span className="shrink-0">{fmtKr(quote.subtotal)}</span>
                      </div>
                      {quote.cleaningFee > 0 && <div className="flex justify-between"><span style={{ color: C.muted }}>Städning</span><span>{fmtKr(quote.cleaningFee)}</span></div>}
                      {chosenAddons.map((a) => <div key={a.id} className="flex justify-between"><span style={{ color: C.muted }}>{a.name} ×{a.qty}</span><span>{fmtKr(a.lineTotal)}</span></div>)}
                    </div>
                    <div className="mt-4 flex items-baseline justify-between pt-4" style={{ borderTop: `1px solid ${C.line}` }}>
                      <span className="text-[14px] font-semibold">Totalt</span>
                      <span className="font-[Fraunces] text-2xl">{fmtKr(grandTotal)}</span>
                    </div>
                  </div>

                  {!minStayOk && <p className="mt-4 text-[13px] text-amber-800">Minsta vistelse i {unit.name} är {unit.minStay} nätter.</p>}

                  <div className="mt-7 grid gap-4 sm:grid-cols-2">
                    <Field label="Namn *">
                      <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="För- och efternamn" className="field" />
                    </Field>
                    <Field label="Antal gäster *">
                      <select value={guests} onChange={(e) => setGuests(Number(e.target.value))} className="field">
                        {Array.from({ length: unit.maxGuests }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} {n === 1 ? "gäst" : "gäster"}</option>)}
                      </select>
                    </Field>
                    <Field label="E-post *">
                      <input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="namn@exempel.se" type="email" className="field" />
                    </Field>
                    <Field label={phoneRequired ? "Mobil *" : "Mobil"}>
                      <input
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        autoComplete="tel"
                        inputMode="tel"
                        placeholder="070-123 45 67"
                        type="tel"
                        aria-invalid={phone.trim() ? !phoneOk : undefined}
                        className="field"
                      />
                      {phone.trim() && !phoneOk && (
                        <span className="mt-1 block text-[12px] text-amber-800">
                          Skriv som svenskt mobilnummer, t.ex. 070-123 45 67.
                        </span>
                      )}
                      {phoneRequired && !phone.trim() && (
                        <span className="mt-1 block text-[12px]" style={{ color: C.muted }}>
                          Krävs för Swish — vi hör av oss om betalningen behöver följas upp.
                        </span>
                      )}
                    </Field>
                  </div>
                  <input tabIndex={-1} autoComplete="off" aria-hidden="true" value={website} onChange={(e) => setWebsite(e.target.value)} className="absolute -left-[9999px] h-px w-px opacity-0" name="website" />

                  {payMethods.length > 0 && (
                    <div className="mt-7">
                      <p className={eyebrow} style={{ color: C.muted }}>Betalning</p>
                      <div className={`mt-3 divide-y border-y ${hairline} ${divideHairline}`}>
                        {([
                          { id: "stripe", label: "Kort", hint: "Visa · Mastercard · Stripe" },
                          { id: "swish", label: "Swish", hint: `Reserveras i ${data.property.swishHoldMinutes} min` },
                        ] as const)
                          .filter((m) => payMethods.includes(m.id))
                          .map((m) => {
                            const selected = payMethod === m.id;
                            return (
                              <button key={m.id} type="button" onClick={() => setPayChoice(m.id)} className="flex w-full items-center gap-4 py-3.5 text-left">
                                <span className="grid h-[18px] w-[18px] place-items-center rounded-full" style={{ border: `1.5px solid ${selected ? C.ink : C.line}` }}>
                                  {selected && <span className="h-[9px] w-[9px] rounded-full" style={{ background: C.ink }} />}
                                </span>
                                <span className="flex-1 text-[15px] font-medium">{m.label}</span>
                                <span className="text-[12px]" style={{ color: C.muted }}>{m.hint}</span>
                              </button>
                            );
                          })}
                      </div>
                    </div>
                  )}

                  <label className="mt-6 flex cursor-pointer items-start gap-3 text-[13px] leading-relaxed" style={{ color: C.muted }}>
                    <input type="checkbox" checked={termsAccepted} onChange={(e) => setTermsAccepted(e.target.checked)} className="mt-1 h-4 w-4 accent-black" />
                    <span>Jag godkänner <Link to="/villkor" target="_blank" className="underline underline-offset-2" style={{ color: C.ink }}>bokningsvillkoren</Link> och har tagit del av <Link to="/integritetspolicy" target="_blank" className="underline underline-offset-2" style={{ color: C.ink }}>integritetspolicyn</Link>.</span>
                  </label>

                  {formError && <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-[13px] text-red-700" role="alert">{formError}</p>}

                  <button onClick={submit} disabled={!canSubmit} className="mt-6 w-full rounded-full py-4 text-[15px] font-semibold text-white transition hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-30" style={{ background: C.ink }}>
                    {sending ? "Bokar…" : payMethod === "stripe" ? `Betala ${fmtKr(grandTotal)} med kort` : `Boka · ${fmtKr(grandTotal)}`}
                  </button>
                  <p className="mt-3 text-center text-[12px]" style={{ color: C.muted }}>
                    {payMethod === "stripe" ? "Säker kortbetalning via Stripe. Bokningen bekräftas direkt." : payMethod === "swish" ? `Datumen reserveras i ${data.property.swishHoldMinutes} minuter i väntan på betalning.` : "Betalning sker enligt överenskommelse med värden."}
                  </p>
                </motion.section>
              )}
            </AnimatePresence>
          </>
        )}

        <p className="mt-16 text-center text-[12px]" style={{ color: C.muted }}>
          <Link to="/" className="hover:underline">Bokningsmotor av StayBoost</Link>
        </p>
      </main>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: C.muted }}>{label}</span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

const WEEKDAYS = ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"];

function MonthCalendar({
  monthOffset,
  unit,
  pricing,
  checkin,
  checkout,
  onPick,
}: {
  monthOffset: number;
  unit: EngineUnit;
  pricing: UnitPricing;
  checkin: string | null;
  checkout: string | null;
  onPick: (iso: string) => void;
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
        {WEEKDAYS.map((d) => <div key={d}>{d}</div>)}
      </div>
      <div className="mt-1.5 grid grid-cols-7 gap-1">
        {cells.map((iso, i) => {
          if (!iso) return <div key={`b${i}`} />;
          const past = iso < today;
          const booked = isBooked(unit, iso);
          const canBeCheckout = Boolean(checkin && !checkout && iso > checkin && rangeFree(unit, checkin, iso));
          const disabled = past || (booked && !canBeCheckout);
          const isStart = iso === checkin;
          const isEnd = iso === checkout;
          const inRange = Boolean(checkin && checkout && iso > checkin && iso < checkout);
          const price = disabled ? null : nightlyPrice(pricing, iso);
          return (
            <button
              key={iso}
              disabled={disabled}
              onClick={() => onPick(iso)}
              className="flex min-h-[58px] flex-col items-center justify-center rounded-full transition disabled:cursor-not-allowed"
              style={{
                background: isStart || isEnd ? C.ink : inRange ? C.soft : "transparent",
                color: isStart || isEnd ? "#fff" : disabled ? C.line : C.ink,
              }}
              aria-label={`${iso}${booked ? ", upptaget" : price ? `, ${price} kronor` : ""}`}
            >
              <span className="text-[13px] font-medium" style={{ textDecoration: booked && !canBeCheckout ? "line-through" : undefined }}>{Number(iso.slice(8))}</span>
              <span className="text-[10px]" style={{ color: isStart || isEnd ? "rgba(255,255,255,0.75)" : C.muted }}>
                {booked && !canBeCheckout ? "" : price ? price.toLocaleString("sv-SE") : ""}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

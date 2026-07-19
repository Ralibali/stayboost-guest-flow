import { Link, createFileRoute } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronLeft, ChevronRight, Copy, Loader2, Plus, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  nightlyPrice,
  quoteStay,
  rangesOverlap,
  type UnitPricing,
} from "../../../supabase/functions/_shared/pricing";

export const Route = createFileRoute("/boka/$slug")({
  component: PublicBookingPage,
});

/* ---------- Typer + API ---------- */

type EngineUnit = {
  id: string;
  name: string;
  basePrice: number;
  weekendPct: number;
  minStay: number;
  cleaningFee: number;
  monthlyMult: number[];
  booked: { from: string; to: string }[];
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

/** Kan [from, to) bokas i enheten? */
const rangeFree = (u: EngineUnit, from: string, to: string) =>
  !u.booked.some((r) => rangesOverlap(from, to, r.from, r.to));

/* ---------- Sidan ---------- */

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
        if (d.units.length > 0) setUnitId(d.units[0].id);
      })
      .catch(() => setError(true));
  }, [slug]);

  const unit = data?.units.find((u) => u.id === unitId) ?? null;
  const pricing = unit ? pricingOf(unit) : null;

  const quote = useMemo(
    () => (pricing && checkin && checkout ? quoteStay(pricing, checkin, checkout) : null),
    [pricing, checkin, checkout],
  );

  // Valda tillval med radtotaler (samma logik som motorn räknar server-side)
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
    if (!checkin || (checkin && checkout) || iso < checkin) {
      setCheckin(iso);
      setCheckout(null);
      return;
    }
    if (iso === checkin) return;
    if (!rangeFree(unit, checkin, iso)) return; // spannet korsar en bokning
    setCheckout(iso);
  };

  const minStayOk = !quote || !unit || quote.nights >= unit.minStay;
  const canSubmit = unit && quote && minStayOk && (email.trim() || phone.trim()) && !sending;

  // Tillgängliga betalsätt enligt anläggningens inställningar
  const payMethods = data
    ? ([
        ...(data.property.stripeAvailable ? (["stripe"] as const) : []),
        ...(data.property.swishNumber ? (["swish"] as const) : []),
      ] as ("stripe" | "swish")[])
    : [];
  const payMethod =
    payChoice && payMethods.includes(payChoice) ? payChoice : (payMethods[0] ?? null);

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
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setFormError(
          d.error === "unavailable"
            ? "Datumen hann tyvärr bokas av någon annan — välj andra datum."
            : d.error === "min_stay"
              ? `Minsta vistelse är ${d.minStay} nätter.`
              : d.error === "contact_required"
                ? "Ange e-post eller telefon så vi kan skicka bekräftelsen."
                : d.error === "stripe_failed"
                  ? "Kortbetalningen kunde inte startas — försök igen eller välj Swish."
                  : "Något gick fel — försök igen om en stund.",
        );
      } else if (d.checkoutUrl) {
        window.location.href = d.checkoutUrl; // vidare till Stripe Checkout
        return;
      } else {
        setDone({
          token: d.guestToken,
          total: d.grandTotal ?? d.price.total,
          swishNumber: d.swishNumber,
          paymentRef: d.paymentRef,
        });
      }
    } catch {
      setFormError("Något gick fel — försök igen om en stund.");
    }
    setSending(false);
  };

  /* ---------- Tillstånd ---------- */

  if (error) {
    return (
      <div className="grid min-h-screen place-items-center bg-[color:var(--bg)] px-6 text-center">
        <div>
          <p className="font-[Fraunces] text-3xl font-semibold">Bokningssidan hittades inte</p>
          <p className="mt-3 text-[15px] text-[color:var(--ink)]/60">
            Kontrollera länken — eller hör av dig direkt till oss så hjälper vi dig.
          </p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="grid min-h-screen place-items-center bg-[color:var(--bg)]">
        <Loader2 className="animate-spin text-[color:var(--forest)]" size={32} />
      </div>
    );
  }

  const guestUrl = done ? `${window.location.origin}/g/${done.token}` : null;

  return (
    <div className="min-h-screen bg-[color:var(--bg)] pb-20">
      <div className="mx-auto max-w-lg px-4 pt-6">
        {/* Hero */}
        <div className="overflow-hidden rounded-[24px] bg-[color:var(--forest)] text-white shadow-[0_20px_50px_rgba(20,36,28,0.25)]">
          <div className="p-6">
            <p className="text-[12px] uppercase tracking-wide text-white/60">
              Boka direkt — bästa pris
            </p>
            <h1 className="mt-1 font-[Fraunces] text-[28px] font-semibold leading-tight">
              {data.property.name}
            </h1>
            <p className="mt-2 text-[14px] text-white/75">
              Incheckning från {data.property.checkinTime} · Utcheckning{" "}
              {data.property.checkoutTime}
            </p>
          </div>
        </div>

        {done ? (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="card-surface mt-5 p-6 text-center"
          >
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[color:var(--success)]/15 text-2xl">
              ✅
            </span>
            <h2 className="mt-4 font-[Fraunces] text-2xl font-semibold">Bokningen är klar!</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-[color:var(--ink)]/65">
              {unit?.name} · {svLong(checkin!)} – {svLong(checkout!)} · {fmtKr(done.total)}
              <br />
              Bekräftelsen är på väg till dig med all praktisk information.
            </p>
            {done.swishNumber && (
              <div className="mt-5 rounded-2xl bg-[color:var(--brass)]/10 p-4 text-left">
                <p className="text-[14px] font-bold">💸 Betala med Swish</p>
                <p className="mt-1 text-[13px] leading-relaxed text-[color:var(--ink)]/65">
                  Swisha <strong>{fmtKr(done.total)}</strong> inom 24 timmar för att säkra din
                  bokning:
                </p>
                <div className="mt-3 space-y-2">
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
                      className="flex w-full items-center justify-between rounded-xl bg-white px-3.5 py-2.5 text-left ring-1 ring-[color:var(--line)] transition hover:ring-[color:var(--brass)]"
                    >
                      <span>
                        <span className="block text-[11px] text-[color:var(--ink)]/50">
                          {r.label} — tryck för att kopiera
                        </span>
                        <span className="font-mono text-[15px] font-semibold tracking-wide">
                          {r.value}
                        </span>
                      </span>
                      {copied === r.key ? (
                        <Check size={15} className="text-[color:var(--success)]" />
                      ) : (
                        <Copy size={15} className="text-[color:var(--ink)]/40" />
                      )}
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
              className="btn-primary mt-5 w-full justify-center !rounded-xl !py-3 text-[15px]"
            >
              {copied === "link" ? <Check size={16} /> : <Copy size={16} />}
              {copied === "link" ? "Gästlänk kopierad!" : "Kopiera din gästlänk"}
            </button>
            <a
              href={guestUrl!}
              className="mt-2 block text-[13px] font-medium text-[color:var(--brass)] hover:underline"
            >
              Öppna din gästsida →
            </a>
          </motion.div>
        ) : (
          <>
            {/* Enhetsval */}
            {data.units.length > 1 && (
              <div className="mt-5 grid gap-2">
                {data.units.map((u) => {
                  const lowestMult = Math.min(...(u.monthlyMult ?? [70]).map(Number));
                  return (
                    <button
                      key={u.id}
                      onClick={() => {
                        setUnitId(u.id);
                        setCheckin(null);
                        setCheckout(null);
                      }}
                      className={`card-surface flex items-center justify-between p-4 text-left transition ${
                        u.id === unitId ? "ring-2 ring-[color:var(--forest)]" : ""
                      }`}
                    >
                      <span className="text-[15px] font-semibold">{u.name}</span>
                      <span className="text-[13px] text-[color:var(--ink)]/60">
                        från {fmtKr(Math.round((u.basePrice * lowestMult) / 100))}/natt
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Kalender */}
            {unit && (
              <div className="card-surface mt-4 p-5">
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => setMonthOffset((o) => Math.max(0, o - 1))}
                    disabled={monthOffset === 0}
                    className="grid h-9 w-9 place-items-center rounded-full hover:bg-[color:var(--bg)] disabled:opacity-30"
                    aria-label="Föregående månad"
                  >
                    <ChevronLeft size={17} />
                  </button>
                  <span className="text-[14px] font-bold capitalize">
                    {new Date(
                      new Date().getFullYear(),
                      new Date().getMonth() + monthOffset,
                      1,
                    ).toLocaleDateString("sv-SE", { month: "long", year: "numeric" })}
                  </span>
                  <button
                    onClick={() => setMonthOffset((o) => Math.min(11, o + 1))}
                    className="grid h-9 w-9 place-items-center rounded-full hover:bg-[color:var(--bg)]"
                    aria-label="Nästa månad"
                  >
                    <ChevronRight size={17} />
                  </button>
                </div>
                <MonthCalendar
                  monthOffset={monthOffset}
                  unit={unit}
                  pricing={pricing!}
                  checkin={checkin}
                  checkout={checkout}
                  onPick={pick}
                />
                <div className="mt-3 flex items-center justify-between text-[12px] text-[color:var(--ink)]/50">
                  <span className="flex items-center gap-1">
                    <Users size={13} /> Minst {unit.minStay}{" "}
                    {unit.minStay === 1 ? "natt" : "nätter"}
                  </span>
                  <span>Helgpåslag +{unit.weekendPct}% fre/lör</span>
                </div>
              </div>
            )}

            {/* Tillval — minimalistiskt: hårlinjer, liten bild, stegvisare */}
            {unit && data.addons.length > 0 && (
              <div className="mt-6">
                <p className="px-1 text-[12px] font-semibold uppercase tracking-wider text-[color:var(--ink)]/45">
                  Gör vistelsen ännu bättre
                </p>
                <div className="mt-2 divide-y divide-[color:var(--line)] rounded-2xl bg-white ring-1 ring-[color:var(--line)]">
                  {data.addons.map((a) => {
                    const qty = addonQty[a.id] ?? 0;
                    return (
                      <div key={a.id} className="flex items-center gap-3.5 px-4 py-3.5">
                        {a.imageUrl ? (
                          <img
                            src={a.imageUrl}
                            alt=""
                            className="h-12 w-12 shrink-0 rounded-xl object-cover"
                          />
                        ) : (
                          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[color:var(--bg)] text-[color:var(--ink)]/25">
                            <Plus size={16} />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14px] font-semibold">{a.name}</p>
                          {a.description && (
                            <p className="mt-0.5 line-clamp-1 text-[12px] text-[color:var(--ink)]/50">
                              {a.description}
                            </p>
                          )}
                          <p className="mt-0.5 text-[12px] font-semibold text-[color:var(--brass)]">
                            {fmtKr(a.price)}
                            {a.priceType === "per_night" && "/natt"}
                          </p>
                        </div>
                        {qty === 0 ? (
                          <button
                            onClick={() => setAddonQty({ ...addonQty, [a.id]: 1 })}
                            className="shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-semibold ring-1 ring-[color:var(--line)] transition hover:ring-[color:var(--forest)]"
                          >
                            Lägg till
                          </button>
                        ) : (
                          <div className="flex shrink-0 items-center gap-3">
                            <button
                              onClick={() => setAddonQty({ ...addonQty, [a.id]: qty - 1 })}
                              className="grid h-8 w-8 place-items-center rounded-full text-[16px] font-bold ring-1 ring-[color:var(--line)] transition hover:ring-[color:var(--forest)]"
                              aria-label="Minska"
                            >
                              −
                            </button>
                            <span className="w-4 text-center text-[14px] font-bold">{qty}</span>
                            <button
                              onClick={() =>
                                setAddonQty({ ...addonQty, [a.id]: Math.min(20, qty + 1) })
                              }
                              className="grid h-8 w-8 place-items-center rounded-full text-[16px] font-bold ring-1 ring-[color:var(--line)] transition hover:ring-[color:var(--forest)]"
                              aria-label="Öka"
                            >
                              +
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Sammanfattning + formulär */}
            <AnimatePresence>
              {quote && unit && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="card-surface mt-4 p-5"
                >
                  <div className="flex items-baseline justify-between">
                    <span className="text-[14px] text-[color:var(--ink)]/65">
                      {unit.name} · {quote.nights} {quote.nights === 1 ? "natt" : "nätter"}
                    </span>
                    <span className="font-[Fraunces] text-xl font-semibold">
                      {fmtKr(grandTotal)}
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] text-[color:var(--ink)]/50">
                    {svDate(checkin!)} – {svDate(checkout!)} · {fmtKr(quote.subtotal)}
                    {quote.cleaningFee > 0 && ` + städning ${fmtKr(quote.cleaningFee)}`}
                  </p>
                  {chosenAddons.map((a) => (
                    <p key={a.id} className="mt-0.5 text-[12px] text-[color:var(--ink)]/50">
                      + {a.name} ×{a.qty} — {fmtKr(a.lineTotal)}
                    </p>
                  ))}
                  {!minStayOk && (
                    <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
                      Minsta vistelse i {unit.name} är {unit.minStay} nätter.
                    </p>
                  )}

                  <div className="mt-4 space-y-2.5 border-t border-[color:var(--line)] pt-4">
                    <div className="grid grid-cols-[1fr_auto] gap-2.5">
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Ditt namn"
                        className="inp"
                      />
                      <select
                        value={guests}
                        onChange={(e) => setGuests(Number(e.target.value))}
                        className="inp"
                        aria-label="Antal gäster"
                      >
                        {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                          <option key={n} value={n}>
                            {n} gäster
                          </option>
                        ))}
                      </select>
                    </div>
                    <input
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="E-post (bekräftelse skickas hit)"
                      type="email"
                      className="inp"
                    />
                    <input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="Telefon (sms på incheckningsdagen)"
                      type="tel"
                      className="inp"
                    />
                    {formError && (
                      <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-[13px] text-red-700">
                        {formError}
                      </p>
                    )}
                    {payMethods.length > 1 && (
                      <div className="grid grid-cols-2 gap-2">
                        {(
                          [
                            { id: "stripe", label: "💳 Kort", hint: "Visa · Mastercard" },
                            { id: "swish", label: "Swish", hint: "Direkt i appen" },
                          ] as const
                        )
                          .filter((m) => payMethods.includes(m.id))
                          .map((m) => (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => setPayChoice(m.id)}
                              className={`rounded-xl px-3 py-2.5 text-left ring-1 transition ${
                                payMethod === m.id
                                  ? "bg-[color:var(--forest)]/5 ring-2 ring-[color:var(--forest)]"
                                  : "ring-[color:var(--line)] hover:ring-[color:var(--ink)]/30"
                              }`}
                            >
                              <span className="block text-[14px] font-bold">{m.label}</span>
                              <span className="block text-[11px] text-[color:var(--ink)]/50">
                                {m.hint}
                              </span>
                            </button>
                          ))}
                      </div>
                    )}
                    <button
                      onClick={submit}
                      disabled={!canSubmit}
                      className="btn-primary w-full justify-center !rounded-xl !py-3.5 text-[15px] disabled:opacity-40"
                    >
                      {sending
                        ? "Bokar…"
                        : payMethod === "stripe"
                          ? `Betala ${fmtKr(grandTotal)} med kort →`
                          : `Boka ${fmtKr(grandTotal)} →`}
                    </button>
                    <p className="text-center text-[12px] text-[color:var(--ink)]/45">
                      {payMethod === "stripe"
                        ? "Säker kortbetalning via Stripe — bokningen bekräftas direkt."
                        : payMethod === "swish"
                          ? "Du betalar smidigt med Swish direkt efter bokningen."
                          : "Ingen betalning online — betalning sker enligt överenskommelse med värden."}
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}

        <p className="mt-8 text-center text-[12px] text-[color:var(--ink)]/40">
          <Link to="/" className="hover:underline">
            Bokningsmotor av StayBoost
          </Link>
        </p>
      </div>
    </div>
  );
}

/* ---------- Månadskalender ---------- */

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
    <div className="mt-3">
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-[color:var(--ink)]/45">
        {WEEKDAYS.map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
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
            <button
              key={iso}
              disabled={disabled}
              onClick={() => onPick(iso)}
              className={`flex min-h-[54px] flex-col items-center justify-center rounded-xl px-0.5 py-1 transition ${
                isStart || isEnd
                  ? "bg-[color:var(--forest)] text-white"
                  : inRange
                    ? "bg-[color:var(--brass)]/20"
                    : booked
                      ? "opacity-40"
                      : "hover:bg-[color:var(--forest)]/8"
              }`}
            >
              <span className="text-[13px] font-semibold">{Number(iso.slice(8))}</span>
              <span
                className={`text-[10px] ${
                  isStart || isEnd ? "text-white/80" : "text-[color:var(--ink)]/45"
                }`}
              >
                {booked ? "Bokad" : price ? price.toLocaleString("sv-SE") : ""}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

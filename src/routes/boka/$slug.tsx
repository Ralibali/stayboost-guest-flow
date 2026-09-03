import { Link, createFileRoute } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import {
  BedDouble,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  CreditCard,
  Loader2,
  LockKeyhole,
  Minus,
  Plus,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { LOCALES, LANGS, detectLang, getStrings, persistLang, type Lang } from "@/lib/boka-i18n";
import {
  nightlyPriceWithRules,
  quoteStay,
  rangesOverlap,
  type UnitPricing,
} from "../../../supabase/functions/_shared/pricing";
import { minStayFromRules, type RateRule } from "../../../supabase/functions/_shared/rate-rules";

export const Route = createFileRoute("/boka/$slug")({
  component: PublicBookingPage,
});

const C = {
  page: "#F3F0E8",
  paper: "#FCFBF7",
  ink: "#17231D",
  muted: "#6D746E",
  line: "#DDD8CB",
  forest: "#173D2E",
  forestSoft: "#E9F0EC",
  brass: "#A37B34",
  danger: "#A33B2A",
} as const;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FUNCTIONS_BASE = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(
  /\/$/,
  "",
);
const isoToday = () => new Date().toISOString().slice(0, 10);
const isoOf = (d: Date) => d.toISOString().slice(0, 10);

const EXTRA = {
  sv: {
    secureDirect: "Direkt & säkert",
    secureDirectBody: "Boka direkt hos boendet med omedelbar prisöversikt.",
    chooseStay: "Välj boende",
    chooseStayBody: "Jämför alternativen och välj det som passar er bäst.",
    sleeps: (n: number) => `Upp till ${n} gäster`,
    size: (n: number) => `${n} m²`,
    selected: "Valt boende",
    availability: "Tillgänglighet",
    dateHint: "Välj först incheckning och därefter utcheckning.",
    selectedDates: "Valda datum",
    checkin: "Incheckning",
    checkout: "Utcheckning",
    from: "från",
    bookSummary: "Din vistelse",
    chooseDatesPrice: "Välj datum för att se exakt pris",
    details: "Dina uppgifter",
    detailsBody: "Vi använder uppgifterna för bokningsbekräftelsen och inför vistelsen.",
    fullName: "För- och efternamn",
    email: "E-postadress",
    phone: "Mobilnummer",
    guests: "Gäster",
    payment: "Betalning",
    payCard: "Kortbetalning",
    payCardHint: "Säkert via Stripe",
    paySwish: "Swish",
    paySwishHint: "Betala efter bokningen",
    termsStart: "Jag godkänner",
    terms: "bokningsvillkoren",
    privacy: "integritetspolicyn",
    and: "och har tagit del av",
    securePayment: "Säker betalning",
    directHost: "Direkt med boendet",
    instantConfirmation: "Bekräftelse direkt",
    included: "Det här ingår",
    quantity: "Antal",
    remove: "Ta bort",
    errName: "Fyll i ditt namn för att fortsätta.",
    errEmail: "Ange en giltig e-postadress så vi kan skicka bokningsbekräftelsen.",
    errPhone: "Mobilnumret ser inte ut att vara ett giltigt svenskt mobilnummer.",
    errTerms: "Godkänn bokningsvillkoren för att fortsätta.",
    errSwishPhone: "Mobilnummer krävs när du väljer Swish.",
    errCapacity: (n: number) => `Boendet tar maximalt ${n} gäster.`,
    errRateLimit: "Det har gjorts många bokningsförsök på kort tid. Försök igen om en stund.",
    errClosed: "Boendet är stängt under en del av den valda perioden. Välj andra datum.",
    errArrival:
      "Incheckning är inte möjlig på det valda datumet. Välj ett annat incheckningsdatum.",
    errDeparture:
      "Utcheckning är inte möjlig på det valda datumet. Välj ett annat utcheckningsdatum.",
    nights: (n: number) => `${n} ${n === 1 ? "natt" : "nätter"}`,
    taxesIncluded: "Pris enligt boendets aktuella prisregler.",
    editDates: "Ändra datum",
  },
  en: {
    secureDirect: "Direct & secure",
    secureDirectBody: "Book directly with the property with a clear price before checkout.",
    chooseStay: "Choose accommodation",
    chooseStayBody: "Compare the options and pick the stay that suits you best.",
    sleeps: (n: number) => `Up to ${n} guests`,
    size: (n: number) => `${n} m²`,
    selected: "Selected stay",
    availability: "Availability",
    dateHint: "Choose check-in first, then check-out.",
    selectedDates: "Selected dates",
    checkin: "Check-in",
    checkout: "Check-out",
    from: "from",
    bookSummary: "Your stay",
    chooseDatesPrice: "Choose dates to see the exact price",
    details: "Your details",
    detailsBody: "We use these details for your confirmation and stay information.",
    fullName: "Full name",
    email: "Email address",
    phone: "Mobile number",
    guests: "Guests",
    payment: "Payment",
    payCard: "Card payment",
    payCardHint: "Securely via Stripe",
    paySwish: "Swish",
    paySwishHint: "Pay after booking",
    termsStart: "I accept the",
    terms: "booking terms",
    privacy: "privacy policy",
    and: "and have read the",
    securePayment: "Secure payment",
    directHost: "Direct with the property",
    instantConfirmation: "Instant confirmation",
    included: "What's included",
    quantity: "Quantity",
    remove: "Remove",
    errName: "Enter your name to continue.",
    errEmail: "Enter a valid email address so we can send your confirmation.",
    errPhone: "The mobile number does not look like a valid Swedish mobile number.",
    errTerms: "Accept the booking terms to continue.",
    errSwishPhone: "A mobile number is required when choosing Swish.",
    errCapacity: (n: number) => `This accommodation allows a maximum of ${n} guests.`,
    errRateLimit:
      "There have been many booking attempts in a short time. Please try again shortly.",
    errClosed: "The accommodation is closed during part of your selected stay. Choose other dates.",
    errArrival: "Check-in is not available on that date. Choose another arrival date.",
    errDeparture: "Check-out is not available on that date. Choose another departure date.",
    nights: (n: number) => `${n} ${n === 1 ? "night" : "nights"}`,
    taxesIncluded: "Price based on the property's current pricing rules.",
    editDates: "Change dates",
  },
  de: {
    secureDirect: "Direkt & sicher",
    secureDirectBody: "Buchen Sie direkt bei der Unterkunft mit klarer Preisübersicht.",
    chooseStay: "Unterkunft wählen",
    chooseStayBody: "Vergleichen Sie die Optionen und wählen Sie die passende Unterkunft.",
    sleeps: (n: number) => `Bis zu ${n} Gäste`,
    size: (n: number) => `${n} m²`,
    selected: "Ausgewählte Unterkunft",
    availability: "Verfügbarkeit",
    dateHint: "Wählen Sie zuerst den Check-in und danach den Check-out.",
    selectedDates: "Ausgewählte Daten",
    checkin: "Check-in",
    checkout: "Check-out",
    from: "ab",
    bookSummary: "Ihr Aufenthalt",
    chooseDatesPrice: "Wählen Sie Daten, um den exakten Preis zu sehen",
    details: "Ihre Angaben",
    detailsBody: "Wir verwenden diese Angaben für Bestätigung und Aufenthaltsinformationen.",
    fullName: "Vor- und Nachname",
    email: "E-Mail-Adresse",
    phone: "Mobilnummer",
    guests: "Gäste",
    payment: "Zahlung",
    payCard: "Kartenzahlung",
    payCardHint: "Sicher über Stripe",
    paySwish: "Swish",
    paySwishHint: "Nach der Buchung bezahlen",
    termsStart: "Ich akzeptiere die",
    terms: "Buchungsbedingungen",
    privacy: "Datenschutzerklärung",
    and: "und habe die",
    securePayment: "Sichere Zahlung",
    directHost: "Direkt bei der Unterkunft",
    instantConfirmation: "Sofortige Bestätigung",
    included: "Das ist enthalten",
    quantity: "Anzahl",
    remove: "Entfernen",
    errName: "Geben Sie Ihren Namen ein, um fortzufahren.",
    errEmail: "Geben Sie eine gültige E-Mail-Adresse für die Bestätigung ein.",
    errPhone: "Die Mobilnummer scheint keine gültige schwedische Mobilnummer zu sein.",
    errTerms: "Akzeptieren Sie die Buchungsbedingungen, um fortzufahren.",
    errSwishPhone: "Für Swish ist eine Mobilnummer erforderlich.",
    errCapacity: (n: number) => `Die Unterkunft erlaubt maximal ${n} Gäste.`,
    errRateLimit:
      "Es gab viele Buchungsversuche in kurzer Zeit. Bitte versuchen Sie es später erneut.",
    errClosed: "Die Unterkunft ist während eines Teils des gewählten Zeitraums geschlossen.",
    errArrival: "An diesem Datum ist kein Check-in möglich. Wählen Sie ein anderes Datum.",
    errDeparture: "An diesem Datum ist kein Check-out möglich. Wählen Sie ein anderes Datum.",
    nights: (n: number) => `${n} ${n === 1 ? "Nacht" : "Nächte"}`,
    taxesIncluded: "Preis gemäß den aktuellen Preisregeln der Unterkunft.",
    editDates: "Daten ändern",
  },
} as const;

type ExtraStrings = {
  [K in keyof (typeof EXTRA)["sv"]]: (typeof EXTRA)["sv"][K] extends (...args: infer A) => string
    ? (...args: A) => string
    : string;
};

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
  rateRules: RateRule[];
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

const pricingOf = (u: EngineUnit): UnitPricing => ({
  base_price: u.basePrice,
  weekend_pct: u.weekendPct,
  cleaning_fee: u.cleaningFee,
  monthly_mult: (u.monthlyMult ?? []).map(Number),
});

const isBooked = (u: EngineUnit, iso: string) => u.booked.some((r) => iso >= r.from && iso < r.to);
const rangeFree = (u: EngineUnit, from: string, to: string) =>
  !u.booked.some((r) => rangesOverlap(from, to, r.from, r.to));
const ruleCovers = (r: RateRule, iso: string) => r.active && iso >= r.date_from && iso <= r.date_to;
const isClosed = (u: EngineUnit, iso: string) =>
  (u.rateRules ?? []).some((r) => r.kind === "closed" && ruleCovers(r, iso));
const arrivalBlocked = (u: EngineUnit, iso: string) =>
  (u.rateRules ?? []).some((r) => r.kind === "no_arrival" && ruleCovers(r, iso));
const departureBlocked = (u: EngineUnit, iso: string) =>
  (u.rateRules ?? []).some((r) => r.kind === "no_departure" && ruleCovers(r, iso));

function PublicBookingPage() {
  const { slug } = Route.useParams();
  const [lang, setLangState] = useState<Lang>(detectLang);
  const t = getStrings(lang);
  const x = EXTRA[lang];
  const locale = LOCALES[lang];
  const setLang = (next: Lang) => {
    setLangState(next);
    persistLang(next);
  };

  const dateLong = (value: string) =>
    new Date(`${value}T12:00:00`).toLocaleDateString(locale, {
      weekday: "short",
      day: "numeric",
      month: "long",
    });
  const fmtKr = (value: number) => `${Math.round(value).toLocaleString(locale)} kr`;

  const [data, setData] = useState<EngineData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [monthOffset, setMonthOffset] = useState(0);
  const [checkin, setCheckin] = useState<string | null>(null);
  const [checkout, setCheckout] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [guests, setGuests] = useState(2);
  const [addonQty, setAddonQty] = useState<Record<string, number>>({});
  const [payChoice, setPayChoice] = useState<"stripe" | "swish" | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [website, setWebsite] = useState("");
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState<{
    token: string;
    total: number;
    swishNumber?: string;
    paymentRef?: string;
  } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!FUNCTIONS_BASE) {
      setLoadError(true);
      return;
    }
    fetch(`${FUNCTIONS_BASE}/functions/v1/booking-engine?slug=${encodeURIComponent(slug)}`)
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((payload: EngineData) => {
        setData(payload);
        if (payload.units.length > 0) {
          setUnitId(payload.units[0].id);
          setGuests(Math.min(2, payload.units[0].maxGuests));
        }
      })
      .catch(() => setLoadError(true));
  }, [slug]);

  const unit = data?.units.find((candidate) => candidate.id === unitId) ?? null;
  const pricing = unit ? pricingOf(unit) : null;

  const quote = useMemo(
    () =>
      pricing && unit && checkin && checkout
        ? quoteStay(pricing, checkin, checkout, {
            rules: unit.rateRules ?? [],
            unitId: unit.id,
          })
        : null,
    [pricing, unit, checkin, checkout],
  );

  const requiredMinStay = useMemo(() => {
    if (!unit || !quote) return unit?.minStay ?? 1;
    return Math.max(
      unit.minStay,
      minStayFromRules(
        unit.rateRules ?? [],
        unit.id,
        quote.nightly.map((night) => night.date),
      ),
    );
  }, [unit, quote]);

  const chosenAddons = useMemo(() => {
    if (!data || !quote) return [];
    return data.addons
      .filter((addon) => (addonQty[addon.id] ?? 0) > 0)
      .map((addon) => {
        const qty = addonQty[addon.id] ?? 0;
        const lineTotal =
          addon.priceType === "per_night" ? addon.price * qty * quote.nights : addon.price * qty;
        return { ...addon, qty, lineTotal };
      });
  }, [data, quote, addonQty]);

  const addonsTotal = chosenAddons.reduce((sum, addon) => sum + addon.lineTotal, 0);
  const grandTotal = (quote?.total ?? 0) + addonsTotal;
  const minStayOk = !quote || quote.nights >= requiredMinStay;

  const payMethods = data
    ? ([
        ...(data.property.stripeAvailable ? (["stripe"] as const) : []),
        ...(data.property.swishNumber ? (["swish"] as const) : []),
      ] as ("stripe" | "swish")[])
    : [];
  const payMethod =
    payChoice && payMethods.includes(payChoice) ? payChoice : (payMethods[0] ?? null);

  const nameValid = name.trim().length >= 2;
  const emailValid = EMAIL.test(email.trim());
  const canSubmit = Boolean(unit && quote && minStayOk && !sending);

  const resetDates = () => {
    setCheckin(null);
    setCheckout(null);
    setFormError(null);
  };

  const selectUnit = (next: EngineUnit) => {
    setUnitId(next.id);
    setGuests((current) => Math.max(1, Math.min(current, next.maxGuests)));
    resetDates();
  };

  const pickDate = (iso: string) => {
    if (!unit) return;
    setFormError(null);

    const startsNewRange = !checkin || Boolean(checkin && checkout) || iso < checkin;
    if (startsNewRange) {
      if (arrivalBlocked(unit, iso) || isClosed(unit, iso) || isBooked(unit, iso)) return;
      setCheckin(iso);
      setCheckout(null);
      return;
    }
    if (iso === checkin) return;
    if (departureBlocked(unit, iso)) return;
    if (!rangeFree(unit, checkin, iso)) return;
    const nights: string[] = [];
    for (let current = checkin; current < iso; ) {
      nights.push(current);
      const date = new Date(`${current}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + 1);
      current = date.toISOString().slice(0, 10);
    }
    if (nights.some((night) => isClosed(unit, night))) return;
    setCheckout(iso);
  };

  const validateBeforeSubmit = () => {
    if (!unit || !quote) return false;
    if (!nameValid) {
      setFormError(x.errName);
      return false;
    }
    if (!emailValid) {
      setFormError(x.errEmail);
      return false;
    }
    if (payMethod === "swish" && !phone.trim()) {
      setFormError(x.errSwishPhone);
      return false;
    }
    if (!termsAccepted) {
      setFormError(x.errTerms);
      return false;
    }
    return true;
  };

  const submit = async () => {
    if (!unit || !checkin || !checkout || !quote || sending || !validateBeforeSubmit()) return;
    setSending(true);
    setFormError(null);
    try {
      const response = await fetch(`${FUNCTIONS_BASE}/functions/v1/booking-engine`, {
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
          addons: (Object.entries(addonQty) as [string, number][])
            .filter(([, quantity]) => quantity > 0)
            .map(([id, quantity]) => ({ id, quantity })),
          termsAccepted,
          website,
          ...(payMethod ? { paymentMethod: payMethod } : {}),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        const message =
          payload.error === "unavailable"
            ? t.errUnavailable
            : payload.error === "min_stay"
              ? t.errMinStay(payload.minStay)
              : payload.error === "name_required"
                ? x.errName
                : payload.error === "email_required"
                  ? x.errEmail
                  : payload.error === "invalid_phone"
                    ? x.errPhone
                    : payload.error === "terms_required"
                      ? x.errTerms
                      : payload.error === "phone_required_for_swish"
                        ? x.errSwishPhone
                        : payload.error === "capacity_exceeded"
                          ? x.errCapacity(payload.maxGuests ?? unit.maxGuests)
                          : payload.error === "rate_limited"
                            ? x.errRateLimit
                            : payload.error === "closed"
                              ? x.errClosed
                              : payload.error === "no_arrival"
                                ? x.errArrival
                                : payload.error === "no_departure"
                                  ? x.errDeparture
                                  : payload.error === "stripe_failed"
                                    ? t.errStripe
                                    : t.errGeneric;
        setFormError(message);
      } else if (payload.checkoutUrl) {
        window.location.href = payload.checkoutUrl;
        return;
      } else {
        setDone({
          token: payload.guestToken,
          total: payload.grandTotal ?? payload.price.total,
          swishNumber: payload.swishNumber,
          paymentRef: payload.paymentRef,
        });
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch {
      setFormError(t.errGeneric);
    } finally {
      setSending(false);
    }
  };

  if (loadError) {
    return (
      <div
        className="grid min-h-screen place-items-center px-6 text-center"
        style={{ background: C.page, color: C.ink }}
      >
        <div
          className="max-w-md rounded-[32px] border bg-white p-10"
          style={{ borderColor: C.line }}
        >
          <p className="font-[Fraunces] text-3xl">{t.notFoundTitle}</p>
          <p className="mt-3 text-[15px] leading-relaxed" style={{ color: C.muted }}>
            {t.notFoundBody}
          </p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="grid min-h-screen place-items-center" style={{ background: C.page }}>
        <Loader2 className="animate-spin" style={{ color: C.forest }} size={30} />
      </div>
    );
  }

  const guestUrl = done ? `${window.location.origin}/g/${done.token}` : null;

  if (done) {
    return (
      <div
        className="min-h-screen px-5 py-10 sm:py-16"
        style={{ background: C.page, color: C.ink }}
      >
        <div
          className="mx-auto max-w-2xl overflow-hidden rounded-[34px] border bg-white shadow-[0_24px_80px_rgba(23,35,29,0.08)]"
          style={{ borderColor: C.line }}
        >
          <div className="p-7 sm:p-10">
            <span
              className="grid h-14 w-14 place-items-center rounded-full text-white"
              style={{ background: C.forest }}
            >
              <Check size={24} />
            </span>
            <p
              className="mt-8 text-[11px] font-bold uppercase tracking-[0.2em]"
              style={{ color: C.brass }}
            >
              {t.bookDirect}
            </p>
            <h1 className="mt-2 font-[Fraunces] text-4xl font-semibold sm:text-5xl">
              {t.thankYou}
            </h1>
            <p className="mt-4 text-[15px] leading-relaxed" style={{ color: C.muted }}>
              {unit?.name} · {dateLong(checkin!)} – {dateLong(checkout!)} · {fmtKr(done.total)}
              <br />
              {t.confirmationOnWay}
            </p>

            {done.swishNumber ? (
              <div
                className="mt-8 rounded-[24px] border p-5 sm:p-6"
                style={{ borderColor: C.line, background: C.page }}
              >
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white">
                    <CreditCard size={18} />
                  </div>
                  <div>
                    <h2 className="font-sans text-[15px] font-bold">{t.payWithSwish}</h2>
                    <p className="mt-1 text-[13px]" style={{ color: C.muted }}>
                      {t.swishInstructions(fmtKr(done.total))}
                    </p>
                  </div>
                </div>
                <div className="mt-5 divide-y" style={{ borderColor: C.line }}>
                  {[
                    { label: t.swishNumber, value: done.swishNumber, key: "nr" },
                    { label: t.messageLabel, value: done.paymentRef ?? "", key: "ref" },
                  ].map((row) => (
                    <button
                      key={row.key}
                      onClick={() => {
                        navigator.clipboard.writeText(row.value);
                        setCopied(row.key);
                        setTimeout(() => setCopied(null), 1500);
                      }}
                      className="flex w-full items-center justify-between gap-4 py-3.5 text-left"
                    >
                      <span>
                        <span
                          className="block text-[11px] font-semibold uppercase tracking-[0.12em]"
                          style={{ color: C.muted }}
                        >
                          {row.label}
                        </span>
                        <span className="mt-0.5 block font-mono text-[16px]">{row.value}</span>
                      </span>
                      {copied === row.key ? (
                        <Check size={17} />
                      ) : (
                        <Copy size={17} style={{ color: C.muted }} />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <button
              onClick={() => {
                navigator.clipboard.writeText(guestUrl!);
                setCopied("link");
                setTimeout(() => setCopied(null), 1500);
              }}
              className="mt-8 flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-4 text-[14px] font-bold text-white transition hover:opacity-90"
              style={{ background: C.forest }}
            >
              {copied === "link" ? <Check size={17} /> : <Copy size={17} />}
              {copied === "link" ? t.linkCopied : t.copyGuestLink}
            </button>
            <a
              href={guestUrl!}
              className="mt-4 block text-center text-[13px] font-semibold underline underline-offset-4"
              style={{ color: C.muted }}
            >
              {t.openGuestPage}
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20" style={{ background: C.page, color: C.ink }}>
      <header className="border-b bg-white/85 backdrop-blur-xl" style={{ borderColor: C.line }}>
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-5 py-4 sm:px-8">
          <div className="min-w-0 flex-1">
            <p className="truncate font-[Fraunces] text-xl font-semibold sm:text-2xl">
              {data.property.name}
            </p>
            <p
              className="hidden text-[11px] font-semibold uppercase tracking-[0.16em] sm:block"
              style={{ color: C.muted }}
            >
              {x.secureDirect}
            </p>
          </div>
          <div
            className="flex items-center rounded-full border bg-white p-1"
            style={{ borderColor: C.line }}
          >
            {LANGS.map((language) => (
              <button
                key={language.id}
                onClick={() => setLang(language.id)}
                className="rounded-full px-3 py-1.5 text-[11px] font-bold transition"
                style={{
                  background: lang === language.id ? C.forest : "transparent",
                  color: lang === language.id ? "white" : C.muted,
                }}
              >
                {language.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-7 sm:px-8 sm:py-10">
        <div
          className="mb-7 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px] font-semibold"
          style={{ color: C.muted }}
        >
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck size={15} style={{ color: C.forest }} /> {x.securePayment}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Sparkles size={15} style={{ color: C.forest }} /> {x.directHost}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Check size={15} style={{ color: C.forest }} /> {x.instantConfirmation}
          </span>
        </div>

        <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_390px] xl:gap-10">
          <div className="space-y-7">
            <section
              className="overflow-hidden rounded-[30px] border bg-white"
              style={{ borderColor: C.line }}
            >
              <div className="p-6 sm:p-8">
                <p
                  className="text-[11px] font-bold uppercase tracking-[0.18em]"
                  style={{ color: C.brass }}
                >
                  {t.bookDirect}
                </p>
                <h1 className="mt-2 max-w-2xl font-[Fraunces] text-4xl font-semibold leading-[1.05] sm:text-5xl">
                  {x.secureDirect}
                </h1>
                <p className="mt-3 max-w-xl text-[15px] leading-relaxed" style={{ color: C.muted }}>
                  {x.secureDirectBody}
                </p>
                <div
                  className="mt-6 flex flex-wrap gap-2 text-[12px] font-semibold"
                  style={{ color: C.muted }}
                >
                  <span className="rounded-full px-3 py-1.5" style={{ background: C.page }}>
                    {t.checkinFrom(data.property.checkinTime)}
                  </span>
                  <span className="rounded-full px-3 py-1.5" style={{ background: C.page }}>
                    {t.checkoutAt(data.property.checkoutTime)}
                  </span>
                </div>
              </div>
            </section>

            <section
              className="rounded-[30px] border bg-white p-5 sm:p-7"
              style={{ borderColor: C.line }}
            >
              <SectionHeading step="01" title={x.chooseStay} description={x.chooseStayBody} />
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                {data.units.map((candidate) => (
                  <UnitCard
                    key={candidate.id}
                    unit={candidate}
                    selected={candidate.id === unitId}
                    locale={locale}
                    onSelect={() => selectUnit(candidate)}
                    labels={x}
                  />
                ))}
              </div>
            </section>

            {unit ? (
              <section
                className="rounded-[30px] border bg-white p-5 sm:p-7"
                style={{ borderColor: C.line }}
              >
                <SectionHeading step="02" title={x.availability} description={x.dateHint} />
                <div
                  className="mt-6 rounded-[24px] border p-3 sm:p-5"
                  style={{ borderColor: C.line, background: C.paper }}
                >
                  <div className="flex items-center justify-between px-1">
                    <button
                      onClick={() => setMonthOffset((offset) => Math.max(0, offset - 1))}
                      disabled={monthOffset === 0}
                      className="grid h-10 w-10 place-items-center rounded-full border bg-white transition disabled:opacity-25"
                      style={{ borderColor: C.line }}
                      aria-label={t.prevMonth}
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <span className="text-[13px] font-bold capitalize">
                      {new Date(
                        new Date().getFullYear(),
                        new Date().getMonth() + monthOffset,
                        1,
                      ).toLocaleDateString(locale, { month: "long", year: "numeric" })}
                    </span>
                    <button
                      onClick={() => setMonthOffset((offset) => Math.min(11, offset + 1))}
                      className="grid h-10 w-10 place-items-center rounded-full border bg-white"
                      style={{ borderColor: C.line }}
                      aria-label={t.nextMonth}
                    >
                      <ChevronRight size={18} />
                    </button>
                  </div>
                  <MonthCalendar
                    monthOffset={monthOffset}
                    unit={unit}
                    pricing={pricing!}
                    checkin={checkin}
                    checkout={checkout}
                    onPick={pickDate}
                    weekdays={t.weekdays}
                    locale={locale}
                  />
                  <div
                    className="mt-3 flex flex-wrap justify-between gap-2 px-1 text-[11px] font-medium"
                    style={{ color: C.muted }}
                  >
                    <span>{t.minStay(unit.minStay)}</span>
                    <span>{t.weekendUplift(unit.weekendPct)}</span>
                  </div>
                </div>

                {checkin ? (
                  <div
                    className="mt-4 grid gap-3 rounded-[22px] p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-center"
                    style={{ background: C.forestSoft }}
                  >
                    <DateSummary label={x.checkin} value={dateLong(checkin)} />
                    <DateSummary label={x.checkout} value={checkout ? dateLong(checkout) : "—"} />
                    <button
                      onClick={resetDates}
                      className="text-left text-[12px] font-bold underline underline-offset-4 sm:text-right"
                      style={{ color: C.forest }}
                    >
                      {x.editDates}
                    </button>
                  </div>
                ) : null}

                {quote && !minStayOk ? (
                  <p
                    className="mt-4 rounded-2xl px-4 py-3 text-[13px] font-medium"
                    style={{ background: "#FFF4E8", color: "#915628" }}
                  >
                    {t.minStayWarning(unit.name, requiredMinStay)}
                  </p>
                ) : null}
              </section>
            ) : null}

            {unit && data.addons.length > 0 ? (
              <section
                className="rounded-[30px] border bg-white p-5 sm:p-7"
                style={{ borderColor: C.line }}
              >
                <SectionHeading step="03" title={t.addonsTitle} description="" />
                <div className="mt-5 divide-y" style={{ borderColor: C.line }}>
                  {data.addons.map((addon) => {
                    const qty = addonQty[addon.id] ?? 0;
                    return (
                      <div key={addon.id} className="flex gap-4 py-4 first:pt-0 last:pb-0">
                        {addon.imageUrl ? (
                          <img
                            src={addon.imageUrl}
                            alt=""
                            className="h-20 w-20 shrink-0 rounded-2xl object-cover"
                          />
                        ) : (
                          <div
                            className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl"
                            style={{ background: C.page, color: C.muted }}
                          >
                            <Sparkles size={20} />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <p className="text-[14px] font-bold">{addon.name}</p>
                              {addon.description ? (
                                <p
                                  className="mt-1 line-clamp-2 text-[12px] leading-relaxed"
                                  style={{ color: C.muted }}
                                >
                                  {addon.description}
                                </p>
                              ) : null}
                            </div>
                            <p className="shrink-0 text-[13px] font-bold">
                              {fmtKr(addon.price)}
                              {addon.priceType === "per_night" ? t.perNight : ""}
                            </p>
                          </div>
                          <div className="mt-3 flex items-center justify-end gap-2">
                            {qty === 0 ? (
                              <button
                                onClick={() =>
                                  setAddonQty((current) => ({ ...current, [addon.id]: 1 }))
                                }
                                className="rounded-full border px-4 py-2 text-[12px] font-bold"
                                style={{ borderColor: C.forest, color: C.forest }}
                              >
                                {t.add}
                              </button>
                            ) : (
                              <div
                                className="flex items-center gap-2 rounded-full border bg-white p-1"
                                style={{ borderColor: C.line }}
                              >
                                <button
                                  onClick={() =>
                                    setAddonQty((current) => ({
                                      ...current,
                                      [addon.id]: Math.max(0, qty - 1),
                                    }))
                                  }
                                  className="grid h-8 w-8 place-items-center rounded-full"
                                  aria-label={t.decrease}
                                >
                                  <Minus size={14} />
                                </button>
                                <span className="min-w-5 text-center text-[13px] font-bold">
                                  {qty}
                                </span>
                                <button
                                  onClick={() =>
                                    setAddonQty((current) => ({
                                      ...current,
                                      [addon.id]: Math.min(20, qty + 1),
                                    }))
                                  }
                                  className="grid h-8 w-8 place-items-center rounded-full"
                                  aria-label={t.increase}
                                >
                                  <Plus size={14} />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {quote && unit ? (
              <section
                className="rounded-[30px] border bg-white p-5 sm:p-7 lg:hidden"
                style={{ borderColor: C.line }}
              >
                <CheckoutForm
                  unit={unit}
                  quote={quote}
                  grandTotal={grandTotal}
                  addons={chosenAddons}
                  name={name}
                  email={email}
                  phone={phone}
                  guests={guests}
                  payMethods={payMethods}
                  payMethod={payMethod}
                  termsAccepted={termsAccepted}
                  formError={formError}
                  sending={sending}
                  canSubmit={canSubmit}
                  checkin={checkin!}
                  checkout={checkout!}
                  t={t}
                  x={x}
                  locale={locale}
                  onName={setName}
                  onEmail={setEmail}
                  onPhone={setPhone}
                  onGuests={setGuests}
                  onPay={setPayChoice}
                  onTerms={setTermsAccepted}
                  onSubmit={submit}
                />
              </section>
            ) : null}
          </div>

          <aside className="hidden lg:block">
            <div
              className="sticky top-7 rounded-[30px] border bg-white p-6 shadow-[0_24px_70px_rgba(23,35,29,0.07)]"
              style={{ borderColor: C.line }}
            >
              {unit && quote && checkin && checkout ? (
                <CheckoutForm
                  unit={unit}
                  quote={quote}
                  grandTotal={grandTotal}
                  addons={chosenAddons}
                  name={name}
                  email={email}
                  phone={phone}
                  guests={guests}
                  payMethods={payMethods}
                  payMethod={payMethod}
                  termsAccepted={termsAccepted}
                  formError={formError}
                  sending={sending}
                  canSubmit={canSubmit}
                  checkin={checkin}
                  checkout={checkout}
                  t={t}
                  x={x}
                  locale={locale}
                  onName={setName}
                  onEmail={setEmail}
                  onPhone={setPhone}
                  onGuests={setGuests}
                  onPay={setPayChoice}
                  onTerms={setTermsAccepted}
                  onSubmit={submit}
                />
              ) : (
                <EmptyCheckout unit={unit} x={x} fmtKr={fmtKr} />
              )}
            </div>
          </aside>
        </div>

        <input
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="pointer-events-none fixed -left-[9999px] h-px w-px opacity-0"
        />

        <p className="mt-12 text-center text-[11px] font-medium" style={{ color: C.muted }}>
          <Link to="/" className="hover:underline">
            {t.poweredBy}
          </Link>
        </p>
      </main>
    </div>
  );
}

function SectionHeading({
  step,
  title,
  description,
}: {
  step: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-4">
      <span
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white"
        style={{ background: C.forest }}
      >
        {step}
      </span>
      <div>
        <h2 className="font-[Fraunces] text-2xl font-semibold">{title}</h2>
        {description ? (
          <p className="mt-1 text-[13px] leading-relaxed" style={{ color: C.muted }}>
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function UnitCard({
  unit,
  selected,
  locale,
  onSelect,
  labels,
}: {
  unit: EngineUnit;
  selected: boolean;
  locale: string;
  onSelect: () => void;
  labels: ExtraStrings;
}) {
  const lowestMult = Math.min(...(unit.monthlyMult?.length ? unit.monthlyMult : [100]).map(Number));
  const fromPrice = Math.round((unit.basePrice * lowestMult) / 100);
  return (
    <button
      onClick={onSelect}
      className="group overflow-hidden rounded-[24px] border text-left transition hover:-translate-y-0.5 hover:shadow-[0_14px_35px_rgba(23,35,29,0.08)]"
      style={{
        borderColor: selected ? C.forest : C.line,
        background: selected ? C.forestSoft : "white",
      }}
    >
      <div className="relative aspect-[16/9] overflow-hidden" style={{ background: C.page }}>
        {unit.imageUrl ? (
          <img
            src={unit.imageUrl}
            alt={unit.name}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.025]"
          />
        ) : (
          <div className="grid h-full place-items-center" style={{ color: C.muted }}>
            <BedDouble size={28} />
          </div>
        )}
        {selected ? (
          <span
            className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-bold text-white"
            style={{ background: C.forest }}
          >
            <Check size={12} /> {labels.selected}
          </span>
        ) : null}
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-sans text-[15px] font-bold">{unit.name}</h3>
          <span className="shrink-0 text-[12px] font-bold">
            {labels.from} {fromPrice.toLocaleString(locale)} kr
          </span>
        </div>
        {unit.description ? (
          <p className="mt-2 line-clamp-2 text-[12px] leading-relaxed" style={{ color: C.muted }}>
            {unit.description}
          </p>
        ) : null}
        <div
          className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-semibold"
          style={{ color: C.muted }}
        >
          <span className="inline-flex items-center gap-1">
            <Users size={13} /> {labels.sleeps(unit.maxGuests)}
          </span>
          {unit.bedDescription ? (
            <span className="inline-flex items-center gap-1">
              <BedDouble size={13} /> {unit.bedDescription}
            </span>
          ) : null}
          {unit.sizeSqm ? <span>{labels.size(unit.sizeSqm)}</span> : null}
        </div>
        {unit.amenities?.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {unit.amenities.slice(0, 4).map((amenity) => (
              <span
                key={amenity}
                className="rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold"
                style={{ color: C.muted }}
              >
                {amenity}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </button>
  );
}

function EmptyCheckout({
  unit,
  x,
  fmtKr,
}: {
  unit: EngineUnit | null;
  x: ExtraStrings;
  fmtKr: (value: number) => string;
}) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: C.brass }}>
        {x.bookSummary}
      </p>
      <h2 className="mt-2 font-[Fraunces] text-3xl font-semibold">{x.chooseDatesPrice}</h2>
      {unit ? (
        <div className="mt-6 rounded-[22px] p-4" style={{ background: C.page }}>
          <p className="text-[13px] font-bold">{unit.name}</p>
          <p className="mt-1 text-[12px]" style={{ color: C.muted }}>
            {x.from} {fmtKr(unit.basePrice)} · {x.sleeps(unit.maxGuests)}
          </p>
        </div>
      ) : null}
      <div
        className="mt-6 space-y-3 border-t pt-5 text-[12px] font-semibold"
        style={{ borderColor: C.line, color: C.muted }}
      >
        <p className="flex items-center gap-2">
          <ShieldCheck size={15} style={{ color: C.forest }} /> {x.securePayment}
        </p>
        <p className="flex items-center gap-2">
          <Sparkles size={15} style={{ color: C.forest }} /> {x.directHost}
        </p>
        <p className="flex items-center gap-2">
          <Check size={15} style={{ color: C.forest }} /> {x.instantConfirmation}
        </p>
      </div>
    </div>
  );
}

function CheckoutForm({
  unit,
  quote,
  grandTotal,
  addons,
  name,
  email,
  phone,
  guests,
  payMethods,
  payMethod,
  termsAccepted,
  formError,
  sending,
  canSubmit,
  checkin,
  checkout,
  t,
  x,
  locale,
  onName,
  onEmail,
  onPhone,
  onGuests,
  onPay,
  onTerms,
  onSubmit,
}: {
  unit: EngineUnit;
  quote: ReturnType<typeof quoteStay>;
  grandTotal: number;
  addons: Array<EngineAddon & { qty: number; lineTotal: number }>;
  name: string;
  email: string;
  phone: string;
  guests: number;
  payMethods: ("stripe" | "swish")[];
  payMethod: "stripe" | "swish" | null;
  termsAccepted: boolean;
  formError: string | null;
  sending: boolean;
  canSubmit: boolean;
  checkin: string;
  checkout: string;
  t: ReturnType<typeof getStrings>;
  x: ExtraStrings;
  locale: string;
  onName: (value: string) => void;
  onEmail: (value: string) => void;
  onPhone: (value: string) => void;
  onGuests: (value: number) => void;
  onPay: (value: "stripe" | "swish") => void;
  onTerms: (value: boolean) => void;
  onSubmit: () => void;
}) {
  const fmtKr = (value: number) => `${Math.round(value).toLocaleString(locale)} kr`;
  const date = (value: string) =>
    new Date(`${value}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short" });

  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: C.brass }}>
        {x.bookSummary}
      </p>
      <div className="mt-3 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-[Fraunces] text-2xl font-semibold">{unit.name}</h2>
          <p className="mt-1 text-[12px]" style={{ color: C.muted }}>
            {date(checkin)} – {date(checkout)} · {x.nights(quote.nights)}
          </p>
        </div>
        <p className="font-[Fraunces] text-2xl font-semibold">{fmtKr(grandTotal)}</p>
      </div>

      <div className="mt-5 space-y-2 border-y py-4 text-[12px]" style={{ borderColor: C.line }}>
        <PriceRow
          label={`${x.nights(quote.nights)} · ${unit.name}`}
          value={fmtKr(quote.subtotal)}
        />
        {quote.cleaningFee > 0 ? (
          <PriceRow label={t.cleaning} value={fmtKr(quote.cleaningFee)} />
        ) : null}
        {addons.map((addon) => (
          <PriceRow
            key={addon.id}
            label={`${addon.name} ×${addon.qty}`}
            value={fmtKr(addon.lineTotal)}
          />
        ))}
        <div className="flex items-baseline justify-between gap-4 pt-2 font-bold">
          <span>{t.total}</span>
          <span className="text-[15px]">{fmtKr(grandTotal)}</span>
        </div>
        <p className="pt-1 text-[10px]" style={{ color: C.muted }}>
          {x.taxesIncluded}
        </p>
      </div>

      <div className="mt-6">
        <h3 className="font-sans text-[13px] font-bold">{x.details}</h3>
        <p className="mt-1 text-[11px] leading-relaxed" style={{ color: C.muted }}>
          {x.detailsBody}
        </p>
        <div className="mt-4 space-y-2.5">
          <Input value={name} onChange={onName} label={x.fullName} autoComplete="name" />
          <Input
            value={email}
            onChange={onEmail}
            label={x.email}
            type="email"
            autoComplete="email"
          />
          <Input value={phone} onChange={onPhone} label={x.phone} type="tel" autoComplete="tel" />
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold" style={{ color: C.muted }}>
              {x.guests}
            </span>
            <select
              value={guests}
              onChange={(event) => onGuests(Number(event.target.value))}
              className="w-full rounded-xl border bg-white px-3.5 py-3 text-[13px] font-semibold outline-none"
              style={{ borderColor: C.line }}
            >
              {Array.from({ length: unit.maxGuests }, (_, index) => index + 1).map((count) => (
                <option key={count} value={count}>
                  {t.guests(count)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {payMethods.length > 0 ? (
        <div className="mt-6">
          <h3 className="font-sans text-[13px] font-bold">{x.payment}</h3>
          <div className="mt-3 space-y-2">
            {payMethods.map((method) => {
              const selected = payMethod === method;
              const card = method === "stripe";
              return (
                <button
                  key={method}
                  type="button"
                  onClick={() => onPay(method)}
                  className="flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition"
                  style={{
                    borderColor: selected ? C.forest : C.line,
                    background: selected ? C.forestSoft : "white",
                  }}
                >
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-white">
                    <CreditCard size={16} />
                  </span>
                  <span className="flex-1">
                    <span className="block text-[12px] font-bold">
                      {card ? x.payCard : x.paySwish}
                    </span>
                    <span className="block text-[10px]" style={{ color: C.muted }}>
                      {card ? x.payCardHint : x.paySwishHint}
                    </span>
                  </span>
                  <span
                    className="grid h-5 w-5 place-items-center rounded-full border"
                    style={{ borderColor: selected ? C.forest : C.line }}
                  >
                    {selected ? (
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: C.forest }} />
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <label
        className="mt-5 flex cursor-pointer items-start gap-3 text-[11px] leading-relaxed"
        style={{ color: C.muted }}
      >
        <input
          type="checkbox"
          checked={termsAccepted}
          onChange={(event) => onTerms(event.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[#173D2E]"
        />
        <span>
          {x.termsStart}{" "}
          <Link
            to="/villkor"
            target="_blank"
            className="font-bold underline underline-offset-2"
            style={{ color: C.ink }}
          >
            {x.terms}
          </Link>{" "}
          {x.and}{" "}
          <Link
            to="/integritetspolicy"
            target="_blank"
            className="font-bold underline underline-offset-2"
            style={{ color: C.ink }}
          >
            {x.privacy}
          </Link>
          .
        </span>
      </label>

      <AnimatePresence initial={false}>
        {formError ? (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-4 rounded-2xl px-4 py-3 text-[12px] font-semibold"
            style={{ background: "#FFF0ED", color: C.danger }}
          >
            {formError}
          </motion.p>
        ) : null}
      </AnimatePresence>

      <button
        onClick={onSubmit}
        disabled={!canSubmit}
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-4 text-[13px] font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-35"
        style={{ background: C.forest }}
      >
        {sending ? <Loader2 size={16} className="animate-spin" /> : <LockKeyhole size={15} />}
        {sending
          ? t.booking
          : payMethod === "stripe"
            ? t.payWithCard(fmtKr(grandTotal))
            : t.bookFor(fmtKr(grandTotal))}
      </button>
      <p className="mt-3 text-center text-[10px] leading-relaxed" style={{ color: C.muted }}>
        {payMethod === "stripe"
          ? t.stripeFineprint
          : payMethod === "swish"
            ? t.swishFineprint
            : t.noPaymentFineprint}
      </p>
    </div>
  );
}

function Input({
  value,
  onChange,
  label,
  type = "text",
  autoComplete,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-bold" style={{ color: C.muted }}>
        {label}
      </span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        type={type}
        autoComplete={autoComplete}
        className="w-full rounded-xl border bg-white px-3.5 py-3 text-[13px] outline-none transition focus:border-[#173D2E]"
        style={{ borderColor: C.line }}
      />
    </label>
  );
}

function PriceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span style={{ color: C.muted }}>{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

function DateSummary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: C.muted }}>
        {label}
      </p>
      <p className="mt-0.5 text-[13px] font-bold capitalize">{value}</p>
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
    ...Array.from({ length: daysInMonth }, (_, index) =>
      isoOf(new Date(Date.UTC(year, month, index + 1))),
    ),
  ];

  return (
    <div className="mt-5">
      <div
        className="grid grid-cols-7 gap-1 text-center text-[9px] font-bold uppercase tracking-[0.1em]"
        style={{ color: C.muted }}
      >
        {weekdays.map((day) => (
          <div key={day}>{day}</div>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-7 gap-1">
        {cells.map((iso, index) => {
          if (!iso) return <div key={`blank-${index}`} />;
          const past = iso < today;
          const booked = isBooked(unit, iso);
          const closed = isClosed(unit, iso);
          const selectingCheckout = Boolean(checkin && !checkout);
          const isStart = iso === checkin;
          const isEnd = iso === checkout;
          const inRange = Boolean(checkin && checkout && iso > checkin && iso < checkout);

          let disabled = past;
          if (selectingCheckout && checkin) {
            if (iso <= checkin || departureBlocked(unit, iso) || !rangeFree(unit, checkin, iso)) {
              disabled = true;
            } else {
              const nights: string[] = [];
              for (let current = checkin; current < iso; ) {
                nights.push(current);
                const date = new Date(`${current}T00:00:00Z`);
                date.setUTCDate(date.getUTCDate() + 1);
                current = date.toISOString().slice(0, 10);
              }
              if (nights.some((night) => isClosed(unit, night))) disabled = true;
            }
          } else if (booked || closed || arrivalBlocked(unit, iso)) {
            disabled = true;
          }

          const price = disabled
            ? null
            : nightlyPriceWithRules(pricing, iso, unit.rateRules ?? [], unit.id).price;
          return (
            <button
              key={iso}
              disabled={disabled}
              onClick={() => onPick(iso)}
              className="relative flex min-h-[58px] flex-col items-center justify-center rounded-2xl border border-transparent transition hover:border-[#DDD8CB] disabled:cursor-not-allowed"
              style={{
                background: isStart || isEnd ? C.forest : inRange ? C.forestSoft : "transparent",
                color: isStart || isEnd ? "white" : disabled ? "#C3C2BC" : C.ink,
              }}
              title={booked ? "Bokat" : closed ? "Stängt" : undefined}
            >
              <span
                className="text-[12px] font-bold"
                style={{ textDecoration: booked ? "line-through" : undefined }}
              >
                {Number(iso.slice(8))}
              </span>
              <span
                className="mt-0.5 text-[8px] font-semibold"
                style={{
                  color:
                    isStart || isEnd ? "rgba(255,255,255,.76)" : disabled ? "#C3C2BC" : C.muted,
                }}
              >
                {price ? price.toLocaleString(locale) : ""}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

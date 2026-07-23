/**
 * Bokningssidans språk: svenska, engelska, tyska.
 * Väljs automatiskt från webbläsaren, kan bytas manuellt (sparas lokalt).
 */

export type Lang = "sv" | "en" | "de";

export const LANGS: { id: Lang; label: string }[] = [
  { id: "sv", label: "SV" },
  { id: "en", label: "EN" },
  { id: "de", label: "DE" },
];

export function detectLang(): Lang {
  try {
    const saved = localStorage.getItem("boka-lang");
    if (saved === "sv" || saved === "en" || saved === "de") return saved;
  } catch {
    /* privat läge */
  }
  const nav = (navigator.language || "sv").slice(0, 2).toLowerCase();
  return nav === "en" || nav === "de" ? nav : "sv";
}

export function persistLang(lang: Lang) {
  try {
    localStorage.setItem("boka-lang", lang);
  } catch {
    /* privat läge */
  }
}

export const LOCALES: Record<Lang, string> = { sv: "sv-SE", en: "en-GB", de: "de-DE" };

const STR = {
  sv: {
    bookDirect: "Boka direkt",
    checkinFrom: (t: string) => `Incheckning från ${t}`,
    checkoutAt: (t: string) => `Utcheckning ${t}`,
    lodging: "Boende",
    fromPerNight: (price: string) => `från ${price}/natt`,
    chooseDates: "Välj datum",
    minStay: (n: number) => `Minst ${n} ${n === 1 ? "natt" : "nätter"}`,
    weekendUplift: (pct: number) => `Helgpåslag +${pct}% fre/lör`,
    addonsTitle: "Gör vistelsen ännu bättre",
    perNight: " per natt",
    add: "Lägg till",
    decrease: "Minska",
    increase: "Öka",
    yourBooking: "Din bokning",
    nights: (n: number) => (n === 1 ? "natt" : "nätter"),
    cleaning: "Städning",
    total: "Totalt",
    minStayWarning: (unit: string, n: number) =>
      `Minsta vistelse i ${unit} är ${n} ${n === 1 ? "natt" : "nätter"}.`,
    name: "Namn",
    guests: (n: number) => `${n} ${n === 1 ? "gäst" : "gäster"}`,
    emailPlaceholder: "E-post — bekräftelsen skickas hit",
    phonePlaceholder: "Telefon — SMS på incheckningsdagen",
    payment: "Betalning",
    card: "Kort",
    cardHint: "Visa · Mastercard · Stripe",
    swishHint: "Direkt i appen",
    payWithCard: (total: string) => `Betala ${total} med kort`,
    bookFor: (total: string) => `Boka · ${total}`,
    booking: "Bokar…",
    stripeFineprint: "Säker kortbetalning via Stripe — bokningen bekräftas direkt.",
    swishFineprint: "Du betalar smidigt med Swish direkt efter bokningen.",
    noPaymentFineprint: "Betalning sker enligt överenskommelse med värden.",
    errUnavailable: "Datumen hann tyvärr bokas av någon annan — välj andra datum.",
    errMinStay: (n: number) => `Minsta vistelse är ${n} ${n === 1 ? "natt" : "nätter"}.`,
    errContact: "Ange e-post eller telefon så vi kan skicka bekräftelsen.",
    errStripe: "Kortbetalningen kunde inte startas — försök igen eller välj Swish.",
    errGeneric: "Något gick fel — försök igen om en stund.",
    thankYou: "Tack för din bokning",
    confirmationOnWay: "Bekräftelsen är på väg till dig med all praktisk information.",
    payWithSwish: "Betala med Swish",
    swishInstructions: (total: string) =>
      `Swisha ${total} inom 24 timmar för att säkra din bokning.`,
    swishNumber: "Swish-nummer",
    messageLabel: "Meddelande",
    tapToCopy: "tryck för att kopiera",
    linkCopied: "Gästlänk kopierad",
    copyGuestLink: "Kopiera din gästlänk",
    openGuestPage: "Öppna din gästsida",
    notFoundTitle: "Bokningssidan hittades inte",
    notFoundBody: "Kontrollera länken — eller hör av dig direkt till oss så hjälper vi dig.",
    poweredBy: "Bokningsmotor av StayBoost",
    prevMonth: "Föregående månad",
    nextMonth: "Nästa månad",
    weekdays: ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"],
  },
  en: {
    bookDirect: "Book direct",
    checkinFrom: (t: string) => `Check-in from ${t}`,
    checkoutAt: (t: string) => `Check-out ${t}`,
    lodging: "Accommodation",
    fromPerNight: (price: string) => `from ${price}/night`,
    chooseDates: "Choose dates",
    minStay: (n: number) => `Minimum ${n} ${n === 1 ? "night" : "nights"}`,
    weekendUplift: (pct: number) => `Weekend rate +${pct}% Fri/Sat`,
    addonsTitle: "Make your stay even better",
    perNight: " per night",
    add: "Add",
    decrease: "Decrease",
    increase: "Increase",
    yourBooking: "Your booking",
    nights: (n: number) => (n === 1 ? "night" : "nights"),
    cleaning: "Cleaning",
    total: "Total",
    minStayWarning: (unit: string, n: number) =>
      `Minimum stay in ${unit} is ${n} ${n === 1 ? "night" : "nights"}.`,
    name: "Name",
    guests: (n: number) => `${n} ${n === 1 ? "guest" : "guests"}`,
    emailPlaceholder: "Email — your confirmation is sent here",
    phonePlaceholder: "Phone — SMS on check-in day",
    payment: "Payment",
    card: "Card",
    cardHint: "Visa · Mastercard · Stripe",
    swishHint: "Direct in the app",
    payWithCard: (total: string) => `Pay ${total} by card`,
    bookFor: (total: string) => `Book · ${total}`,
    booking: "Booking…",
    stripeFineprint: "Secure card payment via Stripe — your booking is confirmed instantly.",
    swishFineprint: "Pay easily with Swish right after booking.",
    noPaymentFineprint: "Payment is arranged with your host.",
    errUnavailable: "Those dates were just booked by someone else — please pick other dates.",
    errMinStay: (n: number) => `Minimum stay is ${n} ${n === 1 ? "night" : "nights"}.`,
    errContact: "Please add your email or phone so we can send the confirmation.",
    errStripe: "Card payment could not be started — try again or choose Swish.",
    errGeneric: "Something went wrong — please try again in a moment.",
    thankYou: "Thank you for your booking",
    confirmationOnWay: "Your confirmation is on its way with all practical information.",
    payWithSwish: "Pay with Swish",
    swishInstructions: (total: string) => `Swish ${total} within 24 hours to secure your booking.`,
    swishNumber: "Swish number",
    messageLabel: "Message",
    tapToCopy: "tap to copy",
    linkCopied: "Guest link copied",
    copyGuestLink: "Copy your guest link",
    openGuestPage: "Open your guest page",
    notFoundTitle: "Booking page not found",
    notFoundBody: "Check the link — or contact us directly and we'll help you.",
    poweredBy: "Booking engine by StayBoost",
    prevMonth: "Previous month",
    nextMonth: "Next month",
    weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  },
  de: {
    bookDirect: "Direkt buchen",
    checkinFrom: (t: string) => `Check-in ab ${t}`,
    checkoutAt: (t: string) => `Check-out ${t}`,
    lodging: "Unterkunft",
    fromPerNight: (price: string) => `ab ${price}/Nacht`,
    chooseDates: "Daten wählen",
    minStay: (n: number) => `Mind. ${n} ${n === 1 ? "Nacht" : "Nächte"}`,
    weekendUplift: (pct: number) => `Wochenendzuschlag +${pct}% Fr/Sa`,
    addonsTitle: "Machen Sie Ihren Aufenthalt noch schöner",
    perNight: " pro Nacht",
    add: "Hinzufügen",
    decrease: "Weniger",
    increase: "Mehr",
    yourBooking: "Ihre Buchung",
    nights: (n: number) => (n === 1 ? "Nacht" : "Nächte"),
    cleaning: "Reinigung",
    total: "Gesamt",
    minStayWarning: (unit: string, n: number) =>
      `Mindestaufenthalt in ${unit} ist ${n} ${n === 1 ? "Nacht" : "Nächte"}.`,
    name: "Name",
    guests: (n: number) => `${n} ${n === 1 ? "Gast" : "Gäste"}`,
    emailPlaceholder: "E-Mail — Ihre Bestätigung wird hierhin gesendet",
    phonePlaceholder: "Telefon — SMS am Anreisetag",
    payment: "Zahlung",
    card: "Karte",
    cardHint: "Visa · Mastercard · Stripe",
    swishHint: "Direkt in der App",
    payWithCard: (total: string) => `${total} per Karte zahlen`,
    bookFor: (total: string) => `Buchen · ${total}`,
    booking: "Bucht…",
    stripeFineprint: "Sichere Kartenzahlung über Stripe — Ihre Buchung wird sofort bestätigt.",
    swishFineprint: "Bezahlen Sie direkt nach der Buchung bequem mit Swish.",
    noPaymentFineprint: "Die Zahlung wird mit dem Gastgeber vereinbart.",
    errUnavailable:
      "Diese Daten wurden leider gerade von jemand anderem gebucht — bitte wählen Sie andere Daten.",
    errMinStay: (n: number) => `Mindestaufenthalt ist ${n} ${n === 1 ? "Nacht" : "Nächte"}.`,
    errContact: "Bitte geben Sie E-Mail oder Telefon an, damit wir die Bestätigung senden können.",
    errStripe:
      "Kartenzahlung konnte nicht gestartet werden — versuchen Sie es erneut oder wählen Sie Swish.",
    errGeneric: "Etwas ist schiefgelaufen — bitte versuchen Sie es gleich erneut.",
    thankYou: "Vielen Dank für Ihre Buchung",
    confirmationOnWay: "Ihre Bestätigung ist mit allen praktischen Informationen unterwegs.",
    payWithSwish: "Mit Swish bezahlen",
    swishInstructions: (total: string) =>
      `Swishen Sie ${total} innerhalb von 24 Stunden, um Ihre Buchung zu sichern.`,
    swishNumber: "Swish-Nummer",
    messageLabel: "Nachricht",
    tapToCopy: "Tippen zum Kopieren",
    linkCopied: "Gästelink kopiert",
    copyGuestLink: "Gästelink kopieren",
    openGuestPage: "Gästeseite öffnen",
    notFoundTitle: "Buchungsseite nicht gefunden",
    notFoundBody: "Prüfen Sie den Link — oder kontaktieren Sie uns direkt, wir helfen gerne.",
    poweredBy: "Buchungsmaschine von StayBoost",
    prevMonth: "Voriger Monat",
    nextMonth: "Nächster Monat",
    weekdays: ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"],
  },
} as const;

export type BokaStrings = (typeof STR)["sv"];

export function getStrings(lang: Lang): BokaStrings {
  return STR[lang] as BokaStrings;
}

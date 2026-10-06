/**
 * Bokningssidans språk: svenska, engelska, tyska, danska och norska (bokmål).
 * Väljs automatiskt från webbläsaren, kan bytas manuellt (sparas lokalt).
 */

export type Lang = "sv" | "en" | "de" | "da" | "no";

export const LANGS: { id: Lang; label: string }[] = [
  { id: "sv", label: "SV" },
  { id: "en", label: "EN" },
  { id: "de", label: "DE" },
  { id: "da", label: "DA" },
  { id: "no", label: "NO" },
];

export function isLang(value: unknown): value is Lang {
  return LANGS.some(({ id }) => id === value);
}

export function detectLang(): Lang {
  if (typeof window === "undefined" || typeof navigator === "undefined") return "sv";
  try {
    const saved = localStorage.getItem("boka-lang");
    if (isLang(saved)) return saved;
  } catch {
    /* privat läge */
  }
  const nav = (navigator.language || "sv").slice(0, 2).toLowerCase();
  if (nav === "nb" || nav === "nn") return "no";
  return isLang(nav) ? nav : "sv";
}

export function persistLang(lang: Lang) {
  try {
    localStorage.setItem("boka-lang", lang);
  } catch {
    /* privat läge */
  }
}

export const LOCALES: Record<Lang, string> = {
  sv: "sv-SE",
  en: "en-GB",
  de: "de-DE",
  da: "da-DK",
  no: "nb-NO",
};

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
    perMorning: " per morgon",
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
    errAddons:
      "Ett valt tillval är inte längre tillgängligt. Ta bort tillvalet eller ladda om sidan.",
    errPaymentMethod:
      "Det valda betalsättet är inte tillgängligt just nu. Välj ett annat betalsätt eller kontakta boendet.",
    errDates: "De valda datumen kan inte bokas. Välj nya in- och utcheckningsdatum.",
    errPaused: "Onlinebokningen är pausad just nu. Kontakta boendet så hjälper vi dig.",
    errPriceChanged: (price: string) =>
      `Priset har uppdaterats till ${price}. Ladda om sidan och granska priset innan du bokar.`,
    thankYou: "Tack för din bokning",
    reservationSaved: "Dina datum är reserverade",
    confirmationAfterPayment:
      "Bokningen bekräftas när boendet har registrerat din betalning. Spara gästlänken nedan.",
    confirmationOnWay: "Bekräftelsen är på väg till dig med all praktisk information.",
    payWithSwish: "Betala med Swish",
    swishInstructions: (total: string, deadline?: string) =>
      `Swisha ${total}${deadline ? ` senast ${deadline} (svensk tid)` : " innan reservationen löper ut"} för att säkra din bokning.`,
    swishNumber: "Swish-nummer",
    messageLabel: "Meddelande",
    tapToCopy: "tryck för att kopiera",
    linkCopied: "Gästlänk kopierad",
    copyGuestLink: "Kopiera din gästlänk",
    openGuestPage: "Öppna din gästsida",
    notFoundTitle: "Bokningssidan hittades inte",
    loadErrorTitle: "Bokningen kunde inte laddas just nu",
    loadErrorBody: "Försök igen om en stund eller kontakta boendet för hjälp.",
    channelSyncTitle: "Tillgängligheten uppdateras",
    channelSyncRetry: "Kalendern uppdateras just nu. Vänta en kort stund och försök igen.",
    channelSyncBody:
      "Vi uppdaterar kalendern innan nya bokningar kan tas emot. Försök igen om en stund eller kontakta boendet för hjälp.",
    retry: "Försök igen",
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
    perMorning: " per morning",
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
    errAddons: "A selected extra is no longer available. Remove the extra or reload the page.",
    errPaymentMethod:
      "Your selected payment method is currently unavailable. Choose another method or contact the property.",
    errDates: "These dates cannot be booked. Please choose new check-in and check-out dates.",
    errPaused: "Online booking is currently paused. Please contact the property for help.",
    errPriceChanged: (price: string) =>
      `The price has changed to ${price}. Reload the page and review the price before booking.`,
    thankYou: "Thank you for your booking",
    reservationSaved: "Your dates are reserved",
    confirmationAfterPayment:
      "Your booking is confirmed when the property records your payment. Save your guest link below.",
    confirmationOnWay: "Your confirmation is on its way with all practical information.",
    payWithSwish: "Pay with Swish",
    swishInstructions: (total: string, deadline?: string) =>
      `Pay ${total} with Swish${deadline ? ` by ${deadline} (Swedish time)` : " before the reservation expires"} to secure your booking.`,
    swishNumber: "Swish number",
    messageLabel: "Message",
    tapToCopy: "tap to copy",
    linkCopied: "Guest link copied",
    copyGuestLink: "Copy your guest link",
    openGuestPage: "Open your guest page",
    notFoundTitle: "Booking page not found",
    loadErrorTitle: "Booking could not be loaded just now",
    loadErrorBody: "Please try again shortly or contact the property for help.",
    channelSyncTitle: "Availability is being updated",
    channelSyncRetry: "The calendar is being updated. Please wait a moment and try again.",
    channelSyncBody:
      "We are updating the calendar before accepting new bookings. Please try again shortly or contact the property for help.",
    retry: "Try again",
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
    perMorning: " pro Morgen",
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
    errAddons:
      "Ein gewähltes Extra ist nicht mehr verfügbar. Entfernen Sie das Extra oder laden Sie die Seite neu.",
    errPaymentMethod:
      "Die gewählte Zahlungsmethode ist gerade nicht verfügbar. Wählen Sie eine andere Methode oder kontaktieren Sie die Unterkunft.",
    errDates:
      "Diese Daten können nicht gebucht werden. Bitte wählen Sie neue An- und Abreisedaten.",
    errPaused: "Die Onlinebuchung ist derzeit pausiert. Bitte kontaktieren Sie die Unterkunft.",
    errPriceChanged: (price: string) =>
      `Der Preis wurde auf ${price} aktualisiert. Laden Sie die Seite neu und prüfen Sie den Preis vor der Buchung.`,
    thankYou: "Vielen Dank für Ihre Buchung",
    reservationSaved: "Ihre Daten sind reserviert",
    confirmationAfterPayment:
      "Die Buchung wird bestätigt, sobald die Unterkunft Ihre Zahlung registriert hat. Speichern Sie Ihren Gästelink unten.",
    confirmationOnWay: "Ihre Bestätigung ist mit allen praktischen Informationen unterwegs.",
    payWithSwish: "Mit Swish bezahlen",
    swishInstructions: (total: string, deadline?: string) =>
      `Zahlen Sie ${total} mit Swish${deadline ? ` bis ${deadline} (schwedische Zeit)` : " vor Ablauf der Reservierung"}, um Ihre Buchung zu sichern.`,
    swishNumber: "Swish-Nummer",
    messageLabel: "Nachricht",
    tapToCopy: "Tippen zum Kopieren",
    linkCopied: "Gästelink kopiert",
    copyGuestLink: "Gästelink kopieren",
    openGuestPage: "Gästeseite öffnen",
    notFoundTitle: "Buchungsseite nicht gefunden",
    loadErrorTitle: "Die Buchung konnte gerade nicht geladen werden",
    loadErrorBody: "Bitte versuchen Sie es später erneut oder kontaktieren Sie die Unterkunft.",
    channelSyncTitle: "Verfügbarkeit wird aktualisiert",
    channelSyncRetry:
      "Der Kalender wird gerade aktualisiert. Warten Sie einen Moment und versuchen Sie es erneut.",
    channelSyncBody:
      "Wir aktualisieren den Kalender, bevor neue Buchungen angenommen werden. Versuchen Sie es in Kürze erneut oder kontaktieren Sie die Unterkunft.",
    retry: "Erneut versuchen",
    notFoundBody: "Prüfen Sie den Link — oder kontaktieren Sie uns direkt, wir helfen gerne.",
    poweredBy: "Buchungsmaschine von StayBoost",
    prevMonth: "Voriger Monat",
    nextMonth: "Nächster Monat",
    weekdays: ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"],
  },
  da: {
    bookDirect: "Book direkte",
    checkinFrom: (t: string) => `Indtjekning fra ${t}`,
    checkoutAt: (t: string) => `Udtjekning ${t}`,
    lodging: "Overnatning",
    fromPerNight: (price: string) => `fra ${price}/nat`,
    chooseDates: "Vælg datoer",
    minStay: (n: number) => `Mindst ${n} ${n === 1 ? "nat" : "nætter"}`,
    weekendUplift: (pct: number) => `Weekendtillæg +${pct}% fre/lør`,
    addonsTitle: "Gør opholdet endnu bedre",
    perNight: " pr. nat",
    perMorning: " pr. morgen",
    add: "Tilføj",
    decrease: "Færre",
    increase: "Flere",
    yourBooking: "Din booking",
    nights: (n: number) => (n === 1 ? "nat" : "nætter"),
    cleaning: "Rengøring",
    total: "I alt",
    minStayWarning: (unit: string, n: number) =>
      `Mindste ophold i ${unit} er ${n} ${n === 1 ? "nat" : "nætter"}.`,
    name: "Navn",
    guests: (n: number) => `${n} ${n === 1 ? "gæst" : "gæster"}`,
    emailPlaceholder: "E-mail – bekræftelsen sendes hertil",
    phonePlaceholder: "Telefon – SMS på ankomstdagen",
    payment: "Betaling",
    card: "Kort",
    cardHint: "Visa · Mastercard · Stripe",
    swishHint: "Direkte i appen",
    payWithCard: (total: string) => `Betal ${total} med kort`,
    bookFor: (total: string) => `Book · ${total}`,
    booking: "Booker…",
    stripeFineprint: "Sikker kortbetaling via Stripe – bookingen bekræftes med det samme.",
    swishFineprint: "Betal nemt med Swish umiddelbart efter bookingen.",
    noPaymentFineprint: "Betaling aftales med værten.",
    errUnavailable: "Datoerne er netop blevet booket af en anden – vælg andre datoer.",
    errMinStay: (n: number) => `Mindste ophold er ${n} ${n === 1 ? "nat" : "nætter"}.`,
    errContact: "Angiv e-mail eller telefon, så vi kan sende bekræftelsen.",
    errStripe: "Kortbetalingen kunne ikke startes – prøv igen eller vælg Swish.",
    errGeneric: "Noget gik galt – prøv igen om lidt.",
    errAddons:
      "Et valgt tilvalg er ikke længere tilgængeligt. Fjern tilvalget eller genindlæs siden.",
    errPaymentMethod:
      "Den valgte betalingsmetode er ikke tilgængelig lige nu. Vælg en anden metode eller kontakt overnatningsstedet.",
    errDates: "Disse datoer kan ikke bookes. Vælg nye datoer for ind- og udtjekning.",
    errPaused: "Onlinebooking er sat på pause. Kontakt overnatningsstedet for hjælp.",
    errPriceChanged: (price: string) =>
      `Prisen er ændret til ${price}. Genindlæs siden, og kontrollér prisen, før du booker.`,
    thankYou: "Tak for din booking",
    reservationSaved: "Dine datoer er reserveret",
    confirmationAfterPayment:
      "Bookingen bekræftes, når overnatningsstedet har registreret din betaling. Gem gæstelinket nedenfor.",
    confirmationOnWay: "Din bekræftelse er på vej med alle praktiske oplysninger.",
    payWithSwish: "Betal med Swish",
    swishInstructions: (total: string, deadline?: string) =>
      `Betal ${total} med Swish${deadline ? ` senest ${deadline} (svensk tid)` : " inden reservationen udløber"} for at sikre din booking.`,
    swishNumber: "Swish-nummer",
    messageLabel: "Besked",
    tapToCopy: "tryk for at kopiere",
    linkCopied: "Gæstelink kopieret",
    copyGuestLink: "Kopiér dit gæstelink",
    openGuestPage: "Åbn din gæsteside",
    notFoundTitle: "Bookingsiden blev ikke fundet",
    loadErrorTitle: "Bookingen kunne ikke indlæses lige nu",
    loadErrorBody: "Prøv igen om lidt, eller kontakt overnatningsstedet for hjælp.",
    channelSyncTitle: "Tilgængeligheden opdateres",
    channelSyncRetry: "Kalenderen opdateres. Vent et øjeblik, og prøv igen.",
    channelSyncBody:
      "Vi opdaterer kalenderen, før vi kan modtage nye bookinger. Prøv igen om lidt, eller kontakt overnatningsstedet for hjælp.",
    retry: "Prøv igen",
    notFoundBody: "Kontrollér linket, eller kontakt os direkte, så hjælper vi dig.",
    poweredBy: "Bookingmotor fra StayBoost",
    prevMonth: "Forrige måned",
    nextMonth: "Næste måned",
    weekdays: ["Man", "Tir", "Ons", "Tor", "Fre", "Lør", "Søn"],
  },
  no: {
    bookDirect: "Bestill direkte",
    checkinFrom: (t: string) => `Innsjekking fra ${t}`,
    checkoutAt: (t: string) => `Utsjekking ${t}`,
    lodging: "Overnatting",
    fromPerNight: (price: string) => `fra ${price}/natt`,
    chooseDates: "Velg datoer",
    minStay: (n: number) => `Minst ${n} ${n === 1 ? "natt" : "netter"}`,
    weekendUplift: (pct: number) => `Helgetillegg +${pct}% fre/lør`,
    addonsTitle: "Gjør oppholdet enda bedre",
    perNight: " per natt",
    perMorning: " per morgen",
    add: "Legg til",
    decrease: "Færre",
    increase: "Flere",
    yourBooking: "Din bestilling",
    nights: (n: number) => (n === 1 ? "natt" : "netter"),
    cleaning: "Rengjøring",
    total: "Totalt",
    minStayWarning: (unit: string, n: number) =>
      `Minste opphold i ${unit} er ${n} ${n === 1 ? "natt" : "netter"}.`,
    name: "Navn",
    guests: (n: number) => `${n} ${n === 1 ? "gjest" : "gjester"}`,
    emailPlaceholder: "E-post – bekreftelsen sendes hit",
    phonePlaceholder: "Telefon – SMS på ankomstdagen",
    payment: "Betaling",
    card: "Kort",
    cardHint: "Visa · Mastercard · Stripe",
    swishHint: "Direkte i appen",
    payWithCard: (total: string) => `Betal ${total} med kort`,
    bookFor: (total: string) => `Bestill · ${total}`,
    booking: "Bestiller…",
    stripeFineprint: "Sikker kortbetaling via Stripe – bestillingen bekreftes med en gang.",
    swishFineprint: "Betal enkelt med Swish rett etter bestillingen.",
    noPaymentFineprint: "Betaling avtales med verten.",
    errUnavailable: "Datoene ble nettopp bestilt av noen andre – velg andre datoer.",
    errMinStay: (n: number) => `Minste opphold er ${n} ${n === 1 ? "natt" : "netter"}.`,
    errContact: "Oppgi e-post eller telefon, slik at vi kan sende bekreftelsen.",
    errStripe: "Kortbetalingen kunne ikke startes – prøv igjen eller velg Swish.",
    errGeneric: "Noe gikk galt – prøv igjen om litt.",
    errAddons:
      "Et valgt tillegg er ikke lenger tilgjengelig. Fjern tillegget eller last siden på nytt.",
    errPaymentMethod:
      "Den valgte betalingsmåten er ikke tilgjengelig akkurat nå. Velg en annen måte eller kontakt overnattingsstedet.",
    errDates: "Disse datoene kan ikke bestilles. Velg nye datoer for inn- og utsjekking.",
    errPaused: "Nettbestilling er satt på pause. Kontakt overnattingsstedet for hjelp.",
    errPriceChanged: (price: string) =>
      `Prisen er endret til ${price}. Last siden på nytt, og se over prisen før du bestiller.`,
    thankYou: "Takk for bestillingen",
    reservationSaved: "Datoene dine er reservert",
    confirmationAfterPayment:
      "Bestillingen bekreftes når overnattingsstedet har registrert betalingen din. Ta vare på gjestelenken nedenfor.",
    confirmationOnWay: "Bekreftelsen er på vei med all praktisk informasjon.",
    payWithSwish: "Betal med Swish",
    swishInstructions: (total: string, deadline?: string) =>
      `Betal ${total} med Swish${deadline ? ` senest ${deadline} (svensk tid)` : " før reservasjonen utløper"} for å sikre bestillingen din.`,
    swishNumber: "Swish-nummer",
    messageLabel: "Melding",
    tapToCopy: "trykk for å kopiere",
    linkCopied: "Gjestelenke kopiert",
    copyGuestLink: "Kopier gjestelenken din",
    openGuestPage: "Åpne gjestesiden din",
    notFoundTitle: "Bestillingssiden ble ikke funnet",
    loadErrorTitle: "Bestillingen kunne ikke lastes inn akkurat nå",
    loadErrorBody: "Prøv igjen om litt, eller kontakt overnattingsstedet for hjelp.",
    channelSyncTitle: "Tilgjengeligheten oppdateres",
    channelSyncRetry: "Kalenderen oppdateres. Vent litt, og prøv igjen.",
    channelSyncBody:
      "Vi oppdaterer kalenderen før vi kan ta imot nye bestillinger. Prøv igjen om litt, eller kontakt overnattingsstedet for hjelp.",
    retry: "Prøv igjen",
    notFoundBody: "Sjekk lenken, eller kontakt oss direkte, så hjelper vi deg.",
    poweredBy: "Bestillingsmotor fra StayBoost",
    prevMonth: "Forrige måned",
    nextMonth: "Neste måned",
    weekdays: ["Man", "Tir", "Ons", "Tor", "Fre", "Lør", "Søn"],
  },
} as const;

export type BokaStrings = {
  [K in keyof (typeof STR)["sv"]]: (typeof STR)["sv"][K] extends (...args: infer A) => string
    ? (...args: A) => string
    : (typeof STR)["sv"][K] extends readonly string[]
      ? readonly string[]
      : string;
};

export function getStrings(lang: Lang): BokaStrings {
  return STR[lang];
}

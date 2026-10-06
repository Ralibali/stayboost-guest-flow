import { useState } from "react";
import {
  addIsoDays,
  findAvailableStays,
  type SearchUnit,
  type StaySuggestion,
} from "@/lib/booking-search";
import { LOCALES, type Lang } from "@/lib/boka-i18n";
import { stockholmDay } from "../../supabase/functions/_shared/guest-stay";
import { partySize, type BookingParty } from "../../supabase/functions/_shared/pricing";
import { PartySelector } from "./PartySelector";
import { partyLabels } from "@/lib/party-i18n";

const labels = {
  sv: {
    title: "Hitta din vistelse",
    intro: "Sök för hela sällskapet. Är datumen fullbokade visar vi närliggande alternativ.",
    arrival: "Önskad incheckning",
    nights: "Nätter",
    guests: "Gäster",
    search: "Sök lediga vistelser",
    exact: "Ledigt på dina datum",
    nearby: "Prova de här datumen",
    none: "Ingen vistelse matchar inom 14 dagar från ditt val. Prova andra datum eller kontakta boendet.",
    choose: "Välj vistelse",
    total: "Totalt för boendet, inklusive städning. Tillval tillkommer.",
    paused: "Bokningen är tillfälligt pausad.",
    notice: "Tillgänglighet och pris kontrolleras igen när du bokar.",
  },
  en: {
    title: "Find your stay",
    intro: "Search for your whole party. If your dates are unavailable, we suggest nearby dates.",
    arrival: "Preferred check-in",
    nights: "Nights",
    guests: "Guests",
    search: "Search available stays",
    exact: "Available on your dates",
    nearby: "Try these dates",
    none: "No matching stay within 14 days of your choice. Try other dates or contact the property.",
    choose: "Choose stay",
    total: "Accommodation total, including cleaning. Extras are additional.",
    paused: "Bookings are temporarily paused.",
    notice: "Availability and price are checked again when you book.",
  },
  de: {
    title: "Aufenthalt finden",
    intro: "Suchen Sie für alle Gäste. Bei ausgebuchten Daten zeigen wir nahe Alternativen.",
    arrival: "Gewünschte Anreise",
    nights: "Nächte",
    guests: "Gäste",
    search: "Verfügbare Aufenthalte suchen",
    exact: "An Ihren Daten verfügbar",
    nearby: "Alternative Daten",
    none: "Kein passender Aufenthalt innerhalb von 14 Tagen. Wählen Sie andere Daten oder kontaktieren Sie die Unterkunft.",
    choose: "Aufenthalt wählen",
    total: "Gesamtpreis der Unterkunft inklusive Reinigung. Extras zusätzlich.",
    paused: "Buchungen sind vorübergehend pausiert.",
    notice: "Verfügbarkeit und Preis werden bei der Buchung erneut geprüft.",
  },
  da: {
    title: "Find dit ophold",
    intro: "Søg for hele selskabet. Er datoerne optaget, foreslår vi nærliggende datoer.",
    arrival: "Ønsket indtjekning",
    nights: "Nætter",
    guests: "Gæster",
    search: "Søg ledige ophold",
    exact: "Ledigt på dine datoer",
    nearby: "Prøv disse datoer",
    none: "Intet ophold matcher inden for 14 dage fra dit valg. Prøv andre datoer, eller kontakt overnatningsstedet.",
    choose: "Vælg ophold",
    total: "Samlet pris for overnatning inklusive rengøring. Tilvalg betales særskilt.",
    paused: "Booking er midlertidigt sat på pause.",
    notice: "Tilgængelighed og pris kontrolleres igen, når du booker.",
  },
  no: {
    title: "Finn ditt opphold",
    intro: "Søk for hele reisefølget. Er datoene opptatt, foreslår vi nærliggende datoer.",
    arrival: "Ønsket innsjekking",
    nights: "Netter",
    guests: "Gjester",
    search: "Søk ledige opphold",
    exact: "Ledig på datoene dine",
    nearby: "Prøv disse datoene",
    none: "Ingen opphold passer innen 14 dager fra valget ditt. Prøv andre datoer, eller kontakt overnattingsstedet.",
    choose: "Velg opphold",
    total: "Samlet pris for overnatting, inkludert rengjøring. Valgfrie tillegg betales separat.",
    paused: "Bestilling er midlertidig satt på pause.",
    notice: "Tilgjengelighet og pris kontrolleres på nytt når du bestiller.",
  },
};

export function StaySearch({
  units,
  maxStay,
  bookingEnabled,
  availableThrough,
  lang,
  onChoose,
}: {
  units: SearchUnit[];
  maxStay: number;
  bookingEnabled: boolean;
  availableThrough?: string;
  lang: Lang;
  onChoose: (stay: StaySuggestion, guests: number, party?: BookingParty) => void;
}) {
  const today = stockholmDay();
  const through = availableThrough ?? addIsoDays(today, 364);
  const maxNights = Math.min(30, maxStay);
  const [checkin, setCheckin] = useState(today);
  const [nights, setNights] = useState(Math.min(2, maxNights));
  const [guests, setGuests] = useState(Math.min(2, Math.max(1, ...units.map((u) => u.maxGuests))));
  const [party, setParty] = useState<BookingParty>({
    adults: Math.min(2, Math.max(1, ...units.map((u) => u.maxGuests))),
    childrenAges: [],
  });
  const partyEnabled = units.some((unit) => unit.partyPricingEnabled);
  const [showPartyError, setShowPartyError] = useState(false);
  const [searched, setSearched] = useState<{
    checkin: string;
    nights: number;
    guests: number;
    party?: BookingParty;
  } | null>(null);
  const t = labels[lang];
  const result = searched
    ? findAvailableStays(units, {
        ...searched,
        today,
        availableThrough: through,
        maxStay,
        bookingEnabled,
      })
    : null;
  const stays = result ? (result.exact.length ? result.exact : result.nearby) : [];
  const locale = LOCALES[lang];
  const date = (value: string) =>
    new Date(`${value}T12:00:00Z`).toLocaleDateString(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  const change = () => {
    setSearched(null);
    setShowPartyError(false);
  };
  return (
    <section
      className="mb-6 rounded-3xl border border-[#DDD8CB] bg-[#E9F0EC] p-5 sm:p-7"
      aria-label={t.title}
    >
      <h2 className="font-[Fraunces] text-2xl">{t.title}</h2>
      <p className="mt-2 text-sm">{bookingEnabled ? t.intro : t.paused}</p>
      {bookingEnabled && (
        <>
          <form
            className="mt-4 grid gap-3 sm:grid-cols-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (
                partyEnabled &&
                (party.childrenAges.some((age) => age < 0) ||
                  partySize(party) > Math.max(1, ...units.map((unit) => unit.maxGuests)))
              ) {
                setShowPartyError(true);
                return;
              }
              setSearched({
                checkin,
                nights,
                guests: partyEnabled ? partySize(party) : guests,
                ...(partyEnabled ? { party } : {}),
              });
            }}
          >
            <label className="text-sm font-semibold">
              {t.arrival}
              <input
                required
                type="date"
                min={today}
                max={addIsoDays(through, -1)}
                value={checkin}
                onChange={(e) => {
                  setCheckin(e.target.value);
                  change();
                }}
                className="mt-1 block min-h-11 w-full min-w-0 rounded-xl border p-2"
              />
            </label>
            <label className="text-sm font-semibold">
              {t.nights}
              <input
                required
                type="number"
                min={1}
                max={maxNights}
                value={nights || ""}
                onChange={(e) => {
                  setNights(Number(e.target.value));
                  change();
                }}
                className="mt-1 block min-h-11 w-full rounded-xl border p-2"
              />
            </label>
            {!partyEnabled && (
              <label className="text-sm font-semibold">
                {t.guests}
                <input
                  required
                  type="number"
                  min={1}
                  max={Math.max(1, ...units.map((u) => u.maxGuests))}
                  value={guests || ""}
                  onChange={(e) => {
                    setGuests(Number(e.target.value));
                    change();
                  }}
                  className="mt-1 block min-h-11 w-full rounded-xl border p-2"
                />
              </label>
            )}
            {partyEnabled && (
              <div className="sm:col-span-3">
                <PartySelector
                  party={party}
                  maxGuests={Math.max(1, ...units.map((unit) => unit.maxGuests))}
                  maxChildAge={Math.max(...units.map((unit) => unit.childMaxAge ?? 12))}
                  lang={lang}
                  onChange={(value) => {
                    setParty(value);
                    change();
                  }}
                />
              </div>
            )}
            <button className="min-h-11 rounded-xl bg-[#173D2E] px-4 py-3 text-sm font-bold text-white sm:col-span-3">
              {t.search}
            </button>
          </form>
          {showPartyError && (
            <p role="alert" className="mt-3 text-sm text-[#A33B2A]">
              {partyLabels[lang].invalid}
            </p>
          )}
          {result && (
            <div className="mt-5" role="status" aria-live="polite">
              <h3 className="font-semibold">
                {stays.length ? (result.exact.length ? t.exact : t.nearby) : t.none}
              </h3>
              <ul className="mt-3 space-y-3">
                {stays.map((stay) => (
                  <li
                    key={`${stay.unitId}-${stay.checkin}`}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-4"
                  >
                    <div>
                      <p className="font-bold">
                        {date(stay.checkin)} – {date(stay.checkout)}
                      </p>
                      <p className="text-sm">
                        {stay.name} · {stay.nights} {t.nights.toLowerCase()} · {searched?.guests}{" "}
                        {t.guests.toLowerCase()}
                      </p>
                      <p className="mt-1 font-semibold">{stay.total.toLocaleString(locale)} kr</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onChoose(stay, searched!.guests, searched!.party)}
                      className="min-h-11 rounded-xl border border-[#173D2E] px-4 text-sm font-bold"
                    >
                      {t.choose}
                    </button>
                  </li>
                ))}
              </ul>
              {stays.length > 0 && (
                <p className="mt-3 text-xs">
                  {t.total} {t.notice}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

import { useState } from "react";
import {
  addIsoDays,
  findAvailableStays,
  type SearchUnit,
  type StaySuggestion,
} from "@/lib/booking-search";
import type { Lang } from "@/lib/boka-i18n";

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
  onChoose: (stay: StaySuggestion, guests: number) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const through = availableThrough ?? addIsoDays(today, 364);
  const maxNights = Math.min(30, maxStay);
  const [checkin, setCheckin] = useState(today);
  const [nights, setNights] = useState(Math.min(2, maxNights));
  const [guests, setGuests] = useState(Math.min(2, Math.max(1, ...units.map((u) => u.maxGuests))));
  const [searched, setSearched] = useState<{
    checkin: string;
    nights: number;
    guests: number;
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
  const locale = { sv: "sv-SE", en: "en-GB", de: "de-DE" }[lang];
  const date = (value: string) =>
    new Date(`${value}T12:00:00Z`).toLocaleDateString(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  const change = () => setSearched(null);
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
              setSearched({ checkin, nights, guests });
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
            <button className="min-h-11 rounded-xl bg-[#173D2E] px-4 py-3 text-sm font-bold text-white sm:col-span-3">
              {t.search}
            </button>
          </form>
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
                      onClick={() => onChoose(stay, searched!.guests)}
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

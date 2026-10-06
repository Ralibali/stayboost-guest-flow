export const partyLabels = {
  sv: {
    adults: "Vuxna",
    children: "Barn",
    age: "Ålder vid incheckning",
    chooseAge: "Välj ålder",
    years: "år",
    invalid:
      "Välj minst en vuxen och ange alla barns ålder vid incheckning. Äldre barn räknas som vuxna.",
    unavailable: "Pris saknas för det valda sällskapet. Välj ett annat boende eller kontakta oss.",
    childrenPrice: "Barntillägg",
    adultPrice: "Boende för vuxna",
  },
  en: {
    adults: "Adults",
    children: "Children",
    age: "Age at check-in",
    chooseAge: "Choose age",
    years: "years",
    invalid:
      "Choose at least one adult and enter every child's age at check-in. Older children count as adults.",
    unavailable:
      "No price is configured for this party. Choose another accommodation or contact us.",
    childrenPrice: "Child supplement",
    adultPrice: "Adult accommodation",
  },
  de: {
    adults: "Erwachsene",
    children: "Kinder",
    age: "Alter beim Check-in",
    chooseAge: "Alter wählen",
    years: "Jahre",
    invalid:
      "Wählen Sie mindestens einen Erwachsenen und das Alter aller Kinder beim Check-in. Ältere Kinder zählen als Erwachsene.",
    unavailable:
      "Für diese Gästezahl fehlt ein Preis. Wählen Sie eine andere Unterkunft oder kontaktieren Sie uns.",
    childrenPrice: "Kinderzuschlag",
    adultPrice: "Unterkunft für Erwachsene",
  },
};

/** The displayed amount is a total, not a quoted nightly unit price. */
export function childSupplementLabel(
  basis: "per_night" | "per_booking" | undefined,
  nights: number,
  language: keyof typeof partyLabels,
): string {
  const period =
    basis === "per_booking"
      ? { sv: "en gång per vistelse", en: "once per stay", de: "einmal pro Aufenthalt" }[language]
      : {
          sv: `${nights} ${nights === 1 ? "natt" : "nätter"}`,
          en: `${nights} ${nights === 1 ? "night" : "nights"}`,
          de: `${nights} ${nights === 1 ? "Nacht" : "Nächte"}`,
        }[language];
  return `${partyLabels[language].childrenPrice} · ${period}`;
}

import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StaySearch } from "../components/StaySearch";
import { PartySelector } from "../components/PartySelector";
import { UnitDetails } from "../components/UnitDetails";
import { CheckoutForm } from "../routes/boka/$slug";
import { detectLang, getStrings, LANGS, LOCALES, persistLang, type Lang } from "./boka-i18n";
import { getGuestStrings } from "./guest-i18n";
import { bookingLanguage } from "./glamping-embed";
import { childSupplementLabel } from "./party-i18n";
import { localizedUnitText } from "../../supabase/functions/_shared/unit-content";
import { addonVatLabel, localizedAddonText } from "../../supabase/functions/_shared/addon-content";
import { quoteStay } from "../../supabase/functions/_shared/pricing";
import type { EngineUnit } from "./booking-offer";

// The checkout form's privacy link needs a router in the app; this test renders
// the real form while replacing only navigation, which is outside this contract.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({ to, children, ...props }: ComponentProps<"a"> & { to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

afterEach(() => vi.unstubAllGlobals());

const texts = {
  sv: { name: "Svenskt tält", description: "Svensk text" },
  da: { name: "Telt – dansk", description: "  Hele teksten med æ og ø.\nSidste linje.  " },
  no: { name: "Telt – norsk", description: "  Hele teksten med æ og ø.\nSiste linje.  " },
};
const unit: EngineUnit = {
  id: "tent",
  name: "Legacy",
  description: null,
  imageUrl: null,
  contentTranslations: texts,
  maxGuests: 4,
  bedDescription: null,
  sizeSqm: null,
  amenities: [],
  basePrice: 700,
  weekendPct: 0,
  minStay: 1,
  cleaningFee: 0,
  monthlyMult: [],
  booked: [],
  rateRules: [],
  partyPricingEnabled: true,
  adultPrices: [700, 1295, 2195, 2795],
  childPriceBasis: "per_booking",
  childPricePerBooking: 329,
  childPricePerNight: 99,
  childFreeThroughAge: 3,
  childMaxAge: 12,
};
const party = { adults: 1, childrenAges: [4] };
const quote = quoteStay(
  {
    base_price: 700,
    weekend_pct: 0,
    cleaning_fee: 0,
    monthly_mult: [],
    party_pricing_enabled: true,
    adult_prices: unit.adultPrices,
    child_price_basis: "per_booking",
    child_price_per_booking: 329,
    child_price_per_night: 99,
    child_free_through_age: 3,
    child_max_age: 12,
  },
  "2027-06-01",
  "2027-06-03",
  { party },
);
const noop = () => {};

describe("five-language public booking", () => {
  it("has complete booking, checkout and guest dictionaries for every selectable language", () => {
    expect(LANGS.map((x) => x.id)).toEqual(["sv", "en", "de", "da", "no"]);
    for (const { id } of LANGS) {
      for (const getter of [getStrings, getGuestStrings]) {
        const original = getter("sv");
        const translated = getter(id);
        expect(Object.keys(translated).sort()).toEqual(Object.keys(original).sort());
        for (const [key, value] of Object.entries(translated)) {
          expect(typeof value).toBe(typeof original[key as keyof typeof original]);
          if (typeof value === "string") expect(value.trim()).not.toBe("");
        }
      }
      expect(getStrings(id).weekdays).toHaveLength(7);
    }
  });

  it.each([
    [
      "da",
      "Vælg alder",
      "Børnetillæg · én gang pr. ophold",
      "Find dit ophold",
      "Se alle billeder og læs mere",
      "Betalingen er modtaget",
    ],
    [
      "no",
      "Velg alder",
      "Barnetillegg · én gang per opphold",
      "Finn ditt opphold",
      "Se alle bilder og les mer",
      "Betalingen er mottatt",
    ],
  ] as const)(
    "renders actual party, search, details and checkout components in %s",
    (language, chooseAge, childLabel, searchTitle, galleryLabel, paidLabel) => {
      const lang = bookingLanguage(`?lang=${language}`)!;
      const localized = { ...unit, ...localizedUnitText(unit, lang) };
      const addon = {
        id: "addon",
        name: "Legacy extra",
        description: null,
        contentTranslations: texts,
        price: 400,
        priceType: "per_booking" as const,
        imageUrl: null,
        availableFrom: null,
        availableTo: null,
        maxQuantity: 1,
      };
      const selectedAddon = {
        ...addon,
        ...localizedAddonText(addon, lang),
        qty: 1,
        lineTotal: 400,
      };
      expect(localized.name).toBe(texts[language].name);
      expect(localized.description).toBe(texts[language].description);
      expect(selectedAddon.description).toBe(texts[language].description);
      expect(
        renderToStaticMarkup(
          <PartySelector
            party={party}
            maxGuests={4}
            maxChildAge={12}
            lang={lang}
            onChange={noop}
          />,
        ),
      ).toContain(chooseAge);
      expect(
        renderToStaticMarkup(
          <StaySearch units={[unit]} maxStay={14} bookingEnabled lang={lang} onChoose={noop} />,
        ),
      ).toContain(searchTitle);
      expect(renderToStaticMarkup(<UnitDetails unit={localized} lang={lang} />)).toContain(
        galleryLabel,
      );
      const checkout = renderToStaticMarkup(
        <CheckoutForm
          unit={localized}
          quote={quote}
          grandTotal={quote.total + 400}
          addons={[selectedAddon]}
          name=""
          email=""
          phone=""
          guests={2}
          party={party}
          payMethods={["stripe"]}
          payMethod="stripe"
          termsAccepted={false}
          termsUrl="https://example.test/terms"
          formError={null}
          sending={false}
          canSubmit={false}
          checkin="2027-06-01"
          checkout="2027-06-03"
          t={getStrings(lang)}
          locale={LOCALES[lang]}
          lang={lang}
          onName={noop}
          onEmail={noop}
          onPhone={noop}
          onGuests={noop}
          onPay={noop}
          onTerms={noop}
          onSubmit={noop}
        />,
      );
      expect(checkout).toContain(texts[language].name);
      expect(checkout).toContain(childLabel);
      expect(checkout).not.toContain("Barntillägg");
      expect(checkout).toContain("329 kr");
      expect(checkout).toContain("SEK");
      expect(checkout).toContain(
        getStrings(lang).payWithCard(`${(quote.total + 400).toLocaleString(LOCALES[lang])} kr`),
      );
      expect(checkout).not.toContain("undefined");
      expect(getGuestStrings(lang).paid).toBe(paidLabel);
      expect(addonVatLabel(12, lang)).toBe(
        language === "da" ? "Inkl. 12 % moms" : "Inkl. 12 % mva.",
      );
      expect(addonVatLabel(null, lang)).toBeNull();
      expect(childSupplementLabel("per_night", 2, lang)).toBe(
        language === "da" ? "Børnetillæg · 2 nætter" : "Barnetillegg · 2 netter",
      );
    },
  );

  it.each([
    ["da-DK", "da"],
    ["no-NO", "no"],
    ["nb-NO", "no"],
    ["nn-NO", "no"],
    ["fr-FR", "sv"],
  ])("detects browser locale %s as %s", (browser, expected) => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { language: browser });
    vi.stubGlobal("localStorage", { getItem: () => null });
    expect(detectLang()).toBe(expected);
  });

  it("persists an explicit language ahead of browser detection without requiring storage access", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { language: "sv-SE" });
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key),
      setItem: (key: string, value: string) => store.set(key, value),
    });
    for (const lang of ["da", "no"] as Lang[]) {
      persistLang(lang);
      expect(detectLang()).toBe(lang);
    }
    vi.stubGlobal("navigator", { language: "da-DK" });
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("disabled");
      },
      setItem: () => {
        throw new Error("disabled");
      },
    });
    expect(detectLang()).toBe("da");
    expect(() => persistLang("no")).not.toThrow();
  });
});

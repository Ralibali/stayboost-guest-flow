import { describe, expect, it } from "vitest";
import {
  CONTENT_LANGUAGES,
  isUnitGallery,
  isUnitImagePath,
  isUnitTranslations,
  localizedUnitText,
  projectUnitContent,
  unitDisplayImages,
  unitAmenityLabel,
  unitImageUrl,
} from "../../supabase/functions/_shared/unit-content";

const property = "11111111-1111-1111-1111-111111111111";
const unit = "22222222-2222-2222-2222-222222222222";
const other = "33333333-3333-3333-3333-333333333333";
const image = "44444444-4444-4444-4444-444444444444";
const base = "https://project.supabase.co";
const path = `${property}/${unit}/${image}.jpg`;
const gallery = [{ id: image, storage_path: path, alt_text: "Utsikt över kanalen" }];
const exact = "  Sjöbris & æ ø ü\n\nBarn 0–2 år.\n" + "Text som inte får kortas. ".repeat(150);
const translations = Object.fromEntries(
  CONTENT_LANGUAGES.map((lang) => [lang, { name: ` ${lang} tält `, description: exact }]),
);

describe("unit catalogue content", () => {
  it("translates known amenities in every language without changing or inventing source values", () => {
    const raw = [
      "Wifi",
      "Fläkt",
      "Kylskåp",
      "Kaffemaskin",
      "Tvättmaskin",
      "Dusch",
      "Rökfritt",
      "Husdjur tillåts",
    ];
    const original = [...raw];
    expect(raw.map((value) => unitAmenityLabel(value, "sv"))).toEqual(raw);
    expect(raw.map((value) => unitAmenityLabel(value, "en"))).toEqual([
      "Wi-Fi",
      "Fan",
      "Fridge",
      "Coffee machine",
      "Washing machine",
      "Shower",
      "Non-smoking",
      "Pets allowed",
    ]);
    expect(raw.map((value) => unitAmenityLabel(value, "de"))).toEqual([
      "WLAN",
      "Ventilator",
      "Kühlschrank",
      "Kaffeemaschine",
      "Waschmaschine",
      "Dusche",
      "Rauchfrei",
      "Haustiere erlaubt",
    ]);
    expect(raw.map((value) => unitAmenityLabel(value, "da"))).toEqual([
      "Wifi",
      "Ventilator",
      "Køleskab",
      "Kaffemaskine",
      "Vaskemaskine",
      "Brusebad",
      "Røgfrit",
      "Kæledyr tilladt",
    ]);
    expect(raw.map((value) => unitAmenityLabel(value, "no"))).toEqual([
      "Wifi",
      "Vifte",
      "Kjøleskap",
      "Kaffemaskin",
      "Vaskemaskin",
      "Dusj",
      "Røykfritt",
      "Kjæledyr tillatt",
    ]);
    for (const language of CONTENT_LANGUAGES) {
      for (const custom of ["Egen specialtext", " Dusch ", "constructor", "__proto__", ""]) {
        expect(unitAmenityLabel(custom, language)).toBe(custom);
      }
    }
    expect(raw).toEqual(original);
  });

  it("preserves every language and complete whitespace-sensitive text through the public projection", () => {
    expect(isUnitTranslations(translations)).toBe(true);
    const projected = projectUnitContent(
      { id: unit, content_translations: translations, gallery },
      property,
      base,
    );
    for (const language of CONTENT_LANGUAGES) {
      expect(projected.contentTranslations[language]).toEqual(translations[language]);
      expect(
        localizedUnitText({ name: "Legacy", description: null, ...projected }, language)
          .description,
      ).toBe(exact);
    }
    expect(projected.gallery).toEqual([
      {
        id: image,
        url: `${base}/storage/v1/object/public/unit-images/${path}`,
        altText: gallery[0].alt_text,
      },
    ]);
  });

  it("does not leak nested source/private metadata even if it reaches the projection", () => {
    const dirty = {
      id: unit,
      content_translations: {
        sv: {
          ...translations.sv,
          door_code: "secret",
          source_url: "https://sirvoy.test?token=secret",
        },
        secret: { name: "token", description: "secret" },
      },
      gallery,
      door_code: "secret",
      ical_feed_token: "secret",
      raw_webarchive: "secret",
    };
    const projected = projectUnitContent(dirty, property, base);
    expect(projected.contentTranslations).toEqual({ sv: translations.sv });
    expect(JSON.stringify(projected)).not.toMatch(
      /secret|door_code|source_url|webarchive|storage_path|ical_feed_token/,
    );
    expect(Object.keys(projected)).toEqual(["contentTranslations", "gallery"]);
    expect(isUnitTranslations(dirty.content_translations)).toBe(false);
  });

  it.each([
    `${other}/${unit}/${image}.jpg`,
    `${property}/${other}/${image}.jpg`,
    `${property}/${unit}/../${image}.jpg`,
    `${path}?token=secret`,
    `${property}/${unit}/%2e%2e.jpg`,
    `https://cdn.sirvoy.com/${image}_thumb`,
    `${property}/${unit}/${image}.svg`,
    `${property}/${unit}/${image}.html`,
  ])("rejects a foreign or unsafe gallery path: %s", (badPath) => {
    expect(isUnitImagePath(badPath, property, unit)).toBe(false);
    expect(unitImageUrl(base, badPath, property, unit)).toBeNull();
    expect(
      projectUnitContent(
        { id: unit, gallery: [{ ...gallery[0], storage_path: badPath }] },
        property,
        base,
      ).gallery,
    ).toEqual([]);
  });

  it("rejects duplicate identities, extra fields and malformed catalogue content", () => {
    expect(isUnitGallery([...gallery, ...gallery], property, unit)).toBe(false);
    expect(isUnitGallery([{ ...gallery[0], signed_url: "secret" }], property, unit)).toBe(false);
    for (const bad of [
      null,
      [],
      { fr: translations.sv },
      { sv: { name: "", description: null } },
      { sv: { name: "Tent" } },
      { sv: { name: "Tent", description: {} } },
    ])
      expect(isUnitTranslations(bad)).toBe(false);
    expect(unitImageUrl("http://project.supabase.co", path, property, unit)).toBeNull();
  });

  it("keeps original unit text and cover working when the new fields are absent", () => {
    const legacy = {
      name: "Sjöbris",
      description: exact,
      imageUrl: "https://example.se/cover.jpg",
    };
    expect(localizedUnitText(legacy, "en")).toEqual({ name: legacy.name, description: exact });
    expect(unitDisplayImages(legacy)).toEqual([
      { id: "legacy-cover", url: legacy.imageUrl, altText: legacy.name },
    ]);
    expect(unitDisplayImages({ ...legacy, imageUrl: "javascript:alert(1)" })).toEqual([]);
    expect(
      localizedUnitText(
        { ...legacy, contentTranslations: { sv: { name: "Namn", description: "" } } },
        "de",
      ),
    ).toEqual({ name: "Namn", description: "" });
  });

  it("retains gallery order and never substitutes the cover for existing gallery items", () => {
    const second = {
      id: other,
      storage_path: `${property}/${unit}/${other}.png`,
      alt_text: "Bild två",
    };
    const projected = projectUnitContent(
      { id: unit, gallery: [second, ...gallery] },
      property,
      base,
    );
    expect(
      unitDisplayImages({ name: "Tent", imageUrl: "https://example.se/old.jpg", ...projected }).map(
        (entry) => entry.id,
      ),
    ).toEqual([other, image]);
  });
});

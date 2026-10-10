import { describe, expect, it } from "vitest";
import {
  isGuestInfoTranslations,
  localizedPropertyGuestInfo,
  projectPropertyGuestInfo,
} from "../../supabase/functions/_shared/property-guest-info";

describe("generic guest information projection and fallback", () => {
  const legacy = { directions: "Older directions", house_rules: "Older rules" };
  it("retains exact text in all five languages without treating markup as instructions", () => {
    const map = Object.fromEntries(
      ["sv", "en", "de", "da", "no"].map((lang) => [
        lang,
        { directions: ` ${lang} æøä\n<script>alert(1)</script> `, house_rules: "" },
      ]),
    );
    expect(isGuestInfoTranslations(map)).toBe(true);
    expect(projectPropertyGuestInfo(map)).toEqual(map);
  });
  it("falls back per field while preserving explicitly empty translated text", () => {
    const property = {
      ...legacy,
      guestInfoTranslations: {
        sv: { directions: "Svenska", house_rules: null },
        en: { directions: null, house_rules: "" },
        de: { directions: "Deutsch", house_rules: "Regeln" },
      },
    };
    expect(localizedPropertyGuestInfo(property, "en")).toEqual({
      directions: "Svenska",
      house_rules: "",
    });
    expect(localizedPropertyGuestInfo(property, "de")).toEqual({
      directions: "Deutsch",
      house_rules: "Regeln",
    });
    expect(localizedPropertyGuestInfo(property, "no")).toEqual({
      directions: "Svenska",
      house_rules: "Older rules",
    });
    expect(localizedPropertyGuestInfo(legacy, "da")).toEqual(legacy);
  });
  it("strips future/private keys and tolerates malformed JSON by field", () => {
    const unsafe = JSON.parse(
      '{"sv":{"directions":"Safe","house_rules":{"code":"private"},"door_code":"secret"},"en":["secret"],"fr":{"directions":"secret"},"__proto__":{"house_rules":"secret"},"wifi_password":"secret"}',
    );
    expect(isGuestInfoTranslations(unsafe)).toBe(false);
    expect(projectPropertyGuestInfo(unsafe)).toEqual({
      sv: { directions: "Safe", house_rules: null },
    });
    expect(
      projectPropertyGuestInfo(
        Object.create({ sv: { directions: "inherited", house_rules: "secret" } }),
      ),
    ).toEqual({});
  });
  it.each([
    null,
    [],
    { en: {} },
    { en: { directions: true, house_rules: null } },
    { sv: { directions: "a\u0000b", house_rules: null } },
    { sv: { directions: "😀".repeat(100001), house_rules: null } },
  ])("rejects invalid editable map", (value) => {
    expect(isGuestInfoTranslations(value)).toBe(false);
  });
});

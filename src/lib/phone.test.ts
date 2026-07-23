import { describe, expect, it } from "vitest";
import { formatPhoneSE, isValidPhoneSE, normalizePhoneSE } from "./phone";

describe("normalizePhoneSE", () => {
  it("accepterar vanliga svenska skrivsätt", () => {
    expect(normalizePhoneSE("070-123 45 67")).toBe("+46701234567");
    expect(normalizePhoneSE("0701234567")).toBe("+46701234567");
    expect(normalizePhoneSE("+46 70 123 45 67")).toBe("+46701234567");
    expect(normalizePhoneSE("0046701234567")).toBe("+46701234567");
    expect(normalizePhoneSE("46701234567")).toBe("+46701234567");
  });

  it("avvisar ogiltiga nummer", () => {
    expect(normalizePhoneSE("")).toBeNull();
    expect(normalizePhoneSE("abc")).toBeNull();
    expect(normalizePhoneSE("012-345 67 89")).toBeNull(); // fast telefoni
    expect(normalizePhoneSE("+1 555 123 4567")).toBeNull(); // annat land
    expect(normalizePhoneSE("070-123")).toBeNull(); // för kort
    expect(normalizePhoneSE("070-1234567890")).toBeNull(); // för långt
  });

  it("isValidPhoneSE speglar normaliseringen", () => {
    expect(isValidPhoneSE("070 123 45 67")).toBe(true);
    expect(isValidPhoneSE("hej")).toBe(false);
  });

  it("formatPhoneSE ger läsbar utskrift", () => {
    expect(formatPhoneSE("+46701234567")).toBe("+46 70 123 45 67");
  });
});

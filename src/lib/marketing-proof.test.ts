import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const publicCopy = [
  read("src/routes/index.tsx"),
  read("src/components/landing/FAQ.tsx"),
  read("src/components/landing/SignupCta.tsx"),
].join("\n");

describe("proof-first marketing", () => {
  it("does not publish generalized performance claims without measured evidence", () => {
    for (const unsupported of [
      "Sparar i snitt 5 timmar per vecka.",
      "15–25 % av gästerna tackar ja.",
      "Betalar det inte för sig själv första månaden",
      "för mer än hela årskostnaden, första veckan",
      "De flesta skickar sitt första automatiska meddelande samma dag.",
      "Fem minuter, klart.",
      "Igång på en kväll. På riktigt.",
    ]) {
      expect(publicCopy).not.toContain(unsupported);
    }
  });

  it("keeps evidence claims anchored to the live case study", () => {
    const caseStudy = read("src/components/landing/CaseStudy.tsx");
    expect(caseStudy).toContain("observerat i denna drift, inte ett generellt löfte");
    expect(caseStudy).toContain("är inte ett löfte om samma resultat för andra");
  });
});

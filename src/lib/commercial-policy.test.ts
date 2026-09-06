import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const customerFacing = [
  "src/components/landing/FAQ.tsx",
  "src/components/landing/SignupCta.tsx",
  "src/components/landing/DemoCta.tsx",
  "src/components/landing/FoundingOffer.tsx",
  "src/components/landing/SalesFaq.tsx",
  "src/routes/index.tsx",
  "src/routes/tidiga-kunder.tsx",
  "src/routes/villkor.tsx",
  "src/lib/sales-readiness.ts",
];

describe("StayBoost commercial policy", () => {
  it("treats SMS as included in the subscription, never a separate usage charge", () => {
    const faq = read("src/components/landing/FAQ.tsx");
    const terms = read("src/routes/villkor.tsx");

    expect(faq).toContain("Sms ingår i StayBoost-abonnemanget och debiteras inte separat");
    expect(terms).toContain("Sms ingår i abonnemangsavgiften och debiteras inte separat");
  });

  it("does not reintroduce SMS credits, caps or per-message billing in customer-facing copy", () => {
    const corpus = customerFacing.map(read).join("\n").toLowerCase();
    const forbidden = [
      "självkostnadspris per sms",
      "överskjutande sms",
      "sms-krediter",
      "sms credits",
      "månadsgräns",
      "extra kostnad per sms",
      "debiteras per sms",
    ];

    for (const phrase of forbidden) expect(corpus).not.toContain(phrase);
  });
});

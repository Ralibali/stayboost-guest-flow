import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const customerFacing = [
  "src/components/landing/FAQ.tsx",
  "src/components/landing/SignupCta.tsx",
  "src/components/landing/Comparison.tsx",
  "src/routes/index.tsx",
  "src/routes/__root.tsx",
  "src/routes/villkor.tsx",
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

  it("keeps live marketing honest: demo CTA, no cutover night, no StayBoost channel manager", () => {
    const faq = read("src/components/landing/FAQ.tsx");
    const root = read("src/routes/__root.tsx");
    const homepage = read("src/routes/index.tsx");
    const cta = read("src/components/landing/SignupCta.tsx");
    const comparison = read("src/components/landing/Comparison.tsx");

    expect(cta).toContain("Öppna produktdemon");
    expect(cta).toContain('to="/produkten"');
    expect(cta).toContain("Logga in");
    expect(cta).not.toContain('mode: "up"');
    expect(cta).not.toContain("Skapa konto");
    expect(homepage).toContain("Öppna produktdemon");
    expect(homepage).not.toContain("Kom igång");
    expect(homepage).not.toContain("Skapa konto");
    expect(homepage).not.toContain("Igång på en kväll");
    expect(root).not.toContain("igång på en kväll");

    for (const source of [faq, root]) {
      expect(source).toContain("Sirvoy är channel manager");
      expect(source).toContain("StayBoost hämtar inte Booking.com automatiskt");
      expect(source).toContain("Titta på /produkten — det är exempeldata");
      expect(source).toContain("Vi säljer inte Booking.com utan Sirvoy");
      expect(source).not.toContain("hämtar dina bokningar automatiskt");
      expect(source).not.toContain("En kväll. Koppla bokningarna");
    }

    expect(comparison).toMatch(
      /label:\s*"Kanalhanterare \(Booking\.com, Airbnb\)"[\s\S]*stayboost:\s*"nej"/,
    );
    expect(homepage).toMatch(/449/);
    expect(homepage).not.toMatch(/\b399\b|\b499\b|\b549\b/);
  });
});

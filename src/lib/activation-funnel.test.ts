import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const analytics = read("src/lib/product-analytics.ts");
const login = read("src/routes/app/login.tsx");
const onboarding = read("src/routes/app/onboarding.tsx");

 describe("StayBoost activation funnel", () => {
  it("keeps analytics free from direct customer and guest PII", () => {
    expect(analytics).toContain("Never pass email, guest data, free text");
    expect(analytics).not.toContain("guest_email");
    expect(analytics).not.toContain("guest_phone");
  });

  it("hands confirmed signups back to the product instead of a dead end", () => {
    expect(login).toContain("emailRedirectTo");
    expect(login).toContain('`${window.location.origin}/app`');
    expect(login).toContain('trackProductEvent("Account Created"');
    expect(login).toContain('navigate({ to: "/app/onboarding" })');
    expect(login).toContain("Ingen betalning krävs i");
  });

  it("requires only an establishment and one accommodation before first value", () => {
    expect(onboarding).toContain("Skapa din anläggning på en minut");
    expect(onboarding).toContain("Måste fyllas i");
    expect(onboarding).toContain("Lägg till gästinformation nu");
    expect(onboarding).toContain("Valfritt");
    expect(onboarding).toContain("form.name.trim().length > 1");
    expect(onboarding).toContain("units.some");
  });

  it("moves successful setup directly into calendar/source activation", () => {
    expect(onboarding).toContain('trackProductEvent("Property Setup Completed"');
    expect(onboarding).toContain('window.location.assign("/app/kallor")');
    expect(onboarding).toContain("Inget raderas eller flyttas från");
    expect(onboarding).toContain("Sirvoy");
  });
});

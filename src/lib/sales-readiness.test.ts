import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  COMMERCIALLY_LIVE,
  CONTACT_EMAIL,
  CORE_DOES,
  CORE_DOES_NOT,
  MONTHLY_PRICE_SEK,
  PRICE_LABEL,
  SAFE_TO_CANCEL_SIRVOY,
  SALES_CANONICAL,
  SALES_FAQ,
  SALES_PATH,
  SIGNUP_PATH,
  SIGNUP_SEARCH,
  STRIPE_SAAS_CHECKOUT_LIVE,
  TENANT_ISOLATION_READY,
} from "./sales-readiness";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");

const SALES_FILES = [
  "docs/sales/founding-10.md",
  "src/lib/sales-readiness.ts",
  "src/components/landing/FoundingOffer.tsx",
  "src/components/landing/SalesFaq.tsx",
  "src/components/landing/DemoCta.tsx",
  "src/routes/tidiga-kunder.tsx",
] as const;

describe("Founding-10 sales-readiness (PREPARE)", () => {
  it("keeps 449 kr/mån and does not invent a new price", () => {
    expect(MONTHLY_PRICE_SEK).toBe(449);
    expect(PRICE_LABEL).toBe("449 kr/mån");
    const homepage = read("src/routes/index.tsx");
    expect(homepage).toMatch(/>\s*449\s*</);
    expect(homepage).not.toMatch(/\b399\b|\b499\b|\b549\b/);
  });

  it("locks Sirvoy, isolation, Stripe SaaS checkout and commercial live", () => {
    expect(SAFE_TO_CANCEL_SIRVOY).toBe(false);
    expect(TENANT_ISOLATION_READY).toBe(false);
    expect(STRIPE_SAAS_CHECKOUT_LIVE).toBe(false);
    expect(COMMERCIALLY_LIVE).toBe(false);
  });

  it("does not claim tenant isolation is ready", () => {
    const corpus = SALES_FILES.map((file) => read(file))
      .join("\n")
      .toLowerCase();
    const forbidden = [
      "tenant isolation is ready",
      "isoleringen är redo",
      "tenant-isolering är klar",
      "multi-tenant isolation ready",
    ];
    for (const phrase of forbidden) expect(corpus).not.toContain(phrase);
    expect(CORE_DOES_NOT.some((line) => /isol/i.test(line))).toBe(true);
    expect(SALES_FAQ[0]?.q.toLowerCase()).toMatch(/isoler/);
    expect(SALES_FAQ[0]?.a.toLowerCase()).toMatch(/nej/);
  });

  it("keeps Sirvoy cancel locked to no", () => {
    const md = read("docs/sales/founding-10.md");
    expect(md).toMatch(/SAFE_TO_CANCEL_SIRVOY\s*\|\s*\*\*NEJ\*\*/);
    expect(CORE_DOES_NOT.join("\n")).toMatch(/SAFE_TO_CANCEL_SIRVOY = NEJ/);
    expect(SALES_FAQ.find((item) => /sirvoy/i.test(item.q))?.a.toLowerCase()).toMatch(/^nej/);
  });

  it("routes demo CTA to existing signup or contact, not Stripe live", () => {
    expect(SIGNUP_PATH).toBe("/app/login");
    expect(SIGNUP_SEARCH).toEqual({ mode: "up" });
    expect(CONTACT_EMAIL).toBe("info@stayboost.se");

    const cta = read("src/components/landing/DemoCta.tsx");
    const signup = read("src/components/landing/SignupCta.tsx");
    expect(cta).toContain("SignupCta");
    expect(cta).toContain("mailto:");
    expect(cta).toContain("CONTACT_EMAIL");
    expect(cta.toLowerCase()).not.toMatch(/checkout\.stripe|sk_live|stripe\.com\/c\//);
    expect(signup).toContain('to: "/app/login"');
    expect(signup).toContain('mode: "up"');
  });

  it("uses stayboost.se only — no lovable.app or lovable badge", () => {
    expect(SALES_PATH).toBe("/tidiga-kunder");
    expect(SALES_CANONICAL).toBe("https://stayboost.se/tidiga-kunder");

    const route = read("src/routes/tidiga-kunder.tsx");
    expect(route).toContain("canonicalUrl(SALES_PATH)");
    expect(route).toContain('property: "og:url"');
    expect(route).toContain('rel: "canonical"');

    for (const file of SALES_FILES) {
      const text = read(file);
      expect(text, file).not.toMatch(/lovable\.app/i);
      expect(text, file).not.toContain("lovable-badge");
      expect(text, file).not.toContain("lovable.dev/projects/");
    }
  });

  it("keeps SMS included language and CORE lists non-empty", () => {
    const sms = SALES_FAQ.find((item) => /sms/i.test(item.q));
    expect(sms?.a).toContain("Sms ingår i StayBoost-abonnemanget och debiteras inte separat");
    expect(CORE_DOES.length).toBeGreaterThanOrEqual(5);
    expect(CORE_DOES_NOT.length).toBeGreaterThanOrEqual(4);
  });

  it("does not add /tidiga-kunder to the live sitemap allowlist yet", () => {
    const xml = read("public/sitemap.xml");
    expect(xml).not.toContain("tidiga-kunder");
    expect(xml).not.toMatch(/lovable\.app/i);
  });
});

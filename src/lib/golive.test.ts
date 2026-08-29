import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { publicSignupEnabled } from "./auth-flags";
import {
  CANONICAL_ORIGIN,
  canonicalUrl,
  leadMagnetPdfUrl,
  resolveGuestPageBaseUrl,
  resolvePublicAppUrl,
} from "./site-url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");

const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");

describe("kanonisk värd (gästlänkar / legal / Stripe)", () => {
  it("defaultar till stayboost.se och vägrar lovable.app", () => {
    expect(CANONICAL_ORIGIN).toBe("https://stayboost.se");
    expect(canonicalUrl("/villkor")).toBe("https://stayboost.se/villkor");
    expect(resolvePublicAppUrl(undefined)).toBe("https://stayboost.se");
    expect(resolvePublicAppUrl("")).toBe("https://stayboost.se");
    expect(resolvePublicAppUrl("https://stayboost-sverige.lovable.app")).toBe(
      "https://stayboost.se",
    );
    expect(resolvePublicAppUrl("https://boka.example.se/")).toBe("https://boka.example.se");
    expect(resolveGuestPageBaseUrl(undefined, undefined)).toBe("https://stayboost.se");
    expect(leadMagnetPdfUrl(undefined)).toBe("https://stayboost.se/mallar/stayboost-12-sms.pdf");
  });

  it("lämnar inte lovable.app i gäst- eller operatörsvända produktionssträngar", () => {
    const files = [
      "src/routes/cookies.tsx",
      "src/routes/villkor.tsx",
      "src/routes/integritetspolicy.tsx",
      "src/routes/dpa.tsx",
      "src/routes/g/$token.tsx",
      "src/routes/__root.tsx",
      "src/lib/site-url.ts",
      "src/lib/canonical.ts",
      "src/lib/subscribe.server.ts",
      "src/components/landing/LeadMagnet.tsx",
      "src/components/landing/BookFounder.tsx",
      "public/sitemap.xml",
      "public/robots.txt",
      "DEPLOY.md",
      ".env.example",
      "supabase/functions/booking-engine/index.ts",
      "supabase/functions/send-scheduled-messages/index.ts",
    ];
    for (const file of files) {
      const text = read(file);
      expect(text, file).not.toMatch(/stayboost-sverige\.lovable\.app/);
      if (file === "DEPLOY.md" || file === ".env.example") continue;
      expect(text, file).not.toMatch(/https:\/\/[a-z0-9.-]*lovable\.app/);
    }
  });

  it("gömmer Lovable-badgen i first-byte CSS och sätter gästcanonical till stayboost.se", () => {
    expect(read("src/lib/site-url.ts")).toContain("HIDE_LOVABLE_BADGE_CSS");
    expect(read("src/routes/__root.tsx")).toContain("HIDE_LOVABLE_BADGE_CSS");
    expect(read("src/styles.css")).toContain("#lovable-badge");
    const guest = read("src/routes/g/$token.tsx");
    expect(guest).toContain("canonicalUrl");
    expect(guest).toContain("`/g/${params.token}`");
    expect(guest).toContain("noindex");
    expect(guest).not.toMatch(/lovable\.app/);
  });
});

describe("trasiga konverterings-CTA", () => {
  it("shippar lead-magnet-PDF:en i repo", () => {
    const pdf = join(root, "public/mallar/stayboost-12-sms.pdf");
    expect(existsSync(pdf)).toBe(true);
    const bytes = readFileSync(pdf);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(2000);
  });

  it("bäddar inte in den 404:ade Cal.com-länken", () => {
    const founder = read("src/components/landing/BookFounder.tsx");
    expect(founder).not.toContain("cal.com/stayboost/20min");
    expect(founder).toContain("VITE_PUBLIC_BOOKING_URL");
    expect(founder).toContain("Kalenderbokning öppnas snart");
  });
});

describe("single-tenant signup", () => {
  it("är av om flaggan saknas eller inte är true — inloggning lämnas orörd", () => {
    expect(publicSignupEnabled(undefined)).toBe(false);
    expect(publicSignupEnabled("")).toBe(false);
    expect(publicSignupEnabled("false")).toBe(false);
    expect(publicSignupEnabled("true")).toBe(true);
    const login = read("src/routes/app/login.tsx");
    expect(login).toContain("publicSignupEnabled");
    expect(login).toContain("signInWithPassword");
    expect(login).toContain("Nya konton skapas av HQ");
  });
});

describe("DEPLOY cron fail-closed", () => {
  it("gör cron obligatoriskt och påstår inte att det är deployat", () => {
    const deploy = read("DEPLOY.md");
    expect(deploy).toMatch(/OBLIGATORISKT/);
    expect(deploy).toMatch(/stayboost-ical-sync/);
    expect(deploy).toMatch(/stayboost-dispatch/);
    expect(deploy).toMatch(/select jobname, schedule, active/);
    expect(deploy).toContain("Den här checklistan deployar inte cron");
    expect(deploy).toContain("https://stayboost.se");
    expect(deploy).toContain("VITE_ALLOW_PUBLIC_SIGNUP");
    expect(deploy).toContain("Confirm email");
  });
});

describe("edge-funktioner använder kanonisk default", () => {
  it("booking-engine och send-scheduled-messages går via site-url-helpern", () => {
    const booking = read("supabase/functions/booking-engine/index.ts");
    const messages = read("supabase/functions/send-scheduled-messages/index.ts");
    expect(booking).toContain("resolvePublicAppUrl");
    expect(booking).not.toContain("req.headers.get(\"origin\")");
    expect(messages).toContain("resolveGuestPageBaseUrl");
  });
});

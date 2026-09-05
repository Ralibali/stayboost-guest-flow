import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ANALYTICS_EVENTS } from "./analytics";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");

const LANDING = "src/routes/index.tsx";
const ROOT = "src/routes/__root.tsx";
const SIGNUP = "src/components/landing/SignupCta.tsx";
const STICKY = "src/components/landing/StickyMobileCTA.tsx";
const LEAD = "src/components/landing/LeadMagnet.tsx";
const SMS = "src/components/landing/DemoSms.tsx";
const LIVE = "src/components/landing/LiveDemo.tsx";
const PRODUKTEN = "src/routes/produkten/index.tsx";
const FAQ = "src/components/landing/FAQ.tsx";
const CALC = "src/components/landing/RevenueCalculator.tsx";
const FOUNDER = "src/components/landing/BookFounder.tsx";
const HELPER = "src/lib/analytics.ts";

const FORBIDDEN_EVENT_NAMES = [
  "Signup CTA",
  "Sticky CTA Click",
  "Hero Sms Link Clicked",
  "Lead Magnet Download",
  "Demo SMS Sent",
  "Live Demo Opened",
  "Live Demo:",
  "FAQ Opened",
  "Calculator Used",
  "Founder Call Booked",
  "Form: Submission",
];

const INSTRUMENTED = [
  LANDING,
  ROOT,
  SIGNUP,
  STICKY,
  LEAD,
  SMS,
  LIVE,
  PRODUKTEN,
  FAQ,
  CALC,
  FOUNDER,
];

describe("Plausible install (official 2026)", () => {
  it("uses the npm tracker, not the legacy script.js snippet", () => {
    const rootSrc = read(ROOT);
    const helper = read(HELPER);
    const pkg = read("package.json");

    expect(pkg).toContain('"@plausible-analytics/tracker"');
    expect(helper).toContain("@plausible-analytics/tracker");
    expect(helper).toContain("domain: PLAUSIBLE_DOMAIN");
    expect(helper).toContain("autoCapturePageviews: true");
    expect(helper).toContain("formSubmissions: false");
    expect(rootSrc).toContain("initAnalytics");
    expect(rootSrc).not.toContain("plausible.io/js/script.js");
    expect(rootSrc).not.toContain("data-domain");
    expect(rootSrc).not.toContain("VITE_PUBLIC_PLAUSIBLE_DOMAIN");
  });

  it("cites current official docs", () => {
    const helper = read(HELPER);
    expect(helper).toContain("https://plausible.io/docs/plausible-script");
    expect(helper).toContain("https://plausible.io/docs/spa-support");
    expect(helper).toContain("https://plausible.io/docs/custom-event-goals");
    expect(helper).toContain("https://plausible.io/docs/script-update-guide");
  });
});

describe("canonical events only", () => {
  it("does not send legacy or invented event names from instrumented files", () => {
    const corpus = INSTRUMENTED.map((p) => read(p)).join("\n");
    for (const name of FORBIDDEN_EVENT_NAMES) {
      expect(corpus).not.toContain(name);
    }
    expect(corpus).not.toMatch(/w\.plausible\?\.|window\.plausible\(/);
  });

  it("only the three Aurora names exist as event strings in the helper", () => {
    const helper = read(HELPER);
    expect(helper).toContain(`CTA_CLICKED: "${ANALYTICS_EVENTS.CTA_CLICKED}"`);
    expect(helper).toContain(`FORM_STARTED: "${ANALYTICS_EVENTS.FORM_STARTED}"`);
    expect(helper).toContain(`FORM_SUBMITTED: "${ANALYTICS_EVENTS.FORM_SUBMITTED}"`);
    const named = [...helper.matchAll(/"[A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)+"/g)].map((m) => m[0]);
    expect(named).toEqual(['"CTA Clicked"', '"Form Started"', '"Form Submitted"']);
  });
});

describe("instrumented surfaces", () => {
  it("tracks Kom igång in header, SignupCta and sticky bar", () => {
    const landing = read(LANDING);
    const signup = read(SIGNUP);
    const sticky = read(STICKY);
    expect(landing).toContain("ANALYTICS_CTAS.KOM_IGANG");
    expect(landing).toContain('location: "header"');
    expect(signup).toContain("trackCtaClicked");
    expect(signup).toContain("ANALYTICS_CTAS.KOM_IGANG");
    const signupTrack = signup.match(/trackCtaClicked\(\{[\s\S]*?\}\)/)?.[0] ?? "";
    expect(signupTrack).toContain("ANALYTICS_CTAS.KOM_IGANG");
    expect(signupTrack).not.toMatch(/\bemail\b|\btrimmed\b/);
    expect(sticky).toContain('location: "sticky_mobile"');
    expect(sticky).toContain("ANALYTICS_CTAS.KOM_IGANG");
  });

  it("tracks pricing plan toggles and pricing Kom igång with plan", () => {
    const landing = read(LANDING);
    expect(landing).toContain("ANALYTICS_CTAS.PRICING_PLAN");
    expect(landing).toContain("ANALYTICS_PLANS.MONTHLY");
    expect(landing).toContain("ANALYTICS_PLANS.ANNUAL");
    expect(landing).toContain("plan={annual ? ANALYTICS_PLANS.ANNUAL : ANALYTICS_PLANS.MONTHLY}");
  });

  it("tracks /produkten demo CTAs from landing and produkten index", () => {
    const live = read(LIVE);
    const produkten = read(PRODUKTEN);
    const landing = read(LANDING);
    expect(live).toContain("ANALYTICS_CTAS.DEMO");
    expect(live).toContain("demoLocationFromPath");
    expect(produkten).toContain("ANALYTICS_SURFACES.PRODUKTEN");
    expect(produkten).toContain("demoLocationFromPath(c.to)");
    expect(landing).toContain("ANALYTICS_CTAS.DEMO");
    expect(landing).toContain('location: "oversikt"');
  });

  it("tracks SMS test as CTA Clicked without phone", () => {
    const sms = read(SMS);
    const landing = read(LANDING);
    expect(sms).toContain("ANALYTICS_CTAS.SMS_TEST");
    expect(sms).toContain('location: "demo_sms"');
    expect(sms).toContain("trackCtaClicked");
    expect(sms).not.toContain("trackFormSubmitted");
    const smsTrack = sms.match(/trackCtaClicked\(\{[\s\S]*?\}\)/)?.[0] ?? "";
    expect(smsTrack).toContain("SMS_TEST");
    expect(smsTrack).not.toMatch(/phone|email|message/i);
    expect(landing).toContain("ANALYTICS_CTAS.SMS_TEST");
    expect(landing).toContain('location: "hero"');
  });

  it("starts the free-templates form once-helper and submits only after res.ok", () => {
    const lead = read(LEAD);
    expect(lead).toContain("ANALYTICS_FORMS.FREE_TEMPLATES");
    expect(lead).toContain("trackFormStarted");
    expect(lead).toContain("trackFormSubmitted");
    expect(lead).toContain("onFocus={markFormStarted}");

    const submitFn = lead.slice(lead.indexOf("const submit = async"));
    const submittedAt = submitFn.indexOf("trackFormSubmitted");
    const okAt = submitFn.indexOf("if (res.ok)");
    const failAt = submitFn.indexOf('setState("error")');
    expect(okAt).toBeGreaterThan(-1);
    expect(submittedAt).toBeGreaterThan(okAt);
    expect(failAt).toBeGreaterThan(submittedAt);

    const parsedFail = submitFn.indexOf("if (!parsed.success)");
    expect(parsedFail).toBeGreaterThan(-1);
    expect(parsedFail).toBeLessThan(okAt);
    expect(submitFn.slice(parsedFail, okAt)).not.toContain("trackFormSubmitted");
  });

  it("does not put email, phone or free-text into track payloads", () => {
    const files = [LANDING, SIGNUP, STICKY, LEAD, SMS, LIVE, PRODUKTEN];
    for (const file of files) {
      const src = read(file);
      const trackBlocks =
        src.match(/track(?:CtaClicked|FormStarted|FormSubmitted)\(\{[\s\S]*?\}\)/g) ?? [];
      expect(trackBlocks.length).toBeGreaterThan(0);
      for (const block of trackBlocks) {
        expect(block).not.toMatch(/\bemail\b|\bphone\b|\bname\b|\bmessage\b/i);
        expect(block).not.toContain("@");
      }
    }
  });
});

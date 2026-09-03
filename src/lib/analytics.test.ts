import { afterEach, describe, expect, it } from "vitest";
import {
  ANALYTICS_CTAS,
  ANALYTICS_EVENTS,
  ANALYTICS_FORMS,
  ANALYTICS_PLANS,
  ANALYTICS_SURFACES,
  PLAUSIBLE_DOMAIN,
  __setAnalyticsSinkForTests,
  demoLocationFromPath,
  initAnalytics,
  isForbiddenAnalyticsKey,
  looksLikePiiValue,
  resetAnalyticsForTests,
  sanitizeCtaProps,
  sanitizeFormProps,
  trackCtaClicked,
  trackFormStarted,
  trackFormSubmitted,
  type AnalyticsSink,
} from "./analytics";

type Call = { name: string; props?: Record<string, string>; init?: Record<string, unknown> };

function mockSink() {
  const calls: Call[] = [];
  const inits: Record<string, unknown>[] = [];
  const sink: AnalyticsSink = {
    init: (config) => {
      inits.push(config);
    },
    track: (name, options) => {
      calls.push({ name, props: options?.props });
    },
  };
  __setAnalyticsSinkForTests(sink);
  return { calls, inits };
}

afterEach(() => {
  resetAnalyticsForTests();
  __setAnalyticsSinkForTests(null);
});

describe("canonical event names", () => {
  it("exposes exactly the Aurora names", () => {
    expect(ANALYTICS_EVENTS.CTA_CLICKED).toBe("CTA Clicked");
    expect(ANALYTICS_EVENTS.FORM_STARTED).toBe("Form Started");
    expect(ANALYTICS_EVENTS.FORM_SUBMITTED).toBe("Form Submitted");
    expect(Object.values(ANALYTICS_EVENTS)).toEqual([
      "CTA Clicked",
      "Form Started",
      "Form Submitted",
    ]);
  });

  it("uses stayboost.se as the Plausible domain", () => {
    expect(PLAUSIBLE_DOMAIN).toBe("stayboost.se");
  });
});

describe("initAnalytics", () => {
  it("initialises the official SPA tracker once with stayboost.se", () => {
    const { inits } = mockSink();
    initAnalytics();
    initAnalytics();
    expect(inits).toHaveLength(1);
    expect(inits[0]).toMatchObject({
      domain: "stayboost.se",
      autoCapturePageviews: true,
      formSubmissions: false,
      logging: false,
    });
  });

  it("fails silently when init throws", () => {
    __setAnalyticsSinkForTests({
      init: () => {
        throw new Error("no plausible");
      },
      track: () => {
        throw new Error("no plausible");
      },
    });
    expect(() => initAnalytics()).not.toThrow();
    expect(() =>
      trackCtaClicked({
        surface: ANALYTICS_SURFACES.LANDING,
        cta: ANALYTICS_CTAS.KOM_IGANG,
        location: "header",
      }),
    ).not.toThrow();
  });
});

describe("trackCtaClicked", () => {
  it("sends CTA Clicked with controlled props only", () => {
    const { calls } = mockSink();
    trackCtaClicked({
      surface: ANALYTICS_SURFACES.LANDING,
      cta: ANALYTICS_CTAS.KOM_IGANG,
      location: "pricing",
      plan: ANALYTICS_PLANS.MONTHLY,
    });
    expect(calls).toEqual([
      {
        name: "CTA Clicked",
        props: {
          surface: "landing",
          cta: "kom_igang",
          location: "pricing",
          plan: "monthly",
        },
      },
    ]);
  });

  it("tracks SMS test without phone or message", () => {
    const { calls } = mockSink();
    trackCtaClicked({
      surface: ANALYTICS_SURFACES.LANDING,
      cta: ANALYTICS_CTAS.SMS_TEST,
      location: "demo_sms",
      // @ts-expect-error — extra keys must never leak
      phone: "070-123 45 67",
      email: "gäst@example.com",
      message: "Hej Anna, välkommen",
    });
    expect(calls[0]?.name).toBe("CTA Clicked");
    expect(calls[0]?.props).toEqual({
      surface: "landing",
      cta: "sms_test",
      location: "demo_sms",
    });
    expect(JSON.stringify(calls[0])).not.toMatch(/070|@|Anna|Hej/i);
  });

  it("drops unknown plan values and PII-shaped values", () => {
    expect(
      sanitizeCtaProps({
        surface: "landing",
        cta: "kom_igang",
        location: "hero",
        plan: "enterprise-secret",
      }),
    ).toEqual({ surface: "landing", cta: "kom_igang", location: "hero" });

    expect(
      sanitizeCtaProps({
        surface: "landing",
        cta: "kom_igang",
        location: "user@stayboost.se",
      }),
    ).toEqual({ surface: "landing", cta: "kom_igang" });
  });
});

describe("Form Started / Form Submitted", () => {
  it("fires Form Started once per form+surface session", () => {
    const { calls } = mockSink();
    const props = {
      form: ANALYTICS_FORMS.FREE_TEMPLATES,
      surface: ANALYTICS_SURFACES.LANDING,
    };
    trackFormStarted(props);
    trackFormStarted(props);
    trackFormStarted({ ...props });
    expect(calls).toEqual([
      { name: "Form Started", props: { form: "free_templates", surface: "landing" } },
    ]);
  });

  it("allows Form Started for a different form after the first", () => {
    const { calls } = mockSink();
    trackFormStarted({ form: "free_templates", surface: "landing" });
    trackFormStarted({ form: "other_form", surface: "landing" });
    expect(calls.map((c) => c.props?.form)).toEqual(["free_templates", "other_form"]);
  });

  it("sends Form Submitted only when trackFormSubmitted is called", () => {
    const { calls } = mockSink();
    trackFormStarted({ form: "free_templates", surface: "landing" });
    // Validation / click path must not call trackFormSubmitted.
    expect(calls.some((c) => c.name === "Form Submitted")).toBe(false);
    trackFormSubmitted({ form: "free_templates", surface: "landing" });
    expect(calls.filter((c) => c.name === "Form Submitted")).toEqual([
      { name: "Form Submitted", props: { form: "free_templates", surface: "landing" } },
    ]);
  });

  it("never includes email or other PII on form events", () => {
    const { calls } = mockSink();
    trackFormStarted({
      form: "free_templates",
      surface: "landing",
      // @ts-expect-error extra PII keys must be dropped
      email: "owner@boende.se",
      name: "Anna",
    });
    trackFormSubmitted({
      form: "free_templates",
      surface: "landing",
      // @ts-expect-error extra PII keys must be dropped
      email: "owner@boende.se",
    });
    const blob = JSON.stringify(calls.map((c) => c.props));
    expect(blob).not.toMatch(/owner@|Anna|email/i);
    expect(calls[0]?.props).toEqual({ form: "free_templates", surface: "landing" });
    expect(calls[1]?.props).toEqual({ form: "free_templates", surface: "landing" });
  });
});

describe("PII guards", () => {
  it("flags email, name, phone, secrets as forbidden keys", () => {
    for (const key of ["email", "name", "phone", "message", "password", "secret", "token"]) {
      expect(isForbiddenAnalyticsKey(key)).toBe(true);
    }
    expect(isForbiddenAnalyticsKey("surface")).toBe(false);
    expect(isForbiddenAnalyticsKey("cta")).toBe(false);
    expect(isForbiddenAnalyticsKey("plan")).toBe(false);
  });

  it("flags email and phone values", () => {
    expect(looksLikePiiValue("din@epost.se")).toBe(true);
    expect(looksLikePiiValue("070-123 45 67")).toBe(true);
    expect(looksLikePiiValue("+46701234567")).toBe(true);
    expect(looksLikePiiValue("kom_igang")).toBe(false);
    expect(looksLikePiiValue("monthly")).toBe(false);
  });

  it("sanitizeFormProps drops extra keys", () => {
    expect(
      sanitizeFormProps({
        form: "free_templates",
        surface: "landing",
        // @ts-expect-error extra PII keys must be dropped
        email: "x@y.se",
      }),
    ).toEqual({ form: "free_templates", surface: "landing" });
  });
});

describe("produkten route segmentation", () => {
  it("maps verified /produkten/* paths to location slugs", () => {
    expect(demoLocationFromPath("/produkten")).toBe("oversikt");
    expect(demoLocationFromPath("/produkten/")).toBe("oversikt");
    expect(demoLocationFromPath("/produkten/boka")).toBe("boka");
    expect(demoLocationFromPath("/produkten/gast")).toBe("gast");
    expect(demoLocationFromPath("/produkten/incheckning")).toBe("incheckning");
    expect(demoLocationFromPath("/produkten/min-sida")).toBe("min-sida");
    expect(demoLocationFromPath("/produkten/frukost")).toBe("frukost");
    expect(demoLocationFromPath("/produkten/stad")).toBe("stad");
    expect(demoLocationFromPath("/produkten/admin")).toBe("admin");
    expect(demoLocationFromPath("/produkten/bokningar")).toBe("bokningar");
    expect(demoLocationFromPath("/produkten/dagsoversikt")).toBe("dagsoversikt");
    expect(demoLocationFromPath("/produkten/presentkort")).toBe("presentkort");
    expect(demoLocationFromPath("/produkten/kanaler")).toBe("kanaler");
    expect(demoLocationFromPath("/produkten/rapporter")).toBe("rapporter");
    expect(demoLocationFromPath("/produkten/gaster")).toBe("gaster");
    expect(demoLocationFromPath("/produkten/personal")).toBe("personal");
  });
});

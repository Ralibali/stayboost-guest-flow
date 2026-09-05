/**
 * StayBoost marketing analytics — Plausible, Aurora canonical events only.
 *
 * Official install (2026): `@plausible-analytics/tracker` with
 * `init({ domain: "stayboost.se", autoCapturePageviews: true })`.
 * SPA route changes use the tracker's History API capture — not a legacy
 * `script.js` + `data-domain` snippet.
 *
 * Docs:
 * - https://plausible.io/docs/plausible-script
 * - https://plausible.io/docs/spa-support
 * - https://plausible.io/docs/script-update-guide
 * - https://plausible.io/docs/script-extensions
 * - https://plausible.io/docs/custom-event-goals
 * - https://plausible.io/docs/custom-props/for-custom-events
 * - https://www.npmjs.com/package/@plausible-analytics/tracker
 *
 * Prerequisite (not created by this code): a Plausible site whose domain /
 * site ID is `stayboost.se`, plus custom-event goals named exactly
 * `CTA Clicked`, `Form Started`, `Form Submitted`.
 */

import { init as plausibleInit, track as plausibleTrack } from "@plausible-analytics/tracker";

export const PLAUSIBLE_DOMAIN = "stayboost.se";

export const ANALYTICS_EVENTS = {
  CTA_CLICKED: "CTA Clicked",
  FORM_STARTED: "Form Started",
  FORM_SUBMITTED: "Form Submitted",
} as const;

export type CanonicalEvent = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

export const ANALYTICS_SURFACES = {
  LANDING: "landing",
  PRODUKTEN: "produkten",
} as const;

export const ANALYTICS_CTAS = {
  KOM_IGANG: "kom_igang",
  PRICING_PLAN: "pricing_plan",
  DEMO: "demo",
  SMS_TEST: "sms_test",
} as const;

export const ANALYTICS_FORMS = {
  FREE_TEMPLATES: "free_templates",
} as const;

export const ANALYTICS_PLANS = {
  MONTHLY: "monthly",
  ANNUAL: "annual",
} as const;

export type CtaClickedProps = {
  surface: string;
  cta: string;
  location: string;
  plan?: string;
};

export type FormEventProps = {
  form: string;
  surface: string;
};

const CTA_KEYS = ["surface", "cta", "location", "plan"] as const;
const FORM_KEYS = ["form", "surface"] as const;

const PII_KEY_RE =
  /^(e-?mails?|names?|full[_-]?name|first[_-]?name|last[_-]?name|phones?|tel|mobile|messages?|body|comments?|free[_-]?text|passwords?|secrets?|tokens?|api[_-]?keys?)$/i;

const EMAIL_VALUE_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE_VALUE_RE = /^\+?\d[\d\s().-]{6,}$/;

const ALLOWED_PLANS = new Set<string>(Object.values(ANALYTICS_PLANS));

export type AnalyticsSink = {
  init: (config: {
    domain: string;
    autoCapturePageviews?: boolean;
    formSubmissions?: boolean;
    logging?: boolean;
    bindToWindow?: boolean;
  }) => void;
  track: (eventName: string, options?: { props?: Record<string, string> }) => void;
};

const officialSink: AnalyticsSink = {
  init: (config) => plausibleInit(config),
  track: (eventName, options) => plausibleTrack(eventName, options ?? {}),
};

let sink: AnalyticsSink | null = null;
let initialized = false;
const formStartedKeys = new Set<string>();

export function __setAnalyticsSinkForTests(next: AnalyticsSink | null): void {
  sink = next;
}

export function resetAnalyticsForTests(): void {
  initialized = false;
  formStartedKeys.clear();
}

export function looksLikePiiValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (EMAIL_VALUE_RE.test(trimmed)) return true;
  if (PHONE_VALUE_RE.test(trimmed)) return true;
  return false;
}

export function isForbiddenAnalyticsKey(key: string): boolean {
  return PII_KEY_RE.test(key.trim());
}

function stringifyAllowed(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return null;
}

function pickControlledProps(
  props: Record<string, unknown>,
  allowed: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of allowed) {
    if (isForbiddenAnalyticsKey(key)) continue;
    const raw = stringifyAllowed(props[key]);
    if (raw == null) continue;
    if (looksLikePiiValue(raw)) continue;
    if (key === "plan" && !ALLOWED_PLANS.has(raw)) continue;
    out[key] = raw;
  }
  return out;
}

export function sanitizeCtaProps(props: CtaClickedProps): Record<string, string> {
  return pickControlledProps({ ...props }, CTA_KEYS);
}

export function sanitizeFormProps(props: FormEventProps): Record<string, string> {
  return pickControlledProps({ ...props }, FORM_KEYS);
}

function activeSink(): AnalyticsSink {
  return sink ?? officialSink;
}

function send(eventName: CanonicalEvent, props: Record<string, string>): void {
  try {
    activeSink().track(eventName, { props });
  } catch {
    // Fail silently when Plausible is unavailable or not initialised.
  }
}

/**
 * Current official SPA install: History API pageviews are automatic.
 * Safe to call more than once — later calls are ignored.
 */
export function initAnalytics(): void {
  if (initialized) return;
  try {
    activeSink().init({
      domain: PLAUSIBLE_DOMAIN,
      autoCapturePageviews: true,
      formSubmissions: false,
      logging: false,
      bindToWindow: true,
    });
    initialized = true;
  } catch {
    // Fail silently.
  }
}

export function trackCtaClicked(props: CtaClickedProps): void {
  const clean = sanitizeCtaProps(props);
  if (!clean.surface || !clean.cta || !clean.location) return;
  send(ANALYTICS_EVENTS.CTA_CLICKED, clean);
}

export function trackFormStarted(props: FormEventProps): void {
  const clean = sanitizeFormProps(props);
  if (!clean.form || !clean.surface) return;
  const key = `${clean.form}:${clean.surface}`;
  if (formStartedKeys.has(key)) return;
  formStartedKeys.add(key);
  send(ANALYTICS_EVENTS.FORM_STARTED, clean);
}

export function trackFormSubmitted(props: FormEventProps): void {
  const clean = sanitizeFormProps(props);
  if (!clean.form || !clean.surface) return;
  send(ANALYTICS_EVENTS.FORM_SUBMITTED, clean);
}

export function demoLocationFromPath(path: string): string {
  const normalized = path.trim();
  if (normalized === "/produkten" || normalized === "/produkten/") return "oversikt";
  const match = normalized.match(/^\/produkten\/([^/?#]+)/);
  return match?.[1] ?? "oversikt";
}

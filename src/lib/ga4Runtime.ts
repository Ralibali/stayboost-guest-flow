/** GA4 transport. No Google requests or event buffering before statistics consent.
 * Enhanced measurement must be disabled in the stream: this owns SPA pageviews.
 */
export type EventOptions = {
  props?: Record<string, unknown>;
  u?: string;
  url?: string;
  callback?: () => void;
};
type Config = {
  measurementId: string;
  hosts: string[];
  excluded: string[];
  consentKey: string;
  consentFormat?: "updro" | "simple";
};
type AnalyticsWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
  analyticsEvent?: (name: string, options?: EventOptions) => void;
};
let config: Config | undefined;
let allowed = false;
let configured = false;
let lastPage = "";
let previousPage = "";

export function ga4EventName(name: string): string {
  return (
    name === "pageview"
      ? "page_view"
      : name
          .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
          .toLowerCase()
          .replace(/[^a-z0-9_]+/g, "_")
          .replace(/^_+|_+$/g, "")
  ).slice(0, 40);
}

function blocked(path: string): boolean {
  return !!config?.excluded.some(
    (prefix) => path === prefix || path.startsWith(prefix.replace(/\/$/, "") + "/"),
  );
}

function readConsent(raw: string | null): boolean {
  try {
    if (config?.consentFormat === "updro") {
      const state = raw ? JSON.parse(raw) : null;
      return state?.analytics === true || state?.level === "all";
    }
    return raw === "accepted";
  } catch {
    return false;
  }
}

export function cleanAnalyticsUrl(raw: string): string {
  try {
    const url = new URL(raw, window.location.origin);
    if (blocked(url.pathname)) return "";
    // Queries and fragments may contain auth tokens, emails or customer briefs.
    const path = url.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ":id");
    return url.origin + path;
  } catch {
    return "";
  }
}

function command(...args: unknown[]): void {
  const w = window as AnalyticsWindow;
  w.dataLayer ||= [];
  // Google tag's command queue uses the standard Arguments object.
  w.gtag ||= function () {
    // eslint-disable-next-line prefer-rest-params -- Google's documented gtag queue format.
    w.dataLayer!.push(arguments);
  };
  w.gtag(...args);
}

function campaignParameters(): Record<string, string> {
  const params = new URLSearchParams(window.location.search);
  const output: Record<string, string> = {};
  for (const suffix of ["source", "medium", "campaign", "content", "term"]) {
    const value = params.get(`utm_${suffix}`);
    if (value && /^[a-z0-9 _.-]{1,80}$/i.test(value))
      output[suffix === "campaign" ? "campaign_name" : `campaign_${suffix}`] = value;
  }
  return output;
}

function canSend(): boolean {
  return (
    typeof window !== "undefined" &&
    !!config &&
    allowed &&
    config.hosts.includes(window.location.hostname) &&
    /^G-[A-Z0-9]+$/.test(config.measurementId)
  );
}

export function sendAnalyticsEvent(name: string, options: EventOptions = {}): void {
  const finish = () => {
    try {
      options.callback?.();
    } catch {
      /* callbacks cannot break navigation */
    }
  };
  try {
    if (!canSend()) {
      finish();
      return;
    }
    const event = ga4EventName(name);
    const page =
      cleanAnalyticsUrl(options.u || options.url || window.location.href) ||
      (event !== "page_view" ? window.location.origin + "/internal" : "");
    if (!page) {
      finish();
      return;
    }
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(event)) {
      finish();
      return;
    }
    if (event === "page_view" && page === lastPage) {
      finish();
      return;
    }
    const props: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(options.props || {}).slice(0, 20)) {
      if (
        !/^[a-z][a-z0-9_]{0,39}$/.test(key) ||
        /email|phone|token|password|user_id|customer|message|free_text/i.test(key)
      )
        continue;
      if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)))
        props[key] = value;
      if (
        typeof value === "string" &&
        value.length <= 80 &&
        !/@|https?:|[0-9a-f]{8}-[0-9a-f-]{27,}/i.test(value)
      )
        props[key] = value;
    }
    let completed = false;
    const done = () => {
      if (!completed) {
        completed = true;
        finish();
      }
    };
    if (options.callback) window.setTimeout(done, 750);
    command("event", event, {
      ...props,
      send_to: config!.measurementId,
      page_location: page,
      // Titles in authenticated product views can contain names and free text.
      page_title: new URL(page).pathname,
      page_referrer:
        lastPage && lastPage !== page
          ? lastPage
          : previousPage || cleanAnalyticsUrl(document.referrer),
      ...(options.callback ? { event_callback: done, event_timeout: 750 } : {}),
    });
    if (event === "page_view") {
      previousPage = lastPage;
      lastPage = page;
    }
  } catch {
    finish();
  }
}

export function setAnalyticsConsent(granted: boolean): void {
  if (typeof window === "undefined") return;
  allowed = granted;
  if (!config) return;
  (window as unknown as Record<string, unknown>)[`ga-disable-${config.measurementId}`] = !granted;
  if (!granted) {
    if (configured) command("consent", "update", { analytics_storage: "denied" });
    for (const cookie of document.cookie.split(";")) {
      const name = cookie.split("=")[0].trim();
      if (!/^_ga(?:_|$)|^_gid$|^_gat(?:_|$)/.test(name)) continue;
      const parts = window.location.hostname.split(".");
      const domains = [
        "",
        ...parts
          .map((_, index) => parts.slice(index).join("."))
          .filter((domain) => domain.includes(".")),
      ];
      for (const domain of domains)
        document.cookie = `${name}=; Max-Age=0; Path=/${domain ? `; Domain=${domain}` : ""}; SameSite=Lax`;
    }
    lastPage = "";
    previousPage = "";
    return;
  }
  if (!canSend()) return;
  command("consent", "update", { analytics_storage: "granted" });
  if (!configured) {
    command("js", new Date());
    command("config", config.measurementId, {
      ...campaignParameters(),
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      page_location:
        cleanAnalyticsUrl(window.location.href) || window.location.origin + "/internal",
      page_title: new URL(
        cleanAnalyticsUrl(window.location.href) || window.location.origin + "/internal",
      ).pathname,
      page_referrer: cleanAnalyticsUrl(document.referrer),
    });
    if (!document.querySelector('script[src*="googletagmanager.com/gtag/js"]')) {
      const script = document.createElement("script");
      script.async = true;
      script.src = `https://www.googletagmanager.com/gtag/js?id=${config.measurementId}`;
      document.head.appendChild(script);
    }
    configured = true;
  }
  sendAnalyticsEvent("pageview");
}

export function initGa4(next: Config): void {
  if (typeof window === "undefined" || config) return;
  config = next;
  (window as AnalyticsWindow).analyticsEvent = sendAnalyticsEvent;
  command("consent", "default", {
    analytics_storage: "denied",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });
  try {
    const raw = localStorage.getItem(next.consentKey);
    setAnalyticsConsent(readConsent(raw));
  } catch {
    /* Unavailable storage means no consent. */
  }
  const changed = () => {
    if (blocked(window.location.pathname)) lastPage = "";
    else sendAnalyticsEvent("pageview");
  };
  for (const method of ["pushState", "replaceState"] as const) {
    const original = window.history[method];
    window.history[method] = function (...args: Parameters<History[typeof method]>) {
      const result = original.apply(this, args);
      changed();
      return result;
    };
  }
  window.addEventListener("popstate", changed);
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!(target instanceof HTMLAnchorElement) || !canSend() || blocked(location.pathname)) return;
    try {
      const url = new URL(target.href);
      const extension = url.pathname
        .match(/\.(pdf|zip|docx?|xlsx?|csv|pptx?|epub)$/i)?.[1]
        ?.toLowerCase();
      if (extension) sendAnalyticsEvent("file_download", { props: { file_extension: extension } });
    } catch {
      /* Invalid download links are ignored. */
    }
  });
  window.addEventListener("storage", (event) => {
    if (event.key === next.consentKey) setAnalyticsConsent(readConsent(event.newValue));
  });
}

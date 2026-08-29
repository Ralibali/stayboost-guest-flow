/** Intended public host. Preview (*.lovable.app) is never a production URL. */
export const CANONICAL_ORIGIN = "https://stayboost.se";

/** First-byte hide for the hosted Lovable badge (Pro setting removes it on republish). */
export const HIDE_LOVABLE_BADGE_CSS =
  "#lovable-badge,#lovable-badge *,.lovable-badge{display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important}";

export function canonicalUrl(path = "/"): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (normalized === "/") return `${CANONICAL_ORIGIN}/`;
  return `${CANONICAL_ORIGIN}${normalized}`;
}

/** Guest emails + Stripe success/cancel. Never fall back to a preview host. */
export function resolvePublicAppUrl(envValue: string | undefined | null): string {
  const trimmed = (envValue ?? "").trim().replace(/\/$/, "");
  if (!trimmed) return CANONICAL_ORIGIN;
  try {
    const url = new URL(trimmed);
    if (url.hostname.endsWith(".lovable.app") || url.hostname === "lovable.app") {
      return CANONICAL_ORIGIN;
    }
    return `${url.protocol}//${url.host}`;
  } catch {
    return CANONICAL_ORIGIN;
  }
}

export function resolveGuestPageBaseUrl(
  guestPageBaseUrl: string | undefined | null,
  publicAppUrl?: string | undefined | null,
): string {
  return resolvePublicAppUrl(guestPageBaseUrl || publicAppUrl);
}

export function leadMagnetPdfUrl(envValue: string | undefined | null): string {
  const trimmed = (envValue ?? "").trim();
  if (trimmed) return trimmed;
  return canonicalUrl("/mallar/stayboost-12-sms.pdf");
}

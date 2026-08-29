/**
 * Public app origin for guest-facing links (mail, Stripe success/cancel).
 * Never returns a *.lovable.app host — falls back to the custom domain.
 */
export const PUBLIC_APP_ORIGIN = "https://stayboost.se";

function isAllowedOrigin(url: string): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    if (host === "localhost" || host === "127.0.0.1") return true; // local dev
    return !host.endsWith(".lovable.app") && host !== "lovable.app";
  } catch {
    return false;
  }
}

export function appBaseUrl(...candidates: Array<string | null | undefined>): string {
  for (const c of candidates) {
    const v = (c ?? "").replace(/\/$/, "");
    if (isAllowedOrigin(v)) return v;
  }
  return PUBLIC_APP_ORIGIN;
}

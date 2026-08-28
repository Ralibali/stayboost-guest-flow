// StayBoost: kanonisk publik värd för gästlänkar och Stripe.
// Samma default som src/lib/site-url.ts. Sätt PUBLIC_APP_URL / GUEST_PAGE_BASE_URL
// i Supabase secrets. Använd aldrig *.lovable.app.

export const CANONICAL_ORIGIN = "https://stayboost.se";

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

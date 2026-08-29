/**
 * Canonical public origin. First-byte SEO/social URLs must always use the
 * custom domain — never any *.lovable.app host.
 */
export const SITE_ORIGIN = "https://stayboost.se";

export function canonicalUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${SITE_ORIGIN}${p}`;
}

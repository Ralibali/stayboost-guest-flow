/** Public marketing host. Preview (*.lovable.app) is never a canonical URL. */
export const CANONICAL_ORIGIN = "https://stayboost.se";

export const LEGAL_PATHS = ["/integritetspolicy", "/villkor", "/cookies", "/dpa"] as const;

export type LegalPath = (typeof LEGAL_PATHS)[number];

export function isLovablePreviewHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  return host === "lovable.app" || host.endsWith(".lovable.app");
}

/** Always stayboost.se. Preview hosts and invalid values are discarded. */
export function publicCanonicalOrigin(candidate?: string | null): string {
  const trimmed = (candidate ?? "").trim();
  if (!trimmed) return CANONICAL_ORIGIN;
  try {
    const url = new URL(trimmed);
    if (isLovablePreviewHost(url.hostname)) return CANONICAL_ORIGIN;
    return `${url.protocol}//${url.host}`;
  } catch {
    return CANONICAL_ORIGIN;
  }
}

export function canonicalUrl(path = "/"): string {
  const origin = publicCanonicalOrigin(CANONICAL_ORIGIN);
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (normalized === "/") return `${origin}/`;
  return `${origin}${normalized.replace(/\/+$/, "")}`;
}

export function legalPageUrl(path: LegalPath): string {
  return canonicalUrl(path);
}

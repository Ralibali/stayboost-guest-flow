export const GLAMPING_ORIGIN = "https://goglampingsweden.se";

export function isGlampingProperty(slug: string, configuredSlug?: string) {
  return Boolean(configuredSlug && slug === configuredSlug);
}

export function glampingEmbedTarget(
  slug: string,
  configuredSlug: string | undefined,
  search: string,
  referrer: string,
): string | null {
  if (
    !isGlampingProperty(slug, configuredSlug) ||
    new URLSearchParams(search).get("embed") !== "goglamping"
  )
    return null;
  try {
    return new URL(referrer).origin === GLAMPING_ORIGIN ? GLAMPING_ORIGIN : null;
  } catch {
    return null;
  }
}

export function bookingLanguage(search: string): "sv" | "en" | "de" | null {
  const lang = new URLSearchParams(search).get("lang");
  return lang === "sv" || lang === "en" || lang === "de" ? lang : null;
}

export function isHostedStripeCheckout(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.origin === "https://checkout.stripe.com" && !url.username && !url.password;
  } catch {
    return false;
  }
}

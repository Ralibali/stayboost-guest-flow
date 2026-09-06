export type ProductEventProps = Record<string, string | number | boolean | null | undefined>;

type PlausibleWindow = Window & {
  plausible?: (event: string, options?: { props?: Record<string, string> }) => void;
};

/**
 * Privacy-safe product funnel events. Never pass email, guest data, free text,
 * property names or integration URLs here — only coarse product-state metadata.
 */
export function trackProductEvent(event: string, props: ProductEventProps = {}) {
  if (typeof window === "undefined") return;
  const safeProps = Object.fromEntries(
    Object.entries(props)
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  );
  (window as PlausibleWindow).plausible?.(event, {
    ...(Object.keys(safeProps).length ? { props: safeProps } : {}),
  });
}

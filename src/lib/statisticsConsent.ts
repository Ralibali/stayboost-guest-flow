// Versioned, time-limited evidence of an explicit statistics choice.
export const CONSENT_VERSION = 2;
export const CONSENT_TTL_MS = 365 * 24 * 60 * 60 * 1000;
export type StatisticsConsent = { version: number; analytics: boolean; timestamp: number };
export function parseStatisticsConsent(
  raw: string | null,
  now = Date.now(),
): StatisticsConsent | null {
  try {
    const value = raw ? JSON.parse(raw) : null;
    if (
      value?.version !== CONSENT_VERSION ||
      typeof value.analytics !== "boolean" ||
      !Number.isFinite(value.timestamp) ||
      value.timestamp > now ||
      now - value.timestamp >= CONSENT_TTL_MS
    )
      return null;
    return value as StatisticsConsent;
  } catch {
    return null;
  }
}
export function storeStatisticsConsent(key: string, analytics: boolean): void {
  try {
    localStorage.setItem(
      key,
      JSON.stringify({ version: CONSENT_VERSION, analytics, timestamp: Date.now() }),
    );
  } catch {
    /* A valid in-memory choice still works when storage is unavailable. */
  }
}

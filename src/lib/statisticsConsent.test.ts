import { describe, expect, it } from "vitest";
import { CONSENT_TTL_MS, parseStatisticsConsent } from "./statisticsConsent";
describe("explicit statistics consent", () => {
  const now = 2000000000000;
  const choice = (analytics: boolean, timestamp = now) =>
    JSON.stringify({ version: 2, analytics, timestamp });
  it("accepts only a current explicit choice", () => {
    expect(parseStatisticsConsent(choice(true), now)?.analytics).toBe(true);
    expect(parseStatisticsConsent(choice(false), now)?.analytics).toBe(false);
  });
  it("requires a new choice after expiry or legacy, corrupt or future records", () => {
    for (const raw of [
      "accepted",
      "declined",
      "{}",
      "{",
      null,
      choice(true, now + 1),
      choice(true, now - CONSENT_TTL_MS),
    ]) {
      expect(parseStatisticsConsent(raw, now)).toBeNull();
    }
  });
});

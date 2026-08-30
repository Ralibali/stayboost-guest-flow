import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MASS_MISSING_GRACE_MS,
  classifyDisappearancePolicy,
  nextMissingObservation,
} from "../../supabase/functions/_shared/ical-reconciliation";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const sync = read("supabase/functions/ical-sync/index.ts");
const migration = read("supabase/migrations/20260830220000_ical_reconciliation_guard.sql");

describe("BP-2 iCal disappearance reconciliation", () => {
  it("never cancels on the first successful fetch where a UID is missing", () => {
    const first = nextMissingObservation({
      previousMissingSince: null,
      previousMissingCount: 0,
      nowIso: "2026-08-30T20:00:00.000Z",
      policy: "normal",
    });

    expect(first.missingCount).toBe(1);
    expect(first.missingSince).toBe("2026-08-30T20:00:00.000Z");
    expect(first.shouldCancel).toBe(false);
    expect(first.reason).toBe("disappearance_grace");
  });

  it("requires both repeated evidence and the normal grace period", () => {
    const tooSoon = nextMissingObservation({
      previousMissingSince: "2026-08-30T20:00:00.000Z",
      previousMissingCount: 1,
      nowIso: "2026-08-30T20:29:00.000Z",
      policy: "normal",
    });
    const confirmed = nextMissingObservation({
      previousMissingSince: "2026-08-30T20:00:00.000Z",
      previousMissingCount: 1,
      nowIso: "2026-08-30T20:31:00.000Z",
      policy: "normal",
    });

    expect(tooSoon.shouldCancel).toBe(false);
    expect(confirmed.missingCount).toBe(2);
    expect(confirmed.shouldCancel).toBe(true);
    expect(confirmed.reason).toBe("confirmed_disappearance");
  });

  it("protects an unexpectedly empty feed indefinitely from disappearance cancellation", () => {
    const policy = classifyDisappearancePolicy({
      channelType: "booking",
      activeFeedEvents: 0,
      confirmedFutureBookings: 4,
      missingCandidates: 4,
    });
    const decision = nextMissingObservation({
      previousMissingSince: "2026-08-29T00:00:00.000Z",
      previousMissingCount: 12,
      nowIso: "2026-08-30T20:00:00.000Z",
      policy,
    });

    expect(policy).toBe("empty");
    expect(decision.shouldCancel).toBe(false);
    expect(decision.reason).toBe("empty_feed_protected");
  });

  it("never releases Sirvoy inventory from iCal disappearance", () => {
    const policy = classifyDisappearancePolicy({
      channelType: "sirvoy",
      activeFeedEvents: 5,
      confirmedFutureBookings: 1,
      missingCandidates: 1,
    });
    const decision = nextMissingObservation({
      previousMissingSince: "2026-08-20T00:00:00.000Z",
      previousMissingCount: 100,
      nowIso: "2026-08-30T20:00:00.000Z",
      policy,
    });

    expect(policy).toBe("sirvoy");
    expect(decision.shouldCancel).toBe(false);
    expect(decision.reason).toBe("sirvoy_source_of_truth");
  });

  it("uses a much stronger gate for suspicious mass disappearance", () => {
    const policy = classifyDisappearancePolicy({
      channelType: "airbnb",
      activeFeedEvents: 2,
      confirmedFutureBookings: 6,
      missingCandidates: 4,
    });
    const beforeSixHours = nextMissingObservation({
      previousMissingSince: "2026-08-30T14:00:00.000Z",
      previousMissingCount: 2,
      nowIso: new Date(
        new Date("2026-08-30T14:00:00.000Z").getTime() + MASS_MISSING_GRACE_MS - 1000,
      ).toISOString(),
      policy,
    });
    const afterSixHours = nextMissingObservation({
      previousMissingSince: "2026-08-30T14:00:00.000Z",
      previousMissingCount: 2,
      nowIso: new Date(
        new Date("2026-08-30T14:00:00.000Z").getTime() + MASS_MISSING_GRACE_MS + 1000,
      ).toISOString(),
      policy,
    });

    expect(policy).toBe("mass");
    expect(beforeSixHours.shouldCancel).toBe(false);
    expect(afterSixHours.missingCount).toBe(3);
    expect(afterSixHours.shouldCancel).toBe(true);
  });

  it("treats explicit STATUS:CANCELLED separately from absence", () => {
    expect(sync).toContain('event.status === "CANCELLED"');
    expect(sync).toContain('ical_cancel_reason: "explicit"');
    expect(sync).toContain("nextMissingObservation");
    expect(sync).toContain('patch.ical_cancel_reason = "disappearance"');
  });

  it("imports external overlaps instead of silently dropping their source truth", () => {
    expect(sync).toContain("konflikter måste importeras, inte döljas");
    expect(sync).toContain("conflicts++");
    expect(sync).toContain('source: "ical"');
    expect(sync).not.toContain("konflikten — den ska synas,\n          // inte försvinna tyst");
  });

  it("validates redirects before following them and rejects non-calendar 200 responses", () => {
    expect(sync).toContain('redirect: "manual"');
    expect(sync).toContain("safeFeedUrl(nextUrl)");
    expect(sync).toContain("assertCalendarDocument(rawCalendar)");
    expect(sync).toContain("svaret är inte en giltig iCal-kalender");
  });

  it("persists reconciliation evidence and conditional-fetch metadata", () => {
    expect(migration).toContain("ical_missing_since timestamptz");
    expect(migration).toContain("ical_missing_count int not null default 0");
    expect(migration).toContain("ical_cancelled_at timestamptz");
    expect(migration).toContain("ical_cancel_reason text");
    expect(migration).toContain("http_etag text");
    expect(migration).toContain("http_last_modified text");
  });
});

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { rangesOverlap } from "../../supabase/functions/_shared/pricing";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const migration = read("supabase/migrations/20260830210000_canonical_booking_write_lock.sql");
const bookingEngine = read("supabase/functions/booking-engine/index.ts");
const icalSync = read("supabase/functions/ical-sync/index.ts");
const sirvoyWebhook = read("supabase/functions/sirvoy-webhook/index.ts");
const bookingsUi = read("src/routes/app/bokningar.tsx");

const indexOfOrFail = (haystack: string, needle: string) => {
  const index = haystack.indexOf(needle);
  expect(index, `Expected to find ${needle}`).toBeGreaterThanOrEqual(0);
  return index;
};

describe("BP-1 canonical booking write lock", () => {
  it("takes the per-unit transaction lock before source-specific conflict handling", () => {
    const confirmedGuard = indexOfOrFail(
      migration,
      "if new.unit_id is null or new.status <> 'confirmed' then",
    );
    const lock = indexOfOrFail(
      migration,
      "pg_advisory_xact_lock(hashtextextended(new.unit_id::text, 0))",
    );
    const managedDecision = indexOfOrFail(
      migration,
      "if new.source in ('manual', 'direct') and exists",
    );

    expect(lock).toBeGreaterThan(confirmedGuard);
    expect(managedDecision).toBeGreaterThan(lock);
  });

  it("guards inserts plus every inventory-changing update", () => {
    expect(migration).toContain(
      "before insert or update of unit_id, checkin_date, checkout_date, status, source",
    );
    expect(migration).toContain("booking_overlap");
    expect(migration).toContain("errcode = '23P01'");
  });

  it("keeps managed inventory strict while preserving external source truth", () => {
    expect(migration).toContain("new.source in ('manual', 'direct')");
    expect(migration).not.toContain(
      "new.source not in ('manual', 'direct')",
    );
    expect(migration).toContain("External writes deliberately remain representable");
  });

  it("covers every current reservation writer through the bookings trigger", () => {
    expect(bookingEngine).toContain('.from("bookings")');
    expect(bookingEngine).toContain('source: "direct"');

    expect(icalSync).toContain('.from("bookings")');
    expect(icalSync).toContain('source: "ical"');

    expect(sirvoyWebhook).toContain('.from("bookings")');
    expect(sirvoyWebhook).toContain('source: "sirvoy"');

    expect(bookingsUi).toContain('.from("bookings")');
    expect(bookingsUi).toContain('source: "manual"');
  });

  it("allows same-day turnover but rejects true date overlap semantics", () => {
    expect(rangesOverlap("2026-09-01", "2026-09-03", "2026-09-03", "2026-09-05")).toBe(false);
    expect(rangesOverlap("2026-09-01", "2026-09-04", "2026-09-03", "2026-09-05")).toBe(true);
  });

  it("documents why a blanket exclusion constraint is intentionally not used", () => {
    expect(migration).toContain("does NOT introduce a blanket exclusion constraint");
    expect(migration).toContain("external source rows");
  });
});

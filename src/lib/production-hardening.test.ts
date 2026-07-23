import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { rangesOverlap } from "../../supabase/functions/_shared/pricing";

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(here, "../../supabase/migrations/20260722100000_production_hardening.sql"),
  "utf8",
);
const bookingEngine = readFileSync(
  join(here, "../../supabase/functions/booking-engine/index.ts"),
  "utf8",
);

describe("produktionshärdning", () => {
  it("har redigerbar kapacitet och komplett boendeprofil i databasen", () => {
    expect(migration).toContain("add column max_guests int not null default 2");
    expect(migration).toContain("check (max_guests between 1 and 20)");
    expect(migration).toContain("add column image_url text");
    expect(migration).toContain("add column description text");
    expect(migration).toContain("add column amenities text[]");
    expect(migration).toContain("add column active boolean not null default true");
  });

  it("serialiserar manuella och direkta bokningar per enhet", () => {
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("booking_overlap");
    expect(migration).toContain("before insert or update of unit_id, checkin_date, checkout_date, status, source");
  });

  it("validerar kapacitet och villkor server-side", () => {
    expect(bookingEngine).toContain("guestsRaw > unit.max_guests");
    expect(bookingEngine).toContain('error: "capacity_exceeded"');
    expect(bookingEngine).toContain('error: "terms_required"');
    expect(bookingEngine).toContain("booking_attempts");
    expect(bookingEngine).toContain("payment_expires_at");
  });

  it("tillåter utcheckning samma dag som nästa gäst checkar in", () => {
    expect(rangesOverlap("2026-08-10", "2026-08-12", "2026-08-12", "2026-08-14")).toBe(false);
    expect(rangesOverlap("2026-08-10", "2026-08-13", "2026-08-12", "2026-08-14")).toBe(true);
  });

  it("begränsar bildpolicies till den inloggades anläggningsmapp", () => {
    expect(migration).toContain("p.owner_id = auth.uid()");
    expect(migration).toContain("p.id::text = (storage.foldername(name))[1]");
    expect(migration).toContain("bucket_id = 'unit-images'");
    expect(migration).toContain("bucket_id = 'addon-images'");
  });
});

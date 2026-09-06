import { describe, expect, it } from "vitest";
import { handleGuestPage } from "../../supabase/functions/_shared/guest-page";
import { handleIcalExport } from "../../supabase/functions/_shared/ical-export";

// Isolation oracle for service_role handlers: two properties, one booking each.
// Cross-tenant attempts present B's slug (tenant claim) together with A's
// object token. Guest token / iCal token / booking ref alone is not a tenant scope.

const TOKEN_A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const TOKEN_B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const ICAL_A = "cccccccccccccccccccccccc";
const ICAL_B = "dddddddddddddddddddddddd";

const propertyA = {
  id: "prop-a",
  slug: "lodge-a",
  name: "Alpine A",
  checkin_time: "15:00",
  checkout_time: "11:00",
  directions: "A-only directions",
  wifi_name: "AlpineA",
  wifi_password: "SECRET-A",
  house_rules: "A rules",
  contact_phone: "+46701111111",
  swish_number: "1231111111",
};

const propertyB = {
  id: "prop-b",
  slug: "lodge-b",
  name: "Beach B",
  checkin_time: "16:00",
  checkout_time: "10:00",
  directions: "B-only directions",
  wifi_name: "BeachB",
  wifi_password: "SECRET-B",
  house_rules: "B rules",
  contact_phone: "+46702222222",
  swish_number: "1232222222",
};

const unitA = {
  id: "unit-a",
  property_id: "prop-a",
  name: "Cabin A",
  ical_feed_token: ICAL_A,
  door_code: "1111",
  checkin_instructions: "A door",
};

const unitB = {
  id: "unit-b",
  property_id: "prop-b",
  name: "Cabin B",
  ical_feed_token: ICAL_B,
  door_code: "2222",
  checkin_instructions: "B door",
};

const bookingA = {
  id: "book-a",
  property_id: "prop-a",
  unit_id: "unit-a",
  guest_token: TOKEN_A,
  guest_name: "Alice",
  checkin_date: "2026-09-10",
  checkout_date: "2026-09-12",
  status: "confirmed",
  payment_method: "none",
  payment_status: null,
  payment_amount: null,
  payment_ref: "REF-A",
  payment_expires_at: null,
};

const bookingB = {
  id: "book-b",
  property_id: "prop-b",
  unit_id: "unit-b",
  guest_token: TOKEN_B,
  guest_name: "Bob",
  checkin_date: "2026-10-01",
  checkout_date: "2026-10-03",
  status: "confirmed",
  payment_method: "none",
  payment_status: null,
  payment_amount: null,
  payment_ref: "REF-B",
  payment_expires_at: null,
};

type Row = Record<string, unknown>;
type Filter = { column: string; value: unknown; op: "eq" | "gte" | "lte" };

function createMockAdmin() {
  const tables: Record<string, Row[]> = {
    properties: [propertyA, propertyB],
    units: [unitA, unitB],
    bookings: [bookingA, bookingB],
  };

  const applyEmbeds = (table: string, select: string, rows: Row[]) =>
    rows.map((row) => {
      const next = { ...row };
      if (select.includes("property:properties")) {
        next.property = tables.properties.find((p) => p.id === row.property_id) ?? null;
      }
      if (select.includes("unit:units")) {
        next.unit = tables.units.find((u) => u.id === row.unit_id) ?? null;
      }
      return next;
    });

  const from = (table: string) => {
    const filters: Filter[] = [];
    let select = "*";
    const run = () => {
      const rows = (tables[table] ?? []).filter((row) =>
        filters.every((filter) => {
          const value = row[filter.column];
          if (filter.op === "eq") return value === filter.value;
          if (filter.op === "gte") return String(value) >= String(filter.value);
          if (filter.op === "lte") return String(value) <= String(filter.value);
          return true;
        }),
      );
      return applyEmbeds(table, select, rows);
    };
    const query = {
      select(columns: string) {
        select = columns;
        return query;
      },
      eq(column: string, value: unknown) {
        filters.push({ column, value, op: "eq" });
        return query;
      },
      gte(column: string, value: unknown) {
        filters.push({ column, value, op: "gte" });
        return query;
      },
      lte(column: string, value: unknown) {
        filters.push({ column, value, op: "lte" });
        return query;
      },
      order() {
        return query;
      },
      async maybeSingle() {
        const rows = run();
        if (rows.length === 0) return { data: null, error: null };
        if (rows.length > 1) return { data: null, error: { message: "multiple_rows" } };
        return { data: rows[0], error: null };
      },
      then(
        resolve: (value: { data: Row[]; error: null }) => unknown,
        reject?: (reason: unknown) => unknown,
      ) {
        return Promise.resolve({ data: run(), error: null }).then(resolve, reject);
      },
    };
    return query;
  };

  return { from };
}

const hasAPayload = (text: string) =>
  /Alice|SECRET-A|Alpine A|Cabin A|book-a@stayboost|A-only directions|REF-A/.test(text);

describe("tenant isolation: guest-page + ical-export", () => {
  it("rejects guest-page access to property A when the request claims property B", async () => {
    const res = await handleGuestPage(
      new Request("http://stayboost.local/guest-page", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: TOKEN_A, slug: propertyB.slug, ref: bookingA.id }),
      }),
      createMockAdmin(),
    );
    const body = await res.text();

    expect(res.status, `guest-page must fail closed, got ${res.status}: ${body}`).toBe(404);
    expect(hasAPayload(body)).toBe(false);
    expect(body).not.toContain("Alice");
    expect(body).not.toContain("SECRET-A");
  });

  it("rejects ical-export access to property A when the request claims property B", async () => {
    const res = await handleIcalExport(
      new Request(
        `http://stayboost.local/ical-export?token=${ICAL_A}&slug=${propertyB.slug}&ref=${bookingA.id}`,
      ),
      createMockAdmin(),
    );
    const body = await res.text();

    expect(res.status, `ical-export must fail closed, got ${res.status}: ${body}`).toBe(404);
    expect(hasAPayload(body)).toBe(false);
    expect(body).not.toContain("book-a@stayboost");
    expect(body).not.toContain("Cabin A");
  });

  it("still serves the matching tenant when token and slug agree, and when only the token is sent", async () => {
    const guest = await handleGuestPage(
      new Request("http://stayboost.local/guest-page", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: TOKEN_A, slug: propertyA.slug }),
      }),
      createMockAdmin(),
    );
    const guestBody = await guest.json();
    expect(guest.status).toBe(200);
    expect(guestBody.guestName).toBe("Alice");
    expect(guestBody.property.wifi_password).toBe("SECRET-A");

    const tokenOnly = await handleGuestPage(
      new Request("http://stayboost.local/guest-page", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: TOKEN_A }),
      }),
      createMockAdmin(),
    );
    expect(tokenOnly.status).toBe(200);
    expect((await tokenOnly.json()).guestName).toBe("Alice");

    const ical = await handleIcalExport(
      new Request(`http://stayboost.local/ical-export?token=${ICAL_A}&slug=${propertyA.slug}`),
      createMockAdmin(),
    );
    const icalBody = await ical.text();
    expect(ical.status).toBe(200);
    expect(icalBody).toContain("book-a@stayboost");
    expect(icalBody).not.toContain("book-b@stayboost");

    const icalTokenOnly = await handleIcalExport(
      new Request(`http://stayboost.local/ical-export?token=${ICAL_A}`),
      createMockAdmin(),
    );
    expect(icalTokenOnly.status).toBe(200);
    expect(await icalTokenOnly.text()).toContain("book-a@stayboost");
  });

  it("returns 404 when the slug does not resolve to a property", async () => {
    const guest = await handleGuestPage(
      new Request("http://stayboost.local/guest-page", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: TOKEN_A, slug: "no-such-lodge" }),
      }),
      createMockAdmin(),
    );
    expect(guest.status).toBe(404);

    const ical = await handleIcalExport(
      new Request(`http://stayboost.local/ical-export?token=${ICAL_A}&slug=no-such-lodge`),
      createMockAdmin(),
    );
    expect(ical.status).toBe(404);
  });
});

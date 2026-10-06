import { readFileSync } from "node:fs";
import { ScriptTarget, transpileModule } from "typescript";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as pricing from "../../supabase/functions/_shared/pricing";
import * as rules from "../../supabase/functions/_shared/rate-rules";
import * as addons from "../../supabase/functions/_shared/addons";
import { appBaseUrl } from "../../supabase/functions/_shared/app-url";
import { normalizeGuestPhone } from "../../supabase/functions/_shared/guest-contact";
import { stockholmDay } from "../../supabase/functions/_shared/guest-stay";
import { collectPages } from "../../supabase/functions/_shared/pagination";
import { sanitizedHttpsUrl } from "../../supabase/functions/_shared/public-links";
import { channelInventoryFresh } from "../../supabase/functions/_shared/channel-freshness";
import { projectUnitContent } from "../../supabase/functions/_shared/unit-content";
import {
  localizedAddonText,
  projectAddonContent,
} from "../../supabase/functions/_shared/addon-content";

type Row = Record<string, unknown>;
const source = readFileSync(
  new URL("../../supabase/functions/booking-engine/index.ts", import.meta.url),
  "utf8",
).replace(/import[\s\S]*?from\s+["'][^"']+["'];\s*/g, "");
const compiled = transpileModule(source, {
  compilerOptions: { target: ScriptTarget.ES2022 },
}).outputText;

function fixture(scope: "all" | "selected" = "selected", unitIds = ["tent3"]) {
  const property = {
    id: "property",
    name: "Glamping",
    slug: "glamping",
    booking_enabled: true,
    max_stay: 30,
    booking_terms_url: "https://example.test/terms",
    checkin_time: "15:00",
    checkout_time: "11:00",
  };
  const units = ["tent1", "tent3"].map((id) => ({
    id,
    name: id,
    property_id: property.id,
    active: true,
    max_guests: 2,
    base_price: 1000,
    weekend_pct: 0,
    min_stay: 1,
    cleaning_fee: 0,
    monthly_mult: Array(12).fill(100),
    amenities: [],
  }));
  const catalog = [
    {
      id: "pet",
      property_id: property.id,
      name: "Pet",
      price: 499,
      price_type: "per_booking",
      active: true,
      max_quantity: 1,
      unit_scope: scope,
      addon_units: unitIds.map((unit_id) => ({ unit_id })),
    },
  ];
  const tables: Record<string, Row[]> = {
    properties: [property],
    units,
    addons: catalog,
    bookings: [],
    booking_addons: [],
  };
  const state = { failAddons: false };
  const client = {
    from(table: string) {
      let operation = "select",
        patch: Row | Row[] = {};
      const filters: ((row: Row) => boolean)[] = [];
      const run = (single: boolean) => {
        if (table === "addons" && state.failAddons)
          return { data: null, error: { message: "relation unavailable" } };
        const rows = tables[table] ?? [];
        if (operation === "insert") {
          const inserted = (Array.isArray(patch) ? patch : [patch]).map((row) =>
            table === "bookings"
              ? { id: "booking", guest_token: "token", status: "confirmed", ...row }
              : row,
          );
          if (tables[table]) rows.push(...inserted);
          return { data: single ? inserted[0] : inserted, error: null };
        }
        const matching = rows.filter((row) => filters.every((filter) => filter(row)));
        if (operation === "update") matching.forEach((row) => Object.assign(row, patch));
        return { data: single ? (matching[0] ?? null) : matching, error: null, count: 0 };
      };
      const query = {
        select() {
          return this;
        },
        insert(value: Row | Row[]) {
          operation = "insert";
          patch = value;
          return this;
        },
        update(value: Row) {
          operation = "update";
          patch = value;
          return this;
        },
        delete() {
          operation = "delete";
          return this;
        },
        eq(key: string, value: unknown) {
          filters.push((row) => row[key] === value);
          return this;
        },
        gte() {
          return this;
        },
        lte() {
          return this;
        },
        lt() {
          return this;
        },
        gt() {
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return this;
        },
        range() {
          return this;
        },
        maybeSingle() {
          return Promise.resolve(run(true));
        },
        single() {
          return Promise.resolve(run(true));
        },
        then(onFulfilled: (value: unknown) => unknown) {
          return Promise.resolve(run(false)).then(onFulfilled);
        },
      };
      return query;
    },
  };
  const createCheckoutSession = vi.fn(async () => ({
    id: "cs_mock",
    url: "https://checkout.stripe.com/mock",
  }));
  const bindings = {
    createClient: () => client,
    ...pricing,
    ...rules,
    ...addons,
    createCheckoutSession,
    expireCheckoutSession: vi.fn(),
    appBaseUrl,
    normalizeGuestPhone,
    stockholmDay,
    collectPages,
    sanitizedHttpsUrl,
    channelInventoryFresh,
    projectUnitContent,
    localizedAddonText,
    projectAddonContent,
  };
  let handler!: (request: Request) => Promise<Response>;
  new Function("Deno", ...Object.keys(bindings), compiled)(
    {
      serve: (callback: typeof handler) => {
        handler = callback;
      },
      env: { get: (key: string) => (key === "STRIPE_SECRET_KEY" ? "sk_test_mock" : undefined) },
    },
    ...Object.values(bindings),
  );
  return {
    tables,
    state,
    createCheckoutSession,
    get: () => handler(new Request("https://example.test/booking-engine?slug=glamping")),
    post: (unitId: string, extra: Row = {}) =>
      handler(
        new Request("https://example.test/booking-engine", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            slug: "glamping",
            unitId,
            checkin: "2026-10-07",
            checkout: "2026-10-08",
            guests: 2,
            guest_name: "Synthetic Guest",
            guest_email: "guest@example.test",
            termsAccepted: true,
            paymentMethod: "stripe",
            addons: [{ id: "pet", quantity: 1 }],
            ...extra,
          }),
        }),
      ),
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime("2026-10-06T12:00:00Z");
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("No external services in tests");
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function partyFixture(basis: "per_booking" | "per_night" = "per_booking") {
  const f = fixture("all");
  Object.assign(f.tables.units[0], {
    max_guests: 4,
    party_pricing_enabled: true,
    adult_prices: [995, 1995, 2895, 3495],
    child_price_per_night: 329,
    child_price_basis: basis,
    child_price_per_booking: 329,
    child_free_through_age: 1,
    child_max_age: 9,
  });
  return f;
}

it("uses the same once-per-booking child total in the public offer, immutable quote and checkout", async () => {
  const f = partyFixture();
  const offer = await (await f.get()).json();
  expect(offer.units[0]).toMatchObject({
    childPriceBasis: "per_booking",
    childPricePerBooking: 329,
    childPricePerNight: 329,
  });
  const response = await f.post("tent1", {
    checkin: "2027-05-31",
    checkout: "2027-06-02",
    adults: 2,
    childrenAges: [6],
    addons: [],
    expectedTotal: 4319,
  });
  expect(response.status).toBe(200);
  expect(f.tables.bookings[0]).toMatchObject({
    guests: 3,
    adults: 2,
    children_ages: [6],
    payment_amount: 4319,
    quote_snapshot: {
      partyPricingEnabled: true,
      adultSubtotal: 3990,
      childrenSubtotal: 329,
      childrenPerBookingSubtotal: 329,
      childrenPriceBasis: "per_booking",
      grandTotal: 4319,
    },
  });
  expect(f.createCheckoutSession).toHaveBeenCalledOnce();
});

it("retains nightly 658 pricing and rejects a stale once-only client total before any booking", async () => {
  const f = partyFixture("per_night");
  const args = {
    checkin: "2027-05-31",
    checkout: "2027-06-02",
    adults: 2,
    childrenAges: [6],
    addons: [],
  };
  expect((await f.post("tent1", { ...args, expectedTotal: 4319 })).status).toBe(409);
  expect(f.tables.bookings).toEqual([]);
  expect((await f.post("tent1", { ...args, expectedTotal: 4648 })).status).toBe(200);
  expect(f.tables.bookings[0]).toMatchObject({
    quote_snapshot: { childrenSubtotal: 658, childrenPerBookingSubtotal: 0 },
  });
});

it("rejects direct API attempts to buy a marked manual child price with party pricing, even without children", async () => {
  for (const childrenAges of [[6], []]) {
    const f = partyFixture();
    Object.assign(f.tables.addons[0], { pricing_role: "manual_child_price", price: 329 });
    const offer = await (await f.get()).json();
    expect(offer.addons[0].pricingRole).toBe("manual_child_price");
    const response = await f.post("tent1", { adults: 2, childrenAges, pricing_role: "extra" });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_addons" });
    expect(f.tables.bookings).toEqual([]);
    expect(f.createCheckoutSession).not.toHaveBeenCalled();
  }
});

it("counts free children against capacity before attempting payment", async () => {
  const f = partyFixture();
  const response = await f.post("tent1", { adults: 2, childrenAges: [0, 1, 6], addons: [] });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: "capacity_exceeded", maxGuests: 4 });
  expect(f.tables.bookings).toEqual([]);
  expect(f.createCheckoutSession).not.toHaveBeenCalled();
});

it("publishes the unit restriction without exposing storage joins", async () => {
  const f = fixture();
  const response = await f.get();
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.addons[0]).toMatchObject({ id: "pet", allowedUnitIds: ["tent3"] });
  expect(body.addons[0]).not.toHaveProperty("addon_units");
  expect(body.addons[0]).not.toHaveProperty("property_id");
});

it("rejects a forged direct API selection on another tent before booking or payment writes", async () => {
  const f = fixture();
  const response = await f.post("tent1", {
    allowedUnitIds: ["tent1"],
    addons: [{ id: "pet", quantity: 1, unitId: "tent3" }],
  });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "invalid_addons" });
  expect(f.tables.bookings).toEqual([]);
  expect(f.tables.booking_addons).toEqual([]);
  expect(f.createCheckoutSession).not.toHaveBeenCalled();
});

it("creates the purchase and checkout only on an allowed tent", async () => {
  const f = fixture();
  const response = await f.post("tent3");
  expect(response.status).toBe(200);
  expect(f.tables.bookings[0]).toMatchObject({ unit_id: "tent3", payment_amount: 1499 });
  expect(f.tables.booking_addons).toEqual([
    { booking_id: "booking", addon_id: "pet", quantity: 1, unit_price: 499 },
  ]);
  expect(f.createCheckoutSession).toHaveBeenCalledWith(
    expect.objectContaining({ amountSek: 1499 }),
  );
});

it("keeps unrestricted legacy add-ons valid for another tent", async () => {
  const f = fixture("all", []);
  expect((await f.post("tent1")).status).toBe(200);
  expect(f.tables.bookings[0].unit_id).toBe("tent1");
});

it("does not broaden an empty selected scope or a failed scope load", async () => {
  const empty = fixture("selected", []);
  expect((await empty.get()).status).toBe(200);
  expect((await empty.post("tent3")).status).toBe(400);
  const broken = fixture();
  broken.state.failAddons = true;
  const response = await broken.post("tent3");
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "addons_unavailable" });
  expect(broken.createCheckoutSession).not.toHaveBeenCalled();
});

it("rejects a catalog ID belonging to another property", async () => {
  const f = fixture();
  f.tables.addons[0].property_id = "other-property";
  expect((await f.post("tent3")).status).toBe(400);
  expect(f.tables.bookings).toEqual([]);
  expect(f.createCheckoutSession).not.toHaveBeenCalled();
});

it("projects exact localized catalog content without private metadata and snapshots included VAT without raising the price", async () => {
  const f = fixture();
  const description = "  Whole description 💚\n\nLast line.  ";
  f.tables.addons[0].content_translations = {
    sv: { name: "Husdjur", description: "Svensk text" },
    en: { name: "Pet companion", description, source_archive: "PRIVATE" },
    da: { name: "Kæledyr", description: "Dansk tekst" },
  };
  f.tables.addons[0].vat_rate = 12;
  f.tables.addons[0].source_archive = "PRIVATE";
  const catalog = await (await f.get()).json();
  expect(catalog.addons[0]).toMatchObject({
    contentTranslations: { en: { name: "Pet companion", description }, da: { name: "Kæledyr" } },
    vatRate: 12,
  });
  expect(JSON.stringify(catalog)).not.toContain("PRIVATE");
  const response = await f.post("tent3", {
    language: "en",
    vatRate: 0,
    contentTranslations: { en: { name: "FORGED" } },
  });
  expect(response.status).toBe(200);
  const quote = f.tables.bookings[0].quote_snapshot as { addons: Row[]; grandTotal: number };
  expect(quote.addons[0]).toMatchObject({
    name: "Pet companion",
    description,
    vatRate: 12,
    taxInclusive: true,
    unitPrice: 499,
    priceType: "per_booking",
    lineTotal: 499,
  });
  expect(quote.grandTotal).toBe(1499);
  expect(f.createCheckoutSession).toHaveBeenCalledWith(
    expect.objectContaining({ amountSek: 1499 }),
  );
  f.tables.addons[0].vat_rate = 25;
  f.tables.addons[0].content_translations = {};
  expect(quote.addons[0]).toMatchObject({ name: "Pet companion", vatRate: 12 });
});

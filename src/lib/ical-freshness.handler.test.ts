import { readFileSync } from "node:fs";
import { ScriptTarget, transpileModule } from "typescript";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as freshness from "../../supabase/functions/_shared/ical-freshness";
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
import { stripeConfigForProperty } from "../../supabase/functions/_shared/stripe-config";
const NOW = Date.parse("2026-10-14T12:00:00Z");
type Row = Record<string, unknown>;
const fresh = (extra: Row = {}) => ({
  id: "feed",
  property_id: "property",
  unit_id: "a",
  paused: false,
  last_success_at: new Date(NOW - 60_000).toISOString(),
  consecutive_failures: 0,
  ...extra,
});
const source = readFileSync(
  new URL("../../supabase/functions/booking-engine/index.ts", import.meta.url),
  "utf8",
).replace(/import[\s\S]*?from\s+["'][^"']+["'];\s*/g, "");
const code = transpileModule(source, {
  compilerOptions: { target: ScriptTarget.ES2022 },
}).outputText;
function fixture(feeds: Row[] = []) {
  const tables: Record<string, Row[]> = {
    properties: [
      { id: "property", slug: "test", name: "Test", booking_enabled: true, max_stay: 30 },
    ],
    units: ["a", "b"].map((id) => ({
      id,
      name: id,
      property_id: "property",
      active: true,
      max_guests: 4,
      base_price: 1000,
      weekend_pct: 0,
      min_stay: 1,
      cleaning_fee: 0,
      monthly_mult: Array(12).fill(100),
    })),
    ical_sources: feeds,
    bookings: [],
  };
  const reads: Array<{ table: string; fields: string; filters: Row; range: number[] }> = [];
  const state = { failFrom: null as number | null, insertError: null as string | null };
  const client = {
    from(table: string) {
      const read = { table, fields: "", filters: {} as Row, range: [0, Infinity] };
      reads.push(read);
      let inserted: Row | null = null;
      const run = (single = false) => {
        if (table === "ical_sources" && state.failFrom != null && read.range[0] >= state.failFrom)
          return { data: null, error: { message: "private database error" } };
        if (inserted && table === "bookings") {
          if (state.insertError) return { data: null, error: { message: state.insertError } };
          const booking = { id: "booking", guest_token: "synthetic-token", ...inserted };
          tables.bookings.push(booking);
          return { data: booking, error: null };
        }
        const found = (tables[table] ?? [])
          .filter((r) => Object.entries(read.filters).every(([k, v]) => r[k] === v))
          .slice(read.range[0], read.range[1] + 1);
        return { data: single ? (found[0] ?? null) : found, error: null, count: 0 };
      };
      const q = {
        select(fields: string) {
          read.fields = fields;
          return this;
        },
        eq(k: string, v: unknown) {
          read.filters[k] = v;
          return this;
        },
        range(a: number, b: number) {
          read.range = [a, b];
          return this;
        },
        order() {
          return this;
        },
        limit() {
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
        delete() {
          return this;
        },
        insert(r: Row) {
          inserted = r;
          return this;
        },
        maybeSingle: async () => run(true),
        single: async () => run(true),
        then(resolve: (v: unknown) => unknown) {
          return Promise.resolve(run()).then(resolve);
        },
      };
      return q;
    },
  };
  let handler!: (req: Request) => Promise<Response>;
  const bindings = {
    createClient: () => client,
    ...freshness,
    ...pricing,
    ...rules,
    ...addons,
    appBaseUrl,
    normalizeGuestPhone,
    stockholmDay,
    collectPages,
    sanitizedHttpsUrl,
    channelInventoryFresh,
    projectUnitContent,
    localizedAddonText,
    projectAddonContent,
    stripeConfigForProperty,
  };
  new Function("Deno", ...Object.keys(bindings), code)(
    { serve: (h: typeof handler) => (handler = h), env: { get: () => undefined } },
    ...Object.values(bindings),
  );
  return {
    state,
    tables,
    reads,
    get: () => handler(new Request("https://example.test/?slug=test")),
    post: (unit = "a") =>
      handler(
        new Request("https://example.test/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            slug: "test",
            unitId: unit,
            checkin: "2027-05-01",
            checkout: "2027-05-03",
            guest_name: "Synthetic",
            guest_email: "synthetic@example.test",
            guests: 2,
            termsAccepted: true,
          }),
        }),
      ),
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw Error("No provider request expected");
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it.each([
  ["paused", { paused: true }],
  ["never synced", { last_success_at: null }],
  ["stale", { last_success_at: new Date(NOW - 20 * 60_000 - 1).toISOString() }],
  ["error", { consecutive_failures: 1 }],
  ["future", { last_success_at: new Date(NOW + 1).toISOString() }],
  ["invalid", { last_success_at: "not a timestamp" }],
])(
  "actual GET hides only the affected tent and POST rejects %s before a booking/payment",
  async (_name, patch) => {
    const f = fixture([fresh(patch)]);
    const offer = await (await f.get()).json();
    expect(offer.units.map((u: Row) => u.id)).toEqual(["b"]);
    const response = await f.post();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "ical_sync_required" });
    expect(f.tables.bookings).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    expect((await f.post("b")).status).toBe(200);
  },
);
it("requires every feed, and returns a safe unavailable response when all units are blocked", async () => {
  const f = fixture([
    fresh(),
    fresh({ id: "second", paused: true }),
    fresh({ id: "third", unit_id: "b", paused: true }),
  ]);
  const result = await f.get();
  expect(result.status).toBe(503);
  expect(await result.text()).not.toContain("second");
  expect((await f.post()).status).toBe(503);
});
it("accepts no feeds, fresh feeds and the exact 20-minute threshold without changing existing quotes", async () => {
  for (const feeds of [
    [],
    [fresh()],
    [fresh({ last_success_at: new Date(NOW - 20 * 60_000).toISOString() })],
  ]) {
    const f = fixture(feeds);
    expect((await f.get()).status).toBe(200);
    expect((await f.post()).status).toBe(200);
    expect(f.tables.bookings[0].payment_amount).toBe(2000);
  }
});
it("keeps unrelated property feeds out and never selects calendar secrets for public readiness", async () => {
  const f = fixture([fresh({ property_id: "foreign", paused: true, url: "PRIVATE" })]);
  expect((await f.post()).status).toBe(200);
  for (const read of f.reads.filter((r) => r.table === "ical_sources")) {
    expect(read.filters).toEqual({ property_id: "property" });
    expect(read.fields).not.toMatch(/url|name|http_|last_status/);
  }
});
it.each([0, 1000])(
  "fails closed on source-page read error at offset %s, including after a complete earlier page",
  async (offset) => {
    const f = fixture(Array.from({ length: 1000 }, (_, i) => fresh({ id: `f${i}` })));
    f.state.failFrom = offset;
    expect((await f.get()).status).toBe(503);
    expect((await f.post()).status).toBe(503);
    expect(f.tables.bookings).toHaveLength(0);
  },
);
it("does not miss an unhealthy source beyond the first 1000 rows", async () => {
  const f = fixture([
    ...Array.from({ length: 1000 }, (_, i) => fresh({ id: `f${i}` })),
    fresh({ id: "last", paused: true }),
  ]);
  expect((await f.post()).status).toBe(503);
  expect(f.reads.some((r) => r.table === "ical_sources" && r.range[0] === 1000)).toBe(true);
});
it("maps the atomic database guard to the same safe unavailable response after a fresh preflight", async () => {
  const f = fixture([fresh()]);
  f.state.insertError = "ical_sync_required";
  const response = await f.post();
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "ical_sync_required" });
  expect(fetch).not.toHaveBeenCalled();
});
it("returns a safe closed response when a closure commits after the availability preflight", async () => {
  const f = fixture([fresh()]);
  f.state.insertError = "booking_closed";
  const response = await f.post();
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "closed" });
  expect(f.tables.bookings).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
});

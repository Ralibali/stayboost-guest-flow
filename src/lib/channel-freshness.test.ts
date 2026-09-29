import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ScriptTarget, transpileModule } from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BOOKING_FEED_MAX_AGE_MS,
  CHANNEL_ARI_MAX_AGE_MS,
  channelInventoryFresh,
  type ChannelFreshness,
} from "../../supabase/functions/_shared/channel-freshness";
import { stockholmDay } from "../../supabase/functions/_shared/guest-stay";
import { normalizeGuestPhone } from "../../supabase/functions/_shared/guest-contact";
import { nightsBetween } from "../../supabase/functions/_shared/pricing";
import { collectPages } from "../../supabase/functions/_shared/pagination";
import { sanitizedHttpsUrl } from "../../supabase/functions/_shared/public-links";

const NOW = Date.parse("2026-09-29T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const fresh: ChannelFreshness = {
  enabled: true,
  last_booking_sync_at: iso(NOW - 60_000),
  last_ari_sync_at: iso(NOW - 60 * 60_000),
  last_error: null,
};
const unsafe: Partial<ChannelFreshness>[] = [
  { last_booking_sync_at: null },
  { last_ari_sync_at: null },
  { last_booking_sync_at: iso(NOW - BOOKING_FEED_MAX_AGE_MS - 1) },
  { last_ari_sync_at: iso(NOW - CHANNEL_ARI_MAX_AGE_MS - 1) },
  { last_booking_sync_at: "invalid" },
  { last_ari_sync_at: iso(NOW + 1) },
  { enabled: false, last_error: "channel_inventory_closure_failed" },
];

describe("channel freshness before direct sales", () => {
  it.each(unsafe)("blocks unsafe channel metadata %j", (patch) => {
    expect(channelInventoryFresh({ ...fresh, ...patch }, NOW)).toBe(false);
  });
  it("accepts the exact SQL freshness boundaries", () => {
    expect(
      channelInventoryFresh(
        {
          ...fresh,
          last_booking_sync_at: iso(NOW - BOOKING_FEED_MAX_AGE_MS),
          last_ari_sync_at: iso(NOW - CHANNEL_ARI_MAX_AGE_MS),
        },
        NOW,
      ),
    ).toBe(true);
  });
  it("allows a disabled safe connection without inventing a first sync", () => {
    expect(
      channelInventoryFresh(
        { enabled: false, last_booking_sync_at: null, last_ari_sync_at: null },
        NOW,
      ),
    ).toBe(true);
  });
});

function engine(connections: ChannelFreshness[] | null, channelError: unknown = null) {
  const reads: { table: string; fields: string; filters: [string, unknown][] }[] = [];
  let bookingsInserted = 0;
  const property = {
    id: "property",
    name: "Glamping",
    slug: "glamping",
    booking_enabled: true,
    max_stay: 30,
    contact_email: "host@example.test",
    checkin_time: "15:00",
    checkout_time: "11:00",
  };
  const client = {
    from(table: string) {
      const read = { table, fields: "", filters: [] as [string, unknown][] };
      reads.push(read);
      const result = () =>
        table === "properties"
          ? { data: property, error: null }
          : table === "channel_connections"
            ? { data: connections, error: channelError }
            : { data: [], error: null, count: 0 };
      const builder = {
        select(fields: string) {
          read.fields = fields;
          return this;
        },
        eq(column: string, value: unknown) {
          read.filters.push([column, value]);
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
        order() {
          return this;
        },
        limit() {
          return this;
        },
        range() {
          return this;
        },
        delete() {
          return this;
        },
        insert() {
          if (table === "bookings") bookingsInserted++;
          return this;
        },
        async maybeSingle() {
          return result();
        },
        then(onFulfilled: (value: unknown) => unknown) {
          return Promise.resolve(result()).then(onFulfilled);
        },
      };
      return builder;
    },
  };
  const source = readFileSync(
    resolve("supabase/functions/booking-engine/index.ts"),
    "utf8",
  ).replace(/import[\s\S]*?from\s+["'][^"']+["'];\s*/g, "");
  const code = transpileModule(source, {
    compilerOptions: { target: ScriptTarget.ES2022 },
  }).outputText;
  let handler!: (request: Request) => Promise<Response>;
  const bindings = {
    createClient: () => client,
    channelInventoryFresh,
    stockholmDay,
    normalizeGuestPhone,
    nightsBetween,
    collectPages,
    sanitizedHttpsUrl,
  };
  new Function("Deno", ...Object.keys(bindings), code)(
    {
      serve(callback: typeof handler) {
        handler = callback;
      },
      env: { get: () => undefined },
    },
    ...Object.values(bindings),
  );
  return { handler, reads, bookingsInserted: () => bookingsInserted };
}

describe("actual public booking engine freshness gates", { timeout: 15_000 }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  const request = (method: "GET" | "POST") =>
    new Request("https://example.test/functions/v1/booking-engine?slug=glamping", {
      method,
      ...(method === "POST"
        ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              slug: "glamping",
              unitId: "tent",
              checkin: "2026-09-30",
              checkout: "2026-10-01",
              guest_name: "Example Guest",
              guest_email: "guest@example.test",
              termsAccepted: true,
            }),
          }
        : {}),
    });
  it.each(["GET", "POST"] as const)(
    "blocks %s before inventory/pricing/booking writes for every unsafe channel",
    async (method) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
      for (const patch of unsafe) {
        const mock = engine([{ ...fresh, ...patch }]);
        const response = await mock.handler(request(method));
        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({ error: "channel_sync_required" });
        expect(mock.bookingsInserted()).toBe(0);
        expect(mock.reads.some((read) => read.table === "units")).toBe(false);
        expect(mock.reads.find((read) => read.table === "channel_connections")).toMatchObject({
          fields: "enabled, last_booking_sync_at, last_ari_sync_at, last_error",
          filters: [["property_id", "property"]],
        });
      }
    },
  );
  it.each(["GET", "POST"] as const)(
    "fails closed on %s if channel metadata cannot be read",
    async (method) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
      for (const [connections, error] of [
        [null, null],
        [[], { message: "database_unavailable" }],
      ] as const) {
        const mock = engine(connections === null ? null : [], error);
        const response = await mock.handler(request(method));
        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({ error: "channel_sync_required" });
        expect(mock.bookingsInserted()).toBe(0);
      }
    },
  );
  it("keeps direct availability open without enabled channels and with a fresh channel", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    for (const connections of [
      [],
      [fresh],
      [{ ...fresh, enabled: false, last_booking_sync_at: null, last_ari_sync_at: null }],
    ]) {
      const mock = engine(connections);
      const response = await mock.handler(request("GET"));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ property: { name: "Glamping" }, units: [] });
    }
  });
});

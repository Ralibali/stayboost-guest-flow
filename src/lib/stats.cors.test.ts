import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseStatsResponse } from "./stats";
import {
  STATS_UPSTREAM_ENDPOINT,
  fetchUpstreamStayBoostStats,
  safeFetchUpstreamStayBoostStats,
} from "./stats.server";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");

const VALID = {
  bookings2026: 156,
  uniqueGuests: 140,
  guestNights: 183,
  bookingValueSek: 308290,
  paidAddonOrders: 33,
  paidAddonRevenueSek: 14322,
  avgPaidAddonSek: 434,
  prearrivalMessages: { sent: 112, total: 156 },
  digitalCheckIns: 142,
  breakfastDeliveries: { done: 43, total: 43 },
  sms: { sent: 89, total: 96 },
  traffic: { pageViews: 22613, sessions: 774, clickEvents: 14657 },
  addonDistribution: [
    { slug: "breakfast", name: "Frukost", orders: 20, units: 50, revenue: 10430 },
  ],
  updatedAt: "2026-09-06T10:00:00.000Z",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("marketing stats CORS hardening", () => {
  it("does not let the browser fetch supabase.co", () => {
    const clientFiles = [
      "src/lib/stats.ts",
      "src/hooks/useStayBoostStats.ts",
      "src/routes/index.tsx",
      "src/components/landing/HeroProofBadge.tsx",
      "src/components/landing/CaseStudy.tsx",
      "src/components/landing/Comparison.tsx",
    ];
    for (const file of clientFiles) {
      const src = read(file);
      expect(src).not.toContain("supabase.co");
      expect(src).not.toContain("STATS_ENDPOINT");
      expect(src).not.toContain("fetchStayBoostStats");
    }
  });

  it("routes the landing hook through the same-origin server function", () => {
    const hook = read("src/hooks/useStayBoostStats.ts");
    const fn = read("src/lib/stats.functions.ts");
    expect(hook).toContain("getStayBoostStats");
    expect(hook).toContain("readCachedStats");
    expect(hook).toContain("retry: 0");
    expect(fn).toContain('createServerFn({ method: "GET" })');
    expect(fn).toContain("safeFetchUpstreamStayBoostStats");
    expect(fn).toContain("./stats.server");
  });

  it("keeps the upstream URL on the server only", () => {
    expect(STATS_UPSTREAM_ENDPOINT).toContain("functions/v1/stayboost-stats");
    const server = read("src/lib/stats.server.ts");
    expect(server).toContain("stayboost-sverige.lovable.app");
  });
});

describe("fetchUpstreamStayBoostStats", () => {
  it("parses a valid upstream payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => VALID,
      })),
    );
    const stats = await fetchUpstreamStayBoostStats();
    expect(stats.bookings2026).toBe(156);
    expect(parseStatsResponse(stats)).not.toBeNull();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      STATS_UPSTREAM_ENDPOINT,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("fails without leaking payload details when HTTP or shape is bad", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({ email: "owner@boende.se" }),
      })),
    );
    await expect(fetchUpstreamStayBoostStats()).rejects.toThrow(/stats_http_503/);
  });

  it("safe wrapper returns ok:false without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network");
      }),
    );
    await expect(safeFetchUpstreamStayBoostStats()).resolves.toEqual({
      ok: false,
      stats: null,
    });
  });

  it("rejects invalid shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ bookings2026: -1 }),
      })),
    );
    await expect(fetchUpstreamStayBoostStats()).rejects.toThrow("stats_invalid_shape");
  });
});

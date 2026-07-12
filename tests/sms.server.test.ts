import { beforeEach, describe, expect, test } from "bun:test";
import {
  normalizeSwedishMobile,
  releaseDemoSms,
  reserveDemoSms,
  resetDemoRateLimitsForTests,
} from "../src/lib/sms.server";

beforeEach(() => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  resetDemoRateLimitsForTests();
});

describe("normalizeSwedishMobile", () => {
  test.each([
    ["070-123 45 67", "+46701234567"],
    ["+46 70 123 45 67", "+46701234567"],
    ["0046701234567", "+46701234567"],
    ["46701234567", "+46701234567"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeSwedishMobile(input)).toBe(expected);
  });

  test.each(["123", "081234567", "+4670123", "070123456789"])("rejects %s", (input) => {
    expect(normalizeSwedishMobile(input)).toBeNull();
  });
});

describe("demo rate limiting", () => {
  test("blocks a recently used number", async () => {
    const first = await reserveDemoSms("192.0.2.1", "+46701234567");
    expect(first.ok).toBe(true);

    const second = await reserveDemoSms("192.0.2.2", "+46701234567");
    expect(second).toEqual({ ok: false, reason: "number_used" });
  });

  test("releases a reservation after a failed send", async () => {
    const first = await reserveDemoSms("192.0.2.1", "+46701234567");
    if (!first.ok) throw new Error("Expected reservation");

    await releaseDemoSms(first.reservation);
    const retry = await reserveDemoSms("192.0.2.1", "+46701234567");
    expect(retry.ok).toBe(true);
  });

  test("limits an IP to three demo messages per day", async () => {
    const ip = "192.0.2.10";
    for (const number of ["+46700000001", "+46700000002", "+46700000003"]) {
      expect((await reserveDemoSms(ip, number)).ok).toBe(true);
    }
    expect(await reserveDemoSms(ip, "+46700000004")).toEqual({
      ok: false,
      reason: "ip_limit",
    });
  });
});

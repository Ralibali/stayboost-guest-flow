import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
});

it("purges inactive caller identifiers when their limit window expires", async () => {
  vi.useFakeTimers();
  const { checkLimits } = await import("./sms.server");
  const ip = "192.0.2.10";
  const phone = "+46700000001";
  const hash = createHash("sha256").update(phone).digest("hex");
  for (let i = 0; i < 5; i++) expect(checkLimits(ip, phone)).toEqual({ ok: true });
  expect(checkLimits(ip, phone).ok).toBe(false);
  const deletion = vi.spyOn(Map.prototype, "delete");
  await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
  expect(deletion).toHaveBeenCalledWith(ip);
  expect(deletion).toHaveBeenCalledWith(hash);
  expect(checkLimits(ip, phone)).toEqual({ ok: true });
  vi.clearAllTimers();
});

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import {
  accessAvailable,
  guestAddon,
  stayPhase,
  stockholmDay,
} from "../../supabase/functions/_shared/guest-stay";
import { redactPrivateAnalytics } from "./analytics";

describe("guest stay information", () => {
  it("uses Stockholm dates at midnight and across winter time", () => {
    expect(stockholmDay(new Date("2026-09-07T22:30:00Z"))).toBe("2026-09-08");
    expect(stockholmDay(new Date("2026-12-01T23:30:00Z"))).toBe("2026-12-02");
  });
  it.each([
    ["2026-09-06", "before", false],
    ["2026-09-07", "before", true],
    ["2026-09-08", "arrival", true],
    ["2026-09-09", "during", true],
    ["2026-09-10", "departure", true],
    ["2026-09-11", "finished", false],
  ])("shows the correct phase and access window on %s", (day, phase, access) => {
    const now = new Date(`${day}T12:00:00Z`);
    expect(stayPhase("2026-09-08", "2026-09-10", "expected", now)).toBe(phase);
    expect(accessAvailable("2026-09-08", "2026-09-10", "expected", now)).toBe(access);
  });
  it("removes access after actual early checkout or no-show", () => {
    const now = new Date("2026-09-09T12:00:00Z");
    expect(stayPhase("2026-09-08", "2026-09-10", "checked_out", now)).toBe("finished");
    for (const status of ["checked_out", "no_show"])
      expect(accessAvailable("2026-09-08", "2026-09-10", status, now)).toBe(false);
  });
  it("exposes only guest delivery fields and flags a changed booking", () => {
    const booking = { unit_id: "unit-a", checkin_date: "2026-09-08", checkout_date: "2026-09-10" };
    const row = {
      id: "task",
      title: "Frukost",
      due_date: "2026-09-09",
      status: "done",
      history: [{ note: "Staff secret" }],
      assigned_to: "Private name",
      details: { ...booking, quantity: 2, unit_price: 100, name_source: "purchase" },
    };
    expect(guestAddon(row, booking)).toEqual({
      id: "task",
      name: "Frukost",
      dueDate: "2026-09-09",
      status: "done",
      quantity: 2,
      nameSource: "purchase",
      contextChanged: false,
    });
    expect(guestAddon(row, { ...booking, unit_id: "unit-b" })?.contextChanged).toBe(true);
    expect(guestAddon({ ...row, details: { quantity: -1 } }, booking)).toBeNull();
  });
  it("excludes guest tokens and private app routes from analytics including referrers", () => {
    const payload = {
      n: "pageview",
      d: "stayboost.se",
      u: "https://stayboost.se/g/0123456789abcdef01234567",
    };
    expect(redactPrivateAnalytics(payload)).toBeNull();
    expect(redactPrivateAnalytics({ ...payload, u: "https://stayboost.se/app/arbete" })).toBeNull();
    expect(
      redactPrivateAnalytics({ ...payload, u: "https://stayboost.se/", r: payload.u })?.r,
    ).toBeNull();
    expect(redactPrivateAnalytics({ ...payload, u: "https://stayboost.se/produkten" })?.u).toBe(
      "https://stayboost.se/produkten",
    );
  });
});
it("enforces booking ownership, immutable purchases, stale writes and completion in Postgres", () => {
  const result = execFileSync(process.execPath, ["scripts/verify-stay-operations.mjs"], {
    encoding: "utf8",
  });
  expect(result).toContain("PASS: 37 stay operations DB checks.");
}, 30000);

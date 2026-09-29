import { describe, expect, it } from "vitest";
import {
  propertyDay,
  propertyMonth,
  propertyDateLabel,
  shiftPropertyDay,
  propertyMidnight,
} from "./property-dates";

describe("property calendar dates in Stockholm", () => {
  it("stores accounting dates at Swedish midnight across seasons and DST transitions", () => {
    expect(propertyMidnight("2026-09-01")).toBe("2026-08-31T22:00:00.000Z");
    expect(propertyMidnight("2026-12-01")).toBe("2026-11-30T23:00:00.000Z");
    expect(propertyMidnight("2026-03-29")).toBe("2026-03-28T23:00:00.000Z");
    expect(propertyMidnight("2026-10-25")).toBe("2026-10-24T22:00:00.000Z");
  });
  it("uses the property's date before UTC midnight, in summer and winter", () => {
    expect(propertyDay(new Date("2026-08-31T22:30:00Z"))).toBe("2026-09-01");
    expect(propertyDay(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
  });
  it("keeps the rendered month, query bounds and label on the same month", () => {
    expect(propertyMonth(0, new Date("2026-09-29T12:00:00Z"))).toEqual({
      monthStart: "2026-09-01",
      monthEnd: "2026-09-30",
      nextMonth: "2026-10-01",
      label: "september 2026",
    });
    expect(propertyMonth(1, new Date("2026-12-29T12:00:00Z")).monthStart).toBe("2027-01-01");
    expect(propertyMonth(-1, new Date("2026-01-29T12:00:00Z")).monthEnd).toBe("2025-12-31");
  });
  it("selects the new month at Swedish midnight and supports leap years", () => {
    expect(propertyMonth(0, new Date("2026-08-31T22:30:00Z")).monthStart).toBe("2026-09-01");
    expect(propertyMonth(0, new Date("2028-02-02T12:00:00Z")).monthEnd).toBe("2028-02-29");
  });
  it("shifts whole calendar dates across daylight-saving changes", () => {
    expect(shiftPropertyDay("2026-03-28", 2)).toBe("2026-03-30");
    expect(shiftPropertyDay("2026-10-24", 2)).toBe("2026-10-26");
    expect(shiftPropertyDay("2026-01-01", -1)).toBe("2025-12-31");
    expect(propertyDateLabel("2026-09-01", { day: "numeric", month: "long" })).toBe("1 september");
  });
});

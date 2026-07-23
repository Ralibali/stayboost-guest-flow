import { describe, expect, it } from "vitest";
import {
  classifyIcalHealth,
  inferChannelType,
  type IcalSource,
} from "./supabase";

function makeSource(overrides: Partial<IcalSource> = {}): IcalSource {
  return {
    id: "s1",
    property_id: "p1",
    unit_id: "u1",
    name: "Sirvoy Sjöbris",
    url: "https://sirvoy.com/feed.ics",
    channel_type: "sirvoy",
    paused: false,
    last_synced_at: null,
    last_status: null,
    last_attempt_at: null,
    last_success_at: null,
    consecutive_failures: 0,
    ...overrides,
  };
}

const NOW = new Date("2026-07-23T12:00:00Z");

describe("classifyIcalHealth", () => {
  it("returnerar 'paused' när källan är pausad, oavsett fel", () => {
    const source = makeSource({ paused: true, consecutive_failures: 5 });
    expect(classifyIcalHealth(source, NOW)).toBe("paused");
  });

  it("är röd vid två eller fler fel i följd", () => {
    expect(classifyIcalHealth(makeSource({ consecutive_failures: 2 }), NOW)).toBe("red");
    expect(classifyIcalHealth(makeSource({ consecutive_failures: 7 }), NOW)).toBe("red");
  });

  it("är gul vid ett enskilt fel", () => {
    const source = makeSource({
      consecutive_failures: 1,
      last_success_at: new Date(NOW.getTime() - 30 * 60_000).toISOString(),
    });
    expect(classifyIcalHealth(source, NOW)).toBe("yellow");
  });

  it("är gul om senaste lyckade synk är äldre än sex timmar", () => {
    const source = makeSource({
      last_success_at: new Date(NOW.getTime() - 7 * 60 * 60_000).toISOString(),
    });
    expect(classifyIcalHealth(source, NOW)).toBe("yellow");
  });

  it("är grön vid färsk lyckad synk och inga fel", () => {
    const source = makeSource({
      last_success_at: new Date(NOW.getTime() - 10 * 60_000).toISOString(),
    });
    expect(classifyIcalHealth(source, NOW)).toBe("green");
  });

  it("faller tillbaka på last_status='ok' + last_synced_at när last_success_at saknas", () => {
    const source = makeSource({
      last_status: "ok (12 event, +0 nya, 0 uppdaterade, 0 avbokade)",
      last_synced_at: new Date(NOW.getTime() - 5 * 60_000).toISOString(),
    });
    expect(classifyIcalHealth(source, NOW)).toBe("green");
  });

  it("är gul när källan aldrig synkats", () => {
    expect(classifyIcalHealth(makeSource(), NOW)).toBe("yellow");
  });
});

describe("inferChannelType", () => {
  it("känner igen Sirvoy, Airbnb, Booking och faller tillbaka på 'other'", () => {
    expect(inferChannelType({ name: "Sirvoy Sjöbris", url: "https://x" })).toBe("sirvoy");
    expect(inferChannelType({ name: "Sommarhus", url: "https://airbnb.com/cal.ics" })).toBe(
      "airbnb",
    );
    expect(inferChannelType({ name: "Booking.com", url: "https://x" })).toBe("booking");
    expect(inferChannelType({ name: "VRBO", url: "https://vrbo.com/cal.ics" })).toBe("other");
  });
});

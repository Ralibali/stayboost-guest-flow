import { readFileSync } from "node:fs";
import { ScriptTarget, transpileModule } from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildIcs,
  closedRuleEvents,
  type IcsClosedRule,
} from "../../supabase/functions/_shared/ics-export";
import { isBlockEvent, parseIcs } from "../../supabase/functions/_shared/ics";
import { calendarExportUrl } from "./ical-export-url";

const UPDATED_AT = "2026-10-05T10:11:12.123456+00:00";
const TOKEN = "a".repeat(24);
const PROPERTY = "11111111-1111-4111-8111-111111111111";
const UNIT = "22222222-2222-4222-8222-222222222222";
const OTHER_UNIT = "33333333-3333-4333-8333-333333333333";
type Row = Record<string, unknown>;
const closure = (patch: Partial<IcsClosedRule> = {}): IcsClosedRule => ({
  id: "winter",
  unit_id: null,
  kind: "closed",
  active: true,
  date_from: "2026-09-30",
  date_to: "2027-05-30",
  updated_at: UPDATED_AT,
  ...patch,
});
const ruleRow = (patch: Row = {}): Row => ({
  ...closure(),
  property_id: PROPERTY,
  name: "Private owner note",
  note: "private@example.test",
  ...patch,
});

function runtime(
  options: {
    rules?: Row[];
    bookings?: Row[];
    unitMissing?: boolean;
    unitError?: boolean;
    failure?: { table: string; from?: number };
    pageLimit?: number;
    countMissing?: boolean;
    changedCountOnPage?: boolean;
  } = {},
) {
  const calls: Array<{ table: string; selected: string; from: number; to: number }> = [];
  const units: Row[] = options.unitMissing
    ? []
    : [
        {
          id: UNIT,
          property_id: PROPERTY,
          name: "Tent",
          ical_feed_token: TOKEN,
          property: { name: "Property" },
        },
      ];
  const tables: Record<string, Row[]> = {
    units,
    bookings: (options.bookings ?? []).map((row) => ({
      property_id: PROPERTY,
      updated_at: UPDATED_AT,
      ...row,
    })),
    ical_export_bookings: (options.bookings ?? []).map((row) => ({
      property_id: PROPERTY,
      updated_at: UPDATED_AT,
      booking_com_origin: false,
      airbnb_origin: false,
      ...row,
    })),
    rate_rules: options.rules ?? [],
  };
  const client = {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let selected = "";
      let from = 0;
      let to = 999;
      let order = "id";
      const execute = () => {
        calls.push({ table, selected, from, to });
        if (
          (table === "units" && options.unitError) ||
          (options.failure?.table === table &&
            (options.failure.from === undefined || options.failure.from === from))
        ) {
          return { data: null, error: { message: "Private database error" }, count: null };
        }
        const rows = tables[table]
          .filter((row) => filters.every((test) => test(row)))
          .sort((a, b) => String(a[order]).localeCompare(String(b[order])));
        const page = rows
          .slice(from, Math.min(to + 1, from + (options.pageLimit ?? 1000)))
          .map((row) =>
            Object.fromEntries(
              selected
                .split(",")
                .map((column) => column.trim())
                .map((column) => [
                  column.includes(":") ? "property" : column,
                  row[column.includes(":") ? "property" : column],
                ]),
            ),
          );
        return {
          data: page,
          error: null,
          count: options.countMissing
            ? null
            : rows.length + (options.changedCountOnPage && from > 0 ? 1 : 0),
        };
      };
      const query = {
        select(value: string, settings?: { count: string }) {
          selected = value;
          if (table !== "units") expect(settings).toEqual({ count: "exact" });
          return query;
        },
        eq(key: string, value: unknown) {
          filters.push((row) => row[key] === value);
          return query;
        },
        gte(key: string, value: string) {
          filters.push((row) => String(row[key]) >= value);
          return query;
        },
        lte(key: string, value: string) {
          filters.push((row) => String(row[key]) <= value);
          return query;
        },
        or(value: string) {
          expect(value).toBe(`unit_id.is.null,unit_id.eq.${UNIT}`);
          filters.push((row) => row.unit_id === null || row.unit_id === UNIT);
          return query;
        },
        order(value: string) {
          order = value;
          return query;
        },
        range(start: number, end: number) {
          from = start;
          to = end;
          return query;
        },
        maybeSingle: async () => {
          const result = execute();
          return { ...result, data: result.data?.[0] ?? null };
        },
        then(resolve: (result: ReturnType<typeof execute>) => unknown) {
          return Promise.resolve(execute()).then(resolve);
        },
      };
      return query;
    },
  };
  const source = readFileSync(
    new URL("../../supabase/functions/ical-export/index.ts", import.meta.url),
    "utf8",
  ).replace(/import[\s\S]*?from\s+["'][^"']+["'];\s*/g, "");
  const code = transpileModule(source, {
    compilerOptions: { target: ScriptTarget.ES2022 },
  }).outputText;
  let handler!: (request: Request) => Promise<Response>;
  new Function("Deno", "createClient", "buildIcs", "closedRuleEvents", code)(
    {
      serve: (callback: typeof handler) => {
        handler = callback;
      },
      env: { get: () => "synthetic" },
    },
    () => client,
    buildIcs,
    closedRuleEvents,
  );
  return {
    calls,
    request: (token = TOKEN, query = "", path = "/ical-export") =>
      handler(new Request(`https://example.test${path}?token=${token}${query}`)),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("RFC 5545 persisted event revision timestamps", () => {
  it.each(["", "&destination=booking", "&destination=airbnb"])(
    "exports one UTC DTSTAMP per event and keeps it stable across repeated requests: %s",
    async (destination) => {
      const booking = {
        id: "direct",
        unit_id: UNIT,
        status: "confirmed",
        checkin_date: "2027-06-17",
        checkout_date: "2027-06-20",
        updated_at: "2026-10-05T01:02:03.987654+02:00",
      };
      const fixture = runtime({ bookings: [booking], rules: [ruleRow()] });
      const first = await (await fixture.request(TOKEN, destination)).text();
      const components = first.split("BEGIN:VEVENT\r\n").slice(1);
      expect(components).toHaveLength(2);
      for (const component of components) {
        expect(component.match(/^DTSTAMP:/gm)).toHaveLength(1);
        expect(component).toMatch(/^DTSTAMP:\d{8}T\d{6}Z\r?$/m);
      }
      expect(components.find((c) => c.includes("UID:direct@stayboost"))).toContain(
        "DTSTAMP:20261004T230203Z\r\n",
      );
      expect(components.find((c) => c.includes("SUMMARY:Closed"))).toContain(
        "DTSTAMP:20261005T101112Z\r\n",
      );
      expect(first).not.toContain("METHOD:");
      vi.setSystemTime(new Date("2026-10-07T16:00:00Z"));
      expect(await (await fixture.request(TOKEN, destination)).text()).toBe(first);

      const changed = runtime({
        bookings: [{ ...booking, updated_at: "2026-10-06T12:30:00Z" }],
        rules: [ruleRow({ updated_at: "2026-10-06T13:00:00Z" })],
      });
      const next = await (await changed.request(TOKEN, destination)).text();
      expect(next).toContain("DTSTAMP:20261006T123000Z\r\n");
      expect(next).toContain("DTSTAMP:20261006T130000Z\r\n");
      expect(parseIcs(next)).toEqual(parseIcs(first)); // Only revision metadata changed.
    },
  );

  it.each([null, undefined, "invalid", "2026-10-05T10:00:00", "2026-13-05T10:00:00Z"])(
    "fails closed when persisted revision time is missing or invalid: %j",
    async (updated_at) => {
      const rule = await runtime({ rules: [ruleRow({ updated_at })] }).request();
      expect(rule.status).toBe(503);
      expect(await rule.text()).toBe("calendar_unavailable");
      const booking = await runtime({
        bookings: [
          {
            id: "direct",
            unit_id: UNIT,
            status: "confirmed",
            checkin_date: "2027-06-17",
            checkout_date: "2027-06-20",
            updated_at,
          },
        ],
      }).request(TOKEN, "&destination=booking");
      expect(booking.status).toBe(503);
      expect(await booking.text()).toBe("calendar_unavailable");
    },
  );
});

describe("actual iCal export includes scoped closures without exposing private source text", () => {
  it("exports winter and selected-unit closures alongside confirmed bookings, excluding other properties/units and non-night restrictions", async () => {
    const fixture = runtime({
      bookings: [
        {
          id: "booking",
          unit_id: UNIT,
          status: "confirmed",
          checkin_date: "2027-06-17",
          checkout_date: "2027-06-20",
          guest_name: "Private Guest",
        },
        {
          id: "cancelled",
          unit_id: UNIT,
          status: "cancelled",
          checkin_date: "2027-06-01",
          checkout_date: "2027-06-02",
        },
        {
          id: "other-booking",
          unit_id: OTHER_UNIT,
          status: "confirmed",
          checkin_date: "2027-06-01",
          checkout_date: "2027-06-02",
        },
      ],
      rules: [
        ruleRow(),
        ruleRow({ id: "this-unit", unit_id: UNIT }),
        ruleRow({ id: "other-unit", unit_id: OTHER_UNIT }),
        ruleRow({ id: "other-property", property_id: "other" }),
        ruleRow({ id: "inactive", active: false }),
        ...["no_arrival", "no_departure", "min_stay", "price_override"].map((kind) =>
          ruleRow({ id: kind, kind }),
        ),
      ],
    });
    const response = await fixture.request();
    const text = await response.text();
    const events = parseIcs(text);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/calendar");
    expect(events).toHaveLength(3);
    expect(events.find((event) => event.uid === "booking@stayboost")).toMatchObject({
      startDate: "2027-06-17",
      endDate: "2027-06-20",
      summary: "Bokad",
    });
    const blocks = events.filter(isBlockEvent);
    expect(blocks).toHaveLength(2);
    expect(
      blocks.every(
        (event) =>
          event.startDate === "2026-09-30" &&
          event.endDate === "2027-05-31" &&
          event.summary === "Closed",
      ),
    ).toBe(true);
    expect(text).not.toMatch(/Private|private@example|other-property|other-unit|inactive/);
    expect(fixture.calls.find((call) => call.table === "rate_rules")?.selected).toBe(
      "id, unit_id, kind, active, date_from, date_to, updated_at",
    );
  });

  it("keeps full overlapping intervals at both export-window boundaries and excludes ranges wholly outside", async () => {
    const fixture = runtime({
      rules: [
        ruleRow({ id: "lower-crossing", date_from: "2026-08-01", date_to: "2026-09-06" }),
        ruleRow({ id: "too-old", date_from: "2026-08-01", date_to: "2026-09-05" }),
        ruleRow({ id: "upper-crossing", date_from: "2027-10-06", date_to: "2027-12-31" }),
        ruleRow({ id: "too-late", date_from: "2027-10-07", date_to: "2027-12-31" }),
      ],
    });
    const events = parseIcs(await (await fixture.request()).text());
    expect(events.map((event) => [event.startDate, event.endDate])).toEqual([
      ["2026-08-01", "2026-09-07"],
      ["2027-10-06", "2028-01-01"],
    ]);
  });

  it("reads every closure page even when the backend returns fewer rows than requested", async () => {
    const fixture = runtime({
      pageLimit: 100,
      rules: Array.from({ length: 1001 }, (_, i) => ruleRow({ id: String(i).padStart(4, "0") })),
    });
    const response = await fixture.request();
    expect(response.status).toBe(200);
    expect(parseIcs(await response.text())).toHaveLength(1001);
    expect(
      fixture.calls.filter((call) => call.table === "rate_rules").map((call) => call.from),
    ).toEqual([0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
  });

  it.each(["bookings", "rate_rules"])(
    "returns 503 instead of an empty or partial successful feed when %s cannot be read",
    async (table) => {
      const fixture = runtime({ rules: [ruleRow()], failure: { table } });
      const response = await fixture.request();
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).toBe("calendar_unavailable");
    },
  );

  it("does not publish the first page when a later page fails", async () => {
    const fixture = runtime({
      pageLimit: 1,
      rules: [ruleRow({ id: "a" }), ruleRow({ id: "b" })],
      failure: { table: "rate_rules", from: 1 },
    });
    expect((await fixture.request()).status).toBe(503);
  });

  it.each([{ countMissing: true }, { changedCountOnPage: true, pageLimit: 1 }])(
    "rejects an unverified or changing page count",
    async (options) => {
      const fixture = runtime({ ...options, rules: [ruleRow({ id: "a" }), ruleRow({ id: "b" })] });
      expect((await fixture.request()).status).toBe(503);
    },
  );

  it("distinguishes an invalid token, missing feed and failed unit read without querying other availability", async () => {
    const invalid = runtime();
    expect((await invalid.request("bad")).status).toBe(400);
    expect(invalid.calls).toEqual([]);
    const missing = runtime({ unitMissing: true });
    expect((await missing.request()).status).toBe(404);
    expect(missing.calls).toHaveLength(1);
    const failed = runtime({ unitError: true });
    expect((await failed.request()).status).toBe(503);
    expect(failed.calls).toHaveLength(1);
  });

  it("still returns an empty feed after complete successful reads", async () => {
    const response = await runtime().request();
    expect(response.status).toBe(200);
    expect(parseIcs(await response.text())).toEqual([]);
  });
});

describe("closed-rule iCal date and identity semantics", () => {
  it.each([
    ["2028-02-29", "2028-03-01"],
    ["2026-03-29", "2026-03-30"],
    ["2026-10-25", "2026-10-26"],
    ["2026-12-31", "2027-01-01"],
  ])("exports a one-night closure on %s through exclusive %s", (start, end) => {
    expect(
      closedRuleEvents([closure({ date_from: start, date_to: start })], UNIT)[0],
    ).toMatchObject({ startDate: start, endDate: end });
  });

  it("keeps stable identities through date changes, deduplicates repeated rows and scopes property-rule identities per unit", () => {
    const first = closedRuleEvents([closure(), closure()], UNIT);
    expect(first).toHaveLength(1);
    const updated = closedRuleEvents([closure({ date_to: "2027-06-02" })], UNIT);
    expect(updated[0].uid).toBe(first[0].uid);
    expect(updated[0].endDate).toBe("2027-06-03");
    expect(closedRuleEvents([closure()], OTHER_UNIT)[0].uid).not.toBe(first[0].uid);
    expect(() => closedRuleEvents([closure(), closure({ date_to: "2027-06-02" })], UNIT)).toThrow(
      "conflicting_closed_range",
    );
  });

  it("cannot turn arrival/departure restrictions or an inactive/other-unit rule into whole closed nights", () => {
    expect(
      closedRuleEvents(
        [
          closure({ kind: "no_arrival" }),
          closure({ kind: "no_departure" }),
          closure({ active: false }),
          closure({ unit_id: OTHER_UNIT }),
        ],
        UNIT,
      ),
    ).toEqual([]);
  });

  it.each([
    closure({ date_to: "2026-02-30" }),
    closure({ date_from: "bad" }),
    closure({ date_to: "2026-09-29" }),
    closure({ date_to: "9999-12-31" }),
  ])(
    "rejects an invalid or unrepresentable range rather than emitting a misleading event",
    (rule) => {
      expect(() => closedRuleEvents([rule], UNIT)).toThrow("invalid_closed_range");
    },
  );
});

describe.each([
  { destination: "booking" as const, origin: "booking_com_origin", otherOrigin: "airbnb_origin" },
  { destination: "airbnb" as const, origin: "airbnb_origin", otherOrigin: "booking_com_origin" },
])("$destination destination export", ({ destination, origin, otherOrigin }) => {
  const booking = (id: string, patch: Row = {}): Row => ({
    id,
    unit_id: UNIT,
    status: "confirmed",
    checkin_date: "2027-06-17",
    checkout_date: "2027-06-20",
    ...patch,
  });
  it("does not echo matching channel imports or Sirvoy holds, but retains direct, other-channel and unknown-origin blocks plus closures", async () => {
    const fixture = runtime({
      bookings: [
        booking("booking-import", { [origin]: true }),
        booking("sirvoy-original", { [origin]: true }),
        booking("website"),
        booking("other-channel", { [otherOrigin]: true }),
        booking("unknown", { guest_name: "Airbnb Booking.com", source: "manual" }),
        booking("cancelled", { status: "cancelled" }),
        booking("other-tent", { unit_id: OTHER_UNIT }),
        booking("other-property", { property_id: "other" }),
      ],
      rules: [ruleRow()],
    });
    const response = await fixture.request(TOKEN, `&destination=${destination}`);
    expect(response.status).toBe(200);
    const body = await response.text();
    const events = parseIcs(body);
    expect(events.map((e) => e.uid).sort()).toEqual(
      [
        "website@stayboost",
        "other-channel@stayboost",
        "unknown@stayboost",
        `closed-winter-${UNIT}@stayboost`,
      ].sort(),
    );
    expect(body).not.toMatch(
      /Airbnb|Booking\.com|sirvoy|guest|booking-import|other-tent|other-property/i,
    );
    expect(fixture.calls.some((c) => c.table === "bookings")).toBe(false);
    expect(fixture.calls.find((c) => c.table === "ical_export_bookings")?.selected).toBe(
      "id, checkin_date, checkout_date, updated_at",
    );
    // Existing generic subscribers retain their original complete feed.
    const generic = parseIcs(await (await fixture.request()).text());
    expect(generic.some((e) => e.uid === "booking-import@stayboost")).toBe(true);
    expect(generic.some((e) => e.uid === "sirvoy-original@stayboost")).toBe(true);
  });
  it("keeps a direct booking UID stable when dates change and removes it on cancellation without reflecting a cancelled OTA reservation", async () => {
    const read = async (rows: Row[]) =>
      parseIcs(
        await (
          await runtime({ bookings: rows }).request(TOKEN, `&destination=${destination}`)
        ).text(),
      );
    const initial = await read([booking("website"), booking("ota", { [origin]: true })]);
    const moved = await read([
      booking("website", { checkin_date: "2027-06-21", checkout_date: "2027-06-24" }),
      booking("ota", { [origin]: true, status: "cancelled" }),
    ]);
    expect(initial).toHaveLength(1);
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({
      uid: initial[0].uid,
      startDate: "2027-06-21",
      endDate: "2027-06-24",
    });
    expect(
      await read([
        booking("website", { status: "cancelled" }),
        booking("ota", { [origin]: true, status: "cancelled" }),
      ]),
    ).toEqual([]);
  });
  it("reads all destination-filtered pages and fails closed if the origin view is unavailable", async () => {
    const rows = Array.from({ length: 1001 }, (_, i) =>
      booking(`b${String(i).padStart(4, "0")}`, { [origin]: i % 2 === 0 }),
    );
    const fixture = runtime({ bookings: rows, pageLimit: 100 });
    const response = await fixture.request(TOKEN, `&destination=${destination}`);
    expect(response.status).toBe(200);
    expect(parseIcs(await response.text())).toHaveLength(500);
    expect(
      fixture.calls.filter((c) => c.table === "ical_export_bookings").map((c) => c.from),
    ).toEqual([0, 100, 200, 300, 400]);
    const failed = await runtime({ failure: { table: "ical_export_bookings" } }).request(
      TOKEN,
      `&destination=${destination}`,
    );
    expect(failed.status).toBe(503);
    expect(await failed.text()).toBe("calendar_unavailable");
  });
  it.each([
    "&destination=",
    "&destination=unknown",
    "&destination=booking&destination=booking",
    "&destination=airbnb&destination=airbnb",
    "&destination=booking&destination=airbnb",
  ])("rejects ambiguous or unsupported destination %s before database access", async (query) => {
    const fixture = runtime();
    expect((await fixture.request(TOKEN, query)).status).toBe(400);
    expect(fixture.calls).toEqual([]);
  });
  it("requires the same private unit token for the destination feed", async () => {
    const fixture = runtime();
    expect((await fixture.request("bad", `&destination=${destination}`)).status).toBe(400);
    expect((await fixture.request("b".repeat(24), `&destination=${destination}`)).status).toBe(404);
    expect(fixture.calls.every((c) => c.table === "units")).toBe(true);
  });
  it("serves the owner-generated calendar.ics path with the same token, unit and destination guards", async () => {
    const url = new URL(calendarExportUrl("https://example.test", TOKEN, "airbnb"));
    const fixture = runtime({
      bookings: [booking("website"), booking("airbnb", { airbnb_origin: true })],
    });
    const response = await fixture.request(
      url.searchParams.get("token")!,
      `&destination=${url.searchParams.get("destination")}`,
      url.pathname,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/calendar");
    expect(parseIcs(await response.text()).map((e) => e.uid)).toEqual(["website@stayboost"]);
    expect((await fixture.request("bad", "&destination=airbnb", url.pathname)).status).toBe(400);
  });
  it("builds a channel-specific URL while preserving existing generic and Booking.com URLs", () => {
    expect(calendarExportUrl("https://example.test/", TOKEN)).toBe(
      `https://example.test/functions/v1/ical-export?token=${TOKEN}`,
    );
    expect(calendarExportUrl("https://example.test", TOKEN, "booking")).toBe(
      `https://example.test/functions/v1/ical-export?token=${TOKEN}&destination=booking`,
    );
    expect(calendarExportUrl("https://example.test/", TOKEN, "airbnb")).toBe(
      `https://example.test/functions/v1/ical-export/calendar.ics?token=${TOKEN}&destination=airbnb`,
    );
    expect(calendarExportUrl("", TOKEN, "booking")).toBe("");
    expect(calendarExportUrl("https://example.test", "", "booking")).toBe("");
  });
});

import { readFileSync } from "node:fs";
import { ScriptTarget, transpileModule } from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildIcs,
  closedRuleEvents,
  type IcsClosedRule,
} from "../../supabase/functions/_shared/ics-export";
import { isBlockEvent, parseIcs } from "../../supabase/functions/_shared/ics";

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
    bookings: options.bookings ?? [],
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
    request: (token = TOKEN) =>
      handler(new Request(`https://example.test/ical-export?token=${token}`)),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

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
      "id, unit_id, kind, active, date_from, date_to",
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

  it("still returns a valid empty calendar after complete successful reads", async () => {
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

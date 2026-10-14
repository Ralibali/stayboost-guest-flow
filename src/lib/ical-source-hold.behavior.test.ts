import { readFileSync } from "node:fs";
import { ScriptTarget, transpileModule } from "typescript";
import { describe, expect, it } from "vitest";
import { parseIcs, guestNameFrom, isBlockEvent } from "../../supabase/functions/_shared/ics";
import {
  classifyDisappearancePolicy,
  nextMissingObservation,
} from "../../supabase/functions/_shared/ical-reconciliation";

type Row = Record<string, unknown>;
function runtime(
  options: {
    sourceLinked?: boolean;
    event?: "missing" | "active" | "cancelled";
    httpError?: boolean;
  } = {},
) {
  const hold: Row = {
    id: "hold",
    ical_source_id: "feed",
    ical_uid: "native-uid",
    source_accommodation_record_id: options.sourceLinked === false ? null : "immutable-record",
    guest_name: "Private source guest",
    checkin_date: "2099-06-01",
    checkout_date: "2099-06-03",
    status: "confirmed",
    ical_missing_since: "2020-01-01T00:00:00Z",
    ical_missing_count: 100,
    payment_amount: null,
    payment_status: "none",
    communications_enabled: false,
  };
  const other: Row = {
    id: "other",
    ical_source_id: "feed",
    ical_uid: "other-uid",
    source_accommodation_record_id: null,
    checkin_date: "2099-07-01",
    checkout_date: "2099-07-03",
    status: "confirmed",
  };
  const tables: Record<string, Row[]> = {
    bookings: [hold, other],
    ical_sources: [
      {
        id: "feed",
        unit_id: "unit",
        property_id: "property",
        url: "https://calendar.example.test/native.ics",
        channel_type: "booking",
        paused: false,
        consecutive_failures: 0,
        name: "Booking.com",
      },
    ],
  };
  const writes: Array<{ table: string; patch: Row }> = [];
  const client = {
    async rpc(name: string, args: Row) {
      if (name === "claim_ical_sync")
        return {
          data: { token: "private-test-claim", source: tables.ical_sources[0] },
          error: null,
        };
      if (name === "finish_ical_sync") return { data: true, error: null };
      if (name === "write_ical_sync_booking") {
        const patch = args.p_patch as Row;
        writes.push({ table: "bookings", patch: { ...patch } });
        if (args.p_booking_id)
          Object.assign(tables.bookings.find((b) => b.id === args.p_booking_id)!, patch);
        else tables.bookings.push({ id: "new", ...patch, ical_uid: args.p_uid });
        return { data: args.p_booking_id ?? "new", error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let selected = "";
      let patch: Row | undefined;
      let inserted: Row | undefined;
      const execute = () => {
        const rows = tables[table].filter((row) => filters.every((f) => f(row)));
        if (patch) {
          writes.push({ table, patch: { ...patch } });
          rows.forEach((row) => Object.assign(row, patch));
        }
        if (inserted) {
          writes.push({ table, patch: { ...inserted } });
          tables[table].push(inserted);
        }
        return {
          data: rows.map((row) =>
            selected
              ? Object.fromEntries(
                  selected
                    .split(",")
                    .map((v) => v.trim())
                    .map((k) => [k, row[k]]),
                )
              : { ...row },
          ),
          error: null,
        };
      };
      const query = {
        select(value: string) {
          selected = value;
          return query;
        },
        eq(k: string, v: unknown) {
          filters.push((row) => row[k] === v);
          return query;
        },
        lt(k: string, v: string) {
          filters.push((row) => String(row[k]) < v);
          return query;
        },
        gt(k: string, v: string) {
          filters.push((row) => String(row[k]) > v);
          return query;
        },
        limit() {
          return query;
        },
        update(value: Row) {
          patch = value;
          return query;
        },
        insert(value: Row) {
          inserted = value;
          return query;
        },
        then(resolve: (v: ReturnType<typeof execute>) => unknown) {
          return Promise.resolve(execute()).then(resolve);
        },
      };
      return query;
    },
  };
  const blocks = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:other-uid",
    "DTSTART;VALUE=DATE:20990701",
    "DTEND;VALUE=DATE:20990703",
    "SUMMARY:Reserved",
    "END:VEVENT",
  ];
  if (options.event && options.event !== "missing")
    blocks.push(
      "BEGIN:VEVENT",
      "UID:native-uid",
      "DTSTART;VALUE=DATE:20990601",
      `DTEND;VALUE=DATE:${options.event === "active" ? "20990604" : "20990603"}`,
      `STATUS:${options.event === "cancelled" ? "CANCELLED" : "CONFIRMED"}`,
      "SUMMARY:Reserved",
      "END:VEVENT",
    );
  blocks.push("END:VCALENDAR");
  const fetch = async (url: string) => {
    expect(url).toBe("https://calendar.example.test/native.ics");
    return new Response(options.httpError ? "error" : blocks.join("\r\n"), {
      status: options.httpError ? 500 : 200,
    });
  };
  const source = readFileSync(
    new URL("../../supabase/functions/ical-sync/index.ts", import.meta.url),
    "utf8",
  ).replace(/import[\s\S]*?from\s+["'][^"']+["'];\s*/g, "");
  const code = transpileModule(source, {
    compilerOptions: { target: ScriptTarget.ES2022 },
  }).outputText;
  let handler!: (request: Request) => Promise<Response>;
  new Function(
    "Deno",
    "createClient",
    "isCronAuthorized",
    "parseIcs",
    "guestNameFrom",
    "isBlockEvent",
    "classifyDisappearancePolicy",
    "nextMissingObservation",
    "fetch",
    code,
  )(
    {
      serve: (value: typeof handler) => {
        handler = value;
      },
      env: { get: () => "synthetic" },
    },
    () => client,
    async () => true,
    parseIcs,
    guestNameFrom,
    isBlockEvent,
    classifyDisappearancePolicy,
    nextMissingObservation,
    fetch,
  );
  return {
    hold,
    writes,
    run: async () =>
      (await handler(new Request("https://example.test/ical-sync", { method: "POST" }))).json(),
  };
}

describe("actual iCal handler preserves adopted source holds", () => {
  it("does not cancel a source-linked UID missing across arbitrarily many successful nonempty fetches", async () => {
    const f = runtime();
    const result = await f.run();
    expect(result.results[0]).toMatchObject({ ok: true, cancelled: 0, protectedMissing: 1 });
    expect(f.hold.status).toBe("confirmed");
    expect(f.hold.ical_missing_count).toBe(101);
    expect(f.writes.filter((w) => w.table === "bookings")).toEqual([
      {
        table: "bookings",
        patch: { ical_missing_since: "2020-01-01T00:00:00Z", ical_missing_count: 101 },
      },
    ]);
  });
  it("keeps the established disappearance policy for ordinary imported bookings", async () => {
    const f = runtime({ sourceLinked: false });
    await f.run();
    expect(f.hold.status).toBe("cancelled");
    expect(f.hold.ical_cancel_reason).toBe("disappearance");
  });
  it("applies explicit cancellation only to its already bound UID without touching payment/source metadata", async () => {
    const f = runtime({ event: "cancelled" });
    const result = await f.run();
    expect(result.results[0]).toMatchObject({ ok: true, cancelled: 1 });
    expect(f.hold).toMatchObject({
      status: "cancelled",
      ical_cancel_reason: "explicit",
      source_accommodation_record_id: "immutable-record",
      payment_amount: null,
      payment_status: "none",
      communications_enabled: false,
    });
    expect(
      f.writes
        .filter((w) => w.table === "bookings")
        .every(
          (w) =>
            !("payment_amount" in w.patch) &&
            !("source_accommodation_record_id" in w.patch) &&
            !("communications_enabled" in w.patch),
        ),
    ).toBe(true);
  });
  it("updates the bound row and clears missing evidence when the UID reappears, without inserting a duplicate", async () => {
    const f = runtime({ event: "active" });
    const result = await f.run();
    expect(result.results[0]).toMatchObject({ ok: true, created: 0, updated: 1, cancelled: 0 });
    expect(f.hold).toMatchObject({
      checkout_date: "2099-06-04",
      ical_missing_count: 0,
      ical_missing_since: null,
      status: "confirmed",
      payment_amount: null,
      communications_enabled: false,
    });
  });
  it("retains the hold unchanged when the feed cannot be read", async () => {
    const f = runtime({ httpError: true });
    const before = { ...f.hold };
    const result = await f.run();
    expect(result.results[0].ok).toBe(false);
    expect(f.hold).toEqual(before);
    expect(f.writes.filter((w) => w.table === "bookings")).toEqual([]);
  });
});

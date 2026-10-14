import { readFileSync } from "node:fs";
import { ScriptTarget, transpileModule } from "typescript";
import { expect, it } from "vitest";
import { parseIcs, guestNameFrom, isBlockEvent } from "../../supabase/functions/_shared/ics";
import {
  classifyDisappearancePolicy,
  nextMissingObservation,
} from "../../supabase/functions/_shared/ical-reconciliation";
type Row = Record<string, unknown>;
const TOKEN = "private-claim-never-return";
const event = (uid: string, extra = "") =>
  `BEGIN:VEVENT\nUID:${uid}\nDTSTART;VALUE=DATE:20990101\nDTEND;VALUE=DATE:20990103\nSUMMARY:Reserved\n${extra}END:VEVENT`;
const calendar = (...events: string[]) => `BEGIN:VCALENDAR\n${events.join("\n")}\nEND:VCALENDAR`;
function runtime(
  options: {
    claimError?: boolean;
    throwRpc?: string;
    busy?: boolean;
    failWrite?: number;
    failFinish?: boolean;
    throwFinish?: boolean;
    priorSuccess?: boolean;
    abandoned?: boolean;
    status?: number;
    calendar?: string;
    owner?: string;
    unauthorized?: boolean;
  } = {},
) {
  const feed: Row = {
    id: "feed",
    property_id: "property",
    unit_id: "unit",
    name: "Calendar",
    url: "https://calendar.example.test/private-feed",
    channel_type: "booking",
    paused: false,
    http_etag: options.priorSuccess ? "prior-etag" : null,
    http_last_modified: null,
    last_success_at: options.priorSuccess ? "previous-success" : null,
  };
  const bookings: Row[] = [];
  const calls: Array<{ name: string; args: Row }> = [];
  const network: Array<{ url: string; headers: Record<string, string> }> = [];
  let writes = 0;
  const client = {
    auth: {
      getUser: async () => ({
        data: { user: options.unauthorized ? null : { id: options.owner } },
        error: null,
      }),
    },
    async rpc(name: string, args: Row) {
      calls.push({ name, args });
      if (name === options.throwRpc && (name !== "finish_ical_sync" || args.p_success))
        throw new Error(TOKEN);
      if (name === "claim_ical_sync") {
        if (options.claimError) return { data: null, error: { message: TOKEN } };
        if (options.busy) return { data: null, error: null };
        feed.last_success_at = null;
        if (options.abandoned) feed.http_etag = null;
        return { data: { token: TOKEN, source: { ...feed } }, error: null };
      }
      expect(args.p_token).toBe(TOKEN);
      if (name === "write_ical_sync_booking") {
        writes++;
        if (writes === options.failWrite) return { data: null, error: { message: TOKEN } };
        const id = `booking-${writes}`;
        bookings.push({
          id,
          ical_source_id: "feed",
          ical_uid: args.p_uid,
          ...(args.p_patch as Row),
        });
        return { data: id, error: null };
      }
      if (name === "finish_ical_sync") {
        if (options.throwFinish) throw new Error(TOKEN);
        if (options.failFinish) return { data: null, error: { message: TOKEN } };
        feed.last_success_at = args.p_success ? "new-success" : null;
        feed.http_etag = args.p_success ? args.p_etag : null;
        return { data: true, error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      const query = {
        select() {
          return query;
        },
        eq(k: string, v: unknown) {
          if (!k.includes(".")) filters.push((r) => r[k] === v);
          return query;
        },
        lt(k: string, v: string) {
          filters.push((r) => String(r[k]) < v);
          return query;
        },
        gt(k: string, v: string) {
          filters.push((r) => String(r[k]) > v);
          return query;
        },
        limit() {
          return query;
        },
        update() {
          throw new Error("Unfenced update");
        },
        insert() {
          throw new Error("Unfenced insert");
        },
        then(resolve: (value: unknown) => unknown) {
          const rows = (table === "ical_sources" ? [feed] : bookings).filter((r) =>
            filters.every((f) => f(r)),
          );
          return Promise.resolve({ data: rows.map((r) => ({ ...r })), error: null }).then(resolve);
        },
      };
      return query;
    },
  };
  const fetch = async (url: string, init: { headers: Record<string, string> }) => {
    expect(feed.last_success_at).toBeNull();
    expect(calls[0]?.name).toBe("claim_ical_sync");
    network.push({ url, headers: init.headers });
    return new Response(
      options.status === 304
        ? null
        : (options.calendar ?? calendar(event("first"), event("second"))),
      { status: options.status ?? 200, headers: { etag: "new-etag" } },
    );
  };
  const code = transpileModule(
    readFileSync(
      new URL("../../supabase/functions/ical-sync/index.ts", import.meta.url),
      "utf8",
    ).replace(/import[\s\S]*?from\s+["'][^"']+["'];\s*/g, ""),
    { compilerOptions: { target: ScriptTarget.ES2022 } },
  ).outputText;
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
      serve: (fn: typeof handler) => {
        handler = fn;
      },
      env: { get: () => "private-server-key" },
    },
    () => client,
    async () => !options.owner && !options.unauthorized,
    parseIcs,
    guestNameFrom,
    isBlockEvent,
    classifyDisappearancePolicy,
    nextMissingObservation,
    fetch,
  );
  return {
    feed,
    bookings,
    calls,
    network,
    run: async () => {
      const response = await handler(
        new Request("https://example.test/ical-sync", {
          method: "POST",
          headers:
            options.owner || options.unauthorized ? { Authorization: "Bearer fake-owner" } : {},
        }),
      );
      const body = await response.json();
      expect(JSON.stringify(body)).not.toContain(TOKEN);
      expect(JSON.stringify(body)).not.toContain("private-server-key");
      return { status: response.status, body };
    },
  };
}
it("invalidates before fetch, writes all events through the fence, then publishes success", async () => {
  const f = runtime({ priorSuccess: true });
  const { body } = await f.run();
  expect(body.results[0]).toMatchObject({ ok: true, created: 2 });
  expect(f.calls.map((c) => c.name)).toEqual([
    "claim_ical_sync",
    "write_ical_sync_booking",
    "write_ical_sync_booking",
    "finish_ical_sync",
  ]);
  expect(f.feed.last_success_at).toBe("new-success");
});
it("does no network or event write when claim acquisition fails", async () => {
  const f = runtime({ claimError: true });
  expect((await f.run()).body.results[0].ok).toBe(false);
  expect(f.network).toEqual([]);
  expect(f.bookings).toEqual([]);
});
it("skips an already running source without overwriting its health", async () => {
  const f = runtime({ busy: true, priorSuccess: true });
  expect((await f.run()).body.results[0].skipped).toBe(true);
  expect(f.network).toEqual([]);
  expect(f.calls).toHaveLength(1);
  expect(f.feed.last_success_at).toBe("previous-success");
});
it.each([1, 2])("does not publish success when event write %s fails", async (failWrite) => {
  const f = runtime({ failWrite, priorSuccess: true });
  expect((await f.run()).body.results[0].ok).toBe(false);
  expect(f.bookings).toHaveLength(failWrite - 1);
  expect(f.feed.last_success_at).toBeNull();
  expect(f.calls.filter((c) => c.name === "finish_ical_sync").map((c) => c.args.p_success)).toEqual(
    [false],
  );
});
it.each(["failFinish", "throwFinish"] as const)(
  "cannot leave stale success when both result writes fail: %s",
  async (key) => {
    const f = runtime({ [key]: true, priorSuccess: true });
    expect((await f.run()).body.results[0].ok).toBe(false);
    expect(f.bookings).toHaveLength(2);
    expect(f.feed.last_success_at).toBeNull();
    expect(
      f.calls.filter((c) => c.name === "finish_ical_sync").map((c) => c.args.p_success),
    ).toEqual([true, false]);
  },
);
it("allows 304 only with validators from the previous complete attempt", async () => {
  const f = runtime({ priorSuccess: true, status: 304 });
  expect((await f.run()).body.results[0]).toMatchObject({ ok: true, notModified: true });
  expect(f.network[0].headers["If-None-Match"]).toBe("prior-etag");
  expect(f.bookings).toEqual([]);
});
it("forces a full fetch and rejects unsolicited 304 after an abandoned import", async () => {
  const f = runtime({ priorSuccess: true, abandoned: true, status: 304 });
  expect((await f.run()).body.results[0].ok).toBe(false);
  expect(f.network[0].headers).not.toHaveProperty("If-None-Match");
  expect(f.feed.last_success_at).toBeNull();
});
it("rejects mixed valid/incomplete events before importing the otherwise valid subset", async () => {
  const f = runtime({ calendar: calendar(event("valid"), "BEGIN:VEVENT\nUID:broken\nEND:VEVENT") });
  expect((await f.run()).body.results[0].ok).toBe(false);
  expect(f.bookings).toEqual([]);
  expect(f.feed.last_success_at).toBeNull();
});
it.each([calendar(), calendar(event("block").replace("SUMMARY:Reserved", "SUMMARY:Closed"))])(
  "retains valid empty and block-only calendar behavior",
  async (body) => {
    const f = runtime({ calendar: body });
    expect((await f.run()).body.results[0]).toMatchObject({ ok: true, created: 0 });
    expect(f.bookings).toEqual([]);
  },
);
it("preserves JWT checks and sends owner scope to the atomic claim", async () => {
  const bad = runtime({ unauthorized: true });
  expect((await bad.run()).status).toBe(401);
  expect(bad.calls).toEqual([]);
  expect(bad.network).toEqual([]);
  const good = runtime({ owner: "owner-id" });
  await good.run();
  expect(good.calls[0].args.p_owner_id).toBe("owner-id");
});

it.each(["claim_ical_sync", "write_ical_sync_booking", "finish_ical_sync"])(
  "sanitizes rejected %s promises even when error-health succeeds",
  async (throwRpc) => {
    const f = runtime({ throwRpc, priorSuccess: true });
    expect((await f.run()).body.results[0].ok).toBe(false);
    if (throwRpc !== "claim_ical_sync") expect(f.feed.last_success_at).toBeNull();
  },
);

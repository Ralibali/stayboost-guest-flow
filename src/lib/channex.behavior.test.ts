import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ScriptTarget, transpileModule } from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildChannexAri,
  ChannexClient,
  ChannexError,
  channexSecret,
  channexKeyForConnection,
  receiveChannexRevision,
  sanitizeChannexRevision,
  validChannexId,
  webhookSecretValid,
  type ChannelConnection,
  type ChannelUnit,
  type ChannexRevisionStore,
} from "../../supabase/functions/_shared/channex";
import {
  channelError,
  channelFailureCode,
  channexClient,
  pullChannelBookings,
  revisionStore,
  syncChannelAri,
} from "../../supabase/functions/_shared/channex-runtime";
import type { RateRule } from "../../supabase/functions/_shared/rate-rules";

const PROPERTY = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ROOM = "33333333-3333-4333-8333-333333333333";
const RATE = "44444444-4444-4444-8444-444444444444";
const REVISION = "55555555-5555-4555-8555-555555555555";
const BOOKING = "66666666-6666-4666-8666-666666666666";
const WEBHOOK = "77777777-7777-4777-8777-777777777777";
const connection: ChannelConnection = {
  id: OTHER,
  property_id: "local-property",
  external_property_id: PROPERTY,
  environment: "staging",
  enabled: true,
  fees_configured: true,
};
const unit: ChannelUnit = {
  id: "tent",
  property_id: "local-property",
  active: true,
  base_price: 1000,
  min_stay: 2,
  max_guests: 4,
  weekend_pct: 20,
  cleaning_fee: 0,
  monthly_mult: Array(12).fill(100),
};
const mapping = { unit_id: "tent", room_type_id: ROOM, rate_plan_id: RATE };
const input = {
  connection,
  units: [unit],
  mappings: [mapping],
  bookings: [],
  rules: [],
  from: "2026-10-02",
  to: "2026-10-05",
  maxStay: 30,
};
const revision = {
  id: REVISION,
  attributes: {
    property_id: PROPERTY,
    booking_id: BOOKING,
    inserted_at: "2026-09-29T12:00:00",
    status: "new",
    currency: "SEK",
    amount: "2400.00",
    customer: {
      name: "Ada",
      surname: "Lovelace",
      mail: "ada@example.test",
      address: "secret address",
    },
    rooms: [
      {
        room_type_id: ROOM,
        rate_plan_id: RATE,
        checkin_date: "2026-10-02",
        checkout_date: "2026-10-04",
        amount: "2400.00",
        occupancy: { adults: 2, children: 1, infants: 0, ages: [8] },
        guarantee: { cvv: "123" },
      },
    ],
    guarantee: { card_number: "secret-card", cvv: "123" },
    meta: { secret: "secret-meta" },
  },
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const rule = (kind: RateRule["kind"], extra: Partial<RateRule> = {}): RateRule => ({
  id: kind,
  kind,
  unit_id: null,
  date_from: "2026-10-02",
  date_to: "2026-10-02",
  fixed_price: null,
  pct_delta: null,
  min_stay: null,
  priority: 0,
  active: true,
  ...extra,
});

describe("channel inventory and exact rates", () => {
  it("blocks confirmed holds and opens checkout day without opening cancelled stays", () => {
    const ari = buildChannexAri({
      ...input,
      bookings: [
        {
          unit_id: "tent",
          status: "confirmed",
          checkin_date: "2026-10-02",
          checkout_date: "2026-10-03",
        },
        {
          unit_id: "tent",
          status: "cancelled",
          checkin_date: "2026-10-03",
          checkout_date: "2026-10-05",
        },
      ],
    });
    expect(ari.availability.map((day) => day.availability)).toEqual([0, 1, 1]);
    expect(ari.restrictions.map((day) => day.rate)).toEqual(["1200.00", "1200.00", "1000.00"]);
  });
  it("transmits closures, arrival/departure restrictions and through-stay minimums", () => {
    const ari = buildChannexAri({
      ...input,
      rules: [
        rule("closed"),
        rule("no_arrival"),
        rule("no_departure"),
        rule("min_stay", { min_stay: 4 }),
      ],
    });
    expect(ari.availability[0].availability).toBe(0);
    expect(ari.restrictions[0]).toMatchObject({
      stop_sell: true,
      closed_to_arrival: true,
      closed_to_departure: true,
      min_stay_through: 4,
      min_stay_arrival: 1,
    });
  });
  it("uses canonical occupancy pricing and overrides for one through four adults", () => {
    const ari = buildChannexAri({
      ...input,
      units: [
        {
          ...unit,
          party_pricing_enabled: true,
          adult_prices: [700, 1000, 1400, 1800],
          child_price_per_night: 150,
        },
      ],
      rules: [rule("price_override", { adult_prices: [800, 1100, 1500, 2000] })],
    });
    expect(ari.restrictions[0].rate).toBeUndefined();
    expect(ari.restrictions[0].rates).toEqual([
      { occupancy: 1, rate: "800.00" },
      { occupancy: 2, rate: "1100.00" },
      { occupancy: 3, rate: "1500.00" },
      { occupancy: 4, rate: "2000.00" },
    ]);
    expect(ari.restrictions[1].rates?.map((rate) => rate.rate)).toEqual([
      "840.00",
      "1200.00",
      "1680.00",
      "2160.00",
    ]);
  });
  it("closes remote inventory beyond the Stayboost booking horizon", () => {
    const ari = buildChannexAri({ ...input, openThrough: "2026-10-03" });
    expect(ari.availability.map((day) => day.availability)).toEqual([1, 0, 0]);
    expect(ari.restrictions.map((day) => day.stop_sell)).toEqual([false, true, true]);
  });
  it.each([
    [{ unresolvedRevisions: true }, "channel_mapping_required"],
    [{ connection: { ...connection, enabled: false } }, "connection_disabled"],
    [{ units: [{ ...unit, property_id: "foreign-owner" }] }, "channel_unit_mapping_mismatch"],
    [{ mappings: [mapping, mapping] }, "channel_unit_mapping_mismatch"],
    [{ units: [unit, { ...unit, id: "another-active-tent" }] }, "channel_mapping_incomplete"],
    [
      {
        connection: { ...connection, fees_configured: false },
        units: [{ ...unit, cleaning_fee: 250 }],
      },
      "channel_fees_not_configured",
    ],
    [
      {
        connection: { ...connection, fees_configured: false },
        units: [{ ...unit, party_pricing_enabled: true }],
      },
      "channel_child_policy_not_verified",
    ],
    [{ units: [{ ...unit, base_price: 0 }] }, "channel_positive_rate_required"],
  ])("fails closed for invalid inventory configuration %j", (patch, error) => {
    expect(() => buildChannexAri({ ...input, ...patch })).toThrow(error);
  });
});

function verificationTransport(
  party = false,
  patch: { room?: object; rate?: object; property?: object; roomOwner?: string } = {},
) {
  return vi.fn<typeof fetch>(async (url) => {
    const path = new URL(String(url)).pathname;
    if (path.includes("/properties/"))
      return reply({
        data: {
          id: PROPERTY,
          attributes: {
            currency: "SEK",
            title: "Bergs",
            settings: { min_stay_type: "both", state_length: 500 },
            ...patch.property,
          },
        },
      });
    if (path.includes("/room_types/"))
      return reply({
        data: {
          id: ROOM,
          attributes: {
            count_of_rooms: 1,
            occ_adults: 4,
            occ_children: 0,
            occ_infants: 0,
            ...patch.room,
          },
          relationships: { property: { data: { id: patch.roomOwner ?? PROPERTY } } },
        },
      });
    return reply({
      data: {
        id: RATE,
        attributes: {
          currency: "SEK",
          sell_mode: party ? "per_person" : "per_room",
          rate_mode: "manual",
          children_fee: party ? "150.00" : "0.00",
          infant_fee: "0.00",
          options: party
            ? [1, 2, 3, 4].map((occupancy) => ({ occupancy, is_primary: occupancy === 4 }))
            : [{ occupancy: 4, is_primary: true }],
          ...patch.rate,
        },
        relationships: { property: { data: { id: PROPERTY } }, room_type: { data: { id: ROOM } } },
      },
    });
  });
}

describe("verified Channex API contract", () => {
  it("sends API keys only to the selected fixed HTTPS environment", async () => {
    const transport = verificationTransport();
    await new ChannexClient("staging", "private-key", transport).verifyMappings(
      PROPERTY,
      [mapping],
      [unit],
    );
    expect(transport).toHaveBeenCalledTimes(3);
    for (const [url, options] of transport.mock.calls) {
      expect(String(url).startsWith("https://staging.channex.io/api/v1/")).toBe(true);
      expect(options?.headers).toMatchObject({ "user-api-key": "private-key" });
      expect(options?.redirect).toBe("error");
    }
    expect(() => new ChannexClient("staging", "")).toThrow("channex_not_configured");
  });
  it("requires a server-owned property binding even when the caller controls a local connection", () => {
    const config: Record<string, string> = {
      CHANNEX_STAGING_API_KEY: "platform-key",
      CHANNEX_STAGING_PROPERTY_BINDINGS: JSON.stringify({ "local-property": PROPERTY }),
    };
    const get = (name: string) => config[name];
    expect(channexKeyForConnection(connection, get)).toBe("platform-key");
    expect(() =>
      channexKeyForConnection({ ...connection, property_id: "foreign-customer" }, get),
    ).toThrow("channel_property_not_authorized");
    expect(() =>
      channexKeyForConnection({ ...connection, external_property_id: OTHER }, get),
    ).toThrow("channel_property_not_authorized");
  });
  it("never reuses a generic production key for staging", () => {
    const values: Record<string, string> = {
      CHANNEX_ENVIRONMENT: "production",
      CHANNEX_API_KEY: "production-key",
      CHANNEX_STAGING_WEBHOOK_SECRET: "staging-secret",
    };
    const get = (name: string) => values[name];
    expect(channexSecret("staging", get)).toBe("");
    expect(channexSecret("production", get)).toBe("production-key");
    expect(channexSecret("staging", get, "WEBHOOK_SECRET")).toBe("staging-secret");
    expect(webhookSecretValid("staging-secret", "staging-secret")).toBe(true);
    expect(webhookSecretValid("staging-secreu", "staging-secret")).toBe(false);
    expect(webhookSecretValid(null, "")).toBe(false);
  });
  it.each([
    [{ roomOwner: OTHER }, "channel_room_mapping_mismatch"],
    [{ room: { count_of_rooms: 2 } }, "channel_room_mapping_mismatch"],
    [{ room: { occ_adults: 6 } }, "channel_capacity_mismatch"],
    [{ rate: { currency: "EUR" } }, "channel_rate_model_unsupported"],
    [{ rate: { inherit_stop_sell: true } }, "channel_rate_inheritance_unsupported"],
    [
      { property: { settings: { min_stay_type: "arrival", state_length: 500 } } },
      "channel_min_stay_model_unsupported",
    ],
    [
      { property: { settings: { min_stay_type: "both", state_length: 100 } } },
      "channel_inventory_window_unsupported",
    ],
  ])("rejects remote mismatches before changing ARI %j", async (patch, error) => {
    const client = new ChannexClient("staging", "key", verificationTransport(false, patch));
    await expect(client.verifyMappings(PROPERTY, [mapping], [unit])).rejects.toThrow(error);
  });
  it("verifies occupancy rates and blocks unchecked child policy or mismatched fees", async () => {
    const partyUnit = { ...unit, party_pricing_enabled: true, child_price_per_night: 150 };
    const client = new ChannexClient("staging", "key", verificationTransport(true));
    await expect(client.verifyMappings(PROPERTY, [mapping], [partyUnit])).rejects.toThrow(
      "channel_child_policy_not_verified",
    );
    expect(await client.verifyMappings(PROPERTY, [mapping], [partyUnit], true)).toMatchObject({
      inventoryDays: 500,
    });
    await expect(
      new ChannexClient(
        "staging",
        "key",
        verificationTransport(true, { rate: { children_fee: "100.00" } }),
      ).verifyMappings(PROPERTY, [mapping], [partyUnit], true),
    ).rejects.toThrow("channel_child_fee_mismatch");
  });
  it("sends rates before opening inventory, using separate endpoints", async () => {
    const transport = vi.fn<typeof fetch>(async () =>
      reply({ meta: { message: "Success", warnings: [] } }),
    );
    const client = new ChannexClient("staging", "key", transport);
    const ari = buildChannexAri(input);
    await client.sendAri(ari);
    expect(transport.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      "/api/v1/restrictions",
      "/api/v1/availability",
    ]);
    expect(JSON.parse(String(transport.mock.calls[0][1]?.body))).toEqual({
      values: ari.restrictions,
    });
    expect(JSON.parse(String(transport.mock.calls[1][1]?.body))).toEqual({
      values: ari.availability,
    });
  });
  it("does not open inventory after HTTP 200 partially rejected restrictions", async () => {
    const transport = vi.fn<typeof fetch>(async () =>
      reply({ meta: { message: "Success", warnings: [{ warning: "invalid price" }] } }),
    );
    await expect(
      new ChannexClient("staging", "key", transport).sendAri(buildChannexAri(input)),
    ).rejects.toThrow("channex_partial_update");
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("updates existing scoped webhooks on retry without creating duplicates", async () => {
    const callback = "https://example.supabase.co/functions/v1/channex-webhook?environment=staging";
    const transport = vi.fn<typeof fetch>(async (_url, options) =>
      options?.method === "GET"
        ? reply({
            data: [
              {
                id: WEBHOOK,
                attributes: { callback_url: callback },
                relationships: { property: { data: { id: PROPERTY } } },
              },
              {
                id: OTHER,
                attributes: { callback_url: callback },
                relationships: { property: { data: { id: OTHER } } },
              },
            ],
          })
        : reply({
            data: {
              id: WEBHOOK,
              attributes: {},
              relationships: { property: { data: { id: PROPERTY } } },
            },
          }),
    );
    expect(
      await new ChannexClient("staging", "key", transport).registerWebhook(
        PROPERTY,
        callback,
        "private-secret",
      ),
    ).toBe(WEBHOOK);
    expect(transport.mock.calls[1][1]?.method).toBe("PUT");
    expect(
      new URL(String(transport.mock.calls[0][0])).searchParams.has("filter[property_id]"),
    ).toBe(false);
    expect(JSON.parse(String(transport.mock.calls[1][1]?.body)).webhook).toMatchObject({
      property_id: PROPERTY,
      headers: { "X-Channex-Webhook-Secret": "private-secret" },
      send_data: true,
    });
  });
});

describe("durable revisions and provider acknowledgements", () => {
  it("whitelists guest contact/occupancy while excluding guarantees and arbitrary metadata", () => {
    const clean = sanitizeChannexRevision(revision, PROPERTY);
    expect(clean.inserted_at).toBe("2026-09-29T12:00:00.000Z");
    expect(clean.rooms[0].occupancy.ages).toEqual([8]);
    expect(JSON.stringify(clean)).not.toMatch(/secret-card|secret-meta|cvv|secret address/);
  });
  it("accepts cancellation without rooms", () => {
    expect(
      sanitizeChannexRevision(
        { ...revision, attributes: { ...revision.attributes, status: "cancelled", rooms: [] } },
        PROPERTY,
      ).rooms,
    ).toEqual([]);
  });
  it("rejects cross-property revisions and never truncates a sold multiroom booking", () => {
    expect(() => sanitizeChannexRevision(revision, OTHER)).toThrow("revision_property_mismatch");
    expect(() =>
      sanitizeChannexRevision(
        {
          ...revision,
          attributes: {
            ...revision.attributes,
            rooms: Array(101).fill(revision.attributes.rooms[0]),
          },
        },
        PROPERTY,
      ),
    ).toThrow("revision_too_large");
  });
  it("acknowledges only after commit and then records acknowledgement", async () => {
    const order: string[] = [];
    const client = new ChannexClient("staging", "key", async () => {
      order.push("remote-ack");
      return reply({ meta: { message: "Success" } });
    });
    const store: ChannexRevisionStore = {
      apply: async () => {
        order.push("commit");
        return { applied: true, revision_id: REVISION };
      },
      acknowledged: async () => {
        order.push("ack-record");
      },
    };
    await receiveChannexRevision(client, store, connection, revision);
    expect(order).toEqual(["commit", "remote-ack", "ack-record"]);
  });
  it("does not acknowledge unresolved mappings or a failed commit", async () => {
    const transport = vi.fn<typeof fetch>();
    const client = new ChannexClient("staging", "key", transport);
    const store: ChannexRevisionStore = {
      apply: async () => ({ applied: false, needs_mapping: true, revision_id: REVISION }),
      acknowledged: vi.fn(),
    };
    await expect(receiveChannexRevision(client, store, connection, revision)).rejects.toThrow(
      "channel_mapping_required",
    );
    store.apply = async () => {
      throw new Error("database offline");
    };
    await expect(receiveChannexRevision(client, store, connection, revision)).rejects.toThrow(
      "database offline",
    );
    expect(transport).not.toHaveBeenCalled();
  });
  it("reports inventory collisions distinctly and preserves the provider revision for retry", async () => {
    const transport = vi.fn<typeof fetch>();
    const store: ChannexRevisionStore = {
      apply: async () => ({
        applied: false,
        needs_mapping: true,
        inventory_conflict: true,
        revision_id: REVISION,
      }),
      acknowledged: vi.fn(),
    };
    await expect(
      receiveChannexRevision(
        new ChannexClient("staging", "key", transport),
        store,
        connection,
        revision,
      ),
    ).rejects.toThrow("channel_inventory_conflict");
    expect(transport).not.toHaveBeenCalled();
    expect(store.acknowledged).not.toHaveBeenCalled();
  });
  it("retries acknowledgement of an already committed duplicate", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(reply({ errors: { code: "offline" } }, 503))
      .mockResolvedValueOnce(reply({ meta: { message: "Success" } }));
    const store: ChannexRevisionStore = {
      apply: vi.fn().mockResolvedValue({ applied: true, duplicate: true, revision_id: REVISION }),
      acknowledged: vi.fn(),
    };
    const client = new ChannexClient("staging", "key", transport);
    await expect(receiveChannexRevision(client, store, connection, revision)).rejects.toThrow(
      "channex_api_error",
    );
    expect(store.acknowledged).not.toHaveBeenCalled();
    await receiveChannexRevision(client, store, connection, revision);
    expect(store.acknowledged).toHaveBeenCalledWith(connection.id, REVISION);
  });
  it("saves a pending sanitized incident before a failed atomic booking apply", async () => {
    const order: string[] = [];
    const payloads: unknown[] = [];
    const admin = {
      from: () => ({
        upsert: async (payload: unknown, options: unknown) => {
          order.push("ledger");
          payloads.push({ payload, options });
          return { error: null };
        },
      }),
      rpc: async () => {
        order.push("apply");
        return { data: null, error: { message: "overlap" } };
      },
    };
    await expect(
      revisionStore(admin, connection).apply(
        connection.id,
        sanitizeChannexRevision(revision, PROPERTY),
      ),
    ).rejects.toThrow("channel_revision_save_failed");
    expect(order).toEqual(["ledger", "apply"]);
    expect(payloads[0]).toMatchObject({
      payload: { property_id: "local-property", status: "pending_mapping" },
      options: { ignoreDuplicates: true },
    });
    expect(JSON.stringify(payloads)).not.toMatch(/cvv|secret-card/);
  });
});

function edgeHandler(path: string, bindings: Record<string, unknown>, env: Record<string, string>) {
  const source = readFileSync(resolve(path), "utf8").replace(
    /import[\s\S]*?from\s+["'][^"']+["'];\s*/g,
    "",
  );
  let handler!: (req: Request) => Promise<Response>;
  const code = transpileModule(source, {
    compilerOptions: { target: ScriptTarget.ES2022 },
  }).outputText;
  new Function("Deno", ...Object.keys(bindings), code)(
    {
      serve: (callback: typeof handler) => {
        handler = callback;
      },
      env: { get: (key: string) => env[key] },
    },
    ...Object.values(bindings),
  );
  return handler;
}

describe("authenticated webhook and owner boundaries", { timeout: 20_000 }, () => {
  afterEach(() => vi.restoreAllMocks());
  const env = {
    CHANNEX_STAGING_WEBHOOK_SECRET: "secret",
    CHANNEX_STAGING_API_KEY: "key",
    CHANNEX_STAGING_PROPERTY_BINDINGS: JSON.stringify({ "local-property": PROPERTY }),
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service",
  };
  const webhookBindings = {
    ChannexError,
    channexSecret,
    channexKeyForConnection,
    receiveChannexRevision,
    validChannexId,
    webhookSecretValid,
    channelError,
    channelFailureCode,
    channexClient,
    pullChannelBookings,
    revisionStore,
  };
  const request = (secret: string) =>
    new Request("https://example.supabase.co/functions/v1/channex-webhook?environment=staging", {
      method: "POST",
      headers: { "x-channex-webhook-secret": secret },
      body: JSON.stringify({
        event: "booking",
        property_id: PROPERTY,
        payload: { revision_id: REVISION },
      }),
    });
  it("rejects an invalid webhook secret before touching storage or API", async () => {
    const createClient = vi.fn();
    const handler = edgeHandler(
      "supabase/functions/channex-webhook/index.ts",
      { ...webhookBindings, createClient },
      env,
    );
    expect((await handler(request("invalid"))).status).toBe(401);
    expect(createClient).not.toHaveBeenCalled();
  });
  it("loads the revision from Channex and rejects a different authoritative property", async () => {
    let reads = 0;
    let writes = 0;
    const builder = {
      select() {
        return this;
      },
      eq() {
        return this;
      },
      async maybeSingle() {
        reads++;
        return { data: connection, error: null };
      },
      update() {
        writes++;
        return this;
      },
      then(onFulfilled: (value: unknown) => unknown) {
        return Promise.resolve({ error: null }).then(onFulfilled);
      },
    };
    const remote = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      reply({
        data: { ...revision, attributes: { ...revision.attributes, property_id: OTHER } },
      }),
    );
    const apply = vi.fn();
    const handler = edgeHandler(
      "supabase/functions/channex-webhook/index.ts",
      { ...webhookBindings, createClient: () => ({ from: () => builder, rpc: apply }) },
      env,
    );
    expect((await handler(request("secret"))).status).toBe(503);
    expect(reads).toBe(1);
    expect(remote).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
    expect(writes).toBe(1); // Safe connection error metadata only.
  });
  it("returns 404 for a foreign owner's connection before any provider request", async () => {
    const builder = {
      select() {
        return this;
      },
      eq() {
        return this;
      },
      async maybeSingle() {
        return { data: { ...connection, property: { owner_id: "another-owner" } }, error: null };
      },
    };
    const remote = vi.spyOn(globalThis, "fetch");
    const createClient = (_url: string, key: string) =>
      key === "anon"
        ? { auth: { getUser: async () => ({ data: { user: { id: "owner" } }, error: null }) } }
        : { from: () => builder };
    const handler = edgeHandler(
      "supabase/functions/channel-sync/index.ts",
      {
        createClient,
        isCronAuthorized: async () => false,
        ChannexError,
        channexSecret,
        channexKeyForConnection,
        validChannexId,
        channelError,
        channelFailureCode,
        channexClient,
      },
      { ...env, SUPABASE_ANON_KEY: "anon" },
    );
    const response = await handler(
      new Request("https://example.supabase.co/functions/v1/channel-sync", {
        method: "POST",
        headers: { Authorization: "Bearer owner-jwt" },
        body: JSON.stringify({ connectionId: connection.id, action: "verify" }),
      }),
    );
    expect(response.status).toBe(404);
    expect(remote).not.toHaveBeenCalled();
  });
});

function syncDatabase() {
  const current = { ...connection, sync_dirty_at: "2026-09-29T12:00:00.000Z" };
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  let completionAccepted = true;
  let busy = false;
  const admin = {
    from(table: string) {
      let patch: Record<string, unknown> | null = null;
      const rows = table === "units" ? [unit] : table === "channel_unit_mappings" ? [mapping] : [];
      const result = () => ({ data: rows, error: null });
      const builder = {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        order() {
          return this;
        },
        lt() {
          return this;
        },
        gt() {
          return this;
        },
        gte() {
          return this;
        },
        limit() {
          return this;
        },
        update(value: Record<string, unknown>) {
          patch = value;
          return this;
        },
        async range() {
          return result();
        },
        async maybeSingle() {
          return { data: table === "properties" ? { max_stay: 30 } : { ...current }, error: null };
        },
        then(onFulfilled: (value: unknown) => unknown) {
          if (table === "channel_connections" && patch) Object.assign(current, patch);
          return Promise.resolve(result()).then(onFulfilled);
        },
      };
      return builder;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      if (name === "claim_channel_sync") return { data: busy ? null : "lease", error: null };
      if (name === "validate_channel_sync")
        return { data: args.p_dirty_at === current.sync_dirty_at, error: null };
      return { data: completionAccepted, error: null };
    },
  };
  return {
    admin,
    current,
    rpcCalls,
    rejectCompletion: () => {
      completionAccepted = false;
    },
    busy: () => {
      busy = true;
    },
  };
}

describe("outgoing synchronization races", { timeout: 20_000 }, () => {
  it("closes inventory, drains bookings and validates a stable version before reopening", async () => {
    const db = syncDatabase();
    const transport = verificationTransport();
    const client = new ChannexClient("staging", "key", transport);
    const flow: string[] = [];
    vi.spyOn(client, "feed").mockImplementation(async () => {
      flow.push("drain");
      return [];
    });
    vi.spyOn(client, "request").mockImplementation(async (path, _method, body) => {
      if (path.startsWith("/availability")) {
        const values = (body as { values: { availability: number }[] }).values;
        flow.push(values.every((v) => v.availability === 0) ? "close" : "open");
        return { meta: { message: "Success" } };
      }
      if (path === "/restrictions") {
        flow.push("rates");
        return { meta: { message: "Success" } };
      }
      return (await transport(`https://staging.channex.io/api/v1${path}`)).json();
    });
    expect(await syncChannelAri(db.admin, db.current, client)).toMatchObject({
      submitted: true,
      dates: 500,
    });
    expect(flow).toEqual(["close", "drain", "rates", "open"]);
    expect(db.rpcCalls.filter((c) => c.name === "validate_channel_sync")).toHaveLength(3);
    expect(db.rpcCalls.at(-1)).toMatchObject({
      name: "complete_channel_sync",
      args: { p_error: null },
    });
  });
  it("immediately closes and rebuilds after an external revision changes the snapshot during submission", async () => {
    const db = syncDatabase();
    const client = new ChannexClient("staging", "key", verificationTransport());
    vi.spyOn(client, "feed").mockResolvedValue([]);
    vi.spyOn(client, "verifyMappings").mockResolvedValue({
      propertyName: "Bergs",
      mappedUnits: 1,
      inventoryDays: 365,
    });
    const changes: string[] = [];
    let firstOpen = true;
    vi.spyOn(client, "request").mockImplementation(async (path, _method, body) => {
      if (path === "/availability") {
        const zero = (body as { values: { availability: number }[] }).values.every(
          (v) => v.availability === 0,
        );
        changes.push(zero ? "close" : "open");
        if (!zero && firstOpen) {
          firstOpen = false;
          db.current.sync_dirty_at = "2026-09-29T12:01:00.000Z";
        }
      }
      return { meta: { message: "Success" } };
    });
    expect(await syncChannelAri(db.admin, db.current, client)).toMatchObject({
      submitted: true,
    });
    expect(changes).toEqual(["close", "open", "close", "open"]);
  });
  it("does not advertise success when its lease was replaced or completion failed", async () => {
    const db = syncDatabase();
    db.rejectCompletion();
    const client = new ChannexClient("staging", "key", verificationTransport());
    vi.spyOn(client, "feed").mockResolvedValue([]);
    vi.spyOn(client, "verifyMappings").mockResolvedValue({
      propertyName: "Bergs",
      mappedUnits: 1,
      inventoryDays: 365,
    });
    vi.spyOn(client, "request").mockResolvedValue({ meta: { message: "Success" } });
    await expect(syncChannelAri(db.admin, db.current, client)).rejects.toThrow(
      "channel_sync_completion_failed",
    );
  });
  it("keeps an uncertain closure blocking new sales until a full sync succeeds", () => {
    const uncertain = { ...connection, last_error: "channel_inventory_closure_failed" };
    expect(channelFailureCode(uncertain, null)).toBe("channel_inventory_closure_failed");
    expect(channelFailureCode(uncertain, "channex_api_error")).toBe(
      "channel_inventory_closure_failed",
    );
    expect(channelFailureCode(connection, "channex_api_error")).toBe("channex_api_error");
  });
  it("makes no external request if another sync owns the lease", async () => {
    const db = syncDatabase();
    db.busy();
    const transport = vi.fn<typeof fetch>();
    expect(
      await syncChannelAri(db.admin, db.current, new ChannexClient("staging", "key", transport)),
    ).toEqual({ skipped: "busy_or_backoff" });
    expect(transport).not.toHaveBeenCalled();
  });
});

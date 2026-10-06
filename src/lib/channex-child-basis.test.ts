import { describe, expect, it, vi } from "vitest";
import {
  buildChannexAri,
  ChannexClient,
  type ChannelConnection,
  type ChannelUnit,
} from "../../supabase/functions/_shared/channex";
import { localChannelContext } from "../../supabase/functions/_shared/channex-runtime";

const PROPERTY = "11111111-1111-4111-8111-111111111111";
const ROOM = "33333333-3333-4333-8333-333333333333";
const RATE = "44444444-4444-4444-8444-444444444444";
const connection: ChannelConnection = {
  id: "connection",
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
  max_guests: 2,
  base_price: 1295,
  min_stay: 1,
  weekend_pct: 0,
  cleaning_fee: 0,
  monthly_mult: Array(12).fill(100),
  party_pricing_enabled: true,
  adult_prices: [700, 1295],
  child_price_per_night: 0,
};
const mapping = { unit_id: unit.id, room_type_id: ROOM, rate_plan_id: RATE };
const input = {
  connection,
  mappings: [mapping],
  bookings: [],
  rules: [],
  from: "2027-06-01",
  to: "2027-06-03",
  maxStay: 14,
};

function transport(party: boolean, childNightly: number) {
  return vi.fn<typeof fetch>(async (url) => {
    const path = new URL(String(url)).pathname;
    const data = path.includes("/properties/")
      ? {
          id: PROPERTY,
          attributes: { currency: "SEK", settings: { min_stay_type: "both", state_length: 500 } },
        }
      : path.includes("/room_types/")
        ? {
            id: ROOM,
            attributes: { count_of_rooms: 1, occ_adults: 2, occ_children: 0, occ_infants: 0 },
            relationships: { property: { data: { id: PROPERTY } } },
          }
        : {
            id: RATE,
            attributes: {
              currency: "SEK",
              sell_mode: party ? "per_person" : "per_room",
              rate_mode: "manual",
              children_fee: party ? childNightly : 0,
              infant_fee: 0,
              options: (party ? [1, 2] : [2]).map((occupancy) => ({
                occupancy,
                is_primary: occupancy === 2,
              })),
            },
            relationships: {
              property: { data: { id: PROPERTY } },
              room_type: { data: { id: ROOM } },
            },
          };
    return new Response(JSON.stringify({ data }), { status: 200 });
  });
}

describe("Channex cannot represent a positive child fee charged once per booking", () => {
  it("rejects mapping verification before making any remote request", async () => {
    const fetcher = transport(true, 0);
    const client = new ChannexClient("staging", "test-only-key", fetcher);
    await expect(
      client.verifyMappings(
        PROPERTY,
        [mapping],
        [
          {
            ...unit,
            child_price_basis: "per_booking",
            child_price_per_booking: 329,
          },
        ],
        true,
      ),
    ).rejects.toMatchObject({ code: "channel_child_price_basis_unsupported", status: 409 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([1, 329])("rejects building ARI with a once-per-booking child fee of %i", (amount) => {
    expect(() =>
      buildChannexAri({
        ...input,
        units: [
          {
            ...unit,
            child_price_basis: "per_booking",
            child_price_per_booking: amount,
          },
        ],
      }),
    ).toThrow("channel_child_price_basis_unsupported");
  });

  it.each<Partial<ChannelUnit>>([
    {},
    { child_price_basis: "per_night", child_price_per_night: 150, child_price_per_booking: 329 },
    { child_price_basis: "per_booking", child_price_per_booking: 0 },
    { child_price_basis: "per_booking", child_price_per_booking: 0, child_price_per_night: 329 },
    {
      party_pricing_enabled: false,
      child_price_basis: "per_booking",
      child_price_per_booking: 329,
    },
  ])(
    "preserves supported or inactive pricing in mapping verification and ARI: %j",
    async (patch) => {
      const candidate = { ...unit, ...patch };
      const client = new ChannexClient(
        "staging",
        "test-only-key",
        transport(
          candidate.party_pricing_enabled === true,
          candidate.child_price_basis === "per_booking"
            ? 0
            : (candidate.child_price_per_night ?? 0),
        ),
      );
      await expect(
        client.verifyMappings(PROPERTY, [mapping], [candidate], true),
      ).resolves.toMatchObject({ inventoryDays: 500 });
      const ari = buildChannexAri({ ...input, units: [candidate] });
      expect(ari.availability.map((day) => day.availability)).toEqual([1, 1]);
      if (candidate.party_pricing_enabled)
        expect(ari.restrictions[0].rates).toEqual([
          { occupancy: 1, rate: "700.00" },
          { occupancy: 2, rate: "1295.00" },
        ]);
      else expect(ari.restrictions[0].rate).toBe("1295.00");
    },
  );

  it("does not block a mapped unit because an unrelated direct-only unit charges per booking", async () => {
    const client = new ChannexClient("staging", "test-only-key", transport(true, 0));
    await expect(
      client.verifyMappings(
        PROPERTY,
        [mapping],
        [
          unit,
          {
            ...unit,
            id: "direct-only-tent",
            child_price_basis: "per_booking",
            child_price_per_booking: 329,
          },
        ],
        true,
      ),
    ).resolves.toMatchObject({ inventoryDays: 500 });
  });

  it("loads both child basis fields from storage so persisted fees cannot bypass the guard", async () => {
    const stored = { ...unit, child_price_basis: "per_booking", child_price_per_booking: 329 };
    const admin = {
      from: (table: string) => {
        let selected: string[] = [];
        let single = false;
        const query = {
          select: (fields: string) => {
            selected = fields.split(",");
            return query;
          },
          eq: () => query,
          order: () => query,
          lt: () => query,
          gt: () => query,
          gte: () => query,
          limit: () => query,
          range: () => query,
          maybeSingle: () => {
            single = true;
            return query;
          },
          then: (resolve: (value: object) => unknown) => {
            const rows: Record<string, unknown>[] =
              table === "units"
                ? [stored]
                : table === "channel_unit_mappings"
                  ? [mapping]
                  : table === "properties"
                    ? [{ max_stay: 14 }]
                    : [];
            const data = rows.map((row) =>
              Object.fromEntries(
                selected.filter((key) => key in row).map((key) => [key, row[key]]),
              ),
            );
            return Promise.resolve({ data: single ? data[0] : data, error: null }).then(resolve);
          },
        };
        return query;
      },
      rpc: vi.fn(),
    };
    const context = await localChannelContext(admin, connection, input.from, input.to);
    expect(context.units[0]).toMatchObject({
      child_price_basis: "per_booking",
      child_price_per_booking: 329,
    });
    expect(() => buildChannexAri({ ...input, ...context })).toThrow(
      "channel_child_price_basis_unsupported",
    );
  });
});

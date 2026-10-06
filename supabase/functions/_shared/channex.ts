import { nightlyPriceWithRules, nightsBetween, type UnitPricing } from "./pricing.ts";
import { minStayFromRules, ruleCoversDate, rulesForUnit, type RateRule } from "./rate-rules.ts";
import { canonicalAriValue, type AriChanges } from "./channex-ari.ts";

/** Protocol verified against docs.channex.io API v1 on 2026-09-29. */
export type ChannexEnvironment = "staging" | "production";
export interface ChannelConnection {
  id: string;
  property_id: string;
  external_property_id: string;
  environment: ChannexEnvironment;
  enabled: boolean;
  fees_configured?: boolean;
  verified_at?: string | null;
  webhook_id?: string | null;
  last_booking_sync_at?: string | null;
  last_ari_sync_at?: string | null;
  last_error?: string | null;
  sync_dirty_at?: string | null;
  next_retry_at?: string | null;
  ari_horizon_date?: string | null;
}
export interface ChannelUnitMapping {
  unit_id: string;
  room_type_id: string;
  rate_plan_id: string;
}
export interface ChannelUnit extends UnitPricing {
  id: string;
  property_id: string;
  active: boolean;
  min_stay: number;
  max_guests: number;
}
export class ChannexError extends Error {
  constructor(
    public code: string,
    public status = 503,
  ) {
    super(code);
  }
}

function assertSupportedChildPriceBasis(unit: UnitPricing) {
  if (
    unit.party_pricing_enabled === true &&
    unit.child_price_basis === "per_booking" &&
    (unit.child_price_per_booking ?? 0) > 0
  )
    throw new ChannexError("channel_child_price_basis_unsupported", 409);
}

export function channexSecret(
  environment: ChannexEnvironment,
  get: (name: string) => string | undefined,
  kind = "API_KEY",
): string {
  const scoped = get(`CHANNEX_${environment.toUpperCase()}_${kind}`);
  if (scoped) return scoped;
  // A shared account key is valid only for the explicitly selected environment.
  return get("CHANNEX_ENVIRONMENT") === environment ? (get(`CHANNEX_${kind}`) ?? "") : "";
}
/** A platform key never authorizes a customer-selected external property by itself. */
export function channexKeyForConnection(
  connection: ChannelConnection,
  get: (name: string) => string | undefined,
): string {
  let bindings: Record<string, unknown>;
  try {
    bindings = JSON.parse(
      get(`CHANNEX_${connection.environment.toUpperCase()}_PROPERTY_BINDINGS`) ?? "{}",
    );
  } catch {
    throw new ChannexError("channel_property_not_authorized", 409);
  }
  if (
    !bindings ||
    Array.isArray(bindings) ||
    bindings[connection.property_id] !== connection.external_property_id
  )
    throw new ChannexError("channel_property_not_authorized", 409);
  const scoped = get(
    `CHANNEX_${connection.environment.toUpperCase()}_CONNECTION_${connection.id.replace(/-/g, "_").toUpperCase()}_API_KEY`,
  );
  return scoped || channexSecret(connection.environment, get);
}
export function validChannexId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}
export function webhookSecretValid(actual: string | null, expected: string): boolean {
  if (!actual || !expected || actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
interface Resource {
  id: string;
  type?: string;
  attributes: Record<string, any>;
  relationships?: Record<string, { data: any }>;
}
interface ApiResponse {
  data?: Resource | Resource[];
  meta?: Record<string, any>;
  errors?: unknown;
}
export class ChannexClient {
  readonly origin: string;
  constructor(
    environment: ChannexEnvironment,
    private key: string,
    private transport: typeof fetch = fetch,
  ) {
    this.origin =
      environment === "production" ? "https://app.channex.io" : "https://staging.channex.io";
    if (!key) throw new ChannexError("channex_not_configured", 409);
  }
  async request(path: string, method = "GET", body?: unknown): Promise<ApiResponse> {
    // Callers cannot choose an arbitrary host or leak a platform API key via a redirect.
    if (!/^\/[a-z0-9_/-]+(?:\?.*)?$/i.test(path)) throw new ChannexError("invalid_api_path", 400);
    let response: Response;
    try {
      response = await this.transport(`${this.origin}/api/v1${path}`, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
        headers: {
          "user-api-key": this.key,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new ChannexError("channex_network_error");
    }
    let result: ApiResponse;
    try {
      result = await response.json();
    } catch {
      throw new ChannexError("channex_invalid_response");
    }
    if (!response.ok || result.errors) {
      // Never include provider response bodies, guest details or credentials in errors.
      throw new ChannexError(
        response.status === 429 ? "channex_rate_limited" : "channex_api_error",
        response.status >= 500 || response.status === 429 ? 503 : 409,
      );
    }
    if (result.data === undefined && !result.meta)
      throw new ChannexError("channex_invalid_response");
    // Channex can return HTTP 200 with warnings and only partially apply ARI.
    if (Array.isArray(result.meta?.warnings) && result.meta.warnings.length)
      throw new ChannexError("channex_partial_update");
    return result;
  }
  async resource(path: string): Promise<Resource> {
    const result = await this.request(path);
    if (!result.data || Array.isArray(result.data) || !result.data.attributes)
      throw new ChannexError("channex_invalid_response");
    return result.data;
  }
  async list(path: string, filters: Record<string, string> = {}): Promise<Resource[]> {
    const items: Resource[] = [];
    for (let page = 1; page <= 20; page++) {
      const params = new URLSearchParams({
        ...filters,
        "pagination[page]": String(page),
        "pagination[limit]": "100",
      });
      const response = await this.request(`${path}?${params}`);
      if (!Array.isArray(response.data)) throw new ChannexError("channex_invalid_response");
      items.push(...response.data);
      if (response.data.length < 100 || items.length >= Number(response.meta?.total ?? Infinity))
        return items;
    }
    throw new ChannexError("channex_pagination_limit");
  }
  async verifyMappings(
    propertyId: string,
    mappings: ChannelUnitMapping[],
    units: ChannelUnit[] = [],
    feesConfigured = false,
  ) {
    if (!validChannexId(propertyId)) throw new ChannexError("invalid_property_mapping", 409);
    units
      .filter((unit) => mappings.some((mapping) => mapping.unit_id === unit.id))
      .forEach(assertSupportedChildPriceBasis);
    if (!feesConfigured && units.some((unit) => unit.cleaning_fee > 0))
      throw new ChannexError("channel_fees_not_configured", 409);
    const property = await this.resource(`/properties/${propertyId}`);
    if (property.id !== propertyId || property.attributes.currency !== "SEK")
      throw new ChannexError("channel_currency_mismatch", 409);
    if (
      !["both", "through"].includes(
        property.attributes.settings?.min_stay_type ?? property.attributes.min_stay_type,
      )
    )
      throw new ChannexError("channel_min_stay_model_unsupported", 409);
    for (const mapping of mappings) {
      if (!validChannexId(mapping.room_type_id) || !validChannexId(mapping.rate_plan_id))
        throw new ChannexError("invalid_unit_mapping", 409);
      const room = await this.resource(`/room_types/${mapping.room_type_id}`);
      const rate = await this.resource(`/rate_plans/${mapping.rate_plan_id}`);
      if (
        room.id !== mapping.room_type_id ||
        room.relationships?.property?.data?.id !== propertyId ||
        Number(room.attributes.count_of_rooms) !== 1
      )
        throw new ChannexError("channel_room_mapping_mismatch", 409);
      if (
        rate.id !== mapping.rate_plan_id ||
        rate.relationships?.property?.data?.id !== propertyId ||
        rate.relationships?.room_type?.data?.id !== mapping.room_type_id
      )
        throw new ChannexError("channel_rate_mapping_mismatch", 409);
      const unit = units.find((item) => item.id === mapping.unit_id);
      const partyPricing = unit?.party_pricing_enabled === true;
      if (
        rate.attributes.currency !== "SEK" ||
        rate.attributes.sell_mode !== (partyPricing ? "per_person" : "per_room") ||
        rate.attributes.rate_mode !== "manual"
      )
        throw new ChannexError("channel_rate_model_unsupported", 409);
      const options = rate.attributes.options;
      if (unit) {
        const occupancies = partyPricing
          ? Array.from({ length: unit.max_guests }, (_, i) => i + 1)
          : [unit.max_guests];
        if (
          !Array.isArray(options) ||
          options.length !== occupancies.length ||
          occupancies.some(
            (count) =>
              !options.some((option: any) => option.occupancy === count && !option.derived_option),
          ) ||
          options.filter((option: any) => option.is_primary === true).length !== 1
        )
          throw new ChannexError("channel_occupancy_model_unsupported", 409);
        if (partyPricing && !feesConfigured)
          throw new ChannexError("channel_child_policy_not_verified", 409);
        if (
          Number(rate.attributes.children_fee) !==
            (partyPricing && unit.child_price_basis !== "per_booking"
              ? (unit.child_price_per_night ?? 0)
              : 0) ||
          Number(rate.attributes.infant_fee) !== 0
        )
          throw new ChannexError("channel_child_fee_mismatch", 409);
        if (
          Number(room.attributes.occ_adults) !== unit.max_guests ||
          Number(room.attributes.occ_children ?? 0) > 0 ||
          Number(room.attributes.occ_infants ?? 0) > 0
        )
          throw new ChannexError("channel_capacity_mismatch", 409);
      }
      if (
        [
          "inherit_rate",
          "inherit_min_stay_through",
          "inherit_min_stay_arrival",
          "inherit_max_stay",
          "inherit_closed_to_arrival",
          "inherit_closed_to_departure",
          "inherit_stop_sell",
        ].some((key) => rate.attributes[key] === true)
      )
        throw new ChannexError("channel_rate_inheritance_unsupported", 409);
    }
    const inventoryDays = Number(property.attributes.settings?.state_length);
    if (!Number.isInteger(inventoryDays) || inventoryDays < 365 || inventoryDays > 730)
      throw new ChannexError("channel_inventory_window_unsupported", 409);
    return {
      propertyName: String(property.attributes.title ?? ""),
      mappedUnits: mappings.length,
      inventoryDays,
    };
  }
  async revision(id: string) {
    if (!validChannexId(id)) throw new ChannexError("invalid_revision_id", 400);
    return this.resource(`/booking_revisions/${id}`);
  }
  async feed(propertyId: string) {
    const params = new URLSearchParams({
      "filter[property_id]": propertyId,
      "order[inserted_at]": "asc",
      "pagination[page]": "1",
      "pagination[limit]": "100",
    });
    const result = await this.request(`/booking_revisions/feed?${params}`);
    if (!Array.isArray(result.data)) throw new ChannexError("channex_invalid_response");
    return result.data;
  }
  async acknowledge(revisionId: string) {
    if (!validChannexId(revisionId)) throw new ChannexError("invalid_revision_id", 400);
    await this.request(`/booking_revisions/${revisionId}/ack`, "POST", {});
  }
  async sendAri(ari: AriPayload | AriChanges) {
    // Rates and restrictions first, so newly opened availability cannot expose a
    // stale price. Inventory remains in a separate priority request as required.
    const receipts: Record<string, string[]> = {};
    for (const [path, values] of [
      ["restrictions", ari.restrictions],
      ["availability", ari.availability],
    ] as const) {
      if (!values.length) continue;
      const response = await this.request(`/${path}`, "POST", canonicalAriValue({ values }));
      // A successful nonempty ARI batch creates tasks. A bare 200 or an empty
      // receipt does not prove acceptance and must never advance our baseline.
      if (
        !Array.isArray(response.data) ||
        !response.data.length ||
        response.data.some(
          (row: unknown) =>
            !row ||
            typeof row !== "object" ||
            (row as { type?: unknown }).type !== "task" ||
            !validChannexId((row as { id?: unknown }).id),
        )
      )
        throw new ChannexError("channex_invalid_response");
      receipts[path] = response.data.map((row: { id: string }) => row.id);
    }
    return receipts;
  }
  async registerWebhook(propertyId: string, callback: string, secret: string) {
    if (!validChannexId(propertyId) || !secret || new URL(callback).protocol !== "https:")
      throw new ChannexError("invalid_webhook_configuration", 409);
    // Retry after a local metadata failure updates the existing remote webhook.
    // The list API has no property filter: enforce property ownership locally.
    const existing = (await this.list("/webhooks")).filter(
      (item) =>
        item.relationships?.property?.data?.id === propertyId &&
        item.attributes.callback_url === callback,
    );
    if (existing.length > 1) throw new ChannexError("duplicate_channel_webhooks", 409);
    const previous = existing[0];
    if (previous && !validChannexId(previous.id))
      throw new ChannexError("channex_invalid_response");
    const result = await this.request(
      previous ? `/webhooks/${previous.id}` : "/webhooks",
      previous ? "PUT" : "POST",
      {
        webhook: {
          property_id: propertyId,
          callback_url: callback,
          event_mask: "booking;booking_unmapped_room;booking_unmapped_rate;non_acked_booking",
          headers: { "X-Channex-Webhook-Secret": secret },
          is_active: true,
          send_data: true,
        },
      },
    );
    if (
      !result.data ||
      Array.isArray(result.data) ||
      !validChannexId(result.data.id) ||
      result.data.relationships?.property?.data?.id !== propertyId
    )
      throw new ChannexError("channex_invalid_response");
    return result.data.id;
  }
  async channels(propertyId: string) {
    const channels = await this.list("/channels", { "filter[property_id]": propertyId });
    return channels
      .filter(
        (channel) =>
          Array.isArray(channel.relationships?.properties?.data) &&
          channel.relationships!.properties.data.some((p: { id: string }) => p.id === propertyId),
      )
      .map((channel) => ({
        id: channel.id,
        code: String(channel.attributes.channel ?? ""),
        title: String(channel.attributes.title ?? ""),
        status: String(channel.attributes.status ?? "unknown"),
        enabled: channel.attributes.is_active === true,
      }));
  }
}

function text(value: unknown, max: number): string | null {
  return typeof value === "string" ? value.slice(0, max).trim() || null : null;
}
function money(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(String(value)))
    throw new ChannexError("invalid_revision_amount");
  return Number(value).toFixed(2);
}
function occupancy(value: any) {
  const count = (v: unknown) => {
    if (v == null) return 0;
    if (!Number.isInteger(Number(v)) || Number(v) < 0 || Number(v) > 20)
      throw new ChannexError("invalid_revision_occupancy");
    return Number(v);
  };
  const result = {
    adults: count(value?.adults),
    children: count(value?.children),
    infants: count(value?.infants),
    ages: [] as number[],
  };
  if (Array.isArray(value?.ages)) {
    if (
      value.ages.length > 20 ||
      value.ages.some(
        (age: unknown) => !Number.isInteger(age) || Number(age) < 0 || Number(age) > 17,
      )
    )
      throw new ChannexError("invalid_revision_occupancy");
    result.ages = [...value.ages];
  }
  if (result.adults + result.children + result.infants > 20)
    throw new ChannexError("invalid_revision_occupancy");
  return result;
}
function services(value: any): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.slice(0, 100).map((s) => ({
        name: text(s?.name, 255),
        type: text(s?.type, 80),
        price_mode: text(s?.price_mode, 80),
        total_price: money(s?.total_price),
        persons: Number(s?.persons) || 0,
        nights: Number(s?.nights) || 0,
      }))
    : [];
}
export function sanitizeChannexRevision(resource: Resource, expectedProperty: string) {
  const a = resource.attributes;
  if (
    !a ||
    !validChannexId(resource.id) ||
    a.property_id !== expectedProperty ||
    !validChannexId(a.booking_id)
  )
    throw new ChannexError("revision_property_mismatch", 409);
  if (!["new", "modified", "cancelled"].includes(a.status))
    throw new ChannexError("invalid_revision_status");
  const insertedAt = String(a.inserted_at ?? "");
  const timestamp = /(?:Z|[+-]\d{2}:\d{2})$/i.test(insertedAt) ? insertedAt : `${insertedAt}Z`;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(timestamp) || !Number.isFinite(Date.parse(timestamp)))
    throw new ChannexError("invalid_revision_timestamp");
  if (Array.isArray(a.rooms) && a.rooms.length > 100) throw new ChannexError("revision_too_large");
  const rooms = Array.isArray(a.rooms)
    ? a.rooms.map((room: any) => {
        const checkin = room.checkin_date ?? a.arrival_date;
        const checkout = room.checkout_date ?? a.departure_date;
        if (typeof checkin !== "string" || typeof checkout !== "string")
          throw new ChannexError("invalid_revision_dates");
        const nights = nightsBetween(checkin, checkout);
        if (!nights.length || nights.length > 730) throw new ChannexError("invalid_revision_dates");
        return {
          room_type_id: validChannexId(room.room_type_id) ? room.room_type_id : null,
          rate_plan_id: validChannexId(room.rate_plan_id) ? room.rate_plan_id : null,
          ota_unique_id: text(room.ota_unique_id, 255),
          checkin_date: checkin,
          checkout_date: checkout,
          amount: money(room.amount),
          occupancy: occupancy(room.occupancy),
          services: services(room.services),
        };
      })
    : [];
  if (a.status !== "cancelled" && !rooms.length) throw new ChannexError("revision_rooms_missing");
  const currency = String(a.currency ?? "").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new ChannexError("invalid_revision_currency");
  // Explicit whitelist. Credit-card guarantee/CVV, arbitrary meta and addresses
  // are neither persisted nor returned to the browser.
  return {
    id: resource.id,
    property_id: expectedProperty,
    booking_id: a.booking_id,
    inserted_at: new Date(timestamp).toISOString(),
    status: a.status,
    ota_name: text(a.ota_name, 120),
    ota_reservation_code: text(a.ota_reservation_code, 255),
    currency,
    amount: money(a.amount),
    notes: text(a.notes, 10_000),
    payment_collect: ["property", "ota"].includes(a.payment_collect) ? a.payment_collect : null,
    payment_type: ["credit_card", "bank_transfer"].includes(a.payment_type) ? a.payment_type : null,
    customer: {
      name: text(a.customer?.name, 120),
      surname: text(a.customer?.surname, 120),
      mail: text(a.customer?.mail, 254),
      phone: text(a.customer?.phone, 40),
    },
    rooms,
    services: services(a.services),
  };
}
export type SanitizedChannexRevision = ReturnType<typeof sanitizeChannexRevision>;
export interface AppliedRevision {
  applied: boolean;
  duplicate?: boolean;
  stale?: boolean;
  needs_mapping?: boolean;
  inventory_conflict?: boolean;
  revision_id: string;
  booking_ids?: string[];
}
export interface ChannexRevisionStore {
  apply(connectionId: string, revision: SanitizedChannexRevision): Promise<AppliedRevision>;
  acknowledged(connectionId: string, revisionId: string): Promise<void>;
}
export async function receiveChannexRevision(
  client: ChannexClient,
  store: ChannexRevisionStore,
  connection: ChannelConnection,
  resource: Resource,
) {
  if (!connection.enabled) throw new ChannexError("connection_disabled", 409);
  const revision = sanitizeChannexRevision(resource, connection.external_property_id);
  const result = await store.apply(connection.id, revision);
  if (result.inventory_conflict) throw new ChannexError("channel_inventory_conflict");
  if (result.needs_mapping || (!result.applied && !result.duplicate && !result.stale))
    throw new ChannexError("channel_mapping_required");
  // Durable local commit precedes remote acknowledgement. If ack fails, the
  // provider retries; the RPC is revision-idempotent and can safely resume ack.
  await client.acknowledge(revision.id);
  await store.acknowledged(connection.id, revision.id);
  return result;
}

export interface AriPayload {
  availability: { property_id: string; room_type_id: string; date: string; availability: number }[];
  restrictions: {
    property_id: string;
    rate_plan_id: string;
    date: string;
    rate?: string;
    rates?: { occupancy: number; rate: string }[];
    min_stay_through: number;
    min_stay_arrival: number;
    max_stay: number;
    closed_to_arrival: boolean;
    closed_to_departure: boolean;
    stop_sell: boolean;
  }[];
}
export function buildChannexAri(input: {
  connection: ChannelConnection;
  units: ChannelUnit[];
  mappings: ChannelUnitMapping[];
  bookings: {
    unit_id: string | null;
    status: string;
    checkin_date: string;
    checkout_date: string;
  }[];
  rules: RateRule[];
  from: string;
  to: string;
  maxStay: number;
  openThrough?: string;
  unresolvedRevisions?: boolean;
}): AriPayload {
  const { connection, units, mappings, bookings, rules } = input;
  if (!connection.enabled) throw new ChannexError("connection_disabled", 409);
  if (input.unresolvedRevisions) throw new ChannexError("channel_mapping_required", 409);
  if (!mappings.length) throw new ChannexError("channel_mapping_required", 409);
  const dates = nightsBetween(input.from, input.to);
  if (!dates.length || dates.length > 730) throw new ChannexError("invalid_sync_dates", 400);
  const byId = new Map(units.map((u) => [u.id, u]));
  const seenRooms = new Set<string>();
  const seenUnits = new Set<string>();
  const payload: AriPayload = { availability: [], restrictions: [] };
  for (const mapping of mappings) {
    const unit = byId.get(mapping.unit_id);
    if (
      !unit ||
      unit.property_id !== connection.property_id ||
      seenRooms.has(mapping.room_type_id) ||
      seenUnits.has(mapping.unit_id)
    )
      throw new ChannexError("channel_unit_mapping_mismatch", 409);
    seenRooms.add(mapping.room_type_id);
    seenUnits.add(mapping.unit_id);
    assertSupportedChildPriceBasis(unit);
    if (unit.party_pricing_enabled && !connection.fees_configured)
      throw new ChannexError("channel_child_policy_not_verified", 409);
    if (unit.cleaning_fee > 0 && !connection.fees_configured)
      throw new ChannexError("channel_fees_not_configured", 409);
    const scoped = rulesForUnit(rules, unit.id);
    for (const date of dates) {
      const closed =
        !unit.active ||
        Boolean(input.openThrough && date >= input.openThrough) ||
        scoped.some((rule) => rule.kind === "closed" && ruleCoversDate(rule, date));
      const booked = bookings.some(
        (b) =>
          b.unit_id === unit.id &&
          b.status === "confirmed" &&
          b.checkin_date <= date &&
          b.checkout_date > date,
      );
      const rates = Array.from(
        { length: unit.party_pricing_enabled ? unit.max_guests : 1 },
        (_, i) => {
          const price = nightlyPriceWithRules(
            unit,
            date,
            rules,
            unit.id,
            unit.party_pricing_enabled ? { adults: i + 1, childrenAges: [] } : undefined,
          ).price;
          if (!Number.isFinite(price) || price <= 0)
            throw new ChannexError("channel_positive_rate_required", 409);
          return { occupancy: i + 1, rate: price.toFixed(2) };
        },
      );
      payload.availability.push({
        property_id: connection.external_property_id,
        room_type_id: mapping.room_type_id,
        date,
        availability: closed || booked ? 0 : 1,
      });
      payload.restrictions.push({
        property_id: connection.external_property_id,
        rate_plan_id: mapping.rate_plan_id,
        date,
        ...(unit.party_pricing_enabled ? { rates } : { rate: rates[0].rate }),
        min_stay_through: Math.max(unit.min_stay, minStayFromRules(rules, unit.id, [date])),
        min_stay_arrival: Math.max(unit.min_stay, minStayFromRules(rules, unit.id, [date])),
        max_stay: input.maxStay,
        stop_sell: closed,
        closed_to_arrival: scoped.some(
          (rule) => rule.kind === "no_arrival" && ruleCoversDate(rule, date),
        ),
        closed_to_departure: scoped.some(
          (rule) => rule.kind === "no_departure" && ruleCoversDate(rule, date),
        ),
      });
    }
  }
  if (units.some((unit) => unit.active && !seenUnits.has(unit.id)))
    throw new ChannexError("channel_mapping_incomplete", 409);
  return payload;
}

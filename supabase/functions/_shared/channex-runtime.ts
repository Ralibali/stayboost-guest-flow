import {
  buildChannexAri,
  ChannexClient,
  ChannexError,
  channexKeyForConnection,
  receiveChannexRevision,
  type AppliedRevision,
  type ChannelConnection,
  type ChannelUnit,
  type ChannelUnitMapping,
  type ChannexRevisionStore,
  type SanitizedChannexRevision,
} from "./channex.ts";
import type { RateRule } from "./rate-rules.ts";
import { nightsBetween } from "./pricing.ts";
import {
  channexAriChanges,
  closeChangedAvailability,
  sameAriSnapshot,
  restrictionInventoryCovered,
  type AriChanges,
  type AriState,
} from "./channex-ari.ts";

export type ChannelAdmin = {
  from(table: string): any;
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: any; error: { message: string } | null }>;
};
export const channelError = (error: unknown) =>
  error instanceof ChannexError ? error.code : "channel_storage_error";
export function channelFailureCode(
  connection: ChannelConnection,
  code: string | null,
): string | null {
  return connection.last_error === "channel_inventory_closure_failed"
    ? connection.last_error
    : code;
}
export function channexClient(
  connection: ChannelConnection,
  get: (name: string) => string | undefined,
) {
  return new ChannexClient(connection.environment, channexKeyForConnection(connection, get));
}
export async function channelRows<T>(makeQuery: () => any): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < 100; page++) {
    const { data, error } = await makeQuery().range(page * 500, page * 500 + 499);
    if (error) throw new ChannexError("channel_storage_error");
    if (!Array.isArray(data)) throw new ChannexError("channel_storage_error");
    rows.push(...data);
    if (data.length < 500) return rows;
  }
  throw new ChannexError("channel_data_limit");
}
export function revisionStore(
  admin: ChannelAdmin,
  connection: ChannelConnection,
): ChannexRevisionStore {
  return {
    async apply(connectionId: string, revision: SanitizedChannexRevision) {
      if (
        connectionId !== connection.id ||
        revision.property_id !== connection.external_property_id
      )
        throw new ChannexError("revision_property_mismatch", 409);
      // Persist the sanitized incident before the atomic apply. Inventory conflicts
      // leave a durable pending row that closes direct booking until resolved.
      const { error: saveError } = await admin.from("channel_booking_revisions").upsert(
        {
          connection_id: connection.id,
          property_id: connection.property_id,
          revision_id: revision.id,
          external_booking_id: revision.booking_id,
          inserted_at: revision.inserted_at,
          status: "pending_mapping",
          payload: revision,
        },
        { onConflict: "connection_id,revision_id", ignoreDuplicates: true },
      );
      if (saveError) throw new ChannexError("channel_revision_save_failed");
      const { data, error } = await admin.rpc("apply_channex_revision", {
        p_connection_id: connectionId,
        p_revision: revision,
      });
      if (error || !data) throw new ChannexError("channel_revision_save_failed");
      return data as AppliedRevision;
    },
    async acknowledged(connectionId: string, revisionId: string) {
      const { error } = await admin
        .from("channel_booking_revisions")
        .update({ acknowledged_at: new Date().toISOString(), last_error: null })
        .eq("connection_id", connectionId)
        .eq("revision_id", revisionId);
      if (error) throw new ChannexError("channel_ack_record_failed");
    },
  };
}
export async function pullChannelBookings(
  admin: ChannelAdmin,
  connection: ChannelConnection,
  client: ChannexClient,
) {
  const store = revisionStore(admin, connection);
  const seen = new Set<string>();
  let applied = 0;
  for (let batch = 0; batch < 5; batch++) {
    const resources = await client.feed(connection.external_property_id);
    if (!resources.length) {
      const { error } = await admin
        .from("channel_connections")
        .update({ last_booking_sync_at: new Date().toISOString() })
        .eq("id", connection.id);
      if (error) throw new ChannexError("channel_storage_error");
      return { received: seen.size, applied, drained: true };
    }
    for (const resource of resources) {
      if (seen.has(resource.id)) throw new ChannexError("channel_feed_not_advancing");
      seen.add(resource.id);
      const result = await receiveChannexRevision(client, store, connection, resource);
      if (result.applied) applied++;
    }
  }
  // Another tick continues draining page one after acknowledgements. Do not
  // advertise freshness or reopen inventory until the backlog is entirely saved.
  throw new ChannexError("channel_booking_backlog");
}
export async function localChannelContext(
  admin: ChannelAdmin,
  connection: ChannelConnection,
  from: string,
  to: string,
) {
  const [units, mappings, bookings, rules, unresolved, property] = await Promise.all([
    channelRows<ChannelUnit>(() =>
      admin
        .from("units")
        .select(
          "id,property_id,active,max_guests,base_price,weekend_pct,min_stay,cleaning_fee,monthly_mult,party_pricing_enabled,adult_prices,child_price_per_night,child_price_basis,child_price_per_booking,child_free_through_age,child_max_age",
        )
        .eq("property_id", connection.property_id)
        .order("id"),
    ),
    channelRows<ChannelUnitMapping>(() =>
      admin
        .from("channel_unit_mappings")
        .select("unit_id,room_type_id,rate_plan_id")
        .eq("connection_id", connection.id)
        .order("unit_id"),
    ),
    channelRows<{
      unit_id: string | null;
      status: string;
      checkin_date: string;
      checkout_date: string;
    }>(() =>
      admin
        .from("bookings")
        .select("id,unit_id,status,checkin_date,checkout_date")
        .eq("property_id", connection.property_id)
        .eq("status", "confirmed")
        .lt("checkin_date", to)
        .gt("checkout_date", from)
        .order("id"),
    ),
    channelRows<RateRule>(() =>
      admin
        .from("rate_rules")
        .select(
          "id,unit_id,kind,date_from,date_to,fixed_price,adult_prices,pct_delta,min_stay,priority,active",
        )
        .eq("property_id", connection.property_id)
        .eq("active", true)
        .gte("date_to", from)
        .order("created_at")
        .order("id"),
    ),
    admin
      .from("channel_booking_revisions")
      .select("revision_id")
      .eq("connection_id", connection.id)
      .eq("status", "pending_mapping")
      .limit(1),
    admin.from("properties").select("max_stay").eq("id", connection.property_id).maybeSingle(),
  ]);
  if (unresolved.error || property.error || !property.data)
    throw new ChannexError("channel_storage_error");
  return {
    units,
    mappings,
    maxStay: property.data.max_stay,
    bookings,
    rules,
    unresolvedRevisions: Boolean(unresolved.data?.length),
  };
}
export async function syncChannelAri(
  admin: ChannelAdmin,
  connection: ChannelConnection,
  client: ChannexClient,
  options: { forceFull?: boolean; now?: Date } = {},
) {
  const { data: lease, error: claimError } = await admin.rpc("claim_channel_sync", {
    p_connection_id: connection.id,
  });
  if (claimError) throw new ChannexError("channel_lease_failed");
  if (!lease) return { skipped: "busy_or_backoff" };
  const started = new Date().toISOString();
  let failure: string | null = null;
  let zeroAvailability:
    | { property_id: string; room_type_id: string; date: string; availability: number }[]
    | null = null;
  let closed = false;
  let completed = false;
  let submitting: {
    snapshot: ChannelConnection;
    payload: AriChanges;
    mappings: ChannelUnitMapping[];
  } | null = null;
  const validVersion = async (snapshot: ChannelConnection) => {
    const { data, error } = await admin.rpc("validate_channel_sync", {
      p_connection_id: connection.id,
      p_lease_token: lease,
      p_dirty_at: snapshot.sync_dirty_at ?? null,
      p_external_property_id: connection.external_property_id,
      p_environment: connection.environment,
    });
    if (error) throw new ChannexError("channel_version_check_failed");
    return data === true;
  };
  const close = async (full: boolean, changed?: AriChanges) => {
    const { data, error } = await admin.rpc("invalidate_channel_ari", {
      p_connection_id: connection.id,
      p_lease_token: lease,
      p_external_property_id: connection.external_property_id,
      p_environment: connection.environment,
      p_full: full,
    });
    const values = full ? zeroAvailability : changed ? closeChangedAvailability(changed) : [];
    if (error || data !== true) {
      // Without a persisted recovery marker an old baseline must never be trusted.
      // Attempt closure anyway; the sticky fatal status forces a later full sync.
      if (zeroAvailability)
        await client.sendAri({ restrictions: [], availability: zeroAvailability });
      throw new ChannexError("channel_inventory_closure_failed");
    }
    if (values?.length) await client.sendAri({ restrictions: [], availability: values });
    closed = true;
  };
  try {
    const from = (options.now ?? new Date()).toLocaleDateString("en-CA", {
      timeZone: "Europe/Stockholm",
    });
    // Validation itself can fail after a live unit or policy edit. Recover the
    // previously accepted, identity-bound inventory before those fallible reads.
    const { data: previousState, error: previousError } = await admin
      .from("channel_ari_state")
      .select("*")
      .eq("connection_id", connection.id)
      .maybeSingle();
    if (previousError) throw new ChannexError("channel_storage_error");
    const previous = previousState as AriState | null;
    if (
      previous?.property_id === connection.property_id &&
      previous.external_property_id === connection.external_property_id &&
      previous.environment === connection.environment
    ) {
      const snapshot = previous.acknowledged_snapshot ?? previous.pending_snapshot;
      if (snapshot?.availability.length) {
        const roomDates = new Map<string, Set<string>>();
        for (const row of snapshot.availability) {
          const dates = roomDates.get(row.room_type_id) ?? new Set<string>();
          dates.add(row.date);
          roomDates.set(row.room_type_id, dates);
        }
        // Channex rolls its known state window forward daily. Close that same
        // horizon from today, including the newly entered day after midnight.
        zeroAvailability = [...roomDates].flatMap(([room, dates]) => {
          const to = new Date(Date.parse(`${from}T12:00:00Z`) + dates.size * 86_400_000)
            .toISOString()
            .slice(0, 10);
          return nightsBetween(from, to).map((date) => ({
            property_id: connection.external_property_id,
            room_type_id: room,
            date,
            availability: 0,
          }));
        });
      }
    }
    const initial = await localChannelContext(admin, connection, from, from);
    const verified = await client.verifyMappings(
      connection.external_property_id,
      initial.mappings,
      initial.units,
      Boolean(connection.fees_configured),
    );
    const to = new Date(Date.parse(`${from}T12:00:00Z`) + verified.inventoryDays * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const openThrough = new Date(Date.parse(`${from}T12:00:00Z`) + 365 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    zeroAvailability = initial.mappings.flatMap((mapping) =>
      nightsBetween(from, to).map((date) => ({
        property_id: connection.external_property_id,
        room_type_id: mapping.room_type_id,
        date,
        availability: 0,
      })),
    );
    let forceFull = Boolean(
      options.forceFull || connection.last_error === "channel_inventory_closure_failed",
    );
    for (let attempt = 0; attempt < 3; attempt++) {
      const bookings = await pullChannelBookings(admin, connection, client);
      const { data: latest, error } = await admin
        .from("channel_connections")
        .select("*")
        .eq("id", connection.id)
        .maybeSingle();
      if (
        error ||
        !latest ||
        !latest.enabled ||
        latest.external_property_id !== connection.external_property_id ||
        latest.environment !== connection.environment
      )
        throw new ChannexError("channel_inventory_changed");
      const context = await localChannelContext(admin, latest, from, to);
      const ari = buildChannexAri({
        connection: latest,
        ...context,
        from,
        to,
        maxStay: context.maxStay,
        openThrough,
      });
      if (!(await validVersion(latest))) continue;
      const { data: saved, error: stateError } = await admin
        .from("channel_ari_state")
        .select("*")
        .eq("connection_id", connection.id)
        .maybeSingle();
      if (stateError) throw new ChannexError("channel_storage_error");
      const state = saved as AriState | null;
      const bound =
        state?.property_id === latest.property_id &&
        state?.external_property_id === latest.external_property_id &&
        state?.environment === latest.environment;
      const sameDirty =
        state?.pending_dirty_at === latest.sync_dirty_at ||
        (state?.pending_dirty_at != null &&
          latest.sync_dirty_at != null &&
          Date.parse(state.pending_dirty_at) === Date.parse(latest.sync_dirty_at));
      // A stored absolute payload is retried verbatim after provider/DB failure.
      // A changed version or horizon invalidates that replay and requires recovery.
      const replay =
        !forceFull &&
        bound &&
        state?.pending_payload &&
        state.pending_from === from &&
        sameDirty &&
        sameAriSnapshot(state.pending_snapshot, ari);
      const baseline =
        !forceFull && bound && !state?.recovery_required
          ? (state?.acknowledged_snapshot ?? null)
          : null;
      const changes = replay ? state!.pending_payload! : channexAriChanges(ari, baseline);
      const { data: prepared, error: prepareError } = await admin.rpc("prepare_channel_ari", {
        p_connection_id: connection.id,
        p_lease_token: lease,
        p_dirty_at: latest.sync_dirty_at ?? null,
        p_external_property_id: latest.external_property_id,
        p_environment: latest.environment,
        p_snapshot: ari,
        p_payload: changes,
        p_from: from,
      });
      if (prepareError) throw new ChannexError("channel_outbox_prepare_failed");
      if (prepared !== true) continue;
      // Even a network timeout can mean the provider accepted availability.
      // Persist the payload first; do not advance the baseline on a partial result.
      closed = false;
      submitting = { snapshot: latest, payload: changes, mappings: context.mappings };
      const receipts = await client.sendAri(changes);
      if (await validVersion(latest)) {
        const { data: acknowledged, error: ackError } = await admin.rpc("acknowledge_channel_ari", {
          p_connection_id: connection.id,
          p_lease_token: lease,
          p_dirty_at: latest.sync_dirty_at ?? null,
          p_external_property_id: latest.external_property_id,
          p_environment: latest.environment,
          p_receipts: receipts,
        });
        if (ackError) throw new ChannexError("channel_outbox_ack_failed");
        if (acknowledged === true) {
          completed = true;
          return {
            dates: verified.inventoryDays,
            units: context.mappings.length,
            bookings,
            submitted: changes.availability.length > 0 || changes.restrictions.length > 0,
            mode: replay ? "retry" : baseline ? "delta" : "full",
            availabilitySegments: changes.availability.length,
            restrictionSegments: changes.restrictions.length,
            receipts,
          };
        }
      }
      // An OTA revision can invalidate a send while local writes are lease-blocked.
      // Close the whole property and rebuild from the authoritative feed.
      await close(true);
      forceFull = true;
      submitting = null;
    }
    throw new ChannexError("channel_inventory_changed");
  } catch (error) {
    failure = channelError(error);
    if (!closed && zeroAvailability) {
      try {
        const stable =
          submitting &&
          restrictionInventoryCovered(submitting.payload, submitting.mappings) &&
          (await validVersion(submitting.snapshot));
        await close(!stable, stable ? submitting!.payload : undefined);
      } catch {
        failure = "channel_inventory_closure_failed";
      }
    } else if (!closed) failure = "channel_inventory_closure_failed";
    throw new ChannexError(failure, error instanceof ChannexError ? error.status : 503);
  } finally {
    if (!completed) {
      const { data, error } = await admin.rpc("complete_channel_sync", {
        p_connection_id: connection.id,
        p_lease_token: lease,
        p_started_at: started,
        p_error: failure,
      });
      if (error || data !== true) {
        if (!closed && zeroAvailability) {
          try {
            await close(true);
          } catch {
            throw new ChannexError("channel_inventory_closure_failed");
          }
        }
        throw new ChannexError("channel_sync_completion_failed");
      }
    }
  }
}

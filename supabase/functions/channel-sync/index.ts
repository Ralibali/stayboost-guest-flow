import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isCronAuthorized } from "../_shared/cron-auth.ts";
import {
  ChannexError,
  channexSecret,
  channexKeyForConnection,
  validChannexId,
  type ChannelConnection,
} from "../_shared/channex.ts";
import {
  channelError,
  channelFailureCode,
  channexClient,
  localChannelContext,
  pullChannelBookings,
  syncChannelAri,
} from "../_shared/channex-runtime.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,x-client-info,apikey,content-type,x-cron-secret",
};
Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  let body: { connectionId?: string; action?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const cron = await isCronAuthorized(admin, req.headers.get("x-cron-secret"));
  const action = body.action ?? (cron ? "cron" : "status");
  if (
    ![
      "cron",
      "status",
      "verify",
      "sync_ari",
      "pull_bookings",
      "sync_all",
      "register_webhook",
    ].includes(action)
  )
    return json({ error: "invalid_action" }, 400);
  if (action === "cron" && !cron) return json({ error: "unauthorized" }, 401);
  let ownerId: string | null = null;
  if (!cron) {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "unauthorized" }, 401);
    const user = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data, error } = await user.auth.getUser();
    if (error || !data.user) return json({ error: "unauthorized" }, 401);
    ownerId = data.user.id;
  }
  try {
    let connections: (ChannelConnection & { property: { owner_id: string; max_stay: number } })[];
    if (action === "cron") {
      const { data, error } = await admin
        .from("channel_connections")
        .select("*,property:properties!inner(owner_id,max_stay)")
        .eq("provider", "channex")
        .eq("enabled", true)
        .order("last_booking_sync_at", { ascending: true, nullsFirst: true })
        .limit(10);
      if (error) throw new ChannexError("channel_storage_error");
      connections = data ?? [];
    } else {
      if (!validChannexId(body.connectionId)) return json({ error: "invalid_connection" }, 400);
      const { data, error } = await admin
        .from("channel_connections")
        .select("*,property:properties!inner(owner_id,max_stay)")
        .eq("id", body.connectionId)
        .eq("provider", "channex")
        .maybeSingle();
      if (error) throw new ChannexError("channel_storage_error");
      if (!data || (!cron && data.property?.owner_id !== ownerId))
        return json({ error: "not_found" }, 404);
      connections = [data];
    }
    const results: Record<string, unknown>[] = [];
    const start = Date.now();
    for (const connection of connections) {
      if (Date.now() - start > 100_000) break;
      try {
        if (action === "status") {
          let apiConfigured = false;
          let propertyAuthorized = false;
          try {
            apiConfigured = Boolean(
              channexKeyForConnection(connection, (name) => Deno.env.get(name)),
            );
            propertyAuthorized = true;
          } catch {
            /* Server-only binding is required before any provider request. */
          }
          results.push({
            connectionId: connection.id,
            apiConfigured,
            propertyAuthorized,
            webhookConfigured: Boolean(
              channexSecret(connection.environment, (name) => Deno.env.get(name), "WEBHOOK_SECRET"),
            ),
            enabled: connection.enabled,
            lastBookingSyncAt: connection.last_booking_sync_at,
            lastAriSyncAt: connection.last_ari_sync_at,
            lastError: connection.last_error,
          });
          continue;
        }
        const client = channexClient(connection, (name) => Deno.env.get(name));
        if (action === "verify") {
          const today = new Date().toISOString().slice(0, 10);
          const context = await localChannelContext(admin, connection, today, "2099-12-31");
          if (
            !context.mappings.length ||
            context.units.some((u) => u.active && !context.mappings.some((m) => m.unit_id === u.id))
          )
            throw new ChannexError("channel_mapping_incomplete", 409);
          const verification = await client.verifyMappings(
            connection.external_property_id,
            context.mappings,
            context.units,
            Boolean(connection.fees_configured),
          );
          const channels = await client.channels(connection.external_property_id);
          let query = admin
            .from("channel_connections")
            .update({
              verified_at: new Date().toISOString(),
              last_error: channelFailureCode(connection, null),
            })
            .eq("id", connection.id)
            .eq("external_property_id", connection.external_property_id)
            .eq("environment", connection.environment);
          query = connection.sync_dirty_at
            ? query.eq("sync_dirty_at", connection.sync_dirty_at)
            : query.is("sync_dirty_at", null);
          const { data, error } = await query.select("id").maybeSingle();
          if (error || !data) throw new ChannexError("channel_mapping_changed", 409);
          results.push({ connectionId: connection.id, ok: true, ...verification, channels });
          continue;
        }
        if (action === "register_webhook") {
          if (!connection.verified_at) throw new ChannexError("channel_not_verified", 409);
          const secret = channexSecret(
            connection.environment,
            (name) => Deno.env.get(name),
            "WEBHOOK_SECRET",
          );
          if (!secret) throw new ChannexError("channex_webhook_not_configured", 409);
          const callback = `${Deno.env.get("SUPABASE_URL")!.replace(/\/$/, "")}/functions/v1/channex-webhook?environment=${connection.environment}`;
          const webhookId = await client.registerWebhook(
            connection.external_property_id,
            callback,
            secret,
          );
          const { data, error } = await admin
            .from("channel_connections")
            .update({ webhook_id: webhookId })
            .eq("id", connection.id)
            .eq("external_property_id", connection.external_property_id)
            .eq("environment", connection.environment)
            .eq("verified_at", connection.verified_at)
            .select("id")
            .maybeSingle();
          if (error || !data) throw new ChannexError("channel_mapping_changed", 409);
          results.push({ connectionId: connection.id, ok: true, webhookId });
          continue;
        }
        if (!connection.enabled) throw new ChannexError("connection_disabled", 409);
        const due =
          connection.sync_dirty_at ||
          !connection.last_ari_sync_at ||
          Date.now() - Date.parse(connection.last_ari_sync_at) > 24 * 3_600_000;
        const backoff =
          connection.next_retry_at && Date.parse(connection.next_retry_at) > Date.now();
        const sync =
          action === "sync_ari" || action === "sync_all" || (action === "cron" && due && !backoff);
        if (sync)
          results.push({
            connectionId: connection.id,
            ok: true,
            ...(await syncChannelAri(admin, connection, client)),
          });
        else if (!backoff || action === "pull_bookings")
          results.push({
            connectionId: connection.id,
            ok: true,
            ...(await pullChannelBookings(admin, connection, client)),
          });
        else results.push({ connectionId: connection.id, ok: true, skipped: "backoff" });
      } catch (error) {
        const code = channelError(error);
        await admin
          .from("channel_connections")
          .update({ last_error: channelFailureCode(connection, code) })
          .eq("id", connection.id);
        results.push({
          connectionId: connection.id,
          ok: false,
          error: code,
          status: error instanceof ChannexError ? error.status : 503,
        });
      }
    }
    const failed = results.some((r) => r.ok === false);
    return json({ ok: !failed, results }, failed ? 503 : 200);
  } catch (error) {
    return json({ error: channelError(error) }, error instanceof ChannexError ? error.status : 503);
  }
});

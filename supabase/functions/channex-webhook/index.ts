import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  ChannexError,
  channexSecret,
  receiveChannexRevision,
  validChannexId,
  webhookSecretValid,
  type ChannelConnection,
} from "../_shared/channex.ts";
import {
  channelError,
  channelFailureCode,
  channexClient,
  pullChannelBookings,
  revisionStore,
} from "../_shared/channex-runtime.ts";

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const environment = new URL(req.url).searchParams.get("environment");
  if (environment !== "staging" && environment !== "production")
    return json({ error: "invalid_environment" }, 400);
  const expected = channexSecret(environment, (name) => Deno.env.get(name), "WEBHOOK_SECRET");
  if (!expected) return json({ error: "webhook_not_configured" }, 503);
  if (!webhookSecretValid(req.headers.get("x-channex-webhook-secret"), expected))
    return json({ error: "unauthorized" }, 401);
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  if (!validChannexId(body?.property_id)) return json({ error: "invalid_property" }, 400);
  const events = [
    "booking",
    "booking_new",
    "booking_modification",
    "booking_cancellation",
    "booking_unmapped_room",
    "booking_unmapped_rate",
    "non_acked_booking",
  ];
  if (!events.includes(body?.event)) return json({ ok: true, ignored: "unsupported_event" });
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  let connection: ChannelConnection | null = null;
  try {
    const { data, error } = await admin
      .from("channel_connections")
      .select("*")
      .eq("provider", "channex")
      .eq("environment", environment)
      .eq("external_property_id", body.property_id)
      .maybeSingle();
    if (error) throw new ChannexError("channel_storage_error");
    if (!data) return json({ error: "not_found" }, 404);
    connection = data;
    if (!connection!.enabled) return json({ ok: true, ignored: "connection_disabled" });
    const client = channexClient(connection!, (name) => Deno.env.get(name));
    const revisionId = body.payload?.revision_id ?? body.payload?.booking_revision_id;
    if (!revisionId) {
      // send_data=false notifications are wakeups, never booking truth.
      const result = await pullChannelBookings(admin, connection!, client);
      return json({ ok: true, ...result });
    }
    if (!validChannexId(revisionId)) return json({ error: "invalid_revision_id" }, 400);
    const resource = await client.revision(revisionId);
    const result = await receiveChannexRevision(
      client,
      revisionStore(admin, connection!),
      connection!,
      resource,
    );
    return json({ ok: true, applied: result.applied, duplicate: result.duplicate ?? false });
  } catch (error) {
    if (connection)
      await admin
        .from("channel_connections")
        .update({ last_error: channelFailureCode(connection, channelError(error)) })
        .eq("id", connection.id);
    // Provider retries 5xx; do not acknowledge a revision that did not safely
    // commit locally or whose mapping is unresolved.
    return json({ error: channelError(error), retryable: true }, 503);
  }
});

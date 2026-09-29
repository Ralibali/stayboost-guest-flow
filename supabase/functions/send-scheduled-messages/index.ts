import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isCronAuthorized } from "../_shared/cron-auth.ts";
import { deliverScheduledMessage, MessageDeliveryError } from "../_shared/message-delivery.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,x-client-info,apikey,content-type,x-cron-secret",
};
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  if (!(await isCronAuthorized(admin, req.headers.get("x-cron-secret"))))
    return json({ error: "unauthorized" }, 401);
  // Only IDs are read here. The atomic dispatch RPC returns fresh, authorized
  // booking/template data after the lease has been acquired.
  const { data: due, error } = await admin
    .from("scheduled_messages")
    .select("id")
    .eq("status", "pending")
    .lte("send_at", new Date().toISOString())
    .order("send_at")
    .limit(50);
  if (error) return json({ error: "message_queue_read_failed" }, 503);
  const counts = { sent: 0, failed: 0, waitingContact: 0, waitingPayment: 0, skipped: 0 };
  const started = Date.now();
  try {
    for (const row of due ?? []) {
      if (Date.now() - started > 90_000) break;
      const result = await deliverScheduledMessage(admin, row.id, (name) => Deno.env.get(name));
      if (result === "waiting_contact") counts.waitingContact++;
      else if (result === "waiting_payment") counts.waitingPayment++;
      else if (result === "skipped") counts.skipped++;
      else counts[result]++;
    }
    return json({ due: due?.length ?? 0, ...counts });
  } catch (failure) {
    return json(
      {
        error:
          failure instanceof MessageDeliveryError ? failure.message : "message_delivery_failed",
        ...counts,
      },
      503,
    );
  }
});

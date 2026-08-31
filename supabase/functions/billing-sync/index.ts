import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isCronAuthorized } from "../_shared/cron-auth.ts";
import { syncBillingAccount } from "../_shared/saas-billing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const secret = req.headers.get("x-cron-secret") ?? "";
  if (!(await isCronAuthorized(admin, secret))) return json({ error: "unauthorized" }, 401);

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  if (!stripeKey) return json({ error: "stripe_not_configured" }, 503);

  const { data: accounts, error } = await admin
    .from("billing_accounts")
    .select("*")
    .or("stripe_subscription_id.not.is.null,stripe_checkout_session_id.not.is.null")
    .limit(500);
  if (error) return json({ error: error.message }, 500);

  let synced = 0;
  let failed = 0;
  const failures: Array<{ ownerId: string; error: string }> = [];

  for (const account of accounts ?? []) {
    try {
      await syncBillingAccount(admin, stripeKey, account);
      synced += 1;
    } catch (syncError) {
      failed += 1;
      const message = syncError instanceof Error ? syncError.message : String(syncError);
      failures.push({ ownerId: account.owner_id, error: message.slice(0, 300) });
      await admin
        .from("billing_accounts")
        .update({ last_error: message.slice(0, 1000), updated_at: new Date().toISOString() })
        .eq("owner_id", account.owner_id);
    }
  }

  return json({ ok: failed === 0, synced, failed, failures }, failed ? 500 : 200);
});

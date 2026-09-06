import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isCronAuthorized } from "../_shared/cron-auth.ts";
import { sendScheduledMessages, type MessageStore } from "../_shared/scheduled-messages.ts";

// Skickar förfallna meddelanden. Betalningsreservationer ägs av BP-3:s
// payment lifecycle och frigörs separat av ops-cron.

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

  const secret = req.headers.get("x-cron-secret");
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  if (!(await isCronAuthorized(admin, secret))) {
    return json({ error: "unauthorized" }, 401);
  }
  try {
    const result = await sendScheduledMessages(admin as unknown as MessageStore, {
      env: (name) => Deno.env.get(name),
      fetch,
      now: () => new Date(),
    });
    return json(result);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "message_worker_failed" }, 500);
  }
});

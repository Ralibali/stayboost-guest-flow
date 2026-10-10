import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  runStripeCheckoutDiagnostic,
  type DiagnosticClaim,
} from "../_shared/stripe-checkout-diagnostic.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
Deno.serve(async (req) => {
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!bearer) return json({ error: "not_authenticated" }, 401);
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const {
    data: { user },
    error: authError,
  } = await admin.auth.getUser(bearer);
  if (authError || !user) return json({ error: "not_authenticated" }, 401);
  let body: { propertyId: string };
  try {
    const raw = await req.text();
    if (raw.length > 1024) throw new Error();
    body = JSON.parse(raw);
    if (
      !body ||
      Object.keys(body).length !== 1 ||
      typeof body.propertyId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.propertyId)
    )
      throw new Error();
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  const { data: property, error } = await admin
    .from("properties")
    .select("id")
    .eq("id", body.propertyId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (error) return json({ error: "diagnostic_unavailable" }, 503);
  if (!property) return json({ error: "not_authorized" }, 403);
  const result = await runStripeCheckoutDiagnostic(
    user.id,
    property.id,
    (name) => Deno.env.get(name),
    {
      async claim(input) {
        const { data, error } = await admin.rpc("claim_stripe_checkout_diagnostic", {
          p_actor: input.actorId,
          p_property: input.propertyId,
          p_key_fingerprint: input.fingerprint,
          p_livemode: input.livemode,
          p_payment_method_configuration: input.paymentMethodConfiguration ?? null,
        });
        if (error || !data) throw new Error("diagnostic_unavailable");
        return data as DiagnosticClaim;
      },
      async finish(attempt, sessionId, outcome) {
        const { data, error } = await admin.rpc("finish_stripe_checkout_diagnostic", {
          p_attempt: attempt.id,
          p_lease: attempt.lease_id,
          p_session: sessionId,
          p_outcome: outcome,
        });
        if (error) throw new Error("diagnostic_unavailable");
        return data === true;
      },
    },
  );
  return json(result);
});

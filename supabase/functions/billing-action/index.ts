import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  STAYBOOST_APP_URL,
  STAYBOOST_CURRENCY,
  amountForInterval,
  ensureStripeCustomer,
  ensureSwedishVatRate,
  stripeForm,
  stripeRequest,
  syncBillingAccount,
  type BillingInterval,
} from "../_shared/saas-billing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ACTIVEISH = new Set(["trialing", "active", "past_due", "unpaid", "paused"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) return json({ error: "unauthorized" }, 401);

  let body: { action?: "status" | "checkout" | "portal"; interval?: BillingInterval };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  if (!body.action) return json({ error: "missing_action" }, 400);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";

  const { data: existing, error: readError } = await admin
    .from("billing_accounts")
    .select("*")
    .eq("owner_id", userData.user.id)
    .maybeSingle();
  if (readError) return json({ error: readError.message }, 500);

  let account = existing;
  if (account && stripeKey) {
    try {
      account = await syncBillingAccount(admin, stripeKey, account);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await admin
        .from("billing_accounts")
        .update({ last_error: message.slice(0, 1000), updated_at: new Date().toISOString() })
        .eq("owner_id", userData.user.id);
      if (body.action !== "status") return json({ error: "stripe_sync_failed", detail: message }, 502);
    }
  }

  if (body.action === "status") {
    return json({
      ok: true,
      stripeConfigured: Boolean(stripeKey),
      account:
        account ?? {
          owner_id: userData.user.id,
          status: "inactive",
          plan_interval: null,
          unit_amount: null,
          currency: STAYBOOST_CURRENCY,
          current_period_end: null,
          cancel_at_period_end: false,
          last_synced_at: null,
          last_error: null,
        },
    });
  }

  if (!stripeKey) return json({ error: "stripe_not_configured" }, 503);

  if (body.action === "checkout") {
    const interval: BillingInterval = body.interval === "year" ? "year" : "month";
    if (account && ACTIVEISH.has(account.status)) {
      return json({ error: "subscription_exists", status: account.status }, 409);
    }

    if (account?.stripe_checkout_session_id && !account.stripe_subscription_id) {
      try {
        const prior = await stripeRequest(
          stripeKey,
          `/checkout/sessions/${encodeURIComponent(String(account.stripe_checkout_session_id))}`,
        );
        if (prior.status === "open" && prior.url) return json({ ok: true, url: prior.url, reused: true });
      } catch {
        // En gammal/utgången checkout ska inte blockera ett nytt försök.
      }
    }

    const customerId = await ensureStripeCustomer({
      admin,
      stripeKey,
      ownerId: userData.user.id,
      email: userData.user.email ?? "",
      account,
    });
    const taxRateId = await ensureSwedishVatRate(stripeKey);
    const amount = amountForInterval(interval);
    const priceLabel = interval === "year" ? "StayBoost årsabonnemang" : "StayBoost månadsabonnemang";
    const idempotencyWindow = Math.floor(Date.now() / (30 * 60 * 1000));

    try {
      const session = await stripeRequest(stripeKey, "/checkout/sessions", {
        method: "POST",
        idempotencyKey: `stayboost-saas-checkout-${userData.user.id}-${interval}-${idempotencyWindow}`,
        body: stripeForm({
          mode: "subscription",
          customer: customerId,
          client_reference_id: userData.user.id,
          "line_items[0][price_data][currency]": STAYBOOST_CURRENCY,
          "line_items[0][price_data][unit_amount]": amount,
          "line_items[0][price_data][recurring][interval]": interval,
          "line_items[0][price_data][product_data][name]": priceLabel,
          "line_items[0][tax_rates][0]": taxRateId,
          "line_items[0][quantity]": 1,
          "subscription_data[metadata][stayboost_owner_id]": userData.user.id,
          "subscription_data[metadata][stayboost_plan_interval]": interval,
          "metadata[stayboost_owner_id]": userData.user.id,
          "metadata[stayboost_plan_interval]": interval,
          "tax_id_collection[enabled]": true,
          "customer_update[address]": "auto",
          "customer_update[name]": "auto",
          success_url: `${STAYBOOST_APP_URL}/app/installningar?billing=success`,
          cancel_url: `${STAYBOOST_APP_URL}/app/installningar?billing=cancelled`,
        }),
      });

      const now = new Date().toISOString();
      const { error } = await admin.from("billing_accounts").upsert(
        {
          owner_id: userData.user.id,
          stripe_customer_id: customerId,
          stripe_checkout_session_id: session.id,
          stripe_subscription_id: null,
          status: "inactive",
          plan_interval: interval,
          unit_amount: amount,
          currency: STAYBOOST_CURRENCY,
          current_period_end: null,
          cancel_at_period_end: false,
          last_synced_at: now,
          last_error: null,
          updated_at: now,
        },
        { onConflict: "owner_id" },
      );
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, url: session.url });
    } catch (error) {
      return json(
        {
          error: "checkout_failed",
          detail: error instanceof Error ? error.message : String(error),
        },
        502,
      );
    }
  }

  if (body.action === "portal") {
    if (!account?.stripe_customer_id) return json({ error: "no_billing_account" }, 404);
    try {
      const portal = await stripeRequest(stripeKey, "/billing_portal/sessions", {
        method: "POST",
        body: stripeForm({
          customer: account.stripe_customer_id,
          return_url: `${STAYBOOST_APP_URL}/app/installningar?billing=returned`,
        }),
      });
      return json({ ok: true, url: portal.url });
    } catch (error) {
      return json(
        { error: "portal_failed", detail: error instanceof Error ? error.message : String(error) },
        502,
      );
    }
  }

  return json({ error: "unknown_action" }, 400);
});

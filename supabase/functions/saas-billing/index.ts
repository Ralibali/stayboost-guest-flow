import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createSaasCheckout, createSaasCustomer, createSaasPortal } from "../_shared/saas-stripe.ts";

type Action = "status" | "checkout" | "portal";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const paidStatuses = new Set(["trialing", "active"]);

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
  const user = userData?.user;
  if (userError || !user) return json({ error: "unauthorized" }, 401);

  let body: { action?: Action };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  if (!body.action || !["status", "checkout", "portal"].includes(body.action)) {
    return json({ error: "invalid_action" }, 400);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: subscription, error: readError } = await admin
    .from("account_subscriptions")
    .select(
      "owner_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, status, current_period_end, cancel_at_period_end, updated_at",
    )
    .eq("owner_id", user.id)
    .maybeSingle();
  if (readError) return json({ error: "billing_state_unavailable" }, 500);

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  const priceId = Deno.env.get("STAYBOOST_STRIPE_PRICE_MONTHLY") ?? "";
  const publicAppUrl = (Deno.env.get("PUBLIC_APP_URL") ?? "").replace(/\/$/, "");
  const billingEnabled =
    Deno.env.get("SAAS_BILLING_ENABLED") === "true" &&
    Boolean(stripeKey && priceId && publicAppUrl);

  if (body.action === "status") {
    return json({
      enabled: billingEnabled,
      subscription: subscription
        ? {
            status: subscription.status,
            currentPeriodEnd: subscription.current_period_end,
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
            hasCustomer: Boolean(subscription.stripe_customer_id),
            hasSubscription: Boolean(subscription.stripe_subscription_id),
          }
        : null,
    });
  }

  if (!billingEnabled) return json({ error: "billing_disabled" }, 409);

  if (body.action === "checkout") {
    if (subscription && paidStatuses.has(subscription.status)) {
      return json({ error: "already_subscribed" }, 409);
    }
    if (!user.email) return json({ error: "email_required" }, 400);

    let customerId = subscription?.stripe_customer_id ?? null;
    if (!customerId) {
      const customer = await createSaasCustomer({
        secretKey: stripeKey,
        email: user.email,
        ownerId: user.id,
      });
      customerId = customer.id;
      const { error: upsertError } = await admin.from("account_subscriptions").upsert(
        {
          owner_id: user.id,
          stripe_customer_id: customerId,
          status: subscription?.status ?? "inactive",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "owner_id" },
      );
      if (upsertError) return json({ error: "billing_state_write_failed" }, 500);
    }

    const checkout = await createSaasCheckout({
      secretKey: stripeKey,
      customerId,
      ownerId: user.id,
      priceId,
      successUrl: `${publicAppUrl}/app/installningar?billing=success`,
      cancelUrl: `${publicAppUrl}/app/installningar?billing=cancelled`,
    });
    return json({ url: checkout.url });
  }

  const customerId = subscription?.stripe_customer_id;
  if (!customerId) return json({ error: "no_billing_customer" }, 404);
  const portal = await createSaasPortal({
    secretKey: stripeKey,
    customerId,
    returnUrl: `${publicAppUrl}/app/installningar`,
  });
  return json({ url: portal.url });
});

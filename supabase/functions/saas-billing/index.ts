import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  createSaasCheckout,
  createSaasCustomer,
  createSaasPortal,
  ensureSaasPortalConfiguration,
  ensureSwedishVatRate,
  findOpenSaasCheckout,
  listOwnerSaasSubscriptions,
  subscriptionStripeDetails,
  type BillingInterval,
  type SaasStripeSubscription,
} from "../_shared/saas-stripe.ts";

type Action = "status" | "checkout" | "portal";
type Admin = ReturnType<typeof createClient>;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const existingSubscriptionStatuses = new Set([
  "trialing",
  "active",
  "past_due",
  "unpaid",
  "paused",
  "incomplete",
]);

function unixToIso(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value * 1000).toISOString()
    : null;
}

function safePublicAppUrl(value: string | undefined) {
  if (!value) return "https://stayboost.se";
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.origin : "https://stayboost.se";
  } catch {
    return "https://stayboost.se";
  }
}

async function persistSubscription(admin: Admin, ownerId: string, subscription: SaasStripeSubscription) {
  const details = subscriptionStripeDetails(subscription);
  if (!details.customerId) throw new Error("Stripe-abonnemanget saknar customer");

  const { data, error } = await admin
    .from("account_subscriptions")
    .upsert(
      {
        owner_id: ownerId,
        stripe_customer_id: details.customerId,
        stripe_subscription_id: subscription.id,
        stripe_price_id: details.priceId,
        status: subscription.status,
        current_period_end: unixToIso(subscription.current_period_end),
        cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_id" },
    )
    .select(
      "owner_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, status, current_period_end, cancel_at_period_end, updated_at",
    )
    .single();
  if (error) throw error;
  return { row: data, details };
}

async function syncFromStripe(
  admin: Admin,
  stripeKey: string,
  ownerId: string,
  customerId: string | null,
) {
  if (!customerId) return null;
  const subscriptions = await listOwnerSaasSubscriptions({
    secretKey: stripeKey,
    customerId,
    ownerId,
  });
  const subscription = subscriptions[0] ?? null;
  if (!subscription) return null;
  const persisted = await persistSubscription(admin, ownerId, subscription);
  return { subscription, ...persisted };
}

function publicSubscription(
  row: Record<string, unknown> | null | undefined,
  stripeSubscription?: SaasStripeSubscription | null,
) {
  if (!row) return null;
  const details = stripeSubscription ? subscriptionStripeDetails(stripeSubscription) : null;
  return {
    status: String(row.status ?? "inactive"),
    currentPeriodEnd: (row.current_period_end as string | null | undefined) ?? null,
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    hasCustomer: Boolean(row.stripe_customer_id),
    hasSubscription: Boolean(row.stripe_subscription_id),
    planInterval: details?.planInterval ?? null,
    unitAmount: details?.unitAmount ?? null,
    currency: details?.currency ?? "sek",
  };
}

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

  let body: { action?: Action; interval?: BillingInterval };
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
  const { data: stored, error: readError } = await admin
    .from("account_subscriptions")
    .select(
      "owner_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, status, current_period_end, cancel_at_period_end, updated_at",
    )
    .eq("owner_id", user.id)
    .maybeSingle();
  if (readError) return json({ error: "billing_state_unavailable" }, 500);

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  const publicAppUrl = safePublicAppUrl(Deno.env.get("PUBLIC_APP_URL"));
  let subscriptionState = stored;
  let stripeSubscription: SaasStripeSubscription | null = null;

  if (stripeKey && stored?.stripe_customer_id) {
    try {
      const synced = await syncFromStripe(admin, stripeKey, user.id, stored.stripe_customer_id);
      if (synced) {
        subscriptionState = synced.row;
        stripeSubscription = synced.subscription;
      } else if (stored.stripe_subscription_id) {
        const { data: cleared, error: clearError } = await admin
          .from("account_subscriptions")
          .update({
            stripe_subscription_id: null,
            stripe_price_id: null,
            status: "inactive",
            current_period_end: null,
            cancel_at_period_end: false,
            updated_at: new Date().toISOString(),
          })
          .eq("owner_id", user.id)
          .select(
            "owner_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, status, current_period_end, cancel_at_period_end, updated_at",
          )
          .single();
        if (clearError) throw clearError;
        subscriptionState = cleared;
      }
    } catch (error) {
      console.error("SaaS billing sync failed", error);
      if (body.action !== "status") return json({ error: "billing_sync_failed" }, 502);
    }
  }

  if (body.action === "status") {
    return json({
      enabled: Boolean(stripeKey),
      subscription: publicSubscription(subscriptionState, stripeSubscription),
    });
  }

  if (!stripeKey) return json({ error: "billing_not_configured" }, 503);

  if (body.action === "checkout") {
    const interval: BillingInterval = body.interval === "year" ? "year" : "month";
    if (subscriptionState && existingSubscriptionStatuses.has(subscriptionState.status)) {
      return json({ error: "already_subscribed", status: subscriptionState.status }, 409);
    }
    if (!user.email) return json({ error: "email_required" }, 400);

    let customerId = subscriptionState?.stripe_customer_id ?? null;
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
          status: subscriptionState?.status ?? "inactive",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "owner_id" },
      );
      if (upsertError) return json({ error: "billing_state_write_failed" }, 500);
    }

    const openCheckout = await findOpenSaasCheckout({
      secretKey: stripeKey,
      customerId,
      ownerId: user.id,
      interval,
    });
    if (openCheckout?.url) return json({ url: openCheckout.url, reused: true });

    try {
      const taxRateId = await ensureSwedishVatRate(stripeKey);
      const checkout = await createSaasCheckout({
        secretKey: stripeKey,
        customerId,
        ownerId: user.id,
        interval,
        taxRateId,
        successUrl: `${publicAppUrl}/app/installningar?billing=success`,
        cancelUrl: `${publicAppUrl}/app/installningar?billing=cancelled`,
      });
      return json({ url: checkout.url });
    } catch (error) {
      console.error("SaaS checkout failed", error);
      return json({ error: "checkout_failed" }, 502);
    }
  }

  const customerId = subscriptionState?.stripe_customer_id;
  if (!customerId) return json({ error: "no_billing_customer" }, 404);
  try {
    const returnUrl = `${publicAppUrl}/app/installningar?billing=returned`;
    const configurationId = await ensureSaasPortalConfiguration({
      secretKey: stripeKey,
      returnUrl,
    });
    const portal = await createSaasPortal({
      secretKey: stripeKey,
      customerId,
      returnUrl,
      configurationId,
    });
    return json({ url: portal.url });
  } catch (error) {
    console.error("SaaS customer portal failed", error);
    return json({ error: "portal_failed" }, 502);
  }
});

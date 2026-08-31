import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  isAllowedSaasSubscriptionPrice,
  retrieveSaasSubscription,
  subscriptionStripeDetails,
  type SaasStripeSubscription,
} from "../_shared/saas-stripe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Admin = ReturnType<typeof createClient>;

type BillingRow = {
  owner_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  created_at: string;
  updated_at: string;
};

async function listAllUsers(admin: Admin) {
  const users: Array<{ id: string; email?: string; created_at?: string; last_sign_in_at?: string }> = [];
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const batch = data.users ?? [];
    users.push(
      ...batch.map((user) => ({
        id: user.id,
        email: user.email,
        created_at: user.created_at,
        last_sign_in_at: user.last_sign_in_at,
      })),
    );
    if (batch.length < 1000) break;
  }
  return users;
}

async function getLiveSubscription(stripeKey: string, row: BillingRow) {
  if (!stripeKey || !row.stripe_subscription_id) return null;
  try {
    const subscription = await retrieveSaasSubscription(stripeKey, row.stripe_subscription_id);
    if (
      subscription.metadata?.product !== "stayboost" ||
      subscription.metadata?.owner_id !== row.owner_id ||
      !isAllowedSaasSubscriptionPrice(subscription)
    ) {
      return null;
    }
    return subscription;
  } catch (error) {
    console.error("Platform admin Stripe sync failed", row.owner_id, error);
    return null;
  }
}

function normalizedSubscription(row: BillingRow | null, live: SaasStripeSubscription | null) {
  if (!row) return null;
  const details = live ? subscriptionStripeDetails(live) : null;
  return {
    status: live?.status ?? row.status,
    planInterval: details?.planInterval ?? null,
    unitAmount: details?.unitAmount ?? null,
    currency: details?.currency ?? "sek",
    currentPeriodEnd:
      live?.current_period_end && Number.isFinite(live.current_period_end)
        ? new Date(live.current_period_end * 1000).toISOString()
        : row.current_period_end,
    cancelAtPeriodEnd: live ? Boolean(live.cancel_at_period_end) : row.cancel_at_period_end,
    stripeVerified: Boolean(live),
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
  if (userError || !userData.user) return json({ error: "unauthorized" }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: access, error: accessError } = await admin
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (accessError) return json({ error: "admin_access_unavailable" }, 500);
  if (!access) return json({ error: "forbidden" }, 403);

  let body: { action?: "overview" };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  if (body.action !== "overview") return json({ error: "invalid_action" }, 400);

  const [users, propertiesRes, billingRes, alertsRes, cronRes, bookingCountRes] = await Promise.all([
    listAllUsers(admin),
    admin.from("properties").select("id,owner_id,name,slug,created_at").order("created_at"),
    admin
      .from("account_subscriptions")
      .select(
        "owner_id,stripe_customer_id,stripe_subscription_id,status,current_period_end,cancel_at_period_end,created_at,updated_at",
      )
      .order("created_at"),
    admin.from("operational_alerts").select("severity").is("resolved_at", null),
    admin
      .from("ops_job_state")
      .select("last_succeeded_at,last_failed_at,last_error")
      .eq("job_name", "ops-cron")
      .maybeSingle(),
    admin.from("bookings").select("id", { count: "exact", head: true }),
  ]);

  const firstError =
    propertiesRes.error ?? billingRes.error ?? alertsRes.error ?? cronRes.error ?? bookingCountRes.error;
  if (firstError) return json({ error: "admin_data_unavailable", detail: firstError.message }, 500);

  const billingRows = (billingRes.data ?? []) as BillingRow[];
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  const liveByOwner = new Map<string, SaasStripeSubscription | null>();
  const liveResults = await Promise.all(
    billingRows.map(async (row) => [row.owner_id, await getLiveSubscription(stripeKey, row)] as const),
  );
  for (const [ownerId, subscription] of liveResults) liveByOwner.set(ownerId, subscription);

  const billingByOwner = new Map(billingRows.map((row) => [row.owner_id, row]));
  const propertiesByOwner = new Map<string, Array<{ id: string; name: string; slug: string }>>();
  for (const property of propertiesRes.data ?? []) {
    const list = propertiesByOwner.get(property.owner_id) ?? [];
    list.push({ id: property.id, name: property.name, slug: property.slug });
    propertiesByOwner.set(property.owner_id, list);
  }

  const customers = users
    .map((user) => {
      const billingRow = billingByOwner.get(user.id) ?? null;
      return {
        id: user.id,
        email: user.email ?? null,
        createdAt: user.created_at ?? null,
        lastSignInAt: user.last_sign_in_at ?? null,
        properties: propertiesByOwner.get(user.id) ?? [],
        subscription: normalizedSubscription(billingRow, liveByOwner.get(user.id) ?? null),
      };
    })
    .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));

  const subscriptions = customers.map((customer) => customer.subscription).filter(Boolean);
  const active = subscriptions.filter((subscription) => subscription!.status === "active");
  const trials = subscriptions.filter((subscription) => subscription!.status === "trialing");
  const pastDue = subscriptions.filter((subscription) =>
    ["past_due", "unpaid", "incomplete"].includes(subscription!.status),
  );
  const canceling = subscriptions.filter(
    (subscription) =>
      ["active", "trialing"].includes(subscription!.status) && subscription!.cancelAtPeriodEnd,
  );
  const mrrOre = active.reduce((sum, subscription) => {
    if (!subscription!.unitAmount) return sum;
    return (
      sum +
      (subscription!.planInterval === "year"
        ? subscription!.unitAmount / 12
        : subscription!.planInterval === "month"
          ? subscription!.unitAmount
          : 0)
    );
  }, 0);
  const alerts = alertsRes.data ?? [];
  const criticalAlerts = alerts.filter((alert) => alert.severity === "critical").length;
  const stripeUnverified = subscriptions.filter(
    (subscription) => subscription!.status !== "inactive" && !subscription!.stripeVerified,
  ).length;

  return json({
    ok: true,
    metrics: {
      users: users.length,
      properties: propertiesRes.data?.length ?? 0,
      bookings: bookingCountRes.count ?? 0,
      activeSubscriptions: active.length,
      trials: trials.length,
      paymentProblems: pastDue.length,
      canceling: canceling.length,
      mrrSek: Math.round(mrrOre) / 100,
      arrSek: Math.round(mrrOre * 12) / 100,
    },
    health: {
      openAlerts: alerts.length,
      criticalAlerts,
      stripeUnverified,
      cronLastSucceededAt: cronRes.data?.last_succeeded_at ?? null,
      cronLastFailedAt: cronRes.data?.last_failed_at ?? null,
      cronLastError: cronRes.data?.last_error ?? null,
    },
    customers,
  });
});

export const STAYBOOST_MONTHLY_ORE = 44_900;
export const STAYBOOST_ANNUAL_ORE = 449_000;
export const STAYBOOST_CURRENCY = "sek";
export const STAYBOOST_APP_URL = "https://stayboost.se";

export type BillingInterval = "month" | "year";
export type BillingStatus =
  | "inactive"
  | "incomplete"
  | "incomplete_expired"
  | "trialing"
  | "active"
  | "past_due"
  | "unpaid"
  | "paused"
  | "canceled";

type Admin = any;

type StripeObject = Record<string, any>;

export class StripeApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function stripeForm(values: Record<string, string | number | boolean | null | undefined>) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    body.set(key, String(value));
  }
  return body;
}

export async function stripeRequest(
  secretKey: string,
  path: string,
  options: { method?: "GET" | "POST"; body?: URLSearchParams; idempotencyKey?: string } = {},
): Promise<StripeObject> {
  const headers: Record<string, string> = { Authorization: `Bearer ${secretKey}` };
  if (options.body) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new StripeApiError(
      payload?.error?.message ?? `Stripe HTTP ${response.status}`,
      response.status,
      payload?.error?.code,
    );
  }
  return payload;
}

export function amountForInterval(interval: BillingInterval) {
  return interval === "year" ? STAYBOOST_ANNUAL_ORE : STAYBOOST_MONTHLY_ORE;
}

export async function ensureStripeCustomer(args: {
  admin: Admin;
  stripeKey: string;
  ownerId: string;
  email: string;
  account?: StripeObject | null;
}) {
  const { admin, stripeKey, ownerId, email } = args;
  if (args.account?.stripe_customer_id) return String(args.account.stripe_customer_id);

  const customer = await stripeRequest(stripeKey, "/customers", {
    method: "POST",
    idempotencyKey: `stayboost-saas-customer-${ownerId}`,
    body: stripeForm({
      email,
      "metadata[stayboost_owner_id]": ownerId,
      description: "StayBoost SaaS customer",
    }),
  });

  const now = new Date().toISOString();
  const { error } = await admin.from("billing_accounts").upsert(
    {
      owner_id: ownerId,
      stripe_customer_id: customer.id,
      updated_at: now,
      last_error: null,
    },
    { onConflict: "owner_id" },
  );
  if (error) throw error;
  return String(customer.id);
}

export async function ensureSwedishVatRate(stripeKey: string) {
  const list = await stripeRequest(stripeKey, "/tax_rates?active=true&limit=100");
  const existing = (list.data ?? []).find(
    (rate: any) =>
      Number(rate.percentage) === 25 && rate.inclusive === false && String(rate.country ?? "") === "SE",
  );
  if (existing?.id) return String(existing.id);

  const rate = await stripeRequest(stripeKey, "/tax_rates", {
    method: "POST",
    idempotencyKey: "stayboost-swedish-vat-25",
    body: stripeForm({
      display_name: "Moms",
      description: "Svensk moms 25% för StayBoost-abonnemang",
      jurisdiction: "SE",
      country: "SE",
      percentage: 25,
      inclusive: false,
      "metadata[stayboost]": "saas_subscription",
    }),
  });
  return String(rate.id);
}

function normalizeStatus(status: string | null | undefined): BillingStatus {
  const allowed: BillingStatus[] = [
    "incomplete",
    "incomplete_expired",
    "trialing",
    "active",
    "past_due",
    "unpaid",
    "paused",
    "canceled",
  ];
  return allowed.includes(status as BillingStatus) ? (status as BillingStatus) : "inactive";
}

export async function syncBillingAccount(admin: Admin, stripeKey: string, account: StripeObject) {
  let subscriptionId = account?.stripe_subscription_id ? String(account.stripe_subscription_id) : "";

  if (!subscriptionId && account?.stripe_checkout_session_id) {
    try {
      const checkout = await stripeRequest(
        stripeKey,
        `/checkout/sessions/${encodeURIComponent(String(account.stripe_checkout_session_id))}`,
      );
      if (checkout.subscription) subscriptionId = String(checkout.subscription);
    } catch (error) {
      if (!(error instanceof StripeApiError) || error.status !== 404) throw error;
    }
  }

  if (!subscriptionId) return account;

  try {
    const subscription = await stripeRequest(
      stripeKey,
      `/subscriptions/${encodeURIComponent(subscriptionId)}`,
    );
    const status = normalizeStatus(subscription.status);
    const periodEnd = subscription.current_period_end
      ? new Date(Number(subscription.current_period_end) * 1000).toISOString()
      : null;
    const now = new Date().toISOString();
    const patch = {
      stripe_subscription_id: subscriptionId,
      status,
      current_period_end: periodEnd,
      cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
      last_synced_at: now,
      last_error: null,
      updated_at: now,
    };
    const { data, error } = await admin
      .from("billing_accounts")
      .update(patch)
      .eq("owner_id", account.owner_id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  } catch (error) {
    if (error instanceof StripeApiError && error.status === 404) {
      const now = new Date().toISOString();
      const { data, error: dbError } = await admin
        .from("billing_accounts")
        .update({
          status: "canceled",
          current_period_end: null,
          cancel_at_period_end: false,
          last_synced_at: now,
          last_error: null,
          updated_at: now,
        })
        .eq("owner_id", account.owner_id)
        .select("*")
        .single();
      if (dbError) throw dbError;
      return data;
    }
    throw error;
  }
}

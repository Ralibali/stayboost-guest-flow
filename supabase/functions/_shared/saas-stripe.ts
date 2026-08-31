export type BillingInterval = "month" | "year";

export const STAYBOOST_MONTHLY_ORE = 44_900;
export const STAYBOOST_ANNUAL_ORE = 449_000;
export const STAYBOOST_CURRENCY = "sek";

export type SaasStripeSubscription = {
  id: string;
  customer: string | { id?: string };
  status: string;
  current_period_end: number | null;
  cancel_at_period_end: boolean;
  created?: number;
  metadata?: Record<string, string>;
  items?: {
    data?: Array<{
      price?: {
        id?: string;
        unit_amount?: number | null;
        currency?: string;
        recurring?: { interval?: string } | null;
      };
    }>;
  };
};

type StripeList<T> = { data?: T[] };
type StripeTaxRate = {
  id: string;
  active?: boolean;
  percentage?: number;
  inclusive?: boolean;
  country?: string | null;
  metadata?: Record<string, string>;
};
type StripeCheckoutSession = {
  id: string;
  url?: string | null;
  status?: string | null;
  mode?: string | null;
  client_reference_id?: string | null;
  customer?: string | { id?: string } | null;
  subscription?: string | { id?: string } | null;
  metadata?: Record<string, string>;
};
type StripePortalConfiguration = {
  id: string;
  active?: boolean;
  metadata?: Record<string, string>;
};

function stringId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value && typeof value.id === "string") {
    return value.id;
  }
  return null;
}

async function stripeRequest<T>(params: {
  secretKey: string;
  path: string;
  method?: "GET" | "POST";
  body?: URLSearchParams;
  idempotencyKey?: string;
}): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${params.secretKey}`,
  };
  if (params.body) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (params.idempotencyKey) headers["Idempotency-Key"] = params.idempotencyKey;

  const response = await fetch(`https://api.stripe.com${params.path}`, {
    method: params.method ?? "POST",
    headers,
    body: params.body?.toString(),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error?.message ?? `Stripe svarade ${response.status}`);
  }
  return data as T;
}

export function amountForInterval(interval: BillingInterval) {
  return interval === "year" ? STAYBOOST_ANNUAL_ORE : STAYBOOST_MONTHLY_ORE;
}

export function subscriptionStripeDetails(subscription: SaasStripeSubscription) {
  const price = subscription.items?.data?.[0]?.price;
  return {
    priceId: price?.id ?? null,
    planInterval:
      price?.recurring?.interval === "year"
        ? ("year" as const)
        : price?.recurring?.interval === "month"
          ? ("month" as const)
          : null,
    unitAmount: price?.unit_amount ?? null,
    currency: price?.currency ?? null,
    customerId: stringId(subscription.customer),
  };
}

export function isAllowedSaasSubscriptionPrice(subscription: SaasStripeSubscription) {
  const details = subscriptionStripeDetails(subscription);
  if (details.currency !== STAYBOOST_CURRENCY) return false;
  return (
    (details.planInterval === "month" && details.unitAmount === STAYBOOST_MONTHLY_ORE) ||
    (details.planInterval === "year" && details.unitAmount === STAYBOOST_ANNUAL_ORE)
  );
}

export async function createSaasCustomer(params: {
  secretKey: string;
  email: string;
  ownerId: string;
}): Promise<{ id: string }> {
  const body = new URLSearchParams();
  body.set("email", params.email);
  body.set("metadata[owner_id]", params.ownerId);
  body.set("metadata[product]", "stayboost");
  return stripeRequest<{ id: string }>({
    secretKey: params.secretKey,
    path: "/v1/customers",
    body,
    idempotencyKey: `stayboost-customer-${params.ownerId}`,
  });
}

export async function ensureSwedishVatRate(secretKey: string): Promise<string> {
  const rates = await stripeRequest<StripeList<StripeTaxRate>>({
    secretKey,
    path: "/v1/tax_rates?active=true&limit=100",
    method: "GET",
  });
  const existing = (rates.data ?? []).find(
    (rate) =>
      rate.active !== false &&
      Number(rate.percentage) === 25 &&
      rate.inclusive === false &&
      rate.country === "SE" &&
      rate.metadata?.product === "stayboost" &&
      rate.metadata?.purpose === "saas_subscription",
  );
  if (existing) return existing.id;

  const body = new URLSearchParams();
  body.set("display_name", "Moms");
  body.set("description", "StayBoost abonnemang — svensk moms 25 %");
  body.set("jurisdiction", "SE");
  body.set("country", "SE");
  body.set("percentage", "25");
  body.set("inclusive", "false");
  body.set("tax_type", "vat");
  body.set("metadata[product]", "stayboost");
  body.set("metadata[purpose]", "saas_subscription");
  const rate = await stripeRequest<StripeTaxRate>({
    secretKey,
    path: "/v1/tax_rates",
    body,
    idempotencyKey: "stayboost-saas-vat-se-25",
  });
  return rate.id;
}

export async function findOpenSaasCheckout(params: {
  secretKey: string;
  customerId: string;
  ownerId: string;
  interval: BillingInterval;
}): Promise<StripeCheckoutSession | null> {
  const query = new URLSearchParams({
    customer: params.customerId,
    status: "open",
    limit: "20",
  });
  const sessions = await stripeRequest<StripeList<StripeCheckoutSession>>({
    secretKey: params.secretKey,
    path: `/v1/checkout/sessions?${query.toString()}`,
    method: "GET",
  });
  return (
    (sessions.data ?? []).find(
      (session) =>
        session.mode === "subscription" &&
        session.client_reference_id === params.ownerId &&
        session.metadata?.product === "stayboost" &&
        session.metadata?.owner_id === params.ownerId &&
        session.metadata?.plan_interval === params.interval &&
        Boolean(session.url),
    ) ?? null
  );
}

export async function createSaasCheckout(params: {
  secretKey: string;
  customerId: string;
  ownerId: string;
  interval: BillingInterval;
  taxRateId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ id: string; url: string }> {
  const amount = amountForInterval(params.interval);
  const body = new URLSearchParams();
  body.set("mode", "subscription");
  body.set("customer", params.customerId);
  body.set("client_reference_id", params.ownerId);
  body.set("success_url", params.successUrl);
  body.set("cancel_url", params.cancelUrl);
  body.set("payment_method_types[0]", "card");
  body.set("locale", "sv");
  body.set("billing_address_collection", "required");
  body.set("tax_id_collection[enabled]", "true");
  body.set("customer_update[address]", "auto");
  body.set("customer_update[name]", "auto");
  body.set("line_items[0][price_data][currency]", STAYBOOST_CURRENCY);
  body.set("line_items[0][price_data][unit_amount]", String(amount));
  body.set("line_items[0][price_data][tax_behavior]", "exclusive");
  body.set("line_items[0][price_data][recurring][interval]", params.interval);
  body.set("line_items[0][price_data][product_data][name]", "StayBoost");
  body.set(
    "line_items[0][price_data][product_data][description]",
    "StayBoost-abonnemang inklusive SMS utan separat SMS-kostnad",
  );
  body.set("line_items[0][price_data][product_data][metadata][product]", "stayboost");
  body.set("line_items[0][tax_rates][0]", params.taxRateId);
  body.set("line_items[0][quantity]", "1");
  body.set("metadata[owner_id]", params.ownerId);
  body.set("metadata[product]", "stayboost");
  body.set("metadata[plan_interval]", params.interval);
  body.set("subscription_data[metadata][owner_id]", params.ownerId);
  body.set("subscription_data[metadata][product]", "stayboost");
  body.set("subscription_data[metadata][plan_interval]", params.interval);
  body.set(
    "subscription_data[description]",
    params.interval === "year"
      ? "StayBoost årsabonnemang — SMS ingår"
      : "StayBoost månadsabonnemang — SMS ingår",
  );

  const idempotencyWindow = Math.floor(Date.now() / (30 * 60 * 1000));
  return stripeRequest<{ id: string; url: string }>({
    secretKey: params.secretKey,
    path: "/v1/checkout/sessions",
    body,
    idempotencyKey: `stayboost-saas-checkout-${params.ownerId}-${params.interval}-${idempotencyWindow}`,
  });
}

export async function listOwnerSaasSubscriptions(params: {
  secretKey: string;
  customerId: string;
  ownerId: string;
}): Promise<SaasStripeSubscription[]> {
  const query = new URLSearchParams({ customer: params.customerId, status: "all", limit: "20" });
  const subscriptions = await stripeRequest<StripeList<SaasStripeSubscription>>({
    secretKey: params.secretKey,
    path: `/v1/subscriptions?${query.toString()}`,
    method: "GET",
  });
  return (subscriptions.data ?? [])
    .filter(
      (subscription) =>
        subscription.metadata?.product === "stayboost" &&
        subscription.metadata?.owner_id === params.ownerId &&
        isAllowedSaasSubscriptionPrice(subscription),
    )
    .sort((a, b) => Number(b.created ?? 0) - Number(a.created ?? 0));
}

export async function ensureSaasPortalConfiguration(params: {
  secretKey: string;
  returnUrl: string;
}): Promise<string> {
  const configurations = await stripeRequest<StripeList<StripePortalConfiguration>>({
    secretKey: params.secretKey,
    path: "/v1/billing_portal/configurations?active=true&limit=100",
    method: "GET",
  });
  const existing = (configurations.data ?? []).find(
    (configuration) =>
      configuration.active !== false &&
      configuration.metadata?.product === "stayboost" &&
      configuration.metadata?.purpose === "customer_self_service",
  );
  if (existing) return existing.id;

  const body = new URLSearchParams();
  body.set("name", "StayBoost kundportal");
  body.set("default_return_url", params.returnUrl);
  body.set("business_profile[headline]", "Hantera ditt StayBoost-abonnemang");
  body.set("business_profile[privacy_policy_url]", "https://stayboost.se/integritetspolicy");
  body.set("business_profile[terms_of_service_url]", "https://stayboost.se/villkor");
  body.set("features[customer_update][enabled]", "true");
  body.set("features[customer_update][allowed_updates][0]", "address");
  body.set("features[customer_update][allowed_updates][1]", "name");
  body.set("features[customer_update][allowed_updates][2]", "tax_id");
  body.set("features[invoice_history][enabled]", "true");
  body.set("features[payment_method_update][enabled]", "true");
  body.set("features[subscription_cancel][enabled]", "true");
  body.set("features[subscription_cancel][mode]", "at_period_end");
  body.set("features[subscription_cancel][proration_behavior]", "none");
  body.set("features[subscription_cancel][cancellation_reason][enabled]", "true");
  body.set(
    "features[subscription_cancel][cancellation_reason][options][0]",
    "too_expensive",
  );
  body.set(
    "features[subscription_cancel][cancellation_reason][options][1]",
    "missing_features",
  );
  body.set("features[subscription_cancel][cancellation_reason][options][2]", "unused");
  body.set("features[subscription_cancel][cancellation_reason][options][3]", "other");
  body.set("metadata[product]", "stayboost");
  body.set("metadata[purpose]", "customer_self_service");

  const configuration = await stripeRequest<StripePortalConfiguration>({
    secretKey: params.secretKey,
    path: "/v1/billing_portal/configurations",
    body,
    idempotencyKey: "stayboost-saas-customer-portal-config-v1",
  });
  return configuration.id;
}

export async function createSaasPortal(params: {
  secretKey: string;
  customerId: string;
  returnUrl: string;
  configurationId: string;
}): Promise<{ url: string }> {
  const body = new URLSearchParams();
  body.set("customer", params.customerId);
  body.set("return_url", params.returnUrl);
  body.set("configuration", params.configurationId);
  return stripeRequest<{ url: string }>({
    secretKey: params.secretKey,
    path: "/v1/billing_portal/sessions",
    body,
  });
}

export async function retrieveSaasSubscription(
  secretKey: string,
  subscriptionId: string,
): Promise<SaasStripeSubscription> {
  return stripeRequest<SaasStripeSubscription>({
    secretKey,
    path: `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
    method: "GET",
  });
}

export type SaasStripeSubscription = {
  id: string;
  customer: string;
  status: string;
  current_period_end: number | null;
  cancel_at_period_end: boolean;
  metadata?: Record<string, string>;
  items?: { data?: Array<{ price?: { id?: string } }> };
};

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

export async function createSaasCheckout(params: {
  secretKey: string;
  customerId: string;
  ownerId: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ id: string; url: string }> {
  const body = new URLSearchParams();
  body.set("mode", "subscription");
  body.set("customer", params.customerId);
  body.set("client_reference_id", params.ownerId);
  body.set("success_url", params.successUrl);
  body.set("cancel_url", params.cancelUrl);
  body.set("payment_method_types[0]", "card");
  body.set("line_items[0][price]", params.priceId);
  body.set("line_items[0][quantity]", "1");
  body.set("metadata[owner_id]", params.ownerId);
  body.set("metadata[product]", "stayboost");
  body.set("subscription_data[metadata][owner_id]", params.ownerId);
  body.set("subscription_data[metadata][product]", "stayboost");

  return stripeRequest<{ id: string; url: string }>({
    secretKey: params.secretKey,
    path: "/v1/checkout/sessions",
    body,
    idempotencyKey: `stayboost-saas-checkout-${params.ownerId}-${params.priceId}`,
  });
}

export async function createSaasPortal(params: {
  secretKey: string;
  customerId: string;
  returnUrl: string;
}): Promise<{ url: string }> {
  const body = new URLSearchParams();
  body.set("customer", params.customerId);
  body.set("return_url", params.returnUrl);
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

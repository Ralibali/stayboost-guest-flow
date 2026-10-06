/** One guest-payment merchant, explicitly scoped to a single property. Not SaaS billing. */
type Env = (name: string) => string | undefined;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function stripeReadiness(propertyId: string, env: Env) {
  const configuredProperty = env("STRIPE_PROPERTY_ID")?.trim() ?? "";
  const scoped = UUID.test(configuredProperty) && configuredProperty === propertyId;
  const key = env("STRIPE_SECRET_KEY") ?? "";
  const methodConfiguration = env("STRIPE_PAYMENT_METHOD_CONFIGURATION_ID")?.trim() ?? "";
  const validMethodConfiguration =
    !methodConfiguration || /^pmc_[a-zA-Z0-9]+$/.test(methodConfiguration);
  return {
    stripeConfigured: scoped && validMethodConfiguration && /^(?:sk|rk)_(?:live|test)_.+/.test(key),
    stripeWebhookConfigured: scoped && /^whsec_.+/.test(env("STRIPE_WEBHOOK_SECRET") ?? ""),
  };
}

export function stripeConfigForProperty(propertyId: string, env: Env) {
  const ready = stripeReadiness(propertyId, env);
  if (!ready.stripeConfigured || !ready.stripeWebhookConfigured) return null;
  const secretKey = env("STRIPE_SECRET_KEY")!;
  return {
    propertyId,
    secretKey,
    webhookSecret: env("STRIPE_WEBHOOK_SECRET")!,
    livemode: /^(?:sk|rk)_live_/.test(secretKey),
    paymentMethodConfiguration: env("STRIPE_PAYMENT_METHOD_CONFIGURATION_ID")?.trim() || undefined,
  };
}

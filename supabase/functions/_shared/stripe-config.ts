/** One guest-payment merchant, explicitly scoped to a single property. Not SaaS billing. */
type Env = (name: string) => string | undefined;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeStripeSecret(value: string | undefined): string {
  return value?.trim() ?? "";
}

function stripeEnvironment(env: Env) {
  // Normalize copy/paste padding once, before both validation and actual use.
  return {
    propertyId: env("STRIPE_PROPERTY_ID")?.trim() ?? "",
    secretKey: normalizeStripeSecret(env("STRIPE_SECRET_KEY")),
    webhookSecret: normalizeStripeSecret(env("STRIPE_WEBHOOK_SECRET")),
    paymentMethodConfiguration: env("STRIPE_PAYMENT_METHOD_CONFIGURATION_ID")?.trim() || undefined,
  };
}

function readiness(propertyId: string, config: ReturnType<typeof stripeEnvironment>) {
  const scoped = UUID.test(config.propertyId) && config.propertyId === propertyId;
  const methodConfiguration = config.paymentMethodConfiguration;
  const validMethodConfiguration =
    !methodConfiguration || /^pmc_[a-zA-Z0-9]+$/.test(methodConfiguration);
  return {
    stripeConfigured:
      scoped && validMethodConfiguration && /^(?:sk|rk)_(?:live|test)_\S+$/.test(config.secretKey),
    stripeWebhookConfigured: scoped && /^whsec_\S+$/.test(config.webhookSecret),
  };
}

export function stripeReadiness(propertyId: string, env: Env) {
  return readiness(propertyId, stripeEnvironment(env));
}

export function stripeConfigForProperty(propertyId: string, env: Env) {
  const config = stripeEnvironment(env);
  const ready = readiness(propertyId, config);
  if (!ready.stripeConfigured || !ready.stripeWebhookConfigured) return null;
  return {
    ...config,
    livemode: /^(?:sk|rk)_live_/.test(config.secretKey),
  };
}

import { normalizeStripeSecret, stripeReadiness } from "./stripe-config.ts";
import { stripeRequestHeaders } from "./stripe.ts";

export type StripeDiagnosticStatus =
  | "read_access_confirmed"
  | "configuration_invalid"
  | "authentication_failed"
  | "permission_denied"
  | "rate_limited"
  | "stripe_unavailable"
  | "unexpected_response"
  | "timeout"
  | "connection_failed";

export type StripeDiagnosticResult = { status: StripeDiagnosticStatus; checkedAt: string };

/** Owner authorization must be checked by the caller before inspecting configuration. */
export async function diagnoseStripeConnection(
  propertyId: string,
  env: (name: string) => string | undefined,
): Promise<StripeDiagnosticResult> {
  const result = (status: StripeDiagnosticStatus): StripeDiagnosticResult => ({
    status,
    checkedAt: new Date().toISOString(),
  });
  // Scope and local configuration only; a webhook secret is not needed for this READ probe.
  if (!stripeReadiness(propertyId, env).stripeConfigured) return result("configuration_invalid");
  const secretKey = normalizeStripeSecret(env("STRIPE_SECRET_KEY"));
  const signal = AbortSignal.timeout(5_000);
  try {
    const response = await fetch("https://api.stripe.com/v1/checkout/sessions?limit=1", {
      method: "GET",
      headers: stripeRequestHeaders(secretKey),
      redirect: "error",
      signal,
    });
    // Do not parse, log, forward, or retain Checkout/customer data, including error bodies.
    void response.body?.cancel().catch(() => {});
    if (response.status === 200) return result("read_access_confirmed");
    if (response.status === 401) return result("authentication_failed");
    if (response.status === 403) return result("permission_denied");
    if (response.status === 429) return result("rate_limited");
    if (response.status >= 500) return result("stripe_unavailable");
    return result("unexpected_response");
  } catch {
    // Never serialize fetch errors: they can contain request URLs or credentials.
    return result(signal.aborted ? "timeout" : "connection_failed");
  }
}

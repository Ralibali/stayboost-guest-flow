import { stripeConfigForProperty } from "./stripe-config.ts";

export type StripeCheckoutDiagnosticStatus =
  | "create_and_expire_confirmed"
  | "in_progress"
  | "configuration_invalid"
  | "configuration_changed"
  | "authentication_failed"
  | "permission_denied"
  | "create_not_confirmed"
  | "expiry_not_confirmed"
  | "attempt_requires_followup"
  | "diagnostic_unavailable";
export type StripeCheckoutDiagnosticResult = {
  status: StripeCheckoutDiagnosticStatus;
  checkedAt: string;
};

type Outcome = Exclude<
  StripeCheckoutDiagnosticStatus,
  "in_progress" | "configuration_invalid" | "configuration_changed" | "diagnostic_unavailable"
>;
export type DiagnosticAttempt = {
  id: string;
  property_id: string;
  created_at: string;
  lease_id: string;
  livemode: boolean;
  api_version: string;
  request_body: Record<string, string>;
  idempotency_key: string;
  expires_at: number;
  session_id: string | null;
};
export type DiagnosticClaim =
  | { state: "claimed"; attempt: DiagnosticAttempt }
  | { state: "cached"; status: Outcome; checkedAt: string }
  | { state: "in_progress" | "configuration_changed" | "attempt_requires_followup" };
export interface DiagnosticStore {
  claim(input: {
    actorId: string;
    propertyId: string;
    fingerprint: string;
    livemode: boolean;
    paymentMethodConfiguration?: string;
  }): Promise<DiagnosticClaim>;
  finish(
    attempt: DiagnosticAttempt,
    sessionId: string | null,
    outcome: Outcome | null,
  ): Promise<boolean>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const statuses = new Set<StripeCheckoutDiagnosticStatus>([
  "create_and_expire_confirmed",
  "in_progress",
  "configuration_invalid",
  "configuration_changed",
  "authentication_failed",
  "permission_denied",
  "create_not_confirmed",
  "expiry_not_confirmed",
  "attempt_requires_followup",
  "diagnostic_unavailable",
]);
const result = (status: StripeCheckoutDiagnosticStatus, checkedAt = new Date().toISOString()) => ({
  status,
  checkedAt,
});

async function fingerprint(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Parse only this diagnostic's response, bounded in size and by the fetch
// deadline. No provider body, URL, error message or request ID leaves this helper.
async function boundedJson(response: Response): Promise<Record<string, unknown> | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65_536) return null;
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  } finally {
    void reader.cancel().catch(() => {});
  }
}

function matchesSession(data: Record<string, unknown> | null, attempt: DiagnosticAttempt): boolean {
  if (!data) return false;
  const metadata = data.metadata as Record<string, unknown> | null;
  return (
    typeof data.id === "string" &&
    /^cs_(live|test)_[A-Za-z0-9]+$/.test(data.id) &&
    data.id.startsWith(attempt.livemode ? "cs_live_" : "cs_test_") &&
    (!attempt.session_id || data.id === attempt.session_id) &&
    data.object === "checkout.session" &&
    data.mode === "payment" &&
    data.livemode === attempt.livemode &&
    data.payment_status === "unpaid" &&
    data.amount_total === 1000 &&
    data.currency === "sek" &&
    data.client_reference_id == null &&
    data.customer == null &&
    data.customer_email == null &&
    !!metadata &&
    metadata.stayboost_diagnostic === attempt.id &&
    metadata.property_id === attempt.property_id &&
    metadata.booking_id == null &&
    data.expires_at === attempt.expires_at &&
    (data.status === "open" || data.status === "expired")
  );
}

/** Only call after getUser + property.owner_id authorization. No booking writes. */
export async function runStripeCheckoutDiagnostic(
  actorId: string,
  propertyId: string,
  env: (name: string) => string | undefined,
  store: DiagnosticStore,
): Promise<StripeCheckoutDiagnosticResult> {
  const config = stripeConfigForProperty(propertyId, env);
  if (!config || !UUID.test(actorId)) return result("configuration_invalid");
  let claim: DiagnosticClaim;
  try {
    claim = await store.claim({
      actorId,
      propertyId,
      livemode: config.livemode,
      fingerprint: await fingerprint(
        JSON.stringify([config.secretKey, config.paymentMethodConfiguration ?? null]),
      ),
      paymentMethodConfiguration: config.paymentMethodConfiguration,
    });
  } catch {
    return result("diagnostic_unavailable");
  }
  if (claim.state === "cached") {
    if (!statuses.has(claim.status) || !Number.isFinite(Date.parse(claim.checkedAt)))
      return result("diagnostic_unavailable");
    return result(claim.status, new Date(claim.checkedAt).toISOString());
  }
  if (claim.state !== "claimed")
    return result(statuses.has(claim.state) ? claim.state : "diagnostic_unavailable");
  const attempt = claim.attempt;
  if (
    !UUID.test(attempt.id) ||
    !UUID.test(attempt.lease_id) ||
    attempt.property_id !== propertyId ||
    attempt.livemode !== config.livemode ||
    !Number.isFinite(Date.parse(attempt.created_at))
  ) {
    return result("diagnostic_unavailable");
  }
  let sessionId = attempt.session_id;
  const finish = async (outcome: Outcome) => {
    try {
      return (await store.finish(attempt, sessionId, outcome))
        ? result(outcome)
        : result("diagnostic_unavailable");
    } catch {
      return result("diagnostic_unavailable");
    }
  };
  const request = async (path: string, method: "GET" | "POST", body?: string) => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${config.secretKey}`,
      "Stripe-Version": attempt.api_version,
    };
    if (method === "POST")
      headers["Idempotency-Key"] = attempt.idempotency_key + (sessionId ? ":expire" : "");
    if (body !== undefined) headers["Content-Type"] = "application/x-www-form-urlencoded";
    return fetch(`https://api.stripe.com/v1/checkout/sessions${path}`, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(5_000),
      redirect: "error",
    });
  };
  try {
    // A known session can still be read/closed after the creation replay window.
    // Never send a new create request after Stripe could prune its idempotency key.
    if (!sessionId && Date.now() - Date.parse(attempt.created_at) >= 23 * 3_600_000) {
      return finish("attempt_requires_followup");
    }
    const body = new URLSearchParams(
      Object.entries(attempt.request_body).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ).toString();
    const response = sessionId
      ? await request(`/${encodeURIComponent(sessionId)}`, "GET")
      : await request("", "POST", body);
    if (response.status !== 200) {
      void response.body?.cancel().catch(() => {});
      if (sessionId) return finish("expiry_not_confirmed");
      return finish(
        response.status === 401
          ? "authentication_failed"
          : response.status === 403
            ? "permission_denied"
            : "create_not_confirmed",
      );
    }
    const data = await boundedJson(response);
    if (!matchesSession(data, attempt))
      return finish(sessionId ? "expiry_not_confirmed" : "create_not_confirmed");
    sessionId = data!.id as string;
    if (data!.status === "expired") return finish("create_and_expire_confirmed");
    // Persist for recovery if the worker dies before expiry. A database outage
    // does not stop immediate cleanup of the just-created known session.
    try {
      await store.finish(attempt, sessionId, null);
    } catch {
      /* cleanup below */
    }
    const expired = await request(`/${encodeURIComponent(sessionId)}/expire`, "POST");
    if (expired.status !== 200) {
      void expired.body?.cancel().catch(() => {});
      return finish("expiry_not_confirmed");
    }
    const expiredData = await boundedJson(expired);
    if (
      !matchesSession(expiredData, { ...attempt, session_id: sessionId }) ||
      expiredData!.status !== "expired"
    ) {
      return finish("expiry_not_confirmed");
    }
    return finish("create_and_expire_confirmed");
  } catch {
    return finish(sessionId ? "expiry_not_confirmed" : "create_not_confirmed");
  }
}

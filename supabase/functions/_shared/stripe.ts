/**
 * Stripe Checkout + webhook-signaturverifiering.
 * Rena funktioner utan Deno-beroenden — delas av edge functions och vitest.
 */

export interface CheckoutParams {
  secretKey: string;
  amountSek: number;
  description: string;
  paymentRef: string;
  bookingId: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string | null;
  expiresAtUnix?: number | null;
  idempotencyKey?: string | null;
}

/** Bygg form-encoded body för POST /v1/checkout/sessions. */
export function checkoutBody(p: CheckoutParams): string {
  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("success_url", p.successUrl);
  params.set("cancel_url", p.cancelUrl);
  params.set("client_reference_id", p.bookingId);
  params.set("payment_method_types[0]", "card");
  params.set("line_items[0][quantity]", "1");
  params.set("line_items[0][price_data][currency]", "sek");
  params.set(
    "line_items[0][price_data][unit_amount]",
    String(Math.round(p.amountSek * 100)),
  );
  params.set("line_items[0][price_data][product_data][name]", p.description);
  params.set("metadata[payment_ref]", p.paymentRef);
  params.set("metadata[booking_id]", p.bookingId);
  if (p.customerEmail) params.set("customer_email", p.customerEmail);

  // Stripe tillåter 30 minuter som kortaste Checkout-reservation. Booking-engine
  // sparar samma expiry i vår DB så inventory inte är beroende av en enda webhook.
  const expiresAt = p.expiresAtUnix ?? Math.floor(Date.now() / 1000) + 30 * 60;
  params.set("expires_at", String(Math.floor(expiresAt)));
  return params.toString();
}

export interface CheckoutSession {
  id: string;
  url: string;
}

/** Skapa en Checkout Session hos Stripe. Kastar vid fel. */
export async function createCheckoutSession(p: CheckoutParams): Promise<CheckoutSession> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${p.secretKey}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (p.idempotencyKey) headers["Idempotency-Key"] = p.idempotencyKey;

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers,
    body: checkoutBody(p),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message ?? `Stripe svarade ${response.status}`);
  }
  if (!data.id || !data.url) throw new Error("Stripe-svar saknade id/url");
  return { id: data.id, url: data.url };
}

/** Stäng en Checkout Session som skapats men inte säkert kunde bindas till bokningen. */
export async function expireCheckoutSession(secretKey: string, sessionId: string): Promise<void> {
  const response = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}/expire`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${secretKey}` },
    },
  );
  if (response.ok) return;
  const data = await response.json().catch(() => null);
  throw new Error(data?.error?.message ?? `Stripe svarade ${response.status}`);
}

export interface StripeRefund {
  id: string;
  status: string | null;
}

/** Full refund med stabil idempotency key så nätverks-/DB-retries inte kan dubbla utbetalningen. */
export async function createFullRefund(params: {
  secretKey: string;
  paymentIntentId: string;
  idempotencyKey: string;
  metadata?: Record<string, string>;
}): Promise<StripeRefund> {
  const body = new URLSearchParams({ payment_intent: params.paymentIntentId });
  for (const [key, value] of Object.entries(params.metadata ?? {})) {
    body.set(`metadata[${key}]`, value);
  }
  const response = await fetch("https://api.stripe.com/v1/refunds", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": params.idempotencyKey,
    },
    body: body.toString(),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message ?? `Stripe svarade ${response.status}`);
  if (!data.id) throw new Error("Stripe-svar saknade refund-id");
  return { id: data.id, status: data.status ?? null };
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return bytesToHex(new Uint8Array(signature));
}

export function signatureHeaderValue(header: string, key: string): string | null {
  for (const part of header.split(",")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === key) {
      return part.slice(index + 1).trim();
    }
  }
  return null;
}

export async function verifyStripeSignature(
  rawBody: string,
  header: string,
  secret: string,
  toleranceSec = 300,
): Promise<boolean> {
  const timestamp = signatureHeaderValue(header, "t");
  const signature = signatureHeaderValue(header, "v1");
  if (!timestamp || !signature) return false;
  const unixTimestamp = Number(timestamp);
  if (!Number.isFinite(unixTimestamp)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - unixTimestamp) > toleranceSec) return false;
  const expected = await hmacSha256Hex(secret, `${timestamp}.${rawBody}`);
  return timingSafeEqual(expected, signature);
}

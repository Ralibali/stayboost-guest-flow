/**
 * Stripe Checkout + webhook-signaturverifiering.
 * Rena funktioner utan Deno-beroenden — delas av edge functions och vitest.
 * Vi pratar direkt med Stripes REST API (form-encoded) för att slippa SDK.
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
  params.set("line_items[0][price_data][unit_amount]", String(Math.round(p.amountSek * 100)));
  params.set("line_items[0][price_data][product_data][name]", p.description);
  params.set("metadata[payment_ref]", p.paymentRef);
  params.set("metadata[booking_id]", p.bookingId);
  if (p.customerEmail) params.set("customer_email", p.customerEmail);
  return params.toString();
}

export interface CheckoutSession {
  id: string;
  url: string;
}

/** Skapa en Checkout Session hos Stripe. Kastar vid fel. */
export async function createCheckoutSession(p: CheckoutParams): Promise<CheckoutSession> {
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${p.secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: checkoutBody(p),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message ?? `Stripe svarade ${res.status}`);
  }
  if (!data.id || !data.url) throw new Error("Stripe-svar saknade id/url");
  return { id: data.id, url: data.url };
}

// ---------- Webhook-signaturverifiering ----------

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return bytesToHex(new Uint8Array(sig));
}

/** Hämta ett värde ur Stripe-Signature-headern ("t=...,v1=..."). */
export function signatureHeaderValue(header: string, key: string): string | null {
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === key) return part.slice(i + 1).trim();
  }
  return null;
}

/**
 * Verifiera Stripe-Signature enligt dokumentationen:
 * HMAC-SHA256 av `${t}.${rawBody}` med webhook-secret, jämfört med v1.
 * Tidsstämpeln måste ligga inom toleransen (default 5 min).
 */
export async function verifyStripeSignature(
  rawBody: string,
  header: string,
  secret: string,
  toleranceSec = 300,
): Promise<boolean> {
  const t = signatureHeaderValue(header, "t");
  const v1 = signatureHeaderValue(header, "v1");
  if (!t || !v1) return false;
  const ts = Number(t);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > toleranceSec) return false;
  const expected = await hmacSha256Hex(secret, `${t}.${rawBody}`);
  return timingSafeEqual(expected, v1);
}

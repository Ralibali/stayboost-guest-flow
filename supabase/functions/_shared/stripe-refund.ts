import { createFullRefund, type StripeRefund } from "./stripe.ts";

// StayBoost: full Stripe-refund. Retry-safe: DB går först till refund_pending
// och Stripe-anropet använder stabil Idempotency-Key.
// Isolering: property_id härleds från booking-raden efter lookup, eller från
// body.property_id när den finns. Booking-raden hämtas/uppdateras aldrig
// på booking-id / owner-join ensamt.

export type StripeRefundQuery = {
  select: (columns: string) => StripeRefundQuery;
  update: (patch: Record<string, unknown>) => StripeRefundQuery;
  eq: (column: string, value: unknown) => StripeRefundQuery;
  maybeSingle: () => Promise<{ data: any; error: any }>;
  then: (
    resolve: (value: { data?: any; error: any }) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise<unknown>;
};

export type StripeRefundAdmin = {
  from: (table: string) => StripeRefundQuery;
};

export type StripeRefundGateway = {
  createFullRefund: (params: {
    secretKey: string;
    paymentIntentId: string;
    idempotencyKey: string;
    metadata?: Record<string, string>;
  }) => Promise<StripeRefund>;
  fetchCheckoutSession?: (
    sessionId: string,
    secretKey: string,
  ) => Promise<{
    ok: boolean;
    id?: string;
    payment_intent?: string;
    client_reference_id?: string;
    metadata?: { booking_id?: string; payment_ref?: string };
    error?: { message?: string };
  }>;
};

const BOOKING_SELECT =
  "id, property_id, payment_method, payment_status, payment_amount, payment_ref, stripe_session_id, stripe_payment_intent_id, stripe_refund_id, properties!inner(owner_id)";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function claimedPropertyId(body: { property_id?: unknown; propertyId?: unknown }): string {
  return String(body.property_id ?? body.propertyId ?? "").trim();
}

async function derivePropertyId(
  admin: StripeRefundAdmin,
  bookingId: string,
  claimed: string,
): Promise<{ propertyId: string | null; error: boolean }> {
  if (claimed) return { propertyId: claimed, error: false };
  const { data, error } = await admin
    .from("bookings")
    .select("property_id")
    .eq("id", bookingId)
    .maybeSingle();
  if (error) return { propertyId: null, error: true };
  const propertyId = String(data?.property_id ?? "").trim();
  return { propertyId: propertyId || null, error: false };
}

async function defaultFetchCheckoutSession(sessionId: string, secretKey: string) {
  const sessionResp = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
    { headers: { Authorization: `Bearer ${secretKey}` } },
  );
  const session = await sessionResp.json();
  return {
    ok: sessionResp.ok,
    id: session?.id,
    payment_intent: session?.payment_intent,
    client_reference_id: session?.client_reference_id,
    metadata: session?.metadata,
    error: session?.error,
  };
}

export async function handleStripeRefund(
  req: Request,
  opts: {
    admin: StripeRefundAdmin;
    userId: string;
    stripeKey: string;
    gateway?: StripeRefundGateway;
  },
): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: { bookingId?: string; property_id?: unknown; propertyId?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  if (!body.bookingId) return json({ error: "missing_booking" }, 400);

  const derived = await derivePropertyId(opts.admin, body.bookingId, claimedPropertyId(body));
  if (derived.error) return json({ error: "server_error" }, 500);
  if (!derived.propertyId) return json({ error: "not_found" }, 404);

  const { data: booking, error: readError } = await opts.admin
    .from("bookings")
    .select(BOOKING_SELECT)
    .eq("id", body.bookingId)
    .eq("property_id", derived.propertyId)
    .maybeSingle();
  if (readError) return json({ error: readError.message }, 500);
  if (!booking || (booking.properties as { owner_id: string }).owner_id !== opts.userId) {
    return json({ error: "not_found" }, 404);
  }
  if (booking.payment_method !== "stripe") return json({ error: "wrong_payment_method" }, 400);
  if (booking.payment_status === "refunded") {
    return json({
      ok: true,
      method: "stripe",
      duplicate: true,
      refundId: booking.stripe_refund_id,
    });
  }
  if (!["paid", "refund_pending"].includes(booking.payment_status)) {
    return json({ error: "not_refundable" }, 409);
  }

  if (!opts.stripeKey) return json({ error: "stripe_not_configured" }, 500);
  if (!booking.stripe_session_id) return json({ error: "missing_session" }, 400);

  const nowIso = new Date().toISOString();
  if (booking.payment_status === "paid") {
    const { error } = await opts.admin
      .from("bookings")
      .update({ payment_status: "refund_pending", payment_refund_requested_at: nowIso })
      .eq("id", booking.id)
      .eq("property_id", derived.propertyId)
      .eq("payment_status", "paid")
      .eq("payment_method", "stripe");
    if (error) return json({ error: error.message }, 500);
  }

  try {
    let paymentIntentId = booking.stripe_payment_intent_id as string | null;
    if (!paymentIntentId) {
      const fetchSession = opts.gateway?.fetchCheckoutSession ?? defaultFetchCheckoutSession;
      const session = await fetchSession(booking.stripe_session_id, opts.stripeKey);
      if (!session.ok || !session.payment_intent) {
        throw new Error(session?.error?.message ?? "session saknar payment_intent");
      }
      if (
        String(session.id ?? "") !== booking.stripe_session_id ||
        String(session.client_reference_id ?? session.metadata?.booking_id ?? "") !== booking.id ||
        String(session.metadata?.payment_ref ?? "") !== String(booking.payment_ref ?? "")
      ) {
        throw new Error("Stripe-session matchar inte bokningen");
      }
      paymentIntentId = String(session.payment_intent);
    }

    const refundFn = opts.gateway?.createFullRefund ?? createFullRefund;
    const refund = await refundFn({
      secretKey: opts.stripeKey,
      paymentIntentId,
      idempotencyKey: `stayboost-refund-${booking.id}`,
      metadata: { booking_id: booking.id, payment_ref: String(booking.payment_ref ?? "") },
    });

    const { error: updateError } = await opts.admin
      .from("bookings")
      .update({
        payment_status: "refunded",
        payment_refunded_at: new Date().toISOString(),
        stripe_payment_intent_id: paymentIntentId,
        stripe_refund_id: refund.id,
      })
      .eq("id", booking.id)
      .eq("property_id", derived.propertyId)
      .eq("payment_method", "stripe")
      .eq("payment_status", "refund_pending");
    if (updateError) return json({ error: updateError.message, retrySafe: true }, 500);

    return json({ ok: true, method: "stripe", refundId: refund.id, refundStatus: refund.status });
  } catch (e) {
    // refund_pending lämnas kvar med flit. Ett nytt försök använder samma Stripe
    // idempotency key och kan säkert återuppta en osäker nätverks/DB-situation.
    return json({ error: "refund_failed", detail: String(e), retrySafe: true }, 502);
  }
}

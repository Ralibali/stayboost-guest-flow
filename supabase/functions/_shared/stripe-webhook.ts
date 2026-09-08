import { verifyStripeSignature } from "./stripe.ts";

// Stripe-webhook: signatur + session + betalref + valuta + belopp verifieras.
// Stripe är at-least-once; event-id loggas och state transitions är idempotenta.
// Isolering: property_id härleds från booking-raden efter lookup, eller från
// metadata.property_id när den finns. Booking-raden hämtas/uppdateras aldrig
// på Stripe-id / booking-id ensamt.

export type StripeWebhookQuery = {
  select: (columns: string) => StripeWebhookQuery;
  insert: (
    row: Record<string, unknown>,
  ) => Promise<{ error: { code?: string; message?: string } | null }>;
  update: (patch: Record<string, unknown>) => StripeWebhookQuery;
  eq: (column: string, value: unknown) => StripeWebhookQuery;
  maybeSingle: () => Promise<{ data: any; error: any }>;
  then: (
    resolve: (value: { data?: any; error: any }) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise<unknown>;
};

export type StripeWebhookAdmin = {
  from: (table: string) => StripeWebhookQuery;
};

const BOOKING_SELECT =
  "id, status, payment_method, payment_status, payment_amount, payment_ref, stripe_session_id, property_id";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function claimedPropertyId(session: { metadata?: { property_id?: unknown } }): string {
  return String(session.metadata?.property_id ?? "").trim();
}

async function derivePropertyId(
  admin: StripeWebhookAdmin,
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

export async function handleStripeWebhook(
  req: Request,
  admin: StripeWebhookAdmin,
  secret: string,
): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  if (!secret) return json({ error: "webhook_not_configured" }, 500);

  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature") ?? "";
  if (!(await verifyStripeSignature(rawBody, signature, secret))) {
    return json({ error: "invalid_signature" }, 400);
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: "invalid_body" }, 400);
  }

  const eventId = String(event?.id ?? "");
  if (!eventId) return json({ error: "missing_event_id" }, 400);

  const handled = ["checkout.session.completed", "checkout.session.expired"];
  if (!handled.includes(event?.type)) {
    return json({ ok: true, ignored: event?.type ?? "unknown" });
  }

  const session = event.data?.object ?? {};
  const bookingId = String(session.client_reference_id ?? session.metadata?.booking_id ?? "");
  if (!bookingId) return json({ ok: true, ignored: "no_booking_ref" });

  const finishEvent = async (outcome: string, lastError: string | null = null) => {
    await admin
      .from("stripe_webhook_events")
      .update({ processed_at: new Date().toISOString(), outcome, last_error: lastError })
      .eq("event_id", eventId);
  };

  // Audit-ledger. Vid retry fortsätter vi om tidigare försök inte hann processas klart;
  // själva bokningsövergångarna nedan är också idempotenta.
  const { error: eventInsertError } = await admin.from("stripe_webhook_events").insert({
    event_id: eventId,
    event_type: event.type,
    booking_id: bookingId,
  });
  if (eventInsertError && eventInsertError.code !== "23505") {
    return json({ error: "event_ledger_failed" }, 500);
  }
  if (eventInsertError?.code === "23505") {
    const { data: previousEvent } = await admin
      .from("stripe_webhook_events")
      .select("processed_at, outcome")
      .eq("event_id", eventId)
      .maybeSingle();
    if (previousEvent?.processed_at) {
      return json({ ok: true, duplicate: true, outcome: previousEvent.outcome });
    }
  }

  const derived = await derivePropertyId(admin, bookingId, claimedPropertyId(session));
  if (derived.error) {
    await finishEvent("read_error", "derive_failed");
    return json({ error: "server_error" }, 500);
  }
  if (!derived.propertyId) {
    await finishEvent("booking_not_found");
    return json({ error: "booking_not_found" }, 404);
  }

  const { data: booking, error: readError } = await admin
    .from("bookings")
    .select(BOOKING_SELECT)
    .eq("id", bookingId)
    .eq("property_id", derived.propertyId)
    .maybeSingle();
  if (readError) {
    await finishEvent("read_error", readError.message);
    return json({ error: readError.message }, 500);
  }
  if (!booking || booking.payment_method !== "stripe") {
    await finishEvent("booking_not_found");
    return json({ error: "booking_not_found" }, 404);
  }

  // Webhooken måste höra till exakt den Checkout Session som booking-engine band.
  if (!booking.stripe_session_id || String(session.id ?? "") !== booking.stripe_session_id) {
    await finishEvent("session_mismatch");
    return json({ error: "session_mismatch" }, 400);
  }
  if (String(session.metadata?.booking_id ?? "") !== booking.id) {
    await finishEvent("booking_metadata_mismatch");
    return json({ error: "booking_metadata_mismatch" }, 400);
  }
  if (String(session.metadata?.payment_ref ?? "") !== String(booking.payment_ref ?? "")) {
    await finishEvent("payment_ref_mismatch");
    return json({ error: "payment_ref_mismatch" }, 400);
  }

  if (event.type === "checkout.session.completed") {
    const amountTotal = Number(session.amount_total);
    const currency = String(session.currency ?? "").toLowerCase();
    const expectedAmount = Math.round(Number(booking.payment_amount ?? 0) * 100);
    if (
      session.payment_status !== "paid" ||
      currency !== "sek" ||
      !Number.isInteger(amountTotal) ||
      amountTotal !== expectedAmount
    ) {
      await finishEvent("payment_mismatch");
      return json({ error: "payment_mismatch" }, 400);
    }

    const paymentIntentId =
      typeof session.payment_intent === "string" ? session.payment_intent : null;
    const nowIso = new Date().toISOString();

    if (booking.payment_status === "paid") {
      await finishEvent("already_paid");
      return json({ ok: true, bookingId, paymentStatus: "paid", duplicate: true });
    }
    if (booking.payment_status === "refunded") {
      await finishEvent("already_refunded");
      return json({ ok: true, bookingId, paymentStatus: "refunded", duplicate: true });
    }

    if (booking.status !== "confirmed" || booking.payment_status === "expired") {
      // Pengar kan komma efter att inventory redan släppts (t.ex. webhook-ordering/race).
      // Återuppliva ALDRIG bokningen. Bokför betalningen som refund_pending så pengar
      // inte kan tas emot tyst utan operatörsåtgärd.
      const { error } = await admin
        .from("bookings")
        .update({
          payment_status: "refund_pending",
          payment_paid_at: nowIso,
          payment_refund_requested_at: nowIso,
          payment_expires_at: null,
          stripe_payment_intent_id: paymentIntentId,
        })
        .eq("id", bookingId)
        .eq("property_id", derived.propertyId)
        .eq("payment_method", "stripe");
      if (error) {
        await finishEvent("late_payment_update_failed", error.message);
        return json({ error: error.message }, 500);
      }
      await finishEvent("late_payment_refund_pending");
      return json({ ok: true, bookingId, paymentStatus: "refund_pending" });
    }

    if (booking.payment_status !== "pending") {
      await finishEvent("invalid_payment_state");
      return json({ error: "invalid_payment_state" }, 409);
    }

    const { error } = await admin
      .from("bookings")
      .update({
        payment_status: "paid",
        payment_paid_at: nowIso,
        payment_expires_at: null,
        stripe_payment_intent_id: paymentIntentId,
      })
      .eq("id", bookingId)
      .eq("property_id", derived.propertyId)
      .eq("status", "confirmed")
      .eq("payment_method", "stripe")
      .eq("payment_status", "pending");
    if (error) {
      await finishEvent("paid_update_failed", error.message);
      return json({ error: error.message }, 500);
    }
    await finishEvent("paid");
    return json({ ok: true, bookingId, paymentStatus: "paid" });
  }

  // checkout.session.expired får bara släppa en fortfarande obetald reservation.
  if (booking.payment_status !== "pending") {
    await finishEvent(`expiry_ignored_${booking.payment_status}`);
    return json({ ok: true, bookingId, ignored: `payment_${booking.payment_status}` });
  }

  const nowIso = new Date().toISOString();
  const { error } = await admin
    .from("bookings")
    .update({
      status: "cancelled",
      payment_status: "expired",
      payment_expired_at: nowIso,
      payment_expires_at: null,
    })
    .eq("id", bookingId)
    .eq("property_id", derived.propertyId)
    .eq("payment_method", "stripe")
    .eq("payment_status", "pending");
  if (error) {
    await finishEvent("expiry_update_failed", error.message);
    return json({ error: error.message }, 500);
  }
  await finishEvent("expired");
  return json({ ok: true, bookingId, cancelled: true, paymentStatus: "expired" });
}

/** Server-side payment transitions. Every write compares the state read before it. */
export type PaymentStatus = "none" | "pending" | "paid" | "refund_pending" | "refunded" | "expired";

export interface PaymentBooking {
  id: string;
  source: string;
  status: string;
  payment_method: string;
  payment_status: PaymentStatus;
  payment_amount: number | null;
  payment_ref: string | null;
  payment_expires_at: string | null;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_refund_id: string | null;
}

export interface PaymentStore {
  read(id: string): Promise<PaymentBooking | null>;
  /** null means another writer changed the booking; it never means success. */
  compareAndSet(
    booking: PaymentBooking,
    patch: Record<string, unknown>,
  ): Promise<PaymentBooking | null>;
}

export class PaymentTransitionError extends Error {
  constructor(
    public code: string,
    public status = 503,
  ) {
    super(code);
  }
}

export interface CheckoutEventSession {
  id?: string;
  metadata?: { booking_id?: string; payment_ref?: string };
  payment_status?: string;
  amount_total?: number;
  currency?: string;
  payment_intent?: string | null;
}

function validateCheckout(
  booking: PaymentBooking,
  session: CheckoutEventSession,
  completed: boolean,
) {
  if (booking.payment_method !== "stripe")
    throw new PaymentTransitionError("booking_not_found", 404);
  // Checkout can complete before booking-engine has persisted the new session ID.
  // Stripe must retry this event after binding, rather than permanently acknowledge it.
  if (!booking.stripe_session_id) throw new PaymentTransitionError("session_not_bound");
  if (session.id !== booking.stripe_session_id)
    throw new PaymentTransitionError("session_mismatch", 400);
  if (session.metadata?.booking_id !== booking.id)
    throw new PaymentTransitionError("booking_metadata_mismatch", 400);
  if (session.metadata?.payment_ref !== booking.payment_ref)
    throw new PaymentTransitionError("payment_ref_mismatch", 400);
  if (
    completed &&
    (session.payment_status !== "paid" ||
      String(session.currency ?? "").toLowerCase() !== "sek" ||
      !Number.isSafeInteger(session.amount_total) ||
      booking.payment_amount === null ||
      session.amount_total !== Math.round(booking.payment_amount * 100))
  )
    throw new PaymentTransitionError("payment_mismatch", 400);
}

export async function applyCheckoutEvent(
  store: PaymentStore,
  bookingId: string,
  session: CheckoutEventSession,
  completed: boolean | "awaiting_payment",
  nowIso: string,
  paymentOccurredAtIso = nowIso,
): Promise<{ outcome: string; booking: PaymentBooking }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const booking = await store.read(bookingId);
    if (!booking) throw new PaymentTransitionError("booking_not_found", 404);
    validateCheckout(booking, session, completed === true);
    if (completed === "awaiting_payment") {
      // An unpaid completed session is not fulfillment. Keep the finite inventory
      // hold; a later success after expiry is recorded for refund, never revived.
      if (
        session.payment_status !== "unpaid" ||
        session.currency !== "sek" ||
        booking.payment_amount === null ||
        !Number.isSafeInteger(session.amount_total) ||
        session.amount_total !== Math.round(booking.payment_amount * 100)
      )
        throw new PaymentTransitionError("payment_mismatch", 400);
      return { outcome: "awaiting_payment", booking };
    }
    if (!completed) {
      if (booking.payment_status !== "pending")
        return { outcome: `expiry_ignored_${booking.payment_status}`, booking };
      const updated = await store.compareAndSet(booking, {
        status: "cancelled",
        payment_status: "expired",
        payment_expired_at: nowIso,
        payment_expires_at: null,
      });
      if (updated) return { outcome: "expired", booking: updated };
      continue;
    }

    if (["paid", "refunded", "refund_pending"].includes(booking.payment_status)) {
      return { outcome: `already_${booking.payment_status}`, booking };
    }
    if (!["pending", "expired"].includes(booking.payment_status))
      throw new PaymentTransitionError("invalid_payment_state", 409);

    const late =
      booking.status !== "confirmed" ||
      booking.payment_status === "expired" ||
      (booking.payment_expires_at !== null &&
        Date.parse(booking.payment_expires_at) <= Date.parse(paymentOccurredAtIso));
    const patch: Record<string, unknown> = {
      payment_status: late ? "refund_pending" : "paid",
      payment_paid_at: paymentOccurredAtIso,
      payment_expires_at: null,
      stripe_payment_intent_id:
        typeof session.payment_intent === "string" ? session.payment_intent : null,
    };
    if (late) {
      patch.status = "cancelled";
      patch.payment_refund_requested_at = nowIso;
    }
    const updated = await store.compareAndSet(booking, patch);
    if (updated)
      return { outcome: late ? "late_payment_refund_pending" : "paid", booking: updated };
    // An expiry/cancellation may have won between read and write. Re-read before
    // deciding whether money is paid for inventory or requires a refund.
  }
  throw new PaymentTransitionError("payment_state_changed");
}

export interface RefundResult {
  id: string;
  status: string | null;
  paymentIntentId: string;
}

export async function persistStripeRefund(
  store: PaymentStore,
  bookingId: string,
  refund: RefundResult,
  nowIso: string,
): Promise<PaymentBooking> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const booking = await store.read(bookingId);
    if (!booking || booking.payment_method !== "stripe")
      throw new PaymentTransitionError("booking_not_found", 404);
    if (booking.stripe_refund_id && booking.stripe_refund_id !== refund.id)
      throw new PaymentTransitionError("refund_mismatch", 400);
    if (
      booking.stripe_payment_intent_id &&
      booking.stripe_payment_intent_id !== refund.paymentIntentId
    )
      throw new PaymentTransitionError("payment_intent_mismatch", 400);
    if (!["paid", "refund_pending", "refunded"].includes(booking.payment_status))
      throw new PaymentTransitionError("invalid_payment_state", 409);
    // Stripe accepts refunds that are still pending or require action. A later
    // failure can also reverse a refund previously marked succeeded.
    const succeeded = refund.status === "succeeded";
    // An in-flight create request may return pending after the success webhook
    // has already committed. Only actual failure/cancellation can reverse it.
    if (
      booking.payment_status === "refunded" &&
      !succeeded &&
      !["failed", "canceled"].includes(refund.status ?? "")
    )
      return booking;
    const patch = {
      payment_status: succeeded ? "refunded" : "refund_pending",
      payment_refunded_at: succeeded ? nowIso : null,
      stripe_refund_id: refund.id,
      stripe_payment_intent_id: refund.paymentIntentId,
    };
    const updated = await store.compareAndSet(booking, patch);
    if (updated) return updated;
  }
  throw new PaymentTransitionError("payment_state_changed");
}

export type ManualPaymentAction =
  | "cancel_booking"
  | "mark_swish_paid"
  | "request_swish_refund"
  | "confirm_swish_refunded";

export async function applyManualPaymentAction(
  store: PaymentStore,
  bookingId: string,
  action: ManualPaymentAction,
  nowIso: string,
): Promise<{ booking: PaymentBooking; duplicate: boolean }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const booking = await store.read(bookingId);
    if (!booking) throw new PaymentTransitionError("booking_not_found", 404);
    let patch: Record<string, unknown>;
    if (action === "cancel_booking") {
      if (["ical", "sirvoy", "channex"].includes(booking.source))
        throw new PaymentTransitionError("external_booking_cancel", 409);
      if (booking.status === "cancelled") return { booking, duplicate: true };
      patch = { status: "cancelled" };
      if (booking.payment_status === "pending") {
        patch.payment_status = "expired";
        patch.payment_expired_at = nowIso;
        patch.payment_expires_at = null;
      }
    } else {
      if (booking.payment_method !== "swish")
        throw new PaymentTransitionError("wrong_payment_method", 400);
      const target =
        action === "mark_swish_paid"
          ? "paid"
          : action === "request_swish_refund"
            ? "refund_pending"
            : "refunded";
      if (booking.payment_status === target) return { booking, duplicate: true };
      if (action === "mark_swish_paid") {
        if (booking.status !== "confirmed" || booking.payment_status !== "pending")
          throw new PaymentTransitionError("invalid_payment_state", 409);
        if (
          booking.payment_expires_at &&
          Date.parse(booking.payment_expires_at) <= Date.parse(nowIso)
        )
          throw new PaymentTransitionError("payment_hold_expired", 409);
        patch = { payment_status: "paid", payment_paid_at: nowIso, payment_expires_at: null };
      } else if (action === "request_swish_refund") {
        if (booking.payment_status !== "paid") throw new PaymentTransitionError("not_paid", 409);
        patch = { payment_status: "refund_pending", payment_refund_requested_at: nowIso };
      } else {
        if (booking.payment_status !== "refund_pending")
          throw new PaymentTransitionError("refund_not_requested", 409);
        patch = { payment_status: "refunded", payment_refunded_at: nowIso };
      }
    }
    const updated = await store.compareAndSet(booking, patch);
    if (updated) return { booking: updated, duplicate: false };
  }
  throw new PaymentTransitionError("payment_state_changed");
}

export function stripeEventLedgerPatch(
  outcome: string,
  error: string | null,
  retryable: boolean,
  nowIso: string,
) {
  // A transient failure must leave processed_at empty so at-least-once delivery
  // retries can actually resume it. Only completed decisions become duplicates.
  return { outcome, last_error: error, processed_at: retryable ? null : nowIso };
}

const PAYMENT_COLUMNS =
  "id,source,status,payment_method,payment_status,payment_amount,payment_ref,payment_expires_at,stripe_session_id,stripe_payment_intent_id,stripe_refund_id";

/** Kept here so all payment writers use the same compare-and-set predicates. */
export function supabasePaymentStore(
  client: { from(table: string): any },
  propertyId?: string,
): PaymentStore {
  return {
    async read(id) {
      let query = client.from("bookings").select(PAYMENT_COLUMNS).eq("id", id);
      if (propertyId !== undefined) query = query.eq("property_id", propertyId);
      const { data, error } = await query.maybeSingle();
      if (error) throw new Error(error.message);
      return data as PaymentBooking | null;
    },
    async compareAndSet(booking, patch) {
      let query = client
        .from("bookings")
        .update(patch)
        .eq("id", booking.id)
        .eq("status", booking.status)
        .eq("payment_method", booking.payment_method)
        .eq("payment_status", booking.payment_status);
      if (propertyId !== undefined) query = query.eq("property_id", propertyId);
      for (const field of [
        "stripe_session_id",
        "stripe_refund_id",
        "payment_expires_at",
      ] as const) {
        query = booking[field] === null ? query.is(field, null) : query.eq(field, booking[field]);
      }
      const { data, error } = await query.select(PAYMENT_COLUMNS).maybeSingle();
      if (error) throw new Error(error.message);
      return data as PaymentBooking | null;
    },
  };
}

/** PostgREST joins may be represented as an object or a one-item array. */
export function joinedPropertyOwnerId(relation: unknown): string | null {
  if (Array.isArray(relation)) relation = relation.length === 1 ? relation[0] : null;
  if (!relation || typeof relation !== "object" || !("owner_id" in relation)) return null;
  return typeof relation.owner_id === "string" ? relation.owner_id : null;
}

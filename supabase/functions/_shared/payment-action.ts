// Serverägd manuell betalningslivscykel. Klienten får inte skriva payment_status direkt.
// Isolering: property_id härleds från booking-raden efter lookup, eller från
// body.propertyId när den finns (tenant claim). Booking-raden hämtas/uppdateras
// aldrig på booking.id ensamt. Saknad/mismatch = samma 404 som missing.
// Trusted binding: bookings.property_id (NOT NULL i 20260719000000_fas1.sql)
// eller en property ägd av auth.uid().

export type Action =
  | "cancel_booking"
  | "mark_swish_paid"
  | "request_swish_refund"
  | "confirm_swish_refunded";

export type PaymentActionQuery = {
  select: (columns: string) => PaymentActionQuery;
  update: (patch: Record<string, unknown>) => PaymentActionQuery;
  eq: (column: string, value: unknown) => PaymentActionQuery;
  maybeSingle: () => Promise<{ data: any; error: any }>;
  then: (
    resolve: (value: { data?: any; error: any }) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise<unknown>;
};

export type PaymentActionAdmin = {
  from: (table: string) => PaymentActionQuery;
};

export type PaymentActionDeps = {
  expireCheckoutSession?: (secretKey: string, sessionId: string) => Promise<void>;
  stripeKey?: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BOOKING_SELECT =
  "id, status, payment_method, payment_status, payment_expires_at, stripe_session_id, property_id";

const ACTIONS: Action[] = [
  "cancel_booking",
  "mark_swish_paid",
  "request_swish_refund",
  "confirm_swish_refunded",
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function claimedPropertyId(body: { propertyId?: unknown }): string {
  return String(body.propertyId ?? "").trim();
}

async function propertyOwnedByUser(
  admin: PaymentActionAdmin,
  propertyId: string,
  userId: string,
): Promise<{ ok: boolean; error: boolean }> {
  const { data, error } = await admin
    .from("properties")
    .select("id")
    .eq("id", propertyId)
    .eq("owner_id", userId)
    .maybeSingle();
  if (error) return { ok: false, error: true };
  return { ok: Boolean(data?.id), error: false };
}

async function derivePropertyId(
  admin: PaymentActionAdmin,
  bookingId: string,
  claimed: string,
  userId: string,
): Promise<{ propertyId: string | null; error: boolean }> {
  if (claimed) {
    const owned = await propertyOwnedByUser(admin, claimed, userId);
    if (owned.error) return { propertyId: null, error: true };
    return { propertyId: owned.ok ? claimed : null, error: false };
  }

  const { data, error } = await admin
    .from("bookings")
    .select("property_id")
    .eq("id", bookingId)
    .maybeSingle();
  if (error) return { propertyId: null, error: true };
  const propertyId = String(data?.property_id ?? "").trim();
  if (!propertyId) return { propertyId: null, error: false };

  const owned = await propertyOwnedByUser(admin, propertyId, userId);
  if (owned.error) return { propertyId: null, error: true };
  return { propertyId: owned.ok ? propertyId : null, error: false };
}

export async function handlePaymentAction(
  req: Request,
  admin: PaymentActionAdmin,
  userId: string,
  deps: PaymentActionDeps = {},
): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: { bookingId?: string; action?: Action; propertyId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  if (!body.bookingId || !body.action) return json({ error: "missing_fields" }, 400);
  if (!ACTIONS.includes(body.action)) return json({ error: "invalid_action" }, 400);

  const derived = await derivePropertyId(
    admin,
    body.bookingId,
    claimedPropertyId(body),
    userId,
  );
  if (derived.error) return json({ error: "server_error" }, 500);
  if (!derived.propertyId) return json({ error: "not_found" }, 404);

  const { data: booking, error: readError } = await admin
    .from("bookings")
    .select(BOOKING_SELECT)
    .eq("id", body.bookingId)
    .eq("property_id", derived.propertyId)
    .maybeSingle();
  if (readError) return json({ error: readError.message }, 500);
  if (!booking) return json({ error: "not_found" }, 404);

  const now = new Date();
  const nowIso = now.toISOString();
  const propertyId = derived.propertyId;

  if (body.action === "cancel_booking") {
    if (booking.status === "cancelled") {
      return json({ ok: true, duplicate: true, status: "cancelled" });
    }

    // Best effort: stäng Stripe Checkout direkt. Även om Stripe-anropet fallerar
    // gör vi DB-state expired; en sen verifierad betalning blir då refund_pending.
    if (
      booking.payment_method === "stripe" &&
      booking.payment_status === "pending" &&
      booking.stripe_session_id
    ) {
      const stripeKey = deps.stripeKey ?? "";
      if (stripeKey && deps.expireCheckoutSession) {
        try {
          await deps.expireCheckoutSession(stripeKey, booking.stripe_session_id);
        } catch {
          // Webhooken hanterar en eventuell sen betalning utan att återuppliva inventory.
        }
      }
    }

    const patch: Record<string, unknown> = { status: "cancelled" };
    if (booking.payment_status === "pending") {
      patch.payment_status = "expired";
      patch.payment_expired_at = nowIso;
      patch.payment_expires_at = null;
    }
    const { error } = await admin
      .from("bookings")
      .update(patch)
      .eq("id", booking.id)
      .eq("property_id", propertyId);
    if (error) return json({ error: error.message }, 500);
    return json({
      ok: true,
      status: "cancelled",
      paymentStatus: patch.payment_status ?? booking.payment_status,
    });
  }

  if (booking.payment_method !== "swish") return json({ error: "wrong_payment_method" }, 400);

  if (body.action === "mark_swish_paid") {
    if (booking.payment_status === "paid") {
      return json({ ok: true, duplicate: true, status: "paid" });
    }
    if (booking.status !== "confirmed" || booking.payment_status !== "pending") {
      return json({ error: "invalid_payment_state" }, 409);
    }
    if (booking.payment_expires_at && new Date(booking.payment_expires_at).getTime() <= now.getTime()) {
      return json({ error: "payment_hold_expired" }, 409);
    }
    const { error } = await admin
      .from("bookings")
      .update({ payment_status: "paid", payment_paid_at: nowIso, payment_expires_at: null })
      .eq("id", booking.id)
      .eq("property_id", propertyId)
      .eq("payment_method", "swish")
      .eq("payment_status", "pending")
      .eq("status", "confirmed");
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, status: "paid" });
  }

  if (body.action === "request_swish_refund") {
    if (booking.payment_status === "refund_pending") {
      return json({ ok: true, duplicate: true, status: "refund_pending" });
    }
    if (booking.payment_status !== "paid") return json({ error: "not_paid" }, 409);
    const { error } = await admin
      .from("bookings")
      .update({ payment_status: "refund_pending", payment_refund_requested_at: nowIso })
      .eq("id", booking.id)
      .eq("property_id", propertyId)
      .eq("payment_method", "swish")
      .eq("payment_status", "paid");
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, status: "refund_pending" });
  }

  if (booking.payment_status === "refunded") {
    return json({ ok: true, duplicate: true, status: "refunded" });
  }
  if (booking.payment_status !== "refund_pending") {
    return json({ error: "refund_not_requested" }, 409);
  }
  const { error } = await admin
    .from("bookings")
    .update({ payment_status: "refunded", payment_refunded_at: nowIso })
    .eq("id", booking.id)
    .eq("property_id", propertyId)
    .eq("payment_method", "swish")
    .eq("payment_status", "refund_pending");
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, status: "refunded" });
}

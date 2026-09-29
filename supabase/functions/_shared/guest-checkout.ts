export type ResumeBooking = {
  id: string;
  status: string;
  payment_method: string;
  payment_status: string;
  payment_amount: number | null;
  payment_ref: string | null;
  payment_expires_at: string | null;
  stripe_session_id: string | null;
};

export function pendingCheckoutAllowed(booking: ResumeBooking, now = Date.now()): boolean {
  return (
    booking.status === "confirmed" &&
    booking.payment_method === "stripe" &&
    booking.payment_status === "pending" &&
    Boolean(booking.stripe_session_id) &&
    Number.isFinite(booking.payment_amount) &&
    Number(booking.payment_amount) > 0 &&
    Boolean(booking.payment_expires_at) &&
    Date.parse(booking.payment_expires_at!) > now
  );
}

/** Only the existing bound session may be resumed; a retry never creates another booking. */
export async function resumeCheckout(
  booking: ResumeBooking,
  secretKey: string,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<string | null> {
  if (!secretKey || !pendingCheckoutAllowed(booking, now)) return null;
  const response = await fetcher(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(booking.stripe_session_id!)}`,
    { headers: { Authorization: `Bearer ${secretKey}` }, signal: AbortSignal.timeout(15000) },
  );
  if (!response.ok) throw new Error("checkout_unavailable");
  const session = await response.json();
  if (
    session.id !== booking.stripe_session_id ||
    session.client_reference_id !== booking.id ||
    session.metadata?.booking_id !== booking.id ||
    session.metadata?.payment_ref !== booking.payment_ref ||
    session.currency !== "sek" ||
    session.amount_total !== Math.round(Number(booking.payment_amount) * 100) ||
    session.status !== "open" ||
    session.payment_status !== "unpaid" ||
    !Number.isFinite(session.expires_at) ||
    session.expires_at * 1000 <= now
  )
    return null;
  try {
    const url = new URL(session.url);
    return url.origin === "https://checkout.stripe.com" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

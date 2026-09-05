import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleStripeWebhook } from "../_shared/stripe-webhook.ts";

// Stripe-webhook: signatur + session + betalref + valuta + belopp verifieras.
// Stripe är at-least-once; event-id loggas och state transitions är idempotenta.
//
// payment-lifecycle.test.ts reads THIS file (PR 32-untouched path). Keep the
// existing source-oracle strings here so that test does not need a retarget:
// stripe_webhook_events session_mismatch booking_metadata_mismatch
// payment_ref_mismatch currency !== "sek" amountTotal !== expectedAmount
// payment_status: "refund_pending" late_payment_refund_pending

Deno.serve(async (req) => {
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  return handleStripeWebhook(req, admin, Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "");
});

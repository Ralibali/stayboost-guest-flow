# Stripe guest payments

Guest bookings use Stripe-hosted Checkout for one-time, full-price SEK payments. The server calculates the amount and keeps inventory reserved for 31 minutes. The success URL never marks a booking paid; signed Stripe events do that. SaaS subscription billing has separate credentials and is not part of this configuration.

## Server configuration

Store these in Supabase Edge Function secrets, never in client code:

- `STRIPE_SECRET_KEY`: a restricted `rk_live_...` or sandbox `rk_test_...` key. The legacy `sk_...` format remains supported. Required operations are Checkout Session create/retrieve/expire and Refund create/retrieve. Validate restricted permissions for inline `price_data` in a sandbox.
- `STRIPE_WEBHOOK_SECRET`: the signing secret for this guest-payment endpoint and environment.
- `STRIPE_PROPERTY_ID`: the exact UUID of the property whose merchant account receives these payments. Missing or mismatched scope disables guest Stripe. Another property must have its own account routing before it can use Stripe.
- `PUBLIC_APP_URL`: the trusted public application origin, normally `https://stayboost.se`. Checkout does not derive return URLs from the caller's Origin header.
- `STRIPE_PAYMENT_METHOD_CONFIGURATION_ID` (optional): a validated `pmc_...` identifier for this integration's own payment methods. Without it Stripe uses the merchant's default configuration.

Use immediate payment methods for launch. Configure them in Stripe, preferably through a dedicated Payment Method Configuration so the merchant's other integrations are unaffected. The code uses dynamic payment methods and disables adaptive currency conversion to preserve the server's quoted SEK amount. It does not add Stripe Tax or change existing included-VAT prices.

Configuration presence is not proof that the key, permissions, webhook delivery or payment methods work. The owner-only readiness response exposes booleans for the requested property, never credentials.

## Webhook

Register `/functions/v1/stripe-webhook` on the project's Supabase origin with `verify_jwt=false`. The handler verifies the raw-body signature, accepts rotating `v1` signatures, and rejects mismatched live/test or Connect-account events. Configure these events:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`
- `refund.created`
- `refund.updated`
- `refund.failed`

A completed but unpaid session remains pending. Asynchronous failure or expiration releases the reservation. A verified paid event must match the stored session, booking reference, payment reference, currency and exact amount. A payment that succeeds after the hold expires, or after cancellation wins, becomes `refund_pending` without reopening dates. The signed event time distinguishes actual late payment from webhook transport delay. Late funds require the owner's refund action; this webhook does not send money or guest messages automatically.

Refunds use a stable idempotency key. Pending/failed provider refunds remain actionable; only a succeeded refund is marked refunded. Retried or out-of-order notifications cannot overwrite a newer payment state. Property scope is checked before owner refund or Checkout-expiration requests and remains in every payment-store read/write predicate.

## Release verification

Deploy the changed guest functions (`booking-engine`, `booking-import`, `payment-action`, `stripe-webhook`, `stripe-refund`) with their shared dependencies and existing JWT settings. No database migration is required. The reusable signature verifier is also imported by `saas-stripe-webhook`; its signature-rotation improvement does not alter subscription configuration or billing operations.

Before enabling public sales, verify a dedicated sandbox Checkout, authenticated payment/refund handling, and signed webhook delivery against the deployed release. Keep live customer payments separate from synthetic local handler tests. No live payment is created by the automated test suite.

References: [Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment?payment-ui=stripe-hosted), [webhook signatures and retries](https://docs.stripe.com/webhooks), [restricted API keys](https://docs.stripe.com/keys/restricted-api-keys), [Supabase function configuration](https://supabase.com/docs/guides/functions/function-configuration).

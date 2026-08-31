import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { retrieveSaasSubscription } from "../_shared/saas-stripe.ts";
import { verifyStripeSignature } from "../_shared/stripe.ts";

type StripeEvent = {
  id: string;
  type: string;
  data?: { object?: Record<string, unknown> };
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function stringId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value && typeof value.id === "string") {
    return value.id;
  }
  return null;
}

function unixToIso(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value * 1000).toISOString()
    : null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const webhookSecret = Deno.env.get("SAAS_STRIPE_WEBHOOK_SECRET") ?? "";
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  if (!webhookSecret || !stripeKey) return json({ error: "billing_not_configured" }, 503);

  const signature = req.headers.get("Stripe-Signature") ?? "";
  const rawBody = await req.text();
  if (!(await verifyStripeSignature(rawBody, signature, webhookSecret))) {
    return json({ error: "invalid_signature" }, 400);
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody) as StripeEvent;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (!event.id || !event.type) return json({ error: "invalid_event" }, 400);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { error: claimError } = await admin.from("saas_billing_events").insert({
    event_id: event.id,
    event_type: event.type,
  });
  if (claimError?.code === "23505") return json({ ok: true, duplicate: true });
  if (claimError) return json({ error: "event_claim_failed" }, 500);

  const releaseClaim = async () => {
    await admin.from("saas_billing_events").delete().eq("event_id", event.id);
  };

  try {
    const object = event.data?.object ?? {};
    const metadata =
      object.metadata && typeof object.metadata === "object"
        ? (object.metadata as Record<string, string>)
        : {};

    if (event.type === "checkout.session.completed") {
      if (metadata.product !== "stayboost" && object.mode !== "subscription") {
        return json({ ok: true, ignored: true });
      }
      const ownerId = metadata.owner_id ?? (object.client_reference_id as string | undefined);
      const subscriptionId = stringId(object.subscription);
      if (!ownerId || !subscriptionId) {
        await releaseClaim();
        return json({ error: "missing_subscription_binding" }, 422);
      }

      const subscription = await retrieveSaasSubscription(stripeKey, subscriptionId);
      const subscriptionOwner = subscription.metadata?.owner_id ?? ownerId;
      if (subscriptionOwner !== ownerId) {
        await releaseClaim();
        return json({ error: "owner_binding_mismatch" }, 422);
      }
      const priceId = subscription.items?.data?.[0]?.price?.id ?? null;
      const { error } = await admin.from("account_subscriptions").upsert(
        {
          owner_id: ownerId,
          stripe_customer_id: stringId(subscription.customer),
          stripe_subscription_id: subscription.id,
          stripe_price_id: priceId,
          status: subscription.status,
          current_period_end: unixToIso(subscription.current_period_end),
          cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "owner_id" },
      );
      if (error) throw error;
      return json({ ok: true });
    }

    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      if (metadata.product && metadata.product !== "stayboost") {
        return json({ ok: true, ignored: true });
      }
      const ownerId = metadata.owner_id;
      if (!ownerId) {
        await releaseClaim();
        return json({ error: "missing_owner_metadata" }, 422);
      }
      const items = object.items as
        | { data?: Array<{ price?: { id?: string } }> }
        | undefined;
      const { error } = await admin.from("account_subscriptions").upsert(
        {
          owner_id: ownerId,
          stripe_customer_id: stringId(object.customer),
          stripe_subscription_id: stringId(object.id),
          stripe_price_id: items?.data?.[0]?.price?.id ?? null,
          status:
            event.type === "customer.subscription.deleted"
              ? "canceled"
              : String(object.status ?? "inactive"),
          current_period_end: unixToIso(object.current_period_end),
          cancel_at_period_end: Boolean(object.cancel_at_period_end),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "owner_id" },
      );
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ ok: true, ignored: true });
  } catch (error) {
    await releaseClaim();
    console.error("SaaS billing webhook failed", error);
    return json({ error: "processing_failed" }, 500);
  }
});

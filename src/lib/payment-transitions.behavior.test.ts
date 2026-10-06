import { stripeConfigForProperty } from "../../supabase/functions/_shared/stripe-config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { transpileModule, ScriptTarget } from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyCheckoutEvent,
  applyManualPaymentAction,
  PaymentTransitionError,
  joinedPropertyOwnerId,
  persistStripeRefund,
  stripeEventLedgerPatch,
  supabasePaymentStore,
  type PaymentBooking,
  type PaymentStore,
} from "../../supabase/functions/_shared/payment-lifecycle";
import { retrieveRefund, verifyStripeSignature } from "../../supabase/functions/_shared/stripe";

const NOW = "2026-09-29T12:00:00.000Z";
const BOOKING: PaymentBooking = {
  id: "booking-1",
  source: "direct",
  status: "confirmed",
  payment_method: "stripe",
  payment_status: "pending",
  payment_amount: 1495,
  payment_ref: "SB-ABC123",
  payment_expires_at: "2026-09-29T12:31:00.000Z",
  stripe_session_id: "cs_test_1",
  stripe_payment_intent_id: null,
  stripe_refund_id: null,
};
const SESSION = {
  id: "cs_test_1",
  client_reference_id: "booking-1",
  metadata: { booking_id: "booking-1", payment_ref: "SB-ABC123" },
  payment_status: "paid",
  amount_total: 149500,
  currency: "sek",
  payment_intent: "pi_1",
};

function memoryStore(overrides: Partial<PaymentBooking> = {}) {
  let state: PaymentBooking = { ...BOOKING, ...overrides };
  let beforeWrite: (() => void) | null = null;
  const writes: Record<string, unknown>[] = [];
  const store: PaymentStore = {
    async read() {
      return { ...state };
    },
    async compareAndSet(expected, patch) {
      beforeWrite?.();
      beforeWrite = null;
      if (JSON.stringify(expected) !== JSON.stringify(state)) return null;
      writes.push(patch);
      state = { ...state, ...patch } as PaymentBooking;
      return { ...state };
    },
  };
  return {
    store,
    writes,
    get state() {
      return state;
    },
    race(patch: Partial<PaymentBooking>) {
      beforeWrite = () => {
        state = { ...state, ...patch };
      };
    },
  };
}

describe("payment transitions under actual competing writes", () => {
  it("records late money as refund_pending when expiry wins the paid write", async () => {
    const db = memoryStore();
    db.race({ status: "cancelled", payment_status: "expired", payment_expires_at: null });
    const result = await applyCheckoutEvent(db.store, BOOKING.id, SESSION, true, NOW);
    expect(result.outcome).toBe("late_payment_refund_pending");
    expect(db.state.status).toBe("cancelled");
    expect(db.state.payment_status).toBe("refund_pending");
    expect(db.state.stripe_payment_intent_id).toBe("pi_1");
  });

  it("preserves paid status when payment wins an expiry race", async () => {
    const db = memoryStore();
    db.race({ payment_status: "paid", payment_expires_at: null });
    const result = await applyCheckoutEvent(db.store, BOOKING.id, SESSION, false, NOW);
    expect(result.outcome).toBe("expiry_ignored_paid");
    expect(db.state.status).toBe("confirmed");
    expect(db.writes).toHaveLength(0);
  });

  it("does not erase payment when payment wins an operator cancellation race", async () => {
    const db = memoryStore();
    db.race({ payment_status: "paid", payment_expires_at: null });
    const result = await applyManualPaymentAction(db.store, BOOKING.id, "cancel_booking", NOW);
    expect(result.booking.status).toBe("cancelled");
    expect(result.booking.payment_status).toBe("paid");
  });

  it("never reports Swish paid when expiry cancelled the booking", async () => {
    const db = memoryStore({ payment_method: "swish", stripe_session_id: null });
    db.race({ status: "cancelled", payment_status: "expired", payment_expires_at: null });
    await expect(
      applyManualPaymentAction(db.store, BOOKING.id, "mark_swish_paid", NOW),
    ).rejects.toMatchObject({ code: "invalid_payment_state", status: 409 });
    expect(db.state.payment_status).toBe("expired");
    expect(db.writes).toHaveLength(0);
  });

  it.each(["ical", "sirvoy", "channex"])(
    "rejects operator cancellation for %s source inventory",
    async (source) => {
      const db = memoryStore({ source });
      await expect(
        applyManualPaymentAction(db.store, BOOKING.id, "cancel_booking", NOW),
      ).rejects.toMatchObject({ code: "external_booking_cancel" });
      expect(db.writes).toHaveLength(0);
    },
  );

  it.each([
    [{ id: "cs_wrong" }, "session_mismatch"],
    [{ metadata: { ...SESSION.metadata, booking_id: "other" } }, "booking_metadata_mismatch"],
    [{ metadata: { ...SESSION.metadata, payment_ref: "wrong" } }, "payment_ref_mismatch"],
    [{ amount_total: 149400 }, "payment_mismatch"],
    [{ currency: "eur" }, "payment_mismatch"],
    [{ payment_status: "unpaid" }, "payment_mismatch"],
  ])("rejects a mismatched Checkout event without a payment write", async (patch, code) => {
    const db = memoryStore();
    await expect(
      applyCheckoutEvent(db.store, BOOKING.id, { ...SESSION, ...patch }, true, NOW),
    ).rejects.toMatchObject({ code, status: 400 });
    expect(db.writes).toHaveLength(0);
  });

  it("keeps binding races retryable", async () => {
    const db = memoryStore({ stripe_session_id: null });
    await expect(
      applyCheckoutEvent(db.store, BOOKING.id, SESSION, true, NOW),
    ).rejects.toMatchObject({ code: "session_not_bound", status: 503 });
  });

  it("does not count an unchanged zero-row write as success", async () => {
    const store: PaymentStore = {
      read: async () => ({ ...BOOKING }),
      compareAndSet: async () => null,
    };
    await expect(applyCheckoutEvent(store, BOOKING.id, SESSION, true, NOW)).rejects.toMatchObject({
      code: "payment_state_changed",
      status: 503,
    });
  });
});

describe("refund truth", () => {
  it.each(["pending", "requires_action", "failed", "canceled", null])(
    "keeps %s refunds pending",
    async (status) => {
      const db = memoryStore({
        payment_status: "refund_pending",
        stripe_payment_intent_id: "pi_1",
      });
      await persistStripeRefund(
        db.store,
        BOOKING.id,
        { id: "re_1", status, paymentIntentId: "pi_1" },
        NOW,
      );
      expect(db.state.payment_status).toBe("refund_pending");
      expect(db.writes[0].payment_refunded_at).toBeNull();
      expect(db.state.stripe_refund_id).toBe("re_1");
    },
  );

  it("marks succeeded refunds complete and refuses unrelated payment intents", async () => {
    const db = memoryStore({ payment_status: "refund_pending", stripe_payment_intent_id: "pi_1" });
    await expect(
      persistStripeRefund(
        db.store,
        BOOKING.id,
        { id: "re_1", status: "succeeded", paymentIntentId: "pi_other" },
        NOW,
      ),
    ).rejects.toMatchObject({ code: "payment_intent_mismatch" });
    await persistStripeRefund(
      db.store,
      BOOKING.id,
      { id: "re_1", status: "succeeded", paymentIntentId: "pi_1" },
      NOW,
    );
    expect(db.state.payment_status).toBe("refunded");
    expect(db.writes[0].payment_refunded_at).toBe(NOW);
  });

  it("preserves completed refunds against a stale create response", async () => {
    const db = memoryStore({ payment_status: "refund_pending", stripe_payment_intent_id: "pi_1" });
    db.race({ payment_status: "refunded", stripe_refund_id: "re_1" });
    await persistStripeRefund(
      db.store,
      BOOKING.id,
      { id: "re_1", status: "pending", paymentIntentId: "pi_1" },
      NOW,
    );
    expect(db.state.payment_status).toBe("refunded");
    expect(db.writes).toHaveLength(0);
  });

  it("makes a bank-reversed refund actionable again", async () => {
    const db = memoryStore({
      payment_status: "refunded",
      stripe_payment_intent_id: "pi_1",
      stripe_refund_id: "re_1",
    });
    await persistStripeRefund(
      db.store,
      BOOKING.id,
      { id: "re_1", status: "failed", paymentIntentId: "pi_1" },
      NOW,
    );
    expect(db.state.payment_status).toBe("refund_pending");
  });
});

type Row = Record<string, unknown>;
function mockDatabase() {
  const bookings = new Map<string, Row>([
    [BOOKING.id, { ...BOOKING, property_id: "11111111-1111-4111-8111-111111111111" }],
  ]);
  const events = new Map<string, Row>();
  let failReads = 0;
  const client = {
    from(table: string) {
      const rows = table === "bookings" ? bookings : events;
      const filters: [string, unknown][] = [];
      let operation = "select";
      let values: Row = {};
      const execute = () => {
        if (table === "bookings" && operation === "select" && failReads-- > 0)
          return { data: null, error: { message: "transient database outage" } };
        if (operation === "insert") {
          const id = String(values.event_id);
          if (rows.has(id)) return { data: null, error: { code: "23505" } };
          rows.set(id, { ...values, processed_at: null });
          return { data: null, error: null };
        }
        const match = [...rows.values()].find((row) =>
          filters.every(([key, expected]) => row[key] === expected),
        );
        if (match && operation === "update") Object.assign(match, values);
        return { data: match ? { ...match } : null, error: null };
      };
      const query = {
        select: (_columns?: string) => query,
        eq: (field: string, value: unknown) => {
          filters.push([field, value]);
          return query;
        },
        is: (field: string, value: unknown) => {
          filters.push([field, value]);
          return query;
        },
        update: (patch: Row) => {
          operation = "update";
          values = patch;
          return query;
        },
        insert: (row: Row) => {
          operation = "insert";
          values = row;
          return query;
        },
        maybeSingle: async () => execute(),
        then: (resolveResult: (result: ReturnType<typeof execute>) => unknown) =>
          Promise.resolve(execute()).then(resolveResult),
      };
      return query;
    },
  };
  return {
    client,
    bookings,
    events,
    failNextRead: () => {
      failReads = 1;
    },
  };
}

async function webhookHandler(
  db: ReturnType<typeof mockDatabase>,
  envPatch: Record<string, string | undefined> = {},
) {
  let handler!: (request: Request) => Promise<Response>;
  const source = readFileSync(
    resolve("supabase/functions/stripe-webhook/index.ts"),
    "utf8",
  ).replace(/import\s[\s\S]*?from\s+["'][^"']+["'];?/g, "");
  const compiled = transpileModule(source, {
    compilerOptions: { target: ScriptTarget.ES2022 },
  }).outputText;
  new Function(
    "Deno",
    "stripeConfigForProperty",
    "createClient",
    "verifyStripeSignature",
    "retrieveRefund",
    "applyCheckoutEvent",
    "PaymentTransitionError",
    "persistStripeRefund",
    "stripeEventLedgerPatch",
    "supabasePaymentStore",
    compiled,
  )(
    {
      serve: (callback: typeof handler) => {
        handler = callback;
      },
      env: {
        get: (key: string) =>
          (
            ({
              STRIPE_SECRET_KEY: "rk_test_mock",
              STRIPE_WEBHOOK_SECRET: "whsec_test",
              STRIPE_PROPERTY_ID: "11111111-1111-4111-8111-111111111111",
              ...envPatch,
            }) as Record<string, string | undefined>
          )[key],
      },
    },
    stripeConfigForProperty,
    () => db.client,
    verifyStripeSignature,
    retrieveRefund,
    applyCheckoutEvent,
    PaymentTransitionError,
    persistStripeRefund,
    stripeEventLedgerPatch,
    supabasePaymentStore,
  );
  return handler;
}

async function signedRequest(
  eventId = "evt_1",
  session = SESSION,
  eventType = "checkout.session.completed",
  envelope: Record<string, unknown> = {},
) {
  const body = JSON.stringify({
    id: eventId,
    type: eventType,
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    ...envelope,
    data: { object: session },
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("whsec_test"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = [
    ...new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`)),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return new Request("https://example.com/stripe-webhook", {
    method: "POST",
    body,
    headers: { "stripe-signature": `t=${timestamp},v1=${signature}` },
  });
}

describe("signed webhook delivery and ledger retries", () => {
  it("acknowledges unpaid completion without fulfillment, then applies asynchronous success once", async () => {
    const db = mockDatabase();
    const handler = await webhookHandler(db);
    const pending = await handler(
      await signedRequest("evt_pending", { ...SESSION, payment_status: "unpaid" }),
    );
    expect(pending.status).toBe(200);
    expect((await pending.json()).outcome).toBe("awaiting_payment");
    expect(db.bookings.get(BOOKING.id)).toMatchObject({
      payment_status: "pending",
      payment_expires_at: BOOKING.payment_expires_at,
    });
    const paid = await handler(
      await signedRequest("evt_async", SESSION, "checkout.session.async_payment_succeeded"),
    );
    expect(paid.status).toBe(200);
    expect(db.bookings.get(BOOKING.id)).toMatchObject({
      status: "confirmed",
      payment_status: "paid",
    });
    const duplicate = await handler(
      await signedRequest("evt_async", SESSION, "checkout.session.async_payment_succeeded"),
    );
    expect((await duplicate.json()).duplicate).toBe(true);
  });

  it("releases a failed async payment and keeps any later verified money as refund_pending", async () => {
    const db = mockDatabase();
    const handler = await webhookHandler(db);
    expect(
      (
        await handler(
          await signedRequest(
            "evt_failed",
            { ...SESSION, payment_status: "unpaid" },
            "checkout.session.async_payment_failed",
          ),
        )
      ).status,
    ).toBe(200);
    expect(db.bookings.get(BOOKING.id)).toMatchObject({
      status: "cancelled",
      payment_status: "expired",
    });
    expect(
      (
        await handler(
          await signedRequest("evt_paid", SESSION, "checkout.session.async_payment_succeeded"),
        )
      ).status,
    ).toBe(200);
    expect(db.bookings.get(BOOKING.id)).toMatchObject({
      status: "cancelled",
      payment_status: "refund_pending",
    });
  });

  it("ignores a delayed async failure after successful payment", async () => {
    const db = mockDatabase();
    const handler = await webhookHandler(db);
    await handler(await signedRequest());
    await handler(
      await signedRequest(
        "evt_failed",
        { ...SESSION, payment_status: "unpaid" },
        "checkout.session.async_payment_failed",
      ),
    );
    expect(db.bookings.get(BOOKING.id)).toMatchObject({
      status: "confirmed",
      payment_status: "paid",
    });
  });

  it("keeps a payment that actually succeeds after the finite hold actionable for refund even before cron runs", async () => {
    const db = mockDatabase();
    const handler = await webhookHandler(db);
    vi.setSystemTime("2026-09-29T13:00:00Z");
    await handler(
      await signedRequest("evt_late", SESSION, "checkout.session.async_payment_succeeded"),
    );
    expect(db.bookings.get(BOOKING.id)).toMatchObject({
      status: "cancelled",
      payment_status: "refund_pending",
    });
  });

  it("uses signed event time so transport delay alone does not turn an on-time payment into a refund", async () => {
    const db = mockDatabase();
    const handler = await webhookHandler(db);
    vi.setSystemTime("2026-09-29T13:00:00Z");
    await handler(
      await signedRequest("evt_delayed", SESSION, "checkout.session.completed", {
        created: Date.parse(NOW) / 1000,
      }),
    );
    expect(db.bookings.get(BOOKING.id)).toMatchObject({
      status: "confirmed",
      payment_status: "paid",
      payment_paid_at: NOW,
    });
  });

  it.each([{ livemode: true }, { account: "acct_connected" }])(
    "rejects a different Stripe mode/account before any ledger write",
    async (envelope) => {
      const db = mockDatabase();
      const handler = await webhookHandler(db);
      expect(
        (
          await handler(
            await signedRequest("evt_wrong", SESSION, "checkout.session.completed", envelope),
          )
        ).status,
      ).toBe(400);
      expect(db.events.size).toBe(0);
      expect(db.bookings.get(BOOKING.id)?.payment_status).toBe("pending");
    },
  );

  it("never loads another property's booking through the scoped payment store", async () => {
    const db = mockDatabase();
    db.bookings.get(BOOKING.id)!.property_id = "22222222-2222-4222-8222-222222222222";
    const handler = await webhookHandler(db);
    const response = await handler(await signedRequest());
    expect((await response.json()).ignored).toBe("booking_not_found");
    expect(db.bookings.get(BOOKING.id)?.payment_status).toBe("pending");
    expect(db.events.get("evt_1")?.booking_id).toBeUndefined();
  });

  it("accepts the matching signature when secret rotation sends another v1 first", async () => {
    const db = mockDatabase();
    const handler = await webhookHandler(db);
    const request = await signedRequest();
    const original = request.headers.get("stripe-signature")!;
    request.headers.set(
      "stripe-signature",
      original.replace(",v1=", ",v1=wrong_previous_secret,v1="),
    );
    expect((await handler(request)).status).toBe(200);
  });

  it.each(["STRIPE_PROPERTY_ID", "STRIPE_WEBHOOK_SECRET", "STRIPE_SECRET_KEY"])(
    "fails closed before ledger writes when %s is absent",
    async (field) => {
      const db = mockDatabase();
      const handler = await webhookHandler(db, { [field]: undefined });
      expect((await handler(await signedRequest())).status).toBe(503);
      expect(db.events.size).toBe(0);
    },
  );

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("resumes the same signed event after a transient DB failure", async () => {
    const db = mockDatabase();
    const handler = await webhookHandler(db);
    db.failNextRead();
    expect((await handler(await signedRequest())).status).toBe(503);
    expect(db.events.get("evt_1")?.processed_at).toBeNull();
    const retry = await handler(await signedRequest());
    expect(retry.status).toBe(200);
    expect((await retry.json()).paymentStatus).toBe("paid");
    expect(db.bookings.get(BOOKING.id)?.payment_status).toBe("paid");
    expect(db.events.get("evt_1")?.processed_at).toEqual(expect.any(String));
    const duplicate = await handler(await signedRequest());
    expect((await duplicate.json()).duplicate).toBe(true);
  });

  it("resumes Checkout completion after its session is bound", async () => {
    const db = mockDatabase();
    db.bookings.get(BOOKING.id)!.stripe_session_id = null;
    const handler = await webhookHandler(db);
    const first = await handler(await signedRequest());
    expect(first.status).toBe(503);
    expect((await first.json()).error).toBe("session_not_bound");
    expect(db.events.get("evt_1")?.processed_at).toBeNull();
    db.bookings.get(BOOKING.id)!.stripe_session_id = SESSION.id;
    expect((await handler(await signedRequest())).status).toBe(200);
    expect(db.bookings.get(BOOKING.id)?.payment_status).toBe("paid");
  });

  it("rejects unsigned requests before touching booking state", async () => {
    const db = mockDatabase();
    const handler = await webhookHandler(db);
    const response = await handler(
      new Request("https://example.com/stripe-webhook", { method: "POST", body: "{}" }),
    );
    expect(response.status).toBe(400);
    expect(db.events.size).toBe(0);
    expect(db.bookings.get(BOOKING.id)?.payment_status).toBe("pending");
  });
});

describe("owner relation normalization", () => {
  it("accepts the singular property in either PostgREST join shape", () => {
    expect(joinedPropertyOwnerId({ owner_id: "owner" })).toBe("owner");
    expect(joinedPropertyOwnerId([{ owner_id: "owner" }])).toBe("owner");
    expect(joinedPropertyOwnerId([{ owner_id: "owner" }, { owner_id: "other" }])).toBeNull();
    expect(joinedPropertyOwnerId([])).toBeNull();
    expect(joinedPropertyOwnerId(null)).toBeNull();
  });
});

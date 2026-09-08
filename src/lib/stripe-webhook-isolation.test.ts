import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  handleStripeWebhook,
  type StripeWebhookAdmin,
} from "../../supabase/functions/_shared/stripe-webhook";
import { verifyStripeSignature } from "../../supabase/functions/_shared/stripe";

// Replica of default-branch stripe-webhook booking I/O (main @ 84cb32c):
// select/update by Stripe client_reference_id / metadata.booking_id only.
// Used only when ISOLATION_AGAINST_MAIN=1 to record the leak. Not shipped.
async function handleStripeWebhookAsOnMain(
  req: Request,
  admin: StripeWebhookAdmin,
  secret: string,
): Promise<Response> {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!secret) return json({ error: "webhook_not_configured" }, 500);
  const rawBody = await req.text();
  if (!(await verifyStripeSignature(rawBody, req.headers.get("stripe-signature") ?? "", secret))) {
    return json({ error: "invalid_signature" }, 400);
  }
  const event = JSON.parse(rawBody);
  const session = event.data?.object ?? {};
  const bookingId = String(session.client_reference_id ?? session.metadata?.booking_id ?? "");
  await admin.from("stripe_webhook_events").insert({
    event_id: String(event.id),
    event_type: event.type,
    booking_id: bookingId,
  });
  const { data: booking } = await admin
    .from("bookings")
    .select(
      "id, status, payment_method, payment_status, payment_amount, payment_ref, stripe_session_id",
    )
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking || booking.payment_method !== "stripe") {
    return json({ error: "booking_not_found" }, 404);
  }
  if (String(session.id ?? "") !== booking.stripe_session_id) {
    return json({ error: "session_mismatch" }, 400);
  }
  const { error } = await admin
    .from("bookings")
    .update({
      payment_status: "paid",
      stripe_payment_intent_id: session.payment_intent ?? null,
    })
    .eq("id", bookingId)
    .eq("payment_method", "stripe");
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, bookingId, paymentStatus: "paid" });
}

const handleUnderTest =
  process.env.ISOLATION_AGAINST_MAIN === "1" ? handleStripeWebhookAsOnMain : handleStripeWebhook;

// Isolation oracle for the public service_role Stripe webhook.
// Two properties, one Stripe booking each. Cross-tenant attempts present
// B's property_id (tenant claim in session metadata) together with A's
// Stripe object ids. Stripe session / booking id alone is not a tenant scope.
//
// Trusted binding on this surface: bookings.property_id (NOT NULL in
// 20260719000000_fas1.sql). Checkout metadata today is only booking_id +
// payment_ref — this test does not invent a write contract. When
// metadata.property_id is present it is a claim that must match; when
// absent, property_id is derived from the booking row, then every data
// query/update re-filters on it. Missing or mismatch → same 404 as missing.

const WEBHOOK_SECRET = "whsec_isolation_test";

const propertyA = { id: "prop-a", slug: "lodge-a", name: "Alpine A" };
const propertyB = { id: "prop-b", slug: "lodge-b", name: "Beach B" };

const bookingA = {
  id: "book-a",
  property_id: "prop-a",
  unit_id: "unit-a",
  guest_name: "Alice",
  status: "confirmed",
  payment_method: "stripe",
  payment_status: "pending",
  payment_amount: 1500,
  payment_ref: "REF-A",
  stripe_session_id: "cs_test_a",
  stripe_payment_intent_id: null as string | null,
  payment_paid_at: null as string | null,
  payment_expires_at: "2026-09-03T16:00:00.000Z",
};

const bookingB = {
  id: "book-b",
  property_id: "prop-b",
  unit_id: "unit-b",
  guest_name: "Bob",
  status: "confirmed",
  payment_method: "stripe",
  payment_status: "pending",
  payment_amount: 2200,
  payment_ref: "REF-B",
  stripe_session_id: "cs_test_b",
  stripe_payment_intent_id: null as string | null,
  payment_paid_at: null as string | null,
  payment_expires_at: "2026-09-03T16:00:00.000Z",
};

type Row = Record<string, unknown>;
type Filter = { column: string; value: unknown };

function createMockAdmin(seedBookings: Row[] = [bookingA, bookingB]) {
  const tables: Record<string, Row[]> = {
    properties: [propertyA, propertyB],
    bookings: seedBookings.map((row) => ({ ...row })),
    stripe_webhook_events: [],
  };

  const from = (table: string) => {
    const filters: Filter[] = [];
    let patch: Row | null = null;

    const match = () =>
      (tables[table] ?? []).filter((row) =>
        filters.every((filter) => row[filter.column] === filter.value),
      );

    const query = {
      select() {
        return query;
      },
      insert(row: Row) {
        if (table === "stripe_webhook_events") {
          if (tables[table].some((existing) => existing.event_id === row.event_id)) {
            return Promise.resolve({ error: { code: "23505", message: "duplicate" } });
          }
          tables[table].push({ ...row });
        }
        return Promise.resolve({ error: null });
      },
      update(next: Row) {
        patch = next;
        return query;
      },
      eq(column: string, value: unknown) {
        filters.push({ column, value });
        return query;
      },
      async maybeSingle() {
        const rows = match();
        if (rows.length === 0) return { data: null, error: null };
        if (rows.length > 1) return { data: null, error: { message: "multiple_rows" } };
        return { data: { ...rows[0] }, error: null };
      },
      then(
        resolve: (value: { data: Row[]; error: null }) => unknown,
        reject?: (reason: unknown) => unknown,
      ) {
        if (patch) {
          for (const row of match()) Object.assign(row, patch);
        }
        return Promise.resolve({ data: match(), error: null }).then(resolve, reject);
      },
    };
    return query;
  };

  return {
    from,
    booking: (id: string) => tables.bookings.find((row) => row.id === id),
    events: () => tables.stripe_webhook_events,
  };
}

function signBody(rawBody: string, secret = WEBHOOK_SECRET): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

function checkoutCompletedPayload(opts: {
  eventId?: string;
  bookingId: string;
  sessionId: string;
  paymentRef: string;
  amountTotal: number;
  propertyId?: string;
}) {
  return {
    id: opts.eventId ?? `evt_${opts.bookingId}`,
    type: "checkout.session.completed",
    data: {
      object: {
        id: opts.sessionId,
        client_reference_id: opts.bookingId,
        payment_status: "paid",
        amount_total: opts.amountTotal,
        currency: "sek",
        payment_intent: `pi_${opts.bookingId}`,
        metadata: {
          booking_id: opts.bookingId,
          payment_ref: opts.paymentRef,
          ...(opts.propertyId ? { property_id: opts.propertyId } : {}),
        },
      },
    },
  };
}

async function replay(
  payload: unknown,
  admin: ReturnType<typeof createMockAdmin>,
  secret = WEBHOOK_SECRET,
) {
  const rawBody = JSON.stringify(payload);
  return handleUnderTest(
    new Request("http://stayboost.local/stripe-webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": signBody(rawBody, secret),
      },
      body: rawBody,
    }),
    admin,
    secret,
  );
}

const hasAPayload = (text: string) => /Alice|REF-A|book-a|cs_test_a|Alpine A|SECRET-A/.test(text);

describe("tenant isolation: stripe-webhook", () => {
  it("rejects a webhook for property A's Stripe id when the event claims property B", async () => {
    const admin = createMockAdmin();
    const res = await replay(
      checkoutCompletedPayload({
        bookingId: bookingA.id,
        sessionId: bookingA.stripe_session_id,
        paymentRef: bookingA.payment_ref,
        amountTotal: 150000,
        propertyId: propertyB.id,
      }),
      admin,
    );
    const body = await res.text();

    expect(res.status, `stripe-webhook must fail closed, got ${res.status}: ${body}`).toBe(404);
    expect(body).toBe(JSON.stringify({ error: "booking_not_found" }));
    expect(hasAPayload(body)).toBe(false);
    expect(body).not.toContain("Alice");
    expect(body).not.toContain("REF-A");
    expect(admin.booking("book-a")?.payment_status).toBe("pending");
    expect(admin.booking("book-a")?.stripe_payment_intent_id).toBeNull();
    expect(admin.booking("book-b")?.payment_status).toBe("pending");
  });

  it("still pays the matching tenant when Stripe ids and property_id agree, and when metadata has no property_id", async () => {
    const claimed = createMockAdmin();
    const claimedRes = await replay(
      checkoutCompletedPayload({
        bookingId: bookingA.id,
        sessionId: bookingA.stripe_session_id,
        paymentRef: bookingA.payment_ref,
        amountTotal: 150000,
        propertyId: propertyA.id,
      }),
      claimed,
    );
    expect(claimedRes.status).toBe(200);
    expect(await claimedRes.json()).toMatchObject({
      ok: true,
      bookingId: "book-a",
      paymentStatus: "paid",
    });
    expect(claimed.booking("book-a")?.payment_status).toBe("paid");
    expect(claimed.booking("book-b")?.payment_status).toBe("pending");

    const derived = createMockAdmin();
    const derivedRes = await replay(
      checkoutCompletedPayload({
        eventId: "evt_book-a_derived",
        bookingId: bookingA.id,
        sessionId: bookingA.stripe_session_id,
        paymentRef: bookingA.payment_ref,
        amountTotal: 150000,
      }),
      derived,
    );
    expect(derivedRes.status).toBe(200);
    expect(derived.booking("book-a")?.payment_status).toBe("paid");
    expect(derived.booking("book-b")?.payment_status).toBe("pending");
  });

  it("returns the same 404 as missing when the booking has no property_id", async () => {
    const admin = createMockAdmin([{ ...bookingA, property_id: null }]);
    const res = await replay(
      checkoutCompletedPayload({
        bookingId: bookingA.id,
        sessionId: bookingA.stripe_session_id,
        paymentRef: bookingA.payment_ref,
        amountTotal: 150000,
      }),
      admin,
    );
    const body = await res.text();
    expect(res.status).toBe(404);
    expect(body).toBe(JSON.stringify({ error: "booking_not_found" }));
    expect(admin.booking("book-a")?.payment_status).toBe("pending");
  });
});

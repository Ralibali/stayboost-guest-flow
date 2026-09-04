import { describe, expect, it } from "vitest";
import {
  handleStripeRefund,
  type StripeRefundAdmin,
  type StripeRefundGateway,
} from "../../supabase/functions/_shared/stripe-refund";

// Replica of default-branch stripe-refund booking I/O (main @ 348d8a3):
// select by booking.id + properties.owner_id join; updates by booking.id.
// Auth + owner-join is not property_id scoping. Used only when
// ISOLATION_AGAINST_MAIN=1 to record the leak. Not shipped.
async function handleStripeRefundAsOnMain(
  req: Request,
  opts: {
    admin: StripeRefundAdmin;
    userId: string;
    stripeKey: string;
    gateway?: StripeRefundGateway;
  },
): Promise<Response> {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: { bookingId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  if (!body.bookingId) return json({ error: "missing_booking" }, 400);

  const { data: booking, error: readError } = await opts.admin
    .from("bookings")
    .select(
      "id, payment_method, payment_status, payment_amount, payment_ref, stripe_session_id, stripe_payment_intent_id, stripe_refund_id, properties!inner(owner_id)",
    )
    .eq("id", body.bookingId)
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
      .eq("payment_status", "paid")
      .eq("payment_method", "stripe");
    if (error) return json({ error: error.message }, 500);
  }

  try {
    const paymentIntentId = booking.stripe_payment_intent_id as string | null;
    if (!paymentIntentId) {
      throw new Error("session saknar payment_intent");
    }

    const refund = await (
      opts.gateway?.createFullRefund ?? (async () => ({ id: "re_main", status: "succeeded" }))
    )({
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
      .eq("payment_method", "stripe")
      .eq("payment_status", "refund_pending");
    if (updateError) return json({ error: updateError.message, retrySafe: true }, 500);

    return json({ ok: true, method: "stripe", refundId: refund.id, refundStatus: refund.status });
  } catch (e) {
    return json({ error: "refund_failed", detail: String(e), retrySafe: true }, 502);
  }
}

const handleUnderTest =
  process.env.ISOLATION_AGAINST_MAIN === "1" ? handleStripeRefundAsOnMain : handleStripeRefund;

// Isolation oracle for the authenticated service_role Stripe refund.
// Two properties, one paid Stripe booking each, same owner (owner-join
// succeeds for both). Cross-tenant attempts present B's property_id
// (tenant claim) together with A's booking id. Auth + owner-join is not
// a tenant scope.
//
// Trusted binding on this surface: bookings.property_id (NOT NULL in
// 20260719000000_fas1.sql). The live client today sends only bookingId —
// this test does not invent a required write contract. When body.property_id
// is present it is a claim that must match; when absent, property_id is
// derived from the booking row, then every data query/update re-filters on
// it. Missing or mismatch → same 404 as missing.

const OWNER = "user-owner";
const STRIPE_KEY = "sk_test_isolation";

const propertyA = { id: "prop-a", slug: "lodge-a", name: "Alpine A", owner_id: OWNER };
const propertyB = { id: "prop-b", slug: "lodge-b", name: "Beach B", owner_id: OWNER };

const bookingA = {
  id: "book-a",
  property_id: "prop-a",
  unit_id: "unit-a",
  guest_name: "Alice",
  status: "confirmed",
  payment_method: "stripe",
  payment_status: "paid",
  payment_amount: 1500,
  payment_ref: "REF-A",
  stripe_session_id: "cs_test_a",
  stripe_payment_intent_id: "pi_a",
  stripe_refund_id: null as string | null,
  payment_refund_requested_at: null as string | null,
  payment_refunded_at: null as string | null,
};

const bookingB = {
  id: "book-b",
  property_id: "prop-b",
  unit_id: "unit-b",
  guest_name: "Bob",
  status: "confirmed",
  payment_method: "stripe",
  payment_status: "paid",
  payment_amount: 2200,
  payment_ref: "REF-B",
  stripe_session_id: "cs_test_b",
  stripe_payment_intent_id: "pi_b",
  stripe_refund_id: null as string | null,
  payment_refund_requested_at: null as string | null,
  payment_refunded_at: null as string | null,
};

type Row = Record<string, unknown>;
type Filter = { column: string; value: unknown };

function createMockAdmin(seedBookings: Row[] = [bookingA, bookingB]) {
  const tables: Record<string, Row[]> = {
    properties: [propertyA, propertyB],
    bookings: seedBookings.map((row) => ({ ...row })),
  };

  const from = (table: string) => {
    const filters: Filter[] = [];
    let patch: Row | null = null;
    let select = "*";

    const match = () =>
      (tables[table] ?? []).filter((row) =>
        filters.every((filter) => row[filter.column] === filter.value),
      );

    const applyEmbeds = (rows: Row[]) => {
      if (!select.includes("properties!inner(owner_id)")) return rows.map((row) => ({ ...row }));
      return rows
        .map((row) => {
          const property = tables.properties.find((item) => item.id === row.property_id);
          if (!property) return null;
          return { ...row, properties: { owner_id: property.owner_id } };
        })
        .filter((row): row is Row => row !== null);
    };

    const query = {
      select(columns: string) {
        select = columns;
        return query;
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
        const rows = applyEmbeds(match());
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
        return Promise.resolve({ data: applyEmbeds(match()), error: null }).then(resolve, reject);
      },
    };
    return query;
  };

  return {
    from,
    booking: (id: string) => tables.bookings.find((row) => row.id === id),
  };
}

function refundGateway() {
  const calls: Array<{ paymentIntentId: string; idempotencyKey: string }> = [];
  const gateway: StripeRefundGateway = {
    createFullRefund: async (params) => {
      calls.push({
        paymentIntentId: params.paymentIntentId,
        idempotencyKey: params.idempotencyKey,
      });
      return { id: `re_${params.paymentIntentId}`, status: "succeeded" };
    },
  };
  return { gateway, calls };
}

async function refund(
  body: Record<string, unknown>,
  admin: ReturnType<typeof createMockAdmin>,
  extra?: { userId?: string; gateway?: StripeRefundGateway },
) {
  return handleUnderTest(
    new Request("http://stayboost.local/stripe-refund", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    {
      admin,
      userId: extra?.userId ?? OWNER,
      stripeKey: STRIPE_KEY,
      gateway: extra?.gateway,
    },
  );
}

const hasAPayload = (text: string) =>
  /Alice|REF-A|book-a|cs_test_a|Alpine A|SECRET-A|pi_a/.test(text);

describe("tenant isolation: stripe-refund", () => {
  it("rejects a refund of property A's booking when acting as property B", async () => {
    const admin = createMockAdmin();
    const { gateway, calls } = refundGateway();
    const res = await refund({ bookingId: bookingA.id, property_id: propertyB.id }, admin, {
      gateway,
    });
    const body = await res.text();

    expect(res.status, `stripe-refund must fail closed, got ${res.status}: ${body}`).toBe(404);
    expect(body).toBe(JSON.stringify({ error: "not_found" }));
    expect(hasAPayload(body)).toBe(false);
    expect(body).not.toContain("Alice");
    expect(body).not.toContain("REF-A");
    expect(calls).toHaveLength(0);
    expect(admin.booking("book-a")?.payment_status).toBe("paid");
    expect(admin.booking("book-a")?.stripe_refund_id).toBeNull();
    expect(admin.booking("book-b")?.payment_status).toBe("paid");
  });

  it("still refunds the matching tenant when booking and property_id agree, and when the body has no property_id", async () => {
    const claimed = createMockAdmin();
    const claimedGw = refundGateway();
    const claimedRes = await refund(
      { bookingId: bookingA.id, property_id: propertyA.id },
      claimed,
      {
        gateway: claimedGw.gateway,
      },
    );
    expect(claimedRes.status).toBe(200);
    expect(await claimedRes.json()).toMatchObject({
      ok: true,
      method: "stripe",
      refundId: "re_pi_a",
    });
    expect(claimed.booking("book-a")?.payment_status).toBe("refunded");
    expect(claimed.booking("book-b")?.payment_status).toBe("paid");
    expect(claimedGw.calls).toEqual([
      { paymentIntentId: "pi_a", idempotencyKey: "stayboost-refund-book-a" },
    ]);

    const derived = createMockAdmin();
    const derivedGw = refundGateway();
    const derivedRes = await refund({ bookingId: bookingA.id }, derived, {
      gateway: derivedGw.gateway,
    });
    expect(derivedRes.status).toBe(200);
    expect(derived.booking("book-a")?.payment_status).toBe("refunded");
    expect(derived.booking("book-b")?.payment_status).toBe("paid");
    expect(derivedGw.calls).toHaveLength(1);
  });

  it("returns the same 404 as missing when the booking has no property_id", async () => {
    const admin = createMockAdmin([{ ...bookingA, property_id: null }]);
    const { gateway, calls } = refundGateway();
    const res = await refund({ bookingId: bookingA.id }, admin, { gateway });
    const body = await res.text();
    expect(res.status).toBe(404);
    expect(body).toBe(JSON.stringify({ error: "not_found" }));
    expect(calls).toHaveLength(0);
    expect(admin.booking("book-a")?.payment_status).toBe("paid");
  });
});

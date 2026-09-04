import { describe, expect, it } from "vitest";
import {
  handlePaymentAction,
  type PaymentActionAdmin,
} from "../../supabase/functions/_shared/payment-action";

// Replica of default-branch payment-action booking I/O (main @ 348d8a3):
// select by booking.id + properties!inner(owner_id) JS check; updates by
// booking.id without property_id. Owner-join is not a property_id scope
// under service_role. Used only when ISOLATION_AGAINST_MAIN=1. Not shipped.
async function handlePaymentActionAsOnMain(
  req: Request,
  admin: PaymentActionAdmin,
  userId: string,
): Promise<Response> {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  let body: { bookingId?: string; action?: string; propertyId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  if (!body.bookingId || !body.action) return json({ error: "missing_fields" }, 400);

  const { data: booking } = await admin
    .from("bookings")
    .select(
      "id, status, payment_method, payment_status, payment_expires_at, stripe_session_id, properties!inner(owner_id)",
    )
    .eq("id", body.bookingId)
    .maybeSingle();
  // Owner-join is a post-fetch JS check, not a property_id predicate.
  // Missing properties (no property_id) still writes by booking.id — the leak.
  if (!booking) return json({ error: "not_found" }, 404);
  const joinedOwner = (booking.properties as { owner_id: string } | null)?.owner_id;
  if (joinedOwner && joinedOwner !== userId) return json({ error: "not_found" }, 404);

  if (body.action === "cancel_booking") {
    if (booking.status === "cancelled") {
      return json({ ok: true, duplicate: true, status: "cancelled" });
    }
    const { error } = await admin.from("bookings").update({ status: "cancelled" }).eq("id", booking.id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, status: "cancelled" });
  }

  if (booking.payment_method !== "swish") return json({ error: "wrong_payment_method" }, 400);

  if (body.action === "mark_swish_paid") {
    const { error } = await admin
      .from("bookings")
      .update({ payment_status: "paid" })
      .eq("id", booking.id)
      .eq("payment_method", "swish")
      .eq("payment_status", "pending")
      .eq("status", "confirmed");
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, status: "paid" });
  }

  return json({ error: "invalid_action" }, 400);
}

const handleUnderTest =
  process.env.ISOLATION_AGAINST_MAIN === "1"
    ? handlePaymentActionAsOnMain
    : handlePaymentAction;

// Isolation oracle for the authenticated service_role payment-action.
// Two properties. Cross-tenant attempts present B's property_id (tenant
// claim) and/or B's owner JWT together with A's booking.id. Booking id +
// owner-join is not a tenant scope. Trusted binding: bookings.property_id
// after resolve, or a property owned by auth.uid() (NOT NULL in
// 20260719000000_fas1.sql). Every bookings data query/update re-filters
// on it. Missing or mismatch → same 404 as missing. No new metadata.

const ownerA = "owner-a";
const ownerB = "owner-b";

const propertyA = { id: "prop-a", owner_id: ownerA, slug: "lodge-a", name: "Alpine A" };
const propertyB = { id: "prop-b", owner_id: ownerB, slug: "lodge-b", name: "Beach B" };

const bookingA = {
  id: "book-a",
  property_id: "prop-a",
  unit_id: "unit-a",
  guest_name: "Alice",
  status: "confirmed",
  payment_method: "swish",
  payment_status: "pending",
  payment_expires_at: "2026-12-01T00:00:00.000Z",
  stripe_session_id: null as string | null,
  payment_paid_at: null as string | null,
  payment_refund_requested_at: null as string | null,
  payment_refunded_at: null as string | null,
  payment_expired_at: null as string | null,
};

const bookingB = {
  id: "book-b",
  property_id: "prop-b",
  unit_id: "unit-b",
  guest_name: "Bob",
  status: "confirmed",
  payment_method: "swish",
  payment_status: "pending",
  payment_expires_at: "2026-12-01T00:00:00.000Z",
  stripe_session_id: null as string | null,
  payment_paid_at: null as string | null,
  payment_refund_requested_at: null as string | null,
  payment_refunded_at: null as string | null,
  payment_expired_at: null as string | null,
};

type Row = Record<string, unknown>;
type Filter = { column: string; value: unknown };

function createMockAdmin(
  seedBookings: Row[] = [bookingA, bookingB],
  seedProperties: Row[] = [propertyA, propertyB],
) {
  const tables: Record<string, Row[]> = {
    properties: seedProperties.map((row) => ({ ...row })),
    bookings: seedBookings.map((row) => ({ ...row })),
  };

  const from = (table: string) => {
    const filters: Filter[] = [];
    let patch: Row | null = null;
    let selectCols = "";

    const match = () =>
      (tables[table] ?? []).filter((row) =>
        filters.every((filter) => row[filter.column] === filter.value),
      );

    const attachJoin = (row: Row) => {
      const next = { ...row };
      if (table === "bookings" && selectCols.includes("properties")) {
        const property = tables.properties.find((item) => item.id === row.property_id);
        next.properties = property ? { owner_id: property.owner_id } : null;
      }
      return next;
    };

    const query = {
      select(columns?: string) {
        selectCols = columns ?? "";
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
        const rows = match();
        if (rows.length === 0) return { data: null, error: null };
        if (rows.length > 1) return { data: null, error: { message: "multiple_rows" } };
        return { data: attachJoin(rows[0]), error: null };
      },
      then(
        resolve: (value: { data: Row[]; error: null }) => unknown,
        reject?: (reason: unknown) => unknown,
      ) {
        if (patch) {
          for (const row of match()) Object.assign(row, patch);
        }
        return Promise.resolve({ data: match().map(attachJoin), error: null }).then(resolve, reject);
      },
    };
    return query;
  };

  return {
    from,
    booking: (id: string) => tables.bookings.find((row) => row.id === id),
  };
}

async function replay(
  admin: ReturnType<typeof createMockAdmin>,
  userId: string,
  body: { bookingId: string; action: string; propertyId?: string },
) {
  return handleUnderTest(
    new Request("http://stayboost.local/payment-action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    admin,
    userId,
  );
}

const hasAPayload = (text: string) => /Alice|book-a|Alpine A|SECRET-A/.test(text);

describe("tenant isolation: payment-action", () => {
  it("rejects acting on property A's booking when authenticated as B / claiming B", async () => {
    // Two properties, one operator (B). Owner-join would pass for both;
    // claiming B while acting on A's booking.id is the leak on main.
    const admin = createMockAdmin([bookingA, bookingB], [
      { ...propertyA, owner_id: ownerB },
      propertyB,
    ]);
    const res = await replay(admin, ownerB, {
      bookingId: bookingA.id,
      action: "cancel_booking",
      propertyId: propertyB.id,
    });
    const body = await res.text();

    expect(res.status, `payment-action must fail closed, got ${res.status}: ${body}`).toBe(404);
    expect(body).toBe(JSON.stringify({ error: "not_found" }));
    expect(hasAPayload(body)).toBe(false);
    expect(body).not.toContain("Alice");
    expect(admin.booking("book-a")?.status).toBe("confirmed");
    expect(admin.booking("book-a")?.payment_status).toBe("pending");
    expect(admin.booking("book-b")?.status).toBe("confirmed");
  });

  it("rejects marking property A's Swish paid when the request claims property B", async () => {
    // Same owner of A and B — owner-join would pass; property_id must not.
    const admin = createMockAdmin([bookingA, bookingB], [
      { ...propertyA, owner_id: ownerB },
      propertyB,
    ]);
    const res = await replay(admin, ownerB, {
      bookingId: bookingA.id,
      action: "mark_swish_paid",
      propertyId: propertyB.id,
    });
    const body = await res.text();

    expect(res.status, `payment-action must fail closed, got ${res.status}: ${body}`).toBe(404);
    expect(body).toBe(JSON.stringify({ error: "not_found" }));
    expect(admin.booking("book-a")?.payment_status).toBe("pending");
    expect(admin.booking("book-a")?.guest_name).toBe("Alice");
    expect(admin.booking("book-b")?.payment_status).toBe("pending");
  });

  it("still applies the action when booking and property_id agree, and when the body has no propertyId", async () => {
    const claimed = createMockAdmin();
    const claimedRes = await replay(claimed, ownerA, {
      bookingId: bookingA.id,
      action: "cancel_booking",
      propertyId: propertyA.id,
    });
    expect(claimedRes.status).toBe(200);
    expect(await claimedRes.json()).toMatchObject({ ok: true, status: "cancelled" });
    expect(claimed.booking("book-a")?.status).toBe("cancelled");
    expect(claimed.booking("book-b")?.status).toBe("confirmed");

    const derived = createMockAdmin();
    const derivedRes = await replay(derived, ownerA, {
      bookingId: bookingA.id,
      action: "mark_swish_paid",
    });
    expect(derivedRes.status).toBe(200);
    expect(await derivedRes.json()).toMatchObject({ ok: true, status: "paid" });
    expect(derived.booking("book-a")?.payment_status).toBe("paid");
    expect(derived.booking("book-b")?.payment_status).toBe("pending");
  });

  it("returns the same 404 as missing when the booking has no property_id", async () => {
    const admin = createMockAdmin([{ ...bookingA, property_id: null }]);
    const res = await replay(admin, ownerA, {
      bookingId: bookingA.id,
      action: "cancel_booking",
    });
    const body = await res.text();
    expect(res.status).toBe(404);
    expect(body).toBe(JSON.stringify({ error: "not_found" }));
    expect(admin.booking("book-a")?.status).toBe("confirmed");
  });
});

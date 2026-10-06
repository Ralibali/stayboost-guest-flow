import { stripeConfigForProperty } from "../../supabase/functions/_shared/stripe-config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ScriptTarget, transpileModule } from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as pricing from "../../supabase/functions/_shared/pricing";
import * as rules from "../../supabase/functions/_shared/rate-rules";
import * as addons from "../../supabase/functions/_shared/addons";
import { appBaseUrl } from "../../supabase/functions/_shared/app-url";
import { normalizeGuestPhone } from "../../supabase/functions/_shared/guest-contact";
import { stockholmDay } from "../../supabase/functions/_shared/guest-stay";
import { collectPages } from "../../supabase/functions/_shared/pagination";
import { sanitizedHttpsUrl } from "../../supabase/functions/_shared/public-links";
import { channelInventoryFresh } from "../../supabase/functions/_shared/channel-freshness";
import {
  applyCheckoutEvent,
  applyManualPaymentAction,
  joinedPropertyOwnerId,
  PaymentTransitionError,
  supabasePaymentStore,
} from "../../supabase/functions/_shared/payment-lifecycle";

const NOW = "2026-10-05T12:00:00.000Z";
const SESSION = { id: "cs_race", url: "https://checkout.stripe.com/test_session" };
type Row = Record<string, unknown>;

// This adapter applies the handler's actual query predicates, including a
// successful update with zero affected rows. Hooks place competing writes at
// the ownership read, session bind and cancellation compare-and-set boundaries.
function database(initialBooking: Row | null = null) {
  let booking = initialBooking ? { ...initialBooking } : null;
  const state = {
    get booking() {
      return booking;
    },
    set booking(row: Row | null) {
      booking = row;
    },
    enabled: true,
    bindError: false,
    beforeBind: null as (() => void) | null,
    afterOwnershipRead: null as (() => void) | null,
    beforeCancelWrite: null as (() => void) | null,
    writes: [] as string[],
  };
  const property = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Glamping",
    slug: "glamping",
    max_stay: 30,
    booking_terms_url: "https://example.test/terms",
  };
  const unit = {
    id: "tent",
    name: "Tent",
    property_id: property.id,
    active: true,
    max_guests: 2,
    base_price: 1000,
    weekend_pct: 0,
    min_stay: 1,
    cleaning_fee: 0,
    monthly_mult: Array(12).fill(100),
  };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "owner" } }, error: null }) },
    from(table: string) {
      let operation = "select";
      let fields = "";
      let patch: Row = {};
      const predicates: ((row: Row) => boolean)[] = [];
      const run = (single: boolean) => {
        if (table !== "bookings") {
          const data =
            table === "properties"
              ? { ...property, booking_enabled: state.enabled }
              : table === "units"
                ? unit
                : single
                  ? null
                  : [];
          return { data, error: null, count: 0 };
        }
        if (operation === "update" && "stripe_session_id" in patch) {
          const hook = state.beforeBind;
          state.beforeBind = null;
          hook?.();
          if (state.bindError) return { data: null, error: { message: "bind failed" } };
        }
        if (operation === "update" && patch.status === "cancelled") {
          const hook = state.beforeCancelWrite;
          state.beforeCancelWrite = null;
          hook?.();
        }
        if (operation === "insert") {
          booking = {
            id: "booking",
            guest_token: "guest-token",
            status: "confirmed",
            stripe_session_id: null,
            stripe_payment_intent_id: null,
            stripe_refund_id: null,
            ...patch,
          };
          state.writes.push("insert");
        } else if (!booking || !predicates.every((predicate) => predicate(booking!))) {
          return { data: single ? null : [], error: null };
        } else if (operation === "update") {
          booking = { ...booking, ...patch };
          state.writes.push("update");
        } else if (operation === "delete") {
          booking = null;
          state.writes.push("delete");
        }
        const snapshot = booking ? { ...booking } : null;
        if (snapshot && fields.includes("properties!inner")) {
          snapshot.properties = { owner_id: "owner" };
          const hook = state.afterOwnershipRead;
          state.afterOwnershipRead = null;
          hook?.();
        }
        return { data: single ? snapshot : snapshot ? [snapshot] : [], error: null };
      };
      const query = {
        select(value: string) {
          fields = value;
          return this;
        },
        insert(value: Row) {
          operation = "insert";
          patch = value;
          return this;
        },
        update(value: Row) {
          operation = "update";
          patch = value;
          return this;
        },
        delete() {
          operation = "delete";
          return this;
        },
        eq(key: string, value: unknown) {
          predicates.push((row) => row[key] === value);
          return this;
        },
        is(key: string, value: unknown) {
          return this.eq(key, value);
        },
        lt(key: string, value: string) {
          predicates.push((row) => String(row[key]) < value);
          return this;
        },
        gt(key: string, value: string) {
          predicates.push((row) => String(row[key]) > value);
          return this;
        },
        gte() {
          return this;
        },
        lte() {
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return this;
        },
        range() {
          return this;
        },
        async single() {
          return run(true);
        },
        async maybeSingle() {
          return run(true);
        },
        then(onFulfilled: (value: unknown) => unknown) {
          return Promise.resolve(run(false)).then(onFulfilled);
        },
      };
      return query;
    },
  };
  return { state, client };
}

const compiled = new Map<string, string>();
function handlerFor(
  slug: string,
  bindings: Record<string, unknown>,
  envPatch: Record<string, string | undefined> = {},
) {
  bindings = { stripeConfigForProperty, ...bindings };
  if (!compiled.has(slug)) {
    const source = readFileSync(resolve(`supabase/functions/${slug}/index.ts`), "utf8").replace(
      /import[\s\S]*?from\s+["'][^"']+["'];\s*/g,
      "",
    );
    compiled.set(
      slug,
      transpileModule(source, {
        compilerOptions: { target: ScriptTarget.ES2022 },
      }).outputText,
    );
  }
  let handler!: (request: Request) => Promise<Response>;
  new Function("Deno", ...Object.keys(bindings), `"use strict";\n${compiled.get(slug)!}`)(
    {
      serve: (callback: typeof handler) => {
        handler = callback;
      },
      env: {
        get: (key: string) =>
          (
            ({
              STRIPE_SECRET_KEY: "sk_test_mock",
              STRIPE_WEBHOOK_SECRET: "whsec_test",
              STRIPE_PROPERTY_ID: "11111111-1111-4111-8111-111111111111",
              ...envPatch,
            }) as Record<string, string | undefined>
          )[key],
      },
    },
    ...Object.values(bindings),
  );
  return handler;
}

function engine(
  db: ReturnType<typeof database>,
  envPatch: Record<string, string | undefined> = {},
) {
  const createCheckoutSession = vi.fn(async () => SESSION);
  const expireCheckoutSession = vi.fn(async () => undefined);
  const handler = handlerFor(
    "booking-engine",
    {
      createClient: () => db.client,
      ...pricing,
      ...rules,
      ...addons,
      createCheckoutSession,
      expireCheckoutSession,
      appBaseUrl,
      normalizeGuestPhone,
      stockholmDay,
      collectPages,
      sanitizedHttpsUrl,
      channelInventoryFresh,
    },
    envPatch,
  );
  const request = () =>
    handler(
      new Request("https://example.test/booking-engine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: "glamping",
          unitId: "tent",
          checkin: "2026-10-06",
          checkout: "2026-10-07",
          guest_name: "Test Guest",
          guest_email: "guest@example.test",
          guests: 2,
          termsAccepted: true,
          paymentMethod: "stripe",
        }),
      }),
    );
  return { request, createCheckoutSession, expireCheckoutSession };
}

const pendingBooking = () => ({
  id: "booking",
  property_id: "11111111-1111-4111-8111-111111111111",
  source: "direct",
  status: "confirmed",
  payment_method: "stripe",
  payment_status: "pending",
  payment_amount: 1000,
  payment_ref: "SB-TEST",
  payment_expires_at: "2026-10-05T12:31:00.000Z",
  stripe_session_id: null,
  stripe_payment_intent_id: null,
  stripe_refund_id: null,
});

function cancellation(db: ReturnType<typeof database>) {
  const expireCheckoutSession = vi.fn(async () => undefined);
  const handler = handlerFor("payment-action", {
    createClient: () => db.client,
    expireCheckoutSession,
    applyManualPaymentAction,
    PaymentTransitionError,
    joinedPropertyOwnerId,
    supabasePaymentStore,
  });
  const request = () =>
    handler(
      new Request("https://example.test/payment-action", {
        method: "POST",
        headers: { authorization: "Bearer mock-owner", "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId: "booking", action: "cancel_booking" }),
      }),
    );
  return { request, expireCheckoutSession };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("No real network in payment tests");
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("public Checkout binding under competing changes", () => {
  it("returns a Checkout URL only after the pending confirmed row was bound", async () => {
    const db = database();
    const runtime = engine(db);
    const response = await runtime.request();
    expect(response.status).toBe(200);
    expect((await response.json()).checkoutUrl).toBe(SESSION.url);
    expect(db.state.booking?.stripe_session_id).toBe(SESSION.id);
    expect(runtime.expireCheckoutSession).not.toHaveBeenCalled();
  });

  it.each(["expired", "pending"])(
    "closes the session and preserves a cancelled/%s booking after a zero-row bind",
    async (paymentStatus) => {
      const db = database();
      db.state.beforeBind = () => {
        Object.assign(db.state.booking!, { status: "cancelled", payment_status: paymentStatus });
      };
      const runtime = engine(db);
      const response = await runtime.request();
      expect(response.status).toBe(502);
      expect(await response.json()).not.toHaveProperty("checkoutUrl");
      expect(runtime.expireCheckoutSession).toHaveBeenCalledExactlyOnceWith(
        "sk_test_mock",
        SESSION.id,
      );
      expect(db.state.booking).toMatchObject({
        status: "cancelled",
        payment_status: paymentStatus,
      });
      expect(db.state.writes).not.toContain("delete");
    },
  );

  it("expires an unbound session when its booking disappeared", async () => {
    const db = database();
    db.state.beforeBind = () => {
      db.state.booking = null;
    };
    const runtime = engine(db);
    expect((await runtime.request()).status).toBe(502);
    expect(runtime.expireCheckoutSession).toHaveBeenCalledExactlyOnceWith(
      "sk_test_mock",
      SESSION.id,
    );
  });

  it("deletes a failed pending reservation only after Stripe confirms expiration", async () => {
    const db = database();
    db.state.bindError = true;
    const runtime = engine(db);
    runtime.expireCheckoutSession.mockImplementation(async () => {
      expect(db.state.booking?.status).toBe("confirmed");
    });
    expect((await runtime.request()).status).toBe(502);
    expect(runtime.expireCheckoutSession).toHaveBeenCalledOnce();
    expect(db.state.booking).toBeNull();
  });

  it("retains the inventory hold when Stripe expiration fails", async () => {
    const db = database();
    db.state.bindError = true;
    const runtime = engine(db);
    runtime.expireCheckoutSession.mockRejectedValue(new Error("Stripe unavailable"));
    const response = await runtime.request();
    expect(response.status).toBe(502);
    expect((await response.json()).error).toBe("stripe_binding_failed");
    expect(db.state.booking).toMatchObject({ status: "confirmed", payment_status: "pending" });
    expect(db.state.writes).not.toContain("delete");
  });

  it("retains a concurrent cancellation when creating Stripe Checkout fails", async () => {
    const db = database();
    const runtime = engine(db);
    runtime.createCheckoutSession.mockImplementation(async () => {
      db.state.booking!.status = "cancelled";
      throw new Error("Stripe unavailable");
    });
    expect((await runtime.request()).status).toBe(502);
    expect(db.state.booking?.status).toBe("cancelled");
    expect(db.state.writes).not.toContain("delete");
  });

  it("never starts Checkout for a paused property", async () => {
    const db = database();
    db.state.enabled = false;
    const runtime = engine(db);
    const response = await runtime.request();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "booking_paused" });
    expect(runtime.createCheckoutSession).not.toHaveBeenCalled();
    expect(db.state.booking).toBeNull();
  });
});

describe("owner cancellation while Checkout is being bound", () => {
  it.each(["afterOwnershipRead", "beforeCancelWrite"] as const)(
    "closes the session that binds at %s",
    async (boundary) => {
      const db = database(pendingBooking());
      db.state[boundary] = () => {
        db.state.booking!.stripe_session_id = SESSION.id;
      };
      const runtime = cancellation(db);
      expect((await runtime.request()).status).toBe(200);
      expect(db.state.booking).toMatchObject({ status: "cancelled", payment_status: "expired" });
      expect(runtime.expireCheckoutSession).toHaveBeenCalledExactlyOnceWith(
        "sk_test_mock",
        SESSION.id,
      );
    },
  );

  it("does not expire an already closed session a second time", async () => {
    const db = database({ ...pendingBooking(), stripe_session_id: SESSION.id });
    const runtime = cancellation(db);
    expect((await runtime.request()).status).toBe(200);
    expect(runtime.expireCheckoutSession).toHaveBeenCalledOnce();
  });

  it("preserves verified payment when a paid booking is cancelled", async () => {
    const db = database({
      ...pendingBooking(),
      payment_status: "paid",
      payment_expires_at: null,
      stripe_session_id: SESSION.id,
    });
    const runtime = cancellation(db);
    expect((await runtime.request()).status).toBe(200);
    expect(db.state.booking).toMatchObject({ status: "cancelled", payment_status: "paid" });
    expect(runtime.expireCheckoutSession).not.toHaveBeenCalled();
  });

  it("retries closing Checkout for an already cancelled booking", async () => {
    const db = database({
      ...pendingBooking(),
      status: "cancelled",
      payment_status: "expired",
      stripe_session_id: SESSION.id,
    });
    const runtime = cancellation(db);
    const response = await runtime.request();
    expect((await response.json()).duplicate).toBe(true);
    expect(runtime.expireCheckoutSession).toHaveBeenCalledExactlyOnceWith(
      "sk_test_mock",
      SESSION.id,
    );
  });

  it("retains failed expiration and records any later payment as refund_pending", async () => {
    const db = database(pendingBooking());
    db.state.afterOwnershipRead = () => {
      db.state.booking!.stripe_session_id = SESSION.id;
    };
    const runtime = cancellation(db);
    runtime.expireCheckoutSession.mockRejectedValue(new Error("Stripe unavailable"));
    expect((await runtime.request()).status).toBe(200);
    expect(db.state.booking).toMatchObject({ status: "cancelled", payment_status: "expired" });
    const result = await applyCheckoutEvent(
      supabasePaymentStore(db.client),
      "booking",
      {
        id: SESSION.id,
        metadata: { booking_id: "booking", payment_ref: "SB-TEST" },
        payment_status: "paid",
        amount_total: 100000,
        currency: "sek",
        payment_intent: "pi_paid",
      },
      true,
      NOW,
    );
    expect(result.outcome).toBe("late_payment_refund_pending");
    expect(db.state.booking).toMatchObject({
      status: "cancelled",
      payment_status: "refund_pending",
    });
  });
});

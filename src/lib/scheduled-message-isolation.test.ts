import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  sendScheduledMessages,
  type MessageStore,
  type PendingMessage,
} from "../../supabase/functions/_shared/scheduled-messages";

type QueueRow = PendingMessage & { status: string; error?: string | null };
const now = new Date("2026-09-06T10:00:00.000Z");

function message(property: string, channel: "sms" | "email" = "email"): QueueRow {
  return {
    id: `message-${property}`,
    booking_id: `booking-${property}`,
    template_id: `template-${property}`,
    channel,
    status: "pending",
    send_at: "2026-09-06T09:00:00.000Z",
    booking: {
      id: `booking-${property}`,
      property_id: property,
      status: "confirmed",
      guest_name: `Guest ${property}`,
      guest_email: `${property}@example.test`,
      guest_phone: property === "a" ? "+46700000001" : "+46700000002",
      checkin_date: "2026-09-07",
      checkout_date: "2026-09-09",
      guest_token: `token-${property}`,
      payment_status: "none",
      unit: { name: `Cabin ${property}`, property_id: property },
      property: {
        id: property,
        name: `Property ${property}`,
        checkin_time: "15:00",
        checkout_time: "10:00",
        directions: `Directions ${property}`,
        wifi_name: `Wifi ${property}`,
        wifi_password: `password-${property}`,
        contact_phone: null,
        review_url: null,
      },
    },
    template: {
      id: `template-${property}`,
      property_id: property,
      subject: `Welcome ${property}`,
      body: `Template ${property}: {{gäst_namn}} {{anläggning}} {{enhet}} {{wifi_lösenord}} {{gästsida_länk}}`,
    },
  };
}

// Apply the actual PostgREST select projection, including nested aliases. This
// catches missing scope columns in production queries, not just missing guards.
function project(row: unknown, select: string): unknown {
  if (row === null || typeof row !== "object") return row;
  // Split only at depth zero (relations can themselves contain relations).
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= select.length; i++) {
    if (select[i] === "(") depth++;
    if (select[i] === ")") depth--;
    if (i === select.length || (select[i] === "," && depth === 0)) {
      parts.push(select.slice(start, i).trim());
      start = i + 1;
    }
  }
  return Object.fromEntries(
    parts.map((part) => {
      const open = part.indexOf("(");
      const key = (open < 0 ? part : part.slice(0, open)).split(":")[0];
      const value = (row as Record<string, unknown>)[key];
      return [key, open < 0 ? value : project(value, part.slice(open + 1, -1))];
    }),
  );
}

function harness(initial: QueueRow[]) {
  const rows = structuredClone(initial);
  const requests: URL[] = [];
  const databaseFetch = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    requests.push(url);
    expect(url.hostname).toBe("messages.test");
    expect(url.pathname).toBe("/rest/v1/scheduled_messages");
    const matched = rows.filter((row) =>
      [...url.searchParams].every(([key, filter]) => {
        const value = row[key as keyof QueueRow];
        if (filter.startsWith("eq.")) return String(value) === filter.slice(3);
        if (filter === "is.null") return value === null;
        if (filter.startsWith("lte.")) return String(value) <= filter.slice(4);
        return true;
      }),
    );
    if (init?.method === "PATCH") {
      const patch = JSON.parse(String(init.body));
      matched.forEach((row) => Object.assign(row, patch));
      return new Response(null, { status: 204 });
    }
    return Response.json(matched.map((row) => project(row, url.searchParams.get("select") ?? "")));
  });
  const admin = createClient("https://messages.test", "local-test-key", {
    global: { fetch: databaseFetch },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const delivery = vi.fn<typeof fetch>(async () => Response.json({ id: "fake-delivery" }));
  const env: Record<string, string> = {
    BREVO_API_KEY: "test-only",
    BREVO_SENDER_EMAIL: "sender@example.test",
    ELKS_API_USER: "test-only",
    ELKS_API_PASSWORD: "test-only",
    GUEST_PAGE_BASE_URL: "https://stayboost.se",
  };
  return {
    rows,
    requests,
    databaseFetch,
    delivery,
    run: () =>
      sendScheduledMessages(admin as unknown as MessageStore, {
        env: (name) => env[name],
        now: () => now,
        fetch: delivery,
      }),
  };
}

describe("scheduled guest message isolation", () => {
  it.each(["sms", "email"] as const)(
    "delivers separate %s messages for two properties",
    async (channel) => {
      const h = harness([message("a", channel), message("b", channel)]);
      expect(await h.run()).toMatchObject({ sent: 2, failed: 0 });
      expect(h.delivery).toHaveBeenCalledTimes(2);
      const bodies = h.delivery.mock.calls.map(([, init]) => String(init?.body));
      expect(decodeURIComponent(bodies[0])).toContain("password-a");
      expect(decodeURIComponent(bodies[0])).not.toContain("password-b");
      expect(decodeURIComponent(bodies[1])).toContain("password-b");
      expect(decodeURIComponent(bodies[1])).not.toContain("password-a");
      expect(h.rows.map((row) => row.status)).toEqual(["sent", "sent"]);
    },
  );

  it.each(["a", "b"])(
    "rejects a foreign template on property %s before provider I/O",
    async (property) => {
      const row = message(property);
      const foreign = message(property === "a" ? "b" : "a");
      row.template_id = foreign.template_id;
      row.template = foreign.template;
      const h = harness([row]);
      expect(await h.run()).toMatchObject({ sent: 0, failed: 1 });
      expect(h.delivery).not.toHaveBeenCalled();
      expect(h.rows[0].status).toBe("failed");
      expect(h.rows[0].error).not.toContain(foreign.template!.body);
    },
  );

  it("rejects a foreign unit before provider I/O", async () => {
    const row = message("a", "sms");
    row.booking!.unit = message("b").booking!.unit;
    const h = harness([row]);
    expect(await h.run()).toMatchObject({ sent: 0, failed: 1 });
    expect(h.delivery).not.toHaveBeenCalled();
  });

  it.each(["booking", "property", "template", "scope"] as const)(
    "fails closed for missing %s",
    async (missing) => {
      const row = message("a");
      if (missing === "booking") row.booking = null;
      if (missing === "property") row.booking!.property = null;
      if (missing === "template") row.template = null;
      if (missing === "scope") row.booking!.property_id = null;
      const h = harness([row]);
      expect(await h.run()).toMatchObject({ sent: 0, failed: 1 });
      expect(h.delivery).not.toHaveBeenCalled();
    },
  );

  it("allows a legitimate booking with no assigned unit", async () => {
    const row = message("a");
    row.booking!.unit = null;
    const h = harness([row]);
    expect(await h.run()).toMatchObject({ sent: 1, failed: 0 });
  });

  it("does not send a pending message for a cancelled booking", async () => {
    const row = message("a");
    row.booking!.status = "cancelled";
    const h = harness([row]);
    expect(await h.run()).toMatchObject({ sent: 0, failed: 1 });
    expect(h.delivery).not.toHaveBeenCalled();
  });

  it("preserves the payment gate", async () => {
    const row = message("a");
    row.booking!.payment_status = "pending";
    const h = harness([row]);
    expect(await h.run()).toMatchObject({ sent: 0, waitingPayment: 1 });
    expect(h.delivery).not.toHaveBeenCalled();
    expect(h.rows[0].status).toBe("pending");
  });

  it("waits for contact details and fails old undeliverable messages", async () => {
    const recent = message("a");
    recent.booking!.guest_email = null;
    const old = message("b");
    old.booking!.guest_email = null;
    old.send_at = "2026-08-01T09:00:00.000Z";
    const h = harness([recent, old]);
    expect(await h.run()).toMatchObject({ sent: 0, waitingContact: 1, failed: 1 });
    expect(h.delivery).not.toHaveBeenCalled();
  });

  it("does not overwrite a queue item reassigned during delivery", async () => {
    const h = harness([message("a")]);
    h.delivery.mockImplementationOnce(async () => {
      Object.assign(h.rows[0], { booking_id: "booking-b", template_id: "template-b" });
      return Response.json({ id: "fake-delivery" });
    });
    await h.run();
    expect(h.rows[0].status).toBe("pending");
  });

  it("does not overwrite cancellation during delivery", async () => {
    const h = harness([message("a")]);
    h.delivery.mockImplementationOnce(async () => {
      h.rows[0].status = "cancelled";
      return Response.json({ id: "fake-delivery" });
    });
    await h.run();
    expect(h.rows[0].status).toBe("cancelled");
  });

  it("records provider failure without marking the message sent", async () => {
    const h = harness([message("a")]);
    h.delivery.mockResolvedValueOnce(new Response("rejected", { status: 500 }));
    expect(await h.run()).toMatchObject({ sent: 0, failed: 1 });
    expect(h.rows[0].status).toBe("failed");
  });

  it("does not deliver if the database read fails", async () => {
    const h = harness([message("a")]);
    h.databaseFetch.mockResolvedValueOnce(
      Response.json({ message: "database unavailable" }, { status: 400 }),
    );
    await expect(h.run()).rejects.toThrow("database unavailable");
    expect(h.delivery).not.toHaveBeenCalled();
  });
});

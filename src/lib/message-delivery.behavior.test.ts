import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import {
  bookingCommunicationsAllowed,
  deliverScheduledMessage,
} from "../../supabase/functions/_shared/message-delivery";

const OWNER = "00000000-0000-0000-0000-000000000001";
const OTHER = "00000000-0000-0000-0000-000000000002";
let db: PGlite;
const one = async <T = Record<string, unknown>>(sql: string, values: unknown[] = []) =>
  (await db.query<T>(sql, values)).rows[0];
const service = () =>
  db.exec(
    "reset role; set test.actor=''; set request.jwt.claim.role='service_role'; set role service_role;",
  );
const owner = (actor = OWNER) =>
  db.exec(
    `reset role; set test.actor='${actor}'; set request.jwt.claim.role='authenticated'; set role authenticated;`,
  );
const params: Record<string, string[]> = {
  claim_scheduled_message: ["p_message_id"],
  begin_scheduled_message: ["p_message_id", "p_attempt_id"],
  finish_scheduled_message: ["p_message_id", "p_attempt_id", "p_state", "p_error", "p_provider_id"],
};
const admin = {
  async rpc(name: string, args: Record<string, unknown>) {
    try {
      const keys = params[name];
      const result = await one<{ result: unknown }>(
        `select ${name}(${keys.map((_, i) => `$${i + 1}`).join(",")}) result`,
        keys.map((key) => args[key] ?? null),
      );
      return { data: result.result, error: null };
    } catch (error) {
      return { data: null, error: { message: String(error) } };
    }
  },
};
const env = (name: string) =>
  ({
    BREVO_API_KEY: "mock-key",
    BREVO_SENDER_EMAIL: "host@example.test",
    ELKS_API_USER: "mock-user",
    ELKS_API_PASSWORD: "mock-password",
    GUEST_PAGE_BASE_URL: "https://stayboost.se",
  })[name];
const accepted = () =>
  vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(JSON.stringify({ messageId: "mock-receipt" }), { status: 201 }),
    );
const claim = (id: string) => admin.rpc("claim_scheduled_message", { p_message_id: id });
const begin = (id: string, token: string) =>
  admin.rpc("begin_scheduled_message", { p_message_id: id, p_attempt_id: token });
const expire = async (id: string) => {
  await db.query(
    "update scheduled_messages set delivery_lease_until=now()-interval '1 minute' where id=$1",
    [id],
  );
  await db.query(
    "update scheduled_message_delivery_attempts set lease_until=now()-interval '1 minute' where original_message_id=$1",
    [id],
  );
};
async function fixture(channel = "email", imported = false) {
  await service();
  const { id: property } = await one<{ id: string }>(
    "insert into properties(owner_id,name) values($1,'Bergs test') returning id",
    [OWNER],
  );
  const { id: unit } = await one<{ id: string }>(
    "insert into units(property_id,name,max_guests) values($1,'Tent',4) returning id",
    [property],
  );
  await db.query("delete from message_templates where property_id=$1", [property]);
  const { id: template } = await one<{ id: string }>(
    "insert into message_templates(property_id,trigger_type,channel,subject,body) values($1,'booking_created',$2,'Hej {{gäst_namn}}','{{gäst_namn}} {{anläggning}} {{wifi_lösenord}} {{gästsida_länk}}') returning id",
    [property, channel],
  );
  const { id: booking } = await one<{ id: string }>(
    "insert into bookings(property_id,unit_id,source,external_id,guest_name,guest_email,guest_phone,checkin_date,checkout_date,guests,payment_amount) values($1,$2,'manual',$3,'First guest','old@example.test','+46700000000','2099-06-01','2099-06-03',2,4200) returning id",
    [property, unit, imported ? `sirvoy-csv:test:${property}` : null],
  );
  let queue = await one<{ id: string }>(
    "select id from scheduled_messages where booking_id=$1 and template_id=$2",
    [booking, template],
  );
  if (!queue)
    queue = await one<{ id: string }>(
      "insert into scheduled_messages(booking_id,template_id,channel,send_at) values($1,$2,$3,now()) returning id",
      [booking, template, channel],
    );
  return { property, unit, template, booking, message: queue.id };
}
beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key); insert into auth.users values('${OWNER}'),('${OTHER}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon,service_role; grant execute on function auth.uid() to public;`);
  for (const name of [
    "20260719000000_fas1.sql",
    "20260719120000_ical_export.sql",
    "20260719200000_direct_booking.sql",
    "20260720000000_sirvoy_swish.sql",
    "20260720120000_stripe.sql",
    "20260721000000_addons.sql",
    "20260721120000_chat.sql",
    "20260722100000_production_hardening.sql",
    "20260830210000_canonical_booking_write_lock.sql",
    "20260830230000_payment_lifecycle.sql",
    "20260906233429_operator_management.sql",
    "20260914090500_guest_journey_queue_reconciliation.sql",
    "20260929190056_sirvoy_cutover.sql",
    "20260929190057_journey_trigger_permissions.sql",
    "20260929190353_party_pricing.sql",
    "20260929190700_channex_channel_manager.sql",
    "20260929192056_imported_payment_reconciliation.sql",
    "20260929192153_property_booking_terms.sql",
    "20260929200000_scheduled_message_delivery.sql",
  ]) {
    await db.exec(
      readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8"),
    );
  }
  await db.exec(
    "grant select,insert,update,delete on properties,units,bookings,message_templates to authenticated; grant select,update(status) on scheduled_messages to authenticated; grant all on all tables in schema public to service_role;",
  );
  await service();
}, 120000);
afterAll(async () => {
  await db?.close();
});

describe("atomic scheduled delivery and bounded provider uncertainty", () => {
  it("claims once across competing workers and sends one mocked provider request", async () => {
    const f = await fixture();
    const provider = accepted();
    const results = await Promise.all([
      deliverScheduledMessage(admin, f.message, env, provider),
      deliverScheduledMessage(admin, f.message, env, provider),
    ]);
    expect(results.sort()).toEqual(["sent", "skipped"]);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(
      await one(
        "select state,provider_id from scheduled_message_delivery_attempts where message_id=$1",
        [f.message],
      ),
    ).toEqual({ state: "accepted", provider_id: "mock-receipt" });
    expect((await claim(f.message)).data).toBeNull();
  });
  it.each(["pause", "cancel", "disable_template", "refund_pending"])(
    "rechecks latest %s before dispatch",
    async (action) => {
      const f = await fixture();
      const c = await claim(f.message);
      expect(c.error).toBeNull();
      const token = (c.data as { attempt_id: string }).attempt_id;
      if (action === "pause")
        await db.query("update bookings set communications_enabled=false where id=$1", [f.booking]);
      if (action === "cancel")
        await db.query("update bookings set status='cancelled' where id=$1", [f.booking]);
      if (action === "disable_template")
        await db.query("update message_templates set enabled=false where id=$1", [f.template]);
      if (action === "refund_pending")
        await db.query("update bookings set payment_status='refund_pending' where id=$1", [
          f.booking,
        ]);
      expect((await begin(f.message, token)).data).toBeNull();
      const provider = accepted();
      expect(await deliverScheduledMessage(admin, f.message, env, provider)).toBe("skipped");
      expect(provider).not.toHaveBeenCalled();
    },
  );
  it("never claims imported unpaid stays and requires payment evidence plus deliberate takeover", async () => {
    const f = await fixture("email", true);
    expect((await claim(f.message)).data).toBeNull();
    await db.query(
      "select reconcile_imported_payment($1,$2,'record_payment',4200,'2025-06-01','Bank receipt 42 checked')",
      [OWNER, f.booking],
    );
    expect((await claim(f.message)).data).toBeNull();
    await owner();
    await db.query("update bookings set communications_enabled=true where id=$1", [f.booking]);
    await service();
    await db.query("update scheduled_messages set status='pending' where id=$1", [f.message]);
    expect((await claim(f.message)).data).toMatchObject({ message_id: f.message });
    expect(
      bookingCommunicationsAllowed({
        status: "confirmed",
        communications_enabled: true,
        payment_status: "none",
        external_id: "sirvoy-csv:x",
      }),
    ).toBe(false);
  });
  it("dispatches current contact and template values instead of the earlier queue snapshot", async () => {
    const f = await fixture();
    const base = admin;
    const current = {
      async rpc(name: string, args: Record<string, unknown>) {
        if (name === "begin_scheduled_message") {
          await db.query(
            "update bookings set guest_name='Latest guest',guest_email='latest@example.test' where id=$1",
            [f.booking],
          );
          await db.query(
            "update message_templates set body='Latest text {{gäst_namn}}' where id=$1",
            [f.template],
          );
        }
        return base.rpc(name, args);
      },
    };
    const provider = accepted();
    expect(await deliverScheduledMessage(current, f.message, env, provider)).toBe("sent");
    expect(provider).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(provider.mock.calls[0][1]?.body));
    expect(payload.to[0].email).toBe("latest@example.test");
    expect(payload.textContent).toBe("Latest text Latest guest");
  });
  it("survives queue replacement during an in-flight request without duplicate dispatch", async () => {
    const f = await fixture();
    const provider = vi.fn<typeof fetch>().mockImplementation(async () => {
      await db.query(
        "update bookings set checkin_date='2099-06-02',checkout_date='2099-06-04' where id=$1",
        [f.booking],
      );
      return new Response(JSON.stringify({ messageId: "accepted-during-edit" }), { status: 201 });
    });
    expect(await deliverScheduledMessage(admin, f.message, env, provider)).toBe("sent");
    const replacement = await one<{ id: string }>(
      "select id from scheduled_messages where booking_id=$1 and template_id=$2",
      [f.booking, f.template],
    );
    expect(replacement.id).not.toBe(f.message);
    expect(await deliverScheduledMessage(admin, replacement.id, env, provider)).toBe("skipped");
    expect(provider).toHaveBeenCalledTimes(1);
    expect(
      await one(
        "select message_id,state from scheduled_message_delivery_attempts where original_message_id=$1",
        [f.message],
      ),
    ).toEqual({ message_id: null, state: "accepted" });
  });
  it("reclaims an expired pre-dispatch claim and rejects the old token", async () => {
    const f = await fixture();
    const old = (await claim(f.message)).data as { attempt_id: string };
    await expire(f.message);
    const fresh = (await claim(f.message)).data as { attempt_id: string };
    expect(fresh.attempt_id).not.toBe(old.attempt_id);
    expect((await begin(f.message, old.attempt_id)).data).toBeNull();
    expect(
      await one("select state from scheduled_message_delivery_attempts where id=$1", [
        old.attempt_id,
      ]),
    ).toEqual({ state: "aborted" });
  });
  it("never replays when provider acceptance succeeds but the database receipt fails", async () => {
    const f = await fixture();
    const unavailable = {
      async rpc(name: string, args: Record<string, unknown>) {
        if (name === "finish_scheduled_message")
          return { data: null, error: { message: "simulated database outage" } };
        return admin.rpc(name, args);
      },
    };
    const provider = accepted();
    await expect(deliverScheduledMessage(unavailable, f.message, env, provider)).rejects.toThrow(
      "message_delivery_record_failed",
    );
    await expire(f.message);
    expect(await deliverScheduledMessage(admin, f.message, env, provider)).toBe("skipped");
    expect(provider).toHaveBeenCalledTimes(1);
    expect(
      await one(
        "select state from scheduled_message_delivery_attempts where original_message_id=$1",
        [f.message],
      ),
    ).toEqual({ state: "unknown" });
    await db.query("update scheduled_messages set status='pending' where id=$1", [f.message]);
    expect((await claim(f.message)).data).toBeNull();
  });
  it.each([503, 400])(
    "records HTTP %i as an uncertain acceptance or a definite rejection",
    async (status) => {
      const f = await fixture();
      const provider = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("sensitive provider payload", { status }));
      expect(await deliverScheduledMessage(admin, f.message, env, provider)).toBe("failed");
      const ledger = await one<{ state: string; error: string }>(
        "select state,error from scheduled_message_delivery_attempts where original_message_id=$1",
        [f.message],
      );
      expect(ledger.state).toBe(status === 503 ? "unknown" : "rejected");
      expect(ledger.error).not.toContain("sensitive");
    },
  );
  it("records a timeout as unknown and does not retry blindly", async () => {
    const f = await fixture("sms");
    const provider = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("simulated network timeout"));
    expect(await deliverScheduledMessage(admin, f.message, env, provider)).toBe("failed");
    expect(await deliverScheduledMessage(admin, f.message, env, provider)).toBe("skipped");
    expect(provider).toHaveBeenCalledTimes(1);
    expect(
      await one(
        "select state from scheduled_message_delivery_attempts where original_message_id=$1",
        [f.message],
      ),
    ).toEqual({ state: "unknown" });
  });
  it("preserves cancellation after dispatch while accurately recording provider acceptance", async () => {
    const f = await fixture();
    const provider = vi.fn<typeof fetch>().mockImplementation(async () => {
      await db.query("update bookings set status='cancelled' where id=$1", [f.booking]);
      return new Response("{}", { status: 200 });
    });
    expect(await deliverScheduledMessage(admin, f.message, env, provider)).toBe("sent");
    expect(await one("select status from scheduled_messages where id=$1", [f.message])).toEqual({
      status: "cancelled",
    });
    expect(
      await one(
        "select state from scheduled_message_delivery_attempts where original_message_id=$1",
        [f.message],
      ),
    ).toEqual({ state: "accepted" });
  });
  it("keeps claims and ledger writes server-only and isolates owner audit reads", async () => {
    const f = await fixture();
    await claim(f.message);
    await owner();
    expect((await claim(f.message)).error?.message).toContain("permission denied");
    await expect(
      db.query("update scheduled_messages set delivery_attempt_id=gen_random_uuid() where id=$1", [
        f.message,
      ]),
    ).rejects.toThrow("permission denied");
    await expect(
      db.query(
        "update scheduled_message_delivery_attempts set state='accepted' where original_message_id=$1",
        [f.message],
      ),
    ).rejects.toThrow("permission denied");
    expect(
      (
        await db.query(
          "select id from scheduled_message_delivery_attempts where original_message_id=$1",
          [f.message],
        )
      ).rows,
    ).toHaveLength(1);
    await owner(OTHER);
    expect(
      (await db.query("select id from scheduled_message_delivery_attempts")).rows,
    ).toHaveLength(0);
    await db.exec("reset role; set role anon;");
    expect((await claim(f.message)).error?.message).toContain("permission denied");
    await service();
  });
}, 20000);

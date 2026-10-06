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
const resendEnv = (name: string) =>
  ({
    EMAIL_PROVIDER: "resend",
    RESEND_API_KEY: "mock-resend-key",
    RESEND_SENDER_EMAIL: "host@example.test",
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
    "20261005160835_sirvoy_source_archive.sql",
    "20261005172512_sirvoy_searchable_source_records.sql",
    "20261006204009_message_source_content.sql",
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
  it("queues one direct confirmation at checkout and sends it only after payment becomes paid", async () => {
    const f = await fixture();
    const booking = await one<{ id: string; status: string }>(
      "insert into bookings(property_id,unit_id,source,guest_name,guest_email,checkin_date,checkout_date,guests,payment_amount,payment_status) values($1,$2,'direct','Paying guest','payer@example.test','2099-07-01','2099-07-03',2,4200,'pending') returning id,status",
      [f.property, f.unit],
    );
    expect(booking.status).toBe("confirmed");
    const queued = await one<{ id: string }>(
      "select id from scheduled_messages where booking_id=$1 and template_id=$2",
      [booking.id, f.template],
    );
    expect(queued).toBeTruthy();
    const provider = accepted();
    expect(await deliverScheduledMessage(admin, queued.id, env, provider)).toBe("skipped");
    expect(provider).not.toHaveBeenCalled();
    await db.query("update bookings set payment_status='paid' where id=$1", [booking.id]);
    expect(await deliverScheduledMessage(admin, queued.id, env, provider)).toBe("sent");
    await db.query("update bookings set payment_status='paid' where id=$1", [booking.id]);
    expect(await deliverScheduledMessage(admin, queued.id, env, provider)).toBe("skipped");
    expect(provider).toHaveBeenCalledTimes(1);
    expect(
      (await db.query("select id from scheduled_messages where booking_id=$1", [booking.id])).rows,
    ).toHaveLength(1);
  });
  it("sends one direct Resend request under competing workers and records its receipt", async () => {
    const f = await fixture();
    const provider = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "mock-resend-receipt" }), { status: 200 }),
      );
    const results = await Promise.all([
      deliverScheduledMessage(admin, f.message, resendEnv, provider),
      deliverScheduledMessage(admin, f.message, resendEnv, provider),
    ]);
    expect(results.sort()).toEqual(["sent", "skipped"]);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(provider.mock.calls[0][0]).toBe("https://api.resend.com/emails");
    const options = provider.mock.calls[0][1]!;
    expect(new Headers(options.headers).get("Idempotency-Key")).toBe(
      `stayboost-scheduled/${f.message}`,
    );
    expect(new Headers(options.headers).get("Authorization")).toBe("Bearer mock-resend-key");
    expect(options.redirect).toBe("error");
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(options.body))).toMatchObject({
      from: "Bergs test <host@example.test>",
      to: ["old@example.test"],
      subject: "Hej First guest",
    });
    expect(
      await one(
        "select state,provider_id from scheduled_message_delivery_attempts where message_id=$1",
        [f.message],
      ),
    ).toEqual({ state: "accepted", provider_id: "mock-resend-receipt" });
  });
  it("keeps Resend's logical key when a definite rejection is deliberately retried with a new lease", async () => {
    const f = await fixture();
    const provider = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("{}", { status: 429 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "resend-success" }), { status: 200 }),
      );
    expect(await deliverScheduledMessage(admin, f.message, resendEnv, provider)).toBe("failed");
    await db.query("update scheduled_messages set status='pending' where id=$1", [f.message]);
    expect(await deliverScheduledMessage(admin, f.message, resendEnv, provider)).toBe("sent");
    const attempts = (
      await db.query<{ id: string; state: string }>(
        "select id,state from scheduled_message_delivery_attempts where original_message_id=$1 order by claimed_at",
        [f.message],
      )
    ).rows;
    expect(attempts.map((row) => row.state)).toEqual(["rejected", "accepted"]);
    expect(attempts[0].id).not.toBe(attempts[1].id);
    const keys = provider.mock.calls.map((call) =>
      new Headers(call[1]?.headers).get("Idempotency-Key"),
    );
    expect(keys).toEqual([`stayboost-scheduled/${f.message}`, `stayboost-scheduled/${f.message}`]);
  });
  it("never falls back to Brevo when selected Resend configuration is incomplete", async () => {
    const f = await fixture();
    const provider = accepted();
    const incomplete = (name: string) => (name === "EMAIL_PROVIDER" ? "resend" : env(name));
    expect(await deliverScheduledMessage(admin, f.message, incomplete, provider)).toBe("failed");
    expect(provider).not.toHaveBeenCalled();
    expect(
      await one(
        "select state from scheduled_message_delivery_attempts where original_message_id=$1",
        [f.message],
      ),
    ).toEqual({ state: "rejected" });
  });
  it.each([409, 503, 200])(
    "records uncertain Resend HTTP %i or missing receipt without blind replay",
    async (status) => {
      const f = await fixture();
      const provider = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status }));
      expect(await deliverScheduledMessage(admin, f.message, resendEnv, provider)).toBe("failed");
      expect(await deliverScheduledMessage(admin, f.message, resendEnv, provider)).toBe("skipped");
      expect(provider).toHaveBeenCalledTimes(1);
      expect(
        await one(
          "select state from scheduled_message_delivery_attempts where original_message_id=$1",
          [f.message],
        ),
      ).toEqual({ state: "unknown" });
    },
  );
  it("never replays Resend acceptance if recording its database receipt fails", async () => {
    const f = await fixture();
    const unavailable = {
      async rpc(name: string, args: Record<string, unknown>) {
        return name === "finish_scheduled_message"
          ? { data: null, error: { message: "simulated outage" } }
          : admin.rpc(name, args);
      },
    };
    const provider = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ id: "accepted-resend" }), { status: 200 }));
    await expect(
      deliverScheduledMessage(unavailable, f.message, resendEnv, provider),
    ).rejects.toThrow("message_delivery_record_failed");
    await expire(f.message);
    expect(await deliverScheduledMessage(admin, f.message, resendEnv, provider)).toBe("skipped");
    expect(provider).toHaveBeenCalledTimes(1);
    expect(
      await one(
        "select state from scheduled_message_delivery_attempts where original_message_id=$1",
        [f.message],
      ),
    ).toEqual({ state: "unknown" });
  });
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

const sourceTranslations = Object.fromEntries(
  ["sv", "en", "de", "da", "no"].map((lang) => [
    lang,
    {
      subject_exact: `Källa ${lang}`,
      source_body_html_exact: `<p>${lang}: {{gäst_namn}}</p><p>%bookinginfo%</p>`,
    },
  ]),
);
async function sourceArchive(
  property: string,
  event = "confirmation",
  id = "20842",
  override = {},
) {
  const source = {
    schema_version: 1,
    source: { template_id_observed: id },
    metadata: {
      name: { value_exact: "Exakt namn " },
      event: { value_exact: event },
      days: { value_exact: "1", hidden_in_saved_dom: !["checkin", "checkout"].includes(event) },
      timing: {
        value_exact: "before",
        hidden_in_saved_dom: !["checkin", "checkout"].includes(event),
      },
      category: { value_exact: "0" },
      "use-footer": { checked_attribute: false },
    },
    translations: sourceTranslations,
    ...override,
  };
  return (
    await one<{ id: string }>(
      "insert into sirvoy_export_archives(property_id,created_by,filename,export_kind,file_bytes) values($1,$2,'synthetic.json','settings',convert_to($3,'UTF8')) returning id",
      [property, OWNER, JSON.stringify(source)],
    )
  ).id;
}
async function sourceImport(
  property: string,
  archive: string,
  time: string | null = null,
  clock: string | null = null,
  actor = OWNER,
) {
  return (
    await one<{ result: { id: string; duplicate: boolean; enabled: boolean } }>(
      "select import_sirvoy_message_template($1,$2,$3,$4,$5) result",
      [property, actor, archive, time, clock],
    )
  ).result;
}

describe("source templates keep archive, schedule and delivery boundaries", () => {
  it("imports five exact drafts idempotently from archive bytes without queue writes or translated guesses", async () => {
    const f = await fixture();
    const archive = await sourceArchive(f.property);
    const before = await one("select count(*) from scheduled_messages where booking_id=$1", [
      f.booking,
    ]);
    const result = await sourceImport(f.property, archive);
    expect(result).toMatchObject({ enabled: false, duplicate: false });
    const row = await one<{
      name: string;
      enabled: boolean;
      content_translations: Record<string, { subject: string; body: string }>;
      source_reviewed_at: null;
    }>("select * from message_templates where id=$1", [result.id]);
    expect(row.name).toBe("Exakt namn ");
    expect(row.enabled).toBe(false);
    expect(row.source_reviewed_at).toBeNull();
    expect(Object.keys(row.content_translations)).toHaveLength(5);
    expect(row.content_translations.no).toEqual({
      subject: "Källa no",
      body: sourceTranslations.no.source_body_html_exact,
    });
    expect(await sourceImport(f.property, archive)).toEqual({ ...result, duplicate: true });
    expect(
      await one("select count(*) from scheduled_messages where booking_id=$1", [f.booking]),
    ).toEqual(before);
    await db.query("update bookings set notes='ordinary edit' where id=$1", [f.booking]);
    expect(
      (await db.query("select id from scheduled_messages where template_id=$1", [result.id])).rows,
    ).toHaveLength(0);
  });
  it("requires same-property archives and the real owner; the import RPC is service-only", async () => {
    const f = await fixture(),
      other = await fixture();
    const archive = await sourceArchive(f.property);
    await expect(sourceImport(other.property, archive)).rejects.toThrow("invalid_message_archive");
    await expect(sourceImport(f.property, archive, null, null, OTHER)).rejects.toThrow(
      "not_authorized",
    );
    await owner();
    await expect(sourceImport(f.property, archive)).rejects.toThrow("permission denied");
    await service();
  });
  it("requires an explicit source clock for relative triggers and retains a one-calendar-day offset", async () => {
    const f = await fixture();
    const archive = await sourceArchive(f.property, "checkin", "26202");
    await expect(sourceImport(f.property, archive)).rejects.toThrow(
      "message_schedule_source_required",
    );
    const clock = (
      await one<{ id: string }>(
        'insert into sirvoy_export_archives(property_id,filename,export_kind,file_bytes) values($1,\'clock.json\',\'settings\',convert_to(\'{"source_pages":{"localization":{"automatic_messages_clock":"13:00","timezone":"Europe/Stockholm"}}}\',\'UTF8\')) returning id',
        [f.property],
      )
    ).id;
    await expect(sourceImport(f.property, archive, "14:00", clock)).rejects.toThrow(
      "message_schedule_source_mismatch",
    );
    const result = await sourceImport(f.property, archive, "13:00", clock);
    expect(
      await one(
        "select trigger_type,offset_days,send_time,source_schedule_archive_id,enabled from message_templates where id=$1",
        [result.id],
      ),
    ).toEqual({
      trigger_type: "pre_arrival",
      offset_days: -1,
      send_time: "13:00:00",
      source_schedule_archive_id: clock,
      enabled: false,
    });
    const other = await fixture();
    const foreignClock = await sourceArchive(other.property);
    await expect(sourceImport(f.property, archive, "13:00", foreignClock)).rejects.toThrow(
      "message_source_conflict",
    );
  });
  it("keeps none/unknown automation manual, including attempts to enable it", async () => {
    const f = await fixture();
    for (const [event, id] of [
      ["none", "32166"],
      ["unsupported", "777"],
    ]) {
      const imported = await sourceImport(f.property, await sourceArchive(f.property, event, id));
      await db.query("update message_templates set enabled=true where id=$1", [imported.id]);
      expect(
        await one("select trigger_type,enabled from message_templates where id=$1", [imported.id]),
      ).toEqual({ trigger_type: "manual", enabled: false });
      await db.query("update bookings set notes='edit' where id=$1", [f.booking]);
      expect(
        (await db.query("select id from scheduled_messages where template_id=$1", [imported.id]))
          .rows,
      ).toHaveLength(0);
    }
  });
  it("cannot forge, clear or reassign origin/review/cutover through authenticated updates", async () => {
    const f = await fixture();
    const archive = await sourceArchive(f.property);
    const imported = await sourceImport(f.property, archive);
    await owner();
    for (const sql of [
      "source_archive_id=null,source_template_id=null",
      "source_reviewed_at=now(),activation_starts_at=now()",
      "source_metadata='{}'",
      "source_schedule_archive_id=source_archive_id",
    ]) {
      await expect(
        db.query(`update message_templates set ${sql} where id=$1`, [imported.id]),
      ).rejects.toThrow("message_source_server_only");
    }
    await expect(
      db.query("update message_templates set enabled=true where id=$1", [imported.id]),
    ).rejects.toThrow("message_template_source_activation");
    await service();
    await expect(
      db.query(
        "update message_templates set source_reviewed_at=now(),activation_starts_at=null,enabled=true where id=$1",
        [imported.id],
      ),
    ).rejects.toThrow("message_template_source_activation");
    await owner();
    await expect(
      db.query(
        "update message_templates set source_archive_id=$1,source_template_id='999' where id=$2",
        [archive, f.template],
      ),
    ).rejects.toThrow("message_source_server_only");
    await service();
  });
  it("atomically saves with revision and owner scope; stale or cross-owner updates cannot win", async () => {
    const f = await fixture();
    await owner();
    const saved = await one<{ result: { revision: number; name: string } }>(
      'select save_message_template($1,$2,1,\'{"name":"Saved exact ","body_format":"text"}\') result',
      [f.property, f.template],
    );
    expect(saved.result.revision).toBe(2);
    expect(saved.result.name).toBe("Saved exact ");
    await expect(
      db.query('select save_message_template($1,$2,1,\'{"name":"stale"}\')', [
        f.property,
        f.template,
      ]),
    ).rejects.toThrow("message_template_changed");
    await expect(
      db.query('select save_message_template($1,$2,2,\'{"source_reviewed_at":"2099-01-01"}\')', [
        f.property,
        f.template,
      ]),
    ).rejects.toThrow("invalid_message_template");
    await owner(OTHER);
    await expect(
      db.query("select save_message_template($1,$2,2,'{}')", [f.property, f.template]),
    ).rejects.toThrow("not_authorized");
    await service();
  });
  it("uses calendar days in Stockholm across DST and never schedules a manual template", async () => {
    for (const [date, utc] of [
      ["2027-03-29", "2027-03-28T11:00:00.000Z"],
      ["2027-11-01", "2027-10-31T12:00:00.000Z"],
    ]) {
      const result = await one<{ at: Date }>(
        "select message_scheduled_at('pre_arrival',-1,'13:00',$1::date,($1::date+2),now()) at",
        [date],
      );
      expect(new Date(result.at).toISOString()).toBe(utc);
    }
    expect(
      await one(
        "select message_scheduled_at('manual',0,'13:00','2099-01-01','2099-01-02',now()) at",
      ),
    ).toEqual({ at: null });
  });
  it("source review with a future cutover does not backfill old or imported bookings at any gate", async () => {
    const f = await fixture("email", true);
    const imported = await sourceImport(f.property, await sourceArchive(f.property));
    await db.query(
      "update message_templates set source_reviewed_at=now(),activation_starts_at=now(),enabled=true where id=$1",
      [imported.id],
    );
    await db.query("update bookings set notes='edit' where id=$1", [f.booking]);
    const queued = await one<{ id: string }>(
      "insert into scheduled_messages(booking_id,template_id,channel,send_at) values($1,$2,'email',now()) returning id",
      [f.booking, imported.id],
    );
    const provider = accepted();
    expect(await deliverScheduledMessage(admin, queued.id, env, provider)).toBe("skipped");
    expect(provider).not.toHaveBeenCalled();
    expect(
      (
        await db.query("select id from scheduled_message_delivery_attempts where message_id=$1", [
          queued.id,
        ])
      ).rows,
    ).toHaveLength(0);
    const ordinary = await fixture();
    const ordinarySource = await sourceImport(
      ordinary.property,
      await sourceArchive(ordinary.property),
    );
    await db.query(
      "update message_templates set source_reviewed_at=now(),activation_starts_at=now(),enabled=true where id=$1",
      [ordinarySource.id],
    );
    await db.query("update bookings set notes='older native booking' where id=$1", [
      ordinary.booking,
    ]);
    expect(
      (
        await db.query("select id from scheduled_messages where template_id=$1", [
          ordinarySource.id,
        ])
      ).rows,
    ).toHaveLength(0);
  });
  it("returns fresh, curated language and quote and sends safe HTML through the actual delivery handler", async () => {
    const f = await fixture();
    const content = Object.fromEntries(
      Object.entries(sourceTranslations).map(([lang, t]) => [
        lang,
        { subject: t.subject_exact, body: t.source_body_html_exact },
      ]),
    );
    await db.query(
      "update message_templates set body_format='html',content_translations=$2 where id=$1",
      [f.template, content],
    );
    await db.query("update bookings set guest_name=$2,quote_snapshot=$3 where id=$1", [
      f.booking,
      "<script>guest</script>",
      {
        language: "da",
        currency: "SEK",
        grandTotal: 2324.5,
        secretInternal: "must not reach delivery",
      },
    ]);
    const provider = accepted();
    expect(await deliverScheduledMessage(admin, f.message, env, provider)).toBe("sent");
    const body = JSON.parse(String(provider.mock.calls[0][1]?.body));
    expect(body.subject).toBe("Källa da");
    expect(body.htmlContent).toContain("&lt;script&gt;guest&lt;/script&gt;");
    expect(body.textContent).toContain("?lang=da");
    expect(JSON.stringify(body)).not.toContain("must not reach delivery");
    expect(body.htmlContent).not.toContain("%bookinginfo%");
  });
  it("records unsafe content as rejected before any provider call", async () => {
    const f = await fixture();
    await db.query(
      "update message_templates set body_format='html',body='<script>attack()</script>' where id=$1",
      [f.template],
    );
    const provider = accepted();
    expect(await deliverScheduledMessage(admin, f.message, env, provider)).toBe("failed");
    expect(provider).not.toHaveBeenCalled();
    expect(
      await one("select state from scheduled_message_delivery_attempts where message_id=$1", [
        f.message,
      ]),
    ).toEqual({ state: "rejected" });
  });
  it("editing an approved source template pauses it and invalidates a previously claimed delivery", async () => {
    const f = await fixture();
    const imported = await sourceImport(f.property, await sourceArchive(f.property));
    // Synthetic pre-cutover dates exercise the gate; no real records or provider calls.
    await db.query(
      "update message_templates set source_reviewed_at=now()-interval '2 days',activation_starts_at=now()-interval '1 day',enabled=true where id=$1",
      [imported.id],
    );
    await db.query(
      "insert into scheduled_messages(booking_id,template_id,channel,send_at) values($1,$2,'email',now())",
      [f.booking, imported.id],
    );
    const queued = await one<{ id: string }>(
      "select id from scheduled_messages where template_id=$1",
      [imported.id],
    );
    const leased = await claim(queued.id);
    expect(leased.error).toBeNull();
    expect(leased.data).toBeTruthy();
    await owner();
    await db.query("update message_templates set name='Changed' where id=$1", [imported.id]);
    await service();
    expect(
      await one(
        "select enabled,source_reviewed_at,activation_starts_at from message_templates where id=$1",
        [imported.id],
      ),
    ).toEqual({ enabled: false, source_reviewed_at: null, activation_starts_at: null });
    expect(
      (await begin(queued.id, (leased.data as { attempt_id: string }).attempt_id)).data,
    ).toBeNull();
  });
}, 20000);

describe("template trigger changes never turn an old queue into a new confirmation", () => {
  it("removes old arrival rows on a switch to confirmation and does not backfill on later booking edits", async () => {
    const f = await fixture();
    await db.query(
      "update message_templates set trigger_type='pre_arrival',offset_days=-1 where id=$1",
      [f.template],
    );
    expect(
      (
        await db.query(
          "select id from scheduled_messages where template_id=$1 and status='pending'",
          [f.template],
        )
      ).rows,
    ).toHaveLength(1);
    await db.query("update message_templates set trigger_type='booking_created' where id=$1", [
      f.template,
    ]);
    await db.query("update bookings set notes='edit after trigger change' where id=$1", [
      f.booking,
    ]);
    expect(
      (
        await db.query(
          "select id from scheduled_messages where template_id=$1 and status='pending'",
          [f.template],
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("does not deliver an old confirmation through a changed channel", async () => {
    const f = await fixture();
    await db.query("update message_templates set channel='sms' where id=$1", [f.template]);
    await db.query("update bookings set notes='edit after channel change' where id=$1", [
      f.booking,
    ]);
    expect(
      (
        await db.query(
          "select id from scheduled_messages where template_id=$1 and status='pending'",
          [f.template],
        )
      ).rows,
    ).toHaveLength(0);
    const provider = accepted();
    expect(await deliverScheduledMessage(admin, f.message, env, provider)).toBe("skipped");
    expect(provider).not.toHaveBeenCalled();
  });
});

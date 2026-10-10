import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const PROPERTY = "33333333-3333-4333-8333-333333333333";
const FOREIGN = "44444444-4444-4444-8444-444444444444";
const KEY = "a".repeat(64);
let db: PGlite;
type Attempt = {
  id: string;
  lease_id: string;
  request_body: Record<string, string>;
  idempotency_key: string;
  session_id: string | null;
  outcome: string;
  attempt_count: number;
};
type Claim = { state: string; attempt: Attempt; status?: string };
const claim = async (actor = OWNER, property = PROPERTY, fingerprint = KEY) =>
  (
    await db.query<{ result: Claim }>(
      "select claim_stripe_checkout_diagnostic($1,$2,$3,false,'pmc_synthetic') result",
      [actor, property, fingerprint],
    )
  ).rows[0].result;
const finish = async (a: Attempt, session: string | null, outcome: string | null) =>
  (
    await db.query<{ result: boolean }>(
      "select finish_stripe_checkout_diagnostic($1,$2,$3,$4) result",
      [a.id, a.lease_id, session, outcome],
    )
  ).rows[0].result;
const rows = async () =>
  (
    await db.query<{ a: Attempt }>(
      "select to_jsonb(a) a from stripe_checkout_diagnostic_attempts a order by created_at",
    )
  ).rows.map((r) => r.a);
const releaseLease = () =>
  db.exec(
    "update stripe_checkout_diagnostic_attempts set lease_until=clock_timestamp()-interval '1 second'",
  );

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create table properties(id uuid primary key,owner_id uuid);
    create table bookings(id int primary key,note text);insert into bookings values(1,'unchanged');
    create table message_queue(id int primary key);create table stripe_webhook_events(id int primary key);
    grant usage on schema public to anon,authenticated,service_role;
    grant select,update on properties to service_role;
    insert into properties values('${PROPERTY}','${OWNER}'),('${FOREIGN}','${OTHER}');`);
  await db.exec(
    readFileSync(
      new URL(
        "../../supabase/migrations/20261009192612_stripe_checkout_diagnostic.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
});
beforeEach(async () => {
  await db.exec("reset role;truncate stripe_checkout_diagnostic_attempts;set role service_role");
});
afterAll(() => db.close());

describe("private durable Checkout diagnostic attempts", () => {
  it.each(["anon", "authenticated"])(
    "denies %s direct reads, writes and both RPCs",
    async (role) => {
      await claim();
      await db.exec(`reset role;set role ${role}`);
      await expect(rows()).rejects.toThrow(/permission denied/);
      await expect(db.exec("delete from stripe_checkout_diagnostic_attempts")).rejects.toThrow(
        /permission denied/,
      );
      await expect(claim()).rejects.toThrow(/permission denied/);
      await expect(
        db.query("select finish_stripe_checkout_diagnostic(null,null,null,null)"),
      ).rejects.toThrow(/permission denied/);
    },
  );
  it("enables RLS without granting either client role a policy or RPC", async () => {
    await db.exec("reset role");
    expect(
      (
        await db.query<{ relrowsecurity: boolean }>(
          "select relrowsecurity from pg_class where oid='stripe_checkout_diagnostic_attempts'::regclass",
        )
      ).rows[0].relrowsecurity,
    ).toBe(true);
    expect(
      (
        await db.query(
          "select * from pg_policies where tablename='stripe_checkout_diagnostic_attempts'",
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("checks property ownership before inserting a diagnostic record", async () => {
    await expect(claim(OTHER)).rejects.toThrow("not_authorized");
    await expect(claim(OWNER, FOREIGN)).rejects.toThrow("not_authorized");
    expect(await rows()).toHaveLength(0);
  });
  it("serializes simultaneous owner clicks and enforces one unfinished attempt", async () => {
    const results = await Promise.all([claim(), claim()]);
    expect(results.map((x) => x.state).sort()).toEqual(["claimed", "in_progress"]);
    const a = results.find((x) => x.state === "claimed")!.attempt;
    expect(await rows()).toHaveLength(1);
    await expect(
      db.query(
        `insert into stripe_checkout_diagnostic_attempts
      (property_id,actor_id,key_fingerprint,livemode,request_body,idempotency_key,expires_at)
      select property_id,actor_id,key_fingerprint,livemode,request_body,'another',expires_at
      from stripe_checkout_diagnostic_attempts where id=$1`,
        [a.id],
      ),
    ).rejects.toThrow(/duplicate key/);
  });
  it("freezes the synthetic payload and idempotency key across a crashed worker", async () => {
    const first = (await claim()).attempt;
    const p = first.request_body;
    expect(p).toMatchObject({
      mode: "payment",
      success_url: "https://stayboost.se/app/startklart",
      cancel_url: "https://stayboost.se/app/startklart",
      "line_items[0][price_data][unit_amount]": "1000",
      "line_items[0][price_data][currency]": "sek",
      "after_expiration[recovery][enabled]": "false",
      payment_method_configuration: "pmc_synthetic",
    });
    expect(
      Object.keys(p).some((k) =>
        /booking_id|client_reference|customer_email|payment_intent|payment_method_types/.test(k),
      ),
    ).toBe(false);
    expect(Number(p.expires_at) - Date.now() / 1000).toBeGreaterThan(1800);
    expect(Number(p.expires_at) - Date.now() / 1000).toBeLessThanOrEqual(1860);
    await releaseLease();
    const retry = (await claim()).attempt;
    expect(retry.id).toBe(first.id);
    expect(retry.lease_id).not.toBe(first.lease_id);
    expect(retry.request_body).toEqual(p);
    expect(retry.idempotency_key).toBe(first.idempotency_key);
    expect(retry.attempt_count).toBe(2);
  });
  it("rejects a changed credential/config fingerprint without abandoning an unknown attempt", async () => {
    const first = (await claim()).attempt;
    await releaseLease();
    expect((await claim(OWNER, PROPERTY, "b".repeat(64))).state).toBe("configuration_changed");
    expect((await rows()).map((r) => r.id)).toEqual([first.id]);
  });
  it("keeps an unknown creation blocked before Stripe's 24h pruning boundary", async () => {
    const first = (await claim()).attempt;
    await db.exec(
      "update stripe_checkout_diagnostic_attempts set created_at=clock_timestamp()-interval '23 hours',lease_until=clock_timestamp()-interval '1 second'",
    );
    expect((await claim()).state).toBe("attempt_requires_followup");
    expect((await rows()).map((r) => r.id)).toEqual([first.id]);
  });
  it("allows later cleanup only for the already bound session and rejects stale workers", async () => {
    const first = (await claim()).attempt;
    expect(await finish(first, "cs_test_existing", null)).toBe(true);
    await db.exec(
      "update stripe_checkout_diagnostic_attempts set created_at=clock_timestamp()-interval '25 hours',lease_until=clock_timestamp()-interval '1 second'",
    );
    const retry = (await claim()).attempt;
    expect(retry.session_id).toBe("cs_test_existing");
    expect(await finish(first, "cs_test_existing", "create_not_confirmed")).toBe(false);
    await expect(finish(retry, "cs_test_other", "create_and_expire_confirmed")).rejects.toThrow(
      "diagnostic_session_mismatch",
    );
    await expect(finish(retry, "cs_live_other", "create_and_expire_confirmed")).rejects.toThrow(
      "diagnostic_session_mismatch",
    );
    expect(await finish(retry, "cs_test_existing", "create_and_expire_confirmed")).toBe(true);
    expect(await finish(first, "cs_test_existing", "create_not_confirmed")).toBe(false);
    expect((await claim()).state).toBe("cached");
  });
  it("does not treat a later auth rejection as proof that an earlier unknown creation never happened", async () => {
    const first = (await claim()).attempt;
    await finish(first, null, "create_not_confirmed");
    const second = (await claim()).attempt;
    await finish(second, null, "authentication_failed");
    expect((await claim()).attempt.id).toBe(first.id);
    expect(await rows()).toHaveLength(1);
  });
  it("rolls back invalid completion without changing the frozen attempt or operational tables", async () => {
    const first = (await claim()).attempt;
    await expect(finish(first, null, "create_and_expire_confirmed")).rejects.toThrow(
      "diagnostic_session_missing",
    );
    expect((await rows())[0]).toEqual(first);
    await db.exec("reset role");
    expect((await db.query("select * from bookings")).rows).toEqual([{ id: 1, note: "unchanged" }]);
    expect((await db.query("select * from message_queue")).rows).toEqual([]);
    expect((await db.query("select * from stripe_webhook_events")).rows).toEqual([]);
  });
});

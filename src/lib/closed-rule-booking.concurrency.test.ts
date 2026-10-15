import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bookingSql, closureSql, fixtureSql, guardMigration } from "./test-support/closed-rule-db";

// Opt in with STAYBOOST_POSTGRES_BIN=/path/to/postgresql/bin and
// STAYBOOST_POSTGRES_DRIVER=/path/to/postgres/src/index.js (postgres.js 3.x).
// Starts a disposable cluster using only a private Unix socket, never a remote DB.
// PGlite cannot exercise independent database sessions/advisory-lock waits.
const bin = process.env.STAYBOOST_POSTGRES_BIN;
const driver = process.env.STAYBOOST_POSTGRES_DRIVER;
type Sql = {
  unsafe: (
    text: string,
    args: unknown[],
    options: { simple: boolean },
  ) => Promise<Record<string, unknown>[]>;
  end: (options: { timeout: number }) => Promise<void>;
};
describe.skipIf(!bin || !driver)("closed-rule admission with real PostgreSQL sessions", () => {
  let directory: string;
  let postgres: (options: Record<string, unknown>) => Sql;
  const sessions: Session[] = [];
  class Session {
    sql: Sql;
    constructor(readonly name: string) {
      this.sql = postgres({
        host: directory,
        port: 5432,
        user: "postgres",
        database: "postgres",
        max: 1,
        prepare: false,
        connection: { application_name: name },
        onnotice: () => {},
      });
      sessions.push(this);
    }
    async query(text: string): Promise<string> {
      const rows = await this.sql.unsafe(text, [], { simple: true });
      return rows.map((row) => Object.values(row).join("|")).join("\n");
    }
    async close() {
      await this.sql.end({ timeout: 0 });
    }
  }
  let observer: Session, booking: Session, rule: Session;
  async function waitForInventoryLock(name: string) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (
        (await observer.query(
          `select count(*) from pg_stat_activity where application_name='${name}' and wait_event_type='Lock' and wait_event='advisory';`,
        )) === "1"
      )
        return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw Error(`Expected ${name} to wait on the canonical inventory lock`);
  }
  beforeAll(async () => {
    postgres = (await import(pathToFileURL(driver!).href)).default;
    directory = mkdtempSync(join(tmpdir(), "stayboost-pg-"));
    execFileSync(
      join(bin!, "initdb"),
      ["-D", join(directory, "data"), "-U", "postgres", "-A", "trust", "--no-locale"],
      { stdio: "pipe" },
    );
    execFileSync(
      join(bin!, "pg_ctl"),
      [
        "-D",
        join(directory, "data"),
        "-l",
        join(directory, "postgres.log"),
        "-o",
        `-c listen_addresses='' -c unix_socket_directories='${directory}'`,
        "-w",
        "start",
      ],
      { stdio: "pipe" },
    );
    observer = new Session("guard_observer");
    await observer.query(fixtureSql());
    await observer.query(guardMigration());
  }, 60000);
  beforeEach(async () => {
    await observer.query("delete from bookings; delete from rate_rules;");
    booking = new Session("guard_booking");
    rule = new Session("guard_rule");
  });
  afterEach(async () => {
    await Promise.all([booking?.close(), rule?.close()]);
  });
  afterAll(async () => {
    await Promise.all(sessions.map((session) => session.close()));
    if (directory) {
      try {
        execFileSync(
          join(bin!, "pg_ctl"),
          ["-D", join(directory, "data"), "-m", "immediate", "-w", "stop"],
          { stdio: "pipe" },
        );
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  });

  it("reads the committed closure after waiting, despite a successful earlier preflight", async () => {
    await rule.query(`begin; ${closureSql()}`);
    expect(await observer.query("select count(*) from rate_rules;")).toBe("0");
    // Attach rejection handling immediately while the query is intentionally blocked.
    const result = booking.query(bookingSql()).then(
      () => "accepted",
      (error: Error) => error.message,
    );
    await waitForInventoryLock("guard_booking");
    await rule.query("commit;");
    expect(await result).toContain("booking_closed");
    expect(await observer.query("select count(*) from bookings;")).toBe("0");
    expect(await observer.query("select count(*) from scheduled_messages;")).toBe("0");
  });
  it("permits a booking when the competing closure rolls back", async () => {
    await rule.query(`begin; ${closureSql()}`);
    const result = booking.query(bookingSql());
    await waitForInventoryLock("guard_booking");
    await rule.query("rollback;");
    expect(await result).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("makes the closure writer wait when the booking owns inventory first, without cancelling the stay", async () => {
    await booking.query(`begin; ${bookingSql()}`);
    const result = rule.query(closureSql());
    await waitForInventoryLock("guard_rule");
    await booking.query("commit;");
    expect(await result).toMatch(/^[0-9a-f-]{36}$/);
    expect(await observer.query("select count(*) from bookings where status='confirmed';")).toBe(
      "1",
    );
    expect(await observer.query("select count(*) from rate_rules where active;")).toBe("1");
  });
  it("serializes activation of an existing closure against admission", async () => {
    await observer.query(`${closureSql()} update rate_rules set active=false;`);
    await rule.query("begin; update rate_rules set active=true;");
    const result = booking.query(bookingSql()).then(
      () => "accepted",
      (error: Error) => error.message,
    );
    await waitForInventoryLock("guard_booking");
    await rule.query("commit;");
    expect(await result).toContain("booking_closed");
  });
  it("serializes deleting a closure and admits only after the deletion commits", async () => {
    await observer.query(closureSql());
    await rule.query("begin; delete from rate_rules;");
    const result = booking.query(bookingSql());
    await waitForInventoryLock("guard_booking");
    await rule.query("commit;");
    expect(await result).toMatch(/^[0-9a-f-]{36}$/);
  });
});

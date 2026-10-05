import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import {
  parseSirvoySource,
  SIRVOY_SOURCE_HEADERS,
  type SirvoySourceFormat,
  type SirvoySourceScope,
} from "../../supabase/functions/_shared/sirvoy-source-parser";
const read = (name: string) =>
  readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");
const OWNER = "00000000-0000-0000-0000-000000000001";
const OTHER = "00000000-0000-0000-0000-000000000002";
let db: PGlite;
let property: string;
let otherProperty: string;
let firstBooking: string;
let firstPairs: Pair[];
let serial = 0;
type Pair = { accommodationRecordId: string; bookingRecordId: string };
const row = async <T = Record<string, unknown>>(sql: string, values: unknown[] = []) =>
  (await db.query<T>(sql, values)).rows[0];
const service = () =>
  db.exec(
    "reset role; set test.actor=''; set request.jwt.claim.role='service_role'; set role service_role;",
  );
const owner = (actor = OWNER) =>
  db.exec(
    `reset role; set test.actor='${actor}'; set request.jwt.claim.role='authenticated'; set role authenticated;`,
  );
const importRows = (pairs: Pair[], actor = OWNER, pid = property) =>
  row<{ result: { imported: number; skipped: number; bookingIds: string[] } }>(
    "select import_sirvoy_source_calendar($1,$2,$3) result",
    [actor, pid, JSON.stringify(pairs)],
  );
const addDays = (start: string, offset: number) => {
  const day = new Date(`${start}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + offset);
  return day.toISOString().slice(0, 10);
};
const decimalSum = (amounts: string[]) => {
  const total = amounts.reduce((sum, amount) => {
    const [whole, fraction = ""] = amount.split(".");
    return sum + BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  }, 0n);
  return `${total / 100n}.${(total % 100n).toString().padStart(2, "0")}`;
};
async function source(
  format: SirvoySourceFormat,
  fields: Record<string, string>[],
  pid: string,
  actor: string,
  scope: SirvoySourceScope = "excluding_cancelled",
  coverage = "2099-01-01",
) {
  const headers = SIRVOY_SOURCE_HEADERS[format];
  const quote = (text: string) => `"${text.replaceAll('"', '""')}"`;
  const bytes = new TextEncoder().encode(
    [headers, ...fields.map((record) => headers.map((header) => record[header] ?? ""))]
      .map((cells) => cells.map(quote).join(","))
      .join("\r\n") + "\r\n",
  );
  const archive = await row<{ id: string; sha256: string }>(
    "insert into sirvoy_export_archives(property_id,created_by,filename,export_kind,file_bytes,coverage_from,coverage_to,coverage_filter) values($1,$2,'synthetic.csv',$3,$4,$5,'2099-12-31','noncancelled source') returning id,sha256",
    [pid, actor, format, bytes, coverage],
  );
  const parsed = parseSirvoySource(bytes, format, scope);
  const result = await row<{ result: { importId: string } }>(
    "select index_sirvoy_source($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) result",
    [
      actor,
      pid,
      archive.id,
      archive.sha256,
      format,
      scope,
      parsed.parserVersion,
      JSON.stringify(parsed.headers),
      JSON.stringify(parsed.records),
      JSON.stringify(parsed.warnings),
    ],
  );
  return (
    await db.query<{ id: string; record_kind: string }>(
      "select id,record_kind from sirvoy_source_records where import_id=$1 order by source_row",
      [result.result.importId],
    )
  ).rows;
}
async function fixture(
  options: {
    rooms?: string[];
    guests?: number;
    start?: string;
    nights?: number;
    amount?: string;
    paid?: string;
    pid?: string;
    actor?: string;
    scope?: SirvoySourceScope;
    mismatchedPeriod?: boolean;
    confirmed?: string;
    total?: string;
  } = {},
) {
  await service();
  const ref = `SYNTH-${++serial}`;
  const rooms = options.rooms ?? ["1"],
    guests = options.guests ?? 2;
  const start = options.start ?? addDays("2099-06-01", serial * 3),
    end = addDays(start, options.nights ?? 2);
  const amount = options.amount ?? "3304.20",
    total = options.total ?? decimalSum(rooms.map(() => amount));
  const pid = options.pid ?? property,
    actor = options.actor ?? OWNER;
  const common = {
    "Booking no.": ref,
    "Check-in": start,
    "Check-out": end,
    "First name": "Synthetic",
    "Last name": "Guest",
  };
  const expanded = await source(
    "bookings_expanded",
    rooms.map((room) => ({
      ...common,
      Type: "ACCOMM",
      "Room ID": room,
      Guests: String(guests),
      Total: amount,
    })),
    pid,
    actor,
    options.scope,
  );
  const basic = await source(
    "bookings_condensed",
    [
      {
        ...common,
        "Number of rooms": String(rooms.length),
        "Number of guests": String(guests * rooms.length),
        Total: total,
        Paid: options.paid ?? "0",
        Confirmed: options.confirmed ?? "Ja",
        Email: "synthetic@example.com",
        Phone: "+46700000000",
      },
    ],
    pid,
    actor,
    options.scope,
    options.mismatchedPeriod ? "2099-02-01" : undefined,
  );
  return {
    pairs: expanded.map((record) => ({
      accommodationRecordId: record.id,
      bookingRecordId: basic[0].id,
    })),
    ref,
    start,
    end,
  };
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
    "20260907162510_stay_operations_and_guest_fulfillment.sql",
  ])
    await db.exec(read(name));
  await db.exec(
    "grant select,insert,update,delete on properties,units,bookings,message_templates to authenticated; grant select on scheduled_messages to authenticated; grant all on all tables in schema public to service_role; alter default privileges in schema public grant all on tables to service_role;",
  );
  for (const name of [
    "20260929192056_imported_payment_reconciliation.sql",
    "20261005160835_sirvoy_source_archive.sql",
    "20261005172512_sirvoy_searchable_source_records.sql",
    "20261005174946_sirvoy_source_calendar_import.sql",
  ])
    await db.exec(read(name));
  await service();
  property = (
    await row<{ id: string }>(
      "insert into properties(owner_id,name) values($1,'Synthetic property') returning id",
      [OWNER],
    )
  ).id;
  otherProperty = (
    await row<{ id: string }>(
      "insert into properties(owner_id,name) values($1,'Other property') returning id",
      [OTHER],
    )
  ).id;
  for (const pid of [property, otherProperty])
    for (const ref of ["1", "2", "3"])
      await db.query(
        "insert into units(property_id,name,external_ref,max_guests) values($1,$2,$3,$4)",
        [pid, `Tent ${ref}`, ref, ref === "3" ? 2 : 4],
      );
  await db.query(
    "insert into message_templates(property_id,trigger_type,offset_days,send_time,channel,body,enabled) values($1,'booking_created',0,'12:00','email','Synthetic test message',true)",
    [property],
  );
}, 120000);
afterAll(async () => {
  await db?.close();
});

describe("Source-linked future Sirvoy calendar import", () => {
  it("imports exact source-linked inventory with nullable payment and no messages, events or cleaning", async () => {
    const source = await fixture({ amount: "3304.20", paid: "100.50" });
    firstPairs = source.pairs;
    const result = (await importRows(source.pairs)).result;
    expect(result).toMatchObject({ imported: 1, skipped: 0 });
    firstBooking = result.bookingIds[0];
    expect(
      await row(
        "select source,status,stay_status,payment_amount,payment_status,payment_method,communications_enabled,source_accommodation_record_id,source_booking_record_id from bookings where id=$1",
        [firstBooking],
      ),
    ).toMatchObject({
      source: "manual",
      status: "confirmed",
      stay_status: "expected",
      payment_amount: null,
      payment_status: "none",
      payment_method: "none",
      communications_enabled: false,
      source_accommodation_record_id: source.pairs[0].accommodationRecordId,
      source_booking_record_id: source.pairs[0].bookingRecordId,
    });
    expect(
      await row(
        "select accommodation_amount,booking_total,booking_paid_raw,currency from sirvoy_calendar_documentary_values where booking_id=$1",
        [firstBooking],
      ),
    ).toEqual({
      accommodation_amount: "3304.20",
      booking_total: "3304.20",
      booking_paid_raw: "100.50",
      currency: null,
    });
    for (const table of ["scheduled_messages", "imported_payment_events", "stay_operations"])
      expect(
        (await db.query(`select * from ${table} where booking_id=$1`, [firstBooking])).rows,
      ).toEqual([]);
  });
  it("retries the exact original source without changing owner-edited dates or restoring cancellations", async () => {
    await owner();
    await db.query(
      "update bookings set checkin_date='2098-06-01',checkout_date='2098-06-03',status='cancelled' where id=$1",
      [firstBooking],
    );
    await service();
    expect((await importRows(firstPairs)).result).toMatchObject({
      imported: 0,
      skipped: 1,
      bookingIds: [firstBooking],
    });
    expect(
      await row(
        "select checkin_date::text,status,source_accommodation_record_id from bookings where id=$1",
        [firstBooking],
      ),
    ).toEqual({
      checkin_date: "2098-06-01",
      status: "cancelled",
      source_accommodation_record_id: firstPairs[0].accommodationRecordId,
    });
  });
  it("keeps each tent's exact documentary amount and the shared whole-booking total without duplicating payments", async () => {
    const source = await fixture({ rooms: ["1", "2"], amount: "1000.25", paid: "750.50" });
    const result = (await importRows(source.pairs)).result;
    expect(result.imported).toBe(2);
    const values = (
      await db.query(
        "select accommodation_amount,booking_total,booking_paid_raw from sirvoy_calendar_documentary_values where booking_id=any($1)",
        [result.bookingIds],
      )
    ).rows;
    expect(values).toEqual(
      Array(2).fill({
        accommodation_amount: "1000.25",
        booking_total: "2000.50",
        booking_paid_raw: "750.50",
      }),
    );
    expect(
      (
        await db.query("select * from imported_payment_events where booking_id=any($1)", [
          result.bookingIds,
        ])
      ).rows,
    ).toEqual([]);
  });
  it("rejects a partial multi-tent booking, duplicate segments and inconsistent totals atomically", async () => {
    const partial = await fixture({ rooms: ["1", "2"] });
    await expect(importRows(partial.pairs.slice(0, 1))).rejects.toThrow(
      "source_booking_requires_review",
    );
    const duplicate = await fixture({ rooms: ["1", "1"] });
    await expect(importRows(duplicate.pairs)).rejects.toThrow("source_booking_requires_review");
    const mismatched = await fixture({ total: "1.00" });
    await expect(importRows(mismatched.pairs)).rejects.toThrow("source_booking_requires_review");
    for (const ref of [partial.ref, duplicate.ref, mismatched.ref])
      expect(
        (
          await db.query("select * from bookings where external_id like $1", [
            `sirvoy-csv:${ref}:%`,
          ])
        ).rows,
      ).toEqual([]);
  });
  it("uses canonical overlap checks against existing live direct bookings and rolls back a whole multi-tent import", async () => {
    const source = await fixture({ rooms: ["1", "2"] });
    const unit = (
      await row<{ id: string }>("select id from units where property_id=$1 and external_ref='2'", [
        property,
      ])
    ).id;
    await db.query(
      "insert into bookings(property_id,unit_id,source,guest_name,checkin_date,checkout_date) values($1,$2,'direct','Synthetic live',$3,$4)",
      [property, unit, source.start, source.end],
    );
    await expect(importRows(source.pairs)).rejects.toThrow("booking_overlap");
    expect(
      (
        await db.query("select * from bookings where external_id like $1", [
          `sirvoy-csv:${source.ref}:%`,
        ])
      ).rows,
    ).toEqual([]);
    // External writers share the canonical lock and their confirmed inventory also blocks managed imports.
    const external = await fixture();
    const firstUnit = (
      await row<{ id: string }>("select id from units where property_id=$1 and external_ref='1'", [
        property,
      ])
    ).id;
    await db.query(
      "insert into bookings(property_id,unit_id,source,guest_name,checkin_date,checkout_date) values($1,$2,'sirvoy','Synthetic external',$3,$4)",
      [property, firstUnit, external.start, external.end],
    );
    await expect(importRows(external.pairs)).rejects.toThrow("booking_overlap");
  });
  it("requires all three exact active tent mappings and checks capacity and maximum stay", async () => {
    const source = await fixture();
    await db.query("update units set external_ref=null where property_id=$1 and external_ref='3'", [
      property,
    ]);
    await expect(importRows(source.pairs)).rejects.toThrow("source_tent_map_incomplete");
    await db.query(
      "update units set external_ref='3' where property_id=$1 and external_ref is null",
      [property],
    );
    await db.query("update units set active=false where property_id=$1 and external_ref='3'", [
      property,
    ]);
    await expect(importRows(source.pairs)).rejects.toThrow("source_tent_map_incomplete");
    await db.query("update units set active=true where property_id=$1 and external_ref='3'", [
      property,
    ]);
    const duplicateUnit = (
      await row<{ id: string }>(
        "insert into units(property_id,name,external_ref,max_guests) values($1,'Duplicate mapping','1',4) returning id",
        [property],
      )
    ).id;
    await expect(importRows(source.pairs)).rejects.toThrow("source_tent_map_incomplete");
    await db.query("delete from units where id=$1", [duplicateUnit]);
    await expect(importRows((await fixture({ rooms: ["3"], guests: 3 })).pairs)).rejects.toThrow(
      "source_tent_capacity_mismatch",
    );
    await expect(importRows((await fixture({ nights: 31 })).pairs)).rejects.toThrow(
      "source_stay_not_future_or_invalid",
    );
    expect((await importRows(source.pairs)).result.imported).toBe(1);
  });
  it("rejects cancelled, past, unconfirmed, mismatched-period and cross-property source pairs", async () => {
    await expect(importRows((await fixture({ scope: "cancelled" })).pairs)).rejects.toThrow(
      "source_manifests_mismatch",
    );
    await expect(importRows((await fixture({ start: "2020-06-01" })).pairs)).rejects.toThrow(
      "source_stay_not_future_or_invalid",
    );
    await expect(importRows((await fixture({ confirmed: "" })).pairs)).rejects.toThrow(
      "source_booking_requires_review",
    );
    await expect(importRows((await fixture({ mismatchedPeriod: true })).pairs)).rejects.toThrow(
      "source_manifests_mismatch",
    );
    const foreign = await fixture({ pid: otherProperty, actor: OTHER });
    await expect(importRows(foreign.pairs)).rejects.toThrow("source_record_mismatch");
    await expect(importRows(foreign.pairs, OWNER, otherProperty)).rejects.toThrow("not_authorized");
  });
  it("rejects authenticated source-link removal, new source links, payment and communication changes", async () => {
    await owner();
    await expect(importRows(firstPairs)).rejects.toThrow("permission denied");
    await expect(
      db.query(
        "update bookings set source_accommodation_record_id=null,source_booking_record_id=null where id=$1",
        [firstBooking],
      ),
    ).rejects.toThrow("source_calendar_origin_immutable");
    await db.query("update bookings set communications_enabled=true where id=$1", [firstBooking]);
    expect(
      await row("select communications_enabled from bookings where id=$1", [firstBooking]),
    ).toEqual({ communications_enabled: false });
    await expect(
      db.query("update bookings set payment_status='paid' where id=$1", [firstBooking]),
    ).rejects.toThrow("payment_lifecycle_server_only");
    await expect(
      db.query(
        "insert into bookings(property_id,unit_id,source,external_id,guest_name,checkin_date,checkout_date,source_accommodation_record_id,source_booking_record_id,communications_enabled) select property_id,unit_id,'manual',null,'Injected','2099-01-01','2099-01-02',source_accommodation_record_id,source_booking_record_id,false from bookings where id=$1",
        [firstBooking],
      ),
    ).rejects.toThrow("source_calendar_server_only");
    await service();
    await db.query("update bookings set communications_enabled=true where id=$1", [firstBooking]);
    expect(
      await row("select communications_enabled from bookings where id=$1", [firstBooking]),
    ).toEqual({ communications_enabled: false });
    await expect(
      db.query("update bookings set payment_amount=3304 where id=$1", [firstBooking]),
    ).rejects.toThrow("source_calendar_payment_unverified");
  });
  it("rolls back the complete old reconciliation RPC including its financial event insert", async () => {
    const source = await fixture();
    const bid = (await importRows(source.pairs)).result.bookingIds[0];
    await owner();
    await expect(
      db.query("update bookings set communications_enabled=true where id=$1", [bid]),
    ).rejects.toThrow("imported_payment_required");
    await service();
    await expect(
      db.query(
        "select reconcile_imported_payment($1,$2,'record_payment',3304,'2025-06-01T10:00:00Z','Synthetic evidence')",
        [OWNER, bid],
      ),
    ).rejects.toThrow("source_calendar_payment_unverified");
    expect(
      await row(
        "select payment_amount,payment_status,communications_enabled from bookings where id=$1",
        [bid],
      ),
    ).toEqual({ payment_amount: null, payment_status: "none", communications_enabled: false });
    expect(
      (await db.query("select * from imported_payment_events where booking_id=$1", [bid])).rows,
    ).toEqual([]);
    expect(
      (await db.query("select * from scheduled_messages where booking_id=$1", [bid])).rows,
    ).toEqual([]);
  });
  it("leaves legacy whole-krona import and owner reconciliation unchanged", async () => {
    await service();
    const unit = (
      await row<{ id: string }>("select id from units where property_id=$1 and external_ref='1'", [
        property,
      ])
    ).id;
    await db.query("select import_sirvoy_stays($1,$2)", [
      property,
      JSON.stringify([
        {
          external_id: "sirvoy-csv:legacy:1",
          unit_id: unit,
          guest_name: "Synthetic legacy",
          checkin_date: "2099-01-03",
          checkout_date: "2099-01-04",
          guests: 2,
          amount_sek: 4200,
        },
      ]),
    ]);
    const bid = (
      await row<{ id: string }>("select id from bookings where external_id='sirvoy-csv:legacy:1'")
    ).id;
    await db.query(
      "select reconcile_imported_payment($1,$2,'record_payment',4200,'2025-06-01T10:00:00Z','Synthetic legacy proof')",
      [OWNER, bid],
    );
    expect(
      await row(
        "select payment_amount,payment_status,source_accommodation_record_id,communications_enabled from bookings where id=$1",
        [bid],
      ),
    ).toEqual({
      payment_amount: 4200,
      payment_status: "paid",
      source_accommodation_record_id: null,
      communications_enabled: false,
    });
    expect(
      (await db.query("select * from imported_payment_events where booking_id=$1", [bid])).rows,
    ).toHaveLength(1);
  });
  it("honors owner RLS and existing deletion guards without adding a source cascade blocker", async () => {
    const foreign = await fixture({ pid: otherProperty, actor: OTHER });
    await importRows(foreign.pairs, OTHER, otherProperty);
    await owner();
    expect(
      (
        await db.query<{ property_id: string }>(
          "select property_id from sirvoy_calendar_documentary_values",
        )
      ).rows.every((row) => row.property_id === property),
    ).toBe(true);
    await owner(OTHER);
    expect(
      (
        await db.query<{ property_id: string }>(
          "select property_id from sirvoy_calendar_documentary_values",
        )
      ).rows,
    ).toEqual([{ property_id: otherProperty }]);
    await db.exec("reset role");
    await expect(db.query("delete from properties where id=$1", [otherProperty])).rejects.toThrow(
      "unit_has_bookings_archive_instead",
    );
    await db.query("delete from bookings where property_id=$1", [otherProperty]);
    await db.query("delete from properties where id=$1", [otherProperty]);
    expect(
      (await db.query("select * from bookings where property_id=$1", [otherProperty])).rows,
    ).toEqual([]);
  });
});

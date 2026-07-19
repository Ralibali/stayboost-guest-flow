import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import {
  guestNameFrom,
  isBlockEvent,
  parseIcs,
  unfoldIcs,
} from "../../supabase/functions/_shared/ics";
import { buildIcs, icsEscape, foldLine } from "../../supabase/functions/_shared/ics-export";
import {
  isWeekendNight,
  nightlyPrice,
  nightsBetween,
  quoteStay,
  rangesOverlap,
  type UnitPricing,
} from "../../supabase/functions/_shared/pricing";
import { mapSirvoyPayload } from "../../supabase/functions/_shared/sirvoy";
import { formatSvDate, renderTemplate } from "../../supabase/functions/_shared/templates";

/* ================= iCal-parser ================= */

const AIRBNB_ICS = `BEGIN:VCALENDAR\r
PRODID;X-RICAL-TZSOURCE=TZINFO:-//Airbnb Inc//Hosting Calendar 0.8.8//EN\r
VERSION:2.0\r
BEGIN:VEVENT\r
DTSTAMP:20260701T000000Z\r
UID:abc123@airbnb.com\r
DTSTART;VALUE=DATE:20260810\r
DTEND;VALUE=DATE:20260813\r
SUMMARY:Reserved\r
STATUS:CONFIRMED\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:def456@airbnb.com\r
DTSTART;VALUE=DATE:20260820\r
DTEND;VALUE=DATE:20260822\r
SUMMARY:Airbnb (Not available)\r
END:VEVENT\r
END:VCALENDAR\r
`;

const BOOKING_ICS = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:789@booking.com
DTSTART;VALUE=DATE:20260905
DTEND;VALUE=DATE:20260908
SUMMARY:Familj Johansson - CLOSED - Not available
END:VEVENT
BEGIN:VEVENT
UID:555@booking.com
DTSTART:20261001T140000Z
DTEND:20261003T100000Z
SUMMARY:Sara Lind
STATUS:CANCELLED
END:VEVENT
BEGIN:VEVENT
UID:777@booking.com
DTSTART;VALUE=DATE:20261010
DTEND;VALUE=DATE:20261012
SUMMARY:Lång rad som\r
 fortsätter här\r
END:VEVENT
END:VCALENDAR
`;

describe("iCal-parser (Airbnb/Booking-format)", () => {
  it("parsar Airbnb-event med datum och UID", () => {
    const evs = parseIcs(AIRBNB_ICS);
    expect(evs).toHaveLength(2);
    expect(evs[0]).toMatchObject({
      uid: "abc123@airbnb.com",
      startDate: "2026-08-10",
      endDate: "2026-08-13",
      status: "CONFIRMED",
    });
  });

  it("flaggar blocknätter och avbokningar", () => {
    const airbnb = parseIcs(AIRBNB_ICS);
    expect(isBlockEvent(airbnb[1])).toBe(true);
    const booking = parseIcs(BOOKING_ICS);
    expect(booking[1].status).toBe("CANCELLED");
  });

  it("'Reserved' ger inget gästnamn, riktiga namn behålls", () => {
    expect(guestNameFrom("Reserved")).toBeNull();
    expect(guestNameFrom("")).toBeNull();
    expect(guestNameFrom("Sara Lind")).toBe("Sara Lind");
  });

  it("slår ihop radbrutna fält och hanterar tidsstämplade datum", () => {
    expect(unfoldIcs("SUMMARY:Lång\r\n forts")).toBe("SUMMARY:Långforts");
    const evs = parseIcs(BOOKING_ICS);
    expect(evs[1].startDate).toBe("2026-10-01"); // DTSTART med tid → datum
    expect(evs[2].summary).toBe("Lång rad somfortsätter här");
  });

  it("hoppar över trasiga event utan datum", () => {
    const evs = parseIcs("BEGIN:VEVENT\nUID:x\nEND:VEVENT\n");
    expect(evs).toHaveLength(0);
  });
});

/* ================= iCal-export ================= */

describe("iCal-export (flöde till Airbnb/Booking)", () => {
  it("bygger giltig kalender som vår egen parser kan läsa tillbaka", () => {
    const ics = buildIcs(
      [
        {
          uid: "bok-1@stayboost",
          startDate: "2026-08-10",
          endDate: "2026-08-13",
          summary: "Bokad",
        },
        {
          uid: "bok-2@stayboost",
          startDate: "2026-09-01",
          endDate: "2026-09-05",
          summary: "Bokad",
        },
      ],
      "Bergs Slussar — Sjöstugan",
    );
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("DTSTART;VALUE=DATE:20260810");
    const roundTrip = parseIcs(ics);
    expect(roundTrip).toHaveLength(2);
    expect(roundTrip[0]).toMatchObject({
      uid: "bok-1@stayboost",
      startDate: "2026-08-10",
      endDate: "2026-08-13",
      status: "CONFIRMED",
    });
  });

  it("escapar specialtecken och viker långa rader enligt RFC 5545", () => {
    expect(icsEscape("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
    const folded = foldLine("X".repeat(80));
    expect(folded.split("\r\n")[0]).toHaveLength(74);
    expect(folded.split("\r\n")[1].startsWith(" ")).toBe(true);
  });
});

/* ================= Prismotor (direktbokning) ================= */

const PRICING: UnitPricing = {
  base_price: 1000,
  weekend_pct: 25,
  cleaning_fee: 295,
  monthly_mult: [70, 70, 70, 70, 85, 100, 100, 100, 85, 70, 70, 70],
};

describe("prismotor", () => {
  it("räknar nätter i [checkin, checkout)", () => {
    expect(nightsBetween("2026-08-10", "2026-08-13")).toEqual([
      "2026-08-10",
      "2026-08-11",
      "2026-08-12",
    ]);
  });

  it("helgpåslag slår på fre/lör, säsongsfaktor på månad", () => {
    expect(isWeekendNight("2026-08-14")).toBe(true); // fredag
    expect(isWeekendNight("2026-08-16")).toBe(false); // söndag
    expect(nightlyPrice(PRICING, "2026-08-12")).toBe(1000); // ons i aug, högsäsong
    expect(nightlyPrice(PRICING, "2026-08-14")).toBe(1250); // fre i aug +25%
    expect(nightlyPrice(PRICING, "2026-01-12")).toBe(700); // mån i jan, −30%
    expect(nightlyPrice(PRICING, "2026-05-11")).toBe(850); // mån i maj, −15%
  });

  it("quoteStay summerar nätter + städavgift", () => {
    const q = quoteStay(PRICING, "2026-08-13", "2026-08-16"); // tor, fre, lör
    expect(q.nights).toBe(3);
    expect(q.subtotal).toBe(1000 + 1250 + 1250);
    expect(q.total).toBe(3500 + 295);
  });

  it("överlapp i halvöppna intervall", () => {
    expect(rangesOverlap("2026-08-10", "2026-08-12", "2026-08-11", "2026-08-13")).toBe(true);
    expect(rangesOverlap("2026-08-10", "2026-08-12", "2026-08-12", "2026-08-14")).toBe(false); // samma dag ut/in
    expect(rangesOverlap("2026-08-10", "2026-08-12", "2026-08-01", "2026-08-10")).toBe(false);
  });
});

/* ================= Sirvoy-webhook-mappare ================= */

describe("Sirvoy-payload-mappare", () => {
  it("mappar platt payload", () => {
    const b = mapSirvoyPayload({
      booking_id: 12345,
      room_id: "101",
      checkin: "2026-08-01",
      checkout: "2026-08-04",
      guest_name: "Anna Andersson",
      guest_email: "anna@example.se",
      status: "confirmed",
    });
    expect(b).toMatchObject({
      externalId: "12345",
      roomRef: "101",
      guestName: "Anna Andersson",
      guestEmail: "anna@example.se",
      checkin: "2026-08-01",
      checkout: "2026-08-04",
      cancelled: false,
    });
  });

  it("mappar nästlad payload med annat fältnamn + avbokning", () => {
    const b = mapSirvoyPayload({
      reservationId: "x9",
      arrival: "2026-09-01T14:00:00Z",
      departure: "2026-09-03",
      guest: { name: "Sara Lind", email: "sara@example.se" },
      event: "booking_cancelled",
    });
    expect(b).toMatchObject({
      externalId: "x9",
      checkin: "2026-09-01",
      checkout: "2026-09-03",
      guestName: "Sara Lind",
      guestEmail: "sara@example.se",
      cancelled: true,
    });
  });

  it("avvisar oanvändbara payloads", () => {
    expect(mapSirvoyPayload(null)).toBeNull();
    expect(mapSirvoyPayload({ checkin: "2026-08-01", checkout: "2026-08-02" })).toBeNull(); // saknar id
    expect(mapSirvoyPayload({ id: "1", checkin: "2026-08-02", checkout: "2026-08-01" })).toBeNull(); // utcheckning före incheckning
  });
});

/* ================= Mallmotor ================= */

describe("mallmotor", () => {
  it("ersätter variabler och lämnar okända tomma", () => {
    expect(renderTemplate("Hej {{gäst_namn}}! {{okänd}}", { gäst_namn: "Anna" })).toBe(
      "Hej Anna! ",
    );
  });

  it("formaterar svenska datum i Europe/Stockholm", () => {
    expect(formatSvDate("2026-08-14")).toBe("14 augusti");
    expect(formatSvDate("2026-01-01")).toBe("1 januari");
  });
});

/* ================= Databasmigration mot riktig Postgres ================= */

const MIGRATION = readFileSync(
  join(__dirname, "../../supabase/migrations/20260719000000_fas1.sql"),
  "utf8",
);
const MIGRATION_ICAL = readFileSync(
  join(__dirname, "../../supabase/migrations/20260719120000_ical_export.sql"),
  "utf8",
);
const MIGRATION_DIRECT = readFileSync(
  join(__dirname, "../../supabase/migrations/20260719200000_direct_booking.sql"),
  "utf8",
);
const MIGRATION_SIRVOY = readFileSync(
  join(__dirname, "../../supabase/migrations/20260720000000_sirvoy_swish.sql"),
  "utf8",
);

const AUTH_STUB = `
create schema auth;
create table auth.users (id uuid primary key);
insert into auth.users values ('00000000-0000-0000-0000-0000000000a1');
create or replace function auth.uid() returns uuid language sql stable as
$$ select '00000000-0000-0000-0000-0000000000a1'::uuid $$;
`;

describe("Fas 1-migration mot Postgres", () => {
  it("kör hela flödet: seed, schemaläggning, sen import, omplanering, avbokning, dedup", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(AUTH_STUB);
    await db.exec(MIGRATION);
    await db.exec(MIGRATION_ICAL);

    const OWNER = "00000000-0000-0000-0000-0000000000a1";

    // Anläggning → fyra standardmallar seedas automatiskt
    const prop = await db.query<{ id: string }>(
      "insert into properties (owner_id, name) values ($1, 'Teststugan') returning id",
      [OWNER],
    );
    const pid = prop.rows[0].id;
    const templates = await db.query<{ trigger_type: string }>(
      "select trigger_type from message_templates where property_id = $1 order by trigger_type",
      [pid],
    );
    expect(templates.rows.map((t) => t.trigger_type)).toEqual([
      "booking_created",
      "checkin_day",
      "post_stay",
      "pre_arrival",
    ]);

    // Enhet + iCal-källa
    const unit = await db.query<{ id: string }>(
      "insert into units (property_id, name, door_code) values ($1, 'Sjöstugan', '4482') returning id",
      [pid],
    );
    const uid = unit.rows[0].id;
    const src = await db.query<{ id: string }>(
      "insert into ical_sources (property_id, unit_id, name, url) values ($1, $2, 'Airbnb', 'https://x') returning id",
      [pid, uid],
    );
    const srcId = src.rows[0].id;

    // Enheten fick en unik export-token automatiskt (iCal-flöde till kanalerna)
    const feed = await db.query<{ ical_feed_token: string }>(
      "select ical_feed_token from units where id = $1",
      [uid],
    );
    expect(feed.rows[0].ical_feed_token).toMatch(/^[0-9a-f]{24}$/);

    // Framtida bokning → fyra meddelanden schemaläggs (bekräftelse direkt)
    const in10 = "2026-08-10";
    const in12 = "2026-08-12";
    const b1 = await db.query<{ id: string; guest_token: string }>(
      `insert into bookings (property_id, unit_id, source, ical_source_id, ical_uid, guest_name, checkin_date, checkout_date)
       values ($1, $2, 'ical', $3, 'uid-1', 'Anna', $4, $5) returning id, guest_token`,
      [pid, uid, srcId, in10, in12],
    );
    expect(b1.rows[0].guest_token).toMatch(/^[0-9a-f]{24}$/);

    const msgs = await db.query<{ channel: string; send_at: string }>(
      "select channel, send_at from scheduled_messages where booking_id = $1 order by send_at",
      [b1.rows[0].id],
    );
    expect(msgs.rows).toHaveLength(4); // booking_created + pre_arrival + checkin_day + post_stay

    // pre_arrival: (10 aug - 2 dagar) kl 09:00 Stockholm = 08 aug 07:00 UTC (sommartid)
    const pre = msgs.rows[1];
    expect(new Date(pre.send_at).toISOString()).toBe("2026-08-08T07:00:00.000Z");

    // Sen import: incheckning i dag → inga förfallna meddelanden spamas ut
    const today = new Date().toISOString().slice(0, 10);
    const in3 = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const b2 = await db.query<{ id: string }>(
      `insert into bookings (property_id, unit_id, source, checkin_date, checkout_date)
       values ($1, $2, 'manual', $3, $4) returning id`,
      [pid, uid, today, in3],
    );
    const msgs2 = await db.query<{ trigger_type: string }>(
      `select sm.template_id, mt.trigger_type from scheduled_messages sm
       join message_templates mt on mt.id = sm.template_id
       where sm.booking_id = $1`,
      [b2.rows[0].id],
    );
    const triggers = msgs2.rows.map((r) => r.trigger_type).sort();
    expect(triggers).toEqual(["booking_created", "post_stay"]); // pre_arrival hoppades över

    // Omplanering: nya datum → schemat räknas om mot nya datumet
    await db.query("update bookings set checkin_date = $1, checkout_date = $2 where id = $3", [
      "2026-09-10",
      "2026-09-12",
      b1.rows[0].id,
    ]);
    const rebooked = await db.query<{ send_at: string }>(
      `select sm.send_at from scheduled_messages sm
       join message_templates mt on mt.id = sm.template_id
       where sm.booking_id = $1 and mt.trigger_type = 'pre_arrival'`,
      [b1.rows[0].id],
    );
    expect(rebooked.rows).toHaveLength(1);
    expect(new Date(rebooked.rows[0].send_at).toISOString()).toBe("2026-09-08T07:00:00.000Z");

    // Avbokning → allt pending släcks
    await db.query("update bookings set status = 'cancelled' where id = $1", [b1.rows[0].id]);
    const afterCancel = await db.query<{ status: string }>(
      "select distinct status from scheduled_messages where booking_id = $1",
      [b1.rows[0].id],
    );
    expect(afterCancel.rows.map((r) => r.status)).toEqual(["cancelled"]);

    // Dedup: samma iCal-event kan inte importeras två gånger, manuella NULL-par krockar aldrig
    await expect(
      db.query(
        `insert into bookings (property_id, unit_id, source, ical_source_id, ical_uid, checkin_date, checkout_date)
         values ($1, $2, 'ical', $3, 'uid-1', $4, $5)`,
        [pid, uid, srcId, "2026-08-10", "2026-08-12"],
      ),
    ).rejects.toThrow();
    const manualDupes = await db.query(
      `insert into bookings (property_id, unit_id, source, checkin_date, checkout_date)
       values ($1, $2, 'manual', $3, $4), ($1, $2, 'manual', $3, $4) returning id`,
      [pid, uid, "2026-10-01", "2026-10-03"],
    );
    expect(manualDupes.rows).toHaveLength(2);

    // Ogiltiga datum stoppas av CHECK-constraint
    await expect(
      db.query(
        "insert into bookings (property_id, checkin_date, checkout_date) values ($1, $2, $2)",
        [pid, "2026-08-10"],
      ),
    ).rejects.toThrow();
  }, 30000);

  it("direktboknings-migrationen: slug, priser och källa 'direct'", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(AUTH_STUB);
    await db.exec(MIGRATION);
    await db.exec(MIGRATION_ICAL);
    await db.exec(MIGRATION_DIRECT);

    // Slug genereras automatiskt och är unik
    const p1 = await db.query<{ id: string; slug: string }>(
      "insert into properties (owner_id, name) values ('00000000-0000-0000-0000-0000000000a1', 'Test A') returning id, slug",
    );
    const p2 = await db.query<{ id: string; slug: string }>(
      "insert into properties (owner_id, name) values ('00000000-0000-0000-0000-0000000000a1', 'Test B') returning id, slug",
    );
    expect(p1.rows[0].slug).toMatch(/^anlaggning-[0-9a-f]{6}$/);
    expect(p2.rows[0].slug).toMatch(/^anlaggning-[0-9a-f]{6}$/);
    expect(p1.rows[0].slug).not.toBe(p2.rows[0].slug);

    // Enheter får prismodell med svenska säsongsfaktorer som default
    const u = await db.query<{
      id: string;
      base_price: number;
      weekend_pct: number;
      monthly_mult: number[];
    }>(
      "insert into units (property_id, name) values ($1, 'Kanaltältet') returning id, base_price, weekend_pct, monthly_mult",
      [p1.rows[0].id],
    );
    expect(u.rows[0].base_price).toBe(995);
    expect(u.rows[0].weekend_pct).toBe(25);
    expect(Number(u.rows[0].monthly_mult[6])).toBe(100); // juli = högsäsong
    expect(Number(u.rows[0].monthly_mult[0])).toBe(70); // januari = lågsäsong

    // Direktbokningar är en giltig källa och schemalägger meddelanden som vanligt
    const b = await db.query<{ id: string }>(
      `insert into bookings (property_id, unit_id, source, guest_name, guest_email, checkin_date, checkout_date)
       values ($1, $2, 'direct', 'Direktgäst', 'direkt@example.se', '2026-09-10', '2026-09-12') returning id`,
      [p1.rows[0].id, u.rows[0].id],
    );
    const msgs = await db.query<{ n: number }>(
      "select count(*)::int as n from scheduled_messages where booking_id = $1",
      [b.rows[0].id],
    );
    expect(msgs.rows[0].n).toBe(4);
  }, 30000);

  it("Sirvoy/Swish-migrationen: webhook-token, extern dedup och betalstatus", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(AUTH_STUB);
    await db.exec(MIGRATION);
    await db.exec(MIGRATION_ICAL);
    await db.exec(MIGRATION_DIRECT);
    await db.exec(MIGRATION_SIRVOY);

    const p = await db.query<{ id: string; sirvoy_webhook_token: string }>(
      "insert into properties (owner_id, name) values ('00000000-0000-0000-0000-0000000000a1', 'Sirvoy-test') returning id, sirvoy_webhook_token",
    );
    expect(p.rows[0].sirvoy_webhook_token).toMatch(/^[0-9a-f]{24}$/);

    // Sirvoy-bokning med externt id: dedup stoppar dubletter, NULL krockar aldrig
    const ins = `insert into bookings (property_id, source, external_id, checkin_date, checkout_date)
                 values ($1, 'sirvoy', 'srv-1', '2026-08-01', '2026-08-03')`;
    await db.query(ins, [p.rows[0].id]);
    await expect(db.query(ins, [p.rows[0].id])).rejects.toThrow();

    // Manuella bokningar utan external_id påverkas inte av dedup-indexet
    await db.query(
      `insert into bookings (property_id, source, checkin_date, checkout_date)
       values ($1, 'manual', '2026-08-01', '2026-08-03'), ($1, 'manual', '2026-08-01', '2026-08-03')`,
      [p.rows[0].id],
    );

    // Betalstatus default + giltiga värden
    const pay = await db.query<{ payment_status: string }>(
      "insert into bookings (property_id, source, checkin_date, checkout_date) values ($1, 'direct', '2026-09-01', '2026-09-02') returning payment_status",
      [p.rows[0].id],
    );
    expect(pay.rows[0].payment_status).toBe("none");
    await expect(
      db.query(
        "insert into bookings (property_id, source, checkin_date, checkout_date, payment_status) values ($1, 'direct', '2026-09-01', '2026-09-02', 'kanske')",
        [p.rows[0].id],
      ),
    ).rejects.toThrow();
  }, 30000);
});

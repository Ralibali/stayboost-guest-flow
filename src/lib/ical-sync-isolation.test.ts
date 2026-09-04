import { describe, expect, it } from "vitest";
import {
  syncIcalSourceBookings,
  type IcalSyncAdmin,
  type IcalSyncSource,
} from "../../supabase/functions/_shared/ical-sync";
import type { IcsEvent } from "../../supabase/functions/_shared/ics";

// Replica of default-branch ical-sync booking I/O (main @ 348d8a3):
// load by ical_source_id only; overlap by unit_id only; update by booking.id.
// Used only when ISOLATION_AGAINST_MAIN=1 to record the leak. Not shipped.
async function syncIcalSourceBookingsAsOnMain(
  admin: IcalSyncAdmin,
  source: IcalSyncSource,
  reservationEvents: IcsEvent[],
  opts: { today: string; nowIso: string },
) {
  const activeEvents = reservationEvents.filter((event) => event.status !== "CANCELLED");
  const explicitCancelledEvents = reservationEvents.filter(
    (event) => event.status === "CANCELLED",
  );

  const { data: existing, error: existingError } = await admin
    .from("bookings")
    .select(
      "id, ical_uid, guest_name, checkin_date, checkout_date, status, ical_missing_since, ical_missing_count, ical_cancelled_at, ical_cancel_reason",
    )
    .eq("ical_source_id", source.id);
  if (existingError) throw existingError;

  const byUid = new Map((existing ?? []).map((booking) => [booking.ical_uid, booking]));
  let created = 0;
  let updated = 0;
  let cancelled = 0;
  let conflicts = 0;
  let protectedMissing = 0;

  for (const event of activeEvents) {
    const previous = byUid.get(event.uid);
    if (!previous) {
      if (source.unit_id) {
        const { data: overlapping, error: overlapError } = await admin
          .from("bookings")
          .select("id")
          .eq("unit_id", source.unit_id)
          .eq("status", "confirmed")
          .lt("checkin_date", event.endDate)
          .gt("checkout_date", event.startDate)
          .limit(1);
        if (overlapError) throw overlapError;
        if ((overlapping ?? []).length > 0) conflicts++;
      }

      const { error } = await admin.from("bookings").insert({
        property_id: source.property_id,
        unit_id: source.unit_id,
        source: "ical",
        ical_source_id: source.id,
        ical_uid: event.uid,
        guest_name: event.summary || null,
        checkin_date: event.startDate,
        checkout_date: event.endDate,
      });
      if (error) throw error;
      created++;
      continue;
    }

    const patch: Record<string, unknown> = {};
    if (previous.checkin_date !== event.startDate) patch.checkin_date = event.startDate;
    if (previous.checkout_date !== event.endDate) patch.checkout_date = event.endDate;
    if (previous.status !== "confirmed") patch.status = "confirmed";
    if (Object.keys(patch).length > 0) {
      const { error } = await admin.from("bookings").update(patch).eq("id", previous.id);
      if (error) throw error;
      updated++;
    }
  }

  for (const event of explicitCancelledEvents) {
    const previous = byUid.get(event.uid);
    if (!previous || previous.status === "cancelled") continue;
    const { error } = await admin
      .from("bookings")
      .update({
        status: "cancelled",
        ical_cancelled_at: opts.nowIso,
        ical_cancel_reason: "explicit",
      })
      .eq("id", previous.id);
    if (error) throw error;
    cancelled++;
  }

  return {
    created,
    updated,
    cancelled,
    conflicts,
    protectedMissing,
    skipped: false,
  };
}

const handleUnderTest =
  process.env.ISOLATION_AGAINST_MAIN === "1"
    ? syncIcalSourceBookingsAsOnMain
    : syncIcalSourceBookings;

// Isolation oracle for the service_role iCal import cron.
// Two properties, each with a source/unit/booking. Cross-tenant attempts
// present B's source identity together with a booking that belongs to A
// (linked only by ical_source_id / unit_id / booking.id). Those are not a
// tenant scope. Trusted binding: ical_sources.property_id (NOT NULL in
// 20260719000000_fas1.sql). Every bookings query must re-filter on it.

const TODAY = "2026-09-04";
const NOW_ISO = "2026-09-04T06:00:00.000Z";

const sourceA: IcalSyncSource = {
  id: "src-a",
  property_id: "prop-a",
  unit_id: "unit-a",
  name: "Airbnb A",
  channel_type: "airbnb",
};

const sourceB: IcalSyncSource = {
  id: "src-b",
  property_id: "prop-b",
  unit_id: "unit-b",
  name: "Airbnb B",
  channel_type: "airbnb",
};

const bookingA = {
  id: "book-a",
  property_id: "prop-a",
  unit_id: "unit-a",
  source: "ical",
  ical_source_id: "src-a",
  ical_uid: "uid-alice",
  guest_name: "Alice",
  checkin_date: "2026-09-10",
  checkout_date: "2026-09-12",
  status: "confirmed",
  ical_missing_since: null as string | null,
  ical_missing_count: 0,
  ical_cancelled_at: null as string | null,
  ical_cancel_reason: null as string | null,
};

const bookingB = {
  id: "book-b",
  property_id: "prop-b",
  unit_id: "unit-b",
  source: "ical",
  ical_source_id: "src-b",
  ical_uid: "uid-bob",
  guest_name: "Bob",
  checkin_date: "2026-10-01",
  checkout_date: "2026-10-03",
  status: "confirmed",
  ical_missing_since: null as string | null,
  ical_missing_count: 0,
  ical_cancelled_at: null as string | null,
  ical_cancel_reason: null as string | null,
};

type Row = Record<string, unknown>;
type Filter = {
  column: string;
  value: unknown;
  op: "eq" | "lt" | "gt";
};

function createMockAdmin(
  seedBookings: Row[] = [bookingA, bookingB],
) {
  const tables: Record<string, Row[]> = {
    bookings: seedBookings.map((row) => ({ ...row })),
  };

  const from = (table: string) => {
    const filters: Filter[] = [];
    let patch: Row | null = null;
    let limitCount: number | null = null;

    const match = () => {
      const rows = (tables[table] ?? []).filter((row) =>
        filters.every((filter) => {
          const value = row[filter.column];
          if (filter.op === "eq") return value === filter.value;
          if (filter.op === "lt") return String(value) < String(filter.value);
          if (filter.op === "gt") return String(value) > String(filter.value);
          return true;
        }),
      );
      return limitCount == null ? rows : rows.slice(0, limitCount);
    };

    const query = {
      select() {
        return query;
      },
      insert(row: Row) {
        tables[table].push({ id: `ins-${tables[table].length + 1}`, ...row });
        return Promise.resolve({ data: [row], error: null });
      },
      update(next: Row) {
        patch = next;
        return query;
      },
      eq(column: string, value: unknown) {
        filters.push({ column, value, op: "eq" });
        return query;
      },
      lt(column: string, value: unknown) {
        filters.push({ column, value, op: "lt" });
        return query;
      },
      gt(column: string, value: unknown) {
        filters.push({ column, value, op: "gt" });
        return query;
      },
      limit(count: number) {
        limitCount = count;
        return query;
      },
      then(
        resolve: (value: { data: Row[]; error: null }) => unknown,
        reject?: (reason: unknown) => unknown,
      ) {
        if (patch) {
          for (const row of match()) Object.assign(row, patch);
        }
        return Promise.resolve({ data: match(), error: null }).then(resolve, reject);
      },
    };
    return query;
  };

  return {
    from,
    booking: (id: string) => tables.bookings.find((row) => row.id === id),
    bookings: () => tables.bookings,
  };
}

function event(uid: string, startDate: string, endDate: string, status = "CONFIRMED"): IcsEvent {
  return { uid, summary: uid === "uid-alice" ? "Alice" : "Guest", status, startDate, endDate };
}

async function syncSource(
  source: IcalSyncSource,
  events: IcsEvent[],
  admin: ReturnType<typeof createMockAdmin>,
) {
  return handleUnderTest(admin, source, events, { today: TODAY, nowIso: NOW_ISO });
}

describe("tenant isolation: ical-sync", () => {
  it("rejects updating property A's booking when syncing under property B's source", async () => {
    // A's booking is associated to B's source id only — the leak on main.
    const admin = createMockAdmin([
      { ...bookingA, ical_source_id: sourceB.id },
      bookingB,
    ]);

    const result = await syncSource(
      sourceB,
      [
        event("uid-alice", "2026-11-01", "2026-11-05"),
        event("uid-bob", bookingB.checkin_date, bookingB.checkout_date),
      ],
      admin,
    );

    expect(result.skipped, "B's source has a property_id; must not skip").toBe(false);
    expect(result.updated, "must not apply B's feed dates onto A's booking").toBe(0);
    expect(admin.booking("book-a")?.checkin_date).toBe("2026-09-10");
    expect(admin.booking("book-a")?.checkout_date).toBe("2026-09-12");
    expect(admin.booking("book-a")?.guest_name).toBe("Alice");
    expect(admin.booking("book-a")?.status).toBe("confirmed");
    expect(admin.booking("book-b")?.checkin_date).toBe("2026-10-01");
  });

  it("rejects cancelling property A's booking via property B's source identity", async () => {
    const admin = createMockAdmin([
      { ...bookingA, ical_source_id: sourceB.id },
      bookingB,
    ]);

    const result = await syncSource(
      sourceB,
      [
        event("uid-alice", "2026-09-10", "2026-09-12", "CANCELLED"),
        event("uid-bob", bookingB.checkin_date, bookingB.checkout_date),
      ],
      admin,
    );

    expect(result.cancelled, "must not cancel A's booking from B's feed").toBe(0);
    expect(admin.booking("book-a")?.status).toBe("confirmed");
    expect(admin.booking("book-a")?.ical_cancel_reason).toBeNull();
    expect(admin.booking("book-b")?.status).toBe("confirmed");
  });

  it("does not count property A's occupancy when B's source claims A's unit_id", async () => {
    const admin = createMockAdmin();
    const claimingB: IcalSyncSource = { ...sourceB, unit_id: bookingA.unit_id };

    const result = await syncSource(
      claimingB,
      [
        event("uid-new-b", "2026-09-10", "2026-09-12"),
        event("uid-bob", bookingB.checkin_date, bookingB.checkout_date),
      ],
      admin,
    );

    expect(result.conflicts, "overlap must be tenant-scoped; A's nights are not B's").toBe(0);
    expect(admin.booking("book-a")?.checkin_date).toBe("2026-09-10");
    expect(admin.booking("book-a")?.status).toBe("confirmed");
    expect(admin.bookings().some((row) => row.ical_uid === "uid-new-b" && row.property_id === "prop-b")).toBe(
      true,
    );
    expect(admin.bookings().some((row) => row.ical_uid === "uid-new-b" && row.property_id === "prop-a")).toBe(
      false,
    );
  });

  it("still updates the matching tenant when source and booking property_id agree", async () => {
    const admin = createMockAdmin();
    const result = await syncSource(
      sourceA,
      [event("uid-alice", "2026-09-11", "2026-09-14")],
      admin,
    );

    expect(result.skipped).toBe(false);
    expect(result.updated).toBe(1);
    expect(admin.booking("book-a")?.checkin_date).toBe("2026-09-11");
    expect(admin.booking("book-a")?.checkout_date).toBe("2026-09-14");
    expect(admin.booking("book-b")?.checkin_date).toBe("2026-10-01");
  });

  it("skips the source when property_id is missing — same as missing, no writes", async () => {
    const admin = createMockAdmin();
    const result = await syncSource(
      { ...sourceB, property_id: null },
      [event("uid-alice", "2026-11-01", "2026-11-05")],
      admin,
    );

    expect(result.skipped).toBe(true);
    expect(result.updated).toBe(0);
    expect(result.created).toBe(0);
    expect(admin.booking("book-a")?.checkin_date).toBe("2026-09-10");
    expect(admin.booking("book-b")?.checkin_date).toBe("2026-10-01");
    expect(admin.bookings()).toHaveLength(2);
  });
});

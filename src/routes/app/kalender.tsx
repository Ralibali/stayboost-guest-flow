import { Link, createFileRoute } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase, useProperty, useSession, type Booking, type Unit } from "@/lib/supabase";
import { bookingConflicts, fetchAllRows } from "@/lib/operator-bookings";
import { propertyDay, propertyMonth, shiftPropertyDay } from "@/lib/property-dates";

export const Route = createFileRoute("/app/kalender")({ component: CalendarPage });
type CalendarBooking = Pick<
  Booking,
  | "id"
  | "unit_id"
  | "guest_name"
  | "checkin_date"
  | "checkout_date"
  | "source"
  | "status"
  | "payment_status"
>;
const SOURCE_STYLE: Record<Booking["source"], { bg: string; label: string }> = {
  direct: { bg: "#1e3a2d", label: "Direkt" },
  manual: { bg: "#b08d3e", label: "Manuell" },
  ical: { bg: "#8b8578", label: "iCal" },
  sirvoy: { bg: "#4a6a8a", label: "Sirvoy" },
  channex: { bg: "#6b4a8a", label: "Bokningskanal" },
};
const WEEKDAYS = ["M", "T", "O", "T", "F", "L", "S"];

function CalendarPage() {
  const session = useSession();
  const { property, units } = useProperty(session);
  const [bookings, setBookings] = useState<CalendarBooking[]>([]);
  const [monthOffset, setMonthOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const inFlight = useRef<Promise<CalendarBooking[]> | null>(null);
  const requestController = useRef<AbortController | null>(null);
  const { monthStart, nextMonth, label } = useMemo(() => propertyMonth(monthOffset), [monthOffset]);
  const propertyId = property?.id;
  const load = useCallback(
    async (silent = false) => {
      if (!supabase || !propertyId) return;
      const client = supabase;
      const ticket = generation.current;
      if (silent && inFlight.current) return;
      if (!silent) {
        setLoading(true);
        setError("");
      }
      // Month changes wait for the previous request; background refreshes never queue.
      while (inFlight.current) {
        await inFlight.current.catch(() => undefined);
        if (ticket !== generation.current) return;
      }
      if (ticket !== generation.current) return;
      if (!silent) setLoading(true);
      const controller = new AbortController();
      requestController.current = controller;
      const request = fetchAllRows<CalendarBooking>((from, to) =>
        client
          .from("bookings")
          .select(
            "id, unit_id, guest_name, checkin_date, checkout_date, source, status, payment_status",
            { count: "exact" },
          )
          .eq("property_id", propertyId)
          .eq("status", "confirmed")
          .lt("checkin_date", nextMonth)
          .gt("checkout_date", monthStart)
          .order("checkin_date")
          .order("id")
          .range(from, to)
          .abortSignal(controller.signal),
      );
      inFlight.current = request;
      try {
        const data = await request;
        if (ticket === generation.current) {
          setBookings(data);
          setError("");
        }
      } catch (failure) {
        if (ticket === generation.current)
          setError(failure instanceof Error ? failure.message : "Kalendern kunde inte hämtas.");
      } finally {
        if (inFlight.current === request) inFlight.current = null;
        if (requestController.current === controller) requestController.current = null;
        if (ticket === generation.current) setLoading(false);
      }
    },
    [propertyId, monthStart, nextMonth],
  );
  useEffect(() => {
    const currentGeneration = generation;
    const activeController = requestController;
    const refreshVisible = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    void load();
    const timer = window.setInterval(refreshVisible, 60_000);
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      currentGeneration.current++;
      activeController.current?.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [load]);
  const conflicts = useMemo(() => bookingConflicts(bookings), [bookings]);

  if (!property) return null;
  return (
    <div className="mx-auto max-w-5xl space-y-5" data-private="true">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-[Fraunces] text-3xl font-semibold">Kalender</h1>
          <p className="mt-1 text-sm text-black/60">
            Öppna en bokning eller välj en ledig natt för att skapa en reservation.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMonthOffset((offset) => offset - 1)}
            className="grid h-10 w-10 place-items-center rounded-full border"
            aria-label="Föregående månad"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="w-36 text-center text-sm font-semibold capitalize">{label}</span>
          <button
            onClick={() => setMonthOffset((offset) => offset + 1)}
            className="grid h-10 w-10 place-items-center rounded-full border"
            aria-label="Nästa månad"
          >
            <ChevronRight size={16} />
          </button>
          <button
            onClick={() => setMonthOffset(0)}
            className="rounded-lg border px-3 py-2 text-xs font-semibold"
          >
            Denna månad
          </button>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="grid h-10 w-10 place-items-center rounded-full border disabled:opacity-40"
            aria-label="Uppdatera kalender"
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-black/60">
        {Object.entries(SOURCE_STYLE).map(([key, style]) => (
          <span key={key} className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm" style={{ background: style.bg }} />
            {style.label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-red-700" />
          Bokningskrock
        </span>
      </div>
      {loading ? (
        <p role="status" className="rounded-xl border bg-white p-5 text-sm">
          Hämtar kalendern…
        </p>
      ) : error ? (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700"
        >
          Kalendern kunde inte läsas: {error}. Uppdatera innan du bedömer tillgängligheten.
        </p>
      ) : units.length === 0 ? (
        <p className="text-sm text-black/60">Skapa boenden i Inställningar för att se kalendern.</p>
      ) : (
        units.map((unit) => (
          <UnitMonth
            key={unit.id}
            unit={unit}
            monthStart={monthStart}
            bookings={bookings.filter((booking) => booking.unit_id === unit.id)}
            conflicts={conflicts}
          />
        ))
      )}
      {!loading && !error && bookings.some((booking) => !booking.unit_id) && (
        <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
          Bokningar saknar kopplat boende och kan inte visas i kalendern.{" "}
          <Link to="/app/bokningar" className="font-semibold underline">
            Kontrollera bokningslistan
          </Link>
          .
        </p>
      )}
    </div>
  );
}

function UnitMonth({
  unit,
  monthStart,
  bookings,
  conflicts,
}: {
  unit: Unit;
  monthStart: string;
  bookings: CalendarBooking[];
  conflicts: Set<string>;
}) {
  const [year, month] = monthStart.split("-").map(Number);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const leadBlanks = (new Date(`${monthStart}T12:00:00Z`).getUTCDay() + 6) % 7;
  const today = propertyDay();
  const cells: (string | null)[] = [
    ...Array.from({ length: leadBlanks }, () => null),
    ...Array.from({ length: days }, (_, index) => shiftPropertyDay(monthStart, index)),
  ];
  return (
    <section className="card-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-bold">
          {unit.name}
          {!unit.active && (
            <span className="ml-2 text-xs font-normal text-black/50">Dolt från försäljning</span>
          )}
        </h2>
        <span className="text-xs text-black/50">
          {bookings.length} {bookings.length === 1 ? "bokning" : "bokningar"}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-xs font-semibold text-black/40">
        {WEEKDAYS.map((day, index) => (
          <div key={index}>{day}</div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((day, index) => {
          if (!day) return <div key={`blank-${index}`} />;
          const stays = bookings.filter(
            (booking) => day >= booking.checkin_date && day < booking.checkout_date,
          );
          const booking = stays[0];
          const conflict = stays.length > 1;
          const source = booking ? SOURCE_STYLE[booking.source] : null;
          const title = `${day}: ${stays.length ? stays.map((stay) => stay.guest_name ?? "Bokad").join(", ") : unit.active ? "Ledigt, skapa bokning" : "Dolt boende"}`;
          const content = (
            <>
              <span>{Number(day.slice(8))}</span>
              {booking && (
                <span className="w-full truncate text-[10px] font-semibold">
                  {conflict ? `${stays.length} bokningar` : (booking.guest_name ?? "Bokad")}
                </span>
              )}
            </>
          );
          const style = {
            background: conflict
              ? "#b91c1c"
              : (source?.bg ?? (day === today ? "#edf2ed" : "transparent")),
            color: booking ? "#fff" : "inherit",
          };
          const className =
            "flex h-14 min-w-0 flex-col items-center justify-center gap-0.5 rounded-md px-1 text-xs transition hover:ring-2 hover:ring-[#2d684c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2d684c]";
          if (!booking && !unit.active)
            return (
              <div key={day} title={title} className={className} style={style}>
                {content}
              </div>
            );
          return (
            <Link
              key={day}
              to="/app/bokningar"
              search={
                booking
                  ? { booking: booking.id }
                  : {
                      create: true,
                      unitId: unit.id,
                      checkin: day,
                      checkout: shiftPropertyDay(day, 1),
                    }
              }
              aria-label={title}
              title={title}
              className={className}
              style={style}
            >
              {content}
            </Link>
          );
        })}
      </div>
      {bookings.length > 0 && (
        <div className="mt-4 grid gap-2 border-t pt-3 sm:grid-cols-2">
          {bookings.map((booking) => (
            <Link
              key={booking.id}
              to="/app/bokningar"
              search={{ booking: booking.id }}
              className={`rounded-lg px-3 py-2 text-xs hover:bg-black/5 ${conflicts.has(booking.id) ? "bg-red-50 text-red-800" : "bg-[#f5f6f3]"}`}
            >
              <span className="font-semibold">{booking.guest_name ?? "Okänd gäst"}</span> ·{" "}
              {booking.checkin_date}–{booking.checkout_date}
              {conflicts.has(booking.id) && " · Krock"}
              {booking.payment_status === "pending" && " · Betalning väntar"}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

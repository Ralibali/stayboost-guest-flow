import { createFileRoute } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, useProperty, useSession, type Booking, type Unit } from "@/lib/supabase";

export const Route = createFileRoute("/app/kalender")({
  component: CalendarPage,
});

/* Källa → färg i kalendern (adminpaletten) */
const SOURCE_STYLE: Record<Booking["source"], { bg: string; label: string }> = {
  direct: { bg: "#1e3a2d", label: "Direkt" },
  manual: { bg: "#b08d3e", label: "Manuell" },
  ical: { bg: "#8b8578", label: "iCal" },
  sirvoy: { bg: "#4a6a8a", label: "Sirvoy" },
};

const WEEKDAYS = ["M", "T", "O", "T", "F", "L", "S"];
const isoOf = (d: Date) => d.toISOString().slice(0, 10);

function CalendarPage() {
  const session = useSession();
  const { property, units } = useProperty(session);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [monthOffset, setMonthOffset] = useState(0);

  const { monthStart, monthEnd, label } = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 0);
    return {
      monthStart: isoOf(start),
      monthEnd: isoOf(end),
      label: start.toLocaleDateString("sv-SE", { month: "long", year: "numeric" }),
    };
  }, [monthOffset]);

  const load = useCallback(async () => {
    if (!supabase || !property) return;
    const { data } = await supabase
      .from("bookings")
      .select("id, unit_id, guest_name, checkin_date, checkout_date, source, status")
      .eq("property_id", property.id)
      .eq("status", "confirmed")
      .lt("checkin_date", monthEnd + "T23:59:59")
      .gt("checkout_date", monthStart);
    setBookings((data as Booking[]) ?? []);
  }, [property, monthStart, monthEnd]);

  useEffect(() => {
    load();
  }, [load]);

  if (!property) return null;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex items-end justify-between">
        <h1 className="font-[Fraunces] text-3xl font-semibold">Kalender</h1>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMonthOffset((o) => o - 1)}
            className="grid h-9 w-9 place-items-center rounded-full ring-1 ring-[color:var(--line)] transition hover:ring-[color:var(--forest)]"
            aria-label="Föregående månad"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="w-36 text-center text-[14px] font-semibold capitalize">{label}</span>
          <button
            onClick={() => setMonthOffset((o) => o + 1)}
            className="grid h-9 w-9 place-items-center rounded-full ring-1 ring-[color:var(--line)] transition hover:ring-[color:var(--forest)]"
            aria-label="Nästa månad"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Teckenförklaring */}
      <div className="mt-3 flex flex-wrap gap-4 text-[12px] text-[color:var(--ink)]/60">
        {Object.entries(SOURCE_STYLE).map(([key, s]) => (
          <span key={key} className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm" style={{ background: s.bg }} />
            {s.label}
          </span>
        ))}
      </div>

      {units.length === 0 && (
        <p className="mt-8 text-[14px] text-[color:var(--ink)]/50">
          Skapa enheter i Inställningar för att se kalendern.
        </p>
      )}

      {units.map((unit) => (
        <UnitMonth
          key={unit.id}
          unit={unit}
          monthStart={monthStart}
          bookings={bookings.filter((b) => b.unit_id === unit.id)}
        />
      ))}
    </div>
  );
}

function UnitMonth({
  unit,
  monthStart,
  bookings,
}: {
  unit: Unit;
  monthStart: string;
  bookings: Booking[];
}) {
  const [y, m] = monthStart.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const leadBlanks = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  const today = isoOf(new Date());

  const cells: (string | null)[] = [
    ...Array.from({ length: leadBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => {
      const day = `${y}-${String(m).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`;
      return day;
    }),
  ];

  const bookingAt = (iso: string) =>
    bookings.find((b) => iso >= b.checkin_date && iso < b.checkout_date);

  return (
    <section className="card-surface mt-5 p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[15px] font-bold">{unit.name}</h2>
        <span className="text-[12px] text-[color:var(--ink)]/50">
          {bookings.length} {bookings.length === 1 ? "bokning" : "bokningar"}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase text-[color:var(--ink)]/40">
        {WEEKDAYS.map((d, i) => (
          <div key={i}>{d}</div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((iso, i) => {
          if (!iso) return <div key={`b${i}`} />;
          const b = bookingAt(iso);
          const style = b ? SOURCE_STYLE[b.source] : null;
          const isStart = b && b.checkin_date === iso;
          return (
            <div
              key={iso}
              title={b ? `${b.guest_name ?? "Bokad"} · ${SOURCE_STYLE[b.source].label}` : undefined}
              className="flex h-10 items-center justify-center rounded-md text-[12px]"
              style={{
                background: style
                  ? style.bg
                  : iso === today
                    ? "rgba(30,58,45,0.07)"
                    : "transparent",
                color: style ? "#fff" : "inherit",
                opacity: iso < today && !style ? 0.35 : 1,
              }}
            >
              {b && isStart ? (
                <span className="truncate px-1 text-[10px] font-semibold">
                  {b.guest_name ?? "Bokad"}
                </span>
              ) : (
                Number(iso.slice(8))
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

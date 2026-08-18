import { createFileRoute } from "@tanstack/react-router";
import { Bike, CalendarCheck, Coffee, LogIn, LogOut, RefreshCw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, useProperty, useSession } from "@/lib/supabase";

export const Route = createFileRoute("/app/dagsoversikt")({ component: DailyOpsPage });

type AddonRow = {
  quantity: number;
  addon: {
    id: string;
    name: string;
    price_type: string;
    service_timing: "arrival" | "each_stay_day" | "each_morning";
    fulfillment_note: string | null;
  } | null;
};

type BookingRow = {
  id: string;
  guest_name: string | null;
  guests: number | null;
  checkin_date: string;
  checkout_date: string;
  unit: { name: string } | null;
  booking_addons: AddonRow[];
};

type ServiceTask = {
  key: string;
  addonName: string;
  quantity: number;
  guestName: string;
  unitName: string;
  note: string | null;
};

const iso = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};
const niceDate = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString("sv-SE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

function serviceDue(row: BookingRow, addon: AddonRow["addon"], day: string) {
  if (!addon) return false;
  if (addon.service_timing === "each_morning") {
    return row.checkin_date < day && row.checkout_date >= day;
  }
  if (addon.service_timing === "each_stay_day") {
    return row.checkin_date <= day && row.checkout_date > day;
  }
  return row.checkin_date === day;
}

function DailyOpsPage() {
  const session = useSession();
  const { property } = useProperty(session);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const today = iso(new Date());
  const tomorrow = iso(addDays(new Date(), 1));

  const load = useCallback(async () => {
    if (!supabase || !property) return;
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from("bookings")
      .select(
        "id, guest_name, guests, checkin_date, checkout_date, unit:units(name), booking_addons(quantity, addon:addons(id,name,price_type,service_timing,fulfillment_note))",
      )
      .eq("property_id", property.id)
      .eq("status", "confirmed")
      .lte("checkin_date", tomorrow)
      .gte("checkout_date", today)
      .order("checkin_date");
    if (error) setError(error.message);
    setBookings((data as unknown as BookingRow[]) ?? []);
    setLoading(false);
  }, [property, today, tomorrow]);

  useEffect(() => {
    load();
  }, [load]);

  const dayData = useMemo(() => {
    const build = (day: string) => {
      const arrivals = bookings.filter((b) => b.checkin_date === day);
      const departures = bookings.filter((b) => b.checkout_date === day);
      const staying = bookings.filter((b) => b.checkin_date <= day && b.checkout_date > day);
      const services: ServiceTask[] = [];
      for (const booking of bookings) {
        for (const row of booking.booking_addons ?? []) {
          if (!serviceDue(booking, row.addon, day)) continue;
          services.push({
            key: `${booking.id}:${row.addon?.id}`,
            addonName: row.addon?.name ?? "Tillval",
            quantity: row.quantity,
            guestName: booking.guest_name ?? "Okänd gäst",
            unitName: booking.unit?.name ?? "Ingen enhet",
            note: row.addon?.fulfillment_note ?? null,
          });
        }
      }
      return { day, arrivals, departures, staying, services };
    };
    return [build(today), build(tomorrow)];
  }, [bookings, today, tomorrow]);

  if (!property) return null;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Drift utan reception</p>
          <h1 className="mt-2 font-[Fraunces] text-3xl font-semibold">Dagsöversikt</h1>
          <p className="mt-1 text-[14px] text-[color:var(--ink)]/55">
            Det som faktiskt behöver göras i dag och i morgon — ankomster, städ, frukost, cyklar och andra tillval.
          </p>
        </div>
        <button onClick={load} disabled={loading} className="btn-ghost !rounded-xl !px-4 !py-2.5 text-[13px] disabled:opacity-50">
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} /> Uppdatera
        </button>
      </div>

      {error && <p className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-[13px] text-red-700">{error}</p>}

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        {dayData.map((data, index) => (
          <section key={data.day} className="card-surface overflow-hidden">
            <header className="border-b border-[color:var(--line)] px-5 py-5">
              <p className="eyebrow">{index === 0 ? "I dag" : "I morgon"}</p>
              <h2 className="mt-1 font-[Fraunces] text-2xl font-semibold capitalize">{niceDate(data.day)}</h2>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <Mini icon={LogIn} label="Ankomster" value={data.arrivals.length} />
                <Mini icon={LogOut} label="Städ/avresa" value={data.departures.length} />
                <Mini icon={CalendarCheck} label="Boende" value={data.staying.length} />
              </div>
            </header>

            <div className="px-5 py-5">
              <h3 className="flex items-center gap-2 text-[13px] font-bold"><Sparkles size={15} /> Att förbereda</h3>
              {loading ? (
                <p className="mt-4 text-[13px] text-[color:var(--ink)]/45">Laddar…</p>
              ) : data.services.length === 0 ? (
                <p className="mt-4 rounded-xl bg-[color:var(--bg)] px-4 py-4 text-[13px] text-[color:var(--ink)]/50">Inga bokade tillval behöver förberedas.</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {data.services.map((task) => {
                    const lower = task.addonName.toLowerCase();
                    const Icon = lower.includes("cykel") || lower.includes("bike") ? Bike : lower.includes("frukost") || lower.includes("breakfast") ? Coffee : Sparkles;
                    return (
                      <div key={task.key} className="rounded-xl border border-[color:var(--line)] bg-white px-4 py-3">
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[color:var(--bg)]"><Icon size={15} /></span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3">
                              <p className="text-[14px] font-semibold">{task.addonName}</p>
                              <span className="rounded-full bg-[color:var(--forest)] px-2.5 py-1 text-[11px] font-bold text-white">× {task.quantity}</span>
                            </div>
                            <p className="mt-1 text-[12px] text-[color:var(--ink)]/55">{task.guestName} · {task.unitName}</p>
                            {task.note && <p className="mt-1.5 text-[12px] font-medium text-[color:var(--brass)]">{task.note}</p>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="border-t border-[color:var(--line)] px-5 py-5">
              <h3 className="text-[13px] font-bold">Ankomst & städ</h3>
              <div className="mt-3 space-y-2 text-[13px]">
                {data.departures.map((b) => <p key={`out-${b.id}`}>Städa <strong>{b.unit?.name ?? "boendet"}</strong> efter {b.guest_name ?? "gäst"}</p>)}
                {data.arrivals.map((b) => <p key={`in-${b.id}`}>Gör <strong>{b.unit?.name ?? "boendet"}</strong> klart för {b.guest_name ?? "gäst"} · {b.guests ?? "?"} gäster</p>)}
                {!data.departures.length && !data.arrivals.length && <p className="text-[color:var(--ink)]/45">Inga byten den här dagen.</p>}
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function Mini({ icon: Icon, label, value }: { icon: typeof LogIn; label: string; value: number }) {
  return (
    <div className="rounded-xl bg-[color:var(--bg)] px-3 py-3">
      <div className="flex items-center gap-1.5 text-[color:var(--ink)]/45"><Icon size={13} /><span className="text-[10px] font-semibold uppercase tracking-wide">{label}</span></div>
      <p className="mt-1 font-[Fraunces] text-xl font-semibold">{value}</p>
    </div>
  );
}

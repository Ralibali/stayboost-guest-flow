import { dateKey, minAvailablePrice } from "@/lib/booking-data";

const WEEKDAYS = ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"];

/** Månadskalender med lägsta nattpris per dag — används i bokningsflödet och Min sida. */
export function MonthGrid({
  base,
  today,
  checkIn,
  checkOut,
  onPick,
}: {
  base: Date;
  today: Date;
  checkIn: Date | null;
  checkOut: Date | null;
  onPick: (d: Date) => void;
}) {
  const year = base.getFullYear();
  const month = base.getMonth();
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadBlanks = (first.getDay() + 6) % 7; // måndag = 0

  const cells: (Date | null)[] = [
    ...Array.from({ length: leadBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
  ];

  return (
    <div>
      <div className="mb-2 text-center text-[13px] font-bold capitalize">
        {base.toLocaleDateString("sv-SE", { month: "long", year: "numeric" })}
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-[color:var(--ink)]/45">
        {WEEKDAYS.map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (!d) return <div key={`b${i}`} />;
          const past = d < today;
          const price = past ? null : minAvailablePrice(d);
          const full = !past && price === null;
          const isStart = checkIn && dateKey(d) === dateKey(checkIn);
          const isEnd = checkOut && dateKey(d) === dateKey(checkOut);
          const inRange = checkIn && checkOut && d > checkIn && d < checkOut;
          return (
            <button
              key={dateKey(d)}
              disabled={past || full}
              onClick={() => onPick(d)}
              className={`flex min-h-[52px] flex-col items-center justify-center rounded-xl px-0.5 py-1 transition ${
                isStart || isEnd
                  ? "bg-[color:var(--forest)] text-white"
                  : inRange
                    ? "bg-[color:var(--brass)]/20"
                    : past || full
                      ? "opacity-40"
                      : "hover:bg-[color:var(--brass)]/15"
              }`}
            >
              <span className={`text-[13px] font-semibold ${isStart || isEnd ? "text-white" : ""}`}>
                {d.getDate()}
              </span>
              {!past && (
                <span
                  className={`text-[9px] leading-tight ${
                    isStart || isEnd
                      ? "text-white/85"
                      : full
                        ? "font-semibold text-red-500"
                        : "text-[color:var(--ink)]/50"
                  }`}
                >
                  {full ? "Fullt" : price!.toLocaleString("sv-SE")}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

import { Check, Minus, X } from "lucide-react";
import { useStayBoostStats } from "@/hooks/useStayBoostStats";
import { formatInt, formatSek } from "@/lib/stats";

type Cell = "ja" | "nej" | "delvis";

const ROWS: { label: string; stayboost: Cell; bookspot: Cell; sirvoy: Cell }[] = [
  { label: "Provisionsfri bokningsmotor", stayboost: "ja", bookspot: "delvis", sirvoy: "delvis" },
  { label: "Automatisk merförsäljning via sms", stayboost: "ja", bookspot: "nej", sirvoy: "nej" },
  {
    label: "Presentkort, paket & ombokningsgaranti",
    stayboost: "ja",
    bookspot: "ja",
    sirvoy: "delvis",
  },
  { label: "Min sida — gästen bokar om själv", stayboost: "ja", bookspot: "ja", sirvoy: "delvis" },
  {
    label: "Partnermarknadsplats med provision",
    stayboost: "ja",
    bookspot: "delvis",
    sirvoy: "nej",
  },
  {
    label: "Direktbokningssida utan provision (inbäddningsbar)",
    stayboost: "ja",
    bookspot: "delvis",
    sirvoy: "delvis",
  },
  {
    label: "Kanalhanterare (Booking.com, Airbnb)",
    stayboost: "ja",
    bookspot: "delvis",
    sirvoy: "ja",
  },
  {
    label: "Frukost, städ & dagsöversikt för teamet",
    stayboost: "ja",
    bookspot: "delvis",
    sirvoy: "nej",
  },
  { label: "Digital incheckning med portkod", stayboost: "ja", bookspot: "nej", sirvoy: "delvis" },
  { label: "Gästregister (CRM)", stayboost: "ja", bookspot: "delvis", sirvoy: "delvis" },
  {
    label: "Byggd för små boenden (1–15 enheter)",
    stayboost: "ja",
    bookspot: "delvis",
    sirvoy: "delvis",
  },
];

function CellIcon({ v }: { v: Cell }) {
  if (v === "ja")
    return (
      <span className="mx-auto grid h-6 w-6 place-items-center rounded-full bg-[color:var(--success)]/15">
        <Check size={14} strokeWidth={3} className="text-[color:var(--success)]" />
      </span>
    );
  if (v === "delvis")
    return (
      <span className="mx-auto grid h-6 w-6 place-items-center rounded-full bg-amber-100">
        <Minus size={14} strokeWidth={3} className="text-amber-700" />
      </span>
    );
  return (
    <span className="mx-auto grid h-6 w-6 place-items-center rounded-full bg-red-50">
      <X size={14} strokeWidth={3} className="text-red-400" />
    </span>
  );
}

export function Comparison() {
  const { stats } = useStayBoostStats();
  const perBooking =
    stats.bookings2026 > 0 ? Math.round(stats.paidAddonRevenueSek / stats.bookings2026) : 0;
  const monthsCovered = Math.max(1, Math.floor(stats.paidAddonRevenueSek / 449));
  return (
    <section className="border-t border-[color:var(--line)] bg-white/50 py-16 sm:py-14 sm:py-20 md:py-28">
      <div className="mx-auto max-w-[920px] px-5 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="eyebrow">Ärlig jämförelse</p>
          <h2
            className="mt-3 tracking-tight"
            style={{ fontSize: "clamp(1.75rem, 6vw, 3rem)", lineHeight: 1.1 }}
          >
            Allt BookSpot och Sirvoy gör — plus det de saknar.
          </h2>
          <p className="mt-4 text-[0.975rem] leading-relaxed text-[color:var(--ink)]/75 sm:text-base">
            De byggde för aktivitetsföretag och stora hotell. Vi byggde för dig med ett fåtal
            enheter — och lade till delarna som de aldrig hann med: merförsäljningen och teamvyerna.
          </p>
          <p className="mt-5 text-[0.975rem] font-semibold leading-relaxed text-[color:var(--ink)] sm:text-base">
            Och mot marknadsplatserna är skillnaden ännu enklare: de tar provision på varje gäst de
            skickar.{" "}
            <span className="text-[color:var(--brass)]">
              Vi tar 449 kr i månaden — dina gäster är dina.
            </span>
          </p>
        </div>

        <div className="card-surface mt-10 overflow-hidden !p-0">
          <table className="w-full table-fixed text-[12px] sm:text-[14px]">
            <thead>
              <tr className="border-b border-[color:var(--line)]">
                <th className="p-2 text-left font-sans font-bold sm:p-4">Funktion</th>
                <th className="w-[72px] bg-[color:var(--forest)] p-2 text-center sm:w-[110px] sm:p-4">
                  <span className="font-[Fraunces] text-[12px] font-semibold leading-tight text-white sm:text-base">
                    StayBoost
                  </span>
                </th>
                <th className="w-[62px] p-2 text-center font-sans text-[11px] font-bold leading-tight text-[color:var(--ink)]/55 sm:w-[110px] sm:p-4 sm:text-[14px]">
                  BookSpot
                </th>
                <th className="w-[62px] p-2 text-center font-sans text-[11px] font-bold leading-tight text-[color:var(--ink)]/55 sm:w-[110px] sm:p-4 sm:text-[14px]">
                  Sirvoy
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r, i) => (
                <tr key={r.label} className={i % 2 === 0 ? "bg-[color:var(--bg)]/40" : ""}>
                  <td className="p-2 font-medium text-[color:var(--ink)]/85 sm:p-4">{r.label}</td>
                  <td className="bg-[color:var(--forest)]/[0.04] p-2 text-center sm:p-4">
                    <CellIcon v={r.stayboost} />
                  </td>
                  <td className="p-2 text-center sm:p-4">
                    <CellIcon v={r.bookspot} />
                  </td>
                  <td className="p-2 text-center sm:p-4">
                    <CellIcon v={r.sirvoy} />
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-[color:var(--line)]">
                <td className="p-2 font-bold sm:p-4">Pris</td>
                <td className="bg-[color:var(--forest)]/[0.04] p-2 text-center sm:p-4">
                  <span className="font-[Fraunces] text-base font-semibold text-[color:var(--forest)] sm:text-lg">
                    449 kr/mån
                  </span>
                </td>
                <td className="p-2 text-center text-[color:var(--ink)]/55 sm:p-4">
                  fr. ~1 000 kr/mån*
                </td>
                <td className="p-2 text-center text-[color:var(--ink)]/55 sm:p-4">
                  fr. ~150 kr/mån**
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="card-surface mt-6 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
          <div>
            <p className="text-[0.68rem] font-medium uppercase tracking-[0.14em] text-[color:var(--ink)]/45">
              Konkret exempel — live från piloten
            </p>
            <p className="mt-2 text-[0.95rem] leading-relaxed text-[color:var(--ink)]/80">
              <strong className="font-semibold text-[color:var(--ink)]">
                {formatSek(perBooking)} i snitt per bokning
              </strong>{" "}
              i rena tillvalsintäkter × {formatInt(stats.bookings2026)} bokningar ={" "}
              <strong className="font-semibold text-[color:var(--ink)]">
                {formatSek(stats.paidAddonRevenueSek)}
              </strong>{" "}
              extra. På ren automatik, utan en enda extra arbetsminut.
            </p>
          </div>
          <p className="rounded-xl bg-[color:var(--forest)]/[0.06] px-4 py-3 text-center text-[0.85rem] font-medium leading-snug text-[color:var(--forest)]">
            ≈ {formatInt(monthsCovered)} månaders
            <br />
            StayBoost-abonnemang
          </p>
        </div>

        <p className="mt-4 text-center text-[12px] leading-relaxed text-[color:var(--ink)]/50">
          *BookSpot riktar sig till större aktivitetsbolag med pris efter volym. **Sirvoy är en
          kanalhanterare — tillval, teamvyer och gästflöden ingår inte. Jämförelsen bygger på
          publika funktionslistor, juli 2026.
        </p>
      </div>
    </section>
  );
}

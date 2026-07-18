import { Check, Minus, X } from "lucide-react";

type Cell = "ja" | "nej" | "delvis";

const ROWS: { label: string; stayboost: Cell; bookspot: Cell; sirvoy: Cell }[] = [
  { label: "Provisionsfri bokningsmotor", stayboost: "ja", bookspot: "delvis", sirvoy: "delvis" },
  { label: "Automatisk merförsäljning via SMS", stayboost: "ja", bookspot: "nej", sirvoy: "nej" },
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
    label: "Kanalhanterare (Booking.com, Airbnb)",
    stayboost: "ja",
    bookspot: "delvis",
    sirvoy: "ja",
  },
  {
    label: "Frukost-, städ- & manifestvyer för teamet",
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
  return (
    <section className="border-t border-[color:var(--line)] bg-white/50 py-16 sm:py-20 md:py-28">
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
            enheter — och lade till laget de aldrig hann med: merförsäljningen och teamvyerna.
          </p>
        </div>

        <div className="card-surface mt-10 overflow-hidden !p-0">
          <table className="w-full text-[13px] sm:text-[14px]">
            <thead>
              <tr className="border-b border-[color:var(--line)]">
                <th className="p-4 text-left font-sans font-bold">Funktion</th>
                <th className="w-[72px] bg-[color:var(--forest)] p-4 text-center sm:w-[110px]">
                  <span className="font-[Fraunces] text-[15px] font-semibold text-white sm:text-base">
                    StayBoost
                  </span>
                </th>
                <th className="w-[72px] p-4 text-center font-sans font-bold text-[color:var(--ink)]/55 sm:w-[110px]">
                  BookSpot
                </th>
                <th className="w-[72px] p-4 text-center font-sans font-bold text-[color:var(--ink)]/55 sm:w-[110px]">
                  Sirvoy
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r, i) => (
                <tr key={r.label} className={i % 2 === 0 ? "bg-[color:var(--bg)]/40" : ""}>
                  <td className="p-4 font-medium text-[color:var(--ink)]/85">{r.label}</td>
                  <td className="bg-[color:var(--forest)]/[0.04] p-4 text-center">
                    <CellIcon v={r.stayboost} />
                  </td>
                  <td className="p-4 text-center">
                    <CellIcon v={r.bookspot} />
                  </td>
                  <td className="p-4 text-center">
                    <CellIcon v={r.sirvoy} />
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-[color:var(--line)]">
                <td className="p-4 font-bold">Pris</td>
                <td className="bg-[color:var(--forest)]/[0.04] p-4 text-center">
                  <span className="font-[Fraunces] text-lg font-semibold text-[color:var(--forest)]">
                    449 kr/mån
                  </span>
                </td>
                <td className="p-4 text-center text-[color:var(--ink)]/55">fr. ~1 000 kr/mån*</td>
                <td className="p-4 text-center text-[color:var(--ink)]/55">fr. ~150 kr/mån**</td>
              </tr>
            </tbody>
          </table>
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

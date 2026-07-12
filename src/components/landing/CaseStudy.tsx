import { motion } from "framer-motion";

const HEADLINE_STATS = [
  { value: "120", label: "bokningar" },
  { value: "117", label: "unika gäster" },
  { value: "147", label: "gästnätter" },
  { value: "252 632 kr", label: "bokningsvärde" },
];

const OPS_STATS = [
  { value: "62", label: "digitala incheckningar" },
  { value: "51 / 54", label: "förankomst-SMS skickade" },
  { value: "17 / 17", label: "frukostleveranser genomförda" },
  { value: "34 / 40", label: "SMS levererade från outbox" },
];

const ENGAGEMENT_STATS = [
  { value: "12 214", label: "sidvisningar" },
  { value: "8 144", label: "sessioner" },
  { value: "8 514", label: "klickhändelser" },
];

const ADDONS = [
  { name: "Frukost", orders: "11 ordrar · 29 st", revenue: 6041 },
  { name: "Sen utcheckning (12:00)", orders: "3 ordrar", revenue: 1200 },
  { name: "SUP-uthyrning", orders: "4 ordrar · 5 st", revenue: 500 },
  { name: "Tidig incheckning (12:00)", orders: "1 order", revenue: 399 },
  { name: "Fikapåse", orders: "1 order · 2 st", revenue: 178 },
];

const TOTAL_PAID_REVENUE = 8318;

function formatKr(n: number) {
  return n.toLocaleString("sv-SE").replace(/,/g, " ");
}

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-[color:var(--line)] bg-white p-5">
      <div
        className="font-[Fraunces] font-semibold text-[color:var(--ink)]"
        style={{ fontSize: "clamp(1.6rem, 3vw, 2.1rem)", lineHeight: 1.05 }}
      >
        {value}
      </div>
      <div className="mt-1 text-[0.85rem] text-[color:var(--ink)]/60">{label}</div>
    </div>
  );
}

export function CaseStudy() {
  const maxRevenue = Math.max(...ADDONS.map((a) => a.revenue));

  return (
    <section
      id="case-study"
      className="border-t border-[color:var(--line)] bg-[color:var(--bg)] py-20 md:py-32"
      aria-labelledby="case-study-heading"
    >
      <div className="mx-auto max-w-[1120px] px-6">
        <div className="max-w-3xl">
          <p className="eyebrow">Bevisat i skarp drift</p>
          <h2
            id="case-study-heading"
            className="mt-3"
            style={{ fontSize: "clamp(2rem, 4vw, 3rem)" }}
          >
            Riktiga siffror från en riktig anläggning.
          </h2>
          <p className="mt-3 text-sm font-semibold uppercase tracking-[0.16em] text-[color:var(--brass)]">
            Göta Kanal Glamping · 2026 hittills
          </p>
          <p className="mt-5 max-w-2xl text-[color:var(--ink)]/75">
            StayBoost är byggt ovanpå en befintlig glampingverksamhet vid Göta kanal.
            Siffrorna nedan är verklig drift — samma system, samma gäster, samma
            säsong. Inget påhittat, inga marknadsföringsantaganden.
          </p>
        </div>

        {/* Headline stats */}
        <div className="mt-12 grid gap-4 sm:grid-cols-2 md:grid-cols-4">
          {HEADLINE_STATS.map((s) => (
            <StatCard key={s.label} {...s} />
          ))}
        </div>

        {/* Addon breakdown */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5 }}
          className="mt-10 grid gap-6 rounded-3xl border border-[color:var(--line)] bg-white p-8 md:grid-cols-[1fr_1.2fr] md:p-10"
        >
          <div>
            <p className="eyebrow">Merförsäljning</p>
            <h3
              className="mt-3"
              style={{ fontSize: "clamp(1.5rem, 2.5vw, 2rem)" }}
            >
              8 318 kr i betalda tillval
            </h3>
            <p className="mt-4 text-[color:var(--ink)]/75">
              20 betalda tillvalsordrar av 22 totalt, ett snittköp på{" "}
              <strong className="text-[color:var(--ink)]">416 kr</strong>.
            </p>
            <ul className="mt-5 space-y-2 text-sm text-[color:var(--ink)]/75">
              <li>
                <strong className="text-[color:var(--ink)]">≈ 69 %</strong> av den
                betalda merförsäljningen kom från frukost — observerat i denna
                drift, inte ett generellt löfte.
              </li>
              <li>
                <strong className="text-[color:var(--ink)]">≈ 16,7 %</strong> av
                bokningarna gav ett betalt tillvalsköp (20 / 120) — observerat i
                denna drift, inte en garanti.
              </li>
            </ul>
          </div>

          <div>
            <div className="space-y-4">
              {ADDONS.map((a) => {
                const pct = (a.revenue / maxRevenue) * 100;
                return (
                  <div key={a.name}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-[color:var(--ink)]">
                          {a.name}
                        </div>
                        <div className="text-xs text-[color:var(--ink)]/55">
                          {a.orders}
                        </div>
                      </div>
                      <div className="shrink-0 font-[Fraunces] font-semibold tabular-nums text-[color:var(--brass)]">
                        {formatKr(a.revenue)} kr
                      </div>
                    </div>
                    <div
                      className="mt-2 h-2 overflow-hidden rounded-full bg-[color:var(--line)]"
                      role="presentation"
                    >
                      <motion.div
                        initial={{ width: 0 }}
                        whileInView={{ width: `${pct}%` }}
                        viewport={{ once: true, margin: "-40px" }}
                        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                        className="h-full rounded-full bg-[color:var(--brass)]"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-6 text-xs text-[color:var(--ink)]/55">
              Summan av betalda tillval: {formatKr(TOTAL_PAID_REVENUE)} kr. Belopp
              avrundade från källdata.
            </p>
          </div>
        </motion.div>

        {/* Ops + engagement */}
        <div className="mt-10 grid gap-8 md:grid-cols-2">
          <div>
            <p className="eyebrow">Drift som sköter sig själv</p>
            <h3 className="mt-3 text-xl">Meddelanden, incheckning och frukost</h3>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {OPS_STATS.map((s) => (
                <StatCard key={s.label} {...s} />
              ))}
            </div>
          </div>
          <div>
            <p className="eyebrow">Gästaktivitet</p>
            <h3 className="mt-3 text-xl">Trafik i gästhubben</h3>
            <div className="mt-5 grid gap-4 sm:grid-cols-3">
              {ENGAGEMENT_STATS.map((s) => (
                <StatCard key={s.label} {...s} />
              ))}
            </div>
          </div>
        </div>

        <p className="mt-10 max-w-3xl text-xs leading-relaxed text-[color:var(--ink)]/55">
          Källa: aggregerad driftstatistik från Göta Kanal Glamping för säsongen
          2026 fram till idag. Ingen gäst-, personal- eller betalningsdata visas.
          StayBoost är i pilotdrift — siffrorna beskriver hur systemet fungerar
          på den här anläggningen och är inte ett löfte om samma resultat för
          andra boenden.
        </p>
      </div>
    </section>
  );
}

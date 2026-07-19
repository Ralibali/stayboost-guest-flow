import { motion } from "framer-motion";
import { useStayBoostStats, type StatsSource } from "@/hooks/useStayBoostStats";
import {
  computeDerived,
  formatInt,
  formatPercent,
  formatSek,
  formatUpdatedAt,
  type StayBoostStats,
} from "@/lib/stats";

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-[color:var(--line)] bg-white p-5">
      <div
        className="font-[Fraunces] font-semibold text-[color:var(--ink)] tabular-nums"
        style={{ fontSize: "clamp(1.6rem, 3vw, 2.1rem)", lineHeight: 1.05 }}
      >
        {value}
      </div>
      <div className="mt-1 text-[0.85rem] text-[color:var(--ink)]/60">{label}</div>
    </div>
  );
}

function StatusPill({ source }: { source: StatsSource }) {
  const label =
    source === "live"
      ? "Live från Göta Kanal Glamping"
      : source === "cache"
        ? "Senast kända siffror från Göta Kanal Glamping"
        : "Verifierade siffror från Göta Kanal Glamping";
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-[color:var(--brass)]/40 bg-[color:var(--brass)]/10 px-3 py-1 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-[color:var(--brass)]">
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${
          source === "live" ? "bg-[color:var(--brass)] animate-pulse" : "bg-[color:var(--brass)]/60"
        }`}
        aria-hidden
      />
      {label}
    </span>
  );
}

function buildHeadlineStats(stats: StayBoostStats) {
  return [
    { value: formatInt(stats.bookings2026), label: "bokningar" },
    { value: formatInt(stats.uniqueGuests), label: "unika gäster" },
    { value: formatInt(stats.guestNights), label: "gästnätter" },
    { value: formatSek(stats.bookingValueSek), label: "bokningsvärde" },
  ];
}

function buildOpsStats(stats: StayBoostStats) {
  return [
    { value: formatInt(stats.digitalCheckIns), label: "digitala incheckningar" },
    {
      value: `${formatInt(stats.prearrivalMessages.sent)} / ${formatInt(stats.prearrivalMessages.total)}`,
      label: "sms före ankomst",
    },
    {
      value: `${formatInt(stats.breakfastDeliveries.done)} / ${formatInt(stats.breakfastDeliveries.total)}`,
      label: "frukostleveranser genomförda",
    },
    {
      value: `${formatInt(stats.sms.sent)} / ${formatInt(stats.sms.total)}`,
      label: "Sms levererade från utkorgen",
    },
  ];
}

function buildEngagementStats(stats: StayBoostStats) {
  return [
    { value: formatInt(stats.traffic.pageViews), label: "sidvisningar" },
    { value: formatInt(stats.traffic.sessions), label: "sessioner" },
    { value: formatInt(stats.traffic.clickEvents), label: "klickhändelser" },
  ];
}

function formatAddonSubtitle(orders: number, units: number): string {
  const orderLabel = orders === 1 ? "order" : "ordrar";
  if (units > orders) return `${orders} ${orderLabel} · ${units} st`;
  return `${orders} ${orderLabel}`;
}

export function CaseStudy() {
  const { stats, source, updatedAt } = useStayBoostStats();
  const derived = computeDerived(stats);

  const headlineStats = buildHeadlineStats(stats);
  const opsStats = buildOpsStats(stats);
  const engagementStats = buildEngagementStats(stats);

  return (
    <section
      id="case-study"
      className="border-t border-[color:var(--line)] bg-[color:var(--bg)] py-14 sm:py-20 md:py-32"
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
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <StatusPill source={source} />
            <p className="text-xs text-[color:var(--ink)]/55">
              Senast uppdaterad {formatUpdatedAt(updatedAt)}
            </p>
          </div>
          <p className="mt-5 max-w-2xl text-[color:var(--ink)]/75">
            StayBoost är byggt ovanpå en befintlig glampingverksamhet vid Göta kanal. Siffrorna
            nedan är verklig drift — samma system, samma gäster, samma säsong. Inget påhittat, inga
            marknadsföringsantaganden.
          </p>
        </div>

        {/* Headline stats */}
        <div className="mt-12 grid gap-4 sm:grid-cols-2 md:grid-cols-4">
          {headlineStats.map((s) => (
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
            <h3 className="mt-3 tabular-nums" style={{ fontSize: "clamp(1.5rem, 2.5vw, 2rem)" }}>
              {formatSek(stats.paidAddonRevenueSek)} i betalda tillval
            </h3>
            <p className="mt-4 text-[color:var(--ink)]/75">
              {formatInt(stats.paidAddonOrders)} betalda tillvalsordrar, ett snittköp på{" "}
              <strong className="text-[color:var(--ink)] tabular-nums">
                {formatSek(derived.avgPaidAddonSek)}
              </strong>
              .
            </p>
            <ul className="mt-5 space-y-2 text-sm text-[color:var(--ink)]/75">
              <li>
                <strong className="text-[color:var(--ink)] tabular-nums">
                  ≈ {formatPercent(derived.breakfastShareOfAddons)}
                </strong>{" "}
                av den betalda merförsäljningen kom från frukost — observerat i denna drift, inte
                ett generellt löfte.
              </li>
              <li>
                <strong className="text-[color:var(--ink)] tabular-nums">
                  ≈ {formatPercent(derived.addonShareOfBookings)}
                </strong>{" "}
                av bokningarna gav ett betalt tillvalsköp ({formatInt(stats.paidAddonOrders)} /{" "}
                {formatInt(stats.bookings2026)}) — observerat i denna drift, inte en garanti.
              </li>
            </ul>
          </div>

          <div>
            <div className="space-y-4">
              {stats.addonDistribution.map((a) => {
                const pct = (a.revenue / derived.maxAddonRevenue) * 100;
                return (
                  <div key={a.slug}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-[color:var(--ink)]">
                          {a.name}
                        </div>
                        <div className="text-xs text-[color:var(--ink)]/55 tabular-nums">
                          {formatAddonSubtitle(a.orders, a.units)}
                        </div>
                      </div>
                      <div className="shrink-0 font-[Fraunces] font-semibold tabular-nums text-[color:var(--brass)]">
                        {formatSek(a.revenue)}
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
            <p className="mt-6 text-xs text-[color:var(--ink)]/55 tabular-nums">
              Summan av betalda tillval: {formatSek(stats.paidAddonRevenueSek)}. Belopp avrundade
              från källdata.
            </p>
          </div>
        </motion.div>

        {/* Ops + engagement */}
        <div className="mt-10 grid gap-8 md:grid-cols-2">
          <div>
            <p className="eyebrow">Drift som sköter sig själv</p>
            <h3 className="mt-3 text-xl">Meddelanden, incheckning och frukost</h3>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {opsStats.map((s) => (
                <StatCard key={s.label} {...s} />
              ))}
            </div>
          </div>
          <div>
            <p className="eyebrow">Gästaktivitet</p>
            <h3 className="mt-3 text-xl">Trafik i gästhubben</h3>
            <div className="mt-5 grid gap-4 sm:grid-cols-3">
              {engagementStats.map((s) => (
                <StatCard key={s.label} {...s} />
              ))}
            </div>
          </div>
        </div>

        <p className="mt-10 max-w-3xl text-xs leading-relaxed text-[color:var(--ink)]/55">
          Källa: aggregerad driftstatistik från Göta Kanal Glamping för säsongen 2026 fram till i
          dag. Ingen gäst-, personal- eller betalningsdata visas. StayBoost är i pilotdrift —
          siffrorna beskriver hur systemet fungerar på den här anläggningen och är inte ett löfte om
          samma resultat för andra boenden.
        </p>
      </div>
    </section>
  );
}

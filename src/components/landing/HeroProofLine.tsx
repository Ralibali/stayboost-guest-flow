import { useStayBoostStats } from "@/hooks/useStayBoostStats";
import { formatInt, formatSek } from "@/lib/stats";

/**
 * Hero-bevisrad. Delar `useStayBoostStats` med CaseStudy — TanStack Query
 * dedupliserar samma queryKey, så det blir ett enda nätverksanrop per session.
 */
export function HeroProofLine() {
  const { stats } = useStayBoostStats();
  return (
    <a
      href="#case-study"
      className="underline underline-offset-2 tabular-nums"
    >
      {formatSek(stats.paidAddonRevenueSek)} i tillvalsintäkter på{" "}
      {formatInt(stats.bookings2026)} bokningar denna säsong →
    </a>
  );
}

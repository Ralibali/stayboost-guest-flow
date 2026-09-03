import { FALLBACK_STATS, type StayBoostStats } from "@/lib/stats";

export type StatsSource = "export";

export interface UseStayBoostStatsResult {
  stats: StayBoostStats;
  source: StatsSource;
  /** Tidpunkten bakom datan — ISO-sträng från API:t eller fallback. */
  updatedAt: string;
  isFetching: boolean;
}

/**
 * Marknadssidan använder den verifierade Sirvoy-exporten som fast källa.
 * Drift-endpointen innehåller bara en delmängd av tillvalen och får därför
 * inte skriva över exportens totalsiffror efter sidladdning.
 */
export function useStayBoostStats(): UseStayBoostStatsResult {
  return {
    stats: FALLBACK_STATS,
    source: "export",
    updatedAt: FALLBACK_STATS.updatedAt,
    isFetching: false,
  };
}

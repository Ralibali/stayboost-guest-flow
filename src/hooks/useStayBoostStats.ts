import { useQuery } from "@tanstack/react-query";

import {
  FALLBACK_STATS,
  SIRVOY_EXPORT_STATS,
  STATS_REFRESH_MS,
  fetchStayBoostStats,
  mergeStats,
  writeCachedStats,
  type StayBoostStats,
} from "@/lib/stats";

export type StatsSource = "combined" | "export";

export interface UseStayBoostStatsResult {
  stats: StayBoostStats;
  source: StatsSource;
  /** Tidpunkten bakom datan — ISO-sträng från API:t eller senaste ögonblicksbild. */
  updatedAt: string;
  isFetching: boolean;
}

/**
 * Totalsiffror = verifierad Sirvoy-export + StayBoosts egen drift (Göta kanal-admin).
 * Live-driften hämtas från stats-endpointen och summeras ovanpå exporten.
 * Utan svar används den senaste cachade/inbakade driftsiffran, så totalerna står kvar.
 */
export function useStayBoostStats(): UseStayBoostStatsResult {
  const query = useQuery({
    queryKey: ["stayboost-stats"],
    queryFn: async ({ signal }) => {
      const live = await fetchStayBoostStats(signal);
      writeCachedStats(live);
      return live;
    },
    staleTime: STATS_REFRESH_MS,
    refetchInterval: STATS_REFRESH_MS,
    retry: 1,
  });

  const live = query.data ?? null;
  if (!live) {
    return {
      stats: FALLBACK_STATS,
      source: "combined",
      updatedAt: FALLBACK_STATS.updatedAt,
      isFetching: query.isFetching,
    };
  }

  const stats = mergeStats(SIRVOY_EXPORT_STATS, live);
  return {
    stats,
    source: "combined",
    updatedAt: stats.updatedAt,
    isFetching: query.isFetching,
  };
}

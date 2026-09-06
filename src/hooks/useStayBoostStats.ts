import { useQuery } from "@tanstack/react-query";

import { getStayBoostStats } from "@/lib/stats.functions";
import {
  FALLBACK_STATS,
  SIRVOY_EXPORT_STATS,
  STATS_REFRESH_MS,
  mergeStats,
  readCachedStats,
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
 * Live-driften hämtas same-origin (server proxy) och summeras ovanpå exporten.
 * Utan svar används den senaste cachade/inbakade driftsiffran, så totalerna står kvar.
 */
export function useStayBoostStats(): UseStayBoostStatsResult {
  const query = useQuery({
    queryKey: ["stayboost-stats"],
    queryFn: async () => {
      const res = await getStayBoostStats();
      if (!res.ok || !res.stats) return null;
      writeCachedStats(res.stats);
      return res.stats;
    },
    staleTime: STATS_REFRESH_MS,
    refetchInterval: STATS_REFRESH_MS,
    retry: 0,
  });

  const live = query.data ?? readCachedStats();
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

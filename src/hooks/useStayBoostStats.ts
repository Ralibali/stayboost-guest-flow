import { useQuery } from "@tanstack/react-query";
import {
  FALLBACK_STATS,
  STATS_REFRESH_MS,
  fetchStayBoostStats,
  readCachedSavedAt,
  readCachedStats,
  writeCachedStats,
  type StayBoostStats,
} from "@/lib/stats";

export type StatsSource = "live" | "cache" | "fallback";

export interface UseStayBoostStatsResult {
  stats: StayBoostStats;
  source: StatsSource;
  /** Tidpunkten bakom datan — ISO-sträng från API:t eller fallback. */
  updatedAt: string;
  isFetching: boolean;
}

/**
 * Hämtar publik statistik från stayboost-stats-endpointen.
 *
 * - Delas via TanStack Query så flera konsumenter (hero, case study) inte
 *   triggar separata anrop.
 * - `refetchInterval` 5 min matchar API:ts serverside-cache.
 * - `refetchOnWindowFocus` fångar upp när fliken blir synlig igen; Query
 *   dedupliserar samtidiga requests.
 * - Placeholder = senast lyckade svar från localStorage, annars verifierade
 *   fallback-siffror. Nollor visas aldrig p.g.a. nätverksfel.
 * - `queryFn` får `signal` av Query och avbryts automatiskt vid unmount /
 *   refetch (AbortController-integration).
 */
export function useStayBoostStats(): UseStayBoostStatsResult {
  const query = useQuery<StayBoostStats>({
    queryKey: ["stayboost-stats"],
    queryFn: async ({ signal }) => {
      const data = await fetchStayBoostStats(signal);
      writeCachedStats(data);
      return data;
    },
    refetchInterval: STATS_REFRESH_MS,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: false,
    staleTime: STATS_REFRESH_MS,
    gcTime: 24 * 60 * 60 * 1000,
    retry: 1,
    placeholderData: () => readCachedStats() ?? FALLBACK_STATS,
  });

  const stats = query.data ?? FALLBACK_STATS;

  let source: StatsSource;
  if (query.isSuccess && !query.isPlaceholderData) {
    source = "live";
  } else if (readCachedSavedAt() != null) {
    source = "cache";
  } else {
    source = "fallback";
  }

  return {
    stats,
    source,
    updatedAt: stats.updatedAt,
    isFetching: query.isFetching,
  };
}

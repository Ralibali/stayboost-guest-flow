/**
 * Server-only upstream fetch for StayBoost marketing stats.
 * Kept out of the client bundle so stayboost.se never calls supabase.co
 * (the edge function CORS-allowlists only stayboost-sverige.lovable.app).
 */

import { parseStatsResponse, type StayBoostStats } from "./stats";

export type StayBoostStatsResult =
  | { ok: true; stats: StayBoostStats }
  | { ok: false; stats: null };

export const STATS_UPSTREAM_ENDPOINT =
  "https://cmqajoqwafkjyvfbgsmq.supabase.co/functions/v1/stayboost-stats";

export const STATS_UPSTREAM_TIMEOUT_MS = 8_000;

export async function fetchUpstreamStayBoostStats(
  signal?: AbortSignal,
): Promise<StayBoostStats> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STATS_UPSTREAM_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const res = await fetch(STATS_UPSTREAM_ENDPOINT, {
      method: "GET",
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`stats_http_${res.status}`);
    const raw = (await res.json()) as unknown;
    const parsed = parseStatsResponse(raw);
    if (!parsed) throw new Error("stats_invalid_shape");
    return parsed;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/** Fail-soft wrapper used by the same-origin server function. */
export async function safeFetchUpstreamStayBoostStats(): Promise<StayBoostStatsResult> {
  try {
    const stats = await fetchUpstreamStayBoostStats();
    return { ok: true, stats };
  } catch {
    return { ok: false, stats: null };
  }
}

import { createServerFn } from "@tanstack/react-start";
import { safeFetchUpstreamStayBoostStats } from "./stats.server";

/**
 * Same-origin proxy. Browser calls this TanStack Start fn; the server
 * fetches stayboost-stats. Fail-soft: never throw to the client.
 */
export const getStayBoostStats = createServerFn({ method: "GET" }).handler(async () => {
  return safeFetchUpstreamStayBoostStats();
});

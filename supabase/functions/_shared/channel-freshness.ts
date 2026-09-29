export const BOOKING_FEED_MAX_AGE_MS = 5 * 60 * 1000;
export const CHANNEL_ARI_MAX_AGE_MS = 26 * 60 * 60 * 1000;

export type ChannelFreshness = {
  enabled: boolean;
  last_booking_sync_at: string | null;
  last_ari_sync_at: string | null;
  last_error?: string | null;
};

/** A channel must complete its first feed and inventory sync before direct sales. */
export function channelInventoryFresh(connection: ChannelFreshness, now = Date.now()): boolean {
  // A failed attempt to close external inventory remains unsafe even after disable.
  if (connection.last_error === "channel_inventory_closure_failed") return false;
  if (!connection.enabled) return true;
  const fresh = (timestamp: string | null, maxAge: number) => {
    const synced = timestamp ? Date.parse(timestamp) : NaN;
    return Number.isFinite(synced) && synced <= now && now - synced <= maxAge;
  };
  return (
    fresh(connection.last_booking_sync_at, BOOKING_FEED_MAX_AGE_MS) &&
    fresh(connection.last_ari_sync_at, CHANNEL_ARI_MAX_AGE_MS)
  );
}

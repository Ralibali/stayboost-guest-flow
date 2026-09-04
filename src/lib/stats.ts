// Typad klient + hjälpare för det publika StayBoost-statistik-API:t.
// Endpointen har 5 min cache; vi håller samma refetch-kadens klient-side
// och cachar senaste lyckade svar i localStorage för graceful fallback.

export const STATS_ENDPOINT =
  "https://cmqajoqwafkjyvfbgsmq.supabase.co/functions/v1/stayboost-stats";

export const STATS_STORAGE_KEY = "stayboost:stats:v1";
export const STATS_REFRESH_MS = 5 * 60 * 1000;

export interface AddonRow {
  slug: string;
  name: string;
  orders: number;
  units: number;
  revenue: number;
}

export interface StayBoostStats {
  bookings2026: number;
  uniqueGuests: number;
  guestNights: number;
  bookingValueSek: number;
  paidAddonOrders: number;
  paidAddonRevenueSek: number;
  avgPaidAddonSek: number;
  prearrivalMessages: { sent: number; total: number };
  digitalCheckIns: number;
  breakfastDeliveries: { done: number; total: number };
  sms: { sent: number; total: number };
  traffic: { pageViews: number; sessions: number; clickEvents: number };
  addonDistribution: AddonRow[];
  updatedAt: string;
}

/**
 * Verifierade siffror från hela Sirvoy-bokningsexporten för Bergs Slussar Glamping 2026.
 * Källa: sirvoy_booking_content_2026-09-03_11_49_27.csv (323 rader).
 */
export const SIRVOY_EXPORT_STATS: StayBoostStats = {
  bookings2026: 152,
  uniqueGuests: 149,
  guestNights: 194,
  bookingValueSek: 299452,
  paidAddonOrders: 47,
  paidAddonRevenueSek: 27953,
  avgPaidAddonSek: 595,
  prearrivalMessages: { sent: 51, total: 152 },
  digitalCheckIns: 62,
  breakfastDeliveries: { done: 25, total: 25 },
  sms: { sent: 34, total: 40 },
  traffic: { pageViews: 12214, sessions: 8144, clickEvents: 8514 },
  addonDistribution: [
    { slug: "breakfast", name: "Frukost", orders: 25, units: 69, revenue: 12022 },
    { slug: "child_bed", name: "Barn 4–12 år", orders: 19, units: 27, revenue: 8883 },
    {
      slug: "cancel_protection",
      name: "Avbokningsskydd",
      orders: 10,
      units: 10,
      revenue: 3491,
    },
    {
      slug: "late_checkout",
      name: "Sen utcheckning (till kl 12.00)",
      orders: 7,
      units: 7,
      revenue: 2400,
    },
    { slug: "fika_bag", name: "Fikapåse", orders: 8, units: 14, revenue: 1157 },
    { slug: "child_free", name: "Barn 0–3 år", orders: 8, units: 11, revenue: 0 },
    {
      slug: "early_checkin",
      name: "Tidig incheckning (kl 12.00)",
      orders: 1,
      units: 1,
      revenue: 0,
    },
  ],
  updatedAt: "2026-09-03T09:49:27.000Z",
};

/**
 * Ögonblicksbild av StayBoosts egen drift (Göta kanal-admin) — används när
 * live-endpointen inte svarar, så totalerna aldrig kollapsar till bara exporten.
 */
export const STAYBOOST_LIVE_SNAPSHOT: StayBoostStats = {
  bookings2026: 156,
  uniqueGuests: 140,
  guestNights: 183,
  bookingValueSek: 308290,
  paidAddonOrders: 32,
  paidAddonRevenueSek: 13904,
  avgPaidAddonSek: 435,
  prearrivalMessages: { sent: 111, total: 156 },
  digitalCheckIns: 139,
  breakfastDeliveries: { done: 41, total: 41 },
  sms: { sent: 88, total: 95 },
  traffic: { pageViews: 22393, sessions: 774, clickEvents: 14615 },
  addonDistribution: [
    { slug: "breakfast", name: "Frukost", orders: 20, units: 50, revenue: 10430 },
    {
      slug: "late_checkout",
      name: "Sen utcheckning (till kl 12.00)",
      orders: 6,
      units: 6,
      revenue: 2397,
    },
    { slug: "sup_rental", name: "SUP-uthyrning (24 h)", orders: 4, units: 5, revenue: 500 },
    {
      slug: "early_checkin",
      name: "Tidig incheckning (kl 12.00)",
      orders: 1,
      units: 1,
      revenue: 399,
    },
    { slug: "fika_bag", name: "Fikapåse", orders: 1, units: 2, revenue: 178 },
  ],
  updatedAt: "2026-09-04T10:43:10.234Z",
};

/**
 * Slår ihop Sirvoy-exporten med StayBoosts egen drift till totalsiffror.
 * Tillval summeras per slug; namnet från den första källan vinner.
 */
export function mergeStats(a: StayBoostStats, b: StayBoostStats): StayBoostStats {
  const addons = new Map<string, AddonRow>();
  for (const row of [...a.addonDistribution, ...b.addonDistribution]) {
    const prev = addons.get(row.slug);
    if (prev) {
      addons.set(row.slug, {
        ...prev,
        orders: prev.orders + row.orders,
        units: prev.units + row.units,
        revenue: prev.revenue + row.revenue,
      });
    } else {
      addons.set(row.slug, { ...row });
    }
  }
  const addonDistribution = [...addons.values()].sort((x, y) => y.revenue - x.revenue);
  const paidAddonOrders = a.paidAddonOrders + b.paidAddonOrders;
  const paidAddonRevenueSek = a.paidAddonRevenueSek + b.paidAddonRevenueSek;

  return {
    bookings2026: a.bookings2026 + b.bookings2026,
    uniqueGuests: a.uniqueGuests + b.uniqueGuests,
    guestNights: a.guestNights + b.guestNights,
    bookingValueSek: a.bookingValueSek + b.bookingValueSek,
    paidAddonOrders,
    paidAddonRevenueSek,
    avgPaidAddonSek: paidAddonOrders > 0 ? Math.round(paidAddonRevenueSek / paidAddonOrders) : 0,
    prearrivalMessages: {
      sent: a.prearrivalMessages.sent + b.prearrivalMessages.sent,
      total: a.prearrivalMessages.total + b.prearrivalMessages.total,
    },
    digitalCheckIns: a.digitalCheckIns + b.digitalCheckIns,
    breakfastDeliveries: {
      done: a.breakfastDeliveries.done + b.breakfastDeliveries.done,
      total: a.breakfastDeliveries.total + b.breakfastDeliveries.total,
    },
    sms: { sent: a.sms.sent + b.sms.sent, total: a.sms.total + b.sms.total },
    traffic: {
      pageViews: a.traffic.pageViews + b.traffic.pageViews,
      sessions: a.traffic.sessions + b.traffic.sessions,
      clickEvents: a.traffic.clickEvents + b.traffic.clickEvents,
    },
    addonDistribution,
    updatedAt: a.updatedAt > b.updatedAt ? a.updatedAt : b.updatedAt,
  };
}

/** Totalen: Sirvoy-export + StayBoost-drift. */
export const FALLBACK_STATS: StayBoostStats = mergeStats(
  SIRVOY_EXPORT_STATS,
  STAYBOOST_LIVE_SNAPSHOT,
);


// ---------- Validation ----------

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
function isNonNegativeInt(v: unknown): v is number {
  return isFiniteNumber(v) && v >= 0;
}
function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseSentTotal(v: unknown): { sent: number; total: number } | null {
  if (!isRecord(v)) return null;
  if (!isNonNegativeInt(v.sent) || !isNonNegativeInt(v.total)) return null;
  return { sent: v.sent, total: v.total };
}

function parseBreakfastDeliveries(v: unknown): { done: number; total: number } | null {
  if (!isRecord(v)) return null;
  // API:t har levererat både "done" och "sent" historiskt — acceptera båda.
  const done = (isNonNegativeInt(v.done) && v.done) || (isNonNegativeInt(v.sent) && v.sent);
  if (typeof done !== "number") return null;
  if (!isNonNegativeInt(v.total)) return null;
  return { done, total: v.total };
}

function parseTraffic(
  v: unknown,
): { pageViews: number; sessions: number; clickEvents: number } | null {
  if (!isRecord(v)) return null;
  if (
    !isNonNegativeInt(v.pageViews) ||
    !isNonNegativeInt(v.sessions) ||
    !isNonNegativeInt(v.clickEvents)
  )
    return null;
  return {
    pageViews: v.pageViews,
    sessions: v.sessions,
    clickEvents: v.clickEvents,
  };
}

function parseAddonRow(v: unknown): AddonRow | null {
  if (!isRecord(v)) return null;
  if (!isNonEmptyString(v.slug) || !isNonEmptyString(v.name)) return null;
  if (!isNonNegativeInt(v.orders) || !isNonNegativeInt(v.units) || !isNonNegativeInt(v.revenue))
    return null;
  return {
    slug: v.slug,
    name: v.name,
    orders: v.orders,
    units: v.units,
    revenue: v.revenue,
  };
}

/**
 * Validerar API-svaret. Returnerar null vid strukturfel — anroparen kan då
 * falla tillbaka till cache eller FALLBACK_STATS istället för att krascha.
 */
export function parseStatsResponse(input: unknown): StayBoostStats | null {
  if (!isRecord(input)) return null;

  const {
    bookings2026,
    uniqueGuests,
    guestNights,
    bookingValueSek,
    paidAddonOrders,
    paidAddonRevenueSek,
    avgPaidAddonSek,
    digitalCheckIns,
    updatedAt,
    addonDistribution,
  } = input;

  if (
    !isNonNegativeInt(bookings2026) ||
    !isNonNegativeInt(uniqueGuests) ||
    !isNonNegativeInt(guestNights) ||
    !isNonNegativeInt(bookingValueSek) ||
    !isNonNegativeInt(paidAddonOrders) ||
    !isNonNegativeInt(paidAddonRevenueSek) ||
    !isNonNegativeInt(avgPaidAddonSek) ||
    !isNonNegativeInt(digitalCheckIns) ||
    !isNonEmptyString(updatedAt) ||
    !Array.isArray(addonDistribution)
  ) {
    return null;
  }

  const prearrivalMessages = parseSentTotal(input.prearrivalMessages);
  const breakfastDeliveries = parseBreakfastDeliveries(input.breakfastDeliveries);
  const sms = parseSentTotal(input.sms);
  const traffic = parseTraffic(input.traffic);
  if (!prearrivalMessages || !breakfastDeliveries || !sms || !traffic) return null;

  const parsedAddons: AddonRow[] = [];
  for (const row of addonDistribution) {
    const parsed = parseAddonRow(row);
    if (!parsed) return null;
    parsedAddons.push(parsed);
  }

  return {
    bookings2026,
    uniqueGuests,
    guestNights,
    bookingValueSek,
    paidAddonOrders,
    paidAddonRevenueSek,
    avgPaidAddonSek,
    prearrivalMessages,
    digitalCheckIns,
    breakfastDeliveries,
    sms,
    traffic,
    addonDistribution: parsedAddons,
    updatedAt,
  };
}

// ---------- LocalStorage cache ----------

interface CachedStats {
  savedAt: number;
  data: StayBoostStats;
}

export function readCachedStats(): StayBoostStats | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STATS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || !("data" in parsed)) return null;
    return parseStatsResponse((parsed as { data: unknown }).data);
  } catch {
    return null;
  }
}

export function readCachedSavedAt(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STATS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || !isFiniteNumber(parsed.savedAt)) return null;
    return parsed.savedAt;
  } catch {
    return null;
  }
}

export function writeCachedStats(data: StayBoostStats): void {
  if (typeof window === "undefined") return;
  try {
    const payload: CachedStats = { savedAt: Date.now(), data };
    window.localStorage.setItem(STATS_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota/private-mode etc — ignorera tyst.
  }
}

// ---------- Fetch ----------

export async function fetchStayBoostStats(signal?: AbortSignal): Promise<StayBoostStats> {
  const res = await fetch(STATS_ENDPOINT, {
    signal,
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`stats_http_${res.status}`);
  const raw = (await res.json()) as unknown;
  const parsed = parseStatsResponse(raw);
  if (!parsed) throw new Error("stats_invalid_shape");
  return parsed;
}

// ---------- Beräkningar ----------

export interface DerivedStats {
  /** Andel bokningar som gav ett betalt tillvalsköp (0–1). */
  addonShareOfBookings: number;
  /** Andel av tillvalsintäkten som kom från frukost (0–1). */
  breakfastShareOfAddons: number;
  /** Snittintäkt per betald tillvalsorder i SEK. */
  avgPaidAddonSek: number;
  /** Största intäkt bland tillval (för stapeldiagrammets skala). */
  maxAddonRevenue: number;
}

export function computeDerived(stats: StayBoostStats): DerivedStats {
  const addonShareOfBookings =
    stats.bookings2026 > 0 ? stats.paidAddonOrders / stats.bookings2026 : 0;

  const breakfast = stats.addonDistribution.find((a) => a.slug === "breakfast");
  const breakfastShareOfAddons =
    stats.paidAddonRevenueSek > 0 && breakfast ? breakfast.revenue / stats.paidAddonRevenueSek : 0;

  const avgPaidAddonSek =
    stats.avgPaidAddonSek > 0
      ? stats.avgPaidAddonSek
      : stats.paidAddonOrders > 0
        ? Math.round(stats.paidAddonRevenueSek / stats.paidAddonOrders)
        : 0;

  const maxAddonRevenue = stats.addonDistribution.reduce(
    (max, a) => (a.revenue > max ? a.revenue : max),
    0,
  );

  return {
    addonShareOfBookings,
    breakfastShareOfAddons,
    avgPaidAddonSek,
    maxAddonRevenue: maxAddonRevenue || 1,
  };
}

// ---------- Formattering (sv-SE) ----------

const nbsp = "\u00a0";

export function formatInt(n: number): string {
  if (!Number.isFinite(n)) return "–";
  // sv-SE grupperar med non-breaking space; vi normaliserar till vanligt mellanslag för konsekvent rendering.
  return Math.round(n).toLocaleString("sv-SE").replace(new RegExp(nbsp, "g"), " ");
}

export function formatSek(n: number): string {
  return `${formatInt(n)} kr`;
}

export function formatPercent(fraction: number, digits = 1): string {
  if (!Number.isFinite(fraction)) return "–";
  const value = fraction * 100;
  const rounded = Number(value.toFixed(digits));
  return `${rounded.toString().replace(".", ",")} %`;
}

export function formatUpdatedAt(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "–";
    return new Intl.DateTimeFormat("sv-SE", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: "Europe/Stockholm",
    })
      .format(d)
      .replace(new RegExp(nbsp, "g"), " ");
  } catch {
    return "–";
  }
}

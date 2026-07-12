import { createHash } from "node:crypto";

export type SubscriptionSource = "pilot" | "sms-mallar";

type RateBucket = { count: number; resetAt: number };
const memoryHits = new Map<string, RateBucket>();
const HOUR_MS = 60 * 60 * 1000;

function hashIp(ip: string): string {
  const salt = process.env.RATE_LIMIT_SALT ?? "stayboost-subscribe-v1";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

function redisConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

const RATE_SCRIPT = `
local key = KEYS[1]
local max = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local count = redis.call("INCR", key)
if count == 1 then redis.call("EXPIRE", key, ttl) end
if count > max then return 0 end
return 1
`;

async function checkRedisRate(ip: string, max: number, windowMs: number): Promise<boolean> {
  const config = redisConfig();
  if (!config) throw new Error("Redis is not configured");

  const window = Math.max(60, Math.ceil(windowMs / 1000));
  const windowId = Math.floor(Date.now() / windowMs);
  const key = `stayboost:subscribe:${windowId}:${hashIp(ip)}`;
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(["EVAL", RATE_SCRIPT, 1, key, max, window]),
    signal: AbortSignal.timeout(5_000),
  });

  if (!response.ok) throw new Error(`Redis request failed with ${response.status}`);
  const payload = (await response.json()) as { result?: unknown; error?: string };
  if (payload.error) throw new Error(payload.error);
  return payload.result === 1;
}

function checkMemoryRate(ip: string, max: number, windowMs: number): boolean {
  const key = hashIp(ip);
  const now = Date.now();
  const current = memoryHits.get(key);

  if (!current || current.resetAt <= now) {
    memoryHits.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (current.count >= max) return false;
  current.count += 1;
  return true;
}

export async function checkIpRate(ip: string, max = 5, windowMs = HOUR_MS): Promise<boolean> {
  if (redisConfig()) {
    try {
      return await checkRedisRate(ip, max, windowMs);
    } catch (error) {
      console.error("[subscribe-rate-limit] Redis unavailable, using memory fallback", error);
    }
  }

  return checkMemoryRate(ip, max, windowMs);
}

export function listIdForSource(source: SubscriptionSource): number | undefined {
  const raw =
    source === "sms-mallar"
      ? process.env.BREVO_TEMPLATES_LIST_ID
      : process.env.BREVO_PILOT_LIST_ID ?? process.env.BREVO_LIST_ID;
  const value = raw ? Number(raw) : Number.NaN;
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

export async function upsertBrevoContact(
  email: string,
  source: SubscriptionSource,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return { ok: false, message: "missing_api_key" };

  const listId = listIdForSource(source);
  const body: Record<string, unknown> = {
    email,
    updateEnabled: true,
  };
  if (listId) body.listIds = [listId];

  try {
    const response = await fetch("https://api.brevo.com/v3/contacts", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    });

    if (response.ok) return { ok: true };

    const text = await response.text().catch(() => "");
    if (response.status === 400 && /duplicate|already exist/i.test(text)) {
      return { ok: true };
    }

    console.error("[brevo] Contact upsert failed", response.status, text.slice(0, 500));
    return { ok: false, message: "brevo_error" };
  } catch (error) {
    console.error("[brevo] Network error", error);
    return { ok: false, message: "network_error" };
  }
}

export function resetSubscriptionRateLimitsForTests(): void {
  memoryHits.clear();
}

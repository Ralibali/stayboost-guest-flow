import { createHash } from "node:crypto";

export type DemoLimitReason = "number_used" | "ip_limit" | "global_limit";

export type DemoReservation = {
  backend: "memory" | "redis";
  numberKey: string;
  ipKey: string;
  globalKey: string;
};

type Bucket = { count: number; resetAt: number };

const DAY_MS = 24 * 60 * 60 * 1000;
const RESERVATION_TTL_SECONDS = 10 * 60;
const NUMBER_RETENTION_SECONDS = 90 * 24 * 60 * 60;
const DAILY_TTL_SECONDS = 2 * 24 * 60 * 60;
const MAX_PER_IP_DAY = 3;
const MAX_GLOBAL_DAY = 50;

const memoryIp = new Map<string, Bucket>();
const memoryNumbers = new Map<string, number>();
let memoryGlobal: Bucket = { count: 0, resetAt: Date.now() + DAY_MS };

export function normalizeSwedishMobile(input: string): string | null {
  const compact = input.trim().replace(/[\s\-().]/g, "");

  if (/^07\d{8}$/.test(compact)) return `+46${compact.slice(1)}`;
  if (/^467\d{8}$/.test(compact)) return `+${compact}`;
  if (/^\+467\d{8}$/.test(compact)) return compact;
  if (/^00467\d{8}$/.test(compact)) return `+${compact.slice(2)}`;

  return null;
}

function hashValue(value: string): string {
  const salt = process.env.RATE_LIMIT_SALT ?? "stayboost-demo-v1";
  return createHash("sha256").update(`${salt}:${value}`).digest("hex");
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function getKeys(ip: string, e164: string) {
  const day = utcDay();
  return {
    numberKey: `stayboost:demo:number:${hashValue(e164)}`,
    ipKey: `stayboost:demo:ip:${day}:${hashValue(ip)}`,
    globalKey: `stayboost:demo:global:${day}`,
  };
}

function rollBucket(bucket: Bucket | undefined): Bucket {
  const now = Date.now();
  if (!bucket || bucket.resetAt <= now) {
    return { count: 0, resetAt: now + DAY_MS };
  }
  return bucket;
}

function reserveMemory(ip: string, e164: string):
  | { ok: true; reservation: DemoReservation }
  | { ok: false; reason: DemoLimitReason } {
  const keys = getKeys(ip, e164);
  const now = Date.now();
  const numberExpiry = memoryNumbers.get(keys.numberKey);

  if (numberExpiry && numberExpiry > now) {
    return { ok: false, reason: "number_used" };
  }
  if (numberExpiry) memoryNumbers.delete(keys.numberKey);

  const ipBucket = rollBucket(memoryIp.get(keys.ipKey));
  memoryGlobal = rollBucket(memoryGlobal);

  if (ipBucket.count >= MAX_PER_IP_DAY) {
    return { ok: false, reason: "ip_limit" };
  }
  if (memoryGlobal.count >= MAX_GLOBAL_DAY) {
    return { ok: false, reason: "global_limit" };
  }

  memoryNumbers.set(keys.numberKey, now + RESERVATION_TTL_SECONDS * 1000);
  ipBucket.count += 1;
  memoryIp.set(keys.ipKey, ipBucket);
  memoryGlobal.count += 1;

  return {
    ok: true,
    reservation: { backend: "memory", ...keys },
  };
}

const RESERVE_SCRIPT = `
local numberKey = KEYS[1]
local ipKey = KEYS[2]
local globalKey = KEYS[3]
local ipMax = tonumber(ARGV[1])
local globalMax = tonumber(ARGV[2])
local numberTtl = tonumber(ARGV[3])
local dailyTtl = tonumber(ARGV[4])

if redis.call("EXISTS", numberKey) == 1 then
  return "number_used"
end

local ipCount = tonumber(redis.call("GET", ipKey) or "0")
if ipCount >= ipMax then
  return "ip_limit"
end

local globalCount = tonumber(redis.call("GET", globalKey) or "0")
if globalCount >= globalMax then
  return "global_limit"
end

redis.call("SET", numberKey, "reserved", "EX", numberTtl, "NX")
redis.call("INCR", ipKey)
redis.call("EXPIRE", ipKey, dailyTtl)
redis.call("INCR", globalKey)
redis.call("EXPIRE", globalKey, dailyTtl)
return "ok"
`;

const RELEASE_SCRIPT = `
local numberKey = KEYS[1]
local ipKey = KEYS[2]
local globalKey = KEYS[3]

if redis.call("DEL", numberKey) == 1 then
  local ipCount = tonumber(redis.call("GET", ipKey) or "0")
  if ipCount > 0 then redis.call("DECR", ipKey) end
  local globalCount = tonumber(redis.call("GET", globalKey) or "0")
  if globalCount > 0 then redis.call("DECR", globalKey) end
end
return "ok"
`;

function redisConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

async function redisCommand(args: Array<string | number>): Promise<unknown> {
  const config = redisConfig();
  if (!config) throw new Error("Redis is not configured");

  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(5_000),
  });

  if (!response.ok) {
    throw new Error(`Redis request failed with ${response.status}`);
  }

  const payload = (await response.json()) as { result?: unknown; error?: string };
  if (payload.error) throw new Error(payload.error);
  return payload.result;
}

async function reserveRedis(ip: string, e164: string): Promise<
  | { ok: true; reservation: DemoReservation }
  | { ok: false; reason: DemoLimitReason }
> {
  const keys = getKeys(ip, e164);
  const result = await redisCommand([
    "EVAL",
    RESERVE_SCRIPT,
    3,
    keys.numberKey,
    keys.ipKey,
    keys.globalKey,
    MAX_PER_IP_DAY,
    MAX_GLOBAL_DAY,
    RESERVATION_TTL_SECONDS,
    DAILY_TTL_SECONDS,
  ]);

  if (result === "number_used" || result === "ip_limit" || result === "global_limit") {
    return { ok: false, reason: result };
  }
  if (result !== "ok") throw new Error("Unexpected Redis rate-limit response");

  return {
    ok: true,
    reservation: { backend: "redis", ...keys },
  };
}

export async function reserveDemoSms(ip: string, e164: string): Promise<
  | { ok: true; reservation: DemoReservation }
  | { ok: false; reason: DemoLimitReason }
> {
  if (redisConfig()) {
    try {
      return await reserveRedis(ip, e164);
    } catch (error) {
      console.error("[demo-rate-limit] Redis unavailable, using memory fallback", error);
    }
  }

  return reserveMemory(ip, e164);
}

export async function completeDemoSms(reservation: DemoReservation): Promise<void> {
  if (reservation.backend === "redis") {
    try {
      await redisCommand([
        "SET",
        reservation.numberKey,
        "sent",
        "EX",
        NUMBER_RETENTION_SECONDS,
        "XX",
      ]);
    } catch (error) {
      console.error("[demo-rate-limit] Failed to finalize Redis reservation", error);
    }
    return;
  }

  if (memoryNumbers.has(reservation.numberKey)) {
    memoryNumbers.set(
      reservation.numberKey,
      Date.now() + NUMBER_RETENTION_SECONDS * 1000,
    );
  }
}

export async function releaseDemoSms(reservation: DemoReservation): Promise<void> {
  if (reservation.backend === "redis") {
    try {
      await redisCommand([
        "EVAL",
        RELEASE_SCRIPT,
        3,
        reservation.numberKey,
        reservation.ipKey,
        reservation.globalKey,
      ]);
      return;
    } catch (error) {
      console.error("[demo-rate-limit] Failed to release Redis reservation", error);
      return;
    }
  }

  memoryNumbers.delete(reservation.numberKey);
  const ipBucket = memoryIp.get(reservation.ipKey);
  if (ipBucket) ipBucket.count = Math.max(0, ipBucket.count - 1);
  memoryGlobal.count = Math.max(0, memoryGlobal.count - 1);
}

export async function send46elks(to: string, text: string): Promise<boolean> {
  const user = process.env.ELKS_API_USER;
  const pass = process.env.ELKS_API_PASSWORD;
  const from = process.env.ELKS_SENDER || "StayBoost";

  if (!user || !pass) {
    console.error("[46elks] Missing ELKS_API_USER or ELKS_API_PASSWORD");
    return false;
  }

  const auth = Buffer.from(`${user}:${pass}`).toString("base64");
  const form = new URLSearchParams({ from, to, message: text });

  try {
    const response = await fetch("https://api.46elks.com/a1/sms", {
      method: "POST",
      headers: {
        authorization: `Basic ${auth}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error("[46elks] Send failed", response.status, body.slice(0, 300));
      return false;
    }

    return true;
  } catch (error) {
    console.error("[46elks] Network error", error);
    return false;
  }
}

export const DEMO_SMS_TEXT =
  "Hej! Välkommen i morgon. Incheckning från 15.00, portkod 4482. Vill du lägga till frukostkorg för 249 kr? Skickat automatiskt av StayBoost.";

export function resetDemoRateLimitsForTests(): void {
  memoryIp.clear();
  memoryNumbers.clear();
  memoryGlobal = { count: 0, resetAt: Date.now() + DAY_MS };
}

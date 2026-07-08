// Server-only helpers for the sendDemoSms server function.

import { createHash } from "node:crypto";

type Bucket = { count: number; resetAt: number };
const DAY = 24 * 60 * 60 * 1000;

const perIpDay = new Map<string, Bucket>();
const perNumberEver = new Set<string>();
let totalDay: Bucket = { count: 0, resetAt: Date.now() + DAY };

export function normalizeSwedishMobile(input: string): string | null {
  const digits = input.replace(/[\s\-()+.]/g, "");
  // 07XXXXXXXX (10 digits)
  if (/^07\d{8}$/.test(digits)) return "+46" + digits.slice(1);
  // 467XXXXXXXX (11 digits after country code)
  if (/^467\d{8}$/.test(digits)) return "+" + digits;
  // +467XXXXXXXX
  if (/^\+467\d{8}$/.test(digits)) return digits;
  return null;
}

function rollDaily(b: Bucket): Bucket {
  const now = Date.now();
  if (b.resetAt < now) return { count: 0, resetAt: now + DAY };
  return b;
}

export function checkLimits(ip: string, e164: string):
  | { ok: true }
  | { ok: false; reason: "number_used" | "ip_limit" | "global_limit" } {
  const hash = createHash("sha256").update(e164).digest("hex");
  if (perNumberEver.has(hash)) return { ok: false, reason: "number_used" };

  totalDay = rollDaily(totalDay);
  if (totalDay.count >= 50) return { ok: false, reason: "global_limit" };

  const ipBucket = rollDaily(perIpDay.get(ip) ?? { count: 0, resetAt: Date.now() + DAY });
  if (ipBucket.count >= 3) return { ok: false, reason: "ip_limit" };

  // Reserve
  perNumberEver.add(hash);
  ipBucket.count += 1;
  perIpDay.set(ip, ipBucket);
  totalDay.count += 1;
  return { ok: true };
}

export async function send46elks(to: string, text: string): Promise<boolean> {
  const user = process.env.ELKS_API_USER;
  const pass = process.env.ELKS_API_PASSWORD;
  const from = process.env.ELKS_SENDER || "StayBoost";
  if (!user || !pass) {
    console.error("[46elks] missing credentials");
    return false;
  }
  const auth = Buffer.from(`${user}:${pass}`).toString("base64");
  const form = new URLSearchParams({ from, to, message: text });
  const res = await fetch("https://api.46elks.com/a1/sms", {
    method: "POST",
    headers: {
      authorization: `Basic ${auth}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[46elks] send failed", res.status, body);
    return false;
  }
  return true;
}

export const DEMO_SMS_TEXT =
  "Hej! Sa har ser ett gastmeddelande fran StayBoost ut: Valkommen i morgon! " +
  "Incheckning fran kl 15, portkod 4482. Vill du ha frukostkorg till dorren (249 kr)? " +
  "Allt detta skickas automatiskt till dina gaster.";

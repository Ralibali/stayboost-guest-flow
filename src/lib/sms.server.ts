// Server-only helpers for the sendDemoSms server function.

import { createHash } from "node:crypto";

type Bucket = { count: number; resetAt: number };
const DAY = 24 * 60 * 60 * 1000;

const perIpDay = new Map<string, Bucket>();
const perNumberDay = new Map<string, Bucket>();
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

export function checkLimits(
  ip: string,
  e164: string,
): { ok: true } | { ok: false; reason: "number_used" | "ip_limit" | "global_limit" } {
  const hash = createHash("sha256").update(e164).digest("hex");

  totalDay = rollDaily(totalDay);
  if (totalDay.count >= 50) return { ok: false, reason: "global_limit" };

  const ipBucket = rollDaily(perIpDay.get(ip) ?? { count: 0, resetAt: Date.now() + DAY });
  if (ipBucket.count >= 5) return { ok: false, reason: "ip_limit" };

  const numBucket = rollDaily(perNumberDay.get(hash) ?? { count: 0, resetAt: Date.now() + DAY });
  if (numBucket.count >= 5) return { ok: false, reason: "number_used" };

  // Reserve
  ipBucket.count += 1;
  perIpDay.set(ip, ipBucket);
  numBucket.count += 1;
  perNumberDay.set(hash, numBucket);
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

// Fem påhittade scenarier för testutskick.
export const DEMO_SCENARIOS = {
  valkomst: {
    label: "Välkomst",
    emoji: "👋",
    hint: "2 dagar före ankomst",
    text:
      "Hej Anna! Vi ser fram emot er vistelse på Sjöbrisretreatet 12–14 juli. " +
      "Incheckning från kl 15, portkod skickas på ankomstdagen. " +
      "Vill ni förbeställa något? Se tillval: https://demo.stayboost.se/g/anna",
  },
  portkod: {
    label: "Portkod",
    emoji: "🔑",
    hint: "Ankomstdagen kl 12",
    text:
      "God dag Anna! Er portkod är 4482. Wifi: Sjöbrisretreatet_2G / välkommen2026. " +
      "Självincheckning: https://demo.stayboost.se/i/anna. Trevlig vistelse!",
  },
  frukost: {
    label: "Frukostkorg",
    emoji: "🥐",
    hint: "Kväll 1 kl 18",
    text:
      "Hej Anna! Vill ni ha en lokal frukostkorg levererad till dörren i morgon kl 08? " +
      "249 kr för två. Boka: https://demo.stayboost.se/t/frukost-anna",
  },
  "sen-utcheckning": {
    label: "Sen utcheckning",
    emoji: "⏰",
    hint: "Dagen innan avresa",
    text:
      "Hej Anna! Vill ni förlänga vistelsen till kl 15 i stället för 11? " +
      "150 kr, betala direkt: https://demo.stayboost.se/t/sen-utcheckning-anna",
  },
  omdome: {
    label: "Omdöme",
    emoji: "⭐",
    hint: "Dagen efter avresa",
    text:
      "Tack för besöket Anna! Om ni hade det bra skulle vi vara tacksamma för ett " +
      "omdöme på Google: https://demo.stayboost.se/r/anna. Välkomna tillbaka!",
  },
} as const;

export type DemoScenario = keyof typeof DEMO_SCENARIOS;

export function isDemoScenario(v: string): v is DemoScenario {
  return Object.prototype.hasOwnProperty.call(DEMO_SCENARIOS, v);
}

// Bakåtkompatibilitet.
export const DEMO_SMS_TEXT = DEMO_SCENARIOS.valkomst.text;

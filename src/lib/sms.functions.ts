import { createServerFn } from "@tanstack/react-start";
import { getRequestIP } from "@tanstack/react-start/server";
import { z } from "zod";
import {
  completeDemoSms,
  DEMO_SMS_TEXT,
  normalizeSwedishMobile,
  releaseDemoSms,
  reserveDemoSms,
  send46elks,
} from "./sms.server";

const schema = z.object({
  phone: z.string().trim().min(6).max(24),
  website: z.string().max(0).optional().default(""),
});

export const sendDemoSms = createServerFn({ method: "POST" })
  .inputValidator((data) => schema.parse(data))
  .handler(async ({ data }) => {
    // Honeypot: bots get a harmless success response without triggering an SMS.
    if (data.website) return { ok: true as const };

    const e164 = normalizeSwedishMobile(data.phone);
    if (!e164) return { ok: false as const, error: "invalid_number" as const };

    const ip = getRequestIP({ xForwardedFor: true }) ?? "unknown";
    const limit = await reserveDemoSms(ip, e164);
    if (!limit.ok) return { ok: false as const, error: limit.reason };

    const sent = await send46elks(e164, DEMO_SMS_TEXT);
    if (!sent) {
      await releaseDemoSms(limit.reservation);
      return { ok: false as const, error: "server_error" as const };
    }

    await completeDemoSms(limit.reservation);
    return { ok: true as const };
  });

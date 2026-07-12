import { createServerFn } from "@tanstack/react-start";
import { getRequestIP } from "@tanstack/react-start/server";
import { z } from "zod";
import {
  DEMO_SCENARIOS,
  checkLimits,
  isDemoScenario,
  normalizeSwedishMobile,
  send46elks,
} from "./sms.server";

const schema = z.object({
  phone: z.string().trim().min(6).max(20),
  scenario: z
    .string()
    .trim()
    .max(32)
    .optional()
    .transform((v) => (v && isDemoScenario(v) ? v : "valkomst")),
});

export const sendDemoSms = createServerFn({ method: "POST" })
  .inputValidator((data) => schema.parse(data))
  .handler(async ({ data }) => {
    const e164 = normalizeSwedishMobile(data.phone);
    if (!e164) return { ok: false as const, error: "invalid_number" as const };

    const ip = getRequestIP({ xForwardedFor: true }) ?? "unknown";
    const limit = checkLimits(ip, e164);
    if (!limit.ok) return { ok: false as const, error: limit.reason };

    const scenario = isDemoScenario(data.scenario) ? data.scenario : "valkomst";
    const text = DEMO_SCENARIOS[scenario].text;

    const sent = await send46elks(e164, text);
    if (!sent) return { ok: false as const, error: "server_error" as const };
    return { ok: true as const, scenario };
  });

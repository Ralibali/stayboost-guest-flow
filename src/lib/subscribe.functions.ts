import { createServerFn } from "@tanstack/react-start";
import { getRequestIP } from "@tanstack/react-start/server";
import { z } from "zod";
import {
  checkIpRate,
  sendBrevoTemplate,
  upsertBrevoContact,
} from "./subscribe.server";

const schema = z.object({
  email: z.string().trim().email().max(255),
  source: z.enum(["early-access", "sms-mallar"]),
});

export const subscribe = createServerFn({ method: "POST" })
  .inputValidator((data) => schema.parse(data))
  .handler(async ({ data }) => {
    const ip = getRequestIP({ xForwardedFor: true }) ?? "unknown";
    if (!checkIpRate(ip)) {
      return { ok: false, error: "rate_limited" as const };
    }
    const result = await upsertBrevoContact(data.email, data.source);
    if (!result.ok) return { ok: false, error: "server_error" as const };
    // Skickar välkomst / lead-magnet-mailet direkt.
    // Långsiktig drip triggas av listmedlemskapet i Brevo automation.
    await sendBrevoTemplate(data.email, data.source);
    return { ok: true as const };
  });

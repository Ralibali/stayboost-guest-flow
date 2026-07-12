import { createServerFn } from "@tanstack/react-start";
import { getRequestIP } from "@tanstack/react-start/server";
import { z } from "zod";
import { checkIpRate, upsertBrevoContact } from "./subscribe.server";

const schema = z.object({
  email: z.string().trim().email().max(255),
  source: z.enum(["pilot", "sms-mallar"]),
  consent: z.literal(true),
  website: z.string().max(0).optional().default(""),
});

export const subscribe = createServerFn({ method: "POST" })
  .inputValidator((data) => schema.parse(data))
  .handler(async ({ data }) => {
    // Honeypot: do not reveal bot detection.
    if (data.website) return { ok: true as const };

    const ip = getRequestIP({ xForwardedFor: true }) ?? "unknown";
    if (!(await checkIpRate(ip))) {
      return { ok: false as const, error: "rate_limited" as const };
    }

    const result = await upsertBrevoContact(data.email, data.source);
    if (!result.ok) return { ok: false as const, error: "server_error" as const };

    return { ok: true as const };
  });

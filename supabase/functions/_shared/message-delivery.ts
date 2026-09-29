import { appBaseUrl } from "./app-url.ts";
import { formatSvDate, renderTemplate } from "./templates.ts";

type Admin = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: any; error: { message?: string } | null }>;
};
type Environment = (name: string) => string | undefined;
export class MessageDeliveryError extends Error {}
export function bookingCommunicationsAllowed(booking: {
  status?: string;
  communications_enabled?: boolean;
  payment_status?: string | null;
  external_id?: string | null;
}): boolean {
  return (
    booking.status === "confirmed" &&
    booking.communications_enabled === true &&
    ["none", "paid"].includes(booking.payment_status ?? "none") &&
    (!booking.external_id?.startsWith("sirvoy-csv:") || booking.payment_status === "paid")
  );
}
export type MessageDeliveryOutcome =
  "sent" | "failed" | "waiting_contact" | "waiting_payment" | "skipped";

/** One provider attempt per lease; uncertain results require review, never blind replay. */
export async function deliverScheduledMessage(
  admin: Admin,
  messageId: string,
  env: Environment,
  transport: typeof fetch = fetch,
  now = Date.now(),
): Promise<MessageDeliveryOutcome> {
  const { data: claim, error: claimError } = await admin.rpc("claim_scheduled_message", {
    p_message_id: messageId,
  });
  if (claimError) throw new MessageDeliveryError("message_claim_failed");
  if (!claim) return "skipped";
  const finish = async (
    state: string,
    error: string | null = null,
    providerId: string | null = null,
  ) => {
    const { data, error: failure } = await admin.rpc("finish_scheduled_message", {
      p_message_id: messageId,
      p_attempt_id: claim.attempt_id,
      p_state: state,
      p_error: error,
      p_provider_id: providerId,
    });
    if (failure || data !== true) throw new MessageDeliveryError("message_delivery_record_failed");
  };
  const { data: row, error: beginError } = await admin.rpc("begin_scheduled_message", {
    p_message_id: messageId,
    p_attempt_id: claim.attempt_id,
  });
  if (beginError) throw new MessageDeliveryError("message_freshness_check_failed");
  if (!row) {
    await finish("aborted");
    return "skipped";
  }
  const b = row.booking;
  const p = b?.property;
  const tpl = row.template;
  if (!b || !p || !tpl) {
    await finish("rejected", "Bokning eller mall saknas.");
    return "failed";
  }
  // Defense in depth: the service-only dispatch RPC enforces the same current-state gate.
  if (!bookingCommunicationsAllowed(b)) {
    await finish("aborted");
    return "waiting_payment";
  }
  const contact = row.channel === "email" ? b.guest_email : b.guest_phone;
  if (!contact) {
    if (Date.parse(row.send_at) < now - 7 * 86_400_000) {
      await finish("rejected", "Saknar kontaktuppgift.");
      return "failed";
    }
    await finish("aborted");
    return "waiting_contact";
  }
  const vars: Record<string, string> = {
    gäst_namn: b.guest_name || "gäst",
    anläggning: p.name ?? "",
    enhet: b.unit?.name ?? "",
    incheckning: formatSvDate(b.checkin_date),
    utcheckning: formatSvDate(b.checkout_date),
    incheckningstid: p.checkin_time ?? "",
    utcheckningstid: p.checkout_time ?? "",
    gästsida_länk: `${appBaseUrl(env("GUEST_PAGE_BASE_URL"))}/g/${b.guest_token}`,
    wifi_namn: p.wifi_name ?? "",
    wifi_lösenord: p.wifi_password ?? "",
    vägbeskrivning: p.directions ?? "",
    recensionslänk: p.review_url ?? "",
  };
  const body = renderTemplate(tpl.body ?? "", vars);
  const subject = renderTemplate(tpl.subject ?? "", vars);
  let url: string;
  let options: RequestInit;
  let provider: string;
  if (row.channel === "email") {
    const key = env("BREVO_API_KEY");
    const sender = env("BREVO_SENDER_EMAIL");
    if (!key || !sender) {
      await finish("rejected", "Brevo är inte konfigurerat.");
      return "failed";
    }
    provider = "Brevo";
    url = "https://api.brevo.com/v3/smtp/email";
    options = {
      method: "POST",
      headers: { "api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: { email: sender, name: env("BREVO_SENDER_NAME") ?? p.name },
        to: [{ email: contact, name: b.guest_name ?? undefined }],
        subject: subject || `Meddelande från ${p.name}`,
        textContent: body,
      }),
    };
  } else if (row.channel === "sms") {
    const user = env("ELKS_API_USER");
    const password = env("ELKS_API_PASSWORD");
    if (!user || !password) {
      await finish("rejected", "46elks är inte konfigurerat.");
      return "failed";
    }
    provider = "46elks";
    url = "https://api.46elks.com/a1/sms";
    options = {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${user}:${password}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        from: env("ELKS_SENDER") ?? "StayBoost",
        to: contact,
        message: body,
      }),
    };
  } else {
    await finish("rejected", "Ogiltig meddelandekanal.");
    return "failed";
  }
  let response: Response;
  try {
    response = await transport(url, {
      ...options,
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    await finish(
      "unknown",
      "Leveransresultatet är osäkert. Kontrollera leverantören före nytt utskick.",
    );
    return "failed";
  }
  if (!response.ok) {
    const uncertain = response.status >= 500;
    await finish(
      uncertain ? "unknown" : "rejected",
      uncertain
        ? "Leveransresultatet är osäkert. Kontrollera leverantören före nytt utskick."
        : `${provider} avvisade utskicket (${response.status}).`,
    );
    return "failed";
  }
  const receipt = await response.json().catch(() => null);
  await finish(
    "accepted",
    null,
    typeof (receipt?.messageId ?? receipt?.id) === "string"
      ? (receipt.messageId ?? receipt.id)
      : null,
  );
  return "sent";
}

import { renderMessageContent } from "./message-content.ts";
import { buildEmailRequest, getEmailProvider } from "./email-provider.ts";

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
  | "sent"
  | "failed"
  | "waiting_contact"
  | "waiting_payment"
  | "skipped";

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
  let body: string;
  let subject: string;
  let html: string | undefined;
  try {
    const rendered = renderMessageContent(tpl, b, p, env("GUEST_PAGE_BASE_URL"));
    body = rendered.text;
    subject = rendered.subject;
    html = row.channel === "email" ? rendered.html : undefined;
  } catch {
    await finish("rejected", "Mallens innehåll behöver granskas innan utskick.");
    return "failed";
  }
  let url: string;
  let options: RequestInit;
  let provider: string;
  if (row.channel === "email") {
    const config = getEmailProvider(env);
    if (!config) {
      await finish("rejected", "E-postleverantören eller avsändaren är inte konfigurerad.");
      return "failed";
    }
    const request = buildEmailRequest(config, {
      deliveryId: messageId,
      recipientEmail: contact,
      recipientName: b.guest_name ?? undefined,
      fallbackSenderName: p.name,
      subject: subject || `Meddelande från ${p.name}`,
      text: body,
      ...(html === undefined ? {} : { html }),
    });
    ({ provider, url, options } = request);
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
    // A Resend idempotency conflict can mean another request has been accepted
    // or remains in flight. Keep the ledger's review gate instead of blind replay.
    const uncertain = response.status >= 500 || (provider === "Resend" && response.status === 409);
    await finish(
      uncertain ? "unknown" : "rejected",
      uncertain
        ? "Leveransresultatet är osäkert. Kontrollera leverantören före nytt utskick."
        : `${provider} avvisade utskicket (${response.status}).`,
    );
    return "failed";
  }
  const receipt = await response.json().catch(() => null);
  if (provider === "Resend" && (typeof receipt?.id !== "string" || !receipt.id)) {
    await finish("unknown", "Leveranskvittot saknas. Kontrollera leverantören före nytt utskick.");
    return "failed";
  }
  await finish(
    "accepted",
    null,
    typeof (receipt?.messageId ?? receipt?.id) === "string"
      ? (receipt.messageId ?? receipt.id)
      : null,
  );
  return "sent";
}

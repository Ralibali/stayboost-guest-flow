export type EmailEnvironment = (name: string) => string | undefined;
export type EmailProvider = "brevo" | "resend";
export type EmailProviderConfiguration = {
  provider: EmailProvider;
  apiKey: string;
  senderEmail: string;
  senderName?: string;
};
const EMAIL = /^[^\s<>@,]+@[^\s<>@,]+\.[^\s<>@,]+$/;
const hasHeaderControl = (value: string) =>
  [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);

/** Missing selection preserves existing Brevo deployments; never guess from a key. */
export function getEmailProvider(env: EmailEnvironment): EmailProviderConfiguration | null {
  const provider = env("EMAIL_PROVIDER")?.trim().toLowerCase() || "brevo";
  if (provider !== "brevo" && provider !== "resend") return null;
  const prefix = provider === "resend" ? "RESEND" : "BREVO";
  const apiKey = env(`${prefix}_API_KEY`)?.trim();
  const senderEmail = env(`${prefix}_SENDER_EMAIL`)?.trim();
  const senderName = env(`${prefix}_SENDER_NAME`)?.trim();
  if (!apiKey || /\s/.test(apiKey) || !senderEmail || !EMAIL.test(senderEmail)) return null;
  if (senderName && /[\r\n]/.test(senderName)) return null;
  return { provider, apiKey, senderEmail, ...(senderName ? { senderName } : {}) };
}

/** Readiness exposes only this boolean, never the provider's credentials. */
export function emailProviderConfigured(env: EmailEnvironment): boolean {
  return getEmailProvider(env) !== null;
}

export function buildEmailRequest(
  config: EmailProviderConfiguration,
  message: {
    deliveryId: string;
    deliveryKind?: "scheduled" | "chat";
    recipientEmail: string;
    recipientName?: string;
    subject: string;
    text: string;
    html?: string;
    fallbackSenderName?: string;
    replyToEmail?: string;
    replyToName?: string;
  },
): { provider: "Brevo" | "Resend"; url: string; options: RequestInit } {
  const senderName = config.senderName ?? message.fallbackSenderName;
  if (
    (message.replyToEmail !== undefined &&
      (!EMAIL.test(message.replyToEmail) || hasHeaderControl(message.replyToEmail))) ||
    (message.replyToName !== undefined &&
      (!message.replyToEmail ||
        /[<>]/.test(message.replyToName) ||
        hasHeaderControl(message.replyToName)))
  )
    throw new Error("invalid_email_reply_to");
  // Persisted queue/chat identity, never a request or attempt ID. Keep the
  // scheduled default unchanged for existing delivery retries.
  const idempotencyKey = `stayboost-${message.deliveryKind ?? "scheduled"}/${message.deliveryId}`;
  if (
    (config.provider === "resend" || message.deliveryKind === "chat") &&
    (!/^[A-Za-z0-9_-]+$/.test(message.deliveryId) || idempotencyKey.length > 256)
  )
    throw new Error("invalid_email_delivery_id");
  if (
    config.provider === "brevo" &&
    message.deliveryKind === "chat" &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(message.deliveryId)
  )
    throw new Error("invalid_email_delivery_id");
  if (config.provider === "resend") {
    const safeName = senderName?.replace(/[<>\r\n]/g, " ").trim();
    return {
      provider: "Resend",
      url: "https://api.resend.com/emails",
      options: {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          from: safeName ? `${safeName} <${config.senderEmail}>` : config.senderEmail,
          to: [message.recipientEmail],
          subject: message.subject,
          text: message.text,
          ...(message.replyToEmail === undefined ? {} : { reply_to: message.replyToEmail }),
          ...(message.html === undefined ? {} : { html: message.html }),
        }),
      },
    };
  }
  return {
    provider: "Brevo",
    url: "https://api.brevo.com/v3/smtp/email",
    options: {
      method: "POST",
      headers: { "api-key": config.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: { email: config.senderEmail, name: senderName },
        to: [{ email: message.recipientEmail, name: message.recipientName }],
        subject: message.subject,
        textContent: message.text,
        ...(message.replyToEmail === undefined
          ? {}
          : { replyTo: { email: message.replyToEmail, name: message.replyToName } }),
        // Brevo's idempotency contract requires a UUID; the saved chat ID is stable.
        ...(message.deliveryKind === "chat"
          ? { headers: { idempotencyKey: message.deliveryId } }
          : {}),
        ...(message.html === undefined ? {} : { htmlContent: message.html }),
      }),
    },
  };
}

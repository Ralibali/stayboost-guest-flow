export type EmailEnvironment = (name: string) => string | undefined;
export type EmailProvider = "brevo" | "resend";
export type EmailProviderConfiguration = {
  provider: EmailProvider;
  apiKey: string;
  senderEmail: string;
  senderName?: string;
};
const EMAIL = /^[^\s<>@,]+@[^\s<>@,]+\.[^\s<>@,]+$/;

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
    recipientEmail: string;
    recipientName?: string;
    subject: string;
    text: string;
    html?: string;
    fallbackSenderName?: string;
  },
): { provider: "Brevo" | "Resend"; url: string; options: RequestInit } {
  const senderName = config.senderName ?? message.fallbackSenderName;
  if (config.provider === "resend") {
    // The queue's delivery identity survives retries; an attempt/lease ID does not.
    const idempotencyKey = `stayboost-scheduled/${message.deliveryId}`;
    if (!/^[A-Za-z0-9_-]+$/.test(message.deliveryId) || idempotencyKey.length > 256)
      throw new Error("invalid_email_delivery_id");
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
        ...(message.html === undefined ? {} : { htmlContent: message.html }),
      }),
    },
  };
}

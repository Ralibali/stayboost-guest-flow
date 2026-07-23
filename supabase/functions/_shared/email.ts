/**
 * Minimal Brevo-avsändare (samma mönster som schemalagda meddelanden).
 */

export interface SendEmailArgs {
  apiKey: string;
  senderEmail: string;
  senderName: string;
  toEmail: string;
  toName?: string;
  subject: string;
  text: string;
  replyToEmail?: string;
  replyToName?: string;
}

export async function sendBrevoEmail(args: SendEmailArgs): Promise<void> {
  const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": args.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: { email: args.senderEmail, name: args.senderName },
      to: [{ email: args.toEmail, name: args.toName }],
      subject: args.subject,
      textContent: args.text,
      ...(args.replyToEmail
        ? { replyTo: { email: args.replyToEmail, name: args.replyToName } }
        : {}),
    }),
  });
  if (!resp.ok) {
    throw new Error(`Brevo ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }
}

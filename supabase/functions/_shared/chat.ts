/**
 * Chatt-widget: validering av inkommande meddelanden.
 * Ren TS utan Deno-beroenden — delas av edge function och vitest.
 */

export interface ChatInput {
  name?: unknown;
  email?: unknown;
  message?: unknown;
  pageUrl?: unknown;
  /** Honeypot: dolt fält i widgeten. Bots fyller det — människor aldrig. */
  company?: unknown;
}

export interface ValidChat {
  name: string | null;
  email: string;
  message: string;
  pageUrl: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Validera + städa ett widget-POST.
 * Returnerar null vid ogiltig input, "bot" vid honeypot-träff
 * (svara 200 ändå — avslöja aldrig att boten fastnade).
 */
export function validateChatInput(input: ChatInput): ValidChat | null | "bot" {
  if (typeof input.company === "string" && input.company.length > 0) return "bot";

  const name = typeof input.name === "string" ? input.name.trim().slice(0, 120) : "";
  const email = typeof input.email === "string" ? input.email.trim().slice(0, 200) : "";
  const message = typeof input.message === "string" ? input.message.trim().slice(0, 2000) : "";
  const pageUrl = typeof input.pageUrl === "string" ? input.pageUrl.trim().slice(0, 500) : "";

  if (!EMAIL_RE.test(email)) return null;
  if (message.length < 2) return null;

  return {
    name: name || null,
    email,
    message,
    pageUrl: pageUrl && /^https?:\/\//.test(pageUrl) ? pageUrl : null,
  };
}

/** Bygg ämnesraden för mejlet till ägaren. */
export function chatEmailSubject(propertyName: string, visitorName: string | null): string {
  return `💬 Nytt chattmeddelande till ${propertyName}${visitorName ? ` från ${visitorName}` : ""}`;
}

/** Textversionen av ägarmejlet (enkel, säker — ingen HTML-injektion). */
export function chatEmailBody(args: {
  propertyName: string;
  name: string | null;
  email: string;
  message: string;
  pageUrl: string | null;
}): string {
  return [
    `Nytt meddelande via chatt-widgeten på ${args.propertyName}:`,
    "",
    `Namn: ${args.name ?? "—"}`,
    `E-post: ${args.email}`,
    ...(args.pageUrl ? [`Sida: ${args.pageUrl}`] : []),
    "",
    args.message,
    "",
    "—",
    "Svara direkt på detta mejl för att nå besökaren.",
  ].join("\n");
}

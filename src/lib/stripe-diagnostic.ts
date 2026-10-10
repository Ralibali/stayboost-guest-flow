import type {
  StripeDiagnosticResult,
  StripeDiagnosticStatus,
} from "../../supabase/functions/_shared/stripe-diagnostic";

export const stripeDiagnosticLabels: Record<StripeDiagnosticStatus, string> = {
  read_access_confirmed: "Stripe godkände nyckeln och läsåtkomsten till Checkout.",
  configuration_invalid:
    "Stripe-inställningarna saknas eller behöver rättas. Ingen anslutningskontroll gjordes.",
  authentication_failed:
    "Stripe avvisade den sparade API-nyckeln. Kontrollera eller ersätt nyckeln.",
  permission_denied:
    "Stripe nekade åtkomst till Checkout. Kontrollera nyckelns läsbehörighet och åtkomstbegränsningar.",
  rate_limited: "Stripe begränsar antalet anrop just nu. Försök igen senare.",
  stripe_unavailable: "Stripe kunde inte besvara kontrollen. Försök igen senare.",
  unexpected_response: "Stripe gav ett oväntat svar. Anslutningen kunde inte verifieras.",
  timeout: "Stripe svarade inte inom fem sekunder. Försök igen senare.",
  connection_failed: "Anslutningen till Stripe kunde inte verifieras. Försök igen senare.",
};

export function readStripeDiagnostic(value: unknown): StripeDiagnosticResult | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Partial<StripeDiagnosticResult>;
  if (
    typeof data.status !== "string" ||
    !Object.hasOwn(stripeDiagnosticLabels, data.status) ||
    typeof data.checkedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(data.checkedAt) ||
    !Number.isFinite(Date.parse(data.checkedAt))
  )
    return null;
  return { status: data.status, checkedAt: data.checkedAt };
}

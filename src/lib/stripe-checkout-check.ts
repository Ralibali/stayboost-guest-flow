import type {
  StripeCheckoutDiagnosticResult,
  StripeCheckoutDiagnosticStatus,
} from "../../supabase/functions/_shared/stripe-checkout-diagnostic";

export const stripeCheckoutCheckLabels: Record<StripeCheckoutDiagnosticStatus, string> = {
  create_and_expire_confirmed: "Stripe kunde skapa och stänga den obetalda provsessionen.",
  in_progress: "En kontroll pågår redan. Kontrollera igen om en stund för att hämta resultatet.",
  configuration_invalid:
    "Stripe-inställningarna saknas eller behöver rättas. Ingen provsession skapades av den här kontrollen.",
  configuration_changed:
    "Stripe-inställningarna har ändrats. Den tidigare kontrollen behöver följas upp innan en ny kan köras.",
  authentication_failed:
    "Stripe avvisade den sparade API-nyckeln. Kontrollera eller ersätt nyckeln.",
  permission_denied:
    "Stripe nekade åtkomst till att skapa provsessionen. Kontrollera nyckelns behörigheter och åtkomstbegränsningar.",
  create_not_confirmed:
    "Det gick inte att bekräfta att provsessionen skapades. Kontrollera igen för att följa upp samma försök.",
  expiry_not_confirmed:
    "Provsessionsstängningen är inte bekräftad. Kontrollera igen för att följa upp samma försök.",
  attempt_requires_followup:
    "En tidigare kontroll behöver följas upp innan en ny provsession kan skapas.",
  diagnostic_unavailable:
    "Kontrollen kunde inte slutföras. Försök igen senare; ingen betalningsberedskap har verifierats.",
};

export function readStripeCheckoutCheck(value: unknown): StripeCheckoutDiagnosticResult | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Partial<StripeCheckoutDiagnosticResult>;
  if (
    typeof data.status !== "string" ||
    !Object.hasOwn(stripeCheckoutCheckLabels, data.status) ||
    typeof data.checkedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(data.checkedAt) ||
    !Number.isFinite(Date.parse(data.checkedAt))
  )
    return null;
  return { status: data.status, checkedAt: data.checkedAt };
}

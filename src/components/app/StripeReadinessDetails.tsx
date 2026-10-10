import type { LaunchReadiness } from "@/lib/launch-readiness";

export function StripeReadinessDetails({ readiness }: { readiness: LaunchReadiness | null }) {
  const details = [
    { label: "Betalningsnyckel", configured: readiness?.stripeConfigured },
    { label: "Betalningsbekräftelser", configured: readiness?.stripeWebhookConfigured },
  ];
  return (
    <div className="mt-4 rounded-xl border border-line p-4">
      <h3 className="text-sm font-semibold">Stripe – sparad konfiguration</h3>
      <dl className="mt-3 space-y-2 text-sm">
        {details.map(({ label, configured }) => (
          <div key={label} className="flex flex-wrap justify-between gap-x-4 gap-y-1">
            <dt>{label}</dt>
            <dd className={configured === true ? "text-forest" : "text-ink/65"}>
              {configured === true
                ? "Giltigt format"
                : configured === false
                  ? "Saknas eller behöver rättas"
                  : "Inte kontrollerat"}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs leading-relaxed text-ink/60">
        Kontrollen visar om de sparade Stripe-inställningarna har rätt format och är kopplade till
        den här anläggningen. En genomförd provbetalning behövs för att verifiera betalningen och
        dess bekräftelse. Inga nyckelvärden visas här.
      </p>
    </div>
  );
}

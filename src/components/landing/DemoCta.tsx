import { SignupCta } from "@/components/landing/SignupCta";
import { CONTACT_EMAIL, PRICE_LABEL } from "@/lib/sales-readiness";

type Variant = "light" | "dark";

/**
 * Demo / early-customer CTA. Reuses existing signup (`/app/login`) or mailto.
 * Does not invent Stripe live checkout for the StayBoost subscription.
 */
export function DemoCta({ location, variant = "light" }: { location: string; variant?: Variant }) {
  const dark = variant === "dark";
  const mailto = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("StayBoost — tidig kund")}`;

  return (
    <div>
      <SignupCta location={location} variant={variant} buttonLabel="Skapa konto — visa flödet" />
      <p className={`mt-3 text-sm ${dark ? "text-white/75" : "text-[color:var(--ink)]/70"}`}>
        Eller skriv till{" "}
        <a
          href={mailto}
          className={
            dark
              ? "underline decoration-white/40 underline-offset-2 hover:text-white"
              : "underline decoration-[color:var(--ink)]/30 underline-offset-2 hover:text-[color:var(--ink)]"
          }
        >
          {CONTACT_EMAIL}
        </a>
        . Ingen kortbetalning för {PRICE_LABEL} här — det finns ingen Stripe-checkout för
        abonnemanget.
      </p>
    </div>
  );
}

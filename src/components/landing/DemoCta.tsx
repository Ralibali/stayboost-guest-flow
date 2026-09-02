import { Link } from "@tanstack/react-router";
import { SignupCta } from "@/components/landing/SignupCta";
import { CONTACT_EMAIL, PRICE_LABEL, PRODUCT_DEMO_PATH } from "@/lib/sales-readiness";

type Variant = "light" | "dark";

/**
 * Demo / early-customer CTA. Prospect demo is existing `/produkten` (example data).
 * `/demo` is 404 — do not invent it. Signup stays `/app/login`. No Stripe live checkout.
 */
export function DemoCta({ location, variant = "light" }: { location: string; variant?: Variant }) {
  const dark = variant === "dark";
  const mailto = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("StayBoost — tidig kund")}`;

  return (
    <div>
      <Link to="/produkten" className="btn-primary mb-3 w-full sm:w-auto">
        Öppna produktdemon
      </Link>
      <p className={`mb-4 text-xs ${dark ? "text-white/55" : "text-[color:var(--ink)]/50"}`}>
        Exempeldata på {PRODUCT_DEMO_PATH}. Det finns ingen /demo-sida.
      </p>
      <SignupCta location={location} variant={variant} buttonLabel="Skapa konto" />
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

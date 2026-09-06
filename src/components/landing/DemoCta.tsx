import { Link } from "@tanstack/react-router";
import { CONTACT_EMAIL, PRICE_LABEL, PRODUCT_DEMO_PATH } from "@/lib/sales-readiness";

type Variant = "light" | "dark";

/**
 * Prospect CTA. Only existing `/produkten` (example data) or mailto.
 * Open signup in an unisolated project is not a sell path. `/demo` is 404.
 */
export function DemoCta({ variant = "light" }: { location?: string; variant?: Variant }) {
  const dark = variant === "dark";
  const mailto = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("StayBoost — tidig kund")}`;

  return (
    <div>
      <Link to="/produkten" className="btn-primary w-full sm:w-auto">
        Öppna produktdemon
      </Link>
      <p className={`mt-3 text-sm ${dark ? "text-white/75" : "text-[color:var(--ink)]/70"}`}>
        Exempeldata på {PRODUCT_DEMO_PATH}. Det finns ingen /demo-sida. Öppen signup är inte
        säljvägen — isolation är obevisad. Skriv till{" "}
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
        . Ingen kortbetalning för {PRICE_LABEL} här.
      </p>
    </div>
  );
}

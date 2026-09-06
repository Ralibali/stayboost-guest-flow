import { Link } from "@tanstack/react-router";
import {
  ANALYTICS_CTAS,
  ANALYTICS_SURFACES,
  trackCtaClicked,
  type CtaClickedProps,
} from "@/lib/analytics";

type Variant = "light" | "dark";

interface Props {
  location: "hero" | "pricing" | "calculator" | "final" | string;
  variant?: Variant;
  buttonLabel?: string;
  className?: string;
  plan?: CtaClickedProps["plan"];
}

/**
 * Primär sälj-CTA: produktdemon på /produkten (exempeldata).
 * Öppen signup är inte säljvägen. Lead Magnet får fortfarande fånga e-post
 * utan att skapa konto.
 */
export function SignupCta({
  location,
  variant = "light",
  buttonLabel = "Öppna produktdemon",
  className = "",
  plan,
}: Props) {
  const dark = variant === "dark";

  const track = () => {
    trackCtaClicked({
      surface: ANALYTICS_SURFACES.LANDING,
      cta: ANALYTICS_CTAS.OPPN_A_PRODUKTDEMON,
      location,
      ...(plan ? { plan } : {}),
    });
  };

  return (
    <div className={className}>
      <Link
        to="/produkten"
        onClick={track}
        className="btn-primary inline-flex w-full justify-center sm:w-auto"
      >
        {buttonLabel}
      </Link>
      <p className={`mt-2 text-xs ${dark ? "text-white/60" : "text-[color:var(--ink)]/55"}`}>
        449 kr/mån. Titta på /produkten — exempeldata. Sirvoy är kvar.{" "}
        <Link
          to="/app/login"
          className={
            dark
              ? "underline decoration-white/40 underline-offset-2 hover:text-white"
              : "underline decoration-[color:var(--ink)]/30 underline-offset-2 hover:text-[color:var(--ink)]"
          }
        >
          Logga in
        </Link>
      </p>
    </div>
  );
}

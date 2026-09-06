import { Link } from "@tanstack/react-router";

type Variant = "light" | "dark";

interface Props {
  location: "hero" | "pricing" | "calculator" | "final" | string;
  variant?: Variant;
  buttonLabel?: string;
  className?: string;
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
}: Props) {
  const dark = variant === "dark";

  const track = () => {
    if (typeof window !== "undefined") {
      const w = window as unknown as {
        plausible?: (ev: string, o?: { props?: Record<string, string> }) => void;
      };
      w.plausible?.("Signup CTA", { props: { location } });
    }
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

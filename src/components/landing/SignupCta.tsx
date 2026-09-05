import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Registrerings-CTA. Tar gärna emot e-post och förifyller den i
 * kontoskapandet på /app/login — ingen väntelista, riktigt konto direkt.
 */
export function SignupCta({
  location,
  variant = "light",
  buttonLabel = "Kom igång",
  className = "",
  plan,
}: Props) {
  const [email, setEmail] = useState("");
  const navigate = useNavigate();
  const dark = variant === "dark";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    trackCtaClicked({
      surface: ANALYTICS_SURFACES.LANDING,
      cta: ANALYTICS_CTAS.KOM_IGANG,
      location,
      ...(plan ? { plan } : {}),
    });
    navigate({
      to: "/app/login",
      search: EMAIL_RE.test(trimmed) ? { mode: "up", email: trimmed } : { mode: "up" },
    });
  };

  return (
    <div className={className}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor={`su-${location}`} className="sr-only">
          E-post
        </label>
        <input
          id={`su-${location}`}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="din@epost.se"
          aria-label="Din e-postadress"
          className={`flex-1 rounded-[2px] border px-4 py-3 text-base outline-none focus:border-[color:var(--brass)] ${
            dark
              ? "border-white/25 bg-white/10 text-white placeholder:text-white/50"
              : "border-[color:var(--line)] bg-white text-[color:var(--ink)]"
          }`}
        />
        <button type="submit" className="btn-primary">
          {buttonLabel}
        </button>
      </form>
      <p className={`mt-2 text-xs ${dark ? "text-white/60" : "text-[color:var(--ink)]/55"}`}>
        449 kr/mån. Ingen bindningstid — igång på en kväll.
      </p>
    </div>
  );
}

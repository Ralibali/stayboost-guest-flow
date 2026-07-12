import { useState } from "react";
import { motion } from "framer-motion";
import { z } from "zod";
import { useServerFn } from "@tanstack/react-start";
import { subscribe } from "@/lib/subscribe.functions";

const schema = z.object({
  email: z.string().trim().email({ message: "Ange en giltig e-postadress" }).max(255),
  consent: z.boolean().refine((value) => value, { message: "Godkänn villkoret för att ansöka" }),
});

type Variant = "light" | "dark";

interface Props {
  location: "hero" | "pricing" | "calculator" | "final" | string;
  variant?: Variant;
  buttonLabel?: string;
  className?: string;
}

export function EarlyAccessForm({
  location,
  variant = "light",
  buttonLabel = "Ansök om pilotplats",
  className = "",
}: Props) {
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const call = useServerFn(subscribe);
  const dark = variant === "dark";
  const fieldId = `pilot-${location}`;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = schema.safeParse({ email, consent });
    if (!parsed.success) {
      setState("error");
      setError(parsed.error.issues[0]?.message ?? "Kontrollera uppgifterna");
      return;
    }

    setError(null);
    setState("loading");

    try {
      const result = await call({
        data: {
          email: parsed.data.email,
          consent: true,
          source: "pilot",
          website,
        },
      });

      if (result.ok) {
        setState("ok");
        if (typeof window !== "undefined") {
          const analytics = window as unknown as {
            plausible?: (event: string, options?: { props?: Record<string, string> }) => void;
          };
          analytics.plausible?.("Pilot Application", { props: { location } });
        }
        return;
      }

      setState("error");
      setError(
        result.error === "rate_limited"
          ? "Du har skickat flera förfrågningar. Försök igen senare."
          : "Något gick fel — mejla info@auroramedia.se så hjälper vi dig.",
      );
    } catch {
      setState("error");
      setError("Något gick fel — mejla info@auroramedia.se så hjälper vi dig.");
    }
  };

  if (state === "ok") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        aria-live="polite"
        className={`rounded-xl border border-[color:var(--brass)]/50 bg-[color:var(--brass)]/10 px-4 py-4 font-semibold ${
          dark ? "text-white" : "text-[color:var(--brass)]"
        } ${className}`}
      >
        Tack! Vi kontaktar dig om pilotupplägget inom kort.
      </motion.div>
    );
  }

  return (
    <div className={className}>
      <form onSubmit={submit} noValidate className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <label htmlFor={fieldId} className="sr-only">
            E-postadress
          </label>
          <input
            id={fieldId}
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="din@epost.se"
            aria-label="Din e-postadress"
            aria-invalid={state === "error"}
            aria-describedby={error ? `${fieldId}-error` : `${fieldId}-help`}
            disabled={state === "loading"}
            className={`min-w-0 flex-1 rounded-xl border px-4 py-3 text-base outline-none focus:border-[color:var(--brass)] ${
              dark
                ? "border-white/25 bg-white/10 text-white placeholder:text-white/50"
                : "border-[color:var(--line)] bg-white text-[color:var(--ink)]"
            }`}
          />
          <button
            type="submit"
            disabled={state === "loading"}
            className="btn-primary shrink-0 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {state === "loading" ? (
              <span className="inline-flex items-center gap-2">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                Skickar…
              </span>
            ) : (
              buttonLabel
            )}
          </button>
        </div>

        <label
          className={`flex cursor-pointer items-start gap-2 text-left text-xs ${
            dark ? "text-white/70" : "text-[color:var(--ink)]/65"
          }`}
        >
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
            className="mt-1 h-4 w-4 shrink-0 accent-[color:var(--brass)]"
          />
          <span>
            Jag godkänner att StayBoost kontaktar mig om pilotprogrammet. Läs vår{" "}
            <a className="underline" href="/integritet.html">
              integritetspolicy
            </a>
            .
          </span>
        </label>

        <div className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden" aria-hidden>
          <label htmlFor={`${fieldId}-website`}>Webbplats</label>
          <input
            id={`${fieldId}-website`}
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
          />
        </div>
      </form>

      {error && (
        <p
          id={`${fieldId}-error`}
          className={`mt-2 text-sm ${dark ? "text-red-200" : "text-red-700"}`}
          role="alert"
        >
          {error}
        </p>
      )}
      <p
        id={`${fieldId}-help`}
        className={`mt-2 text-xs ${dark ? "text-white/60" : "text-[color:var(--ink)]/55"}`}
      >
        Begränsat antal pilotplatser. Ingen bindningstid och ingen startavgift under piloten.
      </p>
    </div>
  );
}

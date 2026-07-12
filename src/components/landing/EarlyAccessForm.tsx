import { useState } from "react";
import { motion } from "framer-motion";
import { z } from "zod";
import { useServerFn } from "@tanstack/react-start";
import { subscribe } from "@/lib/subscribe.functions";

const schema = z.object({
  email: z.string().trim().email({ message: "Ange en giltig e-postadress" }).max(255),
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
  buttonLabel = "Få tidig tillgång",
  className = "",
}: Props) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const call = useServerFn(subscribe);

  const dark = variant === "dark";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ email });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Ogiltig e-post");
      return;
    }
    setError(null);
    setState("loading");
    try {
      const res = await call({ data: { email: parsed.data.email, source: "early-access" } });
      if (res.ok) {
        setState("ok");
        if (typeof window !== "undefined") {
          const w = window as unknown as {
            plausible?: (e: string, o?: { props?: Record<string, string> }) => void;
          };
          w.plausible?.("EarlyAccess Signup", { props: { location } });
        }
      } else {
        setState("error");
        setError("Något gick fel — försök igen.");
      }
    } catch {
      setState("error");
      setError("Något gick fel — försök igen.");
    }
  };

  if (state === "ok") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className={`rounded-xl border border-[color:var(--brass)]/50 bg-[color:var(--brass)]/10 px-4 py-3 font-semibold text-[color:var(--brass)] ${className}`}
      >
        Tack! Du står på listan ✓
      </motion.div>
    );
  }

  return (
    <div className={className}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor={`ea-${location}`} className="sr-only">
          E-post
        </label>
        <input
          id={`ea-${location}`}
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="din@epost.se"
          aria-label="Din e-postadress"
          aria-invalid={state === "error"}
          aria-describedby={error ? `ea-${location}-err` : undefined}
          disabled={state === "loading"}
          className={`flex-1 rounded-xl border px-4 py-3 text-base outline-none focus:border-[color:var(--brass)] ${
            dark
              ? "border-white/25 bg-white/10 text-white placeholder:text-white/50"
              : "border-[color:var(--line)] bg-white text-[color:var(--ink)]"
          }`}
        />
        <button
          type="submit"
          disabled={state === "loading"}
          className="btn-primary disabled:opacity-70"
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
      </form>
      {error && (
        <p
          id={`ea-${location}-err`}
          className={`mt-2 text-sm ${dark ? "text-red-200" : "text-red-700"}`}
        >
          {error}
        </p>
      )}
      <p className={`mt-2 text-xs ${dark ? "text-white/60" : "text-[color:var(--ink)]/55"}`}>
        Lanseringspris för de första 20 anläggningarna. Ingen spam.
      </p>
    </div>
  );
}

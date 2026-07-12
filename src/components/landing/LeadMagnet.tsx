import { useState } from "react";
import { motion } from "framer-motion";
import { z } from "zod";
import { useServerFn } from "@tanstack/react-start";
import { subscribe } from "@/lib/subscribe.functions";

const schema = z.object({
  email: z.string().trim().email({ message: "Ange en giltig e-postadress" }).max(255),
  consent: z.boolean().refine((value) => value, {
    message: "Godkänn villkoret för att få guiden",
  }),
});

export function LeadMagnet() {
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const call = useServerFn(subscribe);

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
          source: "sms-mallar",
          website,
        },
      });

      if (result.ok) {
        setState("ok");
        if (typeof window !== "undefined") {
          const analytics = window as unknown as { plausible?: (event: string) => void };
          analytics.plausible?.("SMS Guide Requested");
        }
        return;
      }

      setState("error");
      setError(
        result.error === "rate_limited"
          ? "Du har skickat flera förfrågningar. Försök igen senare."
          : "Något gick fel — försök igen.",
      );
    } catch {
      setState("error");
      setError("Något gick fel — försök igen.");
    }
  };

  return (
    <section id="mallar" className="border-t border-[color:var(--line)] bg-white/60 py-20 md:py-28">
      <div className="mx-auto grid max-w-[1120px] items-center gap-12 px-6 md:grid-cols-[1.1fr_0.9fr]">
        <div>
          <p className="eyebrow">Gratis SMS-guide</p>
          <h2 className="mt-3" style={{ fontSize: "clamp(2rem, 4vw, 3rem)" }}>
            12 färdiga meddelanden för hela gästresan.
          </h2>
          <p className="mt-5 max-w-lg text-[color:var(--ink)]/75">
            Välkomstinfo, incheckning, tillval, lokala tips och omdömesfråga. Kopiera dem
            direkt eller använd dem som grund i StayBoost.
          </p>

          {state === "ok" ? (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              aria-live="polite"
              className="mt-8 rounded-xl border border-[color:var(--brass)]/40 bg-[color:var(--brass)]/5 p-5"
            >
              <p className="font-semibold text-[color:var(--ink)]">Klart — guiden är upplåst.</p>
              <p className="mt-1 text-sm text-[color:var(--ink)]/70">
                Den öppnas som en utskriftsvänlig webbsida som du även kan spara som PDF.
              </p>
              <a
                href="/mallar/stayboost-12-sms.html"
                target="_blank"
                rel="noopener"
                className="btn-primary mt-4"
              >
                Öppna SMS-guiden →
              </a>
            </motion.div>
          ) : (
            <form onSubmit={submit} className="mt-8 space-y-3" noValidate>
              <div className="flex flex-col gap-3 sm:flex-row">
                <label className="sr-only" htmlFor="lead-email">
                  E-post
                </label>
                <input
                  id="lead-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="din@epost.se"
                  className="min-w-0 flex-1 rounded-xl border border-[color:var(--line)] bg-white px-4 py-3 text-base outline-none focus:border-[color:var(--brass)]"
                  aria-invalid={state === "error"}
                  aria-describedby={error ? "lead-error" : "lead-help"}
                  disabled={state === "loading"}
                />
                <button
                  type="submit"
                  disabled={state === "loading"}
                  className="btn-primary shrink-0 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {state === "loading" ? "Skickar…" : "Få gratisguiden"}
                </button>
              </div>

              <label className="flex cursor-pointer items-start gap-2 text-left text-xs text-[color:var(--ink)]/65">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                  className="mt-1 h-4 w-4 shrink-0 accent-[color:var(--brass)]"
                />
                <span>
                  Jag godkänner att StayBoost skickar guiden och relevanta uppföljningar. Jag
                  kan avregistrera mig när som helst. Läs vår{" "}
                  <a className="underline" href="/integritet.html">
                    integritetspolicy
                  </a>
                  .
                </span>
              </label>

              <div className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden" aria-hidden>
                <label htmlFor="lead-website">Webbplats</label>
                <input
                  id="lead-website"
                  tabIndex={-1}
                  autoComplete="off"
                  value={website}
                  onChange={(event) => setWebsite(event.target.value)}
                />
              </div>
            </form>
          )}

          {error && (
            <p id="lead-error" className="mt-2 text-sm text-red-700" role="alert">
              {error}
            </p>
          )}
          <p id="lead-help" className="mt-3 text-xs text-[color:var(--ink)]/55">
            Praktiska mallar från en svensk glampingverksamhet — inga generiska AI-texter.
          </p>
        </div>

        <div className="flex justify-center md:justify-end">
          <div
            className="relative w-full max-w-[280px] rotate-2 rounded-2xl bg-[color:var(--forest)] p-8 shadow-[0_30px_70px_-20px_rgba(20,36,28,0.5)]"
            style={{ aspectRatio: "3 / 4" }}
            aria-hidden
          >
            <div className="absolute inset-0 rounded-2xl bg-[radial-gradient(circle_at_top_right,rgba(176,141,62,0.25),transparent_60%)]" />
            <div className="relative flex h-full flex-col">
              <div className="text-[0.62rem] uppercase tracking-[0.2em] text-[color:var(--brass)]">
                Gratis guide
              </div>
              <div className="mt-2 h-px w-10 bg-[color:var(--brass)]" />
              <h3
                className="mt-6 font-[Fraunces] font-semibold text-white"
                style={{ fontSize: "clamp(1.5rem, 3.5vw, 2rem)", lineHeight: 1.05 }}
              >
                12 gäst-SMS som gör jobbet
              </h3>
              <p className="mt-3 text-[0.72rem] leading-relaxed text-white/70">
                Kopiera-och-skicka-mallar från bokning till omdöme.
              </p>
              <div className="mt-auto">
                <div className="text-[0.6rem] uppercase tracking-widest text-white/40">
                  StayBoost
                </div>
                <div className="text-[0.7rem] text-white/60">Bergs Slussar Glamping</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

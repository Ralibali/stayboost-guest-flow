import { useState } from "react";
import { motion } from "framer-motion";
import { useServerFn } from "@tanstack/react-start";
import { sendDemoSms } from "@/lib/sms.functions";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_number: "Ange ett giltigt svenskt mobilnummer (07x…).",
  number_used: "Det numret har nyligen fått ett demo-SMS.",
  ip_limit: "Du har redan begärt flera SMS idag — försök igen i morgon.",
  global_limit: "Dagens demogräns är nådd. Prova igen i morgon.",
  server_error: "SMS:et kunde inte skickas just nu. Försök igen.",
};

export function DemoSms() {
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const call = useServerFn(sendDemoSms);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (phone.trim().length < 6) {
      setState("error");
      setError(ERROR_MESSAGES.invalid_number);
      return;
    }

    setError(null);
    setState("loading");

    try {
      const result = await call({ data: { phone, website } });
      if (result.ok) {
        setState("ok");
        if (typeof window !== "undefined") {
          const analytics = window as unknown as { plausible?: (event: string) => void };
          analytics.plausible?.("Demo SMS Sent");
        }
        return;
      }

      setState("error");
      setError(ERROR_MESSAGES[result.error] ?? ERROR_MESSAGES.server_error);
    } catch {
      setState("error");
      setError(ERROR_MESSAGES.server_error);
    }
  };

  return (
    <section
      id="demo-sms"
      className="border-t border-[color:var(--line)] bg-white/60 py-20 md:py-28"
    >
      <div className="mx-auto max-w-2xl px-6 text-center">
        <p className="eyebrow">Testa själv</p>
        <h2 className="mt-3" style={{ fontSize: "clamp(2rem, 4vw, 3rem)" }}>
          Få ett riktigt StayBoost-SMS.
        </h2>
        <p className="mt-5 text-[color:var(--ink)]/75">
          Ange ditt nummer så skickar vi ett exempel på meddelandet som gästen kan få före
          ankomst. Du behöver inget konto.
        </p>

        {state === "ok" ? (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            aria-live="polite"
            className="mx-auto mt-8 max-w-md rounded-xl border border-[color:var(--brass)]/50 bg-[color:var(--brass)]/10 px-4 py-4 font-semibold text-[color:var(--brass)]"
          >
            Skickat! Kolla telefonen.
          </motion.div>
        ) : (
          <>
            <form
              onSubmit={submit}
              noValidate
              className="mx-auto mt-8 flex max-w-md flex-col gap-2 sm:flex-row"
            >
              <label htmlFor="demo-sms-phone" className="sr-only">
                Mobilnummer
              </label>
              <input
                id="demo-sms-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                required
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="070-123 45 67"
                aria-label="Ditt svenska mobilnummer"
                aria-invalid={state === "error"}
                aria-describedby={error ? "demo-sms-error" : "demo-sms-help"}
                disabled={state === "loading"}
                className="flex-1 rounded-xl border border-[color:var(--line)] bg-white px-4 py-3 text-base outline-none focus:border-[color:var(--brass)]"
              />
              <div className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden" aria-hidden>
                <label htmlFor="demo-sms-website">Webbplats</label>
                <input
                  id="demo-sms-website"
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                  value={website}
                  onChange={(event) => setWebsite(event.target.value)}
                />
              </div>
              <button
                type="submit"
                disabled={state === "loading"}
                className="btn-primary disabled:cursor-not-allowed disabled:opacity-70"
              >
                {state === "loading" ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    Skickar…
                  </span>
                ) : (
                  "Skicka demo-SMS"
                )}
              </button>
            </form>
            {error && (
              <p id="demo-sms-error" className="mt-3 text-sm text-red-700" role="alert">
                {error}
              </p>
            )}
            <p id="demo-sms-help" className="mt-3 text-xs text-[color:var(--ink)]/55">
              Kostnadsfritt. Numret används bara för demon. En hash sparas tillfälligt för
              missbruksskydd. Läs vår <a className="underline" href="/integritet.html">integritetspolicy</a>.
            </p>
          </>
        )}
      </div>
    </section>
  );
}

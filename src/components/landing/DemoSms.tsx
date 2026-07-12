import { useState } from "react";
import { motion } from "framer-motion";
import { useServerFn } from "@tanstack/react-start";
import { sendDemoSms } from "@/lib/sms.functions";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_number: "Ange ett giltigt svenskt mobilnummer (07x…).",
  number_used: "Det numret har fått max antal demo-SMS idag.",
  ip_limit: "Du har redan begärt några SMS idag — försök igen i morgon.",
  global_limit: "Vi har nått dagens demogräns. Prova igen i morgon.",
  server_error: "Något gick fel — försök igen.",
};

type Scenario = {
  key: "valkomst" | "portkod" | "frukost" | "sen-utcheckning" | "omdome";
  label: string;
  emoji: string;
  hint: string;
};

const SCENARIOS: Scenario[] = [
  { key: "valkomst", label: "Välkomst", emoji: "👋", hint: "2 dagar före ankomst" },
  { key: "portkod", label: "Portkod", emoji: "🔑", hint: "Ankomstdagen" },
  { key: "frukost", label: "Frukostkorg", emoji: "🥐", hint: "Kväll 1" },
  { key: "sen-utcheckning", label: "Sen utcheckning", emoji: "⏰", hint: "Dagen innan avresa" },
  { key: "omdome", label: "Omdöme", emoji: "⭐", hint: "Dagen efter avresa" },
];

export function DemoSms() {
  const [phone, setPhone] = useState("");
  const [scenario, setScenario] = useState<Scenario["key"]>("valkomst");
  const [state, setState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastSent, setLastSent] = useState<Scenario["key"] | null>(null);
  const call = useServerFn(sendDemoSms);

  const activeLabel = SCENARIOS.find((s) => s.key === scenario)?.label ?? "";

  const send = async () => {
    if (phone.trim().length < 6) {
      setError(ERROR_MESSAGES.invalid_number);
      setState("error");
      return;
    }
    setError(null);
    setState("loading");
    try {
      const res = await call({ data: { phone, scenario } });
      if (res.ok) {
        setState("ok");
        setLastSent(scenario);
        if (typeof window !== "undefined") {
          const w = window as unknown as {
            plausible?: (e: string, opts?: { props?: Record<string, string> }) => void;
          };
          w.plausible?.("Demo SMS Sent", { props: { scenario } });
        }
      } else {
        setState("error");
        setError(ERROR_MESSAGES[res.error] ?? ERROR_MESSAGES.server_error);
      }
    } catch {
      setState("error");
      setError(ERROR_MESSAGES.server_error);
    }
  };

  return (
    <section
      id="demo-sms"
      className="border-t border-[color:var(--line)] bg-white/60 py-16 sm:py-20 md:py-28"
    >
      <div className="mx-auto max-w-3xl px-5 sm:px-6 text-center">
        <p className="eyebrow">Testa själv — inget konto</p>
        <h2
          className="mt-3 tracking-tight"
          style={{ fontSize: "clamp(1.85rem, 5vw, 3rem)", lineHeight: 1.1 }}
        >
          Skicka ett demo-SMS till dig själv.
        </h2>
        <p className="mt-4 text-[color:var(--ink)]/75 sm:mt-5">
          Välj vilket meddelande i gästresan du vill känna på — vi skickar det till ditt nummer med
          påhittad gästdata. Tar 30 sekunder.
        </p>

        {/* Scenario picker */}
        <div
          role="radiogroup"
          aria-label="Välj demo-SMS"
          className="mx-auto mt-8 flex max-w-2xl flex-wrap justify-center gap-2 sm:gap-2.5"
        >
          {SCENARIOS.map((s) => {
            const active = s.key === scenario;
            return (
              <button
                key={s.key}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => {
                  setScenario(s.key);
                  if (state === "ok") setState("idle");
                }}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[0.85rem] font-medium transition sm:text-sm ${
                  active
                    ? "border-[color:var(--brass)] bg-[color:var(--brass)] text-white shadow-[0_6px_20px_-8px_color-mix(in_oklab,var(--brass)_60%,transparent)]"
                    : "border-[color:var(--line)] bg-white text-[color:var(--ink)]/75 hover:border-[color:var(--brass)]/60 hover:text-[color:var(--ink)]"
                }`}
              >
                <span aria-hidden>{s.emoji}</span>
                {s.label}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-[0.8rem] text-[color:var(--ink)]/55">
          {SCENARIOS.find((s) => s.key === scenario)?.hint}
        </p>

        {/* Phone + send */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          noValidate
          className="mx-auto mt-6 flex max-w-md flex-col gap-2 sm:flex-row"
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
            onChange={(e) => setPhone(e.target.value)}
            placeholder="070-123 45 67"
            aria-label="Ditt svenska mobilnummer"
            aria-invalid={state === "error"}
            disabled={state === "loading"}
            className="flex-1 rounded-xl border border-[color:var(--line)] bg-white px-4 py-3 text-base outline-none focus:border-[color:var(--brass)]"
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
              `Skicka ${activeLabel.toLowerCase()}-SMS`
            )}
          </button>
        </form>

        {state === "ok" && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            role="status"
            aria-live="polite"
            className="mx-auto mt-5 max-w-md rounded-xl border border-[color:var(--brass)]/50 bg-[color:var(--brass)]/10 px-4 py-3 text-[color:var(--ink)]"
          >
            <p className="font-semibold text-[color:var(--brass)]">Skickat! Kolla telefonen.</p>
            {lastSent && (
              <p className="mt-1 text-sm text-[color:var(--ink)]/75">
                {SCENARIOS.find((s) => s.key === lastSent)?.emoji}{" "}
                {SCENARIOS.find((s) => s.key === lastSent)?.label} — vill du testa ett till? Välj en
                annan scen ovan.
              </p>
            )}
          </motion.div>
        )}
        {error && (
          <p className="mt-3 text-sm text-red-700" role="alert">
            {error}
          </p>
        )}
        <p className="mt-3 text-xs text-[color:var(--ink)]/55">
          Max 5 SMS per nummer/dag. Ditt nummer sparas inte för utskick.
        </p>
      </div>
    </section>
  );
}

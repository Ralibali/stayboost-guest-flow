import { useState } from "react";
import { motion } from "framer-motion";
import { z } from "zod";

const schema = z.object({
  email: z
    .string()
    .trim()
    .email({ message: "Ange en giltig e-postadress" })
    .max(255),
});

export function LeadMagnet() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ email });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Ogiltig e-post");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      // TODO: koppla till Brevo-serverfunktion med SOURCE="sms-mallar"
      // och lista BREVO_TEMPLATES_LIST_ID. Ligger som tidig-tillgång-flödet.
      await new Promise((r) => setTimeout(r, 500));
      setSent(true);
      // TODO: Plausible-event "Lead Magnet Download"
      if (typeof window !== "undefined") {
        const w = window as unknown as {
          plausible?: (e: string) => void;
        };
        w.plausible?.("Lead Magnet Download");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <section id="mallar" className="border-t border-[color:var(--line)] bg-white/60 py-20 md:py-28">
      <div className="mx-auto grid max-w-[1120px] items-center gap-12 px-6 md:grid-cols-[1.1fr_0.9fr]">
        <div>
          <p className="eyebrow">Gratis mallar</p>
          <h2 className="mt-3" style={{ fontSize: "clamp(2rem, 4vw, 3rem)" }}>
            De exakta SMS:en vi skickar till <em className="italic text-[color:var(--brass)]">våra egna</em> gäster.
          </h2>
          <p className="mt-5 max-w-lg text-[color:var(--ink)]/75">
            Beprövade på en riktig anläggning en hel säsong: välkomst, portkod,
            tillvalserbjudanden och omdömesfrågan som faktiskt får svar. Kopiera,
            klistra in, skicka — eller låt StayBoost skicka dem automatiskt.
          </p>

          <form onSubmit={submit} className="mt-8 flex flex-col gap-3 sm:flex-row" noValidate>
            <label className="sr-only" htmlFor="lead-email">E-post</label>
            <input
              id="lead-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="din@epost.se"
              className="flex-1 rounded-xl border border-[color:var(--line)] bg-white px-4 py-3 text-base outline-none focus:border-[color:var(--brass)]"
              aria-invalid={!!error}
              aria-describedby={error ? "lead-error" : undefined}
              disabled={sent}
            />
            <button
              type="submit"
              disabled={loading || sent}
              className="btn-primary"
            >
              {sent ? "Skickat ✓" : loading ? "Skickar…" : "Skicka mallarna till mig"}
            </button>
          </form>
          {error && (
            <p id="lead-error" className="mt-2 text-sm text-red-700">
              {error}
            </p>
          )}
          {sent && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 rounded-xl border border-[color:var(--brass)]/40 bg-[color:var(--brass)]/5 p-4"
            >
              <p className="text-sm text-[color:var(--ink)]/80">
                Kolla inkorgen — och under tiden:
              </p>
              {/* TODO: ladda upp PDF till public/mallar/stayboost-12-sms.pdf */}
              <a
                href="/mallar/stayboost-12-sms.pdf"
                className="mt-2 inline-flex items-center gap-2 font-semibold text-[color:var(--brass)]"
                download
              >
                Ladda ner PDF:en →
              </a>
            </motion.div>
          )}
          <p className="mt-3 text-xs text-[color:var(--ink)]/55">
            Vi mejlar mallarna direkt. Avregistrera med ett klick när som helst.
          </p>
        </div>

        {/* PDF mockup */}
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
                12 gäst-SMS som säljer
              </h3>
              <p className="mt-3 text-[0.72rem] leading-relaxed text-white/70">
                Kopiera-och-skicka-mallar för hela gästresan — från bokningsbekräftelse
                till omdömesfråga.
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

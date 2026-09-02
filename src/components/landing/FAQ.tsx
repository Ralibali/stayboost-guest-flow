import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const ITEMS = [
  {
    q: "Fungerar det med Sirvoy och Booking.com?",
    a: "Nej. StayBoost är inte channel manager. Sirvoy är kvar. Vi hämtar inte Booking.com automatiskt. Booking.com pollar ofta bara var 2–4:e timme. SAFE_TO_CANCEL_SIRVOY = NEJ.",
  },
  {
    q: "Behöver mina gäster ladda ner en app?",
    a: "Nej. Allt sker via vanliga sms och en webblänk som öppnas direkt i mobilen. Inget konto, ingen inloggning.",
  },
  {
    q: "Hur lång tid tar det att komma igång?",
    a: "Nej, inte en kväll som cutover. Sirvoy sitter kvar. Första kunderna kör parallellt med det de redan har.",
  },
  {
    q: "Vad händer om en gäst svarar på ett sms?",
    a: 'Du får svaret direkt i din inkorg i StayBoost och kan svara därifrån — eller låta automatiken hantera vanliga svar som "JA" på ett tillval.',
  },
  {
    q: "Kan jag skriva mina egna meddelanden?",
    a: "Självklart. Mallarna är en start — varje meddelande går att redigera, och du kan bygga egna flöden med dina egna ord.",
  },
  {
    q: "Vad kostar sms:en?",
    a: "Kod och en sms-pilot finns. Cron för utskick är inte bevisat i drift. Sms ingår i StayBoost-abonnemanget och debiteras inte separat. Det finns ingen sms-pott, inga credits och ingen extra kostnad per skickat sms.",
  },
  {
    q: "Funkar det för min personal?",
    a: "Ja — det är halva poängen. Frukost- och städvyerna har egna enkla inloggningar, funkar i mobilen och finns på flera språk. Personalen ser exakt vad som ska göras: antal portioner, allergier, handdukar per tält.",
  },
  {
    q: "Kan gäster hyra saker själva, som SUP eller bastu?",
    a: "Ja. Skapa ett tillval med kodlås: gästen betalar i mobilen och får koden direkt. Perfekt för SUP, bastu, cyklar och annat som inte kräver att du är på plats.",
  },
  {
    q: "Vi använder inte Sirvoy — funkar det ändå?",
    a: "Nej. Kanalhantering är inte redo. Booking.com utan Sirvoy är inte ett säljargument. Sirvoy är kvar. SAFE_TO_CANCEL_SIRVOY = NEJ.",
  },
  {
    q: "Kan vi säga upp Sirvoy när vi börjar med StayBoost?",
    a: "Nej. Sirvoy är kvar tills sista utcheckningen. StayBoost kör parallellt — webhook för nya bokningar och iCal för att blockera nätter. Historiken importeras inte automatiskt. Slå inte av Sirvoys kanaler.",
  },
  {
    q: "Är min anläggning isolerad från andra kunders data?",
    a: "Nej. Isolation är obevisad. Läs Tidiga kunder.",
  },
];

export function FAQ() {
  const [open, setOpen] = useState<number | null>(0);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: ITEMS.map((it) => ({
      "@type": "Question",
      name: it.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: it.a,
      },
    })),
  };

  return (
    <section id="faq" className="py-14 sm:py-20 md:py-32">
      <div className="mx-auto max-w-3xl px-6">
        <div className="text-center">
          <p className="eyebrow">Vanliga frågor</p>
          <h2 className="mt-3" style={{ fontSize: "clamp(2rem, 4vw, 3rem)" }}>
            Frågor vi får varje vecka.
          </h2>
        </div>

        <div className="mt-12 border-t border-[color:var(--line)]">
          {ITEMS.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={i} className="border-b border-[color:var(--line)]">
                <button
                  onClick={() => {
                    const next = isOpen ? null : i;
                    setOpen(next);
                    if (next !== null && typeof window !== "undefined") {
                      const w = window as unknown as {
                        plausible?: (e: string, o?: { props?: Record<string, string> }) => void;
                      };
                      w.plausible?.("FAQ Opened", { props: { question: item.q } });
                    }
                  }}
                  className="flex w-full items-center justify-between gap-4 py-6 text-left"
                  aria-expanded={isOpen}
                >
                  <span className="font-[Fraunces] text-lg font-semibold md:text-xl">{item.q}</span>
                  <motion.span
                    animate={{ rotate: isOpen ? 180 : 0 }}
                    transition={{ duration: 0.25 }}
                    className="shrink-0 text-[color:var(--brass)]"
                    aria-hidden
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M6 9l6 6 6-6"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </motion.span>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25 }}
                      className="overflow-hidden"
                    >
                      <p className="pb-6 pr-10 text-[color:var(--ink)]/75">{item.a}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </section>
  );
}

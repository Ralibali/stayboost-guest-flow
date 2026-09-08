import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const ITEMS = [
  {
    q: "Kan jag använda StayBoost med mitt nuvarande bokningssystem?",
    a: "Ja. Du kan börja med merförsäljningen och behålla din nuvarande bokningslösning, eller välja StayBoosts kompletta bokningssystem. Vi går igenom den bästa lösningen för din anläggning när du kommer igång.",
  },
  {
    q: "Behöver mina gäster ladda ner en app?",
    a: "Nej. Allt sker via vanliga sms och en webblänk som öppnas direkt i mobilen. Inget konto, ingen inloggning.",
  },
  {
    q: "Hur lång tid tar det att komma igång?",
    a: "Du kan utforska produktdemon direkt utan konto. När du vill börja på riktigt hjälper vi dig att lägga in boenden, tillval och meddelanden i den takt som passar verksamheten.",
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
    q: "Kostar sms extra?",
    a: "Sms ingår och kostar inget extra per skickat meddelande.",
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
    q: "Kan jag köpa enbart merförsäljningsdelen?",
    a: "Ja. Merförsäljning kostar 2 procent per genomförd transaktion, utan månadsavgift. Sms ingår. Du kan också välja enbart bokningssystemet eller samla allt i ett paket.",
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
                    setOpen(isOpen ? null : i);
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

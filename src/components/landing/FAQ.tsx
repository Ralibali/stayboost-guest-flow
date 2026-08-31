import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const ITEMS = [
  {
    q: "Fungerar det med Sirvoy och Booking.com?",
    a: "Ja. StayBoost kan synka bokningar från Sirvoy och Booking.com-kalendrar. Du kan också lägga in bokningar manuellt och ser tydligt vilken källa de kommer från.",
  },
  {
    q: "Behöver mina gäster ladda ner en app?",
    a: "Nej. Gästflödet sker via vanliga sms och en webblänk som öppnas direkt i mobilen. Gästen behöver inget StayBoost-konto.",
  },
  {
    q: "Hur lång tid tar det att komma igång?",
    a: "Du börjar med att skapa anläggningen och boendena, kopplar sedan dina bokningskällor och väljer vilka gästmeddelanden som ska skickas automatiskt.",
  },
  {
    q: "Vad händer om en gäst svarar på ett sms?",
    a: 'Du får svaret i StayBoost och kan följa konversationen där — samtidigt som automatiska flöden kan hantera definierade svar som "JA" på ett tillval.',
  },
  {
    q: "Kan jag skriva mina egna meddelanden?",
    a: "Självklart. Mallarna är en start — varje meddelande går att redigera, och du kan bygga egna flöden med dina egna ord.",
  },
  {
    q: "Vad kostar sms:en?",
    a: "Sms ingår i StayBoost-abonnemanget och debiteras inte separat. Det finns ingen sms-pott, inga credits och ingen extra kostnad per skickat sms.",
  },
  {
    q: "Funkar det för min personal?",
    a: "Ja. Frukost- och städvyerna är gjorda för mobil användning och visar det personalen behöver för dagens arbete, till exempel antal portioner, allergier och uppgifter per boende.",
  },
  {
    q: "Kan gäster hyra saker själva, som SUP eller bastu?",
    a: "Ja. Du kan skapa tillval som gästen beställer i sitt gästflöde. För tillval med kod kan åtkomsten lämnas digitalt efter genomförd beställning eller betalning.",
  },
  {
    q: "Vi använder inte Sirvoy — funkar det ändå?",
    a: "Ja. Booking.com-kalender och manuell inmatning stöds också. I StayBoost visas bokningens källa så att du kan hålla isär flödena.",
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

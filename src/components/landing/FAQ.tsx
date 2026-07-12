import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FAQ_ITEMS } from "@/lib/faq";

export function FAQ() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="py-20 md:py-32">
      <div className="mx-auto max-w-3xl px-6">
        <div className="text-center">
          <p className="eyebrow">Vanliga frågor</p>
          <h2 className="mt-3" style={{ fontSize: "clamp(2rem, 4vw, 3rem)" }}>
            Det viktigaste innan du söker en pilotplats.
          </h2>
        </div>

        <div className="mt-12 border-t border-[color:var(--line)]">
          {FAQ_ITEMS.map((item, index) => {
            const isOpen = open === index;
            const panelId = `faq-panel-${index}`;
            return (
              <div key={item.q} className="border-b border-[color:var(--line)]">
                <button
                  type="button"
                  onClick={() => {
                    const next = isOpen ? null : index;
                    setOpen(next);
                    if (next !== null && typeof window !== "undefined") {
                      const analytics = window as unknown as {
                        plausible?: (
                          event: string,
                          options?: { props?: Record<string, string> },
                        ) => void;
                      };
                      analytics.plausible?.("FAQ Opened", { props: { question: item.q } });
                    }
                  }}
                  className="flex w-full items-center justify-between gap-4 py-6 text-left"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                >
                  <span className="font-[Fraunces] text-lg font-semibold md:text-xl">
                    {item.q}
                  </span>
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
                      id={panelId}
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
    </section>
  );
}

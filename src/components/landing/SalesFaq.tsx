import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { SALES_FAQ } from "@/lib/sales-readiness";

export function SalesFaq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="invandningar" className="py-14 sm:py-20 md:py-28">
      <div className="mx-auto max-w-3xl px-6">
        <p className="eyebrow">Invändningar</p>
        <h2 className="mt-3" style={{ fontSize: "clamp(2rem, 4vw, 3rem)" }}>
          Isolering, Sirvoy, go-live, data och sms.
        </h2>
        <p className="mt-4 text-[color:var(--ink)]/75">
          Svaren är medvetet tråkiga. Hellre det än en säljsida som lovar isolation och cutover.
        </p>

        <div className="mt-12 border-t border-[color:var(--line)]">
          {SALES_FAQ.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={item.q} className="border-b border-[color:var(--line)]">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full items-center justify-between gap-4 py-6 text-left"
                  aria-expanded={isOpen}
                >
                  <span className="font-[Fraunces] text-lg font-semibold md:text-xl">{item.q}</span>
                  <span className="shrink-0 text-[color:var(--brass)]" aria-hidden>
                    {isOpen ? "−" : "+"}
                  </span>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
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

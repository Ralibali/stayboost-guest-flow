import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

function useCountUp(target: number, duration = 600) {
  const [value, setValue] = useState(target);
  const prev = useRef(target);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) {
      setValue(target);
      prev.current = target;
      return;
    }
    const from = prev.current;
    const to = target;
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(from + (to - from) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
      else prev.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, reduced]);

  return value;
}

function formatKr(n: number) {
  return n.toLocaleString("sv-SE").replace(/,/g, " ");
}

export function RevenueCalculator() {
  const [bookings, setBookings] = useState(30);

  // bookings × 0.20 × 200 kr → round to nearest 100
  const raw = bookings * 0.2 * 200;
  const perMonth = Math.round(raw / 100) * 100;
  const perYear = perMonth * 12;

  const displayedMonth = useCountUp(perMonth);
  const displayedYear = useCountUp(perYear);

  return (
    <section className="bg-[color:var(--forest)] py-20 text-[color:var(--bg)] md:py-32">
      <div className="mx-auto max-w-[1120px] px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="eyebrow">Räkna själv</p>
          <h2 className="mt-3 text-white" style={{ fontSize: "clamp(2rem, 4vw, 3rem)" }}>
            Vad är StayBoost värt för dig?
          </h2>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5 }}
          className="mx-auto mt-12 max-w-xl rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur md:p-10"
        >
          <label className="block">
            <span className="text-sm text-white/70">
              Hur många bokningar har du per månad?
            </span>
            <div className="mt-4 flex items-baseline gap-3">
              <span
                className="font-[Fraunces] font-semibold text-[color:var(--brass)]"
                style={{ fontSize: "3.5rem", lineHeight: 1 }}
              >
                {bookings}
              </span>
              <span className="text-sm text-white/60">bokningar/mån</span>
            </div>
            <input
              type="range"
              min={5}
              max={200}
              step={1}
              value={bookings}
              onChange={(e) => setBookings(Number(e.target.value))}
              className="brass-slider mt-4 w-full"
              aria-label="Bokningar per månad"
            />
            <div className="mt-1 flex justify-between text-xs text-white/50">
              <span>5</span>
              <span>200</span>
            </div>
          </label>

          <div className="mt-8 border-t border-white/10 pt-6">
            <p className="font-[Fraunces] text-white" style={{ fontSize: "clamp(1.5rem, 3vw, 2.25rem)", lineHeight: 1.2 }}>
              +<span className="text-[color:var(--brass)]">{formatKr(displayedMonth)} kr</span>/mån
              <span className="ml-2 text-base font-normal text-white/70">i merförsäljning</span>
            </p>
            <p className="mt-3 text-white/80">
              Det är <strong className="text-white">{formatKr(displayedYear)} kr per år</strong> — mot en kostnad på 449 kr/mån.
            </p>
            <p className="mt-3 text-white/80">
              + cirka <strong className="text-white">5 timmar i veckan</strong> i sparad
              drifttid — frukostlistor, städinstruktioner och gästfrågor som sköter sig själva.
            </p>
            <p className="mt-4 text-[0.8rem] leading-relaxed text-white/50">
              Baserat på att 15–25 % av gästerna bokar tillval för i snitt 200 kr. Konservativt räknat med 20 %.
            </p>
          </div>
        </motion.div>

        <div className="mt-8 text-center">
          {/* TODO: signup-länk */}
          <a href="#" className="btn-primary">
            Börja räkna hem det →
          </a>
        </div>
      </div>

      <style>{`
        .brass-slider {
          -webkit-appearance: none;
          appearance: none;
          height: 4px;
          background: rgba(255,255,255,0.15);
          border-radius: 999px;
          outline: none;
        }
        .brass-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 24px;
          height: 24px;
          border-radius: 999px;
          background: var(--brass);
          border: 3px solid #fff;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          cursor: pointer;
        }
        .brass-slider::-moz-range-thumb {
          width: 24px;
          height: 24px;
          border-radius: 999px;
          background: var(--brass);
          border: 3px solid #fff;
          cursor: pointer;
        }
      `}</style>
    </section>
  );
}

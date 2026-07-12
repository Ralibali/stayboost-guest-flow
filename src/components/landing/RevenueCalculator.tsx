import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { EarlyAccessForm } from "@/components/landing/EarlyAccessForm";

function useCountUp(target: number, duration = 500) {
  const [value, setValue] = useState(target);
  const previous = useRef(target);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) {
      setValue(target);
      previous.current = target;
      return;
    }

    const from = previous.current;
    const start = performance.now();
    let animationFrame = 0;

    const tick = (time: number) => {
      const progress = Math.min(1, (time - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(from + (target - from) * eased));
      if (progress < 1) animationFrame = requestAnimationFrame(tick);
      else previous.current = target;
    };

    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [duration, reducedMotion, target]);

  return value;
}

function formatKr(value: number) {
  return value.toLocaleString("sv-SE");
}

function RangeField({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-center justify-between gap-4 text-sm text-white/75">
        <span>{label}</span>
        <strong className="text-white">
          {value.toLocaleString("sv-SE")} {suffix}
        </strong>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="brass-slider mt-3 w-full"
      />
    </label>
  );
}

export function RevenueCalculator() {
  const [bookings, setBookings] = useState(30);
  const [conversion, setConversion] = useState(15);
  const [averageOrder, setAverageOrder] = useState(225);
  const [tracked, setTracked] = useState(false);

  const perMonth = Math.round(bookings * (conversion / 100) * averageOrder);
  const perYear = perMonth * 12;
  const displayedMonth = useCountUp(perMonth);
  const displayedYear = useCountUp(perYear);

  const update = (setter: (value: number) => void, value: number) => {
    setter(value);
    if (!tracked && typeof window !== "undefined") {
      const analytics = window as unknown as { plausible?: (event: string) => void };
      analytics.plausible?.("Calculator Used");
      setTracked(true);
    }
  };

  return (
    <section className="bg-[color:var(--forest)] py-20 text-[color:var(--bg)] md:py-32">
      <div className="mx-auto max-w-[1120px] px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="eyebrow">Räkna med dina egna antaganden</p>
          <h2 className="mt-3 text-white" style={{ fontSize: "clamp(2rem, 4vw, 3rem)" }}>
            Hur mycket merförsäljning kan du skapa?
          </h2>
          <p className="mt-5 text-white/70">
            Justera bokningar, köpfrekvens och snittköp. Kalkylatorn visar ett scenario — inte
            ett löfte.
          </p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5 }}
          className="mx-auto mt-12 max-w-xl rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur md:p-10"
        >
          <div className="space-y-7">
            <RangeField
              label="Bokningar per månad"
              value={bookings}
              min={5}
              max={200}
              step={1}
              suffix="st"
              onChange={(value) => update(setBookings, value)}
            />
            <RangeField
              label="Andel bokningar som köper tillval"
              value={conversion}
              min={5}
              max={40}
              step={1}
              suffix="%"
              onChange={(value) => update(setConversion, value)}
            />
            <RangeField
              label="Genomsnittligt tillvalsköp"
              value={averageOrder}
              min={75}
              max={800}
              step={25}
              suffix="kr"
              onChange={(value) => update(setAverageOrder, value)}
            />
          </div>

          <div className="mt-8 border-t border-white/10 pt-7 text-center">
            <p className="font-[Fraunces] text-white" style={{ fontSize: "clamp(1.7rem, 4vw, 2.6rem)" }}>
              +<span className="text-[color:var(--brass)]">{formatKr(displayedMonth)} kr</span>/mån
            </p>
            <p className="mt-2 text-white/75">
              cirka <strong className="text-white">{formatKr(displayedYear)} kr per år</strong> i
              tillvalsförsäljning i det här scenariot.
            </p>
            <p className="mt-4 text-xs leading-relaxed text-white/50">
              Beräkning: bokningar × köpfrekvens × genomsnittligt köp. Faktiskt utfall beror på
              utbud, pris, säsong och hur relevanta erbjudandena är.
            </p>
          </div>
        </motion.div>

        <div className="mx-auto mt-8 max-w-md">
          <EarlyAccessForm
            location="calculator"
            variant="dark"
            buttonLabel="Ansök om pilotplats"
          />
        </div>
      </div>

      <style>{`
        .brass-slider {
          -webkit-appearance: none;
          appearance: none;
          height: 4px;
          background: rgba(255,255,255,0.16);
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

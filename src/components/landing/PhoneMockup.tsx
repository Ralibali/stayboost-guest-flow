import { useEffect, useReducer } from "react";
import { motion, useReducedMotion } from "framer-motion";

type Msg = {
  side: "in" | "out";
  text: string;
  variant?: "default" | "confirm";
};

const SCRIPT: Msg[] = [
  {
    side: "in",
    text: "Hej Anna! Välkommen till Sjöstugan i morgon 🌲 Incheckning från kl 15. Portkod: 4482.",
  },
  {
    side: "in",
    text: "Vill du ha frukostkorgen levererad till dörren? 249 kr — svara JA så fixar vi det.",
  },
  { side: "out", text: "JA tack!" },
  { side: "in", text: "✓ Frukostkorg bekräftad — betald 249 kr", variant: "confirm" },
];

export function PhoneMockup() {
  const reduced = useReducedMotion();
  // step: 0..SCRIPT.length, then "typing" indicator handled by parity
  const [tick, bump] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (reduced) return;
    const id = setInterval(bump, 1400);
    return () => clearInterval(id);
  }, [reduced]);

  // Cycle: for each message show typing (400ms) then message; loop with 3s pause at end.
  // Compute visible count and whether typing bubble is shown.
  const cycleLength = SCRIPT.length * 2 + 2; // typing + msg per step, plus pause
  const phase = reduced ? cycleLength : tick % cycleLength;
  const visible = reduced ? SCRIPT.length : Math.min(Math.floor((phase + 1) / 2), SCRIPT.length);
  const showTyping =
    !reduced && visible < SCRIPT.length && phase % 2 === 0 && SCRIPT[visible].side === "in";

  return (
    <div className="relative flex justify-center">
      {/* Notification card */}
      <motion.div
        initial={{ opacity: 0, y: -20, x: 20 }}
        animate={{ opacity: 1, y: 0, x: 0 }}
        transition={{ delay: 1.5, duration: 0.5 }}
        className="absolute -top-4 right-0 z-20 card-surface flex items-center gap-2 px-4 py-3 text-sm sm:-right-6"
      >
        <span>💰</span>
        <span className="font-medium">
          Ny merförsäljning:{" "}
          <span className="text-[color:var(--brass)]">Sen utcheckning, 150 kr</span>
        </span>
      </motion.div>

      {/* Phone frame */}
      <div className="relative" style={{ transform: reduced ? "none" : "rotate(4deg)" }}>
        <div
          className="relative mx-auto w-[300px] rounded-[46px] bg-[#0b0b0b] p-3 shadow-[0_30px_80px_-20px_rgba(20,36,28,0.35)]"
          style={{ height: 620 }}
        >
          <div className="absolute left-1/2 top-3 z-10 h-6 w-28 -translate-x-1/2 rounded-full bg-[#0b0b0b]" />
          <div className="relative flex h-full flex-col overflow-hidden rounded-[36px] bg-[#EDE8DE]">
            {/* header */}
            <div className="flex items-center justify-center border-b border-[color:var(--line)] bg-[color:var(--bg)] px-4 pb-2 pt-8">
              <div className="text-center">
                <div className="mx-auto mb-1 h-10 w-10 rounded-full bg-[color:var(--forest)] text-center text-sm font-semibold leading-10 text-white">
                  Sj
                </div>
                <div className="text-[13px] font-semibold text-[color:var(--ink)]">Sjöstugan</div>
                <div className="text-[10px] text-[color:var(--ink)]/60">Sms</div>
              </div>
            </div>

            {/* messages */}
            <div className="flex flex-1 flex-col gap-2 overflow-hidden p-3">
              {SCRIPT.slice(0, visible).map((m, i) => (
                <Bubble key={i} msg={m} />
              ))}
              {showTyping && <TypingBubble />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Bubble({ msg }: { msg: Msg }) {
  if (msg.variant === "confirm") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="mr-6 rounded-2xl border border-[color:var(--brass)]/50 bg-white px-3 py-2 text-[12px] font-medium text-[color:var(--success)] shadow-sm"
      >
        {msg.text}
      </motion.div>
    );
  }
  const isOut = msg.side === "out";
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={`max-w-[80%] rounded-2xl px-3 py-2 text-[12px] leading-snug ${
        isOut ? "ml-auto bg-[#2E7D4F] text-white" : "mr-auto bg-white text-[color:var(--ink)]"
      }`}
    >
      {msg.text}
    </motion.div>
  );
}

function TypingBubble() {
  return (
    <div className="mr-auto flex items-center gap-1 rounded-2xl bg-white px-3 py-2.5">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="block h-1.5 w-1.5 rounded-full bg-[color:var(--ink)]/40"
          animate={{ y: [0, -3, 0] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
        />
      ))}
    </div>
  );
}

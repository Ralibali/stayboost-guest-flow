import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  Check,
  Gift,
  Loader2,
  Mail,
  MessageSquareHeart,
  Minus,
  Plus,
  ShieldCheck,
  Sparkles,
  User,
} from "lucide-react";
import { PROPERTY, fmtKr } from "@/lib/demo-data";
import { GIFT_CARD_PRESETS, addSessionGiftCard } from "@/lib/upsell-data";

export const Route = createFileRoute("/demo/presentkort")({
  component: GiftCardFlow,
});

function GiftCardFlow() {
  const [amount, setAmount] = useState(1000);
  const [custom, setCustom] = useState<number | null>(null);
  const [recipient, setRecipient] = useState("");
  const [sender, setSender] = useState("");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [paying, setPaying] = useState(false);
  const [code, setCode] = useState<string | null>(null);

  const value = custom ?? amount;
  const valid = recipient.trim().length > 1 && /\S+@\S+\.\S+/.test(email) && value >= 100;

  const buy = () => {
    setPaying(true);
    setTimeout(() => {
      const c = `SB-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
      addSessionGiftCard({
        code: c,
        buyer: sender || "Okänd",
        recipient,
        amount: value,
        balance: value,
        soldDaysAgo: 0,
      });
      setCode(c);
      setPaying(false);
    }, 1300);
  };

  return (
    <div className="mx-auto max-w-4xl">
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-xl"
      >
        <p className="eyebrow">Presentkort</p>
        <h1 className="mt-2 text-3xl sm:text-4xl">Ge bort en natt vid kanalen.</h1>
        <p className="mt-3 text-[15px] text-[color:var(--ink)]/65">
          Välj belopp, skriv en hälsning — mottagaren får ett vackert presentkort via e-post direkt.
          Gäller i 24 månader på hela {PROPERTY.name}.
        </p>
      </motion.div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {/* Formulär */}
        <div className="card-surface p-6">
          <h2 className="flex items-center gap-2 font-sans text-[15px] font-bold">
            <Gift size={16} className="text-[color:var(--brass)]" /> Välj belopp
          </h2>
          <div className="mt-3 grid grid-cols-4 gap-2">
            {GIFT_CARD_PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => {
                  setAmount(p);
                  setCustom(null);
                }}
                className={`rounded-xl py-3 text-[14px] font-semibold transition ${
                  custom === null && amount === p
                    ? "bg-[color:var(--forest)] text-white"
                    : "border border-[color:var(--line)] hover:bg-[color:var(--bg)]"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <span className="text-[13px] text-[color:var(--ink)]/60">Eget belopp:</span>
            <div className="flex items-center gap-2">
              <RoundBtn onClick={() => setCustom(Math.max(100, value - 100))} icon="-" />
              <span className="w-20 text-center font-semibold tabular-nums">{fmtKr(value)}</span>
              <RoundBtn onClick={() => setCustom(value + 100)} icon="+" />
            </div>
          </div>

          <div className="mt-6 space-y-4">
            <Field icon={User} label="Mottagarens namn">
              <input
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="Anna"
                className="w-full rounded-xl border border-[color:var(--line)] bg-[color:var(--bg)] px-4 py-3 text-[15px] outline-none focus:border-[color:var(--brass)]"
              />
            </Field>
            <Field icon={User} label="Ditt namn (avsändare)">
              <input
                value={sender}
                onChange={(e) => setSender(e.target.value)}
                placeholder="Klas"
                className="w-full rounded-xl border border-[color:var(--line)] bg-[color:var(--bg)] px-4 py-3 text-[15px] outline-none focus:border-[color:var(--brass)]"
              />
            </Field>
            <Field icon={MessageSquareHeart} label="Hälsning (valfritt)">
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Grattis på födelsedagen! Njut av kanalen…"
                rows={2}
                className="w-full resize-none rounded-xl border border-[color:var(--line)] bg-[color:var(--bg)] px-4 py-3 text-[15px] outline-none focus:border-[color:var(--brass)]"
              />
            </Field>
            <Field icon={Mail} label="Skickas till e-post">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="anna@example.se"
                className="w-full rounded-xl border border-[color:var(--line)] bg-[color:var(--bg)] px-4 py-3 text-[15px] outline-none focus:border-[color:var(--brass)]"
              />
            </Field>
          </div>

          <button
            onClick={buy}
            disabled={!valid || paying}
            className="btn-primary mt-6 w-full !rounded-2xl !py-4 text-[16px] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {paying ? (
              <>
                <Loader2 size={18} className="animate-spin" /> Skapar presentkort…
              </>
            ) : (
              <>
                <ShieldCheck size={18} /> Köp presentkort — {fmtKr(value)}
              </>
            )}
          </button>
          <p className="mt-3 text-center text-[12px] text-[color:var(--ink)]/50">
            Demo — ingen riktig betalning sker
          </p>
        </div>

        {/* Live-förhandsvisning */}
        <div className="lg:sticky lg:top-32 lg:self-start">
          <AnimatePresence mode="wait">
            {code ? (
              <motion.div
                key="done"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="card-surface p-8 text-center"
              >
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", delay: 0.1 }}
                  className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[color:var(--success)] text-white"
                >
                  <Check size={28} strokeWidth={3} />
                </motion.span>
                <h2 className="mt-4 text-2xl">Presentkortet är skickat!</h2>
                <p className="mt-2 text-[15px] text-[color:var(--ink)]/65">
                  Koden <span className="font-mono font-bold text-[color:var(--ink)]">{code}</span>{" "}
                  är på väg till {email}. Mottagaren löser in den direkt i bokningsflödet.
                </p>
                <div className="mt-6 flex flex-col gap-3">
                  <Link to="/demo/boka" className="btn-primary !rounded-2xl !py-3.5 text-[15px]">
                    Testa inlösen i bokningen <ArrowRight size={16} />
                  </Link>
                  <button
                    onClick={() => {
                      setCode(null);
                      setRecipient("");
                      setMessage("");
                    }}
                    className="btn-ghost !rounded-2xl !py-3 text-[14px]"
                  >
                    Köp ett till
                  </button>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="preview"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
              >
                {/* Presentkortet */}
                <div className="relative overflow-hidden rounded-[24px] bg-[color:var(--forest)] p-7 text-white shadow-[0_24px_60px_rgba(20,36,28,0.35)]">
                  <div
                    className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-[color:var(--brass)]/25 blur-2xl"
                    aria-hidden
                  />
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-[color:var(--brass)]">
                        <Sparkles size={12} /> Presentkort
                      </div>
                      <div className="mt-1 font-[Fraunces] text-2xl font-semibold">
                        {PROPERTY.name}
                      </div>
                    </div>
                    <Gift size={26} className="text-[color:var(--brass)]" />
                  </div>
                  <div className="mt-8 font-[Fraunces] text-5xl font-semibold tabular-nums">
                    {fmtKr(value)}
                  </div>
                  <div className="mt-6 space-y-1 text-[14px] text-white/85">
                    <div>
                      Till: <span className="font-semibold text-white">{recipient || "—"}</span>
                    </div>
                    <div>
                      Från: <span className="font-semibold text-white">{sender || "—"}</span>
                    </div>
                    {message && <div className="pt-1 italic text-white/75">”{message}”</div>}
                  </div>
                  <div className="mt-6 border-t border-white/15 pt-4 font-mono text-[13px] tracking-[0.2em] text-white/60">
                    SB-••••• · Gäller 24 månader
                  </div>
                </div>
                <p className="mt-3 text-center text-[12px] text-[color:var(--ink)]/50">
                  Förhandsvisning — uppdateras medan du skriver
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function Field({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof User;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-[color:var(--ink)]/70">
        <Icon size={14} />
        {label}
      </label>
      {children}
    </div>
  );
}

function RoundBtn({ onClick, icon }: { onClick: () => void; icon: string }) {
  return (
    <button
      onClick={onClick}
      className="grid h-8 w-8 place-items-center rounded-full border border-[color:var(--line)] transition hover:bg-[color:var(--bg)]"
      aria-label={icon === "+" ? "Öka" : "Minska"}
    >
      {icon === "+" ? <Plus size={15} /> : <Minus size={15} />}
    </button>
  );
}

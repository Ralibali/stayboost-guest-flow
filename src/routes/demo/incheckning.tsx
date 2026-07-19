import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  BedDouble,
  Car,
  Check,
  Copy,
  KeyRound,
  PartyPopper,
  ShieldCheck,
  User,
  Users,
} from "lucide-react";
import { GUESTS, PROPERTY, fmtDate, unitOf } from "@/lib/demo-data";

export const Route = createFileRoute("/demo/incheckning")({
  component: CheckIn,
});

const guest = GUESTS[0];
const unit = unitOf(guest.unitId);

const RULES = [
  "Lugnt efter kl 22:00 — vi är många som vill höra kanalen, inte grannarna.",
  "Eld endast i markerade eldstäder. Släck alltid ordentligt.",
  "Utcheckning senast kl 11:00 (eller 13:00 med tillvalet sen utcheckning).",
  "Husdjur är välkomna i kopplet, men inte i sängen.",
];

function CheckIn() {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(guest.name);
  const [guests, setGuests] = useState(guest.guests);
  const [carReg, setCarReg] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [copied, setCopied] = useState(false);

  const steps = ["Dina uppgifter", "Husregler", "Klart"];

  const copyCode = () => {
    navigator.clipboard?.writeText(unit.doorCode).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="mx-auto max-w-md">
      {/* Stegindikator */}
      <div className="mb-8 flex items-center gap-2">
        {steps.map((s, i) => (
          <div key={s} className="flex flex-1 flex-col gap-1.5">
            <div
              className={`h-1.5 rounded-full transition-colors ${
                i <= step ? "bg-[color:var(--brass)]" : "bg-[color:var(--line)]"
              }`}
            />
            <span
              className={`text-[11px] font-medium ${
                i <= step ? "text-[color:var(--ink)]" : "text-[color:var(--ink)]/40"
              }`}
            >
              {s}
            </span>
          </div>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {/* STEG 1 — Uppgifter */}
        {step === 0 && (
          <motion.div
            key="s0"
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.3 }}
          >
            <p className="eyebrow">Steg 1 av 3</p>
            <h1 className="mt-2 text-3xl">Bekräfta dina uppgifter</h1>
            <p className="mt-2 text-[15px] text-[color:var(--ink)]/65">
              {unit.name} · {fmtDate(guest.checkIn)} – {fmtDate(guest.checkOut)}
            </p>

            <div className="card-surface mt-6 space-y-5 p-6">
              <Field label="Namn" icon={User}>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-xl border border-[color:var(--line)] bg-[color:var(--bg)] px-4 py-3 text-[15px] outline-none focus:border-[color:var(--brass)]"
                />
              </Field>
              <Field label="Antal gäster" icon={Users}>
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => setGuests((g) => Math.max(1, g - 1))}
                    className="grid h-11 w-11 place-items-center rounded-xl border border-[color:var(--line)] text-xl font-semibold transition hover:bg-[color:var(--bg)]"
                  >
                    −
                  </button>
                  <span className="w-8 text-center font-[Fraunces] text-2xl font-semibold tabular-nums">
                    {guests}
                  </span>
                  <button
                    onClick={() => setGuests((g) => Math.min(6, g + 1))}
                    className="grid h-11 w-11 place-items-center rounded-xl border border-[color:var(--line)] text-xl font-semibold transition hover:bg-[color:var(--bg)]"
                  >
                    +
                  </button>
                </div>
              </Field>
              <Field label="Bilskylt (valfritt — för parkeringen)" icon={Car}>
                <input
                  value={carReg}
                  onChange={(e) => setCarReg(e.target.value.toUpperCase())}
                  placeholder="ABC 123"
                  maxLength={7}
                  className="w-full rounded-xl border border-[color:var(--line)] bg-[color:var(--bg)] px-4 py-3 text-[15px] uppercase tracking-widest outline-none focus:border-[color:var(--brass)]"
                />
              </Field>
            </div>

            <button onClick={() => setStep(1)} className="btn-primary mt-6 w-full !rounded-2xl">
              Fortsätt <ArrowRight size={17} />
            </button>
          </motion.div>
        )}

        {/* STEG 2 — Husregler */}
        {step === 1 && (
          <motion.div
            key="s1"
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.3 }}
          >
            <p className="eyebrow">Steg 2 av 3</p>
            <h1 className="mt-2 text-3xl">Husreglerna</h1>
            <p className="mt-2 text-[15px] text-[color:var(--ink)]/65">
              Kort och gott — så alla får en skön vistelse.
            </p>

            <div className="card-surface mt-6 p-6">
              <ul className="space-y-4">
                {RULES.map((r, i) => (
                  <li key={i} className="flex gap-3 text-[15px] leading-relaxed">
                    <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[color:var(--forest)]/10 text-[12px] font-bold text-[color:var(--forest)]">
                      {i + 1}
                    </span>
                    {r}
                  </li>
                ))}
              </ul>
              <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-2xl border border-[color:var(--line)] bg-[color:var(--bg)] p-4">
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(e) => setAccepted(e.target.checked)}
                  className="mt-1 h-5 w-5 accent-[#b08d3e]"
                />
                <span className="text-[15px] font-medium">
                  Jag har läst och godkänner husreglerna
                </span>
              </label>
            </div>

            <div className="mt-6 flex gap-3">
              <button onClick={() => setStep(0)} className="btn-ghost !rounded-2xl">
                <ArrowLeft size={17} />
              </button>
              <button
                onClick={() => setStep(2)}
                disabled={!accepted}
                className="btn-primary flex-1 !rounded-2xl disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ShieldCheck size={17} /> Checka in
              </button>
            </div>
          </motion.div>
        )}

        {/* STEG 3 — Klart + portkod */}
        {step === 2 && (
          <motion.div
            key="s2"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.35 }}
            className="text-center"
          >
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", delay: 0.1 }}
              className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-[color:var(--success)] text-white"
            >
              <PartyPopper size={34} />
            </motion.span>
            <h1 className="mt-5 text-3xl">Välkommen, {name.split(" ")[0]}!</h1>
            <p className="mt-2 text-[15px] text-[color:var(--ink)]/65">
              Du är incheckad i {unit.name}. Här är din portkod:
            </p>

            <motion.button
              onClick={copyCode}
              whileTap={{ scale: 0.97 }}
              className="card-surface mx-auto mt-6 flex w-full items-center justify-between rounded-[24px] p-6"
            >
              <div className="flex items-center gap-4">
                <span className="grid h-14 w-14 place-items-center rounded-2xl bg-[color:var(--forest)] text-white">
                  <KeyRound size={24} />
                </span>
                <div className="text-left">
                  <div className="text-[12px] font-medium uppercase tracking-wide text-[color:var(--ink)]/50">
                    Portkod
                  </div>
                  <div className="font-[Fraunces] text-4xl font-semibold tracking-[0.2em]">
                    {unit.doorCode}
                  </div>
                </div>
              </div>
              <span className="flex items-center gap-1.5 rounded-full border border-[color:var(--line)] px-3.5 py-2 text-[13px] font-medium">
                {copied ? (
                  <Check size={14} className="text-[color:var(--success)]" />
                ) : (
                  <Copy size={14} />
                )}
                {copied ? "Kopierad!" : "Kopiera"}
              </span>
            </motion.button>

            <div className="card-surface mt-4 flex items-center gap-4 p-5 text-left">
              <BedDouble size={20} className="shrink-0 text-[color:var(--brass)]" />
              <p className="text-[14px] text-[color:var(--ink)]/70">
                Vi har meddelat värden att du är på plats. Frukostkorgen du bokade levereras i
                morgon kl 08:00.
              </p>
            </div>

            <Link to="/demo/gast" className="btn-primary mt-6 w-full !rounded-2xl">
              Öppna gästhubben <ArrowRight size={17} />
            </Link>
            <p className="mt-3 text-[12px] text-[color:var(--ink)]/50">
              Samma info skickas även via sms till {guest.phone}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Field({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: typeof User;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-[color:var(--ink)]/70">
        <Icon size={14} />
        {label}
      </label>
      {children}
    </div>
  );
}

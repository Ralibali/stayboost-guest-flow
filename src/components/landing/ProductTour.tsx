import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

type TabKey = "gast" | "personal" | "du";

const TABS: { key: TabKey; label: string; sub: string }[] = [
  { key: "gast", label: "Gästen", sub: "Ser sin vistelse" },
  { key: "personal", label: "Personalen", sub: "Vet vad som gäller" },
  { key: "du", label: "Du", sub: "En knapp — allt uppdateras" },
];

export function ProductTour() {
  const [tab, setTab] = useState<TabKey>("gast");
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const onKey = (e: React.KeyboardEvent) => {
    const idx = TABS.findIndex((t) => t.key === tab);
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = TABS[(idx + 1) % TABS.length];
      setTab(next.key);
      tabRefs.current[next.key]?.focus();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      const prev = TABS[(idx - 1 + TABS.length) % TABS.length];
      setTab(prev.key);
      tabRefs.current[prev.key]?.focus();
    }
  };

  return (
    <section
      id="produkten"
      className="border-t border-[color:var(--line)] bg-[color:var(--bg)] py-20 md:py-32"
    >
      <div className="mx-auto max-w-[1120px] px-6">
        <div className="max-w-2xl">
          <p className="eyebrow">Så här ser det ut</p>
          <h2 className="mt-3" style={{ fontSize: "clamp(2rem, 4vw, 3rem)" }}>
            Ett system. Tre vyer.{" "}
            <em className="italic text-[color:var(--brass)]">Noll dubbelarbete.</em>
          </h2>
          <p className="mt-5 text-[color:var(--ink)]/75">
            Gästen, personalen och du ser samma sanning — uppdaterad i samma sekund som något
            händer.
          </p>
        </div>

        {/* Tabs */}
        <div
          role="tablist"
          aria-label="Vyer i StayBoost"
          onKeyDown={onKey}
          className="mt-10 grid grid-cols-3 gap-2 rounded-2xl border border-[color:var(--line)] bg-white p-2 md:inline-grid md:auto-cols-max md:grid-flow-col"
        >
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                ref={(el) => {
                  tabRefs.current[t.key] = el;
                }}
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                onClick={() => setTab(t.key)}
                className={`rounded-xl px-5 py-3 text-left transition ${
                  active
                    ? "bg-[color:var(--forest)] text-white shadow-sm"
                    : "text-[color:var(--ink)]/70 hover:bg-[color:var(--bg)]"
                }`}
              >
                <div className="font-[Fraunces] text-base font-semibold md:text-lg">{t.label}</div>
                <div
                  className={`text-[0.75rem] ${
                    active ? "text-white/70" : "text-[color:var(--ink)]/50"
                  }`}
                >
                  {t.sub}
                </div>
              </button>
            );
          })}
        </div>

        <div role="tabpanel" className="mt-10">
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
            >
              {tab === "gast" && <GuestPane />}
              {tab === "personal" && <StaffPane />}
              {tab === "du" && <AdminPane />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}

/* ---------------- GUEST ---------------- */

function GuestPane() {
  return (
    <div className="grid gap-6 md:grid-cols-3">
      <DemoCard caption="Fyra språk, betalning via Swish eller kortlänk, beställningsstopp X dagar före ankomst — du bestämmer.">
        <GuestHubDemo />
      </DemoCard>
      <DemoCard caption="Gästen checkar in själv — även när du sitter på fotbollsträningen.">
        <CheckinDemo />
      </DemoCard>
      <DemoCard caption="Hyr ut SUP, bastu eller cyklar utan att vara på plats. Betalning först, koden direkt efter.">
        <SelfServeDemo />
      </DemoCard>
    </div>
  );
}

function GuestHubDemo() {
  const [breakfast, setBreakfast] = useState(2);
  const [lateout, setLateout] = useState(1);
  const [fika, setFika] = useState(0);
  const [prefs, setPrefs] = useState<string[]>(["Gluten"]);
  const [status, setStatus] = useState<"idle" | "await" | "paid">("idle");
  const reduced = useReducedMotion();

  const togglePref = (p: string) =>
    setPrefs((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));

  const total = breakfast * 249 + lateout * 150 + fika * 89;

  const submit = () => {
    setStatus("await");
    if (reduced) return setStatus("paid");
    setTimeout(() => setStatus("paid"), 1500);
  };

  return (
    <PhoneFrame>
      <div className="space-y-3 text-sm">
        <div>
          <div className="font-[Fraunces] text-lg font-semibold">Hej Anna! 🌿</div>
          <div className="text-xs text-[color:var(--ink)]/60">Sjöbris · 12–14 juli · 2 nätter</div>
        </div>

        <Stepper
          label="Frukostkorg"
          price="249 kr/person"
          value={breakfast}
          onChange={setBreakfast}
        />
        <Stepper
          label="Sen utcheckning"
          price="150 kr"
          value={lateout}
          onChange={setLateout}
          max={1}
        />
        <Stepper label="Fikapåse" price="89 kr" value={fika} onChange={setFika} />

        <div>
          <div className="mb-1 text-[0.7rem] uppercase tracking-wide text-[color:var(--ink)]/55">
            Kostpreferens
          </div>
          <div className="flex flex-wrap gap-1.5">
            {["Gluten", "Laktos", "Vegan", "Nöt", "Fisk"].map((p) => {
              const on = prefs.includes(p);
              return (
                <button
                  key={p}
                  onClick={() => togglePref(p)}
                  className={`rounded-full border px-2.5 py-1 text-[0.72rem] transition ${
                    on
                      ? "border-[color:var(--brass)] bg-[color:var(--brass)]/10 text-[color:var(--brass)]"
                      : "border-[color:var(--line)] text-[color:var(--ink)]/60"
                  }`}
                >
                  {p}
                </button>
              );
            })}
          </div>
        </div>

        {status === "idle" && (
          <button
            onClick={submit}
            disabled={total === 0}
            className="w-full rounded-xl bg-[color:var(--brass)] px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            Skicka önskemål · {total} kr
          </button>
        )}
        {status !== "idle" && (
          <div
            className={`rounded-xl px-3 py-2 text-center text-[0.78rem] font-semibold ${
              status === "paid"
                ? "bg-[color:var(--success)]/10 text-[color:var(--success)]"
                : "bg-[color:var(--brass)]/10 text-[color:var(--brass)]"
            }`}
          >
            {status === "paid" ? "Betald ✓" : "Avvaktar betalning…"}
          </div>
        )}

        {status !== "idle" && (
          <div className="rounded-xl border border-[color:var(--line)] bg-white p-2.5 text-[0.72rem]">
            <div className="mb-1 font-semibold">Swisha {total} kr</div>
            <SwishRow k="Nummer" v="123 456 78 90" />
            <SwishRow k="Mottagare" v="Sjöbris Glamping" />
            <SwishRow k="Meddelande" v="Anna · 12/7" />
          </div>
        )}
      </div>
    </PhoneFrame>
  );
}

function Stepper({
  label,
  price,
  value,
  onChange,
  max = 6,
}: {
  label: string;
  price: string;
  value: number;
  onChange: (n: number) => void;
  max?: number;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-[color:var(--line)] bg-white px-3 py-2">
      <div>
        <div className="text-[0.82rem] font-semibold">{label}</div>
        <div className="text-[0.7rem] text-[color:var(--ink)]/55">{price}</div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onChange(Math.max(0, value - 1))}
          className="grid h-7 w-7 place-items-center rounded-full border border-[color:var(--line)] text-sm"
          aria-label={`Minska ${label}`}
        >
          −
        </button>
        <span className="w-5 text-center text-sm font-semibold tabular-nums">{value}</span>
        <button
          onClick={() => onChange(Math.min(max, value + 1))}
          className="grid h-7 w-7 place-items-center rounded-full border border-[color:var(--brass)] text-sm text-[color:var(--brass)]"
          aria-label={`Öka ${label}`}
        >
          +
        </button>
      </div>
    </div>
  );
}

function SwishRow({ k, v }: { k: string; v: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between border-t border-[color:var(--line)] py-1 first:border-t-0">
      <span className="text-[color:var(--ink)]/55">{k}</span>
      <div className="flex items-center gap-1.5">
        <span className="font-semibold tabular-nums">{v}</span>
        <button
          onClick={() => {
            navigator.clipboard?.writeText(v);
            setCopied(true);
            setTimeout(() => setCopied(false), 900);
          }}
          className="rounded-md border border-[color:var(--line)] px-1.5 py-0.5 text-[0.62rem] text-[color:var(--ink)]/60 hover:text-[color:var(--brass)]"
        >
          {copied ? "✓" : "Kopiera"}
        </button>
      </div>
    </div>
  );
}

function CheckinDemo() {
  const [step, setStep] = useState(1);
  const [ref, setRef] = useState("");
  const [terms, setTerms] = useState(false);

  return (
    <div className="rounded-2xl border border-[color:var(--line)] bg-white p-5">
      <div className="mb-4 flex items-center gap-2">
        {[1, 2, 3].map((n) => (
          <div key={n} className="flex flex-1 items-center gap-2">
            <div
              className={`grid h-7 w-7 place-items-center rounded-full text-xs font-semibold ${
                step >= n
                  ? "bg-[color:var(--brass)] text-white"
                  : "border border-[color:var(--line)] text-[color:var(--ink)]/50"
              }`}
            >
              {n}
            </div>
            {n < 3 && (
              <div
                className={`h-px flex-1 ${
                  step > n ? "bg-[color:var(--brass)]" : "bg-[color:var(--line)]"
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-3">
          <label className="block text-xs font-semibold text-[color:var(--ink)]/70">
            Bokningsnummer eller efternamn
          </label>
          <input
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder="t.ex. Andersson"
            className="w-full rounded-lg border border-[color:var(--line)] bg-[color:var(--bg)] px-3 py-2 text-sm"
          />
          <button
            onClick={() => setStep(2)}
            disabled={ref.length < 2}
            className="w-full rounded-lg bg-[color:var(--forest)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            Fortsätt
          </button>
        </div>
      )}
      {step === 2 && (
        <div className="space-y-3">
          <div className="max-h-24 overflow-auto rounded-lg border border-[color:var(--line)] bg-[color:var(--bg)] p-2 text-[0.72rem] text-[color:var(--ink)]/70">
            Trivselregler: rök inte i tälten, hundar i koppel, tyst efter 22. Avbeställning senast
            48 h före ankomst…
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={terms}
              onChange={(e) => setTerms(e.target.checked)}
              className="accent-[color:var(--brass)]"
            />
            Jag godkänner boendevillkoren
          </label>
          <button
            onClick={() => setStep(3)}
            disabled={!terms}
            className="w-full rounded-lg bg-[color:var(--forest)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            Slutför incheckning
          </button>
        </div>
      )}
      {step === 3 && (
        <div className="space-y-3 text-center">
          <div className="text-[0.7rem] uppercase tracking-wide text-[color:var(--ink)]/55">
            Portkod
          </div>
          <div className="rounded-xl border border-[color:var(--brass)] bg-[color:var(--bg)] py-4 font-[Fraunces] text-4xl font-semibold tracking-widest text-[color:var(--brass)]">
            4482
          </div>
          <button className="w-full rounded-lg border border-[color:var(--line)] px-3 py-2 text-sm">
            Visa vägbeskrivning →
          </button>
        </div>
      )}
    </div>
  );
}

function SelfServeDemo() {
  const [qty, setQty] = useState(1);
  const [phase, setPhase] = useState<"pick" | "paying" | "unlocked">("pick");
  const reduced = useReducedMotion();

  const pay = () => {
    setPhase("paying");
    if (reduced) return setPhase("unlocked");
    setTimeout(() => setPhase("unlocked"), 1400);
  };

  return (
    <div className="rounded-2xl border border-[color:var(--line)] bg-white p-5 text-sm">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-[Fraunces] text-base font-semibold">SUP på kanalen</div>
          <div className="text-xs text-[color:var(--ink)]/60">100 kr/dygn</div>
        </div>
        <div className="flex gap-1">
          {[1, 2].map((n) => (
            <button
              key={n}
              onClick={() => setQty(n)}
              className={`h-8 w-8 rounded-lg border text-sm ${
                qty === n
                  ? "border-[color:var(--brass)] bg-[color:var(--brass)]/10 text-[color:var(--brass)]"
                  : "border-[color:var(--line)]"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {phase === "pick" && (
        <button
          onClick={pay}
          className="mt-5 w-full rounded-xl bg-[#54B948] px-3 py-2.5 text-sm font-semibold text-white"
        >
          Swisha {qty * 100} kr
        </button>
      )}
      {phase === "paying" && (
        <div className="mt-5 rounded-xl border border-[color:var(--line)] bg-[color:var(--bg)] px-3 py-4 text-center text-xs text-[color:var(--ink)]/60">
          Öppnar Swish…
        </div>
      )}
      <div className="mt-4 rounded-xl border border-dashed border-[color:var(--line)] bg-[color:var(--bg)] p-4">
        <div className="mb-2 flex items-center gap-2 text-[0.7rem] uppercase tracking-wide text-[color:var(--ink)]/55">
          <LockIcon locked={phase !== "unlocked"} /> Kod till skåpet
        </div>
        <div
          className={`font-[Fraunces] text-3xl font-semibold tracking-widest ${
            phase === "unlocked" ? "text-[color:var(--brass)]" : "text-[color:var(--ink)]/25"
          }`}
        >
          {phase === "unlocked" ? "7391" : "● ● ● ●"}
        </div>
      </div>
    </div>
  );
}

function LockIcon({ locked }: { locked: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4" y="11" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
      <path
        d={locked ? "M8 11V8a4 4 0 018 0v3" : "M8 11V8a4 4 0 018 0"}
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}

/* ---------------- STAFF ---------------- */

function StaffPane() {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <DemoCard caption="Frukostansvarig har egen inloggning och ser bara det som ska levereras — allergier i rött, aldrig gissningar.">
        <BreakfastDemo />
      </DemoCard>
      <DemoCard caption="Städaren ser exakt antal handdukar för NÄSTA bokning, på sitt eget språk. Sen utcheckning? Kortet blir rött och städningen startar efter 12.">
        <CleaningDemo />
      </DemoCard>
    </div>
  );
}

function BreakfastDemo() {
  const [delivered, setDelivered] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const reduced = useReducedMotion();

  return (
    <div className="rounded-2xl border border-[color:var(--line)] bg-white p-5 text-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button className="grid h-8 w-8 place-items-center rounded-lg border border-[color:var(--line)]">
            ‹
          </button>
          <div className="text-center">
            <div className="text-[0.7rem] uppercase tracking-wide text-[color:var(--ink)]/55">
              Torsdag
            </div>
            <div className="font-[Fraunces] font-semibold">13 juli</div>
          </div>
          <button className="grid h-8 w-8 place-items-center rounded-lg border border-[color:var(--line)]">
            ›
          </button>
        </div>
        <div className="flex gap-1 text-[0.72rem]">
          <button className="rounded-lg bg-[color:var(--forest)] px-2 py-1 text-white">
            I dag
          </button>
          <button className="rounded-lg border border-[color:var(--line)] px-2 py-1">
            I morgon
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <div className="text-[0.7rem] uppercase tracking-wide text-amber-800/70">Frukost</div>
          <div className="font-[Fraunces] text-2xl font-semibold text-amber-900">
            6 <span className="text-xs font-normal">portioner</span>
          </div>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <div className="text-[0.7rem] uppercase tracking-wide text-emerald-800/70">Fikapåsar</div>
          <div className="font-[Fraunces] text-2xl font-semibold text-emerald-900">2</div>
        </div>
      </div>

      <div
        className={`mt-4 rounded-xl border p-3 ${
          delivered
            ? "border-[color:var(--success)]/40 bg-[color:var(--success)]/5"
            : "border-[color:var(--line)] bg-[color:var(--bg)]"
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-[0.7rem] uppercase tracking-wide text-[color:var(--ink)]/55">
              Tält 1
            </div>
            <div className="font-[Fraunces] font-semibold">Sjöbris · 4 frukost</div>
          </div>
          {delivered && (
            <span className="text-[color:var(--success)]" aria-label="Levererad">
              ✓
            </span>
          )}
        </div>
        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-[0.72rem] font-semibold text-red-800">
          ⚠ Gluten + laktos (2 gäster)
        </div>
        {!delivered && !confirming && (
          <button
            onClick={() => setConfirming(true)}
            className="mt-3 w-full rounded-lg bg-[color:var(--forest)] px-3 py-2 text-xs font-semibold text-white"
          >
            Markera levererad
          </button>
        )}
        {confirming && !delivered && (
          <div className="mt-3 space-y-2 rounded-lg border border-[color:var(--line)] bg-white p-2 text-[0.72rem]">
            <div>Skicka sms till gästen om att frukosten är levererad?</div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setDelivered(true);
                  setConfirming(false);
                  if (reduced) return;
                }}
                className="flex-1 rounded bg-[color:var(--brass)] px-2 py-1 font-semibold text-white"
              >
                Ja, skicka
              </button>
              <button
                onClick={() => {
                  setDelivered(true);
                  setConfirming(false);
                }}
                className="flex-1 rounded border border-[color:var(--line)] px-2 py-1"
              >
                Bara markera
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-3 rounded-lg border border-yellow-300 bg-yellow-50 p-2 text-[0.7rem] text-yellow-900">
        Kontrollera fördelning: 6 frukost på 2 morgnar — bekräfta per dag.
      </div>
    </div>
  );
}

function CleaningDemo() {
  const [lang, setLang] = useState<"sv" | "en" | "si">("sv");
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<boolean[]>([false, false, false, false, false]);
  const [finished, setFinished] = useState(false);
  const [toast, setToast] = useState(false);

  const T = {
    sv: {
      badge1: "Växling",
      badge2: "3 gäster",
      lateout: "Sen utcheckning kl. 12.00",
      instr: "Lägg in 3 stora och 3 små handdukar · Nästa ankomst 14 juli",
      title: "Tält 2 – Naturkärnan",
      steps: [
        "Bädda om (3 sängar)",
        "Byt handdukar (3 stora + 3 små)",
        "Dammsug och våttorka",
        "Fyll på ved, kaffe, papper",
        "Slutkontroll & lås",
      ],
      cta: "Klarmarkera",
      toast: "Gästen får sms: tältet är redo ✓",
    },
    en: {
      badge1: "Turnover",
      badge2: "3 guests",
      lateout: "Late checkout 12:00",
      instr: "Set out 3 large + 3 small towels · Next arrival 14 July",
      title: "Tent 2 – Naturkärnan",
      steps: [
        "Make beds (3)",
        "Change towels (3 large + 3 small)",
        "Vacuum and wet-wipe",
        "Refill firewood, coffee, paper",
        "Final check & lock",
      ],
      cta: "Mark ready",
      toast: "Guest notified: tent is ready ✓",
    },
    si: {
      badge1: "මාරුව",
      badge2: "අමුත්තන් 3",
      lateout: "ප්‍රමාද පිටත්වීම 12.00",
      instr: "විශාල 3 + කුඩා 3 තුවා තැබිය යුතුයි · මීළඟ පැමිණීම 14 ජූලි",
      title: "කූඩාරම 2 – Naturkärnan",
      steps: [
        "ඇඳන් 3 සකසන්න",
        "තුවා මාරු කරන්න (විශාල 3 + කුඩා 3)",
        "පිරිසිදු කරන්න",
        "දර, කෝපි, කඩදාසි පුරවන්න",
        "අවසන් පරීක්ෂණය සහ අගුල",
      ],
      cta: "සුදානම් යැයි සලකුණු කරන්න",
      toast: "අමුත්තාට දැනුම් දුන්නා ✓",
    },
  }[lang];

  return (
    <div className="rounded-2xl border border-[color:var(--line)] bg-white p-5 text-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[0.7rem] uppercase tracking-wide text-[color:var(--ink)]/55">
          Städning · i dag
        </div>
        <div className="flex gap-1 text-[0.7rem]">
          {(["sv", "en", "si"] as const).map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className={`rounded px-1.5 py-0.5 ${
                lang === l
                  ? "bg-[color:var(--forest)] text-white"
                  : "border border-[color:var(--line)] text-[color:var(--ink)]/60"
              }`}
            >
              {l === "sv" ? "SV" : l === "en" ? "EN" : "සිං"}
            </button>
          ))}
        </div>
      </div>

      <div
        className={`rounded-xl border-2 bg-white p-4 ${
          finished ? "border-[color:var(--success)]" : "border-red-500"
        }`}
      >
        <div className="flex items-start justify-between">
          <div className="font-[Fraunces] font-semibold">{T.title}</div>
          {finished && <span className="text-[color:var(--success)]">✓</span>}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[0.7rem]">
          <span className="rounded-full bg-[color:var(--forest)]/10 px-2 py-0.5 text-[color:var(--forest)]">
            {T.badge1}
          </span>
          <span className="rounded-full bg-[color:var(--forest)]/10 px-2 py-0.5 text-[color:var(--forest)]">
            {T.badge2}
          </span>
          <span className="rounded-full bg-red-500 px-2 py-0.5 font-semibold text-white">
            {T.lateout}
          </span>
        </div>
        <div className="mt-3 rounded-lg bg-[color:var(--bg)] p-2 text-[0.72rem] text-[color:var(--ink)]/70">
          {T.instr}
        </div>

        {!open && !finished && (
          <button
            onClick={() => setOpen(true)}
            className="mt-3 w-full rounded-lg border border-[color:var(--line)] px-3 py-2 text-xs font-semibold"
          >
            Öppna checklista →
          </button>
        )}

        {open && (
          <div className="mt-3 space-y-1.5">
            {T.steps.map((s, i) => (
              <label
                key={i}
                className="flex items-center gap-2 rounded-lg border border-[color:var(--line)] px-2 py-1.5 text-[0.75rem]"
              >
                <input
                  type="checkbox"
                  checked={done[i]}
                  onChange={(e) => {
                    const next = [...done];
                    next[i] = e.target.checked;
                    setDone(next);
                  }}
                  className="accent-[color:var(--brass)]"
                />
                <span className={done[i] ? "line-through text-[color:var(--ink)]/45" : ""}>
                  {s}
                </span>
              </label>
            ))}
            {!finished && (
              <button
                onClick={() => {
                  setFinished(true);
                  setToast(true);
                  setTimeout(() => setToast(false), 2400);
                }}
                disabled={done.some((d) => !d)}
                className="mt-2 w-full rounded-lg bg-[color:var(--brass)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
              >
                {T.cta}
              </button>
            )}
          </div>
        )}
      </div>

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="mt-3 rounded-lg bg-[color:var(--forest)] px-3 py-2 text-center text-[0.72rem] font-semibold text-white"
          >
            {T.toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---------------- ADMIN ---------------- */

function AdminPane() {
  const [confirmed, setConfirmed] = useState(false);
  const [newOrder, setNewOrder] = useState(false);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) {
      setNewOrder(true);
      return;
    }
    const id = setTimeout(() => setNewOrder(true), 1800);
    return () => clearTimeout(id);
  }, [reduced]);

  const nav = [
    "Bokningar",
    "Beställningar",
    "Frukost",
    "Städning",
    "Sms",
    "Priser",
    "Statistik",
    "Inställningar",
  ];

  return (
    <DemoCard caption="En bekräftelse uppdaterar allt: gästens sms, frukostlistan och städprioriteringen. Du gör en sak — systemet gör resten.">
      <div className="grid gap-0 overflow-hidden rounded-2xl border border-[color:var(--line)] bg-white md:grid-cols-[180px_1fr]">
        {/* Sidebar */}
        <aside className="border-b border-[color:var(--line)] bg-[color:var(--bg)] p-3 md:border-b-0 md:border-r">
          <div className="mb-2 px-2 text-[0.62rem] uppercase tracking-wider text-[color:var(--ink)]/50">
            StayBoost · Admin
          </div>
          <nav className="flex flex-wrap gap-1 md:flex-col md:gap-0.5">
            {nav.map((n, i) => (
              <button
                key={n}
                className={`rounded-lg px-2.5 py-1.5 text-left text-xs ${
                  i === 1
                    ? "bg-[color:var(--forest)] text-white"
                    : "text-[color:var(--ink)]/70 hover:bg-white"
                }`}
              >
                {n}
              </button>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <div className="p-4 text-sm">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-[0.7rem] uppercase tracking-wide text-[color:var(--ink)]/55">
                Beställningar
              </div>
              <div className="font-[Fraunces] text-lg font-semibold">Idag</div>
            </div>
            <div className="text-[0.72rem] text-[color:var(--ink)]/55">
              {newOrder ? "3" : "2"} st · uppdaterat nu
            </div>
          </div>

          <div className="space-y-2">
            <OrderRow
              tent="Tält 3"
              name="Erikson · 15 juli"
              item="Ved (säck) × 2"
              price="240 kr"
              status="paid"
            />
            <OrderRow
              tent="Tält 1"
              name="Lund · 13 juli"
              item="Bastutid 1h"
              price="350 kr"
              status="paid"
            />

            <AnimatePresence>
              {newOrder && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{
                    opacity: 1,
                    y: 0,
                    boxShadow: confirmed
                      ? "0 0 0 rgba(176,141,62,0)"
                      : "0 0 0 3px rgba(176,141,62,0.25)",
                  }}
                  transition={{ duration: 0.4 }}
                  className="rounded-xl border border-[color:var(--brass)]/60 bg-[color:var(--brass)]/5 p-3"
                >
                  <div className="mb-2 flex items-center gap-2 text-[0.72rem] font-semibold text-[color:var(--brass)]">
                    {!confirmed && (
                      <span className="relative flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[color:var(--brass)]/60" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-[color:var(--brass)]" />
                      </span>
                    )}
                    🔔 Ny beställning
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold">Frukostkorg × 2 · Tält 1 · 498 kr</div>
                      <div className="text-[0.7rem] text-[color:var(--ink)]/60">
                        {confirmed ? "Status: Betald ✓" : "Avvaktar betalning"}
                      </div>
                    </div>
                    {!confirmed && (
                      <button
                        onClick={() => setConfirmed(true)}
                        className="rounded-lg bg-[color:var(--brass)] px-3 py-1.5 text-xs font-semibold text-white"
                      >
                        Bekräfta betalning
                      </button>
                    )}
                  </div>

                  <AnimatePresence>
                    {confirmed && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        transition={{ duration: 0.35 }}
                        className="mt-3 space-y-1 overflow-hidden border-t border-[color:var(--brass)]/30 pt-3 text-[0.72rem]"
                      >
                        <SyncLine delay={0.05}>
                          → Frukostvyn: <b>+2 portioner 13 juli</b>
                        </SyncLine>
                        <SyncLine delay={0.2}>
                          → Gästen: <b>bekräftelsesms skickat</b>
                        </SyncLine>
                        <SyncLine delay={0.35}>
                          → Städning: <b>tidig incheckning flaggad</b>
                        </SyncLine>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </DemoCard>
  );
}

function SyncLine({ children, delay }: { children: ReactNode; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.25 }}
      className="text-[color:var(--ink)]/75"
    >
      {children}
    </motion.div>
  );
}

function OrderRow({
  tent,
  name,
  item,
  price,
  status,
}: {
  tent: string;
  name: string;
  item: string;
  price: string;
  status: "paid" | "await";
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-[color:var(--line)] bg-white px-3 py-2 text-[0.78rem]">
      <div>
        <div className="font-semibold">{item}</div>
        <div className="text-[0.7rem] text-[color:var(--ink)]/55">
          {tent} · {name}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="tabular-nums">{price}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-[0.62rem] font-semibold ${
            status === "paid"
              ? "bg-[color:var(--success)]/10 text-[color:var(--success)]"
              : "bg-amber-100 text-amber-800"
          }`}
        >
          {status === "paid" ? "Betald" : "Avvaktar"}
        </span>
      </div>
    </div>
  );
}

/* ---------------- helpers ---------------- */

function DemoCard({ children, caption }: { children: ReactNode; caption: string }) {
  return (
    <figure className="flex h-full flex-col gap-4">
      <div className="card-surface flex-1 p-5">{children}</div>
      <figcaption className="text-sm leading-relaxed text-[color:var(--ink)]/70">
        {caption}
      </figcaption>
    </figure>
  );
}

function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[280px] rounded-[32px] border border-[color:var(--line)] bg-[#EDE8DE] p-3 shadow-[0_20px_50px_-20px_rgba(20,36,28,0.3)]">
      <div className="rounded-[24px] bg-[color:var(--bg)] p-4">{children}</div>
    </div>
  );
}

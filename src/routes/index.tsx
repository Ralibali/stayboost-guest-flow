import { useEffect, useState, type ReactNode } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { motion, useReducedMotion } from "framer-motion";

export const Route = createFileRoute("/")({
  component: Index,
});

const EASE = [0.22, 1, 0.36, 1] as const;

function Index() {
  return (
    <main className="min-h-screen bg-[color:var(--bg)] text-[color:var(--ink)]">
      <Header />
      <Hero />
      <Stats />
      <Features />
      <Showcase />
      <HowItWorks />
      <Pricing />
      <Faq />
      <FinalCta />
      <Footer />
    </main>
  );
}

/* ---------- Header ---------- */
function Header() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 backdrop-blur-md transition-[background-color,border-color] duration-300 ${
        scrolled
          ? "border-b border-[color:var(--line)] bg-[color:var(--bg)]/85"
          : "border-b border-transparent bg-[color:var(--bg)]/60"
      }`}
    >
      <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link to="/" className="font-[Fraunces] text-xl font-semibold tracking-tight sm:text-2xl">
          StayBoost
        </Link>
        <nav className="hidden items-center gap-7 text-[13.5px] font-medium text-[color:var(--ink)]/65 md:flex">
          <a href="#funktioner" className="transition hover:text-[color:var(--ink)]">
            Funktioner
          </a>
          <a href="#produkten" className="transition hover:text-[color:var(--ink)]">
            Produkten
          </a>
          <a href="#sa-funkar-det" className="transition hover:text-[color:var(--ink)]">
            Så funkar det
          </a>
          <a href="#pris" className="transition hover:text-[color:var(--ink)]">
            Pris
          </a>
          <a href="#faq" className="transition hover:text-[color:var(--ink)]">
            FAQ
          </a>
          <Link to="/demo" className="text-[color:var(--brass)] transition hover:opacity-75">
            Testa demon
          </Link>
        </nav>
        <div className="flex items-center gap-2">
          <Link
            to="/app/login"
            className="hidden px-3 py-2 text-[13.5px] font-medium text-[color:var(--ink)]/65 transition hover:text-[color:var(--ink)] sm:block"
          >
            Logga in
          </Link>
          <Link to="/app/login" className="btn-primary !px-5 !py-2.5 !text-[13.5px]">
            Kom igång <span className="btn-arrow">→</span>
          </Link>
        </div>
      </div>
    </header>
  );
}

/* ---------- Reveal: mjuk entré med blur, respekterar reduced motion ---------- */
function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 16, filter: "blur(8px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-70px" }}
      transition={{ duration: 0.7, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } },
};
const rise = {
  hidden: { opacity: 0, y: 20, filter: "blur(8px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.75, ease: EASE } },
};

/* ---------- Hero ---------- */
function Hero() {
  const reduce = useReducedMotion();
  return (
    <section className="relative overflow-hidden">
      <motion.div
        variants={reduce ? undefined : stagger}
        initial={reduce ? undefined : "hidden"}
        animate={reduce ? undefined : "show"}
        className="mx-auto max-w-[1200px] px-4 pb-16 pt-14 sm:px-6 sm:pb-24 sm:pt-20"
      >
        <div className="max-w-[880px]">
          <motion.p
            variants={reduce ? undefined : rise}
            className="eyebrow flex items-center gap-2.5"
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[color:var(--brass)]" />
            Bokningsplattform för glamping, stugor & småboenden
          </motion.p>
          <motion.h1
            variants={reduce ? undefined : rise}
            className="mt-6 font-[Fraunces] text-[clamp(44px,7vw,88px)] font-semibold leading-[1.02] tracking-[-0.03em]"
          >
            Dina gäster bokar direkt.
            <br />
            <em className="font-medium">Du behåller varje krona.</em>
          </motion.h1>
          <motion.p
            variants={reduce ? undefined : rise}
            className="mt-7 max-w-[560px] text-[17px] leading-relaxed text-[color:var(--ink)]/70 sm:text-[19px]"
          >
            StayBoost samlar direktbokningar, betalningar, kanaler och gästmejl i ett lugnt, vackert
            verktyg — med 0&nbsp;% provision och en bokningssida som känns som ditt eget varumärke.
          </motion.p>
          <motion.div
            variants={reduce ? undefined : rise}
            className="mt-9 flex flex-wrap items-center gap-3"
          >
            <Link to="/app/login" className="btn-primary">
              Kom igång gratis <span className="btn-arrow">→</span>
            </Link>
            <a href="#produkten" className="btn-ghost">
              Se bokningsmotorn
            </a>
          </motion.div>
          <motion.p
            variants={reduce ? undefined : rise}
            className="mt-6 font-mono text-[12px] tracking-wide text-[color:var(--muted)]"
          >
            0 % provision &nbsp;·&nbsp; 15 min uppsättning &nbsp;·&nbsp; Ingen bindningstid
          </motion.p>
        </div>

        {/* Hero-visual: verklig produkt i webbläsarkrom */}
        <motion.div variants={reduce ? undefined : rise} className="relative mt-14 sm:mt-20">
          <BrowserFrame
            src="/landing/boka-hero.png"
            alt="StayBoosts bokningsmotor — skandinavisk, minimalistisk bokningssida med kalender och pris"
            url="stayboost.se/boka/gota-kanal-glamping"
            className="shadow-[var(--shadow-hero)]"
          />
          <FloatChip className="right-[4%] top-[-18px] sm:top-[-22px]" delay={0.9}>
            0 % provision
          </FloatChip>
          <FloatChip className="bottom-[18%] left-[-10px] hidden sm:flex" delay={1.05}>
            Stripe · Swish · iCal
          </FloatChip>
          <FloatChip className="bottom-[-16px] right-[10%]" delay={1.2}>
            SV · EN · DE
          </FloatChip>
        </motion.div>
      </motion.div>
    </section>
  );
}

function FloatChip({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.span
      initial={reduce ? false : { opacity: 0, scale: 0.85, y: 8 }}
      whileInView={{ opacity: 1, scale: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.55, ease: EASE, delay }}
      className={`absolute z-10 flex items-center gap-1.5 rounded-full border border-[color:var(--line)] bg-white px-3.5 py-2 font-mono text-[11px] font-medium tracking-wide text-[color:var(--ink)] shadow-[var(--shadow-lift)] ${className ?? ""}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--brass)]" />
      {children}
    </motion.span>
  );
}

/* ---------- Webbläsarkrom runt produktskärmdumpar ---------- */
function BrowserFrame({
  src,
  alt,
  url,
  dark = false,
  className,
}: {
  src: string;
  alt: string;
  url: string;
  dark?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-[14px] border bg-white ${
        dark ? "border-white/15" : "border-[color:var(--line)]"
      } ${className ?? ""}`}
    >
      <div
        className={`flex items-center gap-1.5 border-b px-4 py-2.5 ${
          dark ? "border-white/10 bg-[#232320]" : "border-[color:var(--line)] bg-[#FAFAF8]"
        }`}
      >
        <span className={`h-2.5 w-2.5 rounded-full ${dark ? "bg-white/15" : "bg-[#E7E7E1]"}`} />
        <span className={`h-2.5 w-2.5 rounded-full ${dark ? "bg-white/15" : "bg-[#E7E7E1]"}`} />
        <span className={`h-2.5 w-2.5 rounded-full ${dark ? "bg-white/15" : "bg-[#E7E7E1]"}`} />
        <span
          className={`ml-3 max-w-[320px] flex-1 truncate rounded-md border px-2.5 py-1 font-mono text-[10.5px] ${
            dark
              ? "border-white/10 bg-white/5 text-white/50"
              : "border-[color:var(--line)] bg-white text-[color:var(--muted)]"
          }`}
        >
          {url}
        </span>
      </div>
      <img src={src} alt={alt} className="block w-full" loading="lazy" />
    </div>
  );
}

/* ---------- Section-head: eyebrow + Fraunces-rubrik ---------- */
function SectionHead({
  eyebrow,
  title,
  lead,
  dark = false,
}: {
  eyebrow: string;
  title: ReactNode;
  lead?: string;
  dark?: boolean;
}) {
  return (
    <Reveal className="max-w-[720px]">
      <p className="eyebrow flex items-center gap-2.5">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-[color:var(--brass)]" />
        {eyebrow}
      </p>
      <h2
        className={`mt-5 font-[Fraunces] text-[clamp(32px,4.6vw,56px)] font-semibold leading-[1.05] tracking-[-0.025em] ${
          dark ? "text-[#FAFAF8]" : ""
        }`}
      >
        {title}
      </h2>
      {lead && (
        <p
          className={`mt-5 text-[16px] leading-relaxed sm:text-[18px] ${
            dark ? "text-white/60" : "text-[color:var(--ink)]/70"
          }`}
        >
          {lead}
        </p>
      )}
    </Reveal>
  );
}

/* ---------- Stats: hårstrecksrutnät ---------- */
function Stats() {
  const items: [string, string][] = [
    ["0 %", "provision på direktbokningar"],
    ["15 min", "från konto till första bokningen"],
    ["3", "språk i bokningsmotorn — SV · EN · DE"],
    ["100 %", "av gästdatan äger du själv"],
  ];
  return (
    <section className="border-y border-[color:var(--line)]">
      <div className="mx-auto grid max-w-[1200px] grid-cols-2 px-4 sm:px-6 lg:grid-cols-4">
        {items.map(([n, label], i) => (
          <Reveal
            key={label}
            delay={i * 0.07}
            className={`border-[color:var(--line)] px-2 py-8 sm:px-8 sm:py-12 ${
              i % 2 === 1 ? "border-l" : ""
            } ${i >= 2 ? "border-t lg:border-t-0" : ""} ${i > 0 ? "lg:border-l" : ""}`}
          >
            <p className="font-mono text-[clamp(28px,3.4vw,44px)] font-medium tracking-tight">
              {n}
            </p>
            <p className="mt-2 text-[13px] leading-snug text-[color:var(--ink)]/60">{label}</p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ---------- Features: asymmetriskt grid med kodritade mini-UI:n ---------- */
type Feature = {
  no: string;
  title: string;
  copy: string;
  span: string;
  demo: ReactNode;
};

function Features() {
  const features: Feature[] = [
    {
      no: "01",
      title: "Direktbetalningar med Stripe & Swish",
      copy: "Gästen betalar vid bokningen — pengarna landar direkt hos dig, aldrig hos oss. Kort, Apple Pay eller Swish. Återbetalning vid avbokning sker med ett klick.",
      span: "lg:col-span-7",
      demo: <DemoPayment />,
    },
    {
      no: "02",
      title: "Kanaler utan channel manager",
      copy: "Synka Booking.com, Airbnb och Bookvisit via iCal i båda riktningarna. Dubbelbokningar stoppas automatiskt — även när två gäster bokar samtidigt.",
      span: "lg:col-span-5",
      demo: <DemoChannels />,
    },
    {
      no: "03",
      title: "Gästmejl som skriver sig själva",
      copy: "Bekräftelse, vägbeskrivning, dörrkod och uppföljning skickas automatiskt på gästens språk. Redigera mallarna precis som du vill ha dem.",
      span: "lg:col-span-5",
      demo: <DemoEmail />,
    },
    {
      no: "04",
      title: "Tillval som säljer sig själva",
      copy: "Frukostkorg, ved, sen utcheckning — med bilder och priser räknas allt in i totalsumman. Lägg till och ändra på sekunder i admin.",
      span: "lg:col-span-7",
      demo: <DemoAddons />,
    },
    {
      no: "05",
      title: "Chattwidget på din hemsida",
      copy: "Besökaren chattar direkt från din sida — meddelandet landar i din mejl och i inkorgen. Färger, texter och position styr du själv i inställningar.",
      span: "lg:col-span-6",
      demo: <DemoChat />,
    },
    {
      no: "06",
      title: "Kalender & överblick",
      copy: "Alla bokningar från alla kanaler i en månadsvy per enhet. Se gäst, källa och betalningsstatus direkt — och blockera datum manuellt när du vill.",
      span: "lg:col-span-6",
      demo: <DemoCalendar />,
    },
  ];

  return (
    <section id="funktioner" className="scroll-mt-24">
      <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 sm:py-28">
        <SectionHead
          eyebrow="Allt i ett"
          title={
            <>
              En plattform. <em className="font-medium">Hela</em> gästresan.
            </>
          }
          lead="Från första klicket på din hemsida till recensionen efter hemresan — varje steg är genomtänkt, automatiserat och vackert."
        />
        <div className="mt-12 grid gap-4 sm:mt-16 lg:grid-cols-12 lg:gap-5">
          {features.map((f, i) => (
            <Reveal key={f.no} delay={(i % 2) * 0.08} className={f.span}>
              <article className="card-surface card-hover flex h-full flex-col p-6 sm:p-8">
                <p className="font-mono text-[11px] tracking-[0.14em] text-[color:var(--muted)]">
                  {f.no}
                </p>
                <h3 className="mt-3 font-[Fraunces] text-[22px] font-semibold leading-snug sm:text-[26px]">
                  {f.title}
                </h3>
                <p className="mt-3 text-[14.5px] leading-relaxed text-[color:var(--ink)]/65">
                  {f.copy}
                </p>
                <div className="mt-auto pt-7">{f.demo}</div>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* --- Mini-UI: betalning --- */
function DemoPayment() {
  return (
    <div className="rounded-xl border border-[color:var(--line)] bg-[#FAFAF8] p-4">
      <div className="space-y-2 text-[13px]">
        <div className="flex justify-between">
          <span className="text-[color:var(--ink)]/70">2 nätter · Glampingtält Ek</span>
          <span className="font-mono">1 900 kr</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[color:var(--ink)]/70">Frukostkorg × 2</span>
          <span className="font-mono">290 kr</span>
        </div>
        <div className="flex justify-between border-t border-[color:var(--line)] pt-2 font-semibold">
          <span>Totalt</span>
          <span className="font-mono">2 190 kr</span>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <span className="inline-flex items-center rounded-full bg-[color:var(--ink)] px-4 py-2 text-[12.5px] font-semibold text-[#FAFAF8]">
          Betala med kort <span className="btn-arrow ml-1">→</span>
        </span>
        <span className="rounded-full border border-[color:var(--line)] bg-white px-3 py-1.5 font-mono text-[10.5px] text-[color:var(--muted)]">
          Swish
        </span>
      </div>
    </div>
  );
}

/* --- Mini-UI: kanaler --- */
function DemoChannels() {
  const rows = [
    ["Booking.com", "Synkad 09:41"],
    ["Airbnb", "Synkad 09:38"],
    ["Bookvisit", "Synkad 08:52"],
  ];
  return (
    <div className="rounded-xl border border-[color:var(--line)] bg-[#FAFAF8] p-4">
      <div className="divide-y divide-[color:var(--line)]">
        {rows.map(([name, status]) => (
          <div key={name} className="flex items-center justify-between py-2.5 text-[13px]">
            <span className="flex items-center gap-2.5 font-medium">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[color:var(--success)] opacity-40" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[color:var(--success)]" />
              </span>
              {name}
            </span>
            <span className="font-mono text-[11px] text-[color:var(--muted)]">{status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* --- Mini-UI: gästmejl --- */
function DemoEmail() {
  return (
    <div className="rounded-xl border border-[color:var(--line)] bg-[#FAFAF8] p-4">
      <p className="font-mono text-[10.5px] tracking-wide text-[color:var(--muted)]">
        TILL: anna.s@gmail.com · EN
      </p>
      <p className="mt-2 text-[13.5px] font-semibold leading-snug">
        Dags att packa — ankomst fredag från 15:00
      </p>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-[color:var(--ink)]/60">
        Hej Anna! Nu närmar sig er vistelse. Dörrkoden till tält Ek är 4 2 7 1 …
      </p>
      <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[color:var(--brass-soft)] px-2.5 py-1 font-mono text-[10.5px] font-medium text-[color:var(--brass)]">
        ✓ Skickas automatiskt 3 dagar före ankomst
      </span>
    </div>
  );
}

/* --- Mini-UI: tillval --- */
function DemoAddons() {
  return (
    <div className="rounded-xl border border-[color:var(--line)] bg-[#FAFAF8] p-4">
      {[
        ["Frukostkorg", "145 kr / natt", 2],
        ["Ved till kaminen", "85 kr", 1],
      ].map(([name, price, qty]) => (
        <div key={name as string} className="flex items-center justify-between py-2 text-[13px]">
          <div>
            <p className="font-medium">{name}</p>
            <p className="font-mono text-[10.5px] text-[color:var(--muted)]">{price}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-full border border-[color:var(--line)] bg-white text-[13px]">
              −
            </span>
            <span className="w-3 text-center font-mono text-[13px]">{qty}</span>
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[color:var(--ink)] text-[13px] text-[#FAFAF8]">
              +
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* --- Mini-UI: chatt --- */
function DemoChat() {
  return (
    <div className="relative overflow-hidden rounded-xl border border-[color:var(--line)] bg-[#FAFAF8] p-4 pb-10">
      <div className="max-w-[85%] rounded-2xl rounded-bl-sm border border-[color:var(--line)] bg-white px-3.5 py-2.5 text-[12.5px] leading-snug">
        Hej! Undrar ni över något innan ni bokar? Vi svarar så fort vi kan.
      </div>
      <div className="ml-auto mt-2.5 max-w-[70%] rounded-2xl rounded-br-sm bg-[color:var(--ink)] px-3.5 py-2.5 text-[12.5px] leading-snug text-[#FAFAF8]">
        Finns ved till kaminen att köpa till?
      </div>
      <span className="absolute bottom-4 right-4 flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--brass)] text-[15px] text-white shadow-[var(--shadow-lift)]">
        ✦
      </span>
    </div>
  );
}

/* --- Mini-UI: kalender --- */
function DemoCalendar() {
  const days = Array.from({ length: 14 }, (_, i) => i + 8);
  const booked = new Set([10, 11, 12]);
  const inRange = new Set([16, 17]);
  return (
    <div className="rounded-xl border border-[color:var(--line)] bg-[#FAFAF8] p-4">
      <p className="font-mono text-[10.5px] tracking-wide text-[color:var(--muted)]">JULI</p>
      <div className="mt-2.5 grid grid-cols-7 gap-1 text-center">
        {days.map((d) => (
          <span
            key={d}
            className={`rounded-md py-1.5 font-mono text-[11px] ${
              booked.has(d)
                ? "bg-[color:var(--ink)] text-[#FAFAF8]"
                : inRange.has(d)
                  ? "bg-[color:var(--soft)] text-[color:var(--ink)]"
                  : "text-[color:var(--ink)]/55"
            }`}
          >
            {d}
          </span>
        ))}
      </div>
      <p className="mt-3 text-[11.5px] text-[color:var(--ink)]/55">
        <span className="font-medium text-[color:var(--ink)]">10–12:</span> Fam. Andersson ·
        Booking.com · <span className="text-[color:var(--success)]">Betald</span>
      </p>
    </div>
  );
}

/* ---------- Showcase: mörk sektion med produkten ---------- */
function Showcase() {
  return (
    <section id="produkten" className="dark-band scroll-mt-24">
      <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 sm:py-28">
        <SectionHead
          dark
          eyebrow="Produkten"
          title={
            <>
              Byggd för att kännas som <em className="font-medium">ditt</em> varumärke.
            </>
          }
          lead="Ingen mall, ingen OTA-logga, ingen röra. En lugn, skandinavisk bokningsupplevelse där gästen aldrig lämnar din värld."
        />
        <Reveal delay={0.1} className="mt-12 sm:mt-16">
          <BrowserFrame
            dark
            src="/landing/boka-full.png"
            alt="Hela bokningsflödet — välj enhet, datum, tillval och betala"
            url="stayboost.se/boka/gota-kanal-glamping"
            className="shadow-[0_32px_90px_-32px_rgb(0_0_0/0.7)]"
          />
        </Reveal>

        <div className="mt-16 grid items-center gap-10 sm:mt-24 lg:grid-cols-2 lg:gap-16">
          <Reveal>
            <p className="eyebrow">Gästresan</p>
            <h3 className="mt-4 font-[Fraunces] text-[clamp(26px,3.4vw,40px)] font-semibold leading-[1.08] tracking-[-0.02em] text-[#FAFAF8]">
              Allt gästen behöver. <em className="font-medium">Inget du behöver tänka på.</em>
            </h3>
            <ul className="mt-7 space-y-4 text-[15px] leading-relaxed text-white/65">
              {[
                "Bekräftelse direkt efter betalning — på gästens språk.",
                "Personlig gästsida med ankomsttid, vägbeskrivning, wifi och dörrkod.",
                "Automatisk påminnelse innan ankomst och recensionslänk efter hemresa.",
              ].map((t) => (
                <li key={t} className="flex gap-3.5">
                  <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-[color:var(--brass)]" />
                  {t}
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={0.12}>
            <BrowserFrame
              dark
              src="/landing/gast.png"
              alt="Gästsidan med ankomstinfo, wifi och dörrkod"
              url="stayboost.se/g/x7k2…"
              className="shadow-[0_32px_90px_-32px_rgb(0_0_0/0.7)]"
            />
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ---------- Så funkar det ---------- */
function HowItWorks() {
  const steps: [string, string, string][] = [
    [
      "01",
      "Skapa ditt konto",
      "Lägg till enheter, priser och betalningsalternativ. Personlig onboarding ingår — du är igång på en kvart.",
    ],
    [
      "02",
      "Dela din bokningslänk",
      "Bädda in bokningsmotorn på hemsidan eller dela länken direkt. Synka Booking.com, Airbnb och Bookvisit via iCal.",
    ],
    [
      "03",
      "Ta emot bokningar",
      "Betalning, bekräftelse, gästmejl och kalendersynk sköter sig självt. Du följer allt i översikten.",
    ],
  ];
  return (
    <section id="sa-funkar-det" className="scroll-mt-24">
      <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 sm:py-28">
        <SectionHead
          eyebrow="Så funkar det"
          title={
            <>
              Igång på en kvart. <em className="font-medium">Seriöst.</em>
            </>
          }
        />
        <div className="mt-12 grid gap-10 sm:mt-16 md:grid-cols-3 md:gap-8">
          {steps.map(([no, title, copy], i) => (
            <Reveal key={no} delay={i * 0.1} className="border-t border-[color:var(--line)] pt-7">
              <p className="font-mono text-[13px] tracking-[0.14em] text-[color:var(--brass)]">
                {no}
              </p>
              <h3 className="mt-3.5 font-[Fraunces] text-[24px] font-semibold leading-snug">
                {title}
              </h3>
              <p className="mt-3 text-[14.5px] leading-relaxed text-[color:var(--ink)]/65">
                {copy}
              </p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- Pris ---------- */
function Pricing() {
  const included = [
    "Direktbokningar utan provision",
    "Stripe & Swish",
    "iCal-synk åt båda hållen",
    "Automatiska gästmejl",
    "Tillval & merförsäljning",
    "Chattwidget för hemsidan",
    "Kalender & överblick",
    "Svenska, engelska & tyska",
  ];
  return (
    <section id="pris" className="scroll-mt-24 border-t border-[color:var(--line)]">
      <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 sm:py-28">
        <div className="grid items-start gap-12 lg:grid-cols-2 lg:gap-20">
          <SectionHead
            eyebrow="Pris"
            title={
              <>
                Gratis under beta. <em className="font-medium">Allt</em> ingår.
              </>
            }
            lead="Vi bygger StayBoost tillsammans med våra första värdar. Därför får du full funktionalitet utan kostnad — och personlig hjälp att komma igång."
          />
          <Reveal delay={0.1}>
            <div className="card-surface p-7 sm:p-9">
              <p className="font-mono text-[11px] tracking-[0.14em] text-[color:var(--muted)]">
                DETTA INGÅR
              </p>
              <ul className="mt-5 grid gap-x-8 gap-y-3.5 sm:grid-cols-2">
                {included.map((t) => (
                  <li key={t} className="flex items-start gap-2.5 text-[14px] leading-snug">
                    <span className="mt-[3px] font-mono text-[12px] text-[color:var(--brass)]">
                      ✓
                    </span>
                    {t}
                  </li>
                ))}
              </ul>
              <div className="mt-8 flex flex-col gap-4 border-t border-[color:var(--line)] pt-7 sm:flex-row sm:items-center sm:justify-between">
                <p className="font-mono text-[12px] leading-relaxed text-[color:var(--muted)]">
                  Priser efter beta meddelas ≥ 60 dagar i förväg.
                  <br />
                  Din data är din — exportera när du vill.
                </p>
                <Link to="/app/login" className="btn-primary shrink-0">
                  Skapa konto <span className="btn-arrow">→</span>
                </Link>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ---------- FAQ ---------- */
function Faq() {
  const items: [string, string][] = [
    [
      "Tar StayBoost provision på mina bokningar?",
      "Nej — 0 %. Betalningen går direkt till ditt eget Stripe-konto eller ditt Swish-nummer. Vi rör aldrig pengarna.",
    ],
    [
      "Fungerar det med Booking.com, Airbnb och Bookvisit?",
      "Ja. Kalendern synkas via iCal i båda riktningarna — utan channel manager. Nya bokningar från kanalerna dyker upp automatiskt, och dubbelbokningar stoppas.",
    ],
    [
      "Vad behöver jag för att ta betalt?",
      "Ett Stripe-konto (gratis att skapa) eller ett Swish-nummer. Vill du inte ta betalt online alls går det utmärkt att ta bokningen och swisha på plats.",
    ],
    [
      "Kan mina gäster boka på engelska eller tyska?",
      "Ja. Bokningsmotorn växlar mellan svenska, engelska och tyska, och gästmejlen skickas på gästens språk.",
    ],
    [
      "Hur gör jag vid avbokning?",
      "Ett klick i admin: Stripe-återbetalningen genomförs direkt, Swish markeras så att du swishar tillbaka. Kalendern frigörs automatiskt.",
    ],
  ];
  return (
    <section id="faq" className="scroll-mt-24 border-t border-[color:var(--line)]">
      <div className="mx-auto max-w-[860px] px-4 py-20 sm:px-6 sm:py-28">
        <SectionHead eyebrow="FAQ" title="Frågor & svar" />
        <div className="mt-10 sm:mt-14">
          {items.map(([q, a], i) => (
            <FaqItem key={q} q={q} a={a} defaultOpen={i === 0} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FaqItem({ q, a, defaultOpen = false }: { q: string; a: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Reveal className="border-b border-[color:var(--line)] first:border-t">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-6 py-5 text-left sm:py-6"
      >
        <span className="font-[Fraunces] text-[18px] font-semibold leading-snug sm:text-[21px]">
          {q}
        </span>
        <span className="relative h-4 w-4 shrink-0">
          <span className="absolute left-0 top-1/2 h-[1.5px] w-full -translate-y-1/2 bg-[color:var(--ink)]" />
          <span
            className={`absolute left-1/2 top-0 h-full w-[1.5px] -translate-x-1/2 bg-[color:var(--ink)] transition-transform duration-200 ${
              open ? "scale-y-0" : ""
            }`}
          />
        </span>
      </button>
      <div
        className="overflow-hidden transition-[max-height] duration-300 ease-out"
        style={{ maxHeight: open ? 280 : 0 }}
      >
        <p className="max-w-[640px] pb-6 text-[14.5px] leading-relaxed text-[color:var(--ink)]/65">
          {a}
        </p>
      </div>
    </Reveal>
  );
}

/* ---------- Slut-CTA: mörkt band med terrakotta-glöd ---------- */
function FinalCta() {
  return (
    <section className="dark-band relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(620px 420px at 88% 8%, rgb(192 90 51 / 0.28), transparent 62%)",
        }}
      />
      <div className="relative mx-auto max-w-[1200px] px-4 py-24 sm:px-6 sm:py-36">
        <Reveal className="max-w-[760px]">
          <p className="eyebrow flex items-center gap-2.5">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[color:var(--brass)]" />
            Kom igång
          </p>
          <h2 className="mt-6 font-[Fraunces] text-[clamp(36px,5.6vw,72px)] font-semibold leading-[1.03] tracking-[-0.03em] text-[#FAFAF8]">
            Sluta hyra tillbaka <em className="font-medium">dina egna</em> gäster.
          </h2>
          <p className="mt-6 max-w-[520px] text-[16px] leading-relaxed text-white/60 sm:text-[18px]">
            Varje bokning via en OTA kostar 15–20&nbsp;% i provision. Din egen bokningsmotor betalar
            sig själv redan första helgen.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-5">
            <Link
              to="/app/login"
              className="btn-primary !bg-[#FAFAF8] !text-[#1B1B19] hover:!bg-white"
            >
              Kom igång gratis <span className="btn-arrow">→</span>
            </Link>
            <p className="font-mono text-[12px] tracking-wide text-white/45">
              0 % provision · 3 språk · iCal-synk
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------- Footer ---------- */
function Footer() {
  return (
    <footer className="border-t border-[color:var(--line)]">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-4 py-12 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <p className="font-[Fraunces] text-xl font-semibold tracking-tight">StayBoost</p>
          <p className="mt-1.5 font-mono text-[11.5px] tracking-wide text-[color:var(--muted)]">
            Byggt för Sveriges småboenden.
          </p>
        </div>
        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-[13px] font-medium text-[color:var(--ink)]/60">
          <Link to="/integritetspolicy" className="transition hover:text-[color:var(--ink)]">
            Integritet
          </Link>
          <Link to="/villkor" className="transition hover:text-[color:var(--ink)]">
            Villkor
          </Link>
          <Link to="/cookies" className="transition hover:text-[color:var(--ink)]">
            Cookies
          </Link>
          <Link to="/dpa" className="transition hover:text-[color:var(--ink)]">
            DPA
          </Link>
          <Link to="/app/login" className="transition hover:text-[color:var(--ink)]">
            Logga in
          </Link>
        </nav>
      </div>
    </footer>
  );
}

import { useEffect, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { PhoneMockup } from "@/components/landing/PhoneMockup";
import { RevenueCalculator } from "@/components/landing/RevenueCalculator";
import { FAQ } from "@/components/landing/FAQ";
import { ProductTour } from "@/components/landing/ProductTour";
import { FeaturesGrid } from "@/components/landing/FeaturesGrid";
import { LeadMagnet } from "@/components/landing/LeadMagnet";
import { LiveDemo } from "@/components/landing/LiveDemo";
import { StickyMobileCTA } from "@/components/landing/StickyMobileCTA";
import { EarlyAccessForm } from "@/components/landing/EarlyAccessForm";
import { DemoSms } from "@/components/landing/DemoSms";
import { CaseStudy } from "@/components/landing/CaseStudy";
import { BookFounder } from "@/components/landing/BookFounder";
import { HeroProofLine } from "@/components/landing/HeroProofLine";

const BRAND_NAME = "StayBoost";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return (
    <main className="min-h-screen bg-[color:var(--bg)]">
      <Header />
      <Hero />
      <SocialProof />
      <Problem />
      <HowItWorks />
      <CaseStudy />
      <ProductTour />
      <LiveDemo />

      <Features />
      <FeaturesGrid />
      <DemoSms />
      <LeadMagnet />
      <RevenueCalculator />
      <Testimonial />
      <Pricing />
      <FAQ />
      <BookFounder />
      <FinalCTA />
      <Footer />
      <StickyMobileCTA />
    </main>
  );
}

/* ---------- Header ---------- */
function Header() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollToHeroForm = (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById("hero-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <header
      className={`sticky top-0 z-50 backdrop-blur transition-colors ${
        scrolled
          ? "border-b border-[color:var(--line)] bg-[color:var(--bg)]/85"
          : "bg-[color:var(--bg)]/60"
      }`}
    >
      <div className="mx-auto flex max-w-[1120px] items-center justify-between gap-4 px-6 py-4">
        <a href="#" className="font-[Fraunces] text-2xl font-semibold tracking-tight">
          {BRAND_NAME}
        </a>
        <nav className="hidden items-center gap-8 text-sm md:flex">
          <a href="#sa-funkar-det" className="hover:text-[color:var(--brass)]">
            Så funkar det
          </a>
          <a href="#produkten" className="hover:text-[color:var(--brass)]">
            Produkten
          </a>
          <a href="#pris" className="hover:text-[color:var(--brass)]">
            Pris
          </a>
          <a href="#faq" className="hover:text-[color:var(--brass)]">
            FAQ
          </a>
        </nav>
        <a
          href="#hero-form"
          onClick={scrollToHeroForm}
          className="btn-primary text-sm"
          style={{ padding: "12px 22px" }}
        >
          Prova gratis
        </a>
      </div>
    </header>
  );
}

/* ---------- FadeUp helper ---------- */
function FadeUp({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

/* ---------- Hero ---------- */
function Hero() {
  return (
    <section
      id="hero-form"
      className="relative overflow-hidden bg-[color:var(--forest)] pb-24 pt-16 md:pb-32 md:pt-24"
    >
      {/* TODO: byt till riktigt kvällsfoto från anläggningen */}
      <div
        className="absolute inset-0 -z-10 bg-cover bg-center opacity-70 md:opacity-100"
        style={{ backgroundImage: "url('/hero-glamping.jpg')" }}
        aria-hidden
      />
      <div
        className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(20,40,30,0.85)_0%,rgba(20,40,30,0.75)_100%)] md:bg-[linear-gradient(90deg,rgba(30,58,45,0.92)_0%,rgba(30,58,45,0.75)_45%,rgba(30,58,45,0.15)_100%)]"
        aria-hidden
      />
      {/* Alt-text bakgrund: glamping-tält vid Göta kanal i skymning, med lyktljus. */}
      <span className="sr-only">
        Bakgrundsbild: glamping-tält vid Göta kanal i skymning, med varmt lyktljus.
      </span>

      <div className="relative mx-auto grid max-w-[1120px] items-center gap-16 px-6 md:grid-cols-[55fr_45fr]">
        <div>
          <FadeUp>
            <h1 className="text-white" style={{ fontSize: "clamp(2.5rem, 6vw, 5rem)" }}>
              Dina gäster vill köpa mer.{" "}
              <em className="not-italic">
                <span className="italic text-[color:var(--brass)]">Låt dem.</span>
              </em>
            </h1>
          </FadeUp>
          <FadeUp delay={0.1}>
            <p className="mt-6 max-w-xl text-white/85">
              {BRAND_NAME} lägger sig ovanpå bokningarna du redan har — automatiserad
              merförsäljning, gäst-SMS, digital incheckning och arbetsvyer för frukost och städ. Ett
              lager driftautomation för små boenden. Utan app. Igång på en kväll.
            </p>
          </FadeUp>
          <FadeUp delay={0.15}>
            <p className="mt-4 text-[0.9rem] text-[color:var(--brass)]">
              Bevisat i skarp drift: <HeroProofLine />
            </p>
          </FadeUp>
          <FadeUp delay={0.2}>
            <div className="mt-8 max-w-md">
              <EarlyAccessForm location="hero" variant="dark" buttonLabel="Få tidig tillgång" />
            </div>
            <p className="mt-4 text-[0.85rem] text-white/70">
              Inget kort. Igång på en kväll.{" "}
              <a
                href="#demo-sms"
                onClick={() => {
                  if (typeof window === "undefined") return;
                  const w = window as unknown as {
                    plausible?: (e: string, opts?: { props?: Record<string, string> }) => void;
                  };
                  w.plausible?.("Hero Demo Link Clicked", {
                    props: { target: "demo-sms", label: "testa gästflödet via SMS" },
                  });
                }}
                className="underline decoration-white/40 underline-offset-2 hover:text-white hover:decoration-white"
              >
                eller testa gästflödet via SMS
              </a>
            </p>
          </FadeUp>
        </div>

        <FadeUp delay={0.15}>
          <div className="rounded-[52px] p-1 ring-1 ring-white/25 [box-shadow:0_30px_80px_-20px_rgba(0,0,0,0.5)]">
            <PhoneMockup />
          </div>
        </FadeUp>
      </div>
    </section>
  );
}

/* ---------- Social proof ---------- */
function SocialProof() {
  return (
    <section className="border-y border-[color:var(--line)] bg-white/60">
      <div className="mx-auto max-w-[1120px] px-6 py-6">
        <p className="text-center text-sm text-[color:var(--ink)]/70">
          I pilotdrift på{" "}
          <strong className="font-semibold text-[color:var(--ink)]">Göta Kanal Glamping</strong> —
          byggd av ägaren, testad på riktiga gäster.{" "}
          <a href="#case-study" className="text-[color:var(--brass)] underline underline-offset-2">
            Se siffrorna →
          </a>
        </p>
      </div>
    </section>
  );
}

/* ---------- Problem ---------- */
function Problem() {
  const items = [
    {
      icon: "🔁",
      title: "Samma fråga, 200:e gången",
      body: '"Vad är portkoden?" "Finns det wifi?" Du är receptionist dygnet runt, gratis.',
    },
    {
      icon: "💸",
      title: "Intäkter som aldrig säljs",
      body: "Sen utcheckning, frukostkorg, ved. Gästen hade sagt ja — om någon frågat i rätt ögonblick.",
    },
    {
      icon: "📝",
      title: "Lappar, grupptråden och huvudet",
      body: "Vem städar Tält 2? Hur många frukostar i morgon? Var allergin gluten eller laktos? Driften bor i ditt minne — tills den inte gör det.",
    },
  ];
  return (
    <section className="py-20 md:py-32">
      <div className="mx-auto max-w-[1120px] px-6">
        <div className="max-w-2xl">
          <p className="eyebrow">Känns det igen?</p>
          <h2 className="mt-3" style={{ fontSize: "clamp(2rem, 4vw, 3rem)" }}>
            Du driver en hotellverksamhet — med en personalstyrka på en.
          </h2>
        </div>
        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {items.map((it, i) => (
            <FadeUp key={i} delay={i * 0.1}>
              <div className="card-surface h-full p-8">
                <div
                  className="mb-5 grid h-12 w-12 place-items-center rounded-full border border-[color:var(--brass)] text-xl"
                  aria-hidden
                >
                  {it.icon}
                </div>
                <h3 className="text-xl">{it.title}</h3>
                <p className="mt-3 text-[color:var(--ink)]/75">{it.body}</p>
              </div>
            </FadeUp>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- How it works ---------- */
function HowItWorks() {
  const steps = [
    {
      n: 1,
      title: "Koppla dina bokningar",
      body: "Fungerar med Sirvoy, Booking.com och manuell inmatning. Fem minuter, klart.",
    },
    {
      n: 2,
      title: "Välj dina meddelanden",
      body: "Beprövade mallar för före, under och efter vistelsen. Redigera fritt eller kör som de är.",
    },
    {
      n: 3,
      title: "Se tillvalen ticka in",
      body: "Gästen bokar med ett tryck i SMS:et, betalar direkt. Du får en notis och pengarna.",
    },
  ];
  return (
    <section
      id="sa-funkar-det"
      className="border-t border-[color:var(--line)] bg-white/50 py-20 md:py-32"
    >
      <div className="mx-auto max-w-[1120px] px-6">
        <div className="max-w-2xl">
          <p className="eyebrow">Tre steg</p>
          <h2 className="mt-3" style={{ fontSize: "clamp(2rem, 4vw, 3rem)" }}>
            Igång på en kväll. På riktigt.
          </h2>
        </div>

        <div className="relative mt-16 grid gap-12 md:grid-cols-3 md:gap-8">
          <div
            className="pointer-events-none absolute left-8 top-8 hidden h-[calc(100%-4rem)] w-px bg-[color:var(--brass)]/40 md:block md:left-0 md:top-8 md:h-px md:w-full"
            aria-hidden
          />
          {steps.map((s, i) => (
            <FadeUp key={s.n} delay={i * 0.1}>
              <div className="relative flex gap-5 md:flex-col md:gap-6">
                <div className="relative z-10 grid h-16 w-16 shrink-0 place-items-center rounded-full border border-[color:var(--brass)] bg-[color:var(--bg)] font-[Fraunces] text-2xl font-semibold text-[color:var(--brass)]">
                  {s.n}
                </div>
                <div>
                  <h3 className="text-xl">{s.title}</h3>
                  <p className="mt-2 text-[color:var(--ink)]/75">{s.body}</p>
                </div>
              </div>
            </FadeUp>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- Features ---------- */
function Features() {
  const blocks = [
    {
      title: "Rätt ord, rätt sekund — utan att du lyfter ett finger.",
      body: "Välkomstinfo två dagar före ankomst, portkod på incheckningsdagen, tips på middagsställen kväll ett, omdömesfråga dagen efter utcheckning. Allt tajmat mot bokningen, automatiskt.",
      fact: "Spar i snitt 5 timmar per vecka.",
      mock: <TimelineMock />,
    },
    {
      title: "Din meny av extraintäkter.",
      body: "Sen utcheckning, frukostkorg, ved, bastutid, cykeluthyrning — du bestämmer utbudet och priset. StayBoost erbjuder rätt tillval vid rätt tidpunkt, gästen betalar med ett tryck.",
      fact: "15–25 % av gästerna tackar ja.",
      mock: <AddonsMock />,
    },
    {
      title: "Allt gästen behöver. En länk.",
      body: "Portkod, wifi, husregler, lokala tips och dina tillval — samlat på en mobilanpassad sida gästen når via SMS-länken. Ingen nedladdning, ingen inloggning.",
      fact: "Färre frågor. Nöjdare gäster.",
      mock: <GuestHubMock />,
    },
  ];

  return (
    <section id="funktioner" className="py-20 md:py-32">
      <div className="mx-auto flex max-w-[1120px] flex-col gap-24 px-6 md:gap-32">
        {blocks.map((b, i) => {
          const reverse = i % 2 === 1;
          return (
            <FadeUp key={i}>
              <div
                className={`grid items-center gap-12 md:grid-cols-2 md:gap-16 ${
                  reverse ? "md:[&>*:first-child]:order-2" : ""
                }`}
              >
                <div>
                  <h3 className="max-w-md" style={{ fontSize: "clamp(1.75rem, 3vw, 2.25rem)" }}>
                    {b.title}
                  </h3>
                  <p className="mt-5 text-[color:var(--ink)]/75">{b.body}</p>
                  <p className="mt-6 font-semibold text-[color:var(--brass)]">{b.fact}</p>
                </div>
                <div className="card-surface p-6">{b.mock}</div>
              </div>
            </FadeUp>
          );
        })}
      </div>
    </section>
  );
}

function TimelineMock() {
  const rows = [
    { when: "T-2 dagar", label: "Välkomstmeddelande", time: "09:00" },
    { when: "Ankomstdag", label: "Portkod & incheckning", time: "12:00" },
    { when: "Kväll 1", label: "Middagstips i närheten", time: "17:30" },
    { when: "Dag efter", label: "Fråga om omdöme", time: "10:00" },
  ];
  return (
    <div className="space-y-3">
      {rows.map((r, i) => (
        <div
          key={i}
          className="flex items-center justify-between gap-3 rounded-xl border border-[color:var(--line)] bg-[color:var(--bg)] px-4 py-3 text-sm"
        >
          <div className="flex items-center gap-3">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-[color:var(--brass)]/15 text-[color:var(--brass)]">
              ✓
            </span>
            <div>
              <div className="font-semibold">{r.label}</div>
              <div className="text-xs text-[color:var(--ink)]/55">{r.when}</div>
            </div>
          </div>
          <span className="text-xs tabular-nums text-[color:var(--ink)]/60">{r.time}</span>
        </div>
      ))}
    </div>
  );
}

function AddonsMock() {
  const addons = [
    { name: "Sen utcheckning", price: 150 },
    { name: "Frukostkorg", price: 249 },
    { name: "Ved (säck)", price: 120 },
    { name: "Bastutid 1h", price: 350 },
    { name: "Cykeluthyrning", price: 200 },
    { name: "Vinpaket", price: 395 },
  ];
  return (
    <div className="grid grid-cols-2 gap-3">
      {addons.map((a, i) => (
        <div
          key={i}
          className="rounded-xl border border-[color:var(--line)] bg-[color:var(--bg)] p-4 text-sm"
        >
          <div className="font-semibold">{a.name}</div>
          <div className="mt-1 text-[color:var(--brass)]">{a.price} kr</div>
        </div>
      ))}
    </div>
  );
}

function GuestHubMock() {
  return (
    <div className="mx-auto max-w-[260px] rounded-2xl border border-[color:var(--line)] bg-[color:var(--bg)] p-4">
      <div className="text-center">
        <div className="font-[Fraunces] text-lg font-semibold">Sjöstugan</div>
        <div className="text-xs text-[color:var(--ink)]/55">Anna · 12–14 juli</div>
      </div>
      <div className="mt-4 space-y-2 text-sm">
        <InfoRow k="Portkod" v="4482" />
        <InfoRow k="Wifi" v="Sjostugan_2G" />
        <InfoRow k="Incheckning" v="15:00" />
      </div>
      <div className="mt-4 rounded-xl border border-[color:var(--brass)]/50 bg-white p-3 text-xs">
        <div className="font-semibold">Frukostkorg</div>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-[color:var(--brass)]">249 kr</span>
          <span className="rounded-md bg-[color:var(--brass)] px-2 py-1 text-white">Boka</span>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-white px-3 py-2">
      <span className="text-[color:var(--ink)]/60">{k}</span>
      <span className="font-semibold tabular-nums">{v}</span>
    </div>
  );
}

/* ---------- Testimonial ---------- */
function Testimonial() {
  return (
    <section className="py-20 md:py-32">
      <div className="mx-auto max-w-3xl px-6 text-center">
        <FadeUp>
          <p
            className="font-[Fraunces] italic text-[color:var(--ink)]"
            style={{ fontSize: "clamp(1.5rem, 3vw, 2.25rem)", lineHeight: 1.3 }}
          >
            "Det betalar sig självt — varje månad. Första säsongen med StayBoost sålde vi tillval
            för mer än hela årskostnaden, första veckan."
          </p>
        </FadeUp>
        <FadeUp delay={0.1}>
          <div className="mt-8 flex items-center justify-center gap-3">
            {/* TODO: byt platshållar-avatar */}
            <div className="h-12 w-12 rounded-full bg-[color:var(--line)]" aria-hidden />
            <div className="text-left text-sm">
              {/* TODO: byt platshållar-namn */}
              <div className="font-semibold">Namn Efternamn</div>
              <div className="text-[color:var(--ink)]/60">Ägare, [Anläggning]</div>
            </div>
          </div>
        </FadeUp>

        <div className="mx-auto mt-16 max-w-md border-t border-[color:var(--line)] pt-8">
          <div className="flex items-center justify-center gap-3 text-sm text-[color:var(--ink)]/70">
            {/* TODO: byt platshållar-porträtt */}
            <div className="h-9 w-9 rounded-full bg-[color:var(--line)]" aria-hidden />
            <span>
              Byggt av ägaren till <strong>Bergs Slussar Glamping</strong> — för att jag behövde det
              själv.
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- Pricing ---------- */
function Pricing() {
  const [annual, setAnnual] = useState(false);
  return (
    <section id="pris" className="border-t border-[color:var(--line)] bg-white/50 py-20 md:py-32">
      <div className="mx-auto max-w-[1120px] px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="eyebrow">Ett pris. Allt ingår.</p>
          <h2 className="mt-3" style={{ fontSize: "clamp(2rem, 4vw, 3rem)" }}>
            Enkel prissättning, utan förbehåll.
          </h2>
        </div>

        <FadeUp>
          <div
            className="card-surface mx-auto mt-12 max-w-[480px] p-8 md:p-10"
            style={{
              borderColor: "var(--brass)",
              boxShadow: "0 20px 60px rgba(20,36,28,0.12)",
            }}
          >
            <div className="mx-auto mb-6 inline-flex w-full items-center justify-center rounded-full border border-[color:var(--line)] bg-[color:var(--bg)] p-1 text-sm">
              <button
                onClick={() => setAnnual(false)}
                className={`flex-1 rounded-full px-4 py-2 transition ${
                  !annual ? "bg-white shadow-sm font-semibold" : "text-[color:var(--ink)]/60"
                }`}
              >
                Månadsvis
              </button>
              <button
                onClick={() => setAnnual(true)}
                className={`flex-1 rounded-full px-4 py-2 transition ${
                  annual ? "bg-white shadow-sm font-semibold" : "text-[color:var(--ink)]/60"
                }`}
              >
                Årsvis <span className="text-[color:var(--brass)]">(2 mån gratis)</span>
              </button>
            </div>

            <div className="text-center">
              {annual ? (
                <>
                  <div className="flex items-baseline justify-center gap-2">
                    <span className="text-lg text-[color:var(--ink)]/40 line-through">449</span>
                    <span
                      className="font-[Fraunces] font-semibold text-[color:var(--brass)]"
                      style={{ fontSize: "4rem", lineHeight: 1 }}
                    >
                      374
                    </span>
                    <span className="text-[color:var(--ink)]/70">kr/mån</span>
                  </div>
                  <p className="mt-2 text-sm text-[color:var(--ink)]/60">Faktureras 4 490 kr/år</p>
                </>
              ) : (
                <div className="flex items-baseline justify-center gap-2">
                  <span
                    className="font-[Fraunces] font-semibold"
                    style={{ fontSize: "4rem", lineHeight: 1 }}
                  >
                    449
                  </span>
                  <span className="text-[color:var(--ink)]/70">kr/mån</span>
                </div>
              )}
            </div>

            <ul className="mt-8 space-y-3 text-[0.95rem]">
              {[
                "Obegränsade meddelanden och gäster",
                "Alla tillvalsfunktioner",
                "Gästhubb + digital incheckning",
                "Frukost- och städvyer med rollinloggning",
                "Sirvoy- & Booking.com-koppling",
                "Svensk support",
                "Ingen startavgift, ingen bindningstid",
              ].map((f) => (
                <li key={f} className="flex items-start gap-3">
                  <span className="mt-0.5 text-[color:var(--brass)]" aria-hidden>
                    ✓
                  </span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            <div className="mt-8">
              <EarlyAccessForm location="pricing" buttonLabel="Få tidig tillgång" />
            </div>
            <p className="mt-4 text-center text-xs text-[color:var(--ink)]/55">
              Betalar det inte för sig själv första månaden gör det inte sitt jobb.
            </p>
          </div>
        </FadeUp>
      </div>
    </section>
  );
}

/* ---------- Final CTA ---------- */
function FinalCTA() {
  return (
    <section className="bg-[color:var(--forest)] py-24 text-[color:var(--bg)] md:py-32">
      <div className="mx-auto max-w-2xl px-6 text-center">
        <FadeUp>
          <h2 className="text-white" style={{ fontSize: "clamp(2rem, 4.5vw, 3.25rem)" }}>
            Din nästa gäst checkar in snart. Var redo.
          </h2>
        </FadeUp>
        <FadeUp delay={0.1}>
          <div className="mx-auto mt-8 max-w-md">
            <EarlyAccessForm
              location="final"
              variant="dark"
              buttonLabel="Starta min tidiga tillgång"
            />
          </div>
          <p className="mt-4 text-sm text-white/60">
            14 dagar gratis · Inget kort · Igång på en kväll
          </p>
        </FadeUp>
      </div>
    </section>
  );
}

/* ---------- Footer ---------- */
function Footer() {
  return (
    <footer className="bg-[color:var(--forest)] pb-10 pt-16 text-white/70">
      <div className="mx-auto grid max-w-[1120px] gap-10 px-6 md:grid-cols-3">
        <div>
          <div className="font-[Fraunces] text-xl font-semibold text-white">{BRAND_NAME}</div>
          <p className="mt-3 max-w-xs text-sm">
            Gästresa, tillval, incheckning, frukost och städ — hela driften för små boenden i ett
            system.
          </p>
        </div>
        <div className="text-sm">
          <div className="mb-3 font-semibold text-white">Länkar</div>
          <ul className="space-y-2">
            <li>
              <a href="#sa-funkar-det" className="hover:text-white">
                Så funkar det
              </a>
            </li>
            <li>
              <a href="#produkten" className="hover:text-white">
                Produkten
              </a>
            </li>
            <li>
              <a href="#mallar" className="hover:text-white">
                Gratis mallar
              </a>
            </li>
            <li>
              <a href="#pris" className="hover:text-white">
                Pris
              </a>
            </li>
            <li>
              <a href="#faq" className="hover:text-white">
                FAQ
              </a>
            </li>
            <li>
              <a href="/integritetspolicy" className="hover:text-white">
                Integritetspolicy
              </a>
            </li>
            <li>
              <a href="/villkor" className="hover:text-white">
                Användarvillkor
              </a>
            </li>
            <li>
              <a href="/cookies" className="hover:text-white">
                Cookies
              </a>
            </li>
            <li>
              <a href="/dpa" className="hover:text-white">
                Personuppgiftsbiträdesavtal
              </a>
            </li>
          </ul>
        </div>
        <div className="text-sm">
          <div className="mb-3 font-semibold text-white">Kontakt</div>
          {/* TODO: byt platshållar-e-post */}
          <p>info@stayboost.se</p>
          <p className="mt-1">Linköping, Sverige</p>
        </div>
      </div>
      <div className="mx-auto mt-12 max-w-[1120px] border-t border-white/10 px-6 pt-6 text-xs text-white/50">
        © 2026 Aurora Media AB · Linköping, Sverige
      </div>
    </footer>
  );
}

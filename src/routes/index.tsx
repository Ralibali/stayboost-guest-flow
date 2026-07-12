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

const BRAND_NAME = "StayBoost";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return (
    <main className="min-h-screen bg-[color:var(--bg)]">
      <Header />
      <Hero />
      <ProofStrip />
      <Problem />
      <HowItWorks />
      <ProductPreviewIntro />
      <ProductTour />
      <LiveDemo />
      <FeaturesGrid />
      <DemoSms />
      <LeadMagnet />
      <RevenueCalculator />
      <CaseStudy />
      <Pricing />
      <FAQ />
      <FinalCTA />
      <Footer />
      <StickyMobileCTA />
    </main>
  );
}

function Header() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollToApplication = (event: React.MouseEvent) => {
    event.preventDefault();
    document.getElementById("hero-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <header
      className={`sticky top-0 z-50 backdrop-blur transition-colors ${
        scrolled
          ? "border-b border-[color:var(--line)] bg-[color:var(--bg)]/90"
          : "bg-[color:var(--bg)]/70"
      }`}
    >
      <div className="mx-auto flex max-w-[1120px] items-center justify-between gap-4 px-6 py-4">
        <a href="#top" className="font-[Fraunces] text-2xl font-semibold tracking-tight">
          {BRAND_NAME}
        </a>
        <nav className="hidden items-center gap-8 text-sm md:flex" aria-label="Huvudmeny">
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
          onClick={scrollToApplication}
          className="btn-primary text-sm"
          style={{ padding: "12px 20px" }}
        >
          Ansök om pilotplats
        </a>
      </div>
    </header>
  );
}

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

function Hero() {
  return (
    <section
      id="hero-form"
      className="relative overflow-hidden bg-[color:var(--forest)] pb-24 pt-16 md:pb-32 md:pt-24"
    >
      <div
        className="absolute inset-0 -z-10 bg-cover bg-center opacity-70 md:opacity-100"
        style={{ backgroundImage: "url('/hero-glamping.jpg')" }}
        aria-hidden
      />
      <div
        className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(20,40,30,0.9)_0%,rgba(20,40,30,0.8)_100%)] md:bg-[linear-gradient(90deg,rgba(30,58,45,0.96)_0%,rgba(30,58,45,0.82)_48%,rgba(30,58,45,0.25)_100%)]"
        aria-hidden
      />
      <span className="sr-only">
        Bakgrundsbild: glampingtält vid Göta kanal i skymning med varmt lyktljus.
      </span>

      <div id="top" className="relative mx-auto grid max-w-[1120px] items-center gap-16 px-6 md:grid-cols-[56fr_44fr]">
        <div>
          <FadeUp>
            <div className="mb-5 inline-flex rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold text-white/85">
              Pilotprogram för glamping, stugor och små boenden
            </div>
            <h1 className="text-white" style={{ fontSize: "clamp(2.5rem, 6vw, 4.9rem)" }}>
              Sälj mer till varje gäst. <span className="italic text-[color:var(--brass)]">Utan mer administration.</span>
            </h1>
          </FadeUp>
          <FadeUp delay={0.1}>
            <p className="mt-6 max-w-xl text-white/85">
              StayBoost kopplas till dina bokningar, skickar rätt information vid rätt tidpunkt
              och låter gästen köpa frukost, sen utcheckning och upplevelser via en enkel länk.
              Frukost och städ ser samma uppdaterade information.
            </p>
          </FadeUp>
          <FadeUp delay={0.2}>
            <div className="mt-8 max-w-lg">
              <EarlyAccessForm
                location="hero"
                variant="dark"
                buttonLabel="Ansök om pilotplats"
              />
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-white/70">
              <span>✓ Personlig uppstart</span>
              <span>✓ Ingen bindningstid under piloten</span>
              <a
                href="#demo-sms"
                className="underline decoration-white/40 underline-offset-2 hover:text-white"
              >
                Testa ett riktigt SMS
              </a>
            </div>
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

function ProofStrip() {
  return (
    <section className="border-y border-[color:var(--line)] bg-white/70">
      <div className="mx-auto grid max-w-[1120px] gap-6 px-6 py-7 text-center text-sm text-[color:var(--ink)]/70 md:grid-cols-3 md:text-left">
        <p>
          <strong className="block text-[color:var(--ink)]">Byggt ur verklig drift</strong>
          Utvecklat av ägaren till Bergs Slussar Glamping.
        </p>
        <p>
          <strong className="block text-[color:var(--ink)]">För små verksamheter</strong>
          Börja enkelt utan ett tungt hotellprojekt.
        </p>
        <p>
          <strong className="block text-[color:var(--ink)]">Ingen app för gästen</strong>
          Vanliga SMS och en mobil webblänk.
        </p>
      </div>
    </section>
  );
}

function Problem() {
  const items = [
    {
      icon: "💬",
      title: "Samma frågor varje vecka",
      body: "Portkod, wifi, incheckning och frukost skickas manuellt — ofta från flera olika ställen.",
    },
    {
      icon: "💸",
      title: "Tillval som aldrig erbjuds",
      body: "Gästen hade kanske köpt sen utcheckning, frukost eller cykel om erbjudandet kommit i rätt ögonblick.",
    },
    {
      icon: "📝",
      title: "Driften bor i huvudet",
      body: "Ändringar, allergier och städstatus fastnar i grupptrådar, lappar och personberoende rutiner.",
    },
  ];

  return (
    <section className="py-20 md:py-32">
      <div className="mx-auto max-w-[1120px] px-6">
        <div className="max-w-2xl">
          <p className="eyebrow">Känns det igen?</p>
          <h2 className="mt-3" style={{ fontSize: "clamp(2rem, 4vw, 3rem)" }}>
            Små boenden behöver automatisering — inte ännu ett tungt system.
          </h2>
        </div>
        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {items.map((item, index) => (
            <FadeUp key={item.title} delay={index * 0.08}>
              <div className="card-surface h-full p-8">
                <div
                  className="mb-5 grid h-12 w-12 place-items-center rounded-full border border-[color:var(--brass)] text-xl"
                  aria-hidden
                >
                  {item.icon}
                </div>
                <h3 className="text-xl">{item.title}</h3>
                <p className="mt-3 text-[color:var(--ink)]/75">{item.body}</p>
              </div>
            </FadeUp>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      n: 1,
      title: "Koppla eller lägg in bokningar",
      body: "Vi börjar med Sirvoy eller manuell inmatning och testar med exempelbokningar innan något går skarpt.",
    },
    {
      n: 2,
      title: "Välj meddelanden och tillval",
      body: "Du godkänner text, språk, priser, stopptider och vilka uppgifter varje roll får se.",
    },
    {
      n: 3,
      title: "Aktivera och följ resultatet",
      body: "Gästen får SMS och länkar. Beställningar uppdaterar arbetsvyerna och du ser vad som faktiskt används.",
    },
  ];

  return (
    <section id="sa-funkar-det" className="border-t border-[color:var(--line)] bg-white/50 py-20 md:py-32">
      <div className="mx-auto max-w-[1120px] px-6">
        <div className="max-w-2xl">
          <p className="eyebrow">Kontrollerad uppstart</p>
          <h2 className="mt-3" style={{ fontSize: "clamp(2rem, 4vw, 3rem)" }}>
            Från exempeldata till skarp drift i tre steg.
          </h2>
        </div>

        <div className="relative mt-16 grid gap-12 md:grid-cols-3 md:gap-8">
          <div
            className="pointer-events-none absolute left-0 top-8 hidden h-px w-full bg-[color:var(--brass)]/35 md:block"
            aria-hidden
          />
          {steps.map((step, index) => (
            <FadeUp key={step.n} delay={index * 0.08}>
              <div className="relative flex gap-5 md:flex-col md:gap-6">
                <div className="relative z-10 grid h-16 w-16 shrink-0 place-items-center rounded-full border border-[color:var(--brass)] bg-[color:var(--bg)] font-[Fraunces] text-2xl font-semibold text-[color:var(--brass)]">
                  {step.n}
                </div>
                <div>
                  <h3 className="text-xl">{step.title}</h3>
                  <p className="mt-2 text-[color:var(--ink)]/75">{step.body}</p>
                </div>
              </div>
            </FadeUp>
          ))}
        </div>
      </div>
    </section>
  );
}

function ProductPreviewIntro() {
  return (
    <section className="border-t border-[color:var(--line)] bg-[color:var(--bg)] pt-20 md:pt-28">
      <div className="mx-auto max-w-[1120px] px-6">
        <div className="rounded-2xl border border-[color:var(--brass)]/35 bg-[color:var(--brass)]/5 px-5 py-4 text-sm text-[color:var(--ink)]/75">
          <strong className="text-[color:var(--ink)]">Interaktiv produktvisning:</strong> vyerna
          nedan använder exempeldata. Knappar och betalningsstatus demonstrerar flödet men
          genomför inga riktiga köp, SMS eller bokningsändringar.
        </div>
      </div>
    </section>
  );
}

function CaseStudy() {
  const metrics = [
    { value: "40 529 kr", label: "tillvalsomsättning 2025" },
    { value: "177", label: "sålda rumsnätter" },
    { value: "288", label: "gäster under säsongen" },
  ];

  return (
    <section className="border-t border-[color:var(--line)] bg-white/60 py-20 md:py-32">
      <div className="mx-auto grid max-w-[1120px] gap-12 px-6 md:grid-cols-[0.9fr_1.1fr] md:items-center">
        <div>
          <p className="eyebrow">Varför StayBoost finns</p>
          <h2 className="mt-3" style={{ fontSize: "clamp(2rem, 4vw, 3rem)" }}>
            Byggt efter verkliga problem på en riktig anläggning.
          </h2>
          <p className="mt-5 text-[color:var(--ink)]/75">
            Bergs Slussar Glamping behövde sälja tillval, ge gäster rätt information och få
            frukost och städ att arbeta från samma underlag. StayBoost är byggt runt just det
            arbetsflödet — inte runt hur stora hotell brukar arbeta.
          </p>
          <p className="mt-4 text-sm text-[color:var(--ink)]/55">
            Siffrorna avser verksamheten under 2025 och är bakgrund till produktens utveckling,
            inte en garanti för andra anläggningars resultat.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3 md:grid-cols-1 lg:grid-cols-3">
          {metrics.map((metric) => (
            <div key={metric.label} className="card-surface p-6 text-center">
              <div className="font-[Fraunces] text-3xl font-semibold text-[color:var(--brass)]">
                {metric.value}
              </div>
              <div className="mt-2 text-sm text-[color:var(--ink)]/65">{metric.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  const features = [
    "Gästhubb och tillval",
    "Tidsstyrda meddelandeflöden",
    "Frukost- och städvyer",
    "Sirvoy-upplägg eller manuell inmatning",
    "Personlig svensk uppstart och support",
    "Ingen startavgift eller bindningstid under piloten",
  ];

  return (
    <section id="pris" className="border-t border-[color:var(--line)] bg-white/50 py-20 md:py-32">
      <div className="mx-auto max-w-[1120px] px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="eyebrow">Lanseringspris</p>
          <h2 className="mt-3" style={{ fontSize: "clamp(2rem, 4vw, 3rem)" }}>
            Börja litet. Bevisa värdet. Fortsätt bara om det fungerar.
          </h2>
        </div>

        <FadeUp>
          <div
            className="card-surface mx-auto mt-12 max-w-[520px] p-8 md:p-10"
            style={{ borderColor: "var(--brass)", boxShadow: "0 20px 60px rgba(20,36,28,0.12)" }}
          >
            <div className="text-center">
              <div className="text-sm font-semibold uppercase tracking-[0.12em] text-[color:var(--brass)]">
                Efter testperioden
              </div>
              <div className="mt-4 flex items-baseline justify-center gap-2">
                <span className="font-[Fraunces] text-6xl font-semibold">449</span>
                <span className="text-[color:var(--ink)]/70">kr/mån exkl. moms</span>
              </div>
              <p className="mt-3 text-sm text-[color:var(--ink)]/60">
                14 dagars test i pilotupplägget. Avsluta innan skarp fortsättning utan kostnad.
              </p>
            </div>

            <ul className="mt-8 space-y-3 text-[0.95rem]">
              {features.map((feature) => (
                <li key={feature} className="flex items-start gap-3">
                  <span className="mt-0.5 text-[color:var(--brass)]" aria-hidden>
                    ✓
                  </span>
                  <span>{feature}</span>
                </li>
              ))}
            </ul>

            <div className="mt-8">
              <EarlyAccessForm location="pricing" buttonLabel="Ansök om pilotplats" />
            </div>
            <p className="mt-4 text-center text-xs text-[color:var(--ink)]/55">
              Eventuell SMS-förbrukning utöver det som ingår specificeras innan aktivering —
              inga oväntade kostnader.
            </p>
          </div>
        </FadeUp>
      </div>
    </section>
  );
}

function FinalCTA() {
  return (
    <section className="bg-[color:var(--forest)] py-24 text-[color:var(--bg)] md:py-32">
      <div className="mx-auto max-w-2xl px-6 text-center">
        <FadeUp>
          <h2 className="text-white" style={{ fontSize: "clamp(2rem, 4.5vw, 3.25rem)" }}>
            Vill du testa StayBoost på ditt boende?
          </h2>
          <p className="mt-5 text-white/70">
            Ansök med din e-post. Vi kontaktar dig, går igenom ditt nuvarande bokningsflöde och
            avgör tillsammans om pilotupplägget passar.
          </p>
        </FadeUp>
        <FadeUp delay={0.1}>
          <div className="mx-auto mt-8 max-w-lg">
            <EarlyAccessForm
              location="final"
              variant="dark"
              buttonLabel="Ansök om pilotplats"
            />
          </div>
        </FadeUp>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="bg-[color:var(--forest)] pb-10 pt-16 text-white/70">
      <div className="mx-auto grid max-w-[1120px] gap-10 px-6 md:grid-cols-3">
        <div>
          <div className="font-[Fraunces] text-xl font-semibold text-white">{BRAND_NAME}</div>
          <p className="mt-3 max-w-xs text-sm">
            Gästkommunikation, tillval och enkla arbetsvyer för glamping, stugor och små
            boenden.
          </p>
        </div>
        <div className="text-sm">
          <div className="mb-3 font-semibold text-white">Länkar</div>
          <ul className="space-y-2">
            <li><a href="#sa-funkar-det" className="hover:text-white">Så funkar det</a></li>
            <li><a href="#produkten" className="hover:text-white">Produkten</a></li>
            <li><a href="#mallar" className="hover:text-white">Gratis SMS-guide</a></li>
            <li><a href="#pris" className="hover:text-white">Pris</a></li>
            <li><a href="#faq" className="hover:text-white">FAQ</a></li>
            <li><a href="/integritet.html" className="hover:text-white">Integritetspolicy</a></li>
            <li><a href="/villkor.html" className="hover:text-white">Villkor</a></li>
          </ul>
        </div>
        <div className="text-sm">
          <div className="mb-3 font-semibold text-white">Kontakt</div>
          <a href="mailto:info@auroramedia.se" className="hover:text-white">
            info@auroramedia.se
          </a>
          <p className="mt-1">Aurora Media AB · Linköping</p>
        </div>
      </div>
      <div className="mx-auto mt-12 max-w-[1120px] border-t border-white/10 px-6 pt-6 text-xs text-white/50">
        © 2026 Aurora Media AB. StayBoost är under pilotlansering.
      </div>
    </footer>
  );
}

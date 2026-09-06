import { Link, createFileRoute } from "@tanstack/react-router";
import { DemoCta } from "@/components/landing/DemoCta";
import { FoundingOffer } from "@/components/landing/FoundingOffer";
import { SalesFaq } from "@/components/landing/SalesFaq";
import { canonicalUrl } from "@/lib/site-url";
import { CONTACT_EMAIL, PRICE_LABEL, SALES_PATH } from "@/lib/sales-readiness";

const CANONICAL = canonicalUrl(SALES_PATH);

export const Route = createFileRoute("/tidiga-kunder")({
  component: EarlyCustomers,
  head: () => ({
    meta: [
      { title: "Tidiga kunder — StayBoost CORE" },
      {
        name: "description",
        content:
          "Vad StayBoost CORE gör idag — och inte gör. Ingen multi-tenant-isolering. Sirvoy stängs inte av. 449 kr/mån.",
      },
      { property: "og:title", content: "Tidiga kunder — StayBoost CORE" },
      { property: "og:url", content: CANONICAL },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
  }),
});

function EarlyCustomers() {
  return (
    <main className="min-h-screen bg-[color:var(--bg)]">
      <header className="border-b border-[color:var(--line)] bg-[color:var(--bg)]/85 backdrop-blur">
        <div className="mx-auto flex max-w-[1120px] items-center justify-between px-6 py-4">
          <Link to="/" className="font-[Fraunces] text-2xl font-semibold tracking-tight">
            StayBoost
          </Link>
          <nav className="flex items-center gap-5 text-sm">
            <Link to="/" className="hover:text-[color:var(--brass)]">
              Start
            </Link>
            <Link to="/" hash="pris" className="hover:text-[color:var(--brass)]">
              Pris
            </Link>
            <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-[color:var(--brass)]">
              Kontakt
            </a>
          </nav>
        </div>
      </header>

      <FoundingOffer variant="full" />
      <SalesFaq />

      <section
        className="py-20 text-[color:var(--bg)] md:py-24"
        style={{ background: "var(--forest)" }}
      >
        <div className="mx-auto max-w-xl px-6">
          <h2 className="text-white" style={{ fontSize: "clamp(1.85rem, 4vw, 2.6rem)" }}>
            Se flödet. Köp inte isolation.
          </h2>
          <p className="mt-4 text-white/75">
            Titta på /produkten (exempeldata) eller mejla. {PRICE_LABEL}. Sirvoy är kvar. Isolation
            är obevisad. Öppen signup är inte säljvägen.
          </p>
          <div className="mt-8">
            <DemoCta location="founding-page" variant="dark" />
          </div>
        </div>
      </section>

      <footer className="bg-[color:var(--forest)] pb-10 pt-8 text-sm text-white/60">
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-4 px-6">
          <p>© 2026 Aurora Media AB · Linköping</p>
          <p>
            <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-white">
              {CONTACT_EMAIL}
            </a>
          </p>
        </div>
      </footer>
    </main>
  );
}

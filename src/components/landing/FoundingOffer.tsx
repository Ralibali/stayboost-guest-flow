import { Link } from "@tanstack/react-router";
import { DemoCta } from "@/components/landing/DemoCta";
import { CORE_DOES, CORE_DOES_NOT, PRICE_LABEL } from "@/lib/sales-readiness";

type Variant = "teaser" | "full";

export function FoundingOffer({ variant }: { variant: Variant }) {
  if (variant === "teaser") {
    return (
      <section
        id="tidiga-kunder"
        className="border-t border-[color:var(--line)] bg-white/50 py-14 sm:py-20 md:py-28"
      >
        <div className="mx-auto grid max-w-[1120px] gap-10 px-6 md:grid-cols-[1.15fr_0.85fr] md:items-center">
          <div>
            <p className="eyebrow">Founding 10</p>
            <h2 className="mt-3" style={{ fontSize: "clamp(2rem, 4vw, 3rem)" }}>
              Tidiga kunder. Utan isolation-snack.
            </h2>
            <p className="mt-5 max-w-xl text-[color:var(--ink)]/75">
              CORE körs i skarp drift på Bergs Slussar Glamping. Det är inte en färdig plattform för
              många anläggningar sida vid sida. Sirvoy stängs inte av. Priset är samma som ovan:{" "}
              {PRICE_LABEL}.
            </p>
            <p className="mt-4">
              <Link
                to="/tidiga-kunder"
                className="font-semibold text-[color:var(--brass)] underline underline-offset-2"
              >
                Vad CORE gör — och inte gör →
              </Link>
            </p>
          </div>
          <div className="card-surface p-6 sm:p-8">
            <p className="text-sm font-semibold text-[color:var(--ink)]">Vill du se flödet?</p>
            <p className="mt-2 text-sm text-[color:var(--ink)]/70">
              Produktdemon ligger på /produkten (exempeldata). Eller skapa konto / mejla. Ingen
              Stripe-checkout för abonnemanget. Ingen /demo-sida.
            </p>
            <div className="mt-5">
              <DemoCta location="founding-teaser" />
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="py-14 sm:py-16">
      <div className="mx-auto max-w-[1120px] px-6">
        <p className="eyebrow">Founding 10 · tidiga kunder</p>
        <h1 className="mt-3" style={{ fontSize: "clamp(2.1rem, 5vw, 3.4rem)" }}>
          CORE som det faktiskt är.
        </h1>
        <p className="mt-5 max-w-2xl text-[color:var(--ink)]/80">
          StayBoost CORE körs i skarp drift på Bergs Slussar Glamping. Det är byggt för den
          anläggningen. Vi säljer inte multi-tenant-isolering. Sirvoy är kvar. {PRICE_LABEL} — samma
          siffra som på startsidan.
        </p>

        <div className="mt-12 grid gap-10 md:grid-cols-2">
          <div>
            <h2 className="text-xl">Vad CORE gör idag</h2>
            <ul className="mt-5 space-y-3 text-[color:var(--ink)]/80">
              {CORE_DOES.map((item) => (
                <li key={item} className="border-b border-[color:var(--line)] pb-3 last:border-b-0">
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="text-xl">Vad CORE inte gör</h2>
            <ul className="mt-5 space-y-3 text-[color:var(--ink)]/80">
              {CORE_DOES_NOT.map((item) => (
                <li key={item} className="border-b border-[color:var(--line)] pb-3 last:border-b-0">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

import { Link } from "@tanstack/react-router";
import {
  ANALYTICS_CTAS,
  ANALYTICS_SURFACES,
  demoLocationFromPath,
  trackCtaClicked,
} from "@/lib/analytics";

const CARDS = [
  {
    icon: "🗓️",
    title: "Bokningsmotorn",
    path: "/produkten/boka",
    view: "boka",
    body: "Komplett bokningsflöde: kalender med priser, tillval och betalning — utan provision.",
  },
  {
    icon: "👤",
    title: "Gästhubben",
    path: "/produkten/gast",
    view: "gast",
    body: "Det gästen ser: tillval, betalning och all info om vistelsen.",
  },
  {
    icon: "🔑",
    title: "Incheckningen",
    path: "/produkten/incheckning",
    view: "incheckning",
    body: "Det gästen gör vid ankomst: tre steg till portkoden.",
  },
  {
    icon: "🙋",
    title: "Min sida",
    path: "/produkten/min-sida",
    view: "min-sida",
    body: "Gästen bokar om själv, köper tillval i efterhand och avbokar — utan att ringa dig.",
  },
  {
    icon: "🥐",
    title: "Frukostvyn",
    path: "/produkten/frukost",
    view: "frukost",
    body: "Det frukostansvarig ser: portioner, allergier i rött, leveranser.",
  },
  {
    icon: "🧺",
    title: "Städvyn",
    path: "/produkten/stad",
    view: "stad",
    body: "Det städteamet ser: exakta checklistor, status i realtid.",
  },
  {
    icon: "📈",
    title: "Ägaröversikten",
    path: "/produkten/admin",
    view: "admin",
    body: "Det du ser: merförsäljning i realtid, orderflöde och tillvalshantering.",
  },
  {
    icon: "🛎️",
    title: "Bokningskalendern",
    path: "/produkten/bokningar",
    view: "bokningar",
    body: "Beläggning per enhet och alla bokningar — synkat mot Sirvoy och Booking.com.",
  },
  {
    icon: "☀️",
    title: "Dagsöversikt",
    path: "/produkten/dagsoversikt",
    view: "dagsoversikt",
    body: "Teamets dagvy: ankomster, avresor, kapacitet och förberedelser.",
  },
  {
    icon: "🎁",
    title: "Presentkort",
    path: "/produkten/presentkort",
    view: "presentkort",
    body: "Sälj presentkort online — mottagaren löser in direkt i bokningen.",
  },
];

export function LiveDemo() {
  const trackOpen = (path: string) => {
    trackCtaClicked({
      surface: ANALYTICS_SURFACES.LANDING,
      cta: ANALYTICS_CTAS.DEMO,
      location: demoLocationFromPath(path),
    });
  };

  return (
    <section
      id="utforska"
      className="border-t border-[color:var(--line)] bg-white/50 py-16 sm:py-14 sm:py-20 md:py-32"
    >
      <div className="mx-auto max-w-[1120px] px-5 sm:px-6">
        <div className="max-w-2xl">
          <p className="eyebrow">Utforska själv</p>
          <h2
            className="mt-3 tracking-tight"
            style={{ fontSize: "clamp(1.75rem, 6vw, 3rem)", lineHeight: 1.1 }}
          >
            Klicka runt i det riktiga systemet.
          </h2>
          <p className="mt-4 text-[0.975rem] leading-relaxed text-[color:var(--ink)]/75 sm:mt-5 sm:text-base">
            Det här är inte skärmdumpar. Det är samma system som driver Bergs Slussar Glamping vid
            Göta kanal — öppnat för dig med exempeldata. Ingen inloggning, inget konto.
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:mt-12 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
          {CARDS.map((c) => (
            <Link
              key={c.view}
              to={c.path}
              onClick={() => trackOpen(c.path)}
              aria-label={`Utforska: ${c.title}`}
              className="card-surface group relative flex min-w-0 flex-col gap-3.5 p-5 transition-all duration-300 hover:-translate-y-0.5 hover:border-[color:var(--brass)] hover:shadow-[0_12px_40px_-16px_color-mix(in_oklab,var(--brass)_45%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--brass)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--bg,white)] sm:gap-4 sm:p-6"
            >
              <div
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-[color:var(--brass)] text-lg transition-transform duration-300 group-hover:scale-[1.06] sm:h-10 sm:w-10"
                aria-hidden
              >
                {c.icon}
              </div>
              <div className="min-w-0">
                <h3
                  className="truncate font-medium tracking-tight"
                  style={{ fontSize: "clamp(1.05rem, 2.4vw, 1.2rem)" }}
                >
                  {c.title}
                </h3>
                <p className="mt-1.5 text-[0.925rem] leading-relaxed text-[color:var(--ink)]/75 sm:mt-2 sm:text-[0.95rem]">
                  {c.body}
                </p>
              </div>
              <span className="mt-auto inline-flex items-center gap-1.5 pt-1 text-sm font-semibold text-[color:var(--brass)] sm:text-[0.95rem]">
                Utforska
                <span
                  aria-hidden
                  className="transition-transform duration-300 group-hover:translate-x-1"
                >
                  →
                </span>
              </span>
            </Link>
          ))}

          {/* Samlande kort */}
          <Link
            to="/produkten"
            onClick={() => trackOpen("/produkten")}
            aria-label="Utforska hela systemet"
            className="group relative flex min-w-0 flex-col gap-3.5 rounded-[20px] border border-[color:var(--forest)]/25 bg-[color:var(--forest)] p-5 text-white transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_12px_40px_-16px_rgba(20,36,28,0.5)] sm:col-span-2 sm:gap-4 sm:p-6 lg:col-span-3"
          >
            <div
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/30 text-lg transition-transform duration-300 group-hover:scale-[1.06] sm:h-10 sm:w-10"
              aria-hidden
            >
              ✨
            </div>
            <div className="min-w-0">
              <h3
                className="truncate font-medium tracking-tight text-white"
                style={{ fontSize: "clamp(1.05rem, 2.4vw, 1.2rem)" }}
              >
                Hela systemet
              </h3>
              <p className="mt-1.5 text-[0.925rem] leading-relaxed text-white/75 sm:mt-2 sm:text-[0.95rem]">
                Börja från översikten och hoppa fritt mellan gäst, personal och ägare.
              </p>
            </div>
            <span className="mt-auto inline-flex items-center gap-1.5 pt-1 text-sm font-semibold text-[color:var(--brass)] sm:text-[0.95rem]">
              Öppna översikten
              <span
                aria-hidden
                className="transition-transform duration-300 group-hover:translate-x-1"
              >
                →
              </span>
            </span>
          </Link>
        </div>

        <p className="mt-8 text-[0.8125rem] leading-relaxed text-[color:var(--ink)]/55 sm:text-sm">
          Vyerna kör med exempeldata. I din egen anläggning synkar allt mot dina riktiga bokningar.
        </p>
      </div>
    </section>
  );
}

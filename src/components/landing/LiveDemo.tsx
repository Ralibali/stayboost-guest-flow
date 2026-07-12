// Slå på när demorutterna är live i glampingprojektet.
const SHOW_LIVE_DEMO = false;

// TODO: byt till den riktiga glampingdomänen i env PUBLIC_DEMO_BASE.
const DEMO_BASE =
  (typeof import.meta !== "undefined" &&
    (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_PUBLIC_DEMO_BASE) ||
  "https://g-ta-kanal-glamping.lovable.app";

const CARDS = [
  {
    icon: "👤",
    title: "Gästhubben",
    path: "/demo/gast",
    view: "gast",
    body: "Det gästen ser: tillval, betalning och all info om vistelsen.",
  },
  {
    icon: "🥐",
    title: "Frukostvyn",
    path: "/demo/frukost",
    view: "frukost",
    body: "Det frukostansvarig ser: portioner, allergier i rött, leveranser.",
  },
  {
    icon: "🧺",
    title: "Städappen",
    path: "/demo/stad",
    view: "stad",
    body: "Det städteamet ser: exakta instruktioner, på sitt eget språk.",
  },
  {
    icon: "🔑",
    title: "Incheckningen",
    path: "/demo/incheckning",
    view: "incheckning",
    body: "Det gästen gör vid ankomst: tre steg till portkoden.",
  },
];

export function LiveDemo() {
  const trackOpen = (view: string, title: string) => {
    if (typeof window === "undefined") return;
    const w = window as unknown as {
      plausible?: (e: string, opts?: { props?: Record<string, string> }) => void;
    };
    // Övergripande event (behållet för bakåtkompabilitet)
    w.plausible?.("Live Demo Opened", { props: { view, title } });
    // Per-kort event så du kan se exakt vilket kort som klickades
    w.plausible?.(`Live Demo: ${view}`, { props: { title } });
  };

  if (!SHOW_LIVE_DEMO) return null;

  return (
    <section
      id="demo-live"
      className="border-t border-[color:var(--line)] bg-white/50 py-16 sm:py-20 md:py-32"
    >
      <div className="mx-auto max-w-[1120px] px-5 sm:px-6">
        <div className="max-w-2xl">
          <p className="eyebrow">Ingen inspelad demo</p>
          <h2
            className="mt-3 tracking-tight"
            style={{ fontSize: "clamp(1.75rem, 6vw, 3rem)", lineHeight: 1.1 }}
          >
            Klicka runt i det riktiga systemet.
          </h2>
          <p className="mt-4 text-[0.975rem] leading-relaxed text-[color:var(--ink)]/75 sm:mt-5 sm:text-base">
            Det här är inte skärmdumpar. Det är samma system som driver vår egen anläggning vid Göta
            kanal — öppnat för dig med påhittad gästdata. Ingen inloggning, inget konto.
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:mt-12 sm:grid-cols-2 sm:gap-5">
          {CARDS.map((c) => (
            <a
              key={c.view}
              href={`${DEMO_BASE}${c.path}`}
              target="_blank"
              rel="noopener"
              onClick={() => trackOpen(c.view, c.title)}
              aria-label={`Öppna demo: ${c.title}`}
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
                Öppna demon
                <span
                  aria-hidden
                  className="transition-transform duration-300 group-hover:translate-x-1"
                >
                  →
                </span>
              </span>
            </a>
          ))}
        </div>

        <p className="mt-8 text-[0.8125rem] leading-relaxed text-[color:var(--ink)]/55 sm:text-sm">
          Demon kör med låtsasdata. I skarp drift synkar allt mot dina riktiga bokningar.
        </p>
      </div>
    </section>
  );
}

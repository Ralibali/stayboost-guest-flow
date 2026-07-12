const DEMO_BASE =
  typeof import.meta !== "undefined"
    ? (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_PUBLIC_DEMO_BASE?.replace(
        /\/$/,
        "",
      )
    : undefined;

const CARDS = [
  {
    icon: "👤",
    title: "Gästhubben",
    path: "/demo/gast",
    view: "gast",
    body: "Det gästen ser: vistelseinfo, tillval och betalningssteg.",
  },
  {
    icon: "🥐",
    title: "Frukostvyn",
    path: "/demo/frukost",
    view: "frukost",
    body: "Det frukostansvarig ser: portioner, datum och kostpreferenser.",
  },
  {
    icon: "🧺",
    title: "Städvyn",
    path: "/demo/stad",
    view: "stad",
    body: "Det städteamet ser: boende, avresa, ankomst och status.",
  },
  {
    icon: "🔑",
    title: "Incheckningen",
    path: "/demo/incheckning",
    view: "incheckning",
    body: "Det gästen gör vid ankomst innan rätt information visas.",
  },
] as const;

export function LiveDemo() {
  if (!DEMO_BASE) return null;

  const trackOpen = (view: string) => {
    if (typeof window === "undefined") return;
    const analytics = window as unknown as {
      plausible?: (event: string, options?: { props?: Record<string, string> }) => void;
    };
    analytics.plausible?.("Live Demo Opened", { props: { view } });
  };

  return (
    <section id="demo-live" className="border-t border-[color:var(--line)] bg-white/50 py-20 md:py-32">
      <div className="mx-auto max-w-[1120px] px-6">
        <div className="max-w-2xl">
          <p className="eyebrow">Live-demo med exempeldata</p>
          <h2 className="mt-3" style={{ fontSize: "clamp(2rem, 4vw, 3rem)" }}>
            Klicka runt innan du ansöker.
          </h2>
          <p className="mt-5 text-[color:var(--ink)]/75">
            Demon använder påhittade gäster och genomför inga riktiga betalningar eller SMS.
            Den visar hur de olika rollerna hänger ihop.
          </p>
        </div>

        <div className="mt-12 grid gap-5 sm:grid-cols-2">
          {CARDS.map((card) => (
            <a
              key={card.view}
              href={`${DEMO_BASE}${card.path}`}
              target="_blank"
              rel="noopener"
              onClick={() => trackOpen(card.view)}
              className="card-surface group flex flex-col gap-4 p-6 transition hover:border-[color:var(--brass)]"
            >
              <div
                className="grid h-10 w-10 place-items-center rounded-full border border-[color:var(--brass)] text-lg"
                aria-hidden
              >
                {card.icon}
              </div>
              <div>
                <h3 className="text-lg">{card.title}</h3>
                <p className="mt-2 text-[0.95rem] text-[color:var(--ink)]/75">{card.body}</p>
              </div>
              <span className="mt-auto font-semibold text-[color:var(--brass)]">Öppna demon →</span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

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
  const trackOpen = (view: string) => {
    if (typeof window === "undefined") return;
    const w = window as unknown as {
      plausible?: (e: string, opts?: { props?: Record<string, string> }) => void;
    };
    w.plausible?.("Live Demo Opened", { props: { view } });
  };

  if (!SHOW_LIVE_DEMO) return null;

  return (
    <section
      id="demo-live"
      className="border-t border-[color:var(--line)] bg-white/50 py-20 md:py-32"
    >
      <div className="mx-auto max-w-[1120px] px-6">
        <div className="max-w-2xl">
          <p className="eyebrow">Ingen inspelad demo</p>
          <h2 className="mt-3" style={{ fontSize: "clamp(2rem, 4vw, 3rem)" }}>
            Klicka runt i det riktiga systemet.
          </h2>
          <p className="mt-5 text-[color:var(--ink)]/75">
            Det här är inte skärmdumpar. Det är samma system som driver vår egen
            anläggning vid Göta kanal — öppnat för dig med påhittad gästdata. Ingen
            inloggning, inget konto.
          </p>
        </div>

        <div className="mt-12 grid gap-5 sm:grid-cols-2">
          {CARDS.map((c) => (
            <a
              key={c.view}
              href={`${DEMO_BASE}${c.path}`}
              target="_blank"
              rel="noopener"
              onClick={() => trackOpen(c.view)}
              className="card-surface group flex flex-col gap-4 p-6 transition hover:border-[color:var(--brass)]"
            >
              <div
                className="grid h-10 w-10 place-items-center rounded-full border border-[color:var(--brass)] text-lg"
                aria-hidden
              >
                {c.icon}
              </div>
              <div>
                <h3 className="text-lg">{c.title}</h3>
                <p className="mt-2 text-[0.95rem] text-[color:var(--ink)]/75">{c.body}</p>
              </div>
              <span className="mt-auto font-semibold text-[color:var(--brass)]">
                Öppna demon →
              </span>
            </a>
          ))}
        </div>

        <p className="mt-8 text-sm text-[color:var(--ink)]/55">
          Demon kör med låtsasdata. I skarp drift synkar allt mot dina riktiga bokningar.
        </p>
      </div>
    </section>
  );
}

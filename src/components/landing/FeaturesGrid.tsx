const ITEMS = [
  {
    icon: "🔗",
    title: "Bokningar från Sirvoy",
    body: "Gäst, datum och boende används som grund för rätt meddelande och rätt arbetslista. Manuell inmatning finns som reservväg.",
  },
  {
    icon: "💬",
    title: "Tidsstyrda SMS",
    body: "Förhandsinfo, incheckning, tillval och omdömesfråga skickas när de är relevanta — efter att du har godkänt flödet.",
  },
  {
    icon: "🛍️",
    title: "Tillval och betalningslänkar",
    body: "Frukost, sen utcheckning, cyklar, bastu och andra tillval samlas på en enkel gästsida utan app.",
  },
  {
    icon: "🥐",
    title: "Frukostvy",
    body: "Antal portioner, datum och kostpreferenser visas i en mobil vy som är lätt att lämna över till personal eller leverantör.",
  },
  {
    icon: "🧺",
    title: "Städvy",
    body: "Ankomster, avresor, boende och status samlas på ett ställe så att ändringar inte fastnar i SMS-trådar och minneslappar.",
  },
  {
    icon: "📊",
    title: "Resultat per tillval",
    body: "Se vilka erbjudanden som öppnas och säljer, och förbättra utbud, tidpunkt och text utifrån faktiska resultat.",
  },
];

export function FeaturesGrid() {
  return (
    <section className="border-t border-[color:var(--line)] bg-white/50 py-20 md:py-28">
      <div className="mx-auto max-w-[1120px] px-6">
        <div className="max-w-2xl">
          <p className="eyebrow">Pilotens kärna</p>
          <h2 className="mt-3" style={{ fontSize: "clamp(1.75rem, 3.5vw, 2.5rem)" }}>
            Börja med det som ger effekt — lägg till resten senare.
          </h2>
        </div>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 md:grid-cols-3">
          {ITEMS.map((item) => (
            <div key={item.title} className="card-surface p-6">
              <div
                className="mb-4 grid h-10 w-10 place-items-center rounded-full border border-[color:var(--brass)] text-lg"
                aria-hidden
              >
                {item.icon}
              </div>
              <h3 className="text-lg">{item.title}</h3>
              <p className="mt-2 text-[0.95rem] text-[color:var(--ink)]/75">{item.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

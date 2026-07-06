const ITEMS = [
  {
    icon: "🔗",
    title: "Sirvoy & Booking.com-import",
    body: "Bokningar, gäster, telefonnummer och tillval läses in korrekt — även krångliga flertältsbokningar.",
  },
  {
    icon: "💳",
    title: "Betalningar",
    body: "Swish eller kortlänk via Stripe. Gästen betalar med ett tryck, du ser status direkt.",
  },
  {
    icon: "💬",
    title: "Smart SMS-motor",
    body: "Förhandsinfo, portkod, tips och omdömesfråga — tajmat mot varje bokning, på gästens språk.",
  },
  {
    icon: "🔐",
    title: "Rollinloggningar",
    body: "Frukost och städ har egna enkla inloggningar. Personalen ser sitt, inget annat.",
  },
  {
    icon: "✉",
    title: "E-post som sköter sig",
    body: "Kö, kvitton och avregistrering enligt konstens alla regler — inget hamnar i limbo.",
  },
  {
    icon: "📊",
    title: "Statistik som betyder något",
    body: "Merförsäljning per tillval, konvertering, besökare. Se vad som faktiskt säljer.",
  },
];

export function FeaturesGrid() {
  return (
    <section className="border-t border-[color:var(--line)] bg-white/50 py-20 md:py-28">
      <div className="mx-auto max-w-[1120px] px-6">
        <div className="max-w-2xl">
          <p className="eyebrow">Och allt det här ingår</p>
          <h2 className="mt-3" style={{ fontSize: "clamp(1.75rem, 3.5vw, 2.5rem)" }}>
            Inget extra, inga tilläggsmoduler.
          </h2>
        </div>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 md:grid-cols-3">
          {ITEMS.map((it) => (
            <div key={it.title} className="card-surface p-6">
              <div
                className="mb-4 grid h-10 w-10 place-items-center rounded-full border border-[color:var(--brass)] text-lg"
                aria-hidden
              >
                {it.icon}
              </div>
              <h3 className="text-lg">{it.title}</h3>
              <p className="mt-2 text-[0.95rem] text-[color:var(--ink)]/75">{it.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

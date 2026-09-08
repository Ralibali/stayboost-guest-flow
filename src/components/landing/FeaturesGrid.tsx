const ITEMS = [
  {
    icon: "🔗",
    title: "Bokningarna samlade",
    body: "Använd StayBoost som bokningssystem eller tillsammans med din nuvarande lösning. Gästresan börjar automatiskt när bokningen finns på plats.",
  },
  {
    icon: "💳",
    title: "Betalningar",
    body: "Swish eller kortlänk via Stripe. Gästen betalar med ett tryck, du ser status direkt.",
  },
  {
    icon: "💬",
    title: "Smart sms-motor",
    body: "Förhandsinfo, portkod, tips och omdömesfråga — tajmat mot varje bokning, på gästens språk.",
  },
  {
    icon: "🔐",
    title: "Rätt vy för varje roll",
    body: "Frukost- och städpersonalen får enkla mobilvyer och ser bara det de behöver för dagens arbete.",
  },
  {
    icon: "✉",
    title: "E-post som sköter sig",
    body: "Bekräftelser, kvitton och avregistreringar skickas automatiskt och hålls samlade.",
  },
  {
    icon: "📊",
    title: "Statistik som betyder något",
    body: "Merförsäljning per tillval, konvertering, besökare. Se vad som faktiskt säljer.",
  },
];

export function FeaturesGrid() {
  return (
    <section className="border-t border-[color:var(--line)] bg-white/50 py-14 sm:py-20 md:py-28">
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

import { useEffect, useState } from "react";

// TODO: byt till din riktiga bokningslänk (Cal.com / Savvycal / SimplyBook).
// Cal.com stödjer inbäddning direkt via iframe och postar bekräftelser via postMessage.
const BOOKING_URL =
  (typeof import.meta !== "undefined" &&
    (import.meta as unknown as { env?: Record<string, string> }).env
      ?.VITE_PUBLIC_BOOKING_URL) ||
  "https://cal.com/stayboost/20min";

type PlausibleWin = {
  plausible?: (e: string, opts?: { props?: Record<string, string> }) => void;
};

export function BookFounder() {
  const [booked, setBooked] = useState(false);

  useEffect(() => {
    // Cal.com postar events till parent-fönstret. Vi lyssnar brett och
    // matchar på det som ser ut som en lyckad bokning.
    function onMessage(ev: MessageEvent) {
      const data = ev.data;
      if (!data) return;

      // Cal.com format: { type: "__iframeReady" | "linkReady" | "eventTypeSelected" | "bookingSuccessful" ... }
      // eller nested: { type: "CAL:...", data: {...} }
      const raw =
        typeof data === "string"
          ? data
          : typeof data?.type === "string"
            ? data.type
            : "";
      const t = String(raw).toLowerCase();

      const isSuccess =
        t.includes("bookingsuccessful") ||
        t.includes("booking_successful") ||
        t.includes("booking-successful") ||
        t === "cal:bookingsuccessful";

      if (isSuccess) {
        setBooked(true);
        const w = window as unknown as PlausibleWin;
        w.plausible?.("Founder Call Booked", {
          props: { source: "embed" },
        });
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <section
      id="boka-samtal"
      className="border-t border-[color:var(--line)] bg-white/60 py-16 sm:py-20 md:py-28"
    >
      <div className="mx-auto max-w-[1120px] px-5 sm:px-6">
        <div className="grid gap-10 md:grid-cols-[42fr_58fr] md:items-start md:gap-14">
          <div>
            <p className="eyebrow">20 minuter, inget säljsnack</p>
            <h2
              className="mt-3 tracking-tight"
              style={{ fontSize: "clamp(1.85rem, 4.5vw, 2.75rem)", lineHeight: 1.1 }}
            >
              Boka 20 min med grundaren.
            </h2>
            <p className="mt-4 text-[color:var(--ink)]/75 sm:mt-5">
              Berätta hur din drift ser ut idag — jag visar var{" "}
              <span className="font-semibold text-[color:var(--ink)]">StayBoost</span>{" "}
              hade satt in stöten hos dig. Om det inte passar säger jag det. Enkelt så.
            </p>
            <ul className="mt-6 space-y-2.5 text-[0.95rem] text-[color:var(--ink)]/80">
              <li className="flex gap-3">
                <span aria-hidden className="text-[color:var(--brass)]">✓</span>
                Skärmdelning av din faktiska bokningsflöde
              </li>
              <li className="flex gap-3">
                <span aria-hidden className="text-[color:var(--brass)]">✓</span>
                Konkret siffra på trolig merförsäljning
              </li>
              <li className="flex gap-3">
                <span aria-hidden className="text-[color:var(--brass)]">✓</span>
                Inga eftersnack, inga uppföljningsmejl om du säger nej
              </li>
            </ul>
            <p className="mt-6 text-[0.85rem] text-[color:var(--ink)]/55">
              Föredrar du e-post?{" "}
              <a
                href="#hero-form"
                className="underline decoration-[color:var(--ink)]/30 underline-offset-2 hover:text-[color:var(--ink)]"
              >
                Få tidig tillgång istället
              </a>
            </p>
          </div>

          <div>
            {booked ? (
              <div
                role="status"
                aria-live="polite"
                className="card-surface flex flex-col items-start gap-4 p-6 sm:p-8"
              >
                <div
                  className="grid h-12 w-12 place-items-center rounded-full border border-[color:var(--brass)] bg-[color:var(--brass)]/10 text-xl text-[color:var(--brass)]"
                  aria-hidden
                >
                  ✓
                </div>
                <h3 className="font-[Fraunces] text-2xl tracking-tight">
                  Bokat. Vi ses snart.
                </h3>
                <p className="text-[color:var(--ink)]/75">
                  Du får en kalenderinbjudan och en påminnelse via mejl. Vill du
                  förbereda något? Skriv en mening om din anläggning i mötesnoten
                  — då hoppar vi rakt in på det som spelar roll.
                </p>
                <button
                  type="button"
                  onClick={() => setBooked(false)}
                  className="text-sm font-semibold text-[color:var(--brass)] underline underline-offset-2 hover:opacity-80"
                >
                  Boka en till tid
                </button>
              </div>
            ) : (
              <div
                className="overflow-hidden rounded-2xl border border-[color:var(--line)] bg-white shadow-[0_20px_60px_-30px_rgba(0,0,0,0.25)]"
                style={{ height: "min(680px, 78vh)" }}
              >
                <iframe
                  title="Boka 20 min med grundaren"
                  src={BOOKING_URL}
                  className="h-full w-full"
                  loading="lazy"
                  allow="camera; microphone; fullscreen; clipboard-read; clipboard-write"
                />
              </div>
            )}
            <p className="mt-3 text-[0.8rem] text-[color:var(--ink)]/55">
              Bokningen laddas i en säker ram. Inga cookies delas med tredje part
              förrän du väljer en tid.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

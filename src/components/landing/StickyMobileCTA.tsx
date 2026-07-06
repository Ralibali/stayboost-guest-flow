import { useEffect, useRef, useState } from "react";

export function StickyMobileCTA() {
  const [show, setShow] = useState(false);
  const sentinel = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // sentinel plockas från en div som ligger i botten av hero
    const el = document.getElementById("hero-sentinel");
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        // visa så snart hero-sentinel är förbi (över top of viewport)
        const past = !entries[0].isIntersecting && entries[0].boundingClientRect.top < 0;
        setShow(past);
      },
      { threshold: 0 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.matches("input, textarea, select")) setShow(false);
    };
    const onBlur = () => {
      // låt IO återta kontroll
      setTimeout(() => {
        const el = document.getElementById("hero-sentinel");
        if (!el) return;
        const rect = el.getBoundingClientRect();
        setShow(rect.top < 0);
      }, 50);
    };
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", onBlur);
    return () => {
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", onBlur);
    };
  }, []);

  const click = () => {
    if (typeof window !== "undefined") {
      const w = window as unknown as { plausible?: (e: string) => void };
      w.plausible?.("Sticky CTA Click");
    }
    document
      .getElementById("hero-form")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <>
      <div id="hero-sentinel" ref={sentinel} className="pointer-events-none h-px w-full" />
      <div
        className={`fixed inset-x-0 bottom-0 z-40 md:hidden ${
          show ? "translate-y-0" : "translate-y-full"
        } transition-transform duration-300`}
        style={{
          paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
        }}
        aria-hidden={!show}
      >
        <div className="mx-3 mb-3 flex items-center justify-between gap-3 rounded-2xl bg-[color:var(--forest)] px-4 py-3 shadow-[0_20px_50px_-10px_rgba(20,36,28,0.5)]">
          <div className="text-[0.82rem] leading-tight text-white">
            <div className="font-semibold">Tidig tillgång</div>
            <div className="text-white/70">+ lanseringspris</div>
          </div>
          <button
            onClick={click}
            className="rounded-xl bg-[color:var(--brass)] px-4 py-2.5 text-sm font-semibold text-white"
          >
            Jag vill ha →
          </button>
        </div>
      </div>
    </>
  );
}

import { useEffect, useState } from "react";

export function StickyMobileCTA() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const hero = document.getElementById("hero-form");
    if (!hero) return;

    const observer = new IntersectionObserver(
      ([entry]) => setShow(!entry.isIntersecting && entry.boundingClientRect.bottom < 0),
      { threshold: 0 },
    );

    observer.observe(hero);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onFocus = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select")) setShow(false);
    };
    const onBlur = () => {
      window.setTimeout(() => {
        const hero = document.getElementById("hero-form");
        if (hero) setShow(hero.getBoundingClientRect().bottom < 0);
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
      const analytics = window as unknown as { plausible?: (event: string) => void };
      analytics.plausible?.("Sticky CTA Click");
    }
    document.getElementById("hero-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-40 md:hidden ${
        show ? "translate-y-0" : "translate-y-full"
      } transition-transform duration-300`}
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      aria-hidden={!show}
    >
      <div className="mx-3 mb-3 flex items-center justify-between gap-3 rounded-2xl bg-[color:var(--forest)] px-4 py-3 shadow-[0_20px_50px_-10px_rgba(20,36,28,0.5)]">
        <div className="text-[0.82rem] leading-tight text-white">
          <div className="font-semibold">Begränsat pilotprogram</div>
          <div className="text-white/70">Personlig uppstart</div>
        </div>
        <button
          type="button"
          onClick={click}
          className="rounded-xl bg-[color:var(--brass)] px-4 py-2.5 text-sm font-semibold text-white"
        >
          Ansök →
        </button>
      </div>
    </div>
  );
}

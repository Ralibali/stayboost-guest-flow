import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

export function LegalLayout({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-[color:var(--bg)]">
      <header className="border-b border-[color:var(--line)] bg-[color:var(--bg)]/85 backdrop-blur">
        <div className="mx-auto flex max-w-[900px] items-center justify-between px-6 py-4">
          <Link to="/" className="font-[Fraunces] text-2xl font-semibold tracking-tight">
            StayBoost
          </Link>
          <Link to="/" className="text-sm hover:text-[color:var(--brass)]">
            ← Till startsidan
          </Link>
        </div>
      </header>
      <article className="mx-auto max-w-[760px] px-6 py-16">
        <p className="eyebrow">Juridiskt</p>
        <h1 className="mt-3" style={{ fontSize: "clamp(2rem, 4vw, 3rem)" }}>
          {title}
        </h1>
        <p className="mt-4 text-sm text-[color:var(--ink)]/60">Senast uppdaterad den {updated}</p>
        <div className="legal-prose mt-10 space-y-6 text-[color:var(--ink)]/85">{children}</div>
        <div className="mt-16 flex flex-wrap gap-4 border-t border-[color:var(--line)] pt-8 text-sm">
          <Link to="/integritetspolicy" className="hover:text-[color:var(--brass)]">
            Integritetspolicy
          </Link>
          <Link to="/villkor" className="hover:text-[color:var(--brass)]">
            Användarvillkor
          </Link>
          <Link to="/cookies" className="hover:text-[color:var(--brass)]">
            Cookies
          </Link>
          <Link to="/dpa" className="hover:text-[color:var(--brass)]">
            Personuppgiftsbiträdesavtal
          </Link>
        </div>
      </article>
    </main>
  );
}

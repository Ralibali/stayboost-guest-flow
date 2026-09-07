import type { ReactNode } from "react";
export function EditorialLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[color:var(--bg)] text-[color:var(--ink)]">
      <header className="border-b border-[color:var(--line)]">
        <nav
          aria-label="Huvudmeny"
          className="max-w-5xl mx-auto flex flex-wrap gap-6 items-center px-5 py-5"
        >
          <a href="/" className="font-semibold text-xl">
            StayBoost
          </a>
          <a className="underline" href="/blogg">
            Blogg
          </a>
          <a className="underline" href="/produkten">
            Produktdemo
          </a>
        </nav>
      </header>
      <main className="max-w-3xl mx-auto px-5 py-12">{children}</main>
      <footer className="border-t border-[color:var(--line)] p-6 text-sm text-center">
        StayBoost · Aurora Media AB ·{" "}
        <a href="/integritetspolicy" className="underline">
          Integritetspolicy
        </a>
      </footer>
    </div>
  );
}

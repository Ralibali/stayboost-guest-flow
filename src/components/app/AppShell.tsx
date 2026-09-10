import { Link, useLocation } from "@tanstack/react-router";
import {
  BarChart3,
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  LayoutDashboard,
  Link2,
  LogOut,
  Mail,
  Menu,
  PackagePlus,
  Settings,
  Sparkles,
  SunMedium,
  Tag,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { BillingPanel } from "@/components/app/BillingPanel";
import { PlatformOwnerPanel } from "@/components/app/PlatformOwnerPanel";
import { Button } from "@/components/ui/button";

const NAV = [
  { to: "/app", label: "Översikt", icon: LayoutDashboard, group: "Drift" },
  { to: "/app/arbete", label: "Städning & leveranser", icon: CheckCircle2, group: "Drift" },
  { to: "/app/idag", label: "Idag", icon: SunMedium, group: "Drift" },
  { to: "/app/bokningar", label: "Bokningar", icon: CalendarDays, group: "Drift" },
  { to: "/app/kalender", label: "Kalender", icon: CalendarRange, group: "Drift" },
  { to: "/app/intakter", label: "Intäkter", icon: BarChart3, group: "Försäljning" },
  { to: "/app/prisregler", label: "Pris & regler", icon: Tag, group: "Försäljning" },
  { to: "/app/tillval", label: "Tillval", icon: PackagePlus, group: "Försäljning" },
  { to: "/app/mallar", label: "Gästkommunikation", icon: Mail, group: "Gästresa" },
  { to: "/app/kallor", label: "Kalenderkopplingar", icon: Link2, group: "System" },
  { to: "/app/installningar", label: "Inställningar", icon: Settings, group: "System" },
] as const;

const GROUPS = ["Drift", "Försäljning", "Gästresa", "System"] as const;
const MOBILE_NAV = NAV.filter((item) =>
  ["/app", "/app/idag", "/app/bokningar", "/app/kalender"].includes(item.to),
);

export function AppShell({
  children,
  propertyName,
  propertySlug,
  onLogout,
}: {
  children: ReactNode;
  propertyName: string | null;
  propertySlug: string | null;
  onLogout: () => void;
}) {
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const isActive = (to: (typeof NAV)[number]["to"]) =>
    to === "/app" ? pathname === "/app" || pathname === "/app/" : pathname.startsWith(to);

  return (
    <div className="min-h-screen bg-[#f5f6f3] text-[color:var(--ink)] lg:grid lg:grid-cols-[258px_minmax(0,1fr)]">
      <aside className="hidden min-h-screen border-r border-black/[0.07] bg-[#10251b] text-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
        <div className="px-5 pb-5 pt-6">
          <Link to="/app" className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-white text-[#173c2b] shadow-sm">
              <Sparkles size={17} strokeWidth={2.2} />
            </span>
            <span>
              <span className="block font-[Fraunces] text-[20px] font-semibold leading-none">
                StayBoost
              </span>
              <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">
                Operator
              </span>
            </span>
          </Link>
        </div>

        {propertyName && (
          <div className="mx-4 mb-4 rounded-2xl border border-white/10 bg-white/[0.06] p-3.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">
              Anläggning
            </p>
            <p className="mt-1.5 truncate text-[13px] font-semibold text-white/90">
              {propertyName}
            </p>
            {propertySlug && (
              <a
                href={`/boka/${propertySlug}`}
                target="_blank"
                rel="noreferrer"
                className="mt-3 flex items-center justify-between rounded-xl bg-white/10 px-3 py-2 text-[11px] font-semibold text-white/75 transition hover:bg-white/15 hover:text-white"
              >
                Öppna bokningssidan <ExternalLink size={13} />
              </a>
            )}
          </div>
        )}

        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          {GROUPS.map((group) => (
            <div key={group} className="mb-5">
              <p className="mb-1.5 px-3 text-[9px] font-bold uppercase tracking-[0.18em] text-white/30">
                {group}
              </p>
              <div className="space-y-1">
                {NAV.filter((item) => item.group === group).map((item) => {
                  const active = isActive(item.to);
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition ${active ? "bg-white text-[#173c2b] shadow-sm" : "text-white/65 hover:bg-white/[0.07] hover:text-white"}`}
                    >
                      <item.icon size={16} strokeWidth={active ? 2.2 : 1.8} />
                      <span className="flex-1">{item.label}</span>
                      {active && <ChevronRight size={13} className="opacity-45" />}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-white/10 p-3">
          <BillingPanel />
          <button
            onClick={onLogout}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[12px] font-medium text-white/50 transition hover:bg-white/[0.07] hover:text-white"
          >
            <LogOut size={15} /> Logga ut
          </button>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-40 border-b border-line bg-card/95 backdrop-blur-xl lg:hidden">
          <div className="flex h-16 items-center gap-3 px-4">
            <Link to="/app" className="flex min-w-0 items-center gap-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-forest text-primary-foreground">
                <Sparkles size={15} strokeWidth={2.2} />
              </span>
              <span className="min-w-0">
                <span className="block font-display text-[18px] font-semibold leading-none text-forest">
                  StayBoost
                </span>
                {propertyName ? (
                  <span className="mt-1 block max-w-[220px] truncate text-[10px] font-medium text-ink/45">
                    {propertyName}
                  </span>
                ) : null}
              </span>
            </Link>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={menuOpen ? "Stäng meny" : "Öppna meny"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
              className="ml-auto h-10 w-10 text-forest"
            >
              {menuOpen ? <X size={20} /> : <Menu size={20} />}
            </Button>
          </div>
        </header>

        {menuOpen ? (
          <div
            className="fixed inset-0 z-50 bg-forest/35 backdrop-blur-sm lg:hidden"
            role="presentation"
          >
            <div className="absolute inset-x-0 top-0 max-h-[calc(100dvh-72px)] overflow-y-auto rounded-b-lg bg-card shadow-2xl">
              <div className="flex h-16 items-center border-b border-line px-4">
                <p className="font-display text-xl font-semibold text-forest">Meny</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Stäng meny"
                  onClick={() => setMenuOpen(false)}
                  className="ml-auto h-10 w-10 text-forest"
                >
                  <X size={20} />
                </Button>
              </div>

              {propertyName ? (
                <div className="border-b border-line bg-bg/55 px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase text-ink/40">Anläggning</p>
                  <div className="mt-1 flex items-center justify-between gap-3">
                    <p className="truncate text-sm font-semibold text-ink">{propertyName}</p>
                    {propertySlug ? (
                      <a
                        href={`/boka/${propertySlug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-forest"
                      >
                        Bokningssida <ExternalLink size={13} />
                      </a>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <nav className="grid grid-cols-2 gap-px bg-line p-px" aria-label="Alla sidor">
                {NAV.map((item) => {
                  const active = isActive(item.to);
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      onClick={() => setMenuOpen(false)}
                      className={`flex min-h-16 items-center gap-3 bg-card px-4 py-3 text-xs font-semibold ${active ? "text-forest" : "text-ink/60"}`}
                    >
                      <item.icon size={17} strokeWidth={active ? 2.3 : 1.8} />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </nav>
              <div className="border-t border-line p-3">
                {pathname.startsWith("/app/installningar") ? <BillingPanel mobile /> : null}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={onLogout}
                  className="h-11 w-full justify-start text-ink/55"
                >
                  <LogOut size={16} /> Logga ut
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        <nav
          className="demo-safe-bottom fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-card/95 px-1 pt-1.5 backdrop-blur-xl lg:hidden"
          aria-label="Huvudnavigation"
        >
          {MOBILE_NAV.map((item) => {
            const active = isActive(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-md text-[9px] font-semibold ${active ? "bg-forest/8 text-forest" : "text-ink/45"}`}
              >
                <item.icon size={18} strokeWidth={active ? 2.4 : 1.8} />
                <span>{item.label}</span>
              </Link>
            );
          })}
          <Button
            type="button"
            variant="ghost"
            aria-label="Öppna alla sidor"
            onClick={() => setMenuOpen(true)}
            className="flex h-auto min-h-12 flex-col items-center justify-center gap-1 rounded-md px-1 text-[9px] font-semibold text-ink/45"
          >
            <Menu size={18} />
            <span>Mer</span>
          </Button>
        </nav>

        <main className="mx-auto w-full max-w-[1500px] px-4 pb-24 pt-5 sm:px-6 sm:py-8 lg:px-8 xl:px-10">
          {pathname.startsWith("/app/installningar") ? <PlatformOwnerPanel /> : null}
          {children}
        </main>
      </div>
    </div>
  );
}

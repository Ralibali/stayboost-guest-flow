import { Link, useLocation } from "@tanstack/react-router";
import {
  BarChart3,
  CalendarDays,
  CalendarRange,
  ChevronRight,
  ExternalLink,
  LayoutDashboard,
  Link2,
  LogOut,
  Mail,
  PackagePlus,
  Settings,
  Sparkles,
  SunMedium,
  Tag,
} from "lucide-react";
import type { ReactNode } from "react";

const NAV = [
  { to: "/app", label: "Översikt", icon: LayoutDashboard, group: "Drift" },
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
          <button
            onClick={onLogout}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[12px] font-medium text-white/50 transition hover:bg-white/[0.07] hover:text-white"
          >
            <LogOut size={15} /> Logga ut
          </button>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-40 border-b border-black/[0.06] bg-white/90 backdrop-blur-xl lg:hidden">
          <div className="flex items-center gap-3 px-4 py-3">
            <Link to="/app" className="font-[Fraunces] text-[20px] font-semibold text-[#173c2b]">
              StayBoost
            </Link>
            {propertyName && (
              <span className="min-w-0 flex-1 truncate text-right text-[11px] font-semibold text-[color:var(--ink)]/45">
                {propertyName}
              </span>
            )}
          </div>
          <nav className="scrollbar-none flex gap-1 overflow-x-auto px-3 pb-2.5">
            {NAV.slice(0, 8).map((item) => {
              const active = isActive(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-[11px] font-semibold transition ${active ? "bg-[#173c2b] text-white" : "bg-[#f0f2ee] text-[color:var(--ink)]/60"}`}
                >
                  <item.icon size={13} /> {item.label}
                </Link>
              );
            })}
          </nav>
        </header>

        <main className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8 xl:px-10">
          {children}
        </main>
      </div>
    </div>
  );
}

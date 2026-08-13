import { Link, useLocation } from "@tanstack/react-router";
import {
  CalendarDays,
  CalendarRange,
  LayoutDashboard,
  Link2,
  LogOut,
  Mail,
  PackagePlus,
  Settings,
  Tag,
} from "lucide-react";
import type { ReactNode } from "react";

const NAV = [
  { to: "/app", label: "Översikt", icon: LayoutDashboard },
  { to: "/app/bokningar", label: "Bokningar", icon: CalendarDays },
  { to: "/app/kalender", label: "Kalender", icon: CalendarRange },
  { to: "/app/prisregler", label: "Prisregler", icon: Tag },
  { to: "/app/kallor", label: "iCal-källor", icon: Link2 },
  { to: "/app/mallar", label: "Mallar", icon: Mail },
  { to: "/app/tillval", label: "Tillval", icon: PackagePlus },
  { to: "/app/installningar", label: "Inställningar", icon: Settings },
] as const;

export function AppShell({
  children,
  propertyName,
  onLogout,
}: {
  children: ReactNode;
  propertyName: string | null;
  onLogout: () => void;
}) {
  const { pathname } = useLocation();
  return (
    <div className="min-h-screen bg-[color:var(--bg)]">
      <header className="sticky top-0 z-40 border-b border-[color:var(--line)] bg-[color:var(--bg)]/85 text-[color:var(--ink)] backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-5">
          <Link to="/app" className="font-[Fraunces] text-xl font-semibold tracking-tight">
            StayBoost
          </Link>
          {propertyName && (
            <span className="hidden max-w-48 truncate rounded-full bg-[color:var(--soft)] px-3 py-1 text-[12px] font-medium text-[color:var(--ink)]/70 md:inline">
              {propertyName}
            </span>
          )}
          <nav className="ml-auto flex items-center gap-0.5 overflow-x-auto">
            {NAV.map((n) => {
              const active =
                n.to === "/app"
                  ? pathname === "/app" || pathname === "/app/"
                  : pathname.startsWith(n.to);
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  title={n.label}
                  aria-label={n.label}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-2 text-[13px] font-medium transition sm:px-3 ${
                    active
                      ? "bg-[color:var(--ink)] text-[#FAFAF8]"
                      : "text-[color:var(--ink)]/60 hover:bg-[color:var(--soft)] hover:text-[color:var(--ink)]"
                  }`}
                >
                  <n.icon size={15} />
                  <span className="hidden lg:inline">{n.label}</span>
                </Link>
              );
            })}
            <button
              onClick={onLogout}
              className="ml-0.5 flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-2 text-[13px] font-medium text-[color:var(--ink)]/60 transition hover:bg-[color:var(--soft)] hover:text-[color:var(--ink)] sm:px-3"
              title="Logga ut"
              aria-label="Logga ut"
            >
              <LogOut size={15} />
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-7 sm:px-5 sm:py-8">{children}</main>
    </div>
  );
}

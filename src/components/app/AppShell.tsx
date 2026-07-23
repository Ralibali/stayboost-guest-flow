import { Link, useLocation } from "@tanstack/react-router";
import {
  CalendarDays,
  LayoutDashboard,
  Link2,
  LogOut,
  Mail,
  PackagePlus,
  Settings,
} from "lucide-react";
import type { ReactNode } from "react";

const NAV = [
  { to: "/app", label: "Översikt", icon: LayoutDashboard },
  { to: "/app/bokningar", label: "Bokningar", icon: CalendarDays },
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
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[color:var(--forest)] text-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-5">
          <Link to="/app" className="font-[Fraunces] text-xl font-semibold">
            StayBoost
          </Link>
          {propertyName && (
            <span className="hidden max-w-48 truncate rounded-full bg-white/10 px-3 py-1 text-[12px] font-medium md:inline">
              {propertyName}
            </span>
          )}
          <nav className="ml-auto flex items-center gap-0.5 overflow-x-auto">
            {NAV.map((n) => {
              const active = n.to === "/app" ? pathname === "/app" || pathname === "/app/" : pathname.startsWith(n.to);
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  title={n.label}
                  aria-label={n.label}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-2 text-[13px] font-medium transition sm:px-3 ${
                    active ? "bg-white text-[color:var(--forest)]" : "text-white/75 hover:bg-white/10"
                  }`}
                >
                  <n.icon size={15} />
                  <span className="hidden lg:inline">{n.label}</span>
                </Link>
              );
            })}
            <button
              onClick={onLogout}
              className="ml-0.5 flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-2 text-[13px] font-medium text-white/75 transition hover:bg-white/10 sm:px-3"
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

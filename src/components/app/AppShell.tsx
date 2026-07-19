import { Link, useLocation } from "@tanstack/react-router";
import { CalendarDays, Link2, LogOut, Mail, Settings } from "lucide-react";
import type { ReactNode } from "react";

const NAV = [
  { to: "/app/bokningar", label: "Bokningar", icon: CalendarDays },
  { to: "/app/kallor", label: "iCal-källor", icon: Link2 },
  { to: "/app/mallar", label: "Mallar", icon: Mail },
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
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-5 py-3.5">
          <Link to="/app/bokningar" className="font-[Fraunces] text-xl font-semibold">
            StayBoost
          </Link>
          {propertyName && (
            <span className="hidden rounded-full bg-white/10 px-3 py-1 text-[12px] font-medium sm:inline">
              {propertyName}
            </span>
          )}
          <nav className="ml-auto flex items-center gap-1">
            {NAV.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-[13px] font-medium transition ${
                  pathname.startsWith(n.to)
                    ? "bg-white text-[color:var(--forest)]"
                    : "text-white/75 hover:bg-white/10"
                }`}
              >
                <n.icon size={15} />
                <span className="hidden sm:inline">{n.label}</span>
              </Link>
            ))}
            <button
              onClick={onLogout}
              className="ml-1 flex items-center gap-1.5 rounded-full px-3 py-2 text-[13px] font-medium text-white/75 transition hover:bg-white/10"
              title="Logga ut"
            >
              <LogOut size={15} />
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-8">{children}</main>
    </div>
  );
}

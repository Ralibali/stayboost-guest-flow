import { useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  ArrowLeft,
  BedDouble,
  CalendarDays,
  CalendarRange,
  ChartColumn,
  CircleUserRound,
  ClipboardList,
  ContactRound,
  Croissant,
  Globe,
  KeyRound,
  LayoutDashboard,
  Sparkles,
  Sun,
  Users,
} from "lucide-react";

const DEMO_GROUPS = [
  {
    label: "Gäst",
    views: [
      { to: "/demo/gast", label: "Gästhubb", icon: BedDouble },
      { to: "/demo/boka", label: "Boka", icon: CalendarDays },
      { to: "/demo/min-sida", label: "Min sida", icon: CircleUserRound },
      { to: "/demo/incheckning", label: "Incheckning", icon: KeyRound },
    ],
  },
  {
    label: "Team",
    views: [
      { to: "/demo/frukost", label: "Frukost", icon: Croissant },
      { to: "/demo/stad", label: "Städning", icon: ClipboardList },
      { to: "/demo/dagsoversikt", label: "Dagsöversikt", icon: Sun },
      { to: "/demo/personal", label: "Personal", icon: Users },
    ],
  },
  {
    label: "Ägare",
    views: [
      { to: "/demo/admin", label: "Admin", icon: LayoutDashboard },
      { to: "/demo/bokningar", label: "Bokningar", icon: CalendarRange },
      { to: "/demo/kanaler", label: "Kanaler", icon: Globe },
      { to: "/demo/rapporter", label: "Rapporter", icon: ChartColumn },
      { to: "/demo/gaster", label: "Gäster", icon: ContactRound },
    ],
  },
] as const;

export function DemoShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [chosenGroup, setChosenGroup] = useState<string | null>(null);

  const pathGroup =
    DEMO_GROUPS.find((g) => g.views.some((v) => pathname.startsWith(v.to)))?.label ?? null;
  const activeGroup = chosenGroup ?? pathGroup ?? "Gäst";
  const views = DEMO_GROUPS.find((g) => g.label === activeGroup)?.views ?? DEMO_GROUPS[0].views;

  return (
    <div className="min-h-screen bg-[color:var(--bg)]">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-[color:var(--forest)] text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link to="/demo" className="flex items-center gap-2">
            <span className="font-[Fraunces] text-xl font-semibold tracking-tight">StayBoost</span>
            <span className="hidden rounded-full bg-[color:var(--brass)] px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide sm:inline">
              Demo
            </span>
          </Link>
          <Link
            to="/"
            className="flex items-center gap-1.5 rounded-full border border-white/25 px-3.5 py-1.5 text-[13px] font-medium text-white/85 transition hover:bg-white/10 hover:text-white"
          >
            <ArrowLeft size={14} />
            <span className="hidden sm:inline">Till sajten</span>
          </Link>
        </div>

        {/* Gruppflikar + aktiv gruppens vyer — aldrig fler än en rad */}
        <nav className="border-t border-white/10">
          <div className="mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto px-3 py-2 sm:px-6">
            <div className="mr-2 flex shrink-0 items-center gap-0.5 rounded-full bg-white/10 p-0.5">
              {DEMO_GROUPS.map((g) => (
                <button
                  key={g.label}
                  onClick={() => setChosenGroup(g.label === activeGroup ? null : g.label)}
                  className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] transition ${
                    activeGroup === g.label
                      ? "bg-[color:var(--brass)] text-[color:var(--forest)]"
                      : "text-white/70 hover:text-white"
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
            <span className="h-4 w-px shrink-0 bg-white/20" />
            {views.map((v) => {
              const active = pathname.startsWith(v.to);
              const Icon = v.icon;
              return (
                <Link
                  key={v.to}
                  to={v.to}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition ${
                    active
                      ? "bg-white text-[color:var(--forest)]"
                      : "text-white/75 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <Icon size={13} strokeWidth={2.2} />
                  {v.label}
                </Link>
              );
            })}
          </div>
        </nav>
      </header>

      <div className="mx-auto max-w-6xl px-4 pb-20 pt-8 sm:px-6">{children}</div>

      <footer className="border-t border-[color:var(--line)] py-6 text-center text-[13px] text-[color:var(--ink)]/55">
        <Sparkles className="mr-1.5 inline-block" size={13} />
        Demoläge — allt du ser är testdata från fiktiva Bergs Slussar Glamping. Inget bokas eller
        debiteras på riktigt.
      </footer>
    </div>
  );
}

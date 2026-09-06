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
  ShieldCheck,
  Sparkles,
  Sun,
  Users,
} from "lucide-react";
import { DEMO_TRUST_LINE, demoHasMobileDock } from "@/components/produkten/demo-copy";

const DEMO_GROUPS = [
  {
    label: "Gäst",
    views: [
      { to: "/produkten/gast", label: "Gästhubb", icon: BedDouble },
      { to: "/produkten/boka", label: "Boka", icon: CalendarDays },
      { to: "/produkten/min-sida", label: "Min sida", icon: CircleUserRound },
      { to: "/produkten/incheckning", label: "Incheckning", icon: KeyRound },
    ],
  },
  {
    label: "Team",
    views: [
      { to: "/produkten/frukost", label: "Frukost", icon: Croissant },
      { to: "/produkten/stad", label: "Städning", icon: ClipboardList },
      { to: "/produkten/dagsoversikt", label: "Dagsöversikt", icon: Sun },
      { to: "/produkten/personal", label: "Personal", icon: Users },
    ],
  },
  {
    label: "Ägare",
    views: [
      { to: "/produkten/admin", label: "Admin", icon: LayoutDashboard },
      { to: "/produkten/bokningar", label: "Bokningar", icon: CalendarRange },
      { to: "/produkten/kanaler", label: "Kanaler", icon: Globe },
      { to: "/produkten/rapporter", label: "Rapporter", icon: ChartColumn },
      { to: "/produkten/gaster", label: "Gäster", icon: ContactRound },
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
  const mobileDock = demoHasMobileDock(pathname);

  return (
    <div className="min-h-dvh overflow-x-clip bg-[color:var(--bg)]">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-[color:var(--forest)] text-white">
        <div className="mx-auto flex min-h-11 max-w-6xl items-center justify-between gap-3 px-4 py-1.5 sm:px-6 sm:py-2.5">
          <Link to="/produkten" className="flex min-h-11 items-center gap-2">
            <span className="font-[Fraunces] text-xl font-semibold tracking-tight">StayBoost</span>
            <span className="hidden rounded-full bg-[color:var(--brass)] px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide sm:inline">
              Produkten
            </span>
          </Link>
          <Link
            to="/"
            className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full border border-white/25 px-3 text-[13px] font-medium text-white/85 transition hover:bg-white/10 hover:text-white"
          >
            <ArrowLeft size={14} />
            <span className="hidden sm:inline">Till sajten</span>
            <span className="sr-only sm:hidden">Till sajten</span>
          </Link>
        </div>

        <nav className="border-t border-white/10" aria-label="Produktdemo">
          <div className="mx-auto flex min-w-0 max-w-6xl flex-col gap-1.5 px-3 py-2 sm:flex-row sm:items-center sm:gap-2 sm:px-6">
            <div className="flex shrink-0 flex-wrap items-center gap-1">
              {DEMO_GROUPS.map((g) => (
                <button
                  key={g.label}
                  type="button"
                  onClick={() => setChosenGroup(g.label === activeGroup ? null : g.label)}
                  className={`inline-flex min-h-11 items-center rounded-full px-3.5 text-[12px] font-semibold uppercase tracking-[0.08em] transition ${
                    activeGroup === g.label
                      ? "bg-[color:var(--brass)] text-[color:var(--forest)]"
                      : "text-white/70 hover:text-white"
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
            <span className="hidden h-4 w-px shrink-0 bg-white/20 sm:block" />
            <div className="scrollbar-none -mx-1 flex min-w-0 gap-1 overflow-x-auto overscroll-x-contain px-1">
              {views.map((v) => {
                const active = pathname.startsWith(v.to);
                const Icon = v.icon;
                return (
                  <Link
                    key={v.to}
                    to={v.to}
                    className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium whitespace-nowrap transition ${
                      active
                        ? "bg-white text-[color:var(--forest)]"
                        : "text-white/75 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    <Icon size={14} strokeWidth={2.2} />
                    {v.label}
                  </Link>
                );
              })}
            </div>
          </div>
        </nav>

        <div className="border-t border-[color:var(--brass)]/30 bg-[#f3e8c8] text-[color:var(--forest)]">
          <p className="mx-auto flex max-w-6xl items-center justify-center gap-2 px-3 py-1 text-center text-[11px] leading-snug font-semibold sm:px-6 sm:py-1.5 sm:text-[13px]">
            <ShieldCheck size={14} className="hidden shrink-0 sm:block" aria-hidden />
            {DEMO_TRUST_LINE}
          </p>
        </div>
      </header>

      <div className="mx-auto min-w-0 max-w-6xl overflow-x-clip px-4 pt-6 pb-24 sm:px-6 sm:pt-8">
        {children}
      </div>

      <footer
        className={`border-t border-[color:var(--line)] px-4 py-6 text-center text-[13px] text-[color:var(--ink)]/55 ${
          mobileDock
            ? "pb-[max(6.5rem,calc(5.25rem+env(safe-area-inset-bottom,0px)))] lg:pb-6"
            : "pb-[max(1.5rem,env(safe-area-inset-bottom,0px))]"
        }`}
      >
        <Sparkles className="mr-1.5 inline-block" size={13} />
        {DEMO_TRUST_LINE}
      </footer>
    </div>
  );
}

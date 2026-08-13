import { useStayBoostStats } from "@/hooks/useStayBoostStats";
import { formatInt, formatSek } from "@/lib/stats";

/**
 * Hero-bevisbadge. Delar `useStayBoostStats` med CaseStudy — TanStack Query
 * dedupliserar samma queryKey, så det blir ett enda nätverksanrop per session.
 */
export function HeroProofBadge() {
  const { stats } = useStayBoostStats();
  return (
    <a
      href="#case-study"
      className="group inline-flex max-w-full items-center gap-2.5 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-[0.8rem] text-white/90 backdrop-blur-sm transition-colors hover:border-white/35 hover:bg-white/15 sm:text-[0.85rem]"
    >
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[color:var(--brass)] opacity-70" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-[color:var(--brass)]" />
      </span>
      <span className="min-w-0 truncate tabular-nums">
        <span className="font-medium text-white">
          {formatSek(stats.paidAddonRevenueSek)} i tillval
        </span>{" "}
        på {formatInt(stats.bookings2026)} bokningar — live från Göta Kanal Glamping
      </span>
      <span aria-hidden className="shrink-0 transition-transform group-hover:translate-x-0.5">
        →
      </span>
    </a>
  );
}

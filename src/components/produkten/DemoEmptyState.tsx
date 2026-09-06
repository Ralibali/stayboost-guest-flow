export function DemoEmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[color:var(--line)] bg-[color:var(--bg)]/70 px-5 py-8 text-center">
      <p className="font-sans text-[15px] font-semibold">{title}</p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-[color:var(--ink)]/60">{body}</p>
    </div>
  );
}

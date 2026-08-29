import { createFileRoute, Outlet } from "@tanstack/react-router";
import { DemoShell } from "@/components/produkten/DemoShell";

export const Route = createFileRoute("/produkten")({
  component: DemoLayout,
  head: () => ({
    meta: [{ name: "robots", content: "noindex" }],
  }),
});

function DemoLayout() {
  return (
    <DemoShell>
      <Outlet />
    </DemoShell>
  );
}

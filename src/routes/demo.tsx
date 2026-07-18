import { createFileRoute, Outlet } from "@tanstack/react-router";
import { DemoShell } from "@/components/demo/DemoShell";

export const Route = createFileRoute("/demo")({
  component: DemoLayout,
});

function DemoLayout() {
  return (
    <DemoShell>
      <Outlet />
    </DemoShell>
  );
}

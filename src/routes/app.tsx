import { Link, Outlet, createFileRoute, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { AppShell } from "@/components/app/AppShell";
import { supabase, supabaseConfigured, useProperty, useSession } from "@/lib/supabase";

export const Route = createFileRoute("/app")({
  component: AppLayout,
});

function AppLayout() {
  const session = useSession();
  const { property } = useProperty(session);
  const navigate = useNavigate();
  const location = useLocation();
  const onLoginPage = location.pathname === "/app/login";

  useEffect(() => {
    if (!supabaseConfigured) return;
    if (session === null && !onLoginPage) {
      navigate({ to: "/app/login" });
    }
  }, [session, onLoginPage, navigate]);

  useEffect(() => {
    if (!supabaseConfigured || !session || property !== null) return;
    if (property === null && location.pathname !== "/app/onboarding" && !onLoginPage) {
      navigate({ to: "/app/onboarding" });
    }
  }, [session, property, location.pathname, onLoginPage, navigate]);

  if (!supabaseConfigured) {
    return (
      <div className="mx-auto max-w-lg px-5 py-24 text-center">
        <p className="eyebrow">Operatörsvy i StayBoost</p>
        <h1 className="mt-3 font-[Fraunces] text-3xl font-semibold">
          Supabase är inte kopplat ännu
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-[color:var(--ink)]/65">
          Sätt <code className="rounded bg-[color:var(--bg)] px-1.5 py-0.5">VITE_SUPABASE_URL</code>{" "}
          och{" "}
          <code className="rounded bg-[color:var(--bg)] px-1.5 py-0.5">VITE_SUPABASE_ANON_KEY</code>{" "}
          i miljön, kör migrationen i{" "}
          <code className="rounded bg-[color:var(--bg)] px-1.5 py-0.5">supabase/migrations</code>{" "}
          och publicera edge-funktionerna – sedan fungerar allt här.
        </p>
        <Link to="/demo" className="btn-primary mt-8 inline-flex !rounded-xl !px-6 !py-3">
          Under tiden: utforska demot →
        </Link>
      </div>
    );
  }

  if (onLoginPage) return <Outlet />;

  if (session === undefined || (session && property === undefined)) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-[color:var(--line)] border-t-[color:var(--forest)]" />
      </div>
    );
  }

  if (!session) return null; // omdirigering pågår

  return (
    <AppShell
      onLogout={async () => {
        await supabase!.auth.signOut();
        navigate({ to: "/app/login" });
      }}
      propertyName={property?.name ?? null}
    >
      <Outlet />
    </AppShell>
  );
}

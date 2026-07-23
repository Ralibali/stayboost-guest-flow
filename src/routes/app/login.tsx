import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase, useSession } from "@/lib/supabase";

export const Route = createFileRoute("/app/login")({
  component: LoginPage,
});

function LoginPage() {
  const session = useSession();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (session) navigate({ to: "/app" });
  }, [session, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    if (mode === "in") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
    } else {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) setError(error.message);
      else setNotice("Konto skapat. Bekräfta e-postadressen om det krävs och logga sedan in.");
    }
    setBusy(false);
  };

  return (
    <div className="grid min-h-screen place-items-center bg-[color:var(--forest)] px-5">
      <div className="w-full max-w-sm">
        <div className="text-center">
          <Link to="/" className="font-[Fraunces] text-3xl font-semibold text-white">StayBoost</Link>
          <p className="mt-2 text-[14px] text-white/65">Logga in till din anläggning</p>
        </div>
        <form onSubmit={submit} className="card-surface mt-8 space-y-4 p-6">
          <label className="block">
            <span className="text-[12px] font-semibold uppercase tracking-wide text-[color:var(--ink)]/55">E-post</span>
            <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="inp mt-1.5" />
          </label>
          <label className="block">
            <span className="text-[12px] font-semibold uppercase tracking-wide text-[color:var(--ink)]/55">Lösenord</span>
            <input type="password" required minLength={8} autoComplete={mode === "in" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} className="inp mt-1.5" />
          </label>
          {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-[13px] text-red-700">{error}</p>}
          {notice && <p className="rounded-xl bg-emerald-50 px-3.5 py-2.5 text-[13px] text-emerald-800">{notice}</p>}
          <button type="submit" disabled={busy} className="btn-primary w-full justify-center !rounded-xl !py-3 text-[15px] disabled:opacity-50">
            {busy ? "Vänta…" : mode === "in" ? "Logga in" : "Skapa konto"}
          </button>
          <button type="button" onClick={() => setMode(mode === "in" ? "up" : "in")} className="w-full text-center text-[13px] font-medium text-[color:var(--ink)]/55 hover:text-[color:var(--forest)]">
            {mode === "in" ? "Ny anläggning? Skapa konto" : "Har redan konto? Logga in"}
          </button>
        </form>
      </div>
    </div>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BookOpenText,
  CheckCircle2,
  MessageSquareText,
  PackagePlus,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { GuestAiSettings } from "@/components/app/GuestAiSettings";
import { conciergeReadiness } from "@/lib/concierge-readiness";
import { supabase, useProperty, useSession } from "@/lib/supabase";

export const Route = createFileRoute("/app/concierge")({
  component: ConciergePage,
});

type Stats = {
  knowledgeCount: number;
  unreadCount: number;
  activeAddonCount: number;
};

const levelLabel = {
  setup: "Behöver grundsetup",
  pilot: "Redo för kontrollerad pilot",
  ready: "Redo för löpande human-review",
} as const;

function ConciergePage() {
  const session = useSession();
  const { property, reload: reloadProperty } = useProperty(session);
  const [stats, setStats] = useState<Stats>({
    knowledgeCount: 0,
    unreadCount: 0,
    activeAddonCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !property) return;

    setLoading(true);
    setError(null);

    const [knowledge, unread, addons] = await Promise.all([
      supabase
        .from("guest_ai_knowledge")
        .select("id", { count: "exact", head: true })
        .eq("property_id", property.id)
        .eq("enabled", true),
      supabase
        .from("chat_messages")
        .select("id", { count: "exact", head: true })
        .eq("property_id", property.id)
        .is("read_at", null),
      supabase
        .from("addons")
        .select("id", { count: "exact", head: true })
        .eq("property_id", property.id)
        .eq("active", true)
        .eq("internal_only", false),
    ]);

    const firstError = knowledge.error ?? unread.error ?? addons.error;
    if (firstError) {
      setError(firstError.message);
    } else {
      setStats({
        knowledgeCount: knowledge.count ?? 0,
        unreadCount: unread.count ?? 0,
        activeAddonCount: addons.count ?? 0,
      });
    }
    setLoading(false);
  }, [property]);

  useEffect(() => {
    void load();
  }, [load]);

  const readiness = useMemo(
    () =>
      conciergeReadiness({
        guestAiEnabled: Boolean(property?.guest_ai_enabled),
        knowledgeCount: stats.knowledgeCount,
        hasInstructions: Boolean(property?.guest_ai_instructions?.trim()),
        activeAddonCount: stats.activeAddonCount,
      }),
    [
      property?.guest_ai_enabled,
      property?.guest_ai_instructions,
      stats.activeAddonCount,
      stats.knowledgeCount,
    ],
  );

  if (!property) return null;

  return (
    <div className="mx-auto max-w-5xl space-y-6" data-private="true">
      <header>
        <p className="eyebrow">Gästresa · Concierge Lite</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-[Fraunces] text-3xl font-semibold">
              AI-concierge med personalen i kontroll
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-black/60">
              Kunskapsbas, gästfrågor och merförsäljning i ett arbetsflöde. AI:n förbereder svar;
              personalen granskar innan något skickas.
            </p>
          </div>
          <span className="rounded-full bg-[#173c2b] px-3 py-1.5 text-xs font-semibold text-white">
            {levelLabel[readiness.level]} · {readiness.score}/100
          </span>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={Sparkles} label="Guest AI" value={property.guest_ai_enabled ? "Aktiv" : "Av"} />
        <Stat icon={BookOpenText} label="Verifierade FAQ" value={String(stats.knowledgeCount)} />
        <Stat
          icon={MessageSquareText}
          label="Olästa frågor"
          value={String(stats.unreadCount)}
          attention={stats.unreadCount > 0}
        />
        <Stat icon={PackagePlus} label="Aktiva tillval" value={String(stats.activeAddonCount)} />
      </section>

      <section className="rounded-2xl border border-[#2d684c]/20 bg-[#edf6f1] p-5">
        <div className="flex gap-3">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-[#2d684c]" />
          <div>
            <h2 className="font-semibold">Human-review är standard</h2>
            <p className="mt-1 text-sm leading-relaxed text-black/65">
              Gästens fråga kan bli ett internt AI-utkast från verifierad kunskapsbas. Personal
              justerar och skickar via rätt kanal. Bokningsändringar och betalningar görs inte
              automatiskt här.
            </p>
          </div>
        </div>
      </section>

      {error ? (
        <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <section className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
        <div className="rounded-2xl border bg-white p-5">
          <h2 className="font-[Fraunces] text-xl font-semibold">Nästa steg</h2>
          {loading ? (
            <p className="mt-4 text-sm text-black/50">Kontrollerar setup…</p>
          ) : readiness.nextActions.length ? (
            <div className="mt-4 space-y-3">
              {readiness.nextActions.map((action) => (
                <div key={action} className="flex gap-3 rounded-xl bg-[#f5f6f3] p-3 text-sm">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-700" />
                  <span>{action}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 flex gap-3 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              <span>Grundsetupen är komplett. Förbättra FAQ:n utifrån riktiga gästfrågor.</span>
            </div>
          )}
        </div>

        <div className="rounded-2xl border bg-white p-5">
          <h2 className="font-[Fraunces] text-xl font-semibold">Arbetsflödet</h2>
          <div className="mt-4 space-y-2 text-sm">
            {[
              ["1", "Gästen skriver", "Webbinkorgen tar emot frågan."],
              ["2", "AI förbereder", "Utkast byggs från verifierad FAQ och instruktioner."],
              ["3", "Personal granskar", "Utkastet kan ändras innan det används."],
              ["4", "Merförsäljning", "Aktiva tillval finns redo när de passar."],
            ].map(([number, title, body]) => (
              <div key={number} className="grid grid-cols-[28px_1fr] gap-2 rounded-xl border p-3">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-[#173c2b] text-xs font-bold text-white">
                  {number}
                </span>
                <div>
                  <p className="font-semibold">{title}</p>
                  <p className="mt-0.5 text-xs text-black/55">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-5">
        <h2 className="font-[Fraunces] text-xl font-semibold">Snabbvägar</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <QuickLink to="/app/inkorg" title="Inkorg" body="Gästfrågor och AI-utkast." />
          <QuickLink
            to="/app/tillval"
            title="Tillval"
            body="Frukost, sen utcheckning och uppgraderingar."
          />
          <QuickLink
            to="/app/mallar"
            title="Gästkommunikation"
            body="För- och eftervistelseflöden."
          />
          <QuickLink
            to="/app/telefon"
            title="Telefonagent"
            body="Separat pilotspår för telefoni."
          />
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-5">
        <div className="mb-5">
          <p className="eyebrow">Kunskapsbas & guardrails</p>
          <h2 className="mt-2 font-[Fraunces] text-2xl font-semibold">Vad får AI:n svara på?</h2>
          <p className="mt-1 text-sm text-black/60">
            Använd verifierade svar och tydliga instruktioner. Osäkra frågor ska lämnas till
            personal.
          </p>
        </div>
        <GuestAiSettings
          propertyId={property.id}
          enabled={Boolean(property.guest_ai_enabled)}
          instructions={property.guest_ai_instructions}
          onUpdated={() => {
            void reloadProperty();
            void load();
          }}
        />
      </section>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  attention = false,
}: {
  icon: typeof Sparkles;
  label: string;
  value: string;
  attention?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        attention ? "border-amber-200 bg-amber-50" : "bg-white"
      }`}
    >
      <Icon size={16} />
      <p className="mt-3 text-[10px] font-bold uppercase tracking-[0.12em] text-black/40">
        {label}
      </p>
      <p className="mt-1 font-[Fraunces] text-2xl font-semibold">{value}</p>
    </div>
  );
}

function QuickLink({
  to,
  title,
  body,
}: {
  to: "/app/inkorg" | "/app/tillval" | "/app/mallar" | "/app/telefon";
  title: string;
  body: string;
}) {
  return (
    <Link
      to={to}
      className="group rounded-xl border p-4 transition hover:border-[#2d684c]/35 hover:bg-[#f7faf8]"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{title}</p>
        <ArrowRight size={14} className="transition group-hover:translate-x-0.5" />
      </div>
      <p className="mt-2 text-xs leading-relaxed text-black/55">{body}</p>
    </Link>
  );
}

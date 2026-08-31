import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  LogOut,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  UserRound,
  Users,
  WalletCards,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, supabaseConfigured, useSession } from "@/lib/supabase";

export const Route = createFileRoute("/admin")({
  component: PlatformAdminPage,
});

type Subscription = {
  status: string;
  planInterval: "month" | "year" | null;
  unitAmount: number | null;
  currency: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  stripeVerified: boolean;
};

type Customer = {
  id: string;
  email: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
  properties: Array<{ id: string; name: string; slug: string }>;
  subscription: Subscription | null;
};

type AdminOverview = {
  metrics: {
    users: number;
    properties: number;
    bookings: number;
    activeSubscriptions: number;
    trials: number;
    paymentProblems: number;
    canceling: number;
    mrrSek: number;
    arrSek: number;
  };
  health: {
    openAlerts: number;
    criticalAlerts: number;
    stripeUnverified: number;
    cronLastSucceededAt: string | null;
    cronLastFailedAt: string | null;
    cronLastError: string | null;
  };
  customers: Customer[];
};

const fmtKr = (value: number) => `${Math.round(value).toLocaleString("sv-SE")} kr`;

const fmtDate = (value: string | null) =>
  value
    ? new Date(value).toLocaleDateString("sv-SE", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";

const fmtDateTime = (value: string | null) =>
  value
    ? new Date(value).toLocaleString("sv-SE", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "aldrig";

function statusLabel(status: string | undefined) {
  switch (status) {
    case "active":
      return "Aktiv";
    case "trialing":
      return "Provperiod";
    case "past_due":
      return "Försenad betalning";
    case "unpaid":
      return "Obetald";
    case "incomplete":
      return "Ej slutförd";
    case "paused":
      return "Pausad";
    case "canceled":
      return "Avslutad";
    default:
      return "Ingen plan";
  }
}

function statusClass(status: string | undefined) {
  if (status === "active") return "bg-emerald-50 text-emerald-800";
  if (status === "trialing") return "bg-amber-50 text-amber-800";
  if (["past_due", "unpaid", "incomplete"].includes(status ?? "")) {
    return "bg-red-50 text-red-800";
  }
  return "bg-black/[0.05] text-[color:var(--ink)]/55";
}

function PlatformAdminPage() {
  const session = useSession();
  const navigate = useNavigate();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !session) return;
    setLoading(true);
    setError(null);

    const { data, error: invokeError } = await supabase.functions.invoke("platform-admin", {
      body: { action: "overview" },
    });

    if (invokeError || !data?.ok) {
      setOverview(null);
      setForbidden(Boolean(invokeError));
      setError(
        invokeError
          ? "Kontot har inte plattformsbehörighet ännu, eller så kunde admin-API:t inte nås."
          : "Kunde inte läsa plattformsdata just nu.",
      );
    } else {
      setForbidden(false);
      setOverview(data as AdminOverview & { ok: true });
    }
    setLoading(false);
  }, [session]);

  useEffect(() => {
    if (session) load();
    else if (session === null) setLoading(false);
  }, [session, load]);

  const riskyCustomers = useMemo(
    () =>
      overview?.customers.filter((customer) =>
        ["past_due", "unpaid", "incomplete"].includes(customer.subscription?.status ?? ""),
      ) ?? [],
    [overview],
  );

  if (!supabaseConfigured) {
    return (
      <AdminMessage
        title="Backend saknas"
        body="StayBoost-admin kan inte öppnas förrän Supabase-miljön är kopplad."
      />
    );
  }

  if (session === undefined || loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#f4f5f2]">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-black/10 border-t-[#173c2b]" />
      </div>
    );
  }

  if (!session) {
    return (
      <AdminMessage
        title="Logga in först"
        body="Plattformsadmin använder samma säkra StayBoost-inloggning, men har en separat serverstyrd behörighet."
      >
        <Link to="/app/login" className="btn-primary mt-6 inline-flex !rounded-xl !px-5 !py-3">
          Till inloggningen <ArrowRight size={14} />
        </Link>
      </AdminMessage>
    );
  }

  if (!overview) {
    return (
      <AdminMessage
        title={forbidden ? "Plattformsbehörighet saknas" : "Admin kunde inte laddas"}
        body={
          error ??
          "Det här kontot kan använda kundvyn, men har inte tillgång till StayBoost-plattformens ägaradmin."
        }
      >
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button onClick={load} className="btn-primary inline-flex !rounded-xl !px-5 !py-3">
            Försök igen <RefreshCw size={14} />
          </button>
          <Link
            to="/app"
            className="inline-flex items-center rounded-xl border border-black/10 bg-white px-5 py-3 text-[13px] font-bold"
          >
            Öppna kundvyn
          </Link>
        </div>
      </AdminMessage>
    );
  }

  const healthOk =
    overview.health.openAlerts === 0 &&
    overview.health.criticalAlerts === 0 &&
    overview.health.stripeUnverified === 0 &&
    !overview.health.cronLastError;

  return (
    <div className="min-h-screen bg-[#f4f5f2] text-[color:var(--ink)]">
      <header className="border-b border-white/10 bg-[#10251b] text-white">
        <div className="mx-auto flex max-w-[1500px] items-center gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <Link to="/admin" className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-white text-[#173c2b]">
              <ShieldCheck size={17} />
            </span>
            <span>
              <span className="block font-[Fraunces] text-[20px] font-semibold leading-none">
                StayBoost
              </span>
              <span className="mt-1 block text-[9px] font-bold uppercase tracking-[0.18em] text-white/40">
                Plattformadmin
              </span>
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <Link
              to="/app"
              className="hidden rounded-xl bg-white/[0.08] px-3 py-2 text-[11px] font-semibold text-white/70 hover:bg-white/[0.12] sm:inline-flex"
            >
              Kundvyn
            </Link>
            <button
              onClick={async () => {
                await supabase!.auth.signOut();
                navigate({ to: "/app/login" });
              }}
              className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] font-semibold text-white/55 hover:bg-white/[0.08] hover:text-white"
            >
              <LogOut size={14} /> Logga ut
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] space-y-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <section className="overflow-hidden rounded-[26px] bg-[#173c2b] px-5 py-6 text-white shadow-[0_20px_60px_rgba(16,37,27,0.14)] sm:px-7 sm:py-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">
                Ägarvy · hela StayBoost
              </p>
              <h1 className="mt-2 font-[Fraunces] text-[32px] font-semibold sm:text-[38px]">
                Affären och driften på en skärm.
              </h1>
              <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-white/58">
                Kunder, abonnemang, återkommande intäkt och teknisk hälsa — utan att blanda in
                gästernas personuppgifter.
              </p>
            </div>
            <button
              onClick={load}
              className="inline-flex self-start items-center gap-2 rounded-xl border border-white/15 bg-white/[0.08] px-4 py-2.5 text-[11px] font-bold text-white/80 hover:bg-white/[0.12]"
            >
              <RefreshCw size={14} /> Uppdatera live
            </button>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6">
          <Metric icon={Users} label="Konton" value={String(overview.metrics.users)} />
          <Metric
            icon={Building2}
            label="Anläggningar"
            value={String(overview.metrics.properties)}
          />
          <Metric
            icon={CreditCard}
            label="Aktiva abonnemang"
            value={String(overview.metrics.activeSubscriptions)}
            sub={`${overview.metrics.trials} provperiod`}
          />
          <Metric icon={WalletCards} label="MRR" value={fmtKr(overview.metrics.mrrSek)} />
          <Metric icon={TrendingUp} label="ARR run-rate" value={fmtKr(overview.metrics.arrSek)} />
          <Metric
            icon={CalendarClock}
            label="Bokningar totalt"
            value={overview.metrics.bookings.toLocaleString("sv-SE")}
          />
        </section>

        <section
          className={`rounded-[22px] border px-5 py-4 ${
            healthOk ? "border-emerald-200 bg-emerald-50/70" : "border-amber-200 bg-amber-50/80"
          }`}
        >
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              {healthOk ? (
                <CheckCircle2 size={19} className="mt-0.5 text-emerald-700" />
              ) : (
                <AlertTriangle size={19} className="mt-0.5 text-amber-700" />
              )}
              <div>
                <p className="text-[13px] font-bold">
                  {healthOk ? "Plattformen är frisk" : "Något behöver följas upp"}
                </p>
                <p className="mt-1 text-[11px] text-[color:var(--ink)]/55">
                  {overview.health.openAlerts} öppna driftlarm · {overview.metrics.paymentProblems}{" "}
                  betalproblem · {overview.metrics.canceling} avslutas vid periodslut
                  {overview.health.stripeUnverified
                    ? ` · ${overview.health.stripeUnverified} abonnemang kunde inte liveverifieras mot Stripe`
                    : ""}
                </p>
              </div>
            </div>
            <p className="text-[10px] font-semibold text-[color:var(--ink)]/45">
              Automatik senast OK {fmtDateTime(overview.health.cronLastSucceededAt)}
            </p>
          </div>
        </section>

        <section className="overflow-hidden rounded-[24px] border border-black/[0.07] bg-white shadow-[0_8px_28px_rgba(25,40,31,0.05)]">
          <div className="flex flex-col gap-2 border-b border-black/[0.06] px-5 py-4 sm:flex-row sm:items-end sm:justify-between sm:px-6">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[color:var(--ink)]/35">
                Kunder
              </p>
              <h2 className="mt-1 font-[Fraunces] text-[22px] font-semibold">
                Alla StayBoost-konton
              </h2>
            </div>
            <p className="text-[10px] text-[color:var(--ink)]/40">
              Ägarkonton och abonnemangsstatus · ingen gäst-PII
            </p>
          </div>

          {overview.customers.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <UserRound size={28} className="mx-auto text-[color:var(--ink)]/20" />
              <p className="mt-3 text-[13px] font-bold text-[color:var(--ink)]/55">
                Inga kundkonton ännu.
              </p>
              <p className="mt-1 text-[11px] text-[color:var(--ink)]/38">
                Första registreringen dyker upp här automatiskt.
              </p>
            </div>
          ) : (
            <CustomerTable customers={overview.customers} />
          )}
        </section>

        {riskyCustomers.length > 0 ? <RiskList customers={riskyCustomers} /> : null}
      </main>
    </div>
  );
}

function CustomerTable({ customers }: { customers: Customer[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-left">
        <thead className="bg-[#f7f8f5] text-[9px] font-bold uppercase tracking-[0.13em] text-[color:var(--ink)]/35">
          <tr>
            <th className="px-5 py-3 sm:px-6">Kund</th>
            <th className="px-4 py-3">Anläggning</th>
            <th className="px-4 py-3">Plan</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Period</th>
            <th className="px-5 py-3 text-right sm:px-6">Skapad</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-black/[0.055]">
          {customers.map((customer) => (
            <tr key={customer.id} className="hover:bg-[#fafbf8]">
              <td className="px-5 py-4 sm:px-6">
                <p className="text-[12px] font-bold">{customer.email ?? "E-post saknas"}</p>
                <p className="mt-0.5 text-[10px] text-[color:var(--ink)]/35">
                  Senast inne {fmtDateTime(customer.lastSignInAt)}
                </p>
              </td>
              <td className="px-4 py-4">
                <p className="text-[12px] font-semibold">
                  {customer.properties[0]?.name ?? "Inte onboardad"}
                </p>
                {customer.properties.length > 1 ? (
                  <p className="mt-0.5 text-[10px] text-[color:var(--ink)]/35">
                    +{customer.properties.length - 1} till
                  </p>
                ) : null}
              </td>
              <td className="px-4 py-4 text-[12px] font-semibold">
                {customer.subscription?.planInterval === "year"
                  ? "4 490 kr/år"
                  : customer.subscription?.planInterval === "month"
                    ? "449 kr/mån"
                    : "—"}
              </td>
              <td className="px-4 py-4">
                <span
                  className={`inline-flex rounded-full px-2.5 py-1 text-[9px] font-bold ${statusClass(customer.subscription?.status)}`}
                >
                  {statusLabel(customer.subscription?.status)}
                </span>
                {customer.subscription?.cancelAtPeriodEnd ? (
                  <p className="mt-1 text-[9px] font-semibold text-amber-700">Avslutas</p>
                ) : null}
              </td>
              <td className="px-4 py-4 text-[11px] text-[color:var(--ink)]/55">
                {fmtDate(customer.subscription?.currentPeriodEnd ?? null)}
              </td>
              <td className="px-5 py-4 text-right text-[11px] text-[color:var(--ink)]/45 sm:px-6">
                {fmtDate(customer.createdAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RiskList({ customers }: { customers: Customer[] }) {
  return (
    <section className="rounded-[24px] border border-red-200 bg-red-50/70 p-5 sm:p-6">
      <div className="flex items-center gap-2">
        <AlertTriangle size={16} className="text-red-700" />
        <h2 className="text-[13px] font-bold text-red-950">Betalningar att följa upp</h2>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {customers.map((customer) => (
          <div key={customer.id} className="rounded-2xl bg-white/70 p-4">
            <p className="text-[12px] font-bold text-red-950">{customer.email ?? "Okänt konto"}</p>
            <p className="mt-1 text-[10px] text-red-900/60">
              {statusLabel(customer.subscription?.status)} · kontrollera betalningen i Stripe.
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-[20px] border border-black/[0.065] bg-white p-4 shadow-[0_6px_24px_rgba(25,40,31,0.04)] sm:p-5">
      <span className="grid h-8 w-8 place-items-center rounded-xl bg-[#eef2ed] text-[#2d684c]">
        <Icon size={15} />
      </span>
      <p className="mt-4 font-[Fraunces] text-[24px] font-semibold leading-none text-[#173c2b]">
        {value}
      </p>
      <p className="mt-2 text-[9px] font-bold uppercase tracking-[0.11em] text-[color:var(--ink)]/40">
        {label}
      </p>
      {sub ? <p className="mt-1 text-[9px] text-[color:var(--ink)]/35">{sub}</p> : null}
    </div>
  );
}

function AdminMessage({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <div className="grid min-h-screen place-items-center bg-[#10251b] px-5">
      <div className="w-full max-w-lg rounded-[26px] bg-white p-7 text-center shadow-2xl sm:p-9">
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-2xl bg-[#edf3ee] text-[#173c2b]">
          <ShieldCheck size={20} />
        </span>
        <p className="mt-5 text-[10px] font-bold uppercase tracking-[0.17em] text-[#2d684c]">
          StayBoost Plattformadmin
        </p>
        <h1 className="mt-2 font-[Fraunces] text-[28px] font-semibold text-[#173c2b]">{title}</h1>
        <p className="mx-auto mt-3 max-w-md text-[13px] leading-relaxed text-[color:var(--ink)]/55">
          {body}
        </p>
        {children}
      </div>
    </div>
  );
}

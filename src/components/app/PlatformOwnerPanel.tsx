import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  CreditCard,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  Users,
  WalletCards,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type PlanInterval = "month" | "year";

type Subscription = {
  status: string;
  planInterval: PlanInterval | null;
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
  if (status === "canceled") return "bg-black/[0.05] text-[color:var(--ink)]/55";
  return "bg-[#eef2ed] text-[#2d684c]";
}

function planLabel(subscription: Subscription | null) {
  if (!subscription?.planInterval || !subscription.unitAmount) return "—";
  const amount = Math.round(subscription.unitAmount / 100).toLocaleString("sv-SE");
  return subscription.planInterval === "year" ? `${amount} kr/år` : `${amount} kr/mån`;
}

export function PlatformOwnerPanel() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("platform-admin", {
      body: { action: "overview" },
    });

    // Vanliga kundkonton får 403 och ska inte ens se att plattformsadmin finns.
    if (error || !data?.ok) {
      setOverview(null);
      setLoading(false);
      return;
    }

    setOverview(data as AdminOverview & { ok: true });
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const activatedAccounts = useMemo(
    () => overview?.customers.filter((customer) => customer.properties.length > 0).length ?? 0,
    [overview],
  );

  if (loading || !overview) return null;

  const activationRate = overview.metrics.users
    ? Math.round((activatedAccounts / overview.metrics.users) * 100)
    : 0;
  const healthOk =
    overview.health.openAlerts === 0 &&
    overview.health.criticalAlerts === 0 &&
    overview.health.stripeUnverified === 0 &&
    !overview.health.cronLastError;

  return (
    <section className="mb-7 overflow-hidden rounded-[26px] border border-black/[0.07] bg-white shadow-[0_12px_36px_rgba(25,40,31,0.06)]">
      <div className="bg-[#10251b] px-5 py-5 text-white sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.18em] text-white/40">
              <ShieldCheck size={13} /> Plattformsadmin
            </p>
            <h2 className="mt-2 font-[Fraunces] text-[25px] font-semibold sm:text-[29px]">
              StayBoost · ägarvy
            </h2>
            <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-white/55 sm:text-[12px]">
              Kundaktivering, abonnemang, återkommande intäkt och drift på en skärm. Ingen gäst-PII
              visas här.
            </p>
          </div>
          <button
            type="button"
            onClick={load}
            className="inline-flex self-start items-center gap-2 rounded-xl border border-white/15 bg-white/[0.08] px-3.5 py-2.5 text-[10px] font-bold text-white/75 transition hover:bg-white/[0.13] hover:text-white"
          >
            <RefreshCw size={13} /> Uppdatera live
          </button>
        </div>
      </div>

      <div className="p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          <Metric icon={Users} label="Kundkonton" value={String(overview.metrics.users)} />
          <Metric
            icon={Building2}
            label="Aktiverade"
            value={String(activatedAccounts)}
            sub={`${activationRate} % har anläggning`}
          />
          <Metric
            icon={CreditCard}
            label="Aktiva abonnemang"
            value={String(overview.metrics.activeSubscriptions)}
            sub={`${overview.metrics.trials} provperiod`}
          />
          <Metric
            icon={WalletCards}
            label="MRR"
            value={fmtKr(overview.metrics.mrrSek)}
            sub="exkl. moms"
          />
          <Metric
            icon={TrendingUp}
            label="ARR run-rate"
            value={fmtKr(overview.metrics.arrSek)}
            sub="exkl. moms"
          />
          <Metric
            icon={AlertTriangle}
            label="Betalproblem"
            value={String(overview.metrics.paymentProblems)}
            sub={`${overview.metrics.canceling} avslutas`}
          />
        </div>

        <div
          className={`mt-4 rounded-2xl border px-4 py-3 ${healthOk ? "border-emerald-200 bg-emerald-50/70" : "border-amber-200 bg-amber-50/80"}`}
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2.5">
              {healthOk ? (
                <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-700" />
              ) : (
                <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-700" />
              )}
              <div>
                <p className="text-[11px] font-bold">
                  {healthOk ? "Plattformen är frisk" : "Något behöver följas upp"}
                </p>
                <p className="mt-0.5 text-[10px] text-[color:var(--ink)]/50">
                  {`${overview.health.openAlerts} driftlarm · ${overview.health.criticalAlerts} kritiska · ${overview.health.stripeUnverified} ej liveverifierade abonnemang`}
                </p>
              </div>
            </div>
            <p className="text-[9px] font-semibold text-[color:var(--ink)]/40">
              Automatik senast OK {fmtDateTime(overview.health.cronLastSucceededAt)}
            </p>
          </div>
        </div>

        <div className="mt-5 overflow-hidden rounded-2xl border border-black/[0.07]">
          <div className="flex items-end justify-between gap-3 border-b border-black/[0.06] bg-[#f7f8f5] px-4 py-3">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[color:var(--ink)]/35">
                Kunder
              </p>
              <p className="mt-0.5 text-[12px] font-bold">Alla StayBoost-konton</p>
            </div>
            <p className="hidden text-[9px] text-[color:var(--ink)]/35 sm:block">
              {overview.metrics.bookings.toLocaleString("sv-SE")} bokningar totalt
            </p>
          </div>

          {overview.customers.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <Users size={24} className="mx-auto text-[color:var(--ink)]/20" />
              <p className="mt-2 text-[11px] font-bold text-[color:var(--ink)]/50">
                Inga kundkonton ännu.
              </p>
              <p className="mt-1 text-[10px] text-[color:var(--ink)]/35">
                Första registreringen dyker upp automatiskt.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left">
                <thead className="text-[8px] font-bold uppercase tracking-[0.12em] text-[color:var(--ink)]/35">
                  <tr>
                    <th className="px-4 py-2.5">Kundkonto</th>
                    <th className="px-3 py-2.5">Anläggning</th>
                    <th className="px-3 py-2.5">Plan</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5">Period</th>
                    <th className="px-4 py-2.5 text-right">Skapad</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.055]">
                  {overview.customers.map((customer) => (
                    <tr key={customer.id} className="text-[10px]">
                      <td className="px-4 py-3">
                        <p className="max-w-[230px] truncate font-bold">
                          {customer.email ?? "Okänt konto"}
                        </p>
                        <p className="mt-0.5 text-[9px] text-[color:var(--ink)]/35">
                          Senast inloggad {fmtDate(customer.lastSignInAt)}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        {customer.properties.length ? (
                          <div>
                            <p className="font-semibold">{customer.properties[0].name}</p>
                            {customer.properties.length > 1 ? (
                              <p className="mt-0.5 text-[9px] text-[color:var(--ink)]/35">
                                +{customer.properties.length - 1} till
                              </p>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-amber-700">Onboarding ej klar</span>
                        )}
                      </td>
                      <td className="px-3 py-3 font-semibold">
                        {planLabel(customer.subscription)}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`rounded-full px-2 py-1 text-[8px] font-bold ${statusClass(customer.subscription?.status)}`}
                        >
                          {statusLabel(customer.subscription?.status)}
                        </span>
                        {customer.subscription && !customer.subscription.stripeVerified ? (
                          <p className="mt-1 text-[8px] font-semibold text-amber-700">
                            Ej liveverifierad
                          </p>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 text-[color:var(--ink)]/55">
                        {customer.subscription?.cancelAtPeriodEnd ? (
                          <span className="font-semibold text-amber-700">
                            Avslutas {fmtDate(customer.subscription.currentPeriodEnd)}
                          </span>
                        ) : (
                          fmtDate(customer.subscription?.currentPeriodEnd ?? null)
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-[color:var(--ink)]/45">
                        {fmtDate(customer.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
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
    <div className="rounded-2xl border border-black/[0.06] bg-[#fafbf8] p-3.5">
      <Icon size={14} className="text-[#2d684c]" />
      <p className="mt-3 font-[Fraunces] text-[22px] font-semibold leading-none text-[#173c2b]">
        {value}
      </p>
      <p className="mt-1.5 text-[8px] font-bold uppercase tracking-[0.1em] text-[color:var(--ink)]/40">
        {label}
      </p>
      {sub ? <p className="mt-1 text-[8px] text-[color:var(--ink)]/32">{sub}</p> : null}
    </div>
  );
}

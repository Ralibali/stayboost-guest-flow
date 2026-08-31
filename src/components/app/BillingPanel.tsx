import { CreditCard, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type PlanInterval = "month" | "year";

type BillingStatus = {
  enabled: boolean;
  subscription: null | {
    status: string;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    hasCustomer: boolean;
    hasSubscription: boolean;
    planInterval?: PlanInterval | null;
    unitAmount?: number | null;
    currency?: string;
  };
};

const portalStatuses = new Set([
  "trialing",
  "active",
  "past_due",
  "unpaid",
  "paused",
  "incomplete",
]);

function statusLabel(status: string | null | undefined) {
  switch (status) {
    case "trialing":
      return "Provperiod";
    case "active":
      return "Aktivt";
    case "past_due":
      return "Betalning saknas";
    case "canceled":
      return "Avslutat";
    case "unpaid":
      return "Obetalt";
    case "incomplete":
      return "Betalning ej slutförd";
    case "incomplete_expired":
      return "Checkout utgången";
    case "paused":
      return "Pausat";
    default:
      return "Ej aktiverat";
  }
}

function planLabel(interval: PlanInterval | null | undefined) {
  return interval === "year" ? "4 490 kr/år" : "449 kr/mån";
}

export function BillingPanel({ mobile = false }: { mobile?: boolean }) {
  const [state, setState] = useState<BillingStatus | null>(null);
  const [busy, setBusy] = useState<"month" | "year" | "portal" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error: invokeError } = await supabase.functions.invoke("saas-billing", {
      body: { action: "status" },
    });
    if (invokeError) {
      // Rolling deploy-safe: billing får aldrig blockera operatörsvyn.
      setState({ enabled: false, subscription: null });
      return;
    }
    setState(data as BillingStatus);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (action: "checkout" | "portal", interval?: PlanInterval) => {
    if (!supabase) return;
    const busyKey = action === "portal" ? "portal" : interval === "year" ? "year" : "month";
    setBusy(busyKey);
    setError(null);
    const { data, error: invokeError } = await supabase.functions.invoke("saas-billing", {
      body: { action, ...(interval ? { interval } : {}) },
    });
    setBusy(null);
    if (invokeError || !data?.url) {
      setError("Kunde inte öppna Stripe just nu. Försök igen om en stund.");
      return;
    }
    window.location.assign(data.url as string);
  };

  const subscription = state?.subscription;
  const usePortal = portalStatuses.has(subscription?.status ?? "");
  const label = statusLabel(subscription?.status);

  if (mobile) {
    return (
      <div className="mx-3 mb-3 rounded-xl border border-black/[0.06] bg-[#f5f6f3] px-3 py-2.5 text-[11px]">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-bold text-[#173c2b]">
              StayBoost · {planLabel(subscription?.planInterval)}
            </p>
            <p className="truncate text-[color:var(--ink)]/50">SMS ingår · {label}</p>
          </div>
          {state?.enabled && usePortal ? (
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => run("portal")}
              className="shrink-0 rounded-lg bg-[#173c2b] px-3 py-2 font-semibold text-white disabled:opacity-50"
            >
              {busy === "portal" ? <Loader2 size={13} className="animate-spin" /> : "Hantera"}
            </button>
          ) : null}
        </div>
        {state?.enabled && !usePortal ? (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => run("checkout", "month")}
              className="rounded-lg bg-[#173c2b] px-2 py-2 font-semibold text-white disabled:opacity-50"
            >
              {busy === "month" ? (
                <Loader2 size={13} className="mx-auto animate-spin" />
              ) : (
                "449 kr/mån"
              )}
            </button>
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => run("checkout", "year")}
              className="rounded-lg border border-[#173c2b]/15 bg-white px-2 py-2 font-semibold text-[#173c2b] disabled:opacity-50"
            >
              {busy === "year" ? (
                <Loader2 size={13} className="mx-auto animate-spin" />
              ) : (
                "4 490 kr/år"
              )}
            </button>
          </div>
        ) : null}
        {!state?.enabled ? (
          <p className="mt-2 text-[10px] text-[color:var(--ink)]/45">
            Stripe-abonnemang är inte konfigurerat ännu.
          </p>
        ) : null}
        {error ? <p className="mt-2 text-[10px] text-red-700">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="mb-2 rounded-xl border border-white/10 bg-white/[0.06] p-3 text-white">
      <div className="flex items-start gap-2.5">
        <CreditCard size={15} className="mt-0.5 shrink-0 text-white/55" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold">
            Abonnemang · {planLabel(subscription?.planInterval)}
          </p>
          <p className="mt-0.5 text-[10px] leading-relaxed text-white/45">
            SMS ingår utan separat kostnad. Priser exkl. moms.
          </p>
          <p className="mt-2 text-[10px] font-semibold text-white/70">{label}</p>
          {subscription?.cancelAtPeriodEnd && subscription.currentPeriodEnd ? (
            <p className="mt-1 text-[9px] leading-relaxed text-amber-200/80">
              Avslutas {new Date(subscription.currentPeriodEnd).toLocaleDateString("sv-SE")}.
            </p>
          ) : null}
          {state?.enabled && usePortal ? (
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => run("portal")}
              className="mt-2 flex w-full items-center justify-center rounded-lg bg-white/10 px-2.5 py-2 text-[10px] font-bold text-white/80 transition hover:bg-white/15 hover:text-white disabled:opacity-50"
            >
              {busy === "portal" ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                "Hantera abonnemang"
              )}
            </button>
          ) : null}
          {state?.enabled && !usePortal ? (
            <div className="mt-2 grid gap-1.5">
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => run("checkout", "month")}
                className="flex w-full items-center justify-center rounded-lg bg-white/10 px-2.5 py-2 text-[10px] font-bold text-white/80 transition hover:bg-white/15 hover:text-white disabled:opacity-50"
              >
                {busy === "month" ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  "Aktivera · 449 kr/mån"
                )}
              </button>
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => run("checkout", "year")}
                className="flex w-full items-center justify-center rounded-lg border border-white/10 px-2.5 py-2 text-[9px] font-bold text-white/65 transition hover:bg-white/[0.07] hover:text-white disabled:opacity-50"
              >
                {busy === "year" ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  "Årsvis · 4 490 kr (2 mån gratis)"
                )}
              </button>
            </div>
          ) : null}
          {!state?.enabled ? (
            <p className="mt-2 rounded-lg bg-white/[0.05] px-2.5 py-2 text-[9px] leading-relaxed text-white/40">
              Stripe-abonnemang är inte konfigurerat ännu.
            </p>
          ) : null}
          {error ? <p className="mt-2 text-[9px] text-red-200">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}

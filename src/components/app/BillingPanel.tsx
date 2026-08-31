import { CreditCard, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type BillingStatus = {
  enabled: boolean;
  subscription: null | {
    status: string;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    hasCustomer: boolean;
    hasSubscription: boolean;
  };
};

const activeStatuses = new Set(["trialing", "active"]);

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
      return "Ej slutfört";
    case "paused":
      return "Pausat";
    default:
      return "Ej aktiverat";
  }
}

export function BillingPanel({ mobile = false }: { mobile?: boolean }) {
  const [state, setState] = useState<BillingStatus | null>(null);
  const [busy, setBusy] = useState<"checkout" | "portal" | null>(null);
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

  const run = async (action: "checkout" | "portal") => {
    if (!supabase) return;
    setBusy(action);
    setError(null);
    const { data, error: invokeError } = await supabase.functions.invoke("saas-billing", {
      body: { action },
    });
    setBusy(null);
    if (invokeError || !data?.url) {
      setError("Kunde inte öppna betalningen just nu.");
      return;
    }
    window.location.assign(data.url as string);
  };

  const subscription = state?.subscription;
  const active = activeStatuses.has(subscription?.status ?? "");
  const label = statusLabel(subscription?.status);

  if (mobile) {
    return (
      <div className="mx-3 mb-3 flex items-center justify-between gap-3 rounded-xl border border-black/[0.06] bg-[#f5f6f3] px-3 py-2.5 text-[11px]">
        <div className="min-w-0">
          <p className="font-bold text-[#173c2b]">StayBoost · 449 kr/mån</p>
          <p className="truncate text-[color:var(--ink)]/50">SMS ingår · {label}</p>
        </div>
        {state?.enabled ? (
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => run(active ? "portal" : "checkout")}
            className="shrink-0 rounded-lg bg-[#173c2b] px-3 py-2 font-semibold text-white disabled:opacity-50"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : active ? "Hantera" : "Aktivera"}
          </button>
        ) : (
          <span className="shrink-0 rounded-full bg-black/[0.05] px-2.5 py-1 font-semibold text-[color:var(--ink)]/45">
            Förberett
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="mb-2 rounded-xl border border-white/10 bg-white/[0.06] p-3 text-white">
      <div className="flex items-start gap-2.5">
        <CreditCard size={15} className="mt-0.5 shrink-0 text-white/55" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold">Abonnemang · 449 kr/mån</p>
          <p className="mt-0.5 text-[10px] leading-relaxed text-white/45">SMS ingår utan separat kostnad.</p>
          <p className="mt-2 text-[10px] font-semibold text-white/70">{label}</p>
          {subscription?.cancelAtPeriodEnd && subscription.currentPeriodEnd ? (
            <p className="mt-1 text-[9px] leading-relaxed text-amber-200/80">
              Avslutas {new Date(subscription.currentPeriodEnd).toLocaleDateString("sv-SE")}.
            </p>
          ) : null}
          {state?.enabled ? (
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => run(active ? "portal" : "checkout")}
              className="mt-2 flex w-full items-center justify-center rounded-lg bg-white/10 px-2.5 py-2 text-[10px] font-bold text-white/80 transition hover:bg-white/15 hover:text-white disabled:opacity-50"
            >
              {busy ? (
                <Loader2 size={13} className="animate-spin" />
              ) : active ? (
                "Hantera abonnemang"
              ) : (
                "Aktivera abonnemang"
              )}
            </button>
          ) : (
            <p className="mt-2 rounded-lg bg-white/[0.05] px-2.5 py-2 text-[9px] leading-relaxed text-white/40">
              Betalningsflödet är förberett men ännu inte aktiverat.
            </p>
          )}
          {error ? <p className="mt-2 text-[9px] text-red-200">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}

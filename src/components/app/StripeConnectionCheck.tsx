import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { readStripeDiagnostic, stripeDiagnosticLabels } from "@/lib/stripe-diagnostic";
import type { StripeDiagnosticResult } from "../../../supabase/functions/_shared/stripe-diagnostic";

export function StripeConnectionCheck({ propertyId }: { propertyId: string }) {
  return <ConnectionCheck key={propertyId} propertyId={propertyId} />;
}

function ConnectionCheck({ propertyId }: { propertyId: string }) {
  const [result, setResult] = useState<StripeDiagnosticResult | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const alive = useRef(false);
  const inFlight = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const check = async () => {
    if (!supabase || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(false);
    setResult(null);
    try {
      const { data, error: requestError } = await supabase.functions.invoke("booking-import", {
        body: { propertyId, action: "stripe_diagnostic" },
      });
      const parsed = readStripeDiagnostic(data);
      if (requestError || !parsed) throw new Error("stripe_diagnostic_unavailable");
      if (alive.current) setResult(parsed);
    } catch {
      if (alive.current) setError(true);
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  };

  return (
    <div className="mt-4 space-y-2 text-sm">
      <Button
        type="button"
        variant="outline"
        className="min-h-11 whitespace-normal rounded-xl border-line bg-card text-forest hover:bg-forest/5 hover:text-forest"
        disabled={busy}
        onClick={() => void check()}
      >
        {busy ? "Kontrollerar Stripe…" : "Kontrollera Stripe-anslutning"}
      </Button>
      <p className="text-xs leading-relaxed text-ink/60">
        Kontrollen provar endast autentisering och läsåtkomst till Checkout. Den verifierar inte
        rätten att skapa betalningar, en genomförd betalning eller betalningsbekräftelser. Inga
        bokningar eller betalningar skapas.
      </p>
      <div role="status" aria-live="polite">
        {result ? (
          <p>
            {stripeDiagnosticLabels[result.status]}
            <span className="mt-1 block text-xs text-ink/60">
              Kontrollerad{" "}
              {new Date(result.checkedAt).toLocaleString("sv-SE", {
                dateStyle: "short",
                timeStyle: "short",
                timeZone: "Europe/Stockholm",
              })}{" "}
              (svensk tid).
            </span>
          </p>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-red-700">
          Kontrollen kunde inte hämtas. Försök igen eller logga in på nytt.
        </p>
      ) : null}
    </div>
  );
}

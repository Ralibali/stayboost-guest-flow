import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { readStripeCheckoutCheck, stripeCheckoutCheckLabels } from "@/lib/stripe-checkout-check";
import type { StripeCheckoutDiagnosticResult } from "../../../supabase/functions/_shared/stripe-checkout-diagnostic";

export function StripeCheckoutCheck({ propertyId }: { propertyId: string }) {
  return <CheckoutCheck key={propertyId} propertyId={propertyId} />;
}

function CheckoutCheck({ propertyId }: { propertyId: string }) {
  const [result, setResult] = useState<StripeCheckoutDiagnosticResult | null>(null);
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
      const { data, error: requestError } = await supabase.functions.invoke(
        "stripe-checkout-diagnostic",
        { body: { propertyId } },
      );
      const parsed = readStripeCheckoutCheck(data);
      if (requestError || !parsed) throw new Error("stripe_checkout_check_unavailable");
      if (alive.current) setResult(parsed);
    } catch {
      if (alive.current) setError(true);
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  };

  return (
    <div className="mt-4 space-y-2 border-t border-line pt-4 text-sm">
      <Button
        type="button"
        variant="outline"
        className="min-h-11 whitespace-normal rounded-xl border-line bg-card text-forest hover:bg-forest/5 hover:text-forest"
        disabled={busy}
        onClick={() => void check()}
      >
        {busy ? "Kontrollerar provsession…" : "Kontrollera skapande och stängning i Stripe"}
      </Button>
      <p className="text-xs leading-relaxed text-ink/60">
        Kontrollen skapar en obetald provsession i ditt anslutna Stripe-konto och försöker stänga
        den direkt. Ett tidigare försök kan återanvändas. Ingen gästbokning skapas, ingen betalning
        genomförs och inga meddelanden skickas.
      </p>
      <p className="text-xs leading-relaxed text-ink/60">
        Resultatet verifierar inte en genomförd betalning, återbetalning eller signerad
        betalningsbekräftelse.
      </p>
      <div role="status" aria-live="polite">
        {result ? (
          <p>
            {stripeCheckoutCheckLabels[result.status]}
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
          Kontrollens resultat kunde inte hämtas. Kontrollera igen eller logga in på nytt.
        </p>
      ) : null}
    </div>
  );
}

import { useState } from "react";
import { partyPricingUpdate } from "@/lib/party-pricing-form";
import { supabase, type Unit } from "@/lib/supabase";

export function PartyPricing({ unit, onSaved }: { unit: Unit; onSaved: () => void }) {
  const [enabled, setEnabled] = useState(unit.party_pricing_enabled ?? false);
  const [prices, setPrices] = useState(
    Array.from({ length: unit.max_guests }, (_, i) => String(unit.adult_prices?.[i] ?? "")),
  );
  const [childPrice, setChildPrice] = useState(String(unit.child_price_per_night ?? 0));
  const [childPricePerBooking, setChildPricePerBooking] = useState(
    String(unit.child_price_per_booking ?? 0),
  );
  const [childPriceBasis, setChildPriceBasis] = useState<"per_night" | "per_booking">(
    unit.child_price_basis ?? "per_night",
  );
  const [freeAge, setFreeAge] = useState(String(unit.child_free_through_age ?? 3));
  const [maxAge, setMaxAge] = useState(String(unit.child_max_age ?? 12));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const save = async () => {
    if (!supabase || busy) return;
    setError(null);
    setSaved(false);
    let update;
    try {
      update = partyPricingUpdate(unit, {
        enabled,
        adultPrices: prices,
        childPriceBasis,
        childPricePerNight: childPrice,
        childPricePerBooking,
        freeAge,
        maxAge,
      });
    } catch (error) {
      setError((error as Error).message);
      return;
    }
    setBusy(true);
    const { error: saveError } = await supabase
      .from("units")
      .update(update)
      .eq("id", unit.id)
      .eq("property_id", unit.property_id)
      .select("id")
      .single();
    setBusy(false);
    if (saveError) {
      setError(
        "Kunde inte spara personpriserna. Kontrollera att senaste databasversionen är installerad.",
      );
      return;
    }
    setSaved(true);
    onSaved();
  };
  return (
    <div className="space-y-4 rounded-xl border border-line p-4">
      <label className="flex items-start gap-3 text-sm font-medium">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.target.checked);
            setSaved(false);
          }}
          className="mt-1"
        />
        <span>
          Pris efter antal vuxna och barn
          <span className="mt-1 block text-xs font-normal text-ink/60">
            Alla personer räknas mot boendets kapacitet, även barn som bor gratis.
          </span>
        </span>
      </label>
      {enabled ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {prices.map((p, i) => (
              <label key={i} className="text-xs text-ink/65">
                {i + 1} {i === 0 ? "vuxen" : "vuxna"} · kr/natt
                <input
                  type="number"
                  min="0"
                  max="1000000"
                  step="1"
                  value={p}
                  onChange={(e) => {
                    setPrices((old) => old.map((v, j) => (j === i ? e.target.value : v)));
                    setSaved(false);
                  }}
                  className="mt-1 w-full rounded-lg border border-line bg-white p-2 text-sm"
                />
              </label>
            ))}
          </div>
          <label className="block text-xs text-ink/65">
            Barnpriset gäller
            <select
              value={childPriceBasis}
              onChange={(event) => {
                setChildPriceBasis(event.target.value as "per_night" | "per_booking");
                setSaved(false);
              }}
              className="mt-1 w-full rounded-lg border border-line bg-white p-2 text-sm"
            >
              <option value="per_night">Per barn och natt</option>
              <option value="per_booking">Per barn och vistelse (en gång)</option>
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              {
                label:
                  childPriceBasis === "per_booking"
                    ? "Barnpris · kr/barn/vistelse"
                    : "Barnpris · kr/barn/natt",
                value: childPriceBasis === "per_booking" ? childPricePerBooking : childPrice,
                set: childPriceBasis === "per_booking" ? setChildPricePerBooking : setChildPrice,
                max: 1000000,
              },
              { label: "Gratis till och med ålder", value: freeAge, set: setFreeAge, max: 17 },
              { label: "Barn till och med ålder", value: maxAge, set: setMaxAge, max: 17 },
            ].map((f) => (
              <label key={f.label} className="text-xs text-ink/65">
                {f.label}
                <input
                  type="number"
                  min="0"
                  max={f.max}
                  step="1"
                  value={f.value}
                  onChange={(e) => {
                    f.set(e.target.value);
                    setSaved(false);
                  }}
                  className="mt-1 w-full rounded-lg border border-line bg-white p-2 text-sm"
                />
              </label>
            ))}
          </div>
          <p className="text-xs text-ink/60">
            Månadsfaktor och helgpåslag gäller vuxenpriset. Datumregler kan ange en egen
            vuxenpristabell.{" "}
            {childPriceBasis === "per_booking"
              ? "Barnpriset läggs till en gång per vistelse för varje betalande barn."
              : "Barnpriset läggs till för varje natt och betalande barn."}{" "}
            Manuella barntillval kan inte läggas till när personpriser används.
          </p>
        </>
      ) : null}
      <button
        type="button"
        disabled={busy}
        onClick={() => void save()}
        className="rounded-lg bg-forest px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
      >
        {busy ? "Sparar…" : "Spara personpriser"}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="text-xs text-forest">
          Personpriser sparade.
        </p>
      ) : null}
    </div>
  );
}

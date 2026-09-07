import { useState } from "react";
import { supabase, type Property } from "@/lib/supabase";

export function BookingSettings({
  property,
  onSaved,
}: {
  property: Property;
  onSaved: () => void;
}) {
  const [enabled, setEnabled] = useState(property.booking_enabled ?? true);
  const [maxStay, setMaxStay] = useState(property.max_stay ?? 30);
  const [email, setEmail] = useState(property.contact_email ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!supabase || busy) return;
    if (!Number.isInteger(maxStay) || maxStay < 1 || maxStay > 30) {
      setError(true);
      setMessage("Välj 1–30 nätter.");
      return;
    }
    setBusy(true);
    setMessage("");
    const { data, error: failure } = await supabase
      .from("properties")
      .update({ booking_enabled: enabled, max_stay: maxStay, contact_email: email.trim() || null })
      .eq("id", property.id)
      .select("id")
      .single();
    setBusy(false);
    setError(Boolean(failure || !data));
    setMessage(
      failure || !data
        ? "Inställningarna kunde inte sparas. Försök igen."
        : "Bokningsinställningarna är sparade.",
    );
    if (!failure && data) onSaved();
  };
  return (
    <form onSubmit={save} className="card-surface mt-6 space-y-4 p-6">
      <h2 className="font-semibold">Bokningsinställningar</h2>
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="mt-1"
        />
        <span>
          <strong>Ta emot nya direktbokningar</strong>
          <span className="mt-1 block text-[color:var(--ink)]/60">
            Pausa bokningsformuläret vid säsongsbyte eller underhåll. Befintliga bokningar och
            gästsidor finns kvar.
          </span>
        </span>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm">
          Längsta vistelse (nätter)
          <input
            type="number"
            required
            min={1}
            max={30}
            step={1}
            value={maxStay}
            onChange={(e) => setMaxStay(Number(e.target.value))}
            className="inp mt-1"
          />
        </label>
        <label className="text-sm">
          Kontaktadress för gäster
          <input
            type="email"
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="inp mt-1"
          />
        </label>
      </div>
      <p className="text-xs text-[color:var(--ink)]/60">
        Kontots ägaradress ändras inte här. Datum som ska vara stängda för enskilda boenden hanteras
        under Pris & regler.
      </p>
      {message && (
        <p
          role={error ? "alert" : "status"}
          className={`text-sm ${error ? "text-red-700" : "text-green-800"}`}
        >
          {message}
        </p>
      )}
      <button disabled={busy} className="btn-primary !py-2.5 disabled:opacity-50">
        {busy ? "Sparar…" : "Spara bokningsinställningar"}
      </button>
    </form>
  );
}

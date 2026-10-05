import { useEffect, useState } from "react";
import { supabase, type Booking } from "@/lib/supabase";
import { propertyDay, propertyMidnight } from "@/lib/property-dates";
import { isSirvoyCalendarBooking } from "@/lib/sirvoy-calendar";
export function ImportedPaymentPanel({
  booking,
  onChanged,
}: {
  booking: Booking;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(booking.payment_amount ?? 0);
  const [day, setDay] = useState(
    booking.payment_status === "refund_pending"
      ? propertyDay()
      : propertyDay(new Date(booking.created_at)),
  );
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<
    Array<{
      id: string;
      action: string;
      amount_sek: number;
      occurred_at: string;
      evidence: string;
      created_at: string;
    }>
  >([]);
  const [historyError, setHistoryError] = useState("");
  const sourceCalendar = isSirvoyCalendarBooking(booking);
  const imported = !sourceCalendar && (booking.external_id?.startsWith("sirvoy-csv:") ?? false);
  useEffect(() => {
    if (!imported || !supabase) return;
    let active = true;
    void supabase
      .from("imported_payment_events")
      .select("id,action,amount_sek,occurred_at,evidence,created_at")
      .eq("booking_id", booking.id)
      .order("created_at")
      .then(({ data, error: issue }) => {
        if (!active) return;
        setHistoryError(issue ? "Avstämningsloggen kunde inte hämtas. Läs in bokningen igen." : "");
        setHistory(data ?? []);
      });
    return () => {
      active = false;
    };
  }, [imported, booking.id, booking.payment_status]);
  if (!imported) return null;
  const payment = booking.payment_status === "none";
  const refund =
    booking.status === "cancelled" &&
    booking.payment_status === "refund_pending" &&
    booking.payment_method === "none";
  const labels: Record<string, string> = {
    invalid_import_payment_state:
      "Betalningen måste ha mottagits före importen. Kontrollera datumet och bokningens senaste status.",
    invalid_import_refund_state:
      "Bokningen ska vara avbokad och återbetalningen ska ha genomförts innan den registreras här.",
    payment_amount_mismatch:
      "Beloppet ska stämma med hela det importerade bokningsvärdet. Delbetalningar hanteras inte här.",
    payment_already_recorded:
      "Betalningen har redan registrerats. Läs in bokningen igen och kontrollera avstämningen.",
    invalid_payment_evidence:
      "Ange ett giltigt datum, helt bokningsbelopp och en referens eller avstämningsanteckning.",
    imported_payment_required:
      "Registrera och stäm först av den tidigare betalningen innan gästmeddelanden aktiveras.",
  };
  const reconcile = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!supabase || busy || sourceCalendar) return;
    setBusy(true);
    setError("");
    try {
      const result = await supabase.functions.invoke("booking-reconcile", {
        body: {
          bookingId: booking.id,
          action: payment ? "record_payment" : "record_refund",
          amount,
          occurredAt: propertyMidnight(day),
          evidence: evidence.trim(),
        },
      });
      let issue = result.data?.error as string | undefined;
      if (result.error) {
        const response = (result.error as { context?: Response }).context;
        const payload = response?.json ? await response.json().catch(() => null) : null;
        issue = payload?.error ?? result.error.message;
      }
      if (issue)
        throw new Error(
          labels[issue] ?? "Avstämningen kunde inte sparas. Läs in bokningen och försök igen.",
        );
      setOpen(false);
      onChanged();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Avstämningen kunde inte sparas.");
    } finally {
      setBusy(false);
    }
  };
  const enableMessages = async () => {
    if (!supabase || busy || sourceCalendar) return;
    setBusy(true);
    setError("");
    try {
      const result = await supabase
        .from("bookings")
        .update({ communications_enabled: true })
        .eq("id", booking.id)
        .select("id")
        .single();
      if (result.error)
        throw new Error(
          result.error.message.includes("imported_payment_required")
            ? labels.imported_payment_required
            : "Gästmeddelandena kunde inte aktiveras. Försök igen.",
        );
      onChanged();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Gästmeddelandena kunde inte aktiveras.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
      <h3 className="font-semibold text-sm">Sirvoy-import · betalning och gästmeddelanden</h3>
      <p className="text-xs text-amber-950/70">
        Importerat bokningsvärde är ett underlag. Registrera först när hela betalningen är avstämd
        mot tidigare betalningsreferens. Ingen ny debitering eller återbetalning görs av den här
        registreringen.
      </p>
      {(payment || refund) && (
        <button
          disabled={busy}
          onClick={() => setOpen((value) => !value)}
          className="rounded-lg border bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40"
        >
          {refund ? "Registrera genomförd återbetalning" : "Betalning mottagen före flytten"}
        </button>
      )}
      {open && (payment || refund) && (
        <form onSubmit={reconcile} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              {refund ? "Återbetalat belopp" : "Mottaget bokningsbelopp"} (kr)
              <input
                className="inp mt-1"
                type="number"
                min={1}
                max={10000000}
                step={1}
                required
                value={amount}
                readOnly={booking.payment_amount != null}
                onChange={(event) => setAmount(Number(event.target.value))}
              />
            </label>
            <label className="text-sm">
              {refund ? "Datum för återbetalning" : "Datum för mottagen betalning"}
              <input
                className="inp mt-1"
                type="date"
                required
                max={refund ? propertyDay() : propertyDay(new Date(booking.created_at))}
                value={day}
                onChange={(event) => setDay(event.target.value)}
              />
            </label>
          </div>
          <label className="block text-sm">
            Referens eller avstämningsanteckning
            <textarea
              className="inp mt-1"
              minLength={3}
              maxLength={1000}
              required
              rows={2}
              value={evidence}
              onChange={(event) => setEvidence(event.target.value)}
              placeholder="Till exempel betalningsreferens och var betalningen stämts av"
            />
          </label>
          <p className="text-xs">
            {refund
              ? "Bekräfta endast en återbetalning som redan har genomförts utanför StayBoost."
              : "Bekräfta endast en betalning som redan mottogs före importen."}{" "}
            Belopp, datum, anteckning och vem som registrerar sparas i avstämningsloggen.
          </p>
          <button
            disabled={busy}
            className="rounded-lg bg-[#173c2b] px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {busy
              ? "Sparar…"
              : refund
                ? "Återbetalningen är genomförd"
                : "Registrera tidigare mottagen betalning"}
          </button>
        </form>
      )}
      {booking.status === "confirmed" && booking.communications_enabled === false && (
        <div className="border-t border-amber-200 pt-3">
          <p className="text-xs">
            Automatiska meddelanden är pausade efter importen. Aktivering schemalägger kommande
            ankomst-, inchecknings- och eftervistelsemeddelanden. En ny bokningsbekräftelse skickas
            inte.
          </p>
          {booking.payment_status !== "paid" && (
            <p className="mt-2 text-xs font-semibold">
              Registrera och stäm först av den tidigare betalningen. Gästmeddelanden kan aktiveras
              när bokningen är betald.
            </p>
          )}
          <button
            disabled={busy || booking.payment_status !== "paid"}
            onClick={() => void enableMessages()}
            className="mt-2 rounded-lg border bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40"
          >
            Aktivera kommande gästmeddelanden
          </button>
        </div>
      )}
      {booking.communications_enabled === true && (
        <p className="text-xs font-semibold text-emerald-900">
          Kommande gästmeddelanden är aktiverade.
        </p>
      )}
      {history.length > 0 && (
        <details className="border-t border-amber-200 pt-3">
          <summary className="cursor-pointer text-sm font-semibold">
            Avstämningslogg ({history.length})
          </summary>
          <ul className="mt-2 space-y-2 text-xs">
            {history.map((entry) => (
              <li key={entry.id} className="rounded-lg bg-white p-3">
                <p className="font-semibold">
                  {entry.action === "record_payment"
                    ? "Tidigare betalning mottagen"
                    : "Återbetalning genomförd"}{" "}
                  · {entry.amount_sek.toLocaleString("sv-SE")} kr ·{" "}
                  {propertyDay(new Date(entry.occurred_at))}
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words">{entry.evidence}</p>
                <p className="mt-1 text-muted-foreground">
                  Registrerad{" "}
                  {new Date(entry.created_at).toLocaleString("sv-SE", {
                    timeZone: "Europe/Stockholm",
                  })}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}
      {historyError && (
        <p role="alert" className="text-sm text-red-700">
          {historyError}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}

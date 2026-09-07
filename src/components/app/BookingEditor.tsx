import { useState } from "react";
import { supabase, type Booking, type Unit } from "@/lib/supabase";
import {
  bookingAdminError,
  STAY_STATUS,
  validateBookingDraft,
  type BookingDraft,
  type StayStatus,
} from "@/lib/booking-admin";

export function BookingEditor({
  booking,
  units,
  maxStay,
  onSaved,
  onClose,
}: {
  booking: Booking;
  units: Unit[];
  maxStay: number;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<BookingDraft>({
    unit_id: booking.unit_id ?? "",
    guest_name: booking.guest_name ?? "",
    guest_email: booking.guest_email ?? "",
    guest_phone: booking.guest_phone ?? "",
    checkin_date: booking.checkin_date,
    checkout_date: booking.checkout_date,
    guests: booking.guests ?? 1,
    internal_notes: booking.internal_notes ?? "",
    stay_status: booking.stay_status ?? "expected",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const external = booking.source === "ical" || booking.source === "sirvoy";
  const locked =
    external ||
    ["pending", "refund_pending"].includes(booking.payment_status) ||
    booking.status === "cancelled";
  const set = <K extends keyof BookingDraft>(key: K, value: BookingDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const changedStay =
    draft.unit_id !== booking.unit_id ||
    draft.checkin_date !== booking.checkin_date ||
    draft.checkout_date !== booking.checkout_date ||
    draft.guests !== booking.guests;
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!supabase || busy) return;
    const issue = validateBookingDraft(
      draft,
      units.find((unit) => unit.id === draft.unit_id),
      maxStay,
      !locked,
    );
    if (issue) {
      setError(issue);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const { error: failure } = await supabase.rpc("admin_update_booking", {
        p_booking_id: booking.id,
        p_expected_updated_at: booking.updated_at,
        p_unit_id: locked ? booking.unit_id : draft.unit_id,
        p_checkin: draft.checkin_date,
        p_checkout: draft.checkout_date,
        p_guest_name: draft.guest_name.trim(),
        p_guest_email: draft.guest_email.trim() || null,
        p_guest_phone: draft.guest_phone.trim() || null,
        p_guests: locked ? booking.guests : draft.guests,
        p_internal_notes: draft.internal_notes.trim() || null,
        p_stay_status: draft.stay_status,
      });
      if (failure) setError(bookingAdminError(failure));
      else onSaved();
    } catch {
      setError("Ingen kontakt med servern. Kontrollera bokningen innan du försöker igen.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      onSubmit={save}
      className="rounded-2xl border border-[color:var(--line)] bg-white p-5 space-y-4"
    >
      <div>
        <h3 className="font-semibold text-lg">Ändra bokning</h3>
        <p className="text-sm text-[color:var(--ink)]/60">
          Ändringarna sparas tillsammans när du väljer Spara ändringar.
        </p>
      </div>
      {locked && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          {external
            ? "Datum och boende hanteras i ursprungskanalen. Kontaktuppgifter och interna anteckningar kan ändras här."
            : "Vistelsen kan ändras när bokningen är aktiv och pågående betalning eller återbetalning är avslutad."}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          Gästens namn
          <input
            required
            minLength={2}
            maxLength={120}
            value={draft.guest_name}
            onChange={(e) => set("guest_name", e.target.value)}
            className="inp mt-1"
          />
        </label>
        <label className="text-sm">
          Boende
          <select
            disabled={locked}
            value={draft.unit_id}
            onChange={(e) => set("unit_id", e.target.value)}
            className="inp mt-1 disabled:opacity-60"
          >
            {units
              .filter((u) => u.active || u.id === booking.unit_id)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · max {u.max_guests}
                </option>
              ))}
          </select>
        </label>
        <label className="text-sm">
          Ankomst
          <input
            type="date"
            required
            disabled={locked}
            value={draft.checkin_date}
            onChange={(e) => set("checkin_date", e.target.value)}
            className="inp mt-1"
          />
        </label>
        <label className="text-sm">
          Avresa
          <input
            type="date"
            required
            disabled={locked}
            value={draft.checkout_date}
            onChange={(e) => set("checkout_date", e.target.value)}
            className="inp mt-1"
          />
        </label>
        <label className="text-sm">
          E-post
          <input
            type="email"
            maxLength={254}
            value={draft.guest_email}
            onChange={(e) => set("guest_email", e.target.value)}
            className="inp mt-1"
          />
        </label>
        <label className="text-sm">
          Telefon
          <input
            type="tel"
            maxLength={40}
            value={draft.guest_phone}
            onChange={(e) => set("guest_phone", e.target.value)}
            className="inp mt-1"
          />
        </label>
        <label className="text-sm">
          Antal gäster
          <input
            type="number"
            required
            min={1}
            max={units.find((u) => u.id === draft.unit_id)?.max_guests ?? 20}
            step={1}
            disabled={locked}
            value={draft.guests}
            onChange={(e) => set("guests", Number(e.target.value))}
            className="inp mt-1"
          />
        </label>
        <label className="text-sm">
          Ankomststatus
          <select
            disabled={booking.status === "cancelled"}
            value={draft.stay_status}
            onChange={(e) => set("stay_status", e.target.value as StayStatus)}
            className="inp mt-1"
          >
            {Object.entries(STAY_STATUS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block text-sm">
        Interna anteckningar
        <textarea
          rows={4}
          maxLength={10000}
          value={draft.internal_notes}
          onChange={(e) => set("internal_notes", e.target.value)}
          className="inp mt-1"
        />
        <span className="text-xs text-[color:var(--ink)]/60">Visas endast i administrationen.</span>
      </label>
      {changedStay && !locked && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          Bokningens befintliga belopp behålls. En ändrad vistelse debiterar eller återbetalar inte
          automatiskt någon prisskillnad. Väntande gästmeddelanden anpassas till nya datum.
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button disabled={busy} className="btn-primary !py-2.5 disabled:opacity-50">
          {busy ? "Sparar…" : "Spara ändringar"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onClose}
          className="rounded-xl border px-4 py-2.5"
        >
          Avbryt
        </button>
      </div>
    </form>
  );
}

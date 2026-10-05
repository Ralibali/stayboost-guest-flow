import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  channelLabels,
  manualMessageSchema,
  statusLabels,
  type InboxBooking,
  type InboxMessage,
  type InboxStatus,
} from "@/lib/inbox";

const inputClass = "mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm";

export function ManualInboxMessage({
  propertyId,
  onSaved,
}: {
  propertyId: string;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <section className="rounded-2xl border border-black/10 bg-white p-4">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="font-semibold text-sm text-[#2d684c]"
      >
        {open ? "Stäng formuläret" : "+ Registrera externt meddelande"}
      </button>
      <p className="mt-2 text-xs text-black/55">
        Webbchatten kommer in automatiskt. E-post, SMS och WhatsApp registreras manuellt här. Svar
        skickas i respektive app.
      </p>
      {open && (
        <form
          className="mt-4 grid gap-3 sm:grid-cols-2"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!supabase || busy) return;
            const form = event.currentTarget;
            const parsed = manualMessageSchema.safeParse(Object.fromEntries(new FormData(form)));
            if (!parsed.success) {
              setError(parsed.error.issues[0].message);
              return;
            }
            setBusy(true);
            setError("");
            const { error: saveError } = await supabase
              .from("chat_messages")
              .insert({ ...parsed.data, property_id: propertyId, logged_manually: true });
            setBusy(false);
            if (saveError) {
              setError("Meddelandet kunde inte sparas. Försök igen.");
              return;
            }
            form.reset();
            setOpen(false);
            onSaved();
          }}
        >
          <label className="text-xs">
            Kanal
            <select name="channel" className={inputClass}>
              <option value="email">E-post</option>
              <option value="sms">SMS</option>
              <option value="whatsapp">WhatsApp</option>
            </select>
          </label>
          <label className="text-xs">
            Gästens namn
            <input name="visitor_name" maxLength={120} required className={inputClass} />
          </label>
          <label className="text-xs">
            E-post
            <input name="visitor_email" type="email" maxLength={254} className={inputClass} />
          </label>
          <label className="text-xs">
            Telefon (med landskod för WhatsApp)
            <input
              name="visitor_phone"
              type="tel"
              maxLength={30}
              placeholder="+46…"
              className={inputClass}
            />
          </label>
          <label className="text-xs sm:col-span-2">
            Inkommet meddelande
            <textarea name="message" maxLength={4000} required rows={3} className={inputClass} />
          </label>
          {error && (
            <p role="alert" className="text-sm text-red-700 sm:col-span-2">
              {error}
            </p>
          )}
          <button
            disabled={busy}
            className="rounded-lg bg-[#173c2b] px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {busy ? "Sparar…" : "Spara i inkorgen"}
          </button>
        </form>
      )}
    </section>
  );
}

export function InboxWorkflow({
  message,
  bookings,
  onSaved,
}: {
  message: InboxMessage;
  bookings: InboxBooking[];
  onSaved: () => void;
}) {
  const [status, setStatus] = useState(message.inbox_status);
  const [assigned, setAssigned] = useState(message.assigned_to);
  const [due, setDue] = useState(message.followup_date ?? "");
  const [note, setNote] = useState(message.internal_note);
  const [bookingId, setBookingId] = useState(message.booking_id ?? "");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [history, setHistory] = useState<
    {
      id: string;
      channel: "email" | "sms";
      status: string;
      send_at: string;
      sent_at: string | null;
    }[]
  >([]);
  const [historyError, setHistoryError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const booking = bookings.find((item) => item.id === message.booking_id);
  useEffect(() => {
    let active = true;
    setHistory([]);
    setHistoryError("");
    if (expanded && message.booking_id && supabase) {
      void supabase
        .from("scheduled_messages")
        .select("id,channel,status,send_at,sent_at")
        .eq("booking_id", message.booking_id)
        .order("send_at", { ascending: false })
        .limit(30)
        .then(({ data, error }) => {
          if (!active) return;
          if (error) setHistoryError("Utskickshistoriken kunde inte hämtas.");
          else setHistory(data ?? []);
        });
    }
    return () => {
      active = false;
    };
  }, [expanded, message.booking_id]);
  return (
    <details
      className="mt-4 rounded-xl border border-black/10 p-3"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className="cursor-pointer text-sm font-semibold">
        {statusLabels[message.inbox_status]}
        {message.assigned_to ? ` · ${message.assigned_to}` : " · Saknar ansvarig"}
        {message.followup_date ? ` · Följ upp ${message.followup_date}` : ""}
      </summary>
      {booking && (
        <p className="mt-3 text-sm">
          Bokning: {booking.guest_name || "Gäst"} · {booking.checkin_date}–{booking.checkout_date}
          {booking.status === "cancelled" ? " · Avbokad" : ""}
        </p>
      )}
      <form
        className="mt-4 grid gap-3 sm:grid-cols-2"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!supabase || busy) return;
          setBusy(true);
          setFeedback("");
          const { data, error } = await supabase
            .from("chat_messages")
            .update({
              inbox_status: status,
              assigned_to: assigned.trim(),
              followup_date: due || null,
              internal_note: note.trim(),
              booking_id: bookingId || null,
            })
            .eq("id", message.id)
            .eq("property_id", message.property_id)
            .eq("inbox_version", message.inbox_version)
            .select("id")
            .maybeSingle();
          setBusy(false);
          if (error) {
            setFeedback("Kunde inte spara. Försök igen.");
            return;
          }
          if (!data) {
            setFeedback("Ärendet har ändrats. Uppdatera inkorgen innan du sparar igen.");
            return;
          }
          setFeedback("Sparat");
          onSaved();
        }}
      >
        <label className="text-xs">
          Status
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as InboxStatus)}
            className={inputClass}
          >
            {Object.entries(statusLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          Ansvarig (namn)
          <input
            value={assigned}
            onChange={(e) => setAssigned(e.target.value)}
            maxLength={120}
            className={inputClass}
          />
        </label>
        <label className="text-xs">
          Följ upp
          <input
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="text-xs">
          Koppla bokning
          <select
            value={bookingId}
            onChange={(e) => setBookingId(e.target.value)}
            className={inputClass}
          >
            <option value="">Ingen koppling</option>
            {bookings.map((item) => (
              <option key={item.id} value={item.id}>
                {item.guest_name || item.guest_email || "Gäst"} · {item.checkin_date}–
                {item.checkout_date}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs sm:col-span-2">
          Intern anteckning
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={4000}
            rows={2}
            className={inputClass}
          />
        </label>
        <p className="text-xs text-black/50 sm:col-span-2">
          Ansvarigs namn och anteckningen är interna. Gäster ser dem inte. Ett namn ger ingen
          kontoåtkomst.
        </p>
        <button
          disabled={busy}
          className="rounded-lg bg-[#173c2b] px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {busy ? "Sparar…" : "Spara hantering"}
        </button>
        {feedback && (
          <p role="status" className="text-sm">
            {feedback}
          </p>
        )}
      </form>
      {message.booking_id && (
        <div className="mt-4 border-t pt-3">
          <h3 className="text-sm font-semibold">Bokningens automatiska utskick</h3>
          <p className="mt-1 text-xs text-black/50">
            Visar de 30 senaste planerade utskicken. Skickat betyder accepterat av leverantören.
          </p>
          {historyError ? (
            <p role="alert" className="text-xs text-red-700">
              {historyError}
            </p>
          ) : history.length === 0 ? (
            <p className="mt-2 text-xs">Inga utskick att visa.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-xs">
              {history.map((item) => (
                <li key={item.id}>
                  {channelLabels[item.channel]} ·{" "}
                  {(
                    {
                      pending: "Planerat",
                      sent: "Skickat",
                      failed: "Misslyckat",
                      cancelled: "Avbrutet",
                      sending: "Pågår",
                    } as Record<string, string>
                  )[item.status] ?? item.status}{" "}
                  · {new Date(item.sent_at ?? item.send_at).toLocaleString("sv-SE")}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </details>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Ban,
  CalendarPlus,
  Check,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  Mail,
  RotateCcw,
  Search,
  Smartphone,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  guestPageUrl,
  supabase,
  useProperty,
  useSession,
  TRIGGER_LABELS,
  type Booking,
  type ScheduledMessage,
  type Unit,
} from "@/lib/supabase";
import {
  bookingsToCsv,
  csvFilename,
  emptyFilters,
  filterBookings,
  type BookingFilters,
} from "@/lib/booking-filters";

export const Route = createFileRoute("/app/bokningar")({
  component: BookingsPage,
});

const svDate = (iso: string) =>
  new Date(iso + "T12:00:00").toLocaleDateString("sv-SE", { day: "numeric", month: "short" });

function overlaps(a: Booking, b: Booking) {
  return Boolean(
    a.unit_id &&
      a.unit_id === b.unit_id &&
      a.status === "confirmed" &&
      b.status === "confirmed" &&
      a.checkin_date < b.checkout_date &&
      a.checkout_date > b.checkin_date,
  );
}

function BookingsPage() {
  const session = useSession();
  const { property, units } = useProperty(session);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<BookingFilters>(emptyFilters);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  const updateFilter = <K extends keyof BookingFilters>(k: K, v: BookingFilters[K]) =>
    setFilters((f) => ({ ...f, [k]: v }));
  const activeFilterCount =
    (filters.search ? 1 : 0) +
    (filters.unitId !== "alla" ? 1 : 0) +
    (filters.status !== "all" ? 1 : 0) +
    (filters.source !== "all" ? 1 : 0) +
    (filters.payment !== "all" ? 1 : 0) +
    (filters.from ? 1 : 0) +
    (filters.to ? 1 : 0);

  const load = useCallback(async () => {
    if (!supabase || !property) return;
    setLoading(true);
    setPageError(null);
    const { data, error } = await supabase
      .from("bookings")
      .select("*, unit:units(name,max_guests)")
      .eq("property_id", property.id)
      .order("checkin_date", { ascending: true });
    if (error) setPageError(error.message);
    setBookings((data as Booking[]) ?? []);
    setLoading(false);
  }, [property]);

  useEffect(() => {
    load();
  }, [load]);

  const today = new Date().toISOString().slice(0, 10);
  const filtered = useMemo(() => filterBookings(bookings, filters), [bookings, filters]);
  const upcoming = useMemo(
    () => filtered.filter((b) => b.status === "confirmed" && b.checkout_date >= today),
    [filtered, today],
  );
  const past = useMemo(
    () => filtered.filter((b) => !(b.status === "confirmed" && b.checkout_date >= today)).slice(-40).reverse(),
    [filtered, today],
  );

  const exportCsv = () => {
    const csv = "\ufeff" + bookingsToCsv(filtered); // BOM för Excel
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = csvFilename();
    a.click();
    URL.revokeObjectURL(url);
  };


  const conflictIds = useMemo(() => {
    const ids = new Set<string>();
    const confirmed = bookings.filter((b) => b.status === "confirmed");
    for (let i = 0; i < confirmed.length; i++) {
      for (let j = i + 1; j < confirmed.length; j++) {
        if (overlaps(confirmed[i], confirmed[j])) {
          ids.add(confirmed[i].id);
          ids.add(confirmed[j].id);
        }
      }
    }
    return ids;
  }, [bookings]);

  const cancel = async (booking: Booking) => {
    if (!supabase) return;
    if (!window.confirm(`Avboka ${booking.guest_name ?? "bokningen"} ${svDate(booking.checkin_date)}–${svDate(booking.checkout_date)}?`)) return;
    const { error } = await supabase.from("bookings").update({ status: "cancelled" }).eq("id", booking.id);
    if (error) setPageError(error.message);
    else load();
  };

  const copyLink = (booking: Booking) => {
    navigator.clipboard.writeText(guestPageUrl(booking.guest_token));
    setCopied(booking.id);
    setTimeout(() => setCopied(null), 1500);
  };

  if (!property) return null;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Drift</p>
          <h1 className="mt-2 font-[Fraunces] text-3xl font-semibold">Bokningar</h1>
          <p className="text-[13px] text-[color:var(--ink)]/55">
            {upcoming.length} kommande · {upcoming.filter((b) => !b.guest_email).length} saknar e-post
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="btn-ghost !rounded-xl !px-3.5 !py-2.5 text-[13px] disabled:opacity-40"
            title="Ladda ner filtrerade bokningar som CSV"
          >
            <Download size={14} /> CSV ({filtered.length})
          </button>
          <button onClick={() => setModalOpen(true)} className="btn-primary !rounded-xl !px-4 !py-2.5 text-[13px]">
            <CalendarPlus size={15} /> Ny bokning
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-2.5 sm:grid-cols-[minmax(200px,1fr)_auto_auto_auto_auto_auto_auto]">
        <label className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--ink)]/40" />
          <input
            value={filters.search}
            onChange={(e) => updateFilter("search", e.target.value)}
            placeholder="Sök namn, e-post eller mobil"
            className="inp !pl-9"
            aria-label="Sök i bokningar"
          />
        </label>
        <select value={filters.unitId} onChange={(e) => updateFilter("unitId", e.target.value)} className="inp !w-auto" aria-label="Filtrera på boende">
          <option value="alla">Alla boenden</option>
          {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select value={filters.status} onChange={(e) => updateFilter("status", e.target.value as BookingFilters["status"])} className="inp !w-auto" aria-label="Filtrera på status">
          <option value="all">Alla statusar</option>
          <option value="confirmed">Bekräftade</option>
          <option value="cancelled">Avbokade</option>
        </select>
        <select value={filters.source} onChange={(e) => updateFilter("source", e.target.value as BookingFilters["source"])} className="inp !w-auto" aria-label="Filtrera på källa">
          <option value="all">Alla källor</option>
          <option value="direct">Direkt</option>
          <option value="sirvoy">Sirvoy</option>
          <option value="ical">iCal</option>
          <option value="manual">Manuell</option>
        </select>
        <select value={filters.payment} onChange={(e) => updateFilter("payment", e.target.value as BookingFilters["payment"])} className="inp !w-auto" aria-label="Filtrera på betalning">
          <option value="all">Alla betalstatusar</option>
          <option value="none">Ingen betalning</option>
          <option value="pending">Väntar</option>
          <option value="paid">Betald</option>
          <option value="refunded">Återbetald</option>
        </select>
        <input type="date" value={filters.from} onChange={(e) => updateFilter("from", e.target.value)} className="inp !w-auto" aria-label="Från datum" />
        <input type="date" value={filters.to} onChange={(e) => updateFilter("to", e.target.value)} className="inp !w-auto" aria-label="Till datum" />
      </div>
      {activeFilterCount > 0 && (
        <button
          onClick={() => setFilters(emptyFilters)}
          className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-medium text-[color:var(--ink)]/55 hover:text-[color:var(--ink)]"
        >
          <RotateCcw size={12} /> Rensa {activeFilterCount} filter
        </button>
      )}

      {pageError && <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-[13px] text-red-700">{pageError}</p>}

      {conflictIds.size > 0 && (
        <div className="mt-5 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">
          <AlertTriangle size={17} className="mt-0.5 shrink-0" />
          <span><strong>{conflictIds.size} bokningar krockar.</strong> Detta kan komma från kanalimporter. Kontrollera dem direkt och avboka eller flytta den felaktiga bokningen.</span>
        </div>
      )}

      {loading ? (
        <p className="mt-10 text-center text-[14px] text-[color:var(--ink)]/45">Laddar…</p>
      ) : upcoming.length === 0 ? (
        <div className="card-surface mt-6 p-10 text-center">
          <p className="text-[15px] text-[color:var(--ink)]/60">Inga kommande bokningar ännu.</p>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {upcoming.map((booking) => (
            <BookingCard
              key={booking.id}
              booking={booking}
              conflicting={conflictIds.has(booking.id)}
              expanded={expanded === booking.id}
              onToggle={() => setExpanded(expanded === booking.id ? null : booking.id)}
              onCancel={() => cancel(booking)}
              onCopy={() => copyLink(booking)}
              copied={copied === booking.id}
              onChanged={load}
              onError={setPageError}
            />
          ))}
        </div>
      )}

      {past.length > 0 && (
        <details className="mt-8">
          <summary className="cursor-pointer text-[13px] font-medium text-[color:var(--ink)]/50">Tidigare och avbokade ({past.length})</summary>
          <div className="mt-3 space-y-2 opacity-75">
            {past.map((booking) => (
              <div key={booking.id} className="card-surface flex items-center gap-3 !rounded-2xl px-4 py-3 text-[13px]">
                <span className="font-semibold">{booking.guest_name ?? "Okänd gäst"}</span>
                <span className="text-[color:var(--ink)]/55">{booking.unit?.name ?? "—"} · {svDate(booking.checkin_date)}–{svDate(booking.checkout_date)}</span>
                <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold ${booking.status === "cancelled" ? "bg-red-50 text-red-700" : "bg-[color:var(--bg)]"}`}>
                  {booking.status === "cancelled" ? "Avbokad" : "Utcheckad"}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}

      {modalOpen && (
        <ManualBookingModal
          propertyId={property.id}
          units={units.filter((u) => u.active)}
          onClose={() => setModalOpen(false)}
          onCreated={() => {
            setModalOpen(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function BookingCard({
  booking: b,
  conflicting,
  expanded,
  onToggle,
  onCancel,
  onCopy,
  copied,
  onChanged,
  onError,
}: {
  booking: Booking;
  conflicting: boolean;
  expanded: boolean;
  onToggle: () => void;
  onCancel: () => void;
  onCopy: () => void;
  copied: boolean;
  onChanged: () => void;
  onError: (message: string | null) => void;
}) {
  const [messages, setMessages] = useState<ScheduledMessage[] | null>(null);
  const [email, setEmail] = useState(b.guest_email ?? "");
  const [phone, setPhone] = useState(b.guest_phone ?? "");
  const [guestCount, setGuestCount] = useState(b.guests ?? 1);
  const [saved, setSaved] = useState(false);
  const maxGuests = b.unit?.max_guests ?? 20;

  useEffect(() => {
    if (!expanded || !supabase) return;
    supabase
      .from("scheduled_messages")
      .select("id, booking_id, channel, send_at, status, error, template:message_templates(trigger_type)")
      .eq("booking_id", b.id)
      .order("send_at")
      .then(({ data }) => setMessages((data as unknown as ScheduledMessage[]) ?? []));
  }, [expanded, b.id]);

  const saveDetails = async () => {
    if (!supabase) return;
    onError(null);
    const guests = Math.min(maxGuests, Math.max(1, Math.round(guestCount)));
    const { error } = await supabase
      .from("bookings")
      .update({ guest_email: email.trim() || null, guest_phone: phone.trim() || null, guests })
      .eq("id", b.id);
    if (error) {
      onError(error.message);
      return;
    }
    setGuestCount(guests);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    onChanged();
  };

  return (
    <div className={`card-surface overflow-hidden ${conflicting ? "ring-2 ring-red-400" : ""}`}>
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-5 py-4 text-left">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-[13px] font-bold text-white ${conflicting ? "bg-red-600" : "bg-[color:var(--forest)]"}`}>
          {(b.guest_name ?? "?").split(" ").map((n) => n[0]).slice(0, 2).join("")}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold">{b.guest_name ?? "Okänd gäst"}</span>
            <SourceBadge source={b.source} />
            {b.payment_status === "pending" && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Betalning väntar</span>}
            {b.payment_status === "paid" && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">Betald</span>}
            {conflicting && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-800">Krock</span>}
          </div>
          <div className="text-[13px] text-[color:var(--ink)]/55">
            {b.unit?.name ?? "Ingen enhet"} · {svDate(b.checkin_date)}–{svDate(b.checkout_date)} · {b.guests ?? "?"} gäster
          </div>
        </div>
        <ChevronDown size={17} className={`shrink-0 text-[color:var(--ink)]/40 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
            <div className="space-y-4 border-t border-[color:var(--line)] px-5 py-4">
              <div className="grid gap-2.5 sm:grid-cols-[1fr_1fr_110px_auto]">
                <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Gästens e-post" type="email" className="inp" />
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Gästens mobil" className="inp" />
                <label className="relative">
                  <Users size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--ink)]/40" />
                  <input type="number" min={1} max={maxGuests} value={guestCount} onChange={(e) => setGuestCount(Number(e.target.value))} className="inp !pl-8" aria-label="Antal gäster" />
                </label>
                <button onClick={saveDetails} className="btn-ghost !rounded-xl !px-4 !py-2.5 text-[13px]">{saved ? "✓ Sparat" : "Spara"}</button>
              </div>

              {b.payment_status === "pending" && b.payment_expires_at && (
                <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-[12px] text-amber-800">
                  Reservationen löper ut {new Date(b.payment_expires_at).toLocaleString("sv-SE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} om den inte markeras betald.
                </p>
              )}

              <div>
                <p className="text-[12px] font-semibold uppercase tracking-wide text-[color:var(--ink)]/50">Meddelandekö</p>
                <div className="mt-2 space-y-1.5">
                  {!messages ? (
                    <p className="text-[13px] text-[color:var(--ink)]/45">Laddar…</p>
                  ) : messages.length === 0 ? (
                    <p className="text-[13px] text-[color:var(--ink)]/45">Inga meddelanden schemalagda.</p>
                  ) : (
                    messages.map((message) => (
                      <div key={message.id} className="flex items-center gap-2.5 rounded-xl bg-[color:var(--bg)] px-3 py-2 text-[13px]">
                        {message.channel === "email" ? <Mail size={14} /> : <Smartphone size={14} />}
                        <span className="font-medium">{message.template ? TRIGGER_LABELS[message.template.trigger_type as keyof typeof TRIGGER_LABELS] ?? "Meddelande" : "Meddelande"}</span>
                        <span className="text-[color:var(--ink)]/50">{new Date(message.send_at).toLocaleString("sv-SE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                        <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold ${message.status === "sent" ? "bg-emerald-100 text-emerald-800" : message.status === "failed" ? "bg-red-50 text-red-700" : message.status === "cancelled" ? "bg-[color:var(--line)]/60 text-[color:var(--ink)]/50" : "bg-amber-100 text-amber-800"}`} title={message.error ?? undefined}>
                          {message.status === "sent" ? "Skickat" : message.status === "failed" ? "Misslyckades" : message.status === "cancelled" ? "Avbrutet" : "Väntar"}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {b.payment_status === "pending" && (
                  <button
                    onClick={async () => {
                      if (!supabase) return;
                      const { error } = await supabase.from("bookings").update({ payment_status: "paid", payment_expires_at: null }).eq("id", b.id);
                      if (error) onError(error.message);
                      else onChanged();
                    }}
                    className="rounded-xl bg-emerald-600 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-emerald-700"
                  >
                    Markera betald{b.payment_amount ? ` (${b.payment_amount.toLocaleString("sv-SE")} kr)` : ""}
                  </button>
                )}
                {b.payment_status === "paid" && (
                  <button
                    onClick={async () => {
                      if (!supabase) return;
                      const amount = b.payment_amount
                        ? ` ${b.payment_amount.toLocaleString("sv-SE")} kr`
                        : "";
                      if (!window.confirm(`Bekräfta återbetalning av${amount} till ${b.guest_name ?? "gästen"}. Kom ihåg att göra själva utbetalningen i Swish/Stripe.`)) return;
                      const { error } = await supabase
                        .from("bookings")
                        .update({ payment_status: "refunded" })
                        .eq("id", b.id);
                      if (error) onError(error.message);
                      else onChanged();
                    }}
                    className="rounded-xl border border-[color:var(--line)] px-3.5 py-2 text-[13px] font-semibold text-[color:var(--ink)]/75 hover:bg-[color:var(--bg)]"
                  >
                    <RotateCcw size={14} className="mr-1 inline" /> Markera återbetald
                  </button>
                )}
                <button onClick={onCopy} className="btn-ghost !rounded-xl !px-3.5 !py-2 text-[13px]">{copied ? <Check size={14} /> : <Copy size={14} />} Gästsidelänk</button>
                <a href={guestPageUrl(b.guest_token)} target="_blank" rel="noreferrer" className="btn-ghost !rounded-xl !px-3.5 !py-2 text-[13px]"><ExternalLink size={14} /> Öppna gästsidan</a>
                <button onClick={onCancel} className="ml-auto rounded-xl px-3.5 py-2 text-[13px] font-semibold text-red-600 hover:bg-red-50"><Ban size={14} className="mr-1 inline" /> Avboka</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SourceBadge({ source }: { source: Booking["source"] }) {
  const label = source === "ical" ? "iCal" : source === "direct" ? "Direkt" : source === "sirvoy" ? "Sirvoy" : "Manuell";
  return <span className="rounded-full bg-[color:var(--bg)] px-2 py-0.5 text-[11px] font-semibold text-[color:var(--ink)]/60">{label}</span>;
}

function ManualBookingModal({
  propertyId,
  units,
  onClose,
  onCreated,
}: {
  propertyId: string;
  units: Unit[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [unitId, setUnitId] = useState(units[0]?.id ?? "");
  const selectedUnit = units.find((u) => u.id === unitId) ?? units[0];
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [guests, setGuests] = useState(1);
  const [checkin, setCheckin] = useState("");
  const [checkout, setCheckout] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (selectedUnit) setGuests((n) => Math.min(n, selectedUnit.max_guests));
  }, [selectedUnit]);

  const valid = Boolean(unitId && name.trim().length >= 2 && checkin && checkout && checkout > checkin && guests >= 1 && guests <= (selectedUnit?.max_guests ?? 1));

  const submit = async () => {
    if (!supabase || !valid) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.from("bookings").insert({
      property_id: propertyId,
      unit_id: unitId,
      source: "manual",
      guest_name: name.trim(),
      guest_email: email.trim() || null,
      guest_phone: phone.trim() || null,
      guests,
      checkin_date: checkin,
      checkout_date: checkout,
    });
    setBusy(false);
    if (error) {
      setError(error.code === "23P01" || error.message.includes("booking_overlap") ? "Boendet är redan bokat under hela eller delar av perioden." : error.message);
    } else onCreated();
  };

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={onClose} className="fixed inset-0 z-40 bg-black/45" />
      <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-2rem)] w-[min(460px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[24px] bg-white p-6 shadow-2xl">
        <h3 className="font-[Fraunces] text-xl font-semibold">Ny manuell bokning</h3>
        <div className="mt-5 space-y-3.5">
          <label className="block"><span className="text-[12px] font-medium text-[color:var(--ink)]/55">Boende</span><select value={unitId} onChange={(e) => setUnitId(e.target.value)} className="inp mt-1">{units.map((u) => <option key={u.id} value={u.id}>{u.name} · max {u.max_guests}</option>)}</select></label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Gästens namn *" className="inp" />
          <div className="grid grid-cols-2 gap-3">
            <label><span className="text-[12px] font-medium text-[color:var(--ink)]/55">Incheckning</span><input type="date" value={checkin} onChange={(e) => setCheckin(e.target.value)} className="inp mt-1" /></label>
            <label><span className="text-[12px] font-medium text-[color:var(--ink)]/55">Utcheckning</span><input type="date" value={checkout} onChange={(e) => setCheckout(e.target.value)} className="inp mt-1" /></label>
          </div>
          <label><span className="text-[12px] font-medium text-[color:var(--ink)]/55">Antal gäster · max {selectedUnit?.max_guests ?? 1}</span><input type="number" min={1} max={selectedUnit?.max_guests ?? 1} value={guests} onChange={(e) => setGuests(Number(e.target.value))} className="inp mt-1" /></label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-post" type="email" className="inp" />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Mobil" className="inp" />
          {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-[13px] text-red-700">{error}</p>}
          <button onClick={submit} disabled={!valid || busy} className="btn-primary w-full justify-center !rounded-xl !py-3 text-[15px] disabled:opacity-40">{busy ? "Sparar…" : "Skapa bokning"}</button>
          <button onClick={onClose} className="w-full text-center text-[13px] font-medium text-[color:var(--ink)]/50">Avbryt</button>
        </div>
      </motion.div>
    </>
  );
}

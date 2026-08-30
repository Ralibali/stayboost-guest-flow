import { createFileRoute } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Ban,
  CalendarClock,
  CalendarPlus,
  Check,
  ChevronDown,
  Copy,
  CreditCard,
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
const fmtKr = (n: number) => `${Math.round(n).toLocaleString("sv-SE")} kr`;

type PaymentAction =
  | "cancel_booking"
  | "mark_swish_paid"
  | "request_swish_refund"
  | "confirm_swish_refunded";

async function invokePaymentAction(bookingId: string, action: PaymentAction) {
  if (!supabase) return { error: "Supabase är inte konfigurerat." };
  const { data, error } = await supabase.functions.invoke("payment-action", {
    body: { bookingId, action },
  });
  const payload = data as { error?: string } | null;
  return { error: payload?.error ?? error?.message ?? null };
}

async function invokeStripeRefund(bookingId: string) {
  if (!supabase) return { error: "Supabase är inte konfigurerat." };
  const { data, error } = await supabase.functions.invoke("stripe-refund", {
    body: { bookingId },
  });
  const payload = data as { detail?: string; error?: string } | null;
  return { error: payload?.detail ?? payload?.error ?? error?.message ?? null };
}

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

type View = "upcoming" | "attention" | "history";

function BookingsPage() {
  const session = useSession();
  const { property, units } = useProperty(session);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<BookingFilters>(emptyFilters);
  const [view, setView] = useState<View>("upcoming");
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
    () =>
      filtered
        .filter((b) => !(b.status === "confirmed" && b.checkout_date >= today))
        .slice(-80)
        .reverse(),
    [filtered, today],
  );

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

  const attention = useMemo(
    () =>
      upcoming.filter(
        (b) =>
          conflictIds.has(b.id) ||
          b.payment_status === "pending" ||
          b.payment_status === "refund_pending" ||
          !b.guest_email ||
          !b.guest_phone,
      ),
    [upcoming, conflictIds],
  );

  const paidUpcoming = upcoming
    .filter((b) => b.payment_status === "paid")
    .reduce((sum, b) => sum + (b.payment_amount ?? 0), 0);
  const arrivingToday = upcoming.filter((b) => b.checkin_date === today).length;

  const exportCsv = () => {
    const csv = "\ufeff" + bookingsToCsv(filtered);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = csvFilename();
    a.click();
    URL.revokeObjectURL(url);
  };

  const cancel = async (booking: Booking) => {
    if (
      !window.confirm(
        `Avboka ${booking.guest_name ?? "bokningen"} ${svDate(booking.checkin_date)}–${svDate(booking.checkout_date)}?`,
      )
    )
      return;
    const result = await invokePaymentAction(booking.id, "cancel_booking");
    if (result.error) setPageError(result.error);
    else load();
  };

  const copyLink = (booking: Booking) => {
    navigator.clipboard.writeText(guestPageUrl(booking.guest_token));
    setCopied(booking.id);
    setTimeout(() => setCopied(null), 1500);
  };

  if (!property) return null;

  const visible = view === "attention" ? attention : upcoming;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#2d684c]/60">
            Drift & gäster
          </p>
          <h1 className="mt-1.5 font-[Fraunces] text-[32px] font-semibold leading-tight text-[#173c2b] sm:text-[38px]">
            Bokningar
          </h1>
          <p className="mt-1 text-[12px] text-[color:var(--ink)]/45">
            En arbetsvy för ankomster, betalningar, kontaktuppgifter och gästkommunikation.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-2 rounded-xl border border-black/[0.09] bg-white px-3.5 py-2.5 text-[12px] font-bold text-[color:var(--ink)]/60 shadow-sm transition hover:border-black/20 disabled:opacity-35"
          >
            <Download size={14} /> Exportera
          </button>
          <button
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-[#173c2b] px-4 py-2.5 text-[12px] font-bold text-white shadow-[0_8px_22px_rgba(23,60,43,0.18)] transition hover:-translate-y-0.5"
          >
            <CalendarPlus size={15} /> Ny bokning
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard label="Kommande" value={String(upcoming.length)} sub="bekräftade vistelser" />
        <SummaryCard label="Ankommer idag" value={String(arrivingToday)} sub="gäster att ta emot" />
        <SummaryCard
          label="Behöver åtgärd"
          value={String(attention.length)}
          sub="kontakt, betalning eller krock"
          warn={attention.length > 0}
        />
        <SummaryCard
          label="Betalt framåt"
          value={fmtKr(paidUpcoming)}
          sub="registrerat bokningsvärde"
        />
      </div>

      <section className="rounded-[22px] border border-black/[0.07] bg-white p-3 shadow-[0_7px_26px_rgba(25,40,31,0.04)] sm:p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="inline-flex w-full rounded-xl bg-[#f1f3ef] p-1 xl:w-auto">
            <ViewButton
              active={view === "upcoming"}
              onClick={() => setView("upcoming")}
              label={`Kommande ${upcoming.length}`}
            />
            <ViewButton
              active={view === "attention"}
              onClick={() => setView("attention")}
              label={`Åtgärda ${attention.length}`}
              warn={attention.length > 0}
            />
            <ViewButton
              active={view === "history"}
              onClick={() => setView("history")}
              label={`Historik ${past.length}`}
            />
          </div>

          <label className="relative min-w-0 flex-1">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--ink)]/35"
            />
            <input
              value={filters.search}
              onChange={(e) => updateFilter("search", e.target.value)}
              placeholder="Sök gäst, e-post eller mobil…"
              className="inp !rounded-xl !border-black/[0.08] !bg-[#fafbf9] !pl-9"
              aria-label="Sök i bokningar"
            />
          </label>

          <div className="scrollbar-none flex gap-2 overflow-x-auto">
            <select
              value={filters.unitId}
              onChange={(e) => updateFilter("unitId", e.target.value)}
              className="inp !w-auto !shrink-0 !rounded-xl !border-black/[0.08] !bg-[#fafbf9] !text-[12px]"
              aria-label="Filtrera på boende"
            >
              <option value="alla">Alla boenden</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
            <select
              value={filters.source}
              onChange={(e) => updateFilter("source", e.target.value as BookingFilters["source"])}
              className="inp !w-auto !shrink-0 !rounded-xl !border-black/[0.08] !bg-[#fafbf9] !text-[12px]"
              aria-label="Filtrera på källa"
            >
              <option value="all">Alla källor</option>
              <option value="direct">Direkt</option>
              <option value="sirvoy">Sirvoy</option>
              <option value="ical">iCal</option>
              <option value="manual">Manuell</option>
            </select>
            <select
              value={filters.payment}
              onChange={(e) => updateFilter("payment", e.target.value as BookingFilters["payment"])}
              className="inp !w-auto !shrink-0 !rounded-xl !border-black/[0.08] !bg-[#fafbf9] !text-[12px]"
              aria-label="Filtrera på betalning"
            >
              <option value="all">Alla betalningar</option>
              <option value="none">Ingen betalning</option>
              <option value="pending">Väntar</option>
              <option value="paid">Betald</option>
              <option value="refund_pending">Återbetalning krävs</option>
              <option value="refunded">Återbetald</option>
              <option value="expired">Utgången</option>
            </select>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-black/[0.055] pt-3">
          <input
            type="date"
            value={filters.from}
            onChange={(e) => updateFilter("from", e.target.value)}
            className="inp !w-auto !rounded-xl !border-black/[0.08] !bg-[#fafbf9] !text-[12px]"
            aria-label="Från datum"
          />
          <span className="text-[11px] text-[color:var(--ink)]/30">till</span>
          <input
            type="date"
            value={filters.to}
            onChange={(e) => updateFilter("to", e.target.value)}
            className="inp !w-auto !rounded-xl !border-black/[0.08] !bg-[#fafbf9] !text-[12px]"
            aria-label="Till datum"
          />
          {activeFilterCount > 0 && (
            <button
              onClick={() => setFilters(emptyFilters)}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-bold text-[color:var(--ink)]/45 hover:bg-[#f1f3ef] hover:text-[color:var(--ink)]/70"
            >
              <RotateCcw size={12} /> Rensa filter ({activeFilterCount})
            </button>
          )}
        </div>
      </section>

      {pageError && (
        <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[12px] font-medium text-red-700">
          {pageError}
        </p>
      )}

      {conflictIds.size > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3.5 text-[12px] text-red-800">
          <AlertTriangle size={17} className="mt-0.5 shrink-0" />
          <span>
            <strong>{conflictIds.size} bokningar krockar.</strong> Kontrollera dem direkt och avboka
            eller flytta den felaktiga bokningen.
          </span>
        </div>
      )}

      {loading ? (
        <div className="rounded-[22px] border border-black/[0.06] bg-white py-16 text-center text-[13px] text-[color:var(--ink)]/40">
          Laddar bokningar…
        </div>
      ) : view === "history" ? (
        past.length === 0 ? (
          <EmptyState text="Ingen historik matchar filtren." />
        ) : (
          <div className="space-y-2">
            {past.map((booking) => (
              <PastBookingCard key={booking.id} booking={booking} />
            ))}
          </div>
        )
      ) : visible.length === 0 ? (
        <EmptyState
          text={
            view === "attention"
              ? "Snyggt — inget behöver åtgärdas just nu."
              : "Inga kommande bokningar matchar filtren."
          }
        />
      ) : (
        <div className="space-y-2.5">
          {visible.map((booking) => (
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

function SummaryCard({
  label,
  value,
  sub,
  warn = false,
}: {
  label: string;
  value: string;
  sub: string;
  warn?: boolean;
}) {
  return (
    <div
      className={`rounded-[18px] border bg-white p-4 shadow-[0_5px_18px_rgba(25,40,31,0.035)] ${warn ? "border-amber-200" : "border-black/[0.06]"}`}
    >
      <p
        className={`text-[9px] font-bold uppercase tracking-[0.13em] ${warn ? "text-amber-700" : "text-[color:var(--ink)]/35"}`}
      >
        {label}
      </p>
      <p
        className={`mt-2 font-[Fraunces] text-[25px] font-semibold leading-none ${warn ? "text-amber-900" : "text-[#173c2b]"}`}
      >
        {value}
      </p>
      <p className="mt-1.5 text-[9px] text-[color:var(--ink)]/35">{sub}</p>
    </div>
  );
}

function ViewButton({
  active,
  onClick,
  label,
  warn = false,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  warn?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-[11px] font-bold transition xl:flex-none ${
        active
          ? "bg-white text-[#173c2b] shadow-sm"
          : warn
            ? "text-amber-700 hover:text-amber-900"
            : "text-[color:var(--ink)]/45 hover:text-[color:var(--ink)]/70"
      }`}
    >
      {label}
    </button>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-[22px] border border-dashed border-black/[0.11] bg-white/70 px-6 py-14 text-center">
      <CalendarClock className="mx-auto text-[#2d684c]/25" size={28} />
      <p className="mt-3 text-[13px] font-semibold text-[color:var(--ink)]/45">{text}</p>
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
      .select(
        "id, booking_id, channel, send_at, status, error, template:message_templates(trigger_type)",
      )
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

  const runPaymentAction = async (action: PaymentAction) => {
    onError(null);
    const result = await invokePaymentAction(b.id, action);
    if (result.error) onError(result.error);
    else onChanged();
  };

  const refundStripe = async () => {
    onError(null);
    const result = await invokeStripeRefund(b.id);
    if (result.error) onError(`Återbetalningen misslyckades: ${result.error}`);
    else onChanged();
  };

  const needsContact = !b.guest_email || !b.guest_phone;

  return (
    <div
      className={`overflow-hidden rounded-[20px] border bg-white shadow-[0_6px_24px_rgba(25,40,31,0.035)] transition ${conflicting ? "border-red-300 ring-1 ring-red-200" : "border-black/[0.065] hover:border-black/[0.11]"}`}
    >
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left sm:gap-4 sm:px-5"
      >
        <div
          className={`w-[54px] shrink-0 rounded-xl px-2 py-2 text-center ${conflicting ? "bg-red-50 text-red-800" : "bg-[#edf2ed] text-[#173c2b]"}`}
        >
          <span className="block text-[9px] font-bold uppercase tracking-wider opacity-55">
            {new Date(b.checkin_date + "T12:00:00").toLocaleDateString("sv-SE", { month: "short" })}
          </span>
          <span className="block font-[Fraunces] text-[21px] font-semibold leading-none">
            {new Date(b.checkin_date + "T12:00:00").getDate()}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-[13px] font-bold sm:text-[14px]">
              {b.guest_name ?? "Okänd gäst"}
            </span>
            <SourceBadge source={b.source} />
            {b.payment_status === "pending" && <Badge tone="amber">Betalning väntar</Badge>}
            {b.payment_status === "paid" && <Badge tone="green">Betald</Badge>}
            {b.payment_status === "refund_pending" && <Badge tone="red">Återbetalning krävs</Badge>}
            {b.payment_status === "refunded" && <Badge tone="green">Återbetald</Badge>}
            {conflicting && <Badge tone="red">Krock</Badge>}
            {needsContact && <Badge tone="amber">Kontakt saknas</Badge>}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-[color:var(--ink)]/43 sm:text-[12px]">
            {b.unit?.name ?? "Ingen enhet"} · {svDate(b.checkin_date)}–{svDate(b.checkout_date)} ·{" "}
            {b.guests ?? "?"} gäster
          </div>
        </div>
        <div className="hidden shrink-0 text-right md:block">
          <p className="text-[12px] font-bold text-[#173c2b]">
            {b.payment_amount ? fmtKr(b.payment_amount) : "—"}
          </p>
          <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-wider text-[color:var(--ink)]/28">
            {b.payment_method ?? b.source}
          </p>
        </div>
        <ChevronDown
          size={16}
          className={`shrink-0 text-[color:var(--ink)]/30 transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            className="overflow-hidden"
          >
            <div className="space-y-5 border-t border-black/[0.055] bg-[#fafbf9] px-4 py-4 sm:px-5 sm:py-5">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[color:var(--ink)]/35">
                    Gästuppgifter
                  </p>
                  <span className="text-[9px] text-[color:var(--ink)]/30">Redigera direkt här</span>
                </div>
                <div className="grid gap-2.5 sm:grid-cols-[1fr_1fr_110px_auto]">
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Gästens e-post"
                    type="email"
                    className="inp !rounded-xl !border-black/[0.08]"
                  />
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="Gästens mobil"
                    className="inp !rounded-xl !border-black/[0.08]"
                  />
                  <label className="relative">
                    <Users
                      size={14}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--ink)]/35"
                    />
                    <input
                      type="number"
                      min={1}
                      max={maxGuests}
                      value={guestCount}
                      onChange={(e) => setGuestCount(Number(e.target.value))}
                      className="inp !rounded-xl !border-black/[0.08] !pl-8"
                      aria-label="Antal gäster"
                    />
                  </label>
                  <button
                    onClick={saveDetails}
                    className="rounded-xl border border-black/[0.09] bg-white px-4 py-2.5 text-[12px] font-bold shadow-sm transition hover:border-black/20"
                  >
                    {saved ? "✓ Sparat" : "Spara"}
                  </button>
                </div>
              </div>

              {b.payment_status === "pending" && b.payment_expires_at && (
                <p className="rounded-xl border border-amber-100 bg-amber-50 px-3.5 py-2.5 text-[11px] text-amber-800">
                  Reservationen löper ut{" "}
                  {new Date(b.payment_expires_at).toLocaleString("sv-SE", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  om betalningen inte bekräftas.
                </p>
              )}

              {b.payment_status === "pending" && b.payment_method === "stripe" && (
                <p className="rounded-xl border border-sky-100 bg-sky-50 px-3.5 py-2.5 text-[11px] text-sky-800">
                  Stripe-betalningar kan inte markeras betalda manuellt. Status uppdateras endast av
                  en verifierad Stripe-webhook.
                </p>
              )}

              {b.payment_status === "refund_pending" && b.payment_method === "swish" && (
                <p className="rounded-xl border border-red-100 bg-red-50 px-3.5 py-2.5 text-[11px] text-red-800">
                  Återbetalning väntar. Swisha tillbaka beloppet först och bekräfta därefter i
                  systemet.
                </p>
              )}

              <div>
                <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[color:var(--ink)]/35">
                  Meddelandekö
                </p>
                <div className="mt-2 space-y-1.5">
                  {!messages ? (
                    <p className="text-[12px] text-[color:var(--ink)]/40">Laddar…</p>
                  ) : messages.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-black/[0.09] bg-white px-3 py-3 text-[11px] text-[color:var(--ink)]/40">
                      Inga meddelanden schemalagda.
                    </p>
                  ) : (
                    messages.map((message) => (
                      <div
                        key={message.id}
                        className="flex items-center gap-2.5 rounded-xl border border-black/[0.055] bg-white px-3 py-2.5 text-[11px]"
                      >
                        {message.channel === "email" ? (
                          <Mail size={13} />
                        ) : (
                          <Smartphone size={13} />
                        )}
                        <span className="font-bold">
                          {message.template
                            ? (TRIGGER_LABELS[
                                message.template.trigger_type as keyof typeof TRIGGER_LABELS
                              ] ?? "Meddelande")
                            : "Meddelande"}
                        </span>
                        <span className="text-[color:var(--ink)]/40">
                          {new Date(message.send_at).toLocaleString("sv-SE", {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <span
                          className={`ml-auto rounded-full px-2 py-0.5 text-[9px] font-bold ${message.status === "sent" ? "bg-emerald-100 text-emerald-800" : message.status === "failed" ? "bg-red-50 text-red-700" : message.status === "cancelled" ? "bg-black/5 text-[color:var(--ink)]/45" : "bg-amber-100 text-amber-800"}`}
                          title={message.error ?? undefined}
                        >
                          {message.status === "sent"
                            ? "Skickat"
                            : message.status === "failed"
                              ? "Misslyckades"
                              : message.status === "cancelled"
                                ? "Avbrutet"
                                : "Väntar"}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-2 border-t border-black/[0.055] pt-4">
                {b.payment_status === "pending" && b.payment_method === "swish" && (
                  <button
                    onClick={() => runPaymentAction("mark_swish_paid")}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-3.5 py-2 text-[11px] font-bold text-white hover:bg-emerald-800"
                  >
                    <CreditCard size={13} /> Markera Swish betald
                    {b.payment_amount ? ` · ${fmtKr(b.payment_amount)}` : ""}
                  </button>
                )}

                {b.payment_status === "paid" && b.payment_method === "stripe" && (
                  <button
                    onClick={async () => {
                      const amount = b.payment_amount
                        ? ` ${b.payment_amount.toLocaleString("sv-SE")} kr`
                        : "";
                      if (
                        !window.confirm(
                          `Återbetala${amount} till ${b.guest_name ?? "gästen"}? Pengarna skickas tillbaka automatiskt via Stripe.`,
                        )
                      )
                        return;
                      await refundStripe();
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-black/[0.09] bg-white px-3.5 py-2 text-[11px] font-bold text-[color:var(--ink)]/65 hover:border-black/20"
                  >
                    <RotateCcw size={13} /> Återbetala via Stripe
                  </button>
                )}

                {b.payment_status === "paid" && b.payment_method === "swish" && (
                  <button
                    onClick={async () => {
                      const amount = b.payment_amount
                        ? ` ${b.payment_amount.toLocaleString("sv-SE")} kr`
                        : "";
                      if (
                        !window.confirm(
                          `Starta återbetalning${amount} till ${b.guest_name ?? "gästen"}? Status blir ”återbetalning krävs” tills du faktiskt har swishat tillbaka och bekräftat det.`,
                        )
                      )
                        return;
                      await runPaymentAction("request_swish_refund");
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-black/[0.09] bg-white px-3.5 py-2 text-[11px] font-bold text-[color:var(--ink)]/65 hover:border-black/20"
                  >
                    <RotateCcw size={13} /> Starta Swish-återbetalning
                  </button>
                )}

                {b.payment_status === "refund_pending" && b.payment_method === "stripe" && (
                  <button
                    onClick={refundStripe}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-red-700 px-3.5 py-2 text-[11px] font-bold text-white hover:bg-red-800"
                  >
                    <RotateCcw size={13} /> Slutför Stripe-återbetalning
                  </button>
                )}

                {b.payment_status === "refund_pending" && b.payment_method === "swish" && (
                  <button
                    onClick={async () => {
                      if (
                        !window.confirm(
                          `Bekräfta endast om du redan har swishat tillbaka pengarna till ${b.guest_name ?? "gästen"}.`,
                        )
                      )
                        return;
                      await runPaymentAction("confirm_swish_refunded");
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-red-700 px-3.5 py-2 text-[11px] font-bold text-white hover:bg-red-800"
                  >
                    <Check size={13} /> Jag har swishat tillbaka
                  </button>
                )}

                <button
                  onClick={onCopy}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-black/[0.09] bg-white px-3.5 py-2 text-[11px] font-bold text-[color:var(--ink)]/65 hover:border-black/20"
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />} Gästlänk
                </button>
                <a
                  href={guestPageUrl(b.guest_token)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-black/[0.09] bg-white px-3.5 py-2 text-[11px] font-bold text-[color:var(--ink)]/65 hover:border-black/20"
                >
                  <ExternalLink size={13} /> Öppna gästsidan
                </a>
                <button
                  onClick={onCancel}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[11px] font-bold text-red-600 hover:bg-red-50"
                >
                  <Ban size={13} /> Avboka
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Badge({ children, tone }: { children: string; tone: "amber" | "green" | "red" }) {
  const cls =
    tone === "green"
      ? "bg-emerald-100 text-emerald-800"
      : tone === "red"
        ? "bg-red-100 text-red-800"
        : "bg-amber-100 text-amber-800";
  return <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${cls}`}>{children}</span>;
}

function SourceBadge({ source }: { source: Booking["source"] }) {
  const label =
    source === "ical"
      ? "iCal"
      : source === "direct"
        ? "Direkt"
        : source === "sirvoy"
          ? "Sirvoy"
          : "Manuell";
  return (
    <span className="rounded-full bg-[#eff2ee] px-2 py-0.5 text-[9px] font-bold text-[color:var(--ink)]/45">
      {label}
    </span>
  );
}

function PastBookingCard({ booking }: { booking: Booking }) {
  return (
    <div className="flex items-center gap-3 rounded-[18px] border border-black/[0.055] bg-white px-4 py-3 text-[12px] shadow-[0_4px_16px_rgba(25,40,31,0.025)]">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#f1f3ef] font-[Fraunces] text-[14px] font-semibold text-[#173c2b]">
        {(booking.guest_name ?? "?").slice(0, 1).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-bold">{booking.guest_name ?? "Okänd gäst"}</p>
        <p className="truncate text-[10px] text-[color:var(--ink)]/38">
          {booking.unit?.name ?? "—"} · {svDate(booking.checkin_date)}–
          {svDate(booking.checkout_date)}
        </p>
      </div>
      <span
        className={`rounded-full px-2 py-1 text-[9px] font-bold ${booking.status === "cancelled" ? "bg-red-50 text-red-700" : "bg-[#f1f3ef] text-[color:var(--ink)]/45"}`}
      >
        {booking.status === "cancelled" ? "Avbokad" : "Utcheckad"}
      </span>
    </div>
  );
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

  const valid = Boolean(
    unitId &&
    name.trim().length >= 2 &&
    checkin &&
    checkout &&
    checkout > checkin &&
    guests >= 1 &&
    guests <= (selectedUnit?.max_guests ?? 1),
  );

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
      setError(
        error.code === "23P01" || error.message.includes("booking_overlap")
          ? "Boendet är redan bokat under hela eller delar av perioden."
          : error.message,
      );
    } else onCreated();
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        onClick={onClose}
        className="fixed inset-0 z-40 bg-[#0b1711]/55 backdrop-blur-[2px]"
      />
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-2rem)] w-[min(520px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[26px] bg-white p-5 shadow-2xl sm:p-6"
      >
        <div className="rounded-2xl bg-[#edf2ed] p-4">
          <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-[#2d684c]/60">
            Manuell reservation
          </p>
          <h3 className="mt-1 font-[Fraunces] text-[24px] font-semibold text-[#173c2b]">
            Ny bokning
          </h3>
          <p className="mt-1 text-[10px] text-[color:var(--ink)]/40">
            För telefonbokning, drop-in eller bokning utanför den publika motorn.
          </p>
        </div>
        <div className="mt-5 space-y-3.5">
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[color:var(--ink)]/35">
              Boende
            </span>
            <select
              value={unitId}
              onChange={(e) => setUnitId(e.target.value)}
              className="inp mt-1 !rounded-xl !border-black/[0.08]"
            >
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · max {u.max_guests}
                </option>
              ))}
            </select>
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Gästens namn *"
            className="inp !rounded-xl !border-black/[0.08]"
          />
          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className="text-[10px] font-bold uppercase tracking-wider text-[color:var(--ink)]/35">
                Incheckning
              </span>
              <input
                type="date"
                value={checkin}
                onChange={(e) => setCheckin(e.target.value)}
                className="inp mt-1 !rounded-xl !border-black/[0.08]"
              />
            </label>
            <label>
              <span className="text-[10px] font-bold uppercase tracking-wider text-[color:var(--ink)]/35">
                Utcheckning
              </span>
              <input
                type="date"
                value={checkout}
                onChange={(e) => setCheckout(e.target.value)}
                className="inp mt-1 !rounded-xl !border-black/[0.08]"
              />
            </label>
          </div>
          <label>
            <span className="text-[10px] font-bold uppercase tracking-wider text-[color:var(--ink)]/35">
              Antal gäster · max {selectedUnit?.max_guests ?? 1}
            </span>
            <input
              type="number"
              min={1}
              max={selectedUnit?.max_guests ?? 1}
              value={guests}
              onChange={(e) => setGuests(Number(e.target.value))}
              className="inp mt-1 !rounded-xl !border-black/[0.08]"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="E-post"
              type="email"
              className="inp !rounded-xl !border-black/[0.08]"
            />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Mobil"
              className="inp !rounded-xl !border-black/[0.08]"
            />
          </div>
          {error && (
            <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-[12px] text-red-700">{error}</p>
          )}
          <div className="flex gap-2 pt-1">
            <button
              onClick={onClose}
              className="flex-1 rounded-xl border border-black/[0.09] px-4 py-3 text-[12px] font-bold text-[color:var(--ink)]/55"
            >
              Avbryt
            </button>
            <button
              onClick={submit}
              disabled={!valid || busy}
              className="flex-[1.4] rounded-xl bg-[#173c2b] px-4 py-3 text-[12px] font-bold text-white shadow-sm disabled:opacity-35"
            >
              {busy ? "Sparar…" : "Skapa bokning"}
            </button>
          </div>
        </div>
      </motion.div>
    </>
  );
}

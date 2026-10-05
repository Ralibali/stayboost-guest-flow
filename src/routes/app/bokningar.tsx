import { BookingEditor } from "@/components/app/BookingEditor";
import { ImportedPaymentPanel } from "@/components/app/ImportedPaymentPanel";
import { SirvoyCalendarPanel } from "@/components/app/SirvoyCalendarPanel";
import {
  formatSirvoyDecimal,
  isSirvoyCalendarBooking,
  matchingSirvoyValues,
  type SirvoyCalendarValues,
} from "@/lib/sirvoy-calendar";
import { AdminHistory } from "@/components/app/AdminHistory";
import {
  STAY_STATUS,
  bookingAdminError,
  isCalendarDate,
  validateBookingDraft,
} from "@/lib/booking-admin";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { bookingConflicts, bookingsNeedingAttention, fetchAllRows } from "@/lib/operator-bookings";
import { PROPERTY_TIME_ZONE, propertyDay, propertyDateLabel } from "@/lib/property-dates";
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
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

type BookingPageSearch = {
  booking?: string;
  create?: boolean;
  unitId?: string;
  checkin?: string;
  checkout?: string;
};
export const Route = createFileRoute("/app/bokningar")({
  validateSearch: (search: Record<string, unknown>): BookingPageSearch => ({
    booking: typeof search.booking === "string" ? search.booking : undefined,
    create: search.create === true || search.create === "true" ? true : undefined,
    unitId: typeof search.unitId === "string" ? search.unitId : undefined,
    checkin:
      typeof search.checkin === "string" && isCalendarDate(search.checkin)
        ? search.checkin
        : undefined,
    checkout:
      typeof search.checkout === "string" && isCalendarDate(search.checkout)
        ? search.checkout
        : undefined,
  }),
  component: BookingsPage,
});

const svDate = (iso: string) => propertyDateLabel(iso, { day: "numeric", month: "short" });
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

type View = "upcoming" | "attention" | "history";

function BookingsPage() {
  const search = Route.useSearch();
  const session = useSession();
  const { property, units } = useProperty(session);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [sourceValues, setSourceValues] = useState<Record<string, SirvoyCalendarValues>>({});
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<BookingFilters>(emptyFilters);
  const [view, setView] = useState<View>("upcoming");
  const [expanded, setExpanded] = useState<string | null>(search.booking ?? null);
  const [modalOpen, setModalOpen] = useState(Boolean(search.create));
  const [copied, setCopied] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [historyLimit, setHistoryLimit] = useState(80);
  const generation = useRef(0);
  const propertyId = property?.id;

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
    if (!supabase || !propertyId) return;
    const client = supabase;
    const ticket = ++generation.current;
    setLoading(true);
    setPageError(null);
    setSourceValues({});
    try {
      const data = await fetchAllRows<Booking>((from, to) =>
        client
          .from("bookings")
          .select("*, unit:units(name,max_guests)", { count: "exact" })
          .eq("property_id", propertyId)
          .order("checkin_date")
          .order("id")
          .range(from, to),
      );
      if (ticket !== generation.current) return;
      setBookings(data);
      if (data.some(isSirvoyCalendarBooking)) {
        try {
          const values = await fetchAllRows<SirvoyCalendarValues>((from, to) =>
            client
              .from("sirvoy_calendar_documentary_values")
              .select("*", { count: "exact" })
              .eq("property_id", propertyId)
              .order("booking_id")
              .range(from, to),
          );
          if (ticket === generation.current)
            setSourceValues(Object.fromEntries(values.map((value) => [value.booking_id, value])));
        } catch {
          // The permanent booking markers keep controls closed even if the source read fails.
          if (ticket === generation.current) setSourceValues({});
        }
      }
    } catch (failure) {
      if (ticket === generation.current)
        setPageError(failure instanceof Error ? failure.message : "Bokningarna kunde inte hämtas.");
    } finally {
      if (ticket === generation.current) setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    const currentGeneration = generation;
    void load();
    return () => {
      currentGeneration.current++;
    };
  }, [load]);

  const today = propertyDay();
  const filtered = useMemo(() => filterBookings(bookings, filters), [bookings, filters]);
  const upcoming = useMemo(
    () => filtered.filter((b) => b.status === "confirmed" && b.checkout_date >= today),
    [filtered, today],
  );
  const past = useMemo(
    () =>
      filtered
        .filter((b) => !(b.status === "confirmed" && b.checkout_date >= today))
        .slice()
        .reverse(),
    [filtered, today],
  );

  const conflictIds = useMemo(() => bookingConflicts(bookings), [bookings]);

  const attention = useMemo(
    () => bookingsNeedingAttention(filtered, today, conflictIds),
    [filtered, today, conflictIds],
  );
  useEffect(() => {
    if (!search.booking || loading) return;
    const booking = bookings.find((item) => item.id === search.booking);
    if (!booking) return;
    setExpanded(booking.id);
    if (booking.status !== "confirmed" || booking.checkout_date < today) {
      setView("history");
      const index = past.findIndex((item) => item.id === booking.id);
      if (index >= 0) setHistoryLimit((limit) => Math.max(limit, index + 1));
    } else setView("upcoming");
  }, [search.booking, bookings, loading, today, past]);
  useEffect(() => {
    if (search.create) setModalOpen(true);
  }, [search.create, search.unitId, search.checkin, search.checkout]);

  const paidUpcoming = upcoming
    .filter((b) => !isSirvoyCalendarBooking(b) && b.payment_status === "paid")
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
    if (["ical", "sirvoy", "channex"].includes(booking.source)) {
      setPageError("Avboka i ursprungskanalen. Bokningen uppdateras här vid nästa synkning.");
      return;
    }
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

  const copyLink = async (booking: Booking) => {
    try {
      await navigator.clipboard.writeText(guestPageUrl(booking.guest_token));
      setCopied(booking.id);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setPageError("Gästlänken kunde inte kopieras. Öppna gästsidan och kopiera adressen där.");
    }
  };

  if (!property) return null;

  const visible = view === "attention" ? attention : upcoming;

  return (
    <div className="space-y-5" data-private="true">
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
            disabled={filtered.length === 0 || loading || Boolean(pageError)}
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
              <option value="channex">Bokningskanaler</option>
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
            {past.slice(0, historyLimit).map((booking) => (
              <BookingCard
                key={booking.id}
                booking={booking}
                sourceValues={sourceValues[booking.id]}
                units={units}
                maxStay={property.max_stay ?? 30}
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
            {past.length > historyLimit && (
              <button
                onClick={() => setHistoryLimit((limit) => limit + 80)}
                className="w-full rounded-xl border bg-white p-3 text-sm font-semibold"
              >
                Visa fler ({past.length - historyLimit} återstår)
              </button>
            )}
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
              sourceValues={sourceValues[booking.id]}
              units={units}
              maxStay={property.max_stay ?? 30}
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
          maxStay={property.max_stay ?? 30}
          initialUnitId={search.unitId}
          initialCheckin={search.checkin}
          initialCheckout={search.checkout}
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
  sourceValues,
  units,
  maxStay,
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
  sourceValues?: SirvoyCalendarValues;
  units: Unit[];
  maxStay: number;
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
  const [messagesError, setMessagesError] = useState("");
  const [editing, setEditing] = useState(false);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const paymentLock = useRef(false);
  const external = ["ical", "sirvoy", "channex"].includes(b.source);
  const sourceCalendar = isSirvoyCalendarBooking(b);
  const documentary = matchingSirvoyValues(b, sourceValues);

  useEffect(() => {
    if (!expanded || !supabase) return;
    let active = true;
    setMessagesError("");
    supabase
      .from("scheduled_messages")
      .select(
        "id, booking_id, channel, send_at, status, error, template:message_templates(trigger_type)",
      )
      .eq("booking_id", b.id)
      .order("send_at")
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setMessagesError("Meddelandekön kunde inte hämtas.");
        else setMessages((data as unknown as ScheduledMessage[]) ?? []);
      });
    return () => {
      active = false;
    };
  }, [expanded, b.id, b.updated_at]);

  const runPaymentAction = async (action: PaymentAction) => {
    if (paymentLock.current || sourceCalendar) return;
    paymentLock.current = true;
    setPaymentBusy(true);
    onError(null);
    try {
      const result = await invokePaymentAction(b.id, action);
      if (result.error) onError(result.error);
      else onChanged();
    } catch {
      onError("Ingen kontakt med servern. Uppdatera bokningen innan du försöker igen.");
    } finally {
      paymentLock.current = false;
      setPaymentBusy(false);
    }
  };

  const refundStripe = async () => {
    if (paymentLock.current || sourceCalendar) return;
    paymentLock.current = true;
    setPaymentBusy(true);
    onError(null);
    try {
      const result = await invokeStripeRefund(b.id);
      if (result.error) onError(`Återbetalningen misslyckades: ${result.error}`);
      else onChanged();
    } catch {
      onError(
        "Ingen kontakt med servern. Kontrollera återbetalningens status innan du försöker igen.",
      );
    } finally {
      paymentLock.current = false;
      setPaymentBusy(false);
    }
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
            {propertyDateLabel(b.checkin_date, { month: "short" })}
          </span>
          <span className="block font-[Fraunces] text-[21px] font-semibold leading-none">
            {Number(b.checkin_date.slice(8))}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-[13px] font-bold sm:text-[14px]">
              {b.guest_name ?? "Okänd gäst"}
            </span>
            {sourceCalendar ? (
              <Badge tone="amber">Sirvoy · kalender</Badge>
            ) : (
              <SourceBadge source={b.source} />
            )}
            {b.status === "cancelled" && <Badge tone="red">Avbokad</Badge>}
            {b.stay_status && b.stay_status !== "expected" && (
              <Badge tone="green">{STAY_STATUS[b.stay_status]}</Badge>
            )}
            {!sourceCalendar && b.payment_status === "pending" && (
              <Badge tone="amber">Betalning väntar</Badge>
            )}
            {!sourceCalendar && b.payment_status === "paid" && <Badge tone="green">Betald</Badge>}
            {!sourceCalendar && b.payment_status === "refund_pending" && (
              <Badge tone="red">Återbetalning krävs</Badge>
            )}
            {!sourceCalendar && b.payment_status === "refunded" && (
              <Badge tone="green">Återbetald</Badge>
            )}
            {conflicting && <Badge tone="red">Krock</Badge>}
            {needsContact && <Badge tone="amber">Kontakt saknas</Badge>}
            {!b.unit_id && <Badge tone="red">Boende saknas</Badge>}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-[color:var(--ink)]/43 sm:text-[12px]">
            {b.unit?.name ?? "Ingen enhet"} · {svDate(b.checkin_date)}–{svDate(b.checkout_date)} ·{" "}
            {b.guests ?? "?"} gäster
          </div>
        </div>
        <div className="hidden shrink-0 text-right md:block">
          <p className="text-[12px] font-bold text-[#173c2b]">
            {sourceCalendar
              ? formatSirvoyDecimal(documentary?.accommodation_amount)
              : b.payment_amount
                ? fmtKr(b.payment_amount)
                : "—"}
          </p>
          <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-wider text-[color:var(--ink)]/28">
            {sourceCalendar
              ? `Sirvoy-underlag · ${documentary?.currency ?? "valuta ej verifierad"}`
              : (b.payment_method ?? b.source)}
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
              {editing ? (
                <BookingEditor
                  booking={b}
                  units={units}
                  maxStay={maxStay}
                  onClose={() => setEditing(false)}
                  onSaved={() => {
                    setEditing(false);
                    onChanged();
                  }}
                />
              ) : (
                <div className="space-y-2 text-sm">
                  <p>
                    {b.guest_email ?? "E-post saknas"} · {b.guest_phone ?? "Telefon saknas"}
                  </p>
                  <p>{STAY_STATUS[b.stay_status ?? "expected"]}</p>
                  {b.internal_notes && (
                    <p className="whitespace-pre-wrap rounded-xl bg-amber-50 p-3">
                      {b.internal_notes}
                    </p>
                  )}
                  <button
                    onClick={() => setEditing(true)}
                    className="rounded-xl border bg-white px-4 py-2.5 font-semibold"
                  >
                    Ändra bokning
                  </button>
                </div>
              )}
              <details>
                <summary className="cursor-pointer text-sm font-semibold">
                  Visa ändringshistorik
                </summary>
                <AdminHistory propertyId={b.property_id} bookingId={b.id} />
              </details>
              <ImportedPaymentPanel booking={b} onChanged={onChanged} />
              {sourceCalendar && <SirvoyCalendarPanel booking={b} values={documentary} />}

              {!sourceCalendar && b.payment_status === "pending" && b.payment_expires_at && (
                <p className="rounded-xl border border-amber-100 bg-amber-50 px-3.5 py-2.5 text-[11px] text-amber-800">
                  Reservationen löper ut{" "}
                  {new Date(b.payment_expires_at).toLocaleString("sv-SE", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: PROPERTY_TIME_ZONE,
                  })}{" "}
                  om betalningen inte bekräftas.
                </p>
              )}

              {!sourceCalendar &&
                b.payment_status === "pending" &&
                b.payment_method === "stripe" && (
                  <p className="rounded-xl border border-sky-100 bg-sky-50 px-3.5 py-2.5 text-[11px] text-sky-800">
                    Stripe-betalningar kan inte markeras betalda manuellt. Status uppdateras endast
                    av en verifierad Stripe-webhook.
                  </p>
                )}

              {!sourceCalendar &&
                b.payment_status === "refund_pending" &&
                b.payment_method === "swish" && (
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
                  {messagesError ? (
                    <p role="alert" className="text-xs text-red-700">
                      {messagesError}
                    </p>
                  ) : !messages ? (
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
                            timeZone: PROPERTY_TIME_ZONE,
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

              {external && (
                <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
                  Den här bokningen styrs av ursprungskanalen. Avboka där så uppdateras kalendern
                  vid nästa synkning.
                </p>
              )}
              <fieldset
                disabled={paymentBusy}
                className="flex flex-wrap gap-2 border-t border-black/[0.055] pt-4 disabled:opacity-50"
              >
                {!sourceCalendar &&
                  b.payment_status === "pending" &&
                  b.payment_method === "swish" && (
                    <button
                      onClick={() => runPaymentAction("mark_swish_paid")}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-3.5 py-2 text-[11px] font-bold text-white hover:bg-emerald-800"
                    >
                      <CreditCard size={13} /> Markera Swish betald
                      {b.payment_amount ? ` · ${fmtKr(b.payment_amount)}` : ""}
                    </button>
                  )}

                {!sourceCalendar &&
                  b.payment_status === "paid" &&
                  b.payment_method === "stripe" && (
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

                {!sourceCalendar && b.payment_status === "paid" && b.payment_method === "swish" && (
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

                {!sourceCalendar &&
                  b.payment_status === "refund_pending" &&
                  b.payment_method === "stripe" && (
                    <button
                      onClick={refundStripe}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-red-700 px-3.5 py-2 text-[11px] font-bold text-white hover:bg-red-800"
                    >
                      <RotateCcw size={13} /> Slutför Stripe-återbetalning
                    </button>
                  )}

                {!sourceCalendar &&
                  b.payment_status === "refund_pending" &&
                  b.payment_method === "swish" && (
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
                  disabled={b.status === "cancelled" || external}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[11px] font-bold text-red-600 hover:bg-red-50"
                >
                  <Ban size={13} /> Avboka
                </button>
              </fieldset>
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
        : source === "channex"
          ? "Bokningskanal"
          : source === "sirvoy"
            ? "Sirvoy"
            : "Manuell";
  return (
    <span className="rounded-full bg-[#eff2ee] px-2 py-0.5 text-[9px] font-bold text-[color:var(--ink)]/45">
      {label}
    </span>
  );
}

function ManualBookingModal({
  propertyId,
  units,
  maxStay,
  initialUnitId,
  initialCheckin,
  initialCheckout,
  onClose,
  onCreated,
}: {
  propertyId: string;
  units: Unit[];
  maxStay: number;
  initialUnitId?: string;
  initialCheckin?: string;
  initialCheckout?: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [unitId, setUnitId] = useState(
    units.find((unit) => unit.id === initialUnitId)?.id ?? units[0]?.id ?? "",
  );
  const selectedUnit = units.find((unit) => unit.id === unitId);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [guests, setGuests] = useState(1);
  const [checkin, setCheckin] = useState(initialCheckin ?? "");
  const [checkout, setCheckout] = useState(initialCheckout ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!supabase || lock.current) return;
    const issue = validateBookingDraft(
      {
        unit_id: unitId,
        guest_name: name,
        guest_email: email,
        guest_phone: phone,
        guests,
        checkin_date: checkin,
        checkout_date: checkout,
        internal_notes: notes,
        stay_status: "expected",
      },
      selectedUnit,
      maxStay,
    );
    if (issue) {
      setError(issue);
      return;
    }
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const { error: failure } = await supabase
        .from("bookings")
        .insert({
          property_id: propertyId,
          unit_id: unitId,
          source: "manual",
          guest_name: name.trim(),
          guest_email: email.trim() || null,
          guest_phone: phone.trim() || null,
          guests,
          checkin_date: checkin,
          checkout_date: checkout,
          internal_notes: notes.trim() || null,
        })
        .select("id")
        .single();
      if (failure) setError(bookingAdminError(failure));
      else onCreated();
    } catch {
      setError("Ingen kontakt med servern. Kontrollera bokningslistan innan du försöker igen.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-xl overflow-y-auto rounded-2xl bg-white p-5 sm:p-6"
        data-private="true"
      >
        <div className="rounded-2xl bg-[#edf2ed] p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#2d684c]">
            Manuell reservation
          </p>
          <DialogTitle className="mt-1 font-[Fraunces] text-2xl text-[#173c2b]">
            Ny bokning
          </DialogTitle>
          <DialogDescription className="mt-2 text-xs text-black/60">
            För telefonbokning, drop-in eller bokning utanför den publika motorn. Bokningen
            reserverar boendet. Ingen betalning debiteras här.
          </DialogDescription>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <fieldset disabled={busy} className="space-y-3">
            {!units.length && (
              <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm">
                Aktivera ett boende i Inställningar för att kunna skapa en bokning.
              </p>
            )}
            <label className="block text-sm">
              Boende
              <select
                value={unitId}
                onChange={(event) => setUnitId(event.target.value)}
                className="inp mt-1"
                required
              >
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name} · max {unit.max_guests}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              Gästens namn
              <input
                required
                minLength={2}
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="inp mt-1"
                autoComplete="name"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">
                Incheckning
                <input
                  type="date"
                  required
                  value={checkin}
                  onChange={(event) => setCheckin(event.target.value)}
                  className="inp mt-1"
                />
              </label>
              <label className="text-sm">
                Utcheckning
                <input
                  type="date"
                  required
                  min={checkin || undefined}
                  value={checkout}
                  onChange={(event) => setCheckout(event.target.value)}
                  className="inp mt-1"
                />
              </label>
            </div>
            <p className="text-xs text-black/55">Vistelsen får vara högst {maxStay} nätter.</p>
            <label className="block text-sm">
              Antal gäster · max {selectedUnit?.max_guests ?? "—"}
              <input
                type="number"
                required
                min={1}
                max={selectedUnit?.max_guests ?? 20}
                step={1}
                value={guests}
                onChange={(event) => setGuests(Number(event.target.value))}
                className="inp mt-1"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                E-post
                <input
                  type="email"
                  maxLength={254}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="inp mt-1"
                  autoComplete="email"
                />
              </label>
              <label className="text-sm">
                Mobil
                <input
                  type="tel"
                  maxLength={40}
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  className="inp mt-1"
                  autoComplete="tel"
                />
              </label>
            </div>
            <label className="block text-sm">
              Interna anteckningar
              <textarea
                maxLength={10000}
                rows={3}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                className="inp mt-1"
              />
            </label>
          </fieldset>
          {error && (
            <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="flex-1 rounded-xl border px-4 py-3 text-sm font-semibold disabled:opacity-40"
            >
              Avbryt
            </button>
            <button
              disabled={!units.length || busy}
              className="flex-1 rounded-xl bg-[#173c2b] px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
            >
              {busy ? "Sparar…" : "Skapa bokning"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

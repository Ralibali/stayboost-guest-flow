import { createFileRoute } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import {
  Ban,
  CalendarPlus,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Mail,
  Smartphone,
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
} from "@/lib/supabase";

export const Route = createFileRoute("/app/bokningar")({
  component: BookingsPage,
});

const svDate = (iso: string) =>
  new Date(iso + "T12:00:00").toLocaleDateString("sv-SE", { day: "numeric", month: "short" });

function BookingsPage() {
  const session = useSession();
  const { property, units } = useProperty(session);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [unitFilter, setUnitFilter] = useState<string>("alla");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !property) return;
    setLoading(true);
    const { data } = await supabase
      .from("bookings")
      .select("*, unit:units(name)")
      .eq("property_id", property.id)
      .order("checkin_date", { ascending: true });
    setBookings((data as Booking[]) ?? []);
    setLoading(false);
  }, [property]);

  useEffect(() => {
    load();
  }, [load]);

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = useMemo(
    () =>
      bookings
        .filter((b) => b.status === "confirmed" && b.checkout_date >= today)
        .filter((b) => unitFilter === "alla" || b.unit_id === unitFilter),
    [bookings, today, unitFilter],
  );
  const past = useMemo(
    () =>
      bookings
        .filter((b) => !(b.status === "confirmed" && b.checkout_date >= today))
        .filter((b) => unitFilter === "alla" || b.unit_id === unitFilter)
        .slice(-10)
        .reverse(),
    [bookings, today, unitFilter],
  );

  const cancel = async (b: Booking) => {
    if (!supabase) return;
    if (
      !window.confirm(
        `Avboka ${b.guest_name ?? "bokningen"} ${svDate(b.checkin_date)}–${svDate(b.checkout_date)}? Meddelandekön rensas automatiskt.`,
      )
    )
      return;
    await supabase.from("bookings").update({ status: "cancelled" }).eq("id", b.id);
    load();
  };

  const copyLink = (b: Booking) => {
    navigator.clipboard.writeText(guestPageUrl(b.guest_token));
    setCopied(b.id);
    setTimeout(() => setCopied(null), 1500);
  };

  if (!property) return null;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-[Fraunces] text-2xl font-semibold">Bokningar</h1>
          <p className="text-[13px] text-[color:var(--ink)]/55">
            {upcoming.length} kommande ·{" "}
            {upcoming.filter((b) => !b.guest_email && !b.guest_phone).length} saknar
            kontaktuppgifter
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={unitFilter}
            onChange={(e) => setUnitFilter(e.target.value)}
            className="inp !w-auto"
          >
            <option value="alla">Alla enheter</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => setModalOpen(true)}
            className="btn-primary !rounded-xl !px-4 !py-2.5 text-[13px]"
          >
            <CalendarPlus size={15} /> Ny bokning
          </button>
        </div>
      </div>

      {loading ? (
        <p className="mt-10 text-center text-[14px] text-[color:var(--ink)]/45">Laddar…</p>
      ) : upcoming.length === 0 ? (
        <div className="card-surface mt-6 p-10 text-center">
          <p className="text-[15px] text-[color:var(--ink)]/60">
            Inga kommande bokningar ännu. Skapa en manuell — eller koppla en iCal-källa så hämtar vi
            dem åt dig.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {upcoming.map((b) => (
            <BookingCard
              key={b.id}
              booking={b}
              expanded={expanded === b.id}
              onToggle={() => setExpanded(expanded === b.id ? null : b.id)}
              onCancel={() => cancel(b)}
              onCopy={() => copyLink(b)}
              copied={copied === b.id}
              onChanged={load}
            />
          ))}
        </div>
      )}

      {past.length > 0 && (
        <details className="mt-8">
          <summary className="cursor-pointer text-[13px] font-medium text-[color:var(--ink)]/50">
            Tidigare & avbokade ({past.length})
          </summary>
          <div className="mt-3 space-y-2 opacity-70">
            {past.map((b) => (
              <div
                key={b.id}
                className="card-surface flex items-center gap-3 !rounded-2xl px-4 py-3 text-[13px]"
              >
                <span className="font-semibold">{b.guest_name ?? "Okänd gäst"}</span>
                <span className="text-[color:var(--ink)]/55">
                  {b.unit?.name ?? "—"} · {svDate(b.checkin_date)}–{svDate(b.checkout_date)}
                </span>
                <span
                  className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    b.status === "cancelled" ? "bg-red-50 text-red-700" : "bg-[color:var(--bg)]"
                  }`}
                >
                  {b.status === "cancelled" ? "Avbokad" : "Utcheckad"}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}

      {modalOpen && (
        <ManualBookingModal
          propertyId={property.id}
          units={units}
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

/* ---------- Bokningskort med meddelandekö ---------- */

function BookingCard({
  booking: b,
  expanded,
  onToggle,
  onCancel,
  onCopy,
  copied,
  onChanged,
}: {
  booking: Booking;
  expanded: boolean;
  onToggle: () => void;
  onCancel: () => void;
  onCopy: () => void;
  copied: boolean;
  onChanged: () => void;
}) {
  const [messages, setMessages] = useState<ScheduledMessage[] | null>(null);
  const [email, setEmail] = useState(b.guest_email ?? "");
  const [phone, setPhone] = useState(b.guest_phone ?? "");
  const [saved, setSaved] = useState(false);
  const missingContact = !b.guest_email && !b.guest_phone;

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

  const saveContact = async () => {
    if (!supabase) return;
    await supabase
      .from("bookings")
      .update({ guest_email: email || null, guest_phone: phone || null })
      .eq("id", b.id);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    onChanged();
  };

  return (
    <div className="card-surface overflow-hidden">
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-5 py-4 text-left">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[color:var(--forest)] text-[13px] font-bold text-white">
          {(b.guest_name ?? "?")
            .split(" ")
            .map((n) => n[0])
            .slice(0, 2)
            .join("")}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold">{b.guest_name ?? "Okänd gäst"}</span>
            <span className="rounded-full bg-[color:var(--bg)] px-2 py-0.5 text-[11px] font-semibold text-[color:var(--ink)]/60">
              {b.source === "ical"
                ? "iCal"
                : b.source === "direct"
                  ? "Direkt"
                  : b.source === "sirvoy"
                    ? "Sirvoy"
                    : "Manuell"}
            </span>
            {b.payment_status === "pending" && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                💸 Swish väntar
              </span>
            )}
            {b.payment_status === "paid" && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                💸 Betald
              </span>
            )}
            {missingContact && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                Komplettera kontaktuppgifter
              </span>
            )}
          </div>
          <div className="text-[13px] text-[color:var(--ink)]/55">
            {b.unit?.name ?? "Ingen enhet"} · {svDate(b.checkin_date)} – {svDate(b.checkout_date)}
          </div>
        </div>
        <ChevronDown
          size={17}
          className={`shrink-0 text-[color:var(--ink)]/40 transition-transform ${expanded ? "rotate-180" : ""}`}
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
            <div className="space-y-4 border-t border-[color:var(--line)] px-5 py-4">
              {/* Kontaktuppgifter */}
              <div className="grid gap-2.5 sm:grid-cols-[1fr_1fr_auto]">
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Gästens e-post"
                  className="inp"
                />
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Gästens mobil (+46…)"
                  className="inp"
                />
                <button
                  onClick={saveContact}
                  className="btn-ghost !rounded-xl !px-4 !py-2.5 text-[13px]"
                >
                  {saved ? "✓ Sparat" : "Spara"}
                </button>
              </div>

              {/* Meddelandekö */}
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-wide text-[color:var(--ink)]/50">
                  Meddelandekö
                </p>
                <div className="mt-2 space-y-1.5">
                  {!messages ? (
                    <p className="text-[13px] text-[color:var(--ink)]/45">Laddar…</p>
                  ) : messages.length === 0 ? (
                    <p className="text-[13px] text-[color:var(--ink)]/45">
                      Inga meddelanden schemalagda.
                    </p>
                  ) : (
                    messages.map((m) => (
                      <div
                        key={m.id}
                        className="flex items-center gap-2.5 rounded-xl bg-[color:var(--bg)] px-3 py-2 text-[13px]"
                      >
                        {m.channel === "email" ? <Mail size={14} /> : <Smartphone size={14} />}
                        <span className="font-medium">
                          {m.template
                            ? (TRIGGER_LABELS[
                                m.template.trigger_type as keyof typeof TRIGGER_LABELS
                              ] ?? "Meddelande")
                            : "Meddelande"}
                        </span>
                        <span className="text-[color:var(--ink)]/50">
                          {new Date(m.send_at).toLocaleString("sv-SE", {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <span
                          className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            m.status === "sent"
                              ? "bg-emerald-100 text-emerald-800"
                              : m.status === "failed"
                                ? "bg-red-50 text-red-700"
                                : m.status === "cancelled"
                                  ? "bg-[color:var(--line)]/60 text-[color:var(--ink)]/50"
                                  : "bg-amber-100 text-amber-800"
                          }`}
                          title={m.error ?? undefined}
                        >
                          {m.status === "sent"
                            ? "Skickat"
                            : m.status === "failed"
                              ? "Misslyckades"
                              : m.status === "cancelled"
                                ? "Avbrutet"
                                : "Väntar"}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Åtgärder */}
              <div className="flex flex-wrap gap-2">
                {b.payment_status === "pending" && (
                  <button
                    onClick={async () => {
                      if (!supabase) return;
                      await supabase
                        .from("bookings")
                        .update({ payment_status: "paid" })
                        .eq("id", b.id);
                      onChanged();
                    }}
                    className="rounded-xl bg-emerald-600 px-3.5 py-2 text-[13px] font-semibold text-white transition hover:bg-emerald-700"
                  >
                    💸 Markera betald
                    {b.payment_amount
                      ? ` (${b.payment_amount.toLocaleString("sv-SE")} kr${b.payment_ref ? ` · ${b.payment_ref}` : ""})`
                      : ""}
                  </button>
                )}
                <button
                  onClick={onCopy}
                  className="btn-ghost !rounded-xl !px-3.5 !py-2 text-[13px]"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />} Gästsidelänk
                </button>
                <a
                  href={guestPageUrl(b.guest_token)}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-ghost !rounded-xl !px-3.5 !py-2 text-[13px]"
                >
                  <ExternalLink size={14} /> Öppna gästsidan
                </a>
                <button
                  onClick={onCancel}
                  className="ml-auto rounded-xl px-3.5 py-2 text-[13px] font-semibold text-red-600 transition hover:bg-red-50"
                >
                  <Ban size={14} className="mr-1 inline" /> Avboka
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---------- Manuell bokning ---------- */

function ManualBookingModal({
  propertyId,
  units,
  onClose,
  onCreated,
}: {
  propertyId: string;
  units: { id: string; name: string }[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [unitId, setUnitId] = useState(units[0]?.id ?? "");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [checkin, setCheckin] = useState("");
  const [checkout, setCheckout] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = unitId && checkin && checkout && checkout > checkin;

  const submit = async () => {
    if (!supabase || !valid) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.from("bookings").insert({
      property_id: propertyId,
      unit_id: unitId,
      source: "manual",
      guest_name: name.trim() || null,
      guest_email: email.trim() || null,
      guest_phone: phone.trim() || null,
      checkin_date: checkin,
      checkout_date: checkout,
    });
    setBusy(false);
    if (error) setError(error.message);
    else onCreated();
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/45"
      />
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="fixed left-1/2 top-1/2 z-50 w-[min(440px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-[24px] bg-white p-6 shadow-2xl"
      >
        <h3 className="font-[Fraunces] text-xl font-semibold">Ny manuell bokning</h3>
        <div className="mt-5 space-y-3.5">
          <select value={unitId} onChange={(e) => setUnitId(e.target.value)} className="inp">
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Gästens namn"
            className="inp"
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[12px] font-medium text-[color:var(--ink)]/55">
                Incheckning
              </label>
              <input
                type="date"
                value={checkin}
                onChange={(e) => setCheckin(e.target.value)}
                className="inp mt-1"
              />
            </div>
            <div>
              <label className="text-[12px] font-medium text-[color:var(--ink)]/55">
                Utcheckning
              </label>
              <input
                type="date"
                value={checkout}
                onChange={(e) => setCheckout(e.target.value)}
                className="inp mt-1"
              />
            </div>
          </div>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="E-post (för utskick)"
            className="inp"
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Mobil (för sms)"
            className="inp"
          />
          {error && (
            <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-[13px] text-red-700">{error}</p>
          )}
          <button
            onClick={submit}
            disabled={!valid || busy}
            className="btn-primary w-full justify-center !rounded-xl !py-3 text-[15px] disabled:opacity-40"
          >
            {busy ? "Sparar…" : "Skapa bokning"}
          </button>
          <p className="text-center text-[12px] text-[color:var(--ink)]/45">
            Bekräftelsemeddelandet schemaläggs direkt av databasen
          </p>
        </div>
      </motion.div>
    </>
  );
}

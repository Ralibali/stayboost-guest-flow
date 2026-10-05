import { createFileRoute } from "@tanstack/react-router";
import { ExternalLink, Mail, MailOpen, MessageSquareText, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GuestAiDraft } from "@/components/app/GuestAiDraft";
import { GuestAiSettings } from "@/components/app/GuestAiSettings";
import { supabase, useProperty, useSession } from "@/lib/supabase";
import { InboxWorkflow, ManualInboxMessage } from "@/components/app/InboxWorkflow";
import {
  channelLabels,
  isOverdue,
  replyLink,
  safePageUrl,
  type InboxMessage,
  type InboxBooking,
} from "@/lib/inbox";
import { localDay } from "@/lib/stayOperations";

export const Route = createFileRoute("/app/inkorg")({
  component: InboxPage,
});

const formatDate = (value: string) =>
  new Date(value).toLocaleString("sv-SE", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

function InboxPage() {
  const session = useSession();
  const { property, reload: reloadProperty } = useProperty(session);
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [bookings, setBookings] = useState<InboxBooking[]>([]);
  const [filter, setFilter] = useState("active");
  const [channel, setChannel] = useState("all");
  const generation = useRef(0);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !property) return;

    const ticket = ++generation.current;
    setLoading(true);
    setError(null);

    const [messageResult, bookingResult] = await Promise.all([
      supabase
        .from("chat_messages")
        .select("*")
        .eq("property_id", property.id)
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("bookings")
        .select("id,guest_name,guest_email,checkin_date,checkout_date,status")
        .eq("property_id", property.id)
        .order("checkin_date", { ascending: false })
        .limit(1000),
    ]);
    if (ticket !== generation.current) return;
    setMessages((messageResult.data as InboxMessage[]) ?? []);
    setBookings((bookingResult.data as InboxBooking[]) ?? []);
    if (messageResult.error) setError("Inkorgen kunde inte hämtas. Försök igen.");
    else if (bookingResult.error) setError("Bokningslistan kunde inte hämtas.");
    setLoading(false);
  }, [property]);

  const invalidateLoad = useCallback(() => {
    generation.current++;
  }, []);

  useEffect(() => {
    setMessages([]);
    setBookings([]);
    void load();
    return invalidateLoad;
  }, [load, invalidateLoad]);

  const unread = useMemo(() => messages.filter((message) => !message.read_at).length, [messages]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("sv-SE");
    return messages.filter(
      (message) =>
        (filter === "all" ||
          (filter === "active" && message.inbox_status !== "resolved") ||
          (filter === "overdue" && isOverdue(message, localDay())) ||
          filter === message.inbox_status) &&
        (channel === "all" || channel === message.channel) &&
        [
          message.visitor_name ?? "",
          message.visitor_email,
          message.message,
          message.page_url ?? "",
          message.assigned_to,
          message.internal_note,
          message.visitor_phone ?? "",
        ]
          .join(" ")
          .toLocaleLowerCase("sv-SE")
          .includes(needle),
    );
  }, [messages, query, filter, channel]);

  const markRead = async (id: string) => {
    if (!supabase) return;

    const readAt = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("chat_messages")
      .update({ read_at: readAt })
      .eq("id", id);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setMessages((current) =>
      current.map((message) => (message.id === id ? { ...message, read_at: readAt } : message)),
    );
  };

  const markUnread = async (id: string) => {
    if (!supabase) return;

    const { error: updateError } = await supabase
      .from("chat_messages")
      .update({ read_at: null })
      .eq("id", id);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setMessages((current) =>
      current.map((message) => (message.id === id ? { ...message, read_at: null } : message)),
    );
  };

  if (!property) return null;

  return (
    <div className="space-y-6" data-private="true">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#2d684c]">
            <MessageSquareText size={13} /> StayBoost Inbox
          </div>
          <h1 className="mt-2 font-[Fraunces] text-[34px] font-semibold leading-tight">Inkorg</h1>
          <p className="mt-1 text-[13px] text-[color:var(--ink)]/50">
            Webbchatt och manuellt registrerade gästfrågor med ansvarig, bokning och uppföljning.
            {unread > 0 ? ` ${unread} olästa.` : " Allt är läst."}
          </p>
        </div>

        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 self-start rounded-xl border border-black/[0.07] bg-white px-4 py-2.5 text-[11px] font-bold text-[color:var(--ink)]/55 hover:text-[color:var(--ink)] disabled:opacity-40"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Uppdatera
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Senaste 200" value={messages.length} />
        <Stat label="Olästa" value={unread} attention={unread > 0} />
        <Stat
          label="Försenade uppföljningar"
          value={messages.filter((message) => isOverdue(message, localDay())).length}
        />
      </div>

      <ManualInboxMessage propertyId={property.id} onSaved={() => void load()} />
      <div className="flex flex-wrap gap-3">
        <label className="text-xs">
          Visa
          <select
            aria-label="Filtrera status"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="ml-2 rounded-lg border bg-white p-2"
          >
            <option value="active">Öppna och väntande</option>
            <option value="overdue">Försenade</option>
            <option value="resolved">Klara</option>
            <option value="all">Alla</option>
          </select>
        </label>
        <label className="text-xs">
          Kanal
          <select
            aria-label="Filtrera kanal"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            className="ml-2 rounded-lg border bg-white p-2"
          >
            <option value="all">Alla kanaler</option>
            {Object.entries(channelLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <GuestAiSettings
        propertyId={property.id}
        enabled={property.guest_ai_enabled}
        instructions={property.guest_ai_instructions}
        onUpdated={reloadProperty}
      />

      <label className="flex items-center gap-2 rounded-2xl border border-black/[0.07] bg-white px-4 py-3 shadow-sm">
        <Search size={16} className="shrink-0 text-[color:var(--ink)]/35" />
        <span className="sr-only">Sök i inkorgen</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Sök gäst, telefon, ansvarig eller anteckning"
          className="w-full bg-transparent text-sm outline-none placeholder:text-[color:var(--ink)]/35"
        />
      </label>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          Kunde inte läsa inkorgen: {error}
        </div>
      ) : null}

      {!loading && filtered.length === 0 ? (
        <div className="rounded-[24px] border border-dashed border-black/10 bg-white/60 px-6 py-14 text-center">
          <MessageSquareText className="mx-auto text-[color:var(--ink)]/25" size={30} />
          <h2 className="mt-4 font-[Fraunces] text-xl font-semibold">
            {messages.length === 0 ? "Inkorgen är tom" : "Inga träffar"}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[color:var(--ink)]/50">
            {messages.length === 0
              ? "När någon skriver via StayBoost-chatten visas meddelandet här och kan hanteras av anläggningen."
              : "Prova ett annat sökord."}
          </p>
        </div>
      ) : null}

      <div className="space-y-3">
        {filtered.map((message) => {
          const isUnread = !message.read_at;
          const mailto = replyLink(message, property.name);
          const pageUrl = safePageUrl(message.page_url);

          return (
            <article
              key={`${message.id}:${message.inbox_version}`}
              className={`rounded-[22px] border bg-white p-5 shadow-sm transition sm:p-6 ${
                isUnread ? "border-[#2d684c]/30 ring-1 ring-[#2d684c]/10" : "border-black/[0.07]"
              }`}
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-bold text-[color:var(--ink)]">
                      {message.visitor_name?.trim() || "Gäst"}
                    </p>
                    {isUnread ? (
                      <span className="rounded-full bg-[#e7f3ec] px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-[#2d684c]">
                        Nytt
                      </span>
                    ) : null}
                    <span className="rounded-full bg-gray-100 px-2 py-1 text-[10px]">
                      {channelLabels[message.channel]}
                      {message.logged_manually ? " · Registrerat manuellt" : ""}
                    </span>
                    {isOverdue(message, localDay()) && (
                      <span className="text-xs text-amber-800">Uppföljning försenad</span>
                    )}
                    {!message.emailed && !message.logged_manually ? (
                      <span className="rounded-full bg-amber-50 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-amber-700">
                        Ej mejlaviserad
                      </span>
                    ) : null}
                  </div>
                  <a
                    href={mailto ?? undefined}
                    className="mt-1 inline-block text-xs font-medium text-[#2d684c] hover:underline"
                  >
                    {message.visitor_email || message.visitor_phone}
                  </a>
                  <p className="mt-1 text-[11px] text-[color:var(--ink)]/40">
                    {formatDate(message.created_at)}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {mailto && (
                    <a
                      href={mailto}
                      target={message.channel === "whatsapp" ? "_blank" : undefined}
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 rounded-xl bg-[#173c2b] px-3.5 py-2 text-[11px] font-bold text-white transition hover:bg-[#214e39]"
                    >
                      <Mail size={14} /> Öppna svarsapp
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => void (isUnread ? markRead(message.id) : markUnread(message.id))}
                    className="inline-flex items-center gap-2 rounded-xl border border-black/[0.08] px-3.5 py-2 text-[11px] font-bold text-[color:var(--ink)]/60 hover:text-[color:var(--ink)]"
                  >
                    {isUnread ? <MailOpen size={14} /> : <Mail size={14} />}
                    {isUnread ? "Markera läst" : "Markera oläst"}
                  </button>
                </div>
              </div>

              <p className="mt-5 whitespace-pre-wrap text-[14px] leading-7 text-[color:var(--ink)]/75">
                {message.message}
              </p>

              <InboxWorkflow message={message} bookings={bookings} onSaved={() => void load()} />
              <GuestAiDraft
                messageId={message.id}
                existingDraft={message.ai_draft}
                createdAt={message.ai_draft_created_at}
                enabled={property.guest_ai_enabled}
              />

              {pageUrl ? (
                <a
                  href={pageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 inline-flex items-center gap-1.5 text-[11px] font-semibold text-[color:var(--ink)]/45 hover:text-[#2d684c]"
                >
                  Sidan gästen skrev från <ExternalLink size={12} />
                </a>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  attention = false,
}: {
  label: string;
  value: number;
  attention?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border px-4 py-4 ${
        attention ? "border-[#2d684c]/20 bg-[#edf6f1]" : "border-black/[0.07] bg-white"
      }`}
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[color:var(--ink)]/40">
        {label}
      </p>
      <p className="mt-1 font-[Fraunces] text-2xl font-semibold">{value}</p>
    </div>
  );
}

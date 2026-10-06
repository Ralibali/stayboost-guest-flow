import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { canonicalUrl } from "@/lib/canonical";
import { SUPABASE_URL } from "@/lib/supabase-config";
import { LANGS, LOCALES, detectLang, persistLang, type Lang } from "@/lib/boka-i18n";
import { bookingLanguage, isHostedStripeCheckout } from "@/lib/glamping-embed";
import { getGuestStrings } from "@/lib/guest-i18n";
import { isGuestResponse } from "@/lib/public-response";
import {
  addonVatLabel,
  localizedAddonText,
  type AddonTranslations,
  type VatRate,
} from "../../../supabase/functions/_shared/addon-content";

export const Route = createFileRoute("/g/$token")({
  component: GuestPage,
  head: () => ({
    meta: [
      { title: "Din vistelse — StayBoost" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
      { property: "og:url", content: canonicalUrl("/g") },
    ],
    links: [{ rel: "canonical", href: canonicalUrl("/g") }],
  }),
});

const C = { bg: "#FAFAF8", ink: "#1B1B19", muted: "#777772", line: "#E2E2DC" } as const;
const eyebrow = "text-[11px] font-semibold uppercase tracking-[0.18em]";
const endpoint = `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/guest-page`;

type GuestData = {
  bookingStatus: string;
  phase?: "before" | "arrival" | "during" | "departure" | "finished" | "no_show";
  accessAvailable?: boolean;
  addons?: {
    id: string;
    name: string;
    description?: string | null;
    contentTranslations?: AddonTranslations;
    vatRate?: VatRate | null;
    quantity: number;
    dueDate: string;
    status: string;
    nameSource: string;
    contextChanged: boolean;
  }[];
  guestName: string | null;
  checkinDate: string;
  checkoutDate: string;
  unit: { name: string; door_code: string | null; checkin_instructions: string | null } | null;
  property: {
    name: string;
    slug: string;
    checkin_time: string;
    checkout_time: string;
    directions: string | null;
    wifi_name: string | null;
    wifi_password: string | null;
    house_rules: string | null;
    contact_phone: string | null;
    swish_number: string | null;
  };
  payment: {
    method: "none" | "swish" | "stripe";
    status: string;
    amount: number | null;
    ref: string | null;
    expiresAt: string | null;
    canResume: boolean;
  } | null;
};

function GuestPage() {
  const { token } = Route.useParams();
  const [lang, setLang] = useState<Lang>("sv");
  const [state, setState] = useState<"loading" | "ok" | "notfound" | "error">("loading");
  const [loaded, setLoaded] = useState<{ token: string; data: GuestData } | null>(null);
  const loadedToken = useRef<string | null>(null);
  const data = loaded?.token === token ? loaded.data : null;
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [polls, setPolls] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [justPaid, setJustPaid] = useState(false);
  const t = getGuestStrings(lang);
  const locale = LOCALES[lang];
  const date = (iso: string) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
  const deadline = (value: string) =>
    new Date(value).toLocaleString(locale, {
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Stockholm",
    });

  useEffect(() => {
    setLang(bookingLanguage(window.location.search) ?? detectLang());
    setJustPaid(new URLSearchParams(window.location.search).get("paid") === "1");
    setPolls(0);
  }, [token]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    if (loadedToken.current !== token) setState("loading");
    setRefreshing(true);
    setRefreshError(false);
    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
    })
      .then(async (response) => {
        if (cancelled) return;
        if (response.status === 400 || response.status === 404) {
          setLoaded(null);
          loadedToken.current = null;
          setState("notfound");
          return;
        }
        if (!response.ok) throw new Error("guest_page_unavailable");
        const result = await response.json();
        if (cancelled) return;
        if (!isGuestResponse(result)) throw new Error("invalid_guest_response");
        setLoaded({ token, data: result });
        loadedToken.current = token;
        setState("ok");
      })
      .catch(() => {
        if (cancelled) return;
        if (loadedToken.current === token) setRefreshError(true);
        else setState("error");
      })
      .finally(() => !cancelled && setRefreshing(false));
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [token, polls]);

  useEffect(() => {
    if (
      !justPaid ||
      data?.payment?.method !== "stripe" ||
      data.payment.status !== "pending" ||
      polls >= 6
    )
      return;
    const timer = setTimeout(() => setPolls((value) => value + 1), 8000);
    return () => clearTimeout(timer);
  }, [justPaid, data, polls]);

  const copy = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    } catch {
      setCopiedField(null);
    }
  };

  const resumePayment = async () => {
    if (resuming) return;
    setResuming(true);
    setResumeError(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action: "resume_payment" }),
        signal: AbortSignal.timeout(20000),
      });
      const result = await response.json();
      if (response.status === 409) {
        setResumeError(t.resumeUnavailable);
        setPolls((value) => value + 1);
      } else if (!response.ok || !isHostedStripeCheckout(result.checkoutUrl))
        setResumeError(t.resumeError);
      else window.location.assign(result.checkoutUrl);
    } catch {
      setResumeError(t.resumeError);
    } finally {
      setResuming(false);
    }
  };

  if (state === "loading" || (state === "ok" && !data))
    return (
      <div
        className="grid min-h-screen place-items-center"
        style={{ background: C.bg }}
        role="status"
        aria-label={t.updating}
      >
        <div
          className="h-9 w-9 animate-spin rounded-full border-2 border-t-transparent"
          style={{ borderColor: C.line, borderTopColor: "transparent" }}
        />
      </div>
    );
  if (!data || state === "notfound" || state === "error")
    return (
      <div
        className="grid min-h-screen place-items-center px-6 text-center"
        style={{ background: C.bg, color: C.ink }}
      >
        <div>
          <h1 className="font-[Fraunces] text-3xl">
            {state === "notfound" ? t.notFound : t.error}
          </h1>
          <p className="mt-3 text-[15px]" style={{ color: C.muted }}>
            {state === "notfound" ? t.notFoundBody : t.errorBody}
          </p>
          {state !== "notfound" && (
            <button
              className="mt-5 min-h-11 rounded-xl border px-5"
              onClick={() => setPolls((value) => value + 1)}
            >
              {t.retry}
            </button>
          )}
        </div>
      </div>
    );

  const p = data.property;
  const payment = data.payment;
  const expired =
    payment?.status === "expired" ||
    (payment?.status === "pending" &&
      Boolean(payment.expiresAt) &&
      Date.parse(payment.expiresAt!) <= Date.now());
  const cancelled = data.bookingStatus === "cancelled";
  const pending = payment?.status === "pending" && !expired && !cancelled;
  const refresh = (
    <button
      disabled={refreshing}
      className="min-h-11 text-sm underline disabled:opacity-50"
      onClick={() => setPolls((value) => value + 1)}
    >
      {refreshing ? t.updating : t.update}
    </button>
  );

  return (
    <div className="min-h-screen pb-20" style={{ background: C.bg, color: C.ink }}>
      <motion.main
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="mx-auto max-w-xl px-5 pt-8 sm:pt-14"
      >
        <nav className="mb-6 flex justify-end gap-2" aria-label="Language">
          {LANGS.map((language) => (
            <button
              key={language.id}
              aria-pressed={lang === language.id}
              onClick={() => {
                setLang(language.id);
                persistLang(language.id);
              }}
              className="min-h-11 min-w-11 rounded-lg border px-3 text-xs font-bold"
              style={{ borderColor: lang === language.id ? C.ink : C.line }}
            >
              {language.label}
            </button>
          ))}
        </nav>
        <header className="border-b pb-8" style={{ borderColor: C.line }}>
          <p className={eyebrow} style={{ color: C.muted }}>
            {t.welcome}
          </p>
          <h1 className="mt-3 font-[Fraunces] text-[36px] leading-[1.1]">{p.name}</h1>
          <p className="mt-4 text-[15px]">
            <span style={{ color: C.muted }}>{t.guest} </span>
            <span className="font-medium">{data.guestName ?? t.welcome}</span>
          </p>
          <p className="mt-1 text-[15px]">
            {date(data.checkinDate)} – {date(data.checkoutDate)}
          </p>
          {data.unit && (
            <p className="mt-1 text-[14px]" style={{ color: C.muted }}>
              {data.unit.name}
            </p>
          )}
          {payment?.amount != null && (
            <p className="mt-3 text-sm font-semibold">
              {t.total}: {payment.amount.toLocaleString(locale)} kr
            </p>
          )}
          <div
            className="mt-6 grid grid-cols-2 gap-4 border-t pt-5"
            style={{ borderColor: C.line }}
          >
            <div>
              <p className={eyebrow} style={{ color: C.muted }}>
                {t.checkin}
              </p>
              <p className="mt-1.5 text-[16px] font-medium">
                {t.from} {p.checkin_time}
              </p>
            </div>
            <div>
              <p className={eyebrow} style={{ color: C.muted }}>
                {t.checkout}
              </p>
              <p className="mt-1.5 text-[16px] font-medium">
                {t.until} {p.checkout_time}
              </p>
            </div>
          </div>
        </header>

        {refreshError && (
          <p role="alert" className="mt-5 rounded-xl border p-4 text-sm">
            {t.refreshError}
          </p>
        )}
        {(cancelled || expired) && (
          <Status title={expired ? t.expired : t.cancelled}>
            <p>{t.expiredBody}</p>
            {p.slug && (
              <a
                className="mt-3 block min-h-11 font-semibold underline"
                href={`/boka/${encodeURIComponent(p.slug)}?lang=${lang}`}
              >
                {t.rebook}
              </a>
            )}
          </Status>
        )}
        {payment?.status === "refund_pending" && (
          <Status title={t.refundPending}>
            <p>{t.refundPendingBody}</p>
          </Status>
        )}
        {payment?.status === "refunded" && <Status title={t.refunded} />}
        {payment?.status === "paid" && !cancelled && (
          <Status title={t.paid}>
            <p>{t.paidBody}</p>
          </Status>
        )}
        {pending && payment?.method === "stripe" && (
          <Status title={justPaid ? t.processing : t.cardPending}>
            <p>{justPaid ? t.processingBody : t.cardPendingBody}</p>
            {payment.expiresAt && (
              <p className="mt-2">
                {t.expires} <strong>{deadline(payment.expiresAt)}</strong> ({t.swedishTime}).
              </p>
            )}
            {payment.canResume && !justPaid && (
              <button
                disabled={resuming}
                className="mt-4 min-h-11 w-full rounded-xl bg-[#173D2E] p-3 font-semibold text-white disabled:opacity-50"
                onClick={resumePayment}
              >
                {resuming ? t.updating : t.resume}
              </button>
            )}
            {resumeError && (
              <p role="alert" className="mt-3">
                {resumeError}
              </p>
            )}
            {refresh}
          </Status>
        )}
        {pending && payment?.method === "swish" && payment.amount != null && p.swish_number && (
          <Status title={t.swish}>
            <p>
              <strong>{payment.amount.toLocaleString(locale)} kr</strong> {t.swishTo}{" "}
              <strong className="font-mono">{p.swish_number}</strong>
            </p>
            {payment.ref && (
              <p className="mt-2">
                {t.swishRef}: <strong className="font-mono">{payment.ref}</strong>
              </p>
            )}
            {payment.expiresAt && (
              <p className="mt-2">
                {t.expires} <strong>{deadline(payment.expiresAt)}</strong> ({t.swedishTime}).
              </p>
            )}
            {refresh}
          </Status>
        )}
        {!cancelled && !expired && data.phase && (
          <Status title={t[data.phase]}>
            <p>
              {data.accessAvailable === false
                ? pending
                  ? t.accessPayment
                  : t.accessLater
                : t.stayInfo}
            </p>
            {refresh}
          </Status>
        )}

        {!cancelled && !!data.addons?.length && (
          <section className="mt-8 space-y-3">
            <h2 className="font-[Fraunces] text-2xl">{t.addons}</h2>
            {data.addons.map((addon) => (
              <article
                key={addon.id}
                className="rounded-xl border p-4"
                style={{ borderColor: C.line }}
              >
                <h3 className="font-semibold">
                  {localizedAddonText(addon, lang).name} · {addon.quantity} {t.quantity}
                </h3>
                {localizedAddonText(addon, lang).description && (
                  <p className="mt-2 whitespace-pre-wrap text-sm" style={{ color: C.muted }}>
                    {localizedAddonText(addon, lang).description}
                  </p>
                )}
                {addonVatLabel(addon.vatRate, lang) && (
                  <p className="mt-1 text-xs" style={{ color: C.muted }}>
                    {addonVatLabel(addon.vatRate, lang)}
                  </p>
                )}
                <p className="mt-1 text-sm">
                  {addon.contextChanged
                    ? t.addonChanged
                    : addon.status === "done"
                      ? t.delivered
                      : addon.status === "in_progress"
                        ? t.preparing
                        : t.booked}
                </p>
                <p className="mt-1 text-sm" style={{ color: C.muted }}>
                  {t.planned}: {date(addon.dueDate)}
                </p>
                {addon.nameSource === "current_catalog" && (
                  <p className="mt-1 text-xs" style={{ color: C.muted }}>
                    {t.oldAddon}
                  </p>
                )}
              </article>
            ))}
          </section>
        )}

        {data.unit?.checkin_instructions && (
          <Section title={`${t.findUnit} ${data.unit.name}`}>
            {data.unit.checkin_instructions}
          </Section>
        )}
        {!cancelled && !expired && (
          <section className="mt-10">
            <p className={eyebrow} style={{ color: C.muted }}>
              {t.practical}
            </p>
            <div className="mt-3 divide-y border-y" style={{ borderColor: C.line }}>
              {data.unit?.door_code && (
                <Row label={t.doorCode}>
                  <span className="font-mono text-[16px] tracking-[0.25em]">
                    {data.unit.door_code}
                  </span>
                </Row>
              )}
              {p.wifi_name && (
                <Row label={t.wifi}>
                  <button
                    onClick={() => copy(p.wifi_password ?? "", "wifi")}
                    className="min-h-11 text-right"
                  >
                    <span className="block text-[15px] font-medium">{p.wifi_name}</span>
                    <span
                      className="mt-0.5 flex items-center justify-end gap-1.5 text-[12px]"
                      style={{ color: C.muted }}
                    >
                      {copiedField === "wifi" ? (
                        <>
                          <Check size={12} /> {t.passwordCopied}
                        </>
                      ) : (
                        <>
                          <Copy size={12} /> {p.wifi_password} · {t.copy}
                        </>
                      )}
                    </span>
                  </button>
                </Row>
              )}
              <Row label={t.checkin}>
                <span className="text-[15px] font-medium">
                  {t.from} {p.checkin_time}
                </span>
                <span className="block text-[12px]" style={{ color: C.muted }}>
                  {date(data.checkinDate)}
                </span>
              </Row>
              <Row label={t.checkout}>
                <span className="text-[15px] font-medium">
                  {t.until} {p.checkout_time}
                </span>
                <span className="block text-[12px]" style={{ color: C.muted }}>
                  {date(data.checkoutDate)}
                </span>
              </Row>
            </div>
          </section>
        )}
        {p.directions && <Section title={t.directions}>{p.directions}</Section>}
        {p.house_rules && <Section title={t.houseRules}>{p.house_rules}</Section>}
        {p.contact_phone && (
          <a
            href={`tel:${p.contact_phone.replace(/\s/g, "")}`}
            className="mt-10 flex items-center justify-between border-y py-4"
            style={{ borderColor: C.line }}
          >
            <span>
              <span className="block text-[12px]" style={{ color: C.muted }}>
                {t.contact}
              </span>
              <span className="text-[16px] font-medium">{p.contact_phone}</span>
            </span>
            <span className="text-[18px]" style={{ color: C.muted }}>
              →
            </span>
          </a>
        )}
        <p className="mt-14 text-center text-[12px]" style={{ color: C.muted }}>
          {t.powered}
        </p>
      </motion.main>
    </div>
  );
}

function Status({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <section className="mt-8 rounded-2xl border p-5" style={{ borderColor: C.line }}>
      <h2 className="text-lg font-semibold">{title}</h2>
      {children && (
        <div className="mt-2 text-sm leading-relaxed" style={{ color: C.muted }}>
          {children}
        </div>
      )}
    </section>
  );
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-4">
      <span className={eyebrow} style={{ color: C.muted }}>
        {label}
      </span>
      <span className="text-right">{children}</span>
    </div>
  );
}
function Section({ title, children }: { title: string; children: string }) {
  return (
    <section className="mt-10">
      <p className={eyebrow} style={{ color: C.muted }}>
        {title}
      </p>
      <p
        className="mt-3 whitespace-pre-line border-t pt-4 text-[15px] leading-relaxed"
        style={{ borderColor: C.line }}
      >
        {children}
      </p>
    </section>
  );
}

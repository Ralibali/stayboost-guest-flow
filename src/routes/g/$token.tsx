import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase, supabaseConfigured } from "@/lib/supabase";

export const Route = createFileRoute("/g/$token")({
  component: GuestPage,
});

const C = { bg: "#FAFAF8", ink: "#1B1B19", muted: "#777772", line: "#E2E2DC" } as const;
const eyebrow = "text-[11px] font-semibold uppercase tracking-[0.18em]";

type GuestData = {
  guestName: string | null;
  checkinDate: string;
  checkoutDate: string;
  unit: { name: string; door_code: string | null; checkin_instructions: string | null } | null;
  property: {
    name: string;
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
    status: string;
    amount: number | null;
    ref: string | null;
    expiresAt: string | null;
  } | null;
};

const svLong = (iso: string) =>
  new Date(iso + "T12:00:00").toLocaleDateString("sv-SE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

function GuestPage() {
  const { token } = Route.useParams();
  const [state, setState] = useState<"loading" | "ok" | "notfound">("loading");
  const [data, setData] = useState<GuestData | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [justPaid] = useState(
    () => new URLSearchParams(window.location.search).get("paid") === "1",
  );
  const [polls, setPolls] = useState(0);

  useEffect(() => {
    if (!supabaseConfigured || !supabase) {
      setState("notfound");
      return;
    }
    let cancelled = false;
    supabase.functions
      .invoke("guest-page", { body: { token } })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data || (data as { error?: string }).error) setState("notfound");
        else {
          setData(data as GuestData);
          setState("ok");
        }
      })
      .catch(() => !cancelled && setState("notfound"));
    return () => {
      cancelled = true;
    };
  }, [token, polls]);

  useEffect(() => {
    if (!justPaid || data?.payment?.status !== "pending" || polls >= 6) return;
    const timer = setTimeout(() => setPolls((p) => p + 1), 8000);
    return () => clearTimeout(timer);
  }, [justPaid, data, polls]);

  const copy = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  };

  if (state === "loading") {
    return (
      <div className="grid min-h-screen place-items-center" style={{ background: C.bg }}>
        <div
          className="h-9 w-9 animate-spin rounded-full border-2 border-t-transparent"
          style={{ borderColor: C.line, borderTopColor: "transparent" }}
        />
      </div>
    );
  }

  if (state === "notfound" || !data) {
    return (
      <div
        className="grid min-h-screen place-items-center px-6 text-center"
        style={{ background: C.bg, color: C.ink }}
      >
        <div>
          <p className="font-[Fraunces] text-3xl">Länken är inte giltig längre</p>
          <p className="mt-3 text-[15px]" style={{ color: C.muted }}>
            Kontakta boendet om du behöver en ny länk till gästsidan.
          </p>
        </div>
      </div>
    );
  }

  const p = data.property;
  const expires = data.payment?.expiresAt ? new Date(data.payment.expiresAt) : null;

  return (
    <div className="min-h-screen pb-20" style={{ background: C.bg, color: C.ink }}>
      <motion.main
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="mx-auto max-w-xl px-5 pt-14"
      >
        <header className="border-b pb-8" style={{ borderColor: C.line }}>
          <p className={eyebrow} style={{ color: C.muted }}>
            Välkommen till
          </p>
          <h1 className="mt-3 font-[Fraunces] text-[36px] leading-[1.1]">{p.name}</h1>
          <p className="mt-4 text-[15px]">
            <span style={{ color: C.muted }}>Gäst </span>
            <span className="font-medium">{data.guestName ?? "Välkommen"}</span>
          </p>
          <p className="mt-1 text-[15px]">
            {svLong(data.checkinDate)}–{svLong(data.checkoutDate)}
          </p>
          {data.unit && (
            <p className="mt-1 text-[14px]" style={{ color: C.muted }}>
              {data.unit.name}
            </p>
          )}
          <div
            className="mt-6 grid grid-cols-2 gap-4 border-t pt-5"
            style={{ borderColor: C.line }}
          >
            <div>
              <p className={eyebrow} style={{ color: C.muted }}>
                Incheckning
              </p>
              <p className="mt-1.5 text-[16px] font-medium">från {p.checkin_time}</p>
            </div>
            <div>
              <p className={eyebrow} style={{ color: C.muted }}>
                Utcheckning
              </p>
              <p className="mt-1.5 text-[16px] font-medium">senast {p.checkout_time}</p>
            </div>
          </div>
        </header>

        {data.payment?.status === "paid" && (
          <div
            className="mt-8 flex items-center gap-3 border px-5 py-4"
            style={{ borderColor: C.ink }}
          >
            <Check size={16} />
            <div>
              <p className="text-[14px] font-semibold">Betalningen är mottagen</p>
              <p className="text-[13px]" style={{ color: C.muted }}>
                Din bokning är bekräftad och betald.
              </p>
            </div>
          </div>
        )}

        {justPaid && data.payment?.status === "pending" && (
          <div className="mt-8 border px-5 py-4" style={{ borderColor: C.line }}>
            <p className="text-[14px] font-semibold">Din betalning behandlas</p>
            <p className="text-[13px]" style={{ color: C.muted }}>
              Sidan uppdateras automatiskt när Stripe har bekräftat betalningen.
            </p>
          </div>
        )}

        {data.payment?.status === "pending" && data.payment.amount && p.swish_number && (
          <div className="mt-8 border px-5 py-4" style={{ borderColor: C.ink }}>
            <p className={eyebrow} style={{ color: C.muted }}>
              Betala med Swish
            </p>
            <p className="mt-2 text-[14px] leading-relaxed" style={{ color: C.muted }}>
              Swisha{" "}
              <strong style={{ color: C.ink }}>
                {data.payment.amount.toLocaleString("sv-SE")} kr
              </strong>{" "}
              till{" "}
              <span className="font-mono font-semibold" style={{ color: C.ink }}>
                {p.swish_number}
              </span>
              {data.payment.ref && (
                <>
                  {" "}
                  och märk betalningen med{" "}
                  <span className="font-mono font-semibold" style={{ color: C.ink }}>
                    {data.payment.ref}
                  </span>
                </>
              )}
              .
              {expires && (
                <>
                  {" "}
                  Datumen reserveras till{" "}
                  <strong style={{ color: C.ink }}>
                    {expires.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}
                  </strong>
                  .
                </>
              )}
            </p>
          </div>
        )}

        {data.unit?.checkin_instructions && (
          <Section title={`Hitta till ${data.unit.name}`}>{data.unit.checkin_instructions}</Section>
        )}

        <section className="mt-10">
          <p className={eyebrow} style={{ color: C.muted }}>
            Praktiskt
          </p>
          <div className="mt-3 divide-y border-y" style={{ borderColor: C.line }}>
            {data.unit?.door_code && (
              <Row label="Portkod">
                <span className="font-mono text-[16px] tracking-[0.25em]">
                  {data.unit.door_code}
                </span>
              </Row>
            )}
            {p.wifi_name && (
              <Row label="Wifi">
                <button onClick={() => copy(p.wifi_password ?? "", "wifi")} className="text-right">
                  <span className="block text-[15px] font-medium">{p.wifi_name}</span>
                  <span
                    className="mt-0.5 flex items-center justify-end gap-1.5 text-[12px]"
                    style={{ color: C.muted }}
                  >
                    {copiedField === "wifi" ? (
                      <>
                        <Check size={12} /> Lösenord kopierat
                      </>
                    ) : (
                      <>
                        <Copy size={12} /> {p.wifi_password} · kopiera
                      </>
                    )}
                  </span>
                </button>
              </Row>
            )}
            <Row label="Incheckning">
              <span className="text-[15px] font-medium">från {p.checkin_time}</span>
              <span className="block text-[12px]" style={{ color: C.muted }}>
                {svLong(data.checkinDate)}
              </span>
            </Row>
            <Row label="Utcheckning">
              <span className="text-[15px] font-medium">senast {p.checkout_time}</span>
              <span className="block text-[12px]" style={{ color: C.muted }}>
                {svLong(data.checkoutDate)}
              </span>
            </Row>
          </div>
        </section>

        {p.directions && <Section title="Hitta hit">{p.directions}</Section>}
        {p.house_rules && <Section title="Husregler">{p.house_rules}</Section>}

        {p.contact_phone && (
          <a
            href={`tel:${p.contact_phone.replace(/\s/g, "")}`}
            className="mt-10 flex items-center justify-between border-y py-4"
            style={{ borderColor: C.line }}
          >
            <span>
              <span className="block text-[12px]" style={{ color: C.muted }}>
                Frågor? Ring oss gärna
              </span>
              <span className="text-[16px] font-medium">{p.contact_phone}</span>
            </span>
            <span className="text-[18px]" style={{ color: C.muted }}>
              →
            </span>
          </a>
        )}

        <p className="mt-14 text-center text-[12px]" style={{ color: C.muted }}>
          Gästsida via StayBoost
        </p>
      </motion.main>
    </div>
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

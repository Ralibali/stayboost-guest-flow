import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Clock, DoorOpen, House, KeyRound, MapPin, Phone, Wifi } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase, supabaseConfigured } from "@/lib/supabase";

export const Route = createFileRoute("/g/$token")({
  component: GuestPage,
});

type GuestData = {
  guestName: string | null;
  checkinDate: string;
  checkoutDate: string;
  unit: { name: string; door_code: string | null } | null;
  property: {
    name: string;
    checkin_time: string;
    checkout_time: string;
    directions: string | null;
    wifi_name: string | null;
    wifi_password: string | null;
    house_rules: string | null;
    contact_phone: string | null;
  };
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

  useEffect(() => {
    if (!supabaseConfigured || !supabase) {
      setState("notfound");
      return;
    }
    supabase.functions
      .invoke("guest-page", { body: { token } })
      .then(({ data, error }) => {
        if (error || !data || (data as { error?: string }).error) setState("notfound");
        else {
          setData(data as GuestData);
          setState("ok");
        }
      })
      .catch(() => setState("notfound"));
  }, [token]);

  const copy = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  };

  if (state === "loading") {
    return (
      <div className="grid min-h-screen place-items-center bg-[color:var(--bg)]">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-[color:var(--line)] border-t-[color:var(--forest)]" />
      </div>
    );
  }

  if (state === "notfound" || !data) {
    return (
      <div className="grid min-h-screen place-items-center bg-[color:var(--bg)] px-6 text-center">
        <div>
          <p className="font-[Fraunces] text-3xl font-semibold">Länken är inte giltig längre</p>
          <p className="mt-3 text-[15px] text-[color:var(--ink)]/60">
            Kontakta oss gärna direkt om du behöver en ny länk till din gästsida.
          </p>
        </div>
      </div>
    );
  }

  const p = data.property;

  return (
    <div className="min-h-screen bg-[color:var(--bg)] pb-16">
      <div className="mx-auto max-w-md px-4 pt-6">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="overflow-hidden rounded-[24px] bg-[color:var(--forest)] text-white shadow-[0_20px_50px_rgba(20,36,28,0.25)]"
        >
          <div className="p-6 pb-5">
            <p className="text-[12px] uppercase tracking-wide text-white/60">Välkommen till</p>
            <h1 className="mt-1 font-[Fraunces] text-[26px] font-semibold leading-tight">
              {p.name}
            </h1>
            <div className="mt-4 rounded-2xl bg-white/10 px-4 py-3">
              <div className="text-[12px] uppercase tracking-wide text-white/60">Gäst</div>
              <div className="font-semibold">{data.guestName ?? "Välkommen"}</div>
              <div className="mt-2 text-[14px] text-white/85">
                {svLong(data.checkinDate)} – {svLong(data.checkoutDate)}
              </div>
              {data.unit && (
                <div className="mt-1 text-[13px] text-white/70">🏠 {data.unit.name}</div>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between bg-[color:var(--brass)] px-6 py-3.5 text-[14px] font-medium">
            <span className="flex items-center gap-2">
              <Clock size={15} /> Incheckning från {p.checkin_time}
            </span>
            <span>Ut {p.checkout_time}</span>
          </div>
        </motion.div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          {data.unit?.door_code && (
            <InfoCard icon={KeyRound} label="Portkod" value={data.unit.door_code} mono />
          )}
          {p.wifi_name && (
            <button onClick={() => copy(p.wifi_password ?? "", "wifi")} className="text-left">
              <InfoCard
                icon={Wifi}
                label="Wifi"
                value={p.wifi_name}
                hint={
                  copiedField === "wifi"
                    ? "✓ Lösenord kopierat!"
                    : `Lösen: ${p.wifi_password ?? ""} · tryck för att kopiera`
                }
              />
            </button>
          )}
          <InfoCard
            icon={DoorOpen}
            label="Incheckning"
            value={p.checkin_time}
            hint={svLong(data.checkinDate)}
          />
          <InfoCard
            icon={Clock}
            label="Utcheckning"
            value={p.checkout_time}
            hint={svLong(data.checkoutDate)}
          />
        </div>

        {p.directions && (
          <Section icon={MapPin} title="Hitta hit">
            <p className="whitespace-pre-line text-[14px] leading-relaxed text-[color:var(--ink)]/75">
              {p.directions}
            </p>
          </Section>
        )}

        {p.house_rules && (
          <Section icon={House} title="Husregler">
            <p className="whitespace-pre-line text-[14px] leading-relaxed text-[color:var(--ink)]/75">
              {p.house_rules}
            </p>
          </Section>
        )}

        {p.contact_phone && (
          <a
            href={`tel:${p.contact_phone.replace(/\s/g, "")}`}
            className="card-surface mt-4 flex items-center gap-3 p-4"
          >
            <span className="grid h-10 w-10 place-items-center rounded-full bg-[color:var(--forest)] text-white">
              <Phone size={17} />
            </span>
            <span>
              <span className="block text-[13px] text-[color:var(--ink)]/55">Frågor? Ring oss</span>
              <span className="text-[15px] font-semibold">{p.contact_phone}</span>
            </span>
          </a>
        )}

        <p className="mt-8 text-center text-[12px] text-[color:var(--ink)]/40">
          Gästsida via StayBoost
        </p>
      </div>
    </div>
  );
}

function InfoCard({
  icon: Icon,
  label,
  value,
  hint,
  mono,
}: {
  icon: typeof KeyRound;
  label: string;
  value: string;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <div className="card-surface h-full p-4">
      <div className="flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-wide text-[color:var(--ink)]/50">
        <Icon size={13} />
        {label}
      </div>
      <div
        className={`mt-1.5 break-words text-[17px] font-semibold leading-tight ${mono ? "font-mono tracking-widest" : ""}`}
      >
        {value}
      </div>
      {hint && (
        <div className="mt-1 text-[12px] leading-snug text-[color:var(--ink)]/50">{hint}</div>
      )}
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof MapPin;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card-surface mt-4 p-5">
      <div className="flex items-center gap-2 font-semibold">
        <Icon size={16} className="text-[color:var(--brass)]" />
        {title}
      </div>
      <div className="mt-2.5">{children}</div>
    </div>
  );
}

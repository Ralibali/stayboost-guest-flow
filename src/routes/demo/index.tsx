import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BedDouble,
  CalendarDays,
  CalendarRange,
  ChartColumn,
  CircleUserRound,
  ClipboardList,
  ContactRound,
  Croissant,
  Gift,
  Globe,
  KeyRound,
  LayoutDashboard,
  MessageSquareText,
  Sun,
  Users,
} from "lucide-react";
import { PROPERTY } from "@/lib/demo-data";

export const Route = createFileRoute("/demo/")({
  component: DemoIndex,
});

const CARDS = [
  {
    to: "/demo/gast",
    icon: BedDouble,
    role: "Gästens vy",
    title: "Gästhubben",
    body: "Allt gästen behöver på en länk — portkod, wifi, husregler och en tillvalskatalog med mat, upplevelser och hyra som bokas med ett tryck.",
    tag: "Mobilanpassad webbapp",
  },
  {
    to: "/demo/boka",
    icon: CalendarDays,
    role: "Gästens vy",
    title: "Bokningsmotorn",
    body: "Komplett bokningsflöde i BookVisit-klass: kalender med priser, enheter, tillval och betalning — provisionsfritt.",
    tag: "Ny: egen bokningsmotor",
  },
  {
    to: "/demo/incheckning",
    icon: KeyRound,
    role: "Gästens vy",
    title: "Digital incheckning",
    body: "Tre steg vid ankomst: bekräfta uppgifter, godkänn husregler — få portkoden direkt.",
    tag: "Ingen reception behövs",
  },
  {
    to: "/demo/min-sida",
    icon: CircleUserRound,
    role: "Gästens vy",
    title: "Min sida",
    body: "Gästen bokar om själv, köper tillval i efterhand och avbokar — utan att ringa dig.",
    tag: "Som BookSpots Min Sida",
  },
  {
    to: "/demo/presentkort",
    icon: Gift,
    role: "Gästens vy",
    title: "Presentkort",
    body: "Sälj presentkort online med vacker design — mottagaren löser in direkt i bokningsflödet.",
    tag: "BookSpot-favorit",
  },
  {
    to: "/demo/frukost",
    icon: Croissant,
    role: "Personalens vy",
    title: "Frukostvyn",
    body: "Morgondagens portioner per enhet, allergier markerade i rött, leveranslista att bocka av.",
    tag: "Rollinloggning för personal",
  },
  {
    to: "/demo/stad",
    icon: ClipboardList,
    role: "Personalens vy",
    title: "Städvyn",
    body: "Dagens enheter med status, exakta checklistor och tidsfönster — uppdateras i realtid.",
    tag: "Rollinloggning för personal",
  },
  {
    to: "/demo/manifest",
    icon: Sun,
    role: "Personalens vy",
    title: "Dagens manifest",
    body: "Dagvyn för hela teamet: ankomster, avresor, kapacitet och allt som ska förberedas.",
    tag: "Som BookSpots Manifest",
  },
  {
    to: "/demo/personal",
    icon: Users,
    role: "Personalens vy",
    title: "Personalresurser",
    body: "Roller, veckoscheman och tilldelning — varje teammedlem ser bara sin egen vy.",
    tag: "Assigned staff à la BookSpot",
  },
  {
    to: "/demo/admin",
    icon: LayoutDashboard,
    role: "Ägarens vy",
    title: "Ägaröversikt",
    body: "Merförsäljning i realtid, orderflöde och tillvalskatalogen — skapa egna tillval och ta provision på lokala partners.",
    tag: "Hjärtat i StayBoost",
  },
  {
    to: "/demo/bokningar",
    icon: CalendarRange,
    role: "Ägarens vy",
    title: "Bokningskalender",
    body: "Beläggning per enhet, kommande bokningar och manuella bokningar — allt på ett ställe.",
    tag: "Kanalhanterare inbyggd",
  },
  {
    to: "/demo/kanaler",
    icon: Globe,
    role: "Ägarens vy",
    title: "Kanalhanterare",
    body: "Booking.com, Airbnb och egen motor i ett lager — realtidssynk utan dubbelbokningar.",
    tag: "Sirvoy-ersättaren",
  },
  {
    to: "/demo/rapporter",
    icon: ChartColumn,
    role: "Ägarens vy",
    title: "Rapporter",
    body: "Bokningsvärde över tid, kanalfördelning, ADR och RevPAR — besluten blir enkla.",
    tag: "Backoffice à la BookSpot",
  },
  {
    to: "/demo/gaster",
    icon: ContactRound,
    role: "Ägarens vy",
    title: "Gästregister",
    body: "CRM för gästerna: historik, taggar, noteringar och vem som är värd en extra kram.",
    tag: "Bygg återkommande gäster",
  },
] as const;

function DemoIndex() {
  return (
    <div>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
        className="max-w-2xl"
      >
        <p className="eyebrow">Interaktiv produktdemo</p>
        <h1 className="mt-3" style={{ fontSize: "clamp(2rem, 4vw, 3rem)" }}>
          Testa hela StayBoost — precis som gästen, personalen och ägaren ser det.
        </h1>
        <p className="mt-4 text-[color:var(--ink)]/70">
          Demon är laddat med testdata från fiktiva {PROPERTY.name}. Klicka dig fritt mellan vyerna
          — allt fungerar, men inget bokas på riktigt.
        </p>
      </motion.div>

      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map((c, i) => {
          const Icon = c.icon;
          return (
            <motion.div
              key={c.to}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.06 * i }}
            >
              <Link
                to={c.to}
                className="card-surface group flex h-full flex-col p-7 transition hover:-translate-y-1 hover:shadow-[0_18px_45px_rgba(20,36,28,0.12)]"
              >
                <div className="flex items-center justify-between">
                  <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[color:var(--forest)] text-white">
                    <Icon size={22} strokeWidth={1.8} />
                  </span>
                  <span className="rounded-full border border-[color:var(--line)] px-2.5 py-1 text-[11px] font-medium text-[color:var(--ink)]/60">
                    {c.role}
                  </span>
                </div>
                <h2 className="mt-5 text-xl">{c.title}</h2>
                <p className="mt-2 flex-1 text-[15px] text-[color:var(--ink)]/70">{c.body}</p>
                <div className="mt-5 flex items-center justify-between">
                  <span className="text-[12px] font-medium uppercase tracking-wide text-[color:var(--ink)]/45">
                    {c.tag}
                  </span>
                  <span className="flex items-center gap-1 text-sm font-semibold text-[color:var(--brass)]">
                    Öppna
                    <ArrowRight
                      size={15}
                      className="transition-transform group-hover:translate-x-1"
                    />
                  </span>
                </div>
              </Link>
            </motion.div>
          );
        })}

        {/* Sms-kort */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.3 }}
        >
          <div className="flex h-full flex-col rounded-[20px] border border-[color:var(--forest)]/20 bg-[color:var(--forest)] p-7 text-white">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/10">
              <MessageSquareText size={22} strokeWidth={1.8} />
            </span>
            <h2 className="mt-5 text-xl text-white">Sms-flödet</h2>
            <p className="mt-2 flex-1 text-[15px] text-white/75">
              Gästen får allt via sms och svarar JA direkt i tråden — eller trycker på länken till
              gästhubben. Ingen app, ingen inloggning.
            </p>
            <div className="mt-5 rounded-xl bg-white/10 p-4 text-[13px] leading-relaxed text-white/85">
              <p className="font-semibold text-white">StayBoost · {PROPERTY.name}</p>
              <p className="mt-1.5">
                Hej Anna! Välkommen i morgon 🌲 Vill du ha frukostkorgen levererad? 249 kr — svara
                JA eller boka i gästhubben.
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

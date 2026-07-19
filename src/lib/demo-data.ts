/**
 * Delad demol data för StayBoost-produktdemon.
 * All data är fiktiv men realistisk för "Bergs Slussar Glamping" vid Göta kanal.
 * Datum räknas relativt dagens datum så demon alltid känns levande.
 */

export type Unit = {
  id: string;
  name: string;
  type: "stuga" | "tält";
  doorCode: string;
  wifi: string;
  wifiPassword: string;
};

export type Guest = {
  id: string;
  name: string;
  phone: string;
  unitId: string;
  checkIn: Date;
  checkOut: Date;
  guests: number;
  checkedIn: boolean;
  language: "sv" | "en" | "de";
};

export type AddonCategory = "mat" | "upplevelse" | "hyra" | "praktiskt";

export type Addon = {
  id: string;
  name: string;
  description: string;
  price: number;
  emoji: string;
  category: AddonCategory;
  active: boolean;
  soldThisMonth: number;
  /** Lokal partner som levererar tillvalet — ägaren behåller sharePct i provision. */
  partner?: { name: string; sharePct: number };
};

export const ADDON_CATEGORY_LABELS: Record<AddonCategory, string> = {
  mat: "Mat & dryck",
  upplevelse: "Upplevelser",
  hyra: "Hyra & låna",
  praktiskt: "Praktiskt",
};

export type Order = {
  id: string;
  guestName: string;
  unitName: string;
  addonId: string;
  qty: number;
  total: number;
  time: Date;
  status: "ny" | "bekräftad" | "levererad";
};

export type BreakfastPrep = {
  unitId: string;
  guestName: string;
  portions: number;
  allergies: string[];
  deliveryTime: string;
  note?: string;
  status: "att_laga" | "lagas" | "levererad";
};

export type CleaningTask = {
  unitId: string;
  type: "avresa" | "storstäd" | "påsläpp";
  window: string;
  status: "väntar" | "pågår" | "klar";
  checklist: { label: string; done: boolean }[];
  note?: string;
};

/* ---------- Hjälp ---------- */
const at = (daysFromNow: number, h = 12, m = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(h, m, 0, 0);
  return d;
};

export const fmtDate = (d: Date) =>
  d.toLocaleDateString("sv-SE", { day: "numeric", month: "short" });

export const fmtDateLong = (d: Date) =>
  d.toLocaleDateString("sv-SE", { weekday: "long", day: "numeric", month: "long" });

export const fmtTime = (d: Date) =>
  d.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });

export const fmtKr = (n: number) => `${n.toLocaleString("sv-SE")} kr`;

/* ---------- Anläggning ---------- */
export const PROPERTY = {
  name: "Bergs Slussar Glamping",
  place: "Göta kanal, Östergötland",
  checkInTime: "15:00",
  checkOutTime: "11:00",
};

export const UNITS: Unit[] = [
  {
    id: "sjobris",
    name: "Sjöbrisretreatet",
    type: "stuga",
    doorCode: "4482",
    wifi: "Slussar_Guest",
    wifiPassword: "kanal2026",
  },
  {
    id: "naturkarnan",
    name: "Naturkärnan",
    type: "tält",
    doorCode: "7715",
    wifi: "Slussar_Guest",
    wifiPassword: "kanal2026",
  },
  {
    id: "lugnetsyta",
    name: "Lugnets yta",
    type: "tält",
    doorCode: "2290",
    wifi: "Slussar_Guest",
    wifiPassword: "kanal2026",
  },
  {
    id: "sjobris",
    name: "Sjöbrisretreatet",
    type: "stuga",
    doorCode: "9034",
    wifi: "Slussar_Guest",
    wifiPassword: "kanal2026",
  },
  {
    id: "naturkarnan",
    name: "Naturkärnan",
    type: "tält",
    doorCode: "5561",
    wifi: "Slussar_Guest",
    wifiPassword: "kanal2026",
  },
];

/* ---------- Gäster & bokningar ---------- */
export const GUESTS: Guest[] = [
  {
    id: "g1",
    name: "Anna Lindqvist",
    phone: "+46 70 123 45 67",
    unitId: "sjobris",
    checkIn: at(0),
    checkOut: at(2),
    guests: 2,
    checkedIn: false,
    language: "sv",
  },
  {
    id: "g2",
    name: "Familj Johansson",
    phone: "+46 73 555 12 12",
    unitId: "naturkarnan",
    checkIn: at(0),
    checkOut: at(3),
    guests: 4,
    checkedIn: false,
    language: "sv",
  },
  {
    id: "g3",
    name: "Erik & Malin Berg",
    phone: "+46 76 987 65 43",
    unitId: "lugnetsyta",
    checkIn: at(1),
    checkOut: at(3),
    guests: 2,
    checkedIn: false,
    language: "sv",
  },
  {
    id: "g4",
    name: "Familj Schneider",
    phone: "+49 171 555 8899",
    unitId: "sjobris",
    checkIn: at(-1),
    checkOut: at(1),
    guests: 3,
    checkedIn: true,
    language: "de",
  },
  {
    id: "g5",
    name: "Lisa Holm",
    phone: "+46 70 444 22 11",
    unitId: "naturkarnan",
    checkIn: at(-2),
    checkOut: at(0),
    guests: 2,
    checkedIn: true,
    language: "sv",
  },
];

export const unitOf = (unitId: string) => UNITS.find((u) => u.id === unitId)!;

/* ---------- Tillval (katalogen — utökningsbar i admin) ---------- */
export const ADDONS: Addon[] = [
  {
    id: "frukost",
    name: "Frukostkorg",
    description: "Levereras till dörren kl 08:00 — nybakat, ost, ägg, juice och kokkaffe.",
    price: 249,
    emoji: "🥐",
    category: "mat",
    active: true,
    soldThisMonth: 34,
  },
  {
    id: "sen-utcheckning",
    name: "Sen utcheckning",
    description: "Stanna till kl 13:00 i stället för 11:00. Sovmorgon på riktigt.",
    price: 150,
    emoji: "😴",
    category: "praktiskt",
    active: true,
    soldThisMonth: 41,
  },
  {
    id: "bastu",
    name: "Bastutid 1 h",
    description: "Egen timme i vedeldade bastun vid kanalen. Handdukar ingår.",
    price: 350,
    emoji: "🧖",
    category: "upplevelse",
    active: true,
    soldThisMonth: 18,
  },
  {
    id: "ved",
    name: "Ved (säck)",
    description: "Torrlagrad björkved till brasan eller eldstaden. Tändstickor ingår.",
    price: 120,
    emoji: "🪵",
    category: "praktiskt",
    active: true,
    soldThisMonth: 27,
  },
  {
    id: "cykel",
    name: "Cykeluthyrning",
    description: "Cykla längs kanalen en hel dag. Karta över favoritsträckan ingår.",
    price: 200,
    emoji: "🚲",
    category: "hyra",
    active: true,
    soldThisMonth: 15,
  },
  {
    id: "vinpaket",
    name: "Vinpaket",
    description: "Kylt vin och tilltugg som väntar när ni kommer fram.",
    price: 395,
    emoji: "🍷",
    category: "mat",
    active: true,
    soldThisMonth: 9,
  },
  {
    id: "kanot",
    name: "Kanot 2 h",
    description: "Paddla från egen brygga. Flytvästar och torrsäck ingår.",
    price: 295,
    emoji: "🛶",
    category: "hyra",
    active: true,
    soldThisMonth: 6,
  },
  {
    id: "fika",
    name: "Fikapaket",
    description: "Hembullat och presskaffe, klart vid ankomst.",
    price: 89,
    emoji: "☕",
    category: "mat",
    active: true,
    soldThisMonth: 22,
  },
  {
    id: "grillpaket",
    name: "Grillpaket",
    description: "Lokalt kött, marinader, sallad och bröd — klart att lägga på grillen.",
    price: 349,
    emoji: "🍖",
    category: "mat",
    active: true,
    soldThisMonth: 12,
  },
  {
    id: "picknick",
    name: "Picknickkorg",
    description: "Packad korg för dagsutflykten: smörgåsar, frukt, kakor och kaffe på termos.",
    price: 295,
    emoji: "🧺",
    category: "mat",
    active: true,
    soldThisMonth: 8,
  },
  {
    id: "ostbricka",
    name: "Ost- & charkbricka",
    description: "Lokala ostar och charkuterier med knäckebröd och marmelad.",
    price: 225,
    emoji: "🧀",
    category: "mat",
    active: true,
    soldThisMonth: 7,
    partner: { name: "Vadstena Ost & Deli", sharePct: 15 },
  },
  {
    id: "kanaltur",
    name: "Guidad kanaltur 2 h",
    description: "Lokal guide berättar slussarnas historia — avslutas med fika vid kajen.",
    price: 450,
    emoji: "🚣",
    category: "upplevelse",
    active: true,
    soldThisMonth: 11,
    partner: { name: "Kanalens Guider", sharePct: 15 },
  },
  {
    id: "fisketur",
    name: "Fisketur med guide",
    description: "Halvdag på kanalen med guide, all utrustning och fiskekort ingår.",
    price: 495,
    emoji: "🎣",
    category: "upplevelse",
    active: true,
    soldThisMonth: 5,
    partner: { name: "Göta Fiskeguide", sharePct: 15 },
  },
  {
    id: "massage",
    name: "Massage 45 min",
    description: "Certifierad massör kommer till er enhet. Välj tid i bokningen.",
    price: 595,
    emoji: "💆",
    category: "upplevelse",
    active: true,
    soldThisMonth: 4,
    partner: { name: "Slussens Spa", sharePct: 15 },
  },
  {
    id: "yoga",
    name: "Morgonyoga vid kanalen",
    description: "Lugnt flöde på gräsmattan kl 07:30. Matta och te ingår.",
    price: 195,
    emoji: "🧘",
    category: "upplevelse",
    active: true,
    soldThisMonth: 9,
  },
  {
    id: "sup",
    name: "SUP-bräda",
    description: "Stå upp och paddla lugna kanalen. Flytväst ingår.",
    price: 250,
    emoji: "🏄",
    category: "hyra",
    active: true,
    soldThisMonth: 10,
  },
  {
    id: "fiskeutrustning",
    name: "Fiskeutrustning",
    description: "Spö, krok och bete för en dag på egen hand. Fiskekort ingår.",
    price: 150,
    emoji: "🐟",
    category: "hyra",
    active: true,
    soldThisMonth: 6,
  },
  {
    id: "tidig-incheckning",
    name: "Tidig incheckning",
    description: "Checka in från kl 12:00 i stället för 15:00.",
    price: 150,
    emoji: "🕛",
    category: "praktiskt",
    active: true,
    soldThisMonth: 16,
  },
  {
    id: "barnsang",
    name: "Barnsäng & stol",
    description: "Resesäng med lakan och barnstol — redo vid ankomst.",
    price: 95,
    emoji: "🍼",
    category: "praktiskt",
    active: true,
    soldThisMonth: 7,
  },
  {
    id: "husdjur",
    name: "Husdjurspaket",
    description: "Bädd, skålar, godis och handdukar för fyrbenta gästen.",
    price: 125,
    emoji: "🐕",
    category: "praktiskt",
    active: true,
    soldThisMonth: 8,
  },
];

/* ---------- Tillvals-store (delad, lever kvar i demosessionen) ---------- */
const addonsStore: Addon[] = [...ADDONS];

export const getAddons = () => addonsStore;

export const getAddonById = (id: string) => addonsStore.find((a) => a.id === id);

export const toggleAddonInStore = (id: string) => {
  const a = addonsStore.find((x) => x.id === id);
  if (a) a.active = !a.active;
};

export const addAddonToStore = (a: Omit<Addon, "soldThisMonth">) => {
  addonsStore.push({ ...a, soldThisMonth: 0 });
};

/** Intäkt ägaren tjänar på partnerförsäljning denna månad. */
export const partnerCommissionMonth = () =>
  addonsStore
    .filter((a) => a.partner)
    .reduce((s, a) => s + Math.round(a.soldThisMonth * a.price * (a.partner!.sharePct / 100)), 0);

/* ---------- Ordrar (livefeed i admin) ---------- */
export const ORDERS: Order[] = [
  {
    id: "o1",
    guestName: "Anna Lindqvist",
    unitName: "Sjöbrisretreatet",
    addonId: "frukost",
    qty: 2,
    total: 498,
    time: at(0, 9, 24),
    status: "bekräftad",
  },
  {
    id: "o2",
    guestName: "Familj Schneider",
    unitName: "Sjöbrisretreatet",
    addonId: "bastu",
    qty: 1,
    total: 350,
    time: at(0, 8, 51),
    status: "levererad",
  },
  {
    id: "o3",
    guestName: "Lisa Holm",
    unitName: "Naturkärnan",
    addonId: "sen-utcheckning",
    qty: 1,
    total: 150,
    time: at(0, 8, 12),
    status: "bekräftad",
  },
  {
    id: "o4",
    guestName: "Familj Johansson",
    unitName: "Naturkärnan",
    addonId: "ved",
    qty: 2,
    total: 240,
    time: at(-1, 19, 40),
    status: "levererad",
  },
  {
    id: "o5",
    guestName: "Erik & Malin Berg",
    unitName: "Lugnets yta",
    addonId: "vinpaket",
    qty: 1,
    total: 395,
    time: at(-1, 16, 3),
    status: "levererad",
  },
  {
    id: "o6",
    guestName: "Familj Schneider",
    unitName: "Sjöbrisretreatet",
    addonId: "cykel",
    qty: 2,
    total: 400,
    time: at(-1, 11, 27),
    status: "levererad",
  },
  {
    id: "o7",
    guestName: "Anna Lindqvist",
    unitName: "Sjöbrisretreatet",
    addonId: "fika",
    qty: 1,
    total: 89,
    time: at(-2, 14, 55),
    status: "levererad",
  },
];

/* ---------- Frukost (i morgon) ---------- */
export const BREAKFAST: BreakfastPrep[] = [
  {
    unitId: "sjobris",
    guestName: "Anna Lindqvist",
    portions: 2,
    allergies: ["gluten"],
    deliveryTime: "08:00",
    note: "Extra kaffe, gärna mörkrost",
    status: "att_laga",
  },
  {
    unitId: "naturkarnan",
    guestName: "Familj Johansson",
    portions: 4,
    allergies: [],
    deliveryTime: "08:15",
    note: "Två barnportioner",
    status: "att_laga",
  },
  {
    unitId: "sjobris",
    guestName: "Familj Schneider",
    portions: 3,
    allergies: ["laktos", "nötter"],
    deliveryTime: "08:00",
    status: "att_laga",
  },
];

/* ---------- Städning (i dag) ---------- */
export const CLEANING: CleaningTask[] = [
  {
    unitId: "naturkarnan",
    type: "avresa",
    window: "11:00–15:00",
    status: "väntar",
    note: "Gästen köpt sen utcheckning — ledigt först 13:00",
    checklist: [
      { label: "Bädda rent & byta handdukar", done: false },
      { label: "Dammsug & våttorka golv", done: false },
      { label: "Töm & rengör kylskåp", done: false },
      { label: "Kolla eldstad & fylla på tändstickor", done: false },
      { label: "Slå på välkomstbelysning", done: false },
    ],
  },
  {
    unitId: "naturkarnan",
    type: "påsläpp",
    window: "12:00–14:00",
    status: "pågår",
    checklist: [
      { label: "Bädda rent & byta handdukar", done: true },
      { label: "Vädra tältet & borsta innertält", done: true },
      { label: "Töm & rengör kylväska", done: false },
      { label: "Fyll på vatten & glas", done: false },
      { label: "Slå på välkomstbelysning", done: false },
    ],
  },
  {
    unitId: "sjobris",
    type: "storstäd",
    window: "13:00–16:00",
    status: "väntar",
    checklist: [
      { label: "Bädda rent & byta handdukar", done: false },
      { label: "Dammsug & våttorka golv", done: false },
      { label: "Rengör badrum & dusch", done: false },
      { label: "Fönsterputs", done: false },
    ],
  },
];

/* ---------- Meddelande-automation (admin) ---------- */
export const AUTOMATIONS = [
  {
    id: "a1",
    when: "T-2 dagar",
    time: "09:00",
    name: "Välkomstmeddelande",
    channel: "Sms",
    active: true,
    sent30d: 52,
  },
  {
    id: "a2",
    when: "Ankomstdag",
    time: "12:00",
    name: "Incheckningslänk & portkod",
    channel: "Sms",
    active: true,
    sent30d: 52,
  },
  {
    id: "a3",
    when: "Kväll 1",
    time: "17:30",
    name: "Middagstips + tillval",
    channel: "Sms",
    active: true,
    sent30d: 48,
  },
  {
    id: "a4",
    when: "Avresedagen",
    time: "08:30",
    name: "Uppmaning: sen utcheckning?",
    channel: "Sms",
    active: true,
    sent30d: 44,
  },
  {
    id: "a5",
    when: "T+1 dag",
    time: "10:00",
    name: "Tack & omdömesförfrågan",
    channel: "Sms",
    active: false,
    sent30d: 41,
  },
];

/* ---------- Admin-siffror ---------- */
export const ADMIN_STATS = {
  addonRevenueMonth: 18240,
  addonOrdersMonth: 176,
  conversionPct: 23,
  hoursSavedWeek: 5,
  occupancyPct: 87,
  revenueByWeek: [
    { vecka: "v26", kr: 3120, forra: 2480 },
    { vecka: "v27", kr: 4285, forra: 3190 },
    { vecka: "v28", kr: 5610, forra: 3425 },
    { vecka: "v29", kr: 5225, forra: 3980 },
  ],
  giftCardsSoldMonth: 12,
  giftCardsRevenueMonth: 14500,
  bundlesSoldMonth: 18,
  rebookingSoldMonth: 23,
};

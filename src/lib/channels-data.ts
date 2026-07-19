/**
 * Kanaler (channel manager), gästregister (CRM) och rapportdata.
 */

/* ---------- Kanaler ---------- */
export type Channel = {
  id: string;
  name: string;
  emoji: string;
  commissionPct: number;
  connected: boolean;
  lastSyncMin: number; // minuter sedan senaste synk
  bookingsMonth: number;
  revenueMonth: number;
  color: string;
};

export const CHANNELS: Channel[] = [
  {
    id: "direkt",
    name: "Direkt (egen motor)",
    emoji: "⚡",
    commissionPct: 0,
    connected: true,
    lastSyncMin: 0,
    bookingsMonth: 21,
    revenueMonth: 41280,
    color: "#2e7d4f",
  },
  {
    id: "booking",
    name: "Booking.com",
    emoji: "🅱️",
    commissionPct: 15,
    connected: true,
    lastSyncMin: 4,
    bookingsMonth: 17,
    revenueMonth: 33540,
    color: "#1a4fa0",
  },
  {
    id: "airbnb",
    name: "Airbnb",
    emoji: "🏠",
    commissionPct: 15,
    connected: true,
    lastSyncMin: 12,
    bookingsMonth: 9,
    revenueMonth: 15890,
    color: "#ff5a5f",
  },
  {
    id: "expedia",
    name: "Expedia",
    emoji: "✈️",
    commissionPct: 18,
    connected: false,
    lastSyncMin: 0,
    bookingsMonth: 0,
    revenueMonth: 0,
    color: "#f0b429",
  },
];

export const COMMISSION_SAVED_MONTH = 6190; // sparad provision via direktbokningar, juli
export const DIRECT_SHARE_PCT = 41;

/** iCal-exportlänkar per enhet. */
export const ICAL_FEEDS = [
  { unitId: "sjobris", url: "https://stayboost.se/ical/sjobris-x7k2.ics" },
  { unitId: "naturkarnan", url: "https://stayboost.se/ical/naturkarnan-p4m9.ics" },
  { unitId: "lugnetsyta", url: "https://stayboost.se/ical/lugnetsyta-q2w8.ics" },
  { unitId: "sjobris", url: "https://stayboost.se/ical/sjobris-z9e3.ics" },
  { unitId: "naturkarnan", url: "https://stayboost.se/ical/naturkarnan-r5t1.ics" },
];

/* ---------- Gästregister (CRM) ---------- */
export type CrmGuest = {
  id: string;
  name: string;
  phone: string;
  email: string;
  country: string;
  stays: number;
  nights: number;
  spent: number;
  lastStay: string; // "jun 2026"
  tag: "VIP" | "Återkommande" | "Ny";
  note?: string;
  history: { unit: string; period: string; total: number }[];
};

export const CRM_GUESTS: CrmGuest[] = [
  {
    id: "c1",
    name: "Familj Schneider",
    phone: "+49 171 555 8899",
    email: "fam.schneider@web.de",
    country: "🇩🇪",
    stays: 4,
    nights: 11,
    spent: 21450,
    lastStay: "jul 2026",
    tag: "VIP",
    note: "Kommer varje sommar. Gillar bastun — bjud på första timmen.",
    history: [
      { unit: "Sjöbrisretreatet", period: "jul 2026", total: 5180 },
      { unit: "Sjöbrisretreatet", period: "jul 2025", total: 5940 },
      { unit: "Sjöbrisretreatet", period: "aug 2024", total: 4890 },
    ],
  },
  {
    id: "c2",
    name: "Anna Lindqvist",
    phone: "+46 70 123 45 67",
    email: "anna@example.se",
    country: "🇸🇪",
    stays: 2,
    nights: 4,
    spent: 7240,
    lastStay: "jul 2026",
    tag: "Återkommande",
    history: [
      { unit: "Sjöbrisretreatet", period: "jul 2026", total: 3885 },
      { unit: "Naturkärnan", period: "jun 2025", total: 3355 },
    ],
  },
  {
    id: "c3",
    name: "Erik & Malin Berg",
    phone: "+46 76 987 65 43",
    email: "erik.berg@mail.se",
    country: "🇸🇪",
    stays: 1,
    nights: 2,
    spent: 2985,
    lastStay: "jul 2026",
    tag: "Ny",
    note: "Bokade vinpaket — firar årsdag.",
    history: [{ unit: "Lugnets yta", period: "jul 2026", total: 2985 }],
  },
  {
    id: "c4",
    name: "Familj Johansson",
    phone: "+46 73 555 12 12",
    email: "johansson.fam@gmail.com",
    country: "🇸🇪",
    stays: 3,
    nights: 8,
    spent: 13920,
    lastStay: "jul 2026",
    tag: "Återkommande",
    history: [
      { unit: "Naturkärnan", period: "jul 2026", total: 4780 },
      { unit: "Naturkärnan", period: "jul 2025", total: 5120 },
    ],
  },
  {
    id: "c5",
    name: "Lisa Holm",
    phone: "+46 70 444 22 11",
    email: "lisa.holm@outlook.com",
    country: "🇸🇪",
    stays: 5,
    nights: 12,
    spent: 18760,
    lastStay: "jul 2026",
    tag: "VIP",
    note: "Skriver för en reseblogg — gav oss 9,6/10 i omdöme.",
    history: [
      { unit: "Naturkärnan", period: "jul 2026", total: 3590 },
      { unit: "Sjöbrisretreatet", period: "maj 2026", total: 4480 },
      { unit: "Naturkärnan", period: "aug 2025", total: 3890 },
    ],
  },
  {
    id: "c6",
    name: "Pieter van Dijk",
    phone: "+31 6 1234 5678",
    email: "pvandijk@ziggo.nl",
    country: "🇳🇱",
    stays: 1,
    nights: 3,
    spent: 5230,
    lastStay: "jun 2026",
    tag: "Ny",
    history: [{ unit: "Sjöbrisretreatet", period: "jun 2026", total: 5230 }],
  },
  {
    id: "c7",
    name: "Karin Lindell",
    phone: "+46 70 888 99 00",
    email: "karin@lindell.se",
    country: "🇸🇪",
    stays: 2,
    nights: 5,
    spent: 8440,
    lastStay: "jun 2026",
    tag: "Återkommande",
    history: [
      { unit: "Sjöbrisretreatet", period: "jun 2026", total: 4590 },
      { unit: "Lugnets yta", period: "sep 2025", total: 3850 },
    ],
  },
];

/* ---------- Rapporter ---------- */
export const REPORT = {
  revenueYTD: 412500,
  revenueLastYearYTD: 298300,
  adr: 1490, // snittpris per såld natt
  revpar: 1120, // intäkt per tillgänglig natt
  cancelPct: 4,
  monthly: [
    { man: "jan", iAr: 8200, forra: 6400 },
    { man: "feb", iAr: 9400, forra: 7100 },
    { man: "mar", iAr: 12800, forra: 9800 },
    { man: "apr", iAr: 18600, forra: 14200 },
    { man: "maj", iAr: 32400, forra: 26100 },
    { man: "jun", iAr: 68900, forra: 54300 },
    { man: "jul", iAr: 90710, forra: 71200 },
    { man: "aug", iAr: 84500, forra: 0 },
    { man: "sep", iAr: 41200, forra: 0 },
    { man: "okt", iAr: 18900, forra: 0 },
  ],
  channelSplit: [
    { name: "Direkt", value: 41, color: "#2e7d4f" },
    { name: "Booking.com", value: 34, color: "#1a4fa0" },
    { name: "Airbnb", value: 18, color: "#ff5a5f" },
    { name: "Expedia", value: 7, color: "#f0b429" },
  ],
  addonRevenue: [
    { name: "Sen utcheckning", kr: 6150 },
    { name: "Frukostkorg", kr: 8466 },
    { name: "Bastutid", kr: 6300 },
    { name: "Ved", kr: 3240 },
    { name: "Cykeluthyrning", kr: 3000 },
    { name: "Vinpaket", kr: 3555 },
  ],
};

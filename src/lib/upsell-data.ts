/**
 * Merförsäljning à la BookSpot: presentkort, paket (bundles) och ombokningsgaranti.
 */

export type GiftCard = {
  code: string;
  buyer: string;
  recipient: string;
  amount: number;
  balance: number;
  soldDaysAgo: number;
};

/** Sålda presentkort i demon. */
export const GIFT_CARDS: GiftCard[] = [
  {
    code: "SB-ANNA26",
    buyer: "Klas Lindqvist",
    recipient: "Anna",
    amount: 1500,
    balance: 1500,
    soldDaysAgo: 2,
  },
  {
    code: "SB-MIDSOM",
    buyer: "Eva Norberg",
    recipient: "Mamma & pappa",
    amount: 1000,
    balance: 1000,
    soldDaysAgo: 5,
  },
  {
    code: "SB-SOMMA",
    buyer: "Familj Åkerman",
    recipient: "Sara",
    amount: 500,
    balance: 0,
    soldDaysAgo: 9,
  },
  {
    code: "SB-STURE",
    buyer: "Sture Berg",
    recipient: "Frun",
    amount: 2000,
    balance: 1200,
    soldDaysAgo: 12,
  },
];

/** Inlösningsbara koder i demon (presentkortskod → saldo). */
export const REDEEMABLE: Record<string, number> = {
  SOMMAR26: 1000,
  KANAL500: 500,
};

export const GIFT_CARD_PRESETS = [500, 1000, 1500, 2500];

/* ---------- Ombokningsgaranti ---------- */
export const REBOOKING_GUARANTEE = {
  id: "ombokning",
  name: "Ombokningsgaranti",
  price: 149,
  emoji: "🛡️",
  description:
    "Livet händer. Boka om din vistelse kostnadsfritt fram till 7 dagar före ankomst — utan krångel.",
  soldThisMonth: 23,
};

/* ---------- Paket (bundles) ---------- */
export type Bundle = {
  id: string;
  name: string;
  emoji: string;
  tagline: string;
  includes: { addonId: string; qty: number }[];
  price: number; // paketpris (rabatterat)
  compareAt: number; // ordinarie pris
  soldThisMonth: number;
};

export const BUNDLES: Bundle[] = [
  {
    id: "mys",
    name: "Mys-paketet",
    emoji: "🕯️",
    tagline: "Vinpaket, bastutimme och frukostkorgar — allt för en magisk kväll och morgon.",
    includes: [
      { addonId: "vinpaket", qty: 1 },
      { addonId: "bastu", qty: 1 },
      { addonId: "frukost", qty: 2 },
    ],
    price: 995,
    compareAt: 1243,
    soldThisMonth: 8,
  },
  {
    id: "familj",
    name: "Familjeäventyret",
    emoji: "🧭",
    tagline: "Frukost till alla, ved till brasan och cyklar en hel dag längs kanalen.",
    includes: [
      { addonId: "frukost", qty: 4 },
      { addonId: "ved", qty: 2 },
      { addonId: "cykel", qty: 2 },
    ],
    price: 1295,
    compareAt: 1636,
    soldThisMonth: 6,
  },
  {
    id: "vildmark",
    name: "Vildmarkspaketet",
    emoji: "🛶",
    tagline: "Kanot två timmar, ved och fikapaket — paddla, elda och fika som en kanalveteran.",
    includes: [
      { addonId: "kanot", qty: 1 },
      { addonId: "ved", qty: 1 },
      { addonId: "fika", qty: 2 },
    ],
    price: 545,
    compareAt: 693,
    soldThisMonth: 4,
  },
];

/** Sessionsköpta presentkort (syns i admin). */
const sessionGiftCards: GiftCard[] = [];
export const addSessionGiftCard = (g: GiftCard) => sessionGiftCards.unshift(g);
export const getSessionGiftCards = () => sessionGiftCards;

// StayBoost: prismotor för direktbokningar.
// Ren TypeScript utan Deno-beroenden — delas av edge-funktionen
// booking-engine, bokningssidan (/boka/$slug) och enhetstesterna.

export interface UnitPricing {
  base_price: number;
  weekend_pct: number; // påslag fre/lör-nätter, i procent
  cleaning_fee: number;
  monthly_mult: number[]; // jan..dec, i procent av baspriset
}

export interface StayQuote {
  nights: number;
  nightly: { date: string; price: number }[];
  subtotal: number;
  cleaningFee: number;
  total: number;
}

const parseIso = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
};

const isoOf = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Alla nätter i [checkin, checkout) som ISO-datum. */
export function nightsBetween(checkin: string, checkout: string): string[] {
  const { y, m, d } = parseIso(checkin);
  const out: string[] = [];
  for (let t = Date.UTC(y, m - 1, d); isoOf(t) < checkout; t += 86400000) {
    out.push(isoOf(t));
  }
  return out;
}

/** Fredags- och lördagsnätter (veckodag ur datumet, tidszonssäkert). */
export function isWeekendNight(iso: string): boolean {
  const { y, m, d } = parseIso(iso);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 5 || wd === 6;
}

/** Pris för en natt: bas × månadsfaktor × helgpåslag, avrundat till närmaste 5 kr. */
export function nightlyPrice(u: UnitPricing, iso: string): number {
  const { m } = parseIso(iso);
  const mult = (u.monthly_mult[m - 1] ?? 100) / 100;
  const weekend = isWeekendNight(iso) ? 1 + u.weekend_pct / 100 : 1;
  return Math.round((u.base_price * mult * weekend) / 5) * 5;
}

export function quoteStay(u: UnitPricing, checkin: string, checkout: string): StayQuote {
  const nightly = nightsBetween(checkin, checkout).map((date) => ({
    date,
    price: nightlyPrice(u, date),
  }));
  const subtotal = nightly.reduce((s, n) => s + n.price, 0);
  return {
    nights: nightly.length,
    nightly,
    subtotal,
    cleaningFee: u.cleaning_fee,
    total: subtotal + u.cleaning_fee,
  };
}

/** Överlappar [aFrom,aTo) och [bFrom,bTo)? */
export function rangesOverlap(aFrom: string, aTo: string, bFrom: string, bTo: string): boolean {
  return aFrom < bTo && bFrom < aTo;
}

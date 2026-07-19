/**
 * Tillval (add-ons): typer + prisberäkning.
 * Ren TS utan Deno-beroenden — delas av edge functions och vitest.
 */

export type AddonPriceType = "per_booking" | "per_night";

export interface Addon {
  id: string;
  name: string;
  description: string | null;
  price: number; // kr
  price_type: AddonPriceType;
  image_url: string | null;
  active: boolean;
  sort_order: number;
}

/** Ett valt tillval i en bokningsförfrågan. */
export interface AddonSelection {
  id: string;
  quantity: number;
}

export interface PricedAddon {
  addon: Addon;
  quantity: number;
  /** Radtotal i kr (pris × antal [× nätter]). */
  lineTotal: number;
}

/** Pris för en tillvalsrad givet antal nätter. */
export function addonLineTotal(addon: Addon, quantity: number, nights: number): number {
  const base = addon.price * Math.max(1, quantity);
  return addon.price_type === "per_night" ? base * Math.max(1, nights) : base;
}

/**
 * Prissätt en lista val mot tillgängliga tillval.
 * Okända/inaktiva id:n ignoreras (motorn får aldrig lita på klienten).
 */
export function priceAddons(
  selections: AddonSelection[],
  available: Addon[],
  nights: number,
): PricedAddon[] {
  const byId = new Map(available.filter((a) => a.active).map((a) => [a.id, a]));
  const priced: PricedAddon[] = [];
  for (const sel of selections) {
    const addon = byId.get(sel.id);
    const quantity = Math.floor(sel.quantity);
    if (!addon || !Number.isFinite(quantity) || quantity < 1 || quantity > 20) continue;
    priced.push({ addon, quantity, lineTotal: addonLineTotal(addon, quantity, nights) });
  }
  return priced;
}

export function sumAddons(priced: PricedAddon[]): number {
  return priced.reduce((s, p) => s + p.lineTotal, 0);
}

/** Kort prisetikett för listor: "250 kr" resp. "150 kr/natt". */
export function addonPriceLabel(addon: Pick<Addon, "price" | "price_type">): string {
  return `${addon.price.toLocaleString("sv-SE")} kr${addon.price_type === "per_night" ? "/natt" : ""}`;
}

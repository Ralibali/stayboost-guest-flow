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
  internal_only?: boolean;
  available_from?: string | null;
  available_to?: string | null;
  max_quantity?: number;
}

/** Perioden gäller vistelsens nätter, inte dagen då bokningen görs. */
export function addonAvailableForStay(
  addon: Pick<Addon, "internal_only" | "available_from" | "available_to" | "price_type">,
  checkin: string,
  checkout: string,
): boolean {
  if (addon.internal_only) return false;
  if (!addon.available_from && !addon.available_to) return true;
  if (!addon.available_from || !addon.available_to || !checkin || !checkout || checkout <= checkin)
    return false;
  if (addon.price_type === "per_night") {
    const lastNight = new Date(Date.parse(`${checkout}T12:00:00Z`) - 86400000)
      .toISOString()
      .slice(0, 10);
    return checkin >= addon.available_from && lastNight <= addon.available_to;
  }
  return checkin <= addon.available_to && checkout > addon.available_from;
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
  stay?: { checkin: string; checkout: string },
): PricedAddon[] {
  const byId = new Map(available.filter((a) => a.active).map((a) => [a.id, a]));
  const priced: PricedAddon[] = [];
  const seen = new Set<string>();
  for (const sel of selections) {
    if (!sel || typeof sel.id !== "string" || seen.has(sel.id)) continue;
    seen.add(sel.id);
    const addon = byId.get(sel.id);
    const quantity = sel.quantity;
    if (
      !addon ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > (addon.max_quantity ?? 20) ||
      addon.internal_only ||
      (stay && !addonAvailableForStay(addon, stay.checkin, stay.checkout))
    )
      continue;
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

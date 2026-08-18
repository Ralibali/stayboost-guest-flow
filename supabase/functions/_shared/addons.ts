/**
 * Tillval (add-ons): typer + prisberäkning.
 * Ren TS utan Deno-beroenden — delas av edge functions och vitest.
 */

export type AddonPriceType =
  | "per_booking"
  | "per_night"
  | "per_person"
  | "per_person_per_night";

export interface Addon {
  id: string;
  name: string;
  description: string | null;
  price: number; // kr
  price_type: AddonPriceType;
  image_url: string | null;
  active: boolean;
  sort_order: number;
  capacity_per_day?: number | null;
  fulfillment_note?: string | null;
}

/** Ett valt tillval i en bokningsförfrågan. Quantity = antal enheter/personer. */
export interface AddonSelection {
  id: string;
  quantity: number;
}

export interface PricedAddon {
  addon: Addon;
  quantity: number;
  /** Radtotal i kr. */
  lineTotal: number;
}

/** Pris för en tillvalsrad givet antal nätter. */
export function addonLineTotal(addon: Addon, quantity: number, nights: number): number {
  const qty = Math.max(1, quantity);
  const stayNights = Math.max(1, nights);
  switch (addon.price_type) {
    case "per_night":
    case "per_person_per_night":
      return addon.price * qty * stayNights;
    case "per_booking":
    case "per_person":
    default:
      return addon.price * qty;
  }
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

/** Kort prisetikett för listor. */
export function addonPriceLabel(addon: Pick<Addon, "price" | "price_type">): string {
  const price = `${addon.price.toLocaleString("sv-SE")} kr`;
  switch (addon.price_type) {
    case "per_night":
      return `${price}/natt`;
    case "per_person":
      return `${price}/person`;
    case "per_person_per_night":
      return `${price}/person & dygn`;
    default:
      return price;
  }
}

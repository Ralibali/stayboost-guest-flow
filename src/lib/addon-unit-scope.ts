import type { SupabaseClient } from "@supabase/supabase-js";
import type { Addon } from "./supabase";

export type AddonUnitScope = "all" | "selected";

/** Missing legacy scope means all; a selected scope without mappings means none. */
export function addonUnitIds(addon: Pick<Addon, "unit_scope" | "addon_units">): string[] | null {
  return addon.unit_scope === "selected"
    ? (addon.addon_units ?? []).map((row) => row.unit_id)
    : null;
}

export function selectedAddonUnitIds(
  scope: AddonUnitScope,
  selected: string[],
  available: string[],
): string[] | null {
  if (scope === "all") return null;
  if (
    !selected.length ||
    new Set(selected).size !== selected.length ||
    selected.some((id) => !available.includes(id))
  )
    throw new Error("Välj minst en av anläggningens enheter för tillvalet.");
  return selected;
}

export async function saveAddonWithUnits(
  client: SupabaseClient,
  propertyId: string,
  addonId: string | null,
  data: Record<string, unknown>,
  unitIds: string[] | null,
): Promise<string> {
  const result = await client.rpc("save_addon_with_units", {
    p_property: propertyId,
    p_addon: addonId,
    p_data: data,
    p_unit_ids: unitIds,
  });
  if (result.error) throw result.error;
  if (typeof result.data !== "string" || !result.data)
    throw new Error("Tillvalet kunde inte sparas. Försök igen.");
  return result.data;
}

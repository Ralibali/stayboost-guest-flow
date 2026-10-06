import type { SupabaseClient } from "@supabase/supabase-js";

export function isAddonCatalogConflict(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    String(error.message).includes("addon_catalog_conflict")
  );
}

export async function saveAddonCatalog(
  client: SupabaseClient,
  propertyId: string,
  addonId: string | null,
  revision: number | null | undefined,
  data: Record<string, unknown>,
  unitIds: string[] | null,
): Promise<string> {
  if (addonId && (!Number.isSafeInteger(revision) || Number(revision) < 1))
    throw new Error("addon_catalog_conflict");
  const result = await client.rpc("save_addon_catalog", {
    p_property: propertyId,
    p_addon: addonId,
    p_original: addonId ? { revision } : null,
    p_data: data,
    p_unit_ids: unitIds,
  });
  if (result.error) throw result.error;
  if (typeof result.data !== "string" || !result.data) throw new Error("addon_save_failed");
  return result.data;
}

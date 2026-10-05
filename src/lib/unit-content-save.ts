import type { SupabaseClient } from "@supabase/supabase-js";
import type { Unit } from "./supabase";

export type UnitContentSnapshot = Required<
  Pick<Unit, "name" | "description" | "image_url" | "content_translations" | "gallery">
>;

export function unitContentSnapshot(
  unit: Pick<Unit, keyof UnitContentSnapshot>,
): UnitContentSnapshot {
  return {
    name: unit.name,
    description: unit.description,
    image_url: unit.image_url,
    content_translations: unit.content_translations ?? {},
    gallery: unit.gallery ?? [],
  };
}

/** Atomic compare-and-set covers legacy clients as well as the multilingual editor. */
export async function saveUnitContentDraft(
  client: SupabaseClient,
  unit: Pick<Unit, "id" | "property_id">,
  original: UnitContentSnapshot,
  draft: UnitContentSnapshot,
) {
  const { data, error } = await client.rpc("save_unit_content", {
    p_unit_id: unit.id,
    p_property_id: unit.property_id,
    p_original: original,
    p_draft: draft,
  });
  if (error) throw error;
  return data === true;
}

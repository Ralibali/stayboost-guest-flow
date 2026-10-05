import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { saveUnitContentDraft, unitContentSnapshot } from "./unit-content-save";

const unit = { id: "unit", property_id: "property" };
const fullName =
  "Tält 1 - Sjöbrisretreatet - (Barn 0-2 och 3-12 lägger ni till i tillval. Från 13 år vuxenpris)";
const exact = "  Full text\n\n" + "Do not truncate. ".repeat(200) + "\n ";
const original = unitContentSnapshot({ name: fullName, description: exact, image_url: null });
const draft = { ...original, content_translations: { sv: { name: fullName, description: exact } } };

describe("explicit content draft request", () => {
  it("sends full snapshots in an RPC body instead of oversized URL filters", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const client = { rpc } as unknown as SupabaseClient;
    expect(await saveUnitContentDraft(client, unit, original, draft)).toBe(true);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("save_unit_content", {
      p_unit_id: unit.id,
      p_property_id: unit.property_id,
      p_original: original,
      p_draft: draft,
    });
    expect(rpc.mock.calls[0][1].p_draft.content_translations.sv.description).toBe(exact);
  });
  it("does not claim success on a stale draft or malformed server result", async () => {
    for (const data of [false, null, [], {}, "true"]) {
      const client = { rpc: async () => ({ data, error: null }) } as unknown as SupabaseClient;
      expect(await saveUnitContentDraft(client, unit, original, draft)).toBe(false);
    }
  });
  it("surfaces save errors without modifying the draft", async () => {
    const before = structuredClone(draft);
    const client = {
      rpc: async () => ({ data: null, error: new Error("save_failed") }),
    } as unknown as SupabaseClient;
    await expect(saveUnitContentDraft(client, unit, original, draft)).rejects.toThrow(
      "save_failed",
    );
    expect(draft).toEqual(before);
  });
});

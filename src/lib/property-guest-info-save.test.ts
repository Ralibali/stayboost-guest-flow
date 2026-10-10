import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  propertyGuestInfoSnapshot,
  propertySettingsPatch,
  savePropertyGuestInfoDraft,
} from "./property-guest-info-save";
import type { Property } from "./supabase";

const exact = "  Rader bevaras\n\n" + "Lång text. ".repeat(200) + "\n ";
const property = {
  id: "property",
  owner_id: "owner",
  directions: exact,
  house_rules: null,
  name: "Unchanged",
  checkin_time: "15:00",
  wifi_password: "separate-private-field",
  guest_info_translations: {
    sv: { directions: exact, house_rules: null },
    da: { directions: "", house_rules: null },
  },
} as Property;
describe("property guest-info save boundary", () => {
  it("sends exactly the three-field original/draft snapshots without trimming, private data or oversized URL filters", async () => {
    const original = propertyGuestInfoSnapshot(property);
    const draft = {
      ...original,
      guest_info_translations: {
        ...original.guest_info_translations,
        no: { directions: exact, house_rules: "" },
      },
    };
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    expect(
      await savePropertyGuestInfoDraft(
        { rpc } as unknown as SupabaseClient,
        property.id,
        original,
        draft,
      ),
    ).toBe(true);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("save_property_guest_info", {
      p_property_id: "property",
      p_original: original,
      p_draft: draft,
    });
    expect(Object.keys(original).sort()).toEqual([
      "directions",
      "guest_info_translations",
      "house_rules",
    ]);
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("separate-private-field");
    expect(original.directions).toBe(exact);
    draft.guest_info_translations.da!.directions = "draft only";
    expect(property.guest_info_translations!.da!.directions).toBe("");
  });
  it("does not claim success on a conflict or malformed RPC response", async () => {
    const snapshot = propertyGuestInfoSnapshot(property);
    for (const data of [false, null, {}, [], "true"]) {
      const rpc = vi.fn().mockResolvedValue({ data, error: null });
      expect(
        await savePropertyGuestInfoDraft(
          { rpc } as unknown as SupabaseClient,
          property.id,
          snapshot,
          snapshot,
        ),
      ).toBe(false);
    }
  });
  it("preserves a legacy-only snapshot and surfaces failure without changing the draft", async () => {
    const snapshot = propertyGuestInfoSnapshot({ directions: exact, house_rules: null });
    expect(snapshot).toEqual({ directions: exact, house_rules: null, guest_info_translations: {} });
    const rpc = vi.fn().mockResolvedValue({ data: null, error: new Error("failed") });
    await expect(
      savePropertyGuestInfoDraft(
        { rpc } as unknown as SupabaseClient,
        property.id,
        snapshot,
        snapshot,
      ),
    ).rejects.toThrow("failed");
    expect(snapshot.directions).toBe(exact);
  });
  it("general settings save only their editable fields, including chat, without separate editors' state", () => {
    const patch = propertySettingsPatch(property);
    for (const key of [
      "id",
      "owner_id",
      "directions",
      "house_rules",
      "guest_info_translations",
      "booking_enabled",
      "contact_email",
      "max_stay",
      "guest_ai_enabled",
      "sirvoy_webhook_token",
    ])
      expect(Object.hasOwn(patch, key)).toBe(false);
    expect(patch.name).toBe("Unchanged");
    expect(patch.checkin_time).toBe("15:00");
    expect(patch.wifi_password).toBe("separate-private-field");
    const chatDraft = propertySettingsPatch({
      ...property,
      chat_greeting: "New greeting",
      chat_enabled: true,
    });
    expect(chatDraft.chat_greeting).toBe("New greeting");
    expect(chatDraft.chat_enabled).toBe(true);
    expect(property.directions).toBe(exact);
  });
});

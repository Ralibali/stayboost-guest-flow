import type { SupabaseClient } from "@supabase/supabase-js";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AddonUnitScopeSelector } from "../components/app/AddonUnitScopeSelector";
import { addonUnitIds, saveAddonWithUnits, selectedAddonUnitIds } from "./addon-unit-scope";

const units = [
  { id: "tent-1", name: "Tält 1", active: true },
  { id: "tent-3", name: "Tält 3", active: false },
];

describe("owner addon accommodation selection", () => {
  it("keeps legacy all-unit settings and represents an unmapped selected scope as unavailable", () => {
    expect(addonUnitIds({})).toBeNull();
    expect(addonUnitIds({ unit_scope: "all", addon_units: [{ unit_id: "tent-3" }] })).toBeNull();
    expect(addonUnitIds({ unit_scope: "selected" })).toEqual([]);
    expect(addonUnitIds({ unit_scope: "selected", addon_units: [{ unit_id: "tent-3" }] })).toEqual([
      "tent-3",
    ]);
  });

  it("requires a nonempty, unique selection belonging to this property's loaded units", () => {
    const ids = units.map((unit) => unit.id);
    expect(selectedAddonUnitIds("all", ["old-unit"], ids)).toBeNull();
    expect(selectedAddonUnitIds("selected", ["tent-3"], ids)).toEqual(["tent-3"]);
    for (const selection of [[], ["foreign-unit"], ["tent-3", "tent-3"]])
      expect(() => selectedAddonUnitIds("selected", selection, ids)).toThrow("Välj minst en");
  });

  it("shows exact selected units, including hidden units, and disables controls during save", () => {
    const html = renderToStaticMarkup(
      <AddonUnitScopeSelector
        scope="selected"
        selected={["tent-3"]}
        units={units}
        disabled
        onChange={() => {}}
      />,
    );
    expect(html).toContain('disabled=""');
    expect(html).toContain("Alla enheter");
    expect(html).toContain("Utvalda enheter");
    expect(html).toContain("Tält 3 (dold)");
    const checkboxes = html.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? [];
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes.find((input) => input.includes('value="tent-1"'))).not.toContain(
      'checked=""',
    );
    expect(checkboxes.find((input) => input.includes('value="tent-3"'))).toContain('checked=""');
  });

  it("explains an empty selected scope and hides individual choices in all-unit mode", () => {
    const empty = renderToStaticMarkup(
      <AddonUnitScopeSelector scope="selected" selected={[]} units={[]} onChange={() => {}} />,
    );
    expect(empty).toContain("Lägg till en enhet");
    expect(empty).toContain("Välj minst en enhet");
    const all = renderToStaticMarkup(
      <AddonUnitScopeSelector
        scope="all"
        selected={["tent-3"]}
        units={units}
        onChange={() => {}}
      />,
    );
    expect(all).not.toContain('type="checkbox"');
    expect(all).not.toContain("Välj minst en enhet");
  });

  it("saves the addon and unit selection in one operation and propagates a server rejection", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: "addon", error: null })
      .mockResolvedValueOnce({ data: null, error: new Error("wrong_property") });
    const client = { rpc } as unknown as SupabaseClient;
    await expect(
      saveAddonWithUnits(client, "property", "addon", { name: "Pets", price: 295 }, ["tent-3"]),
    ).resolves.toBe("addon");
    expect(rpc).toHaveBeenCalledWith("save_addon_with_units", {
      p_property: "property",
      p_addon: "addon",
      p_data: { name: "Pets", price: 295 },
      p_unit_ids: ["tent-3"],
    });
    await expect(
      saveAddonWithUnits(client, "property", "addon", { name: "Pets" }, ["foreign-unit"]),
    ).rejects.toThrow("wrong_property");
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AddonContentFields } from "../components/app/AddonContentFields";
import {
  addonVatLabel,
  isAddonTranslations,
  isVatRate,
  localizedAddonText,
  projectAddonContent,
} from "../../supabase/functions/_shared/addon-content";
import { CONTENT_LANGUAGES } from "../../supabase/functions/_shared/unit-content";
import { guestAddon } from "../../supabase/functions/_shared/guest-stay";
import { isAddonCatalogConflict, saveAddonCatalog } from "./addon-catalog-save";

const exact = "  Fullständig beskrivning 💚\n\nSista raden.  ";
const translations = Object.fromEntries(
  CONTENT_LANGUAGES.map((language) => [
    language,
    { name: ` ${language} namn `, description: exact },
  ]),
);

describe("addon catalog text and included VAT", () => {
  it("retains all five exact language texts and only publishes text and supported VAT", () => {
    const source = {
      content_translations: {
        ...translations,
        en: { ...translations.en, archive_id: "PRIVATE" },
        fr: { name: "PRIVATE", description: null },
      },
      vat_rate: 12,
      archive_id: "PRIVATE",
    };
    const projected = projectAddonContent(source);
    expect(projected).toEqual({ contentTranslations: translations, vatRate: 12 });
    expect(JSON.stringify(projected)).not.toContain("PRIVATE");
    for (const lang of CONTENT_LANGUAGES)
      expect(localizedAddonText({ name: "Legacy", ...projected }, lang)).toEqual(
        translations[lang],
      );
    expect(isAddonTranslations(source.content_translations)).toBe(false);
    expect(isAddonTranslations(translations)).toBe(true);
  });

  it("falls back to Swedish and then legacy without treating missing VAT as zero", () => {
    expect(localizedAddonText({ name: "Old", description: exact }, "en")).toEqual({
      name: "Old",
      description: exact,
    });
    expect(
      localizedAddonText({ name: "Old", contentTranslations: { sv: translations.sv } }, "de"),
    ).toEqual(translations.sv);
    for (const value of [undefined, null, "12", 6, -1, 100])
      expect(projectAddonContent({ vat_rate: value }).vatRate).toBeNull();
    for (const value of [0, 12, 25]) expect(isVatRate(value)).toBe(true);
    expect(addonVatLabel(null, "sv")).toBeNull();
    expect(addonVatLabel(0, "en")).toBe("Includes 0% VAT");
    expect(addonVatLabel(12, "de")).toBe("Inkl. 12 % MwSt.");
  });

  it("renders all language tabs, the full source text and explicit unknown/zero VAT choices", () => {
    const html = renderToStaticMarkup(
      <AddonContentFields
        translations={translations}
        vatRate={null}
        onTranslations={() => {}}
        onVatRate={() => {}}
      />,
    );
    for (const label of ["Svenska", "Engelska", "Tyska", "Danska", "Norska"])
      expect(html).toContain(label);
    expect(html).toContain(exact);
    expect(html).toContain('<option value="" selected="">Ej angivet</option>');
    expect(html).toContain('<option value="0">0 %</option>');
    expect(html).toContain("Danska och norska bevaras här");
  });

  it("only publishes frozen guest fields and never adds current VAT to old purchases", () => {
    const booking = { unit_id: "tent", checkin_date: "2027-06-01", checkout_date: "2027-06-02" };
    const row = {
      id: "delivery",
      title: "Purchase",
      due_date: "2027-06-01",
      status: "pending",
      details: {
        ...booking,
        quantity: 1,
        description: exact,
        content_translations: translations,
        vat_rate: 12,
        tax_inclusive: true,
        source_archive: "PRIVATE",
        assigned_to: "PRIVATE",
      },
    };
    const projected = guestAddon(row, booking)!;
    expect(projected).toMatchObject({
      description: exact,
      contentTranslations: translations,
      vatRate: 12,
    });
    expect(JSON.stringify(projected)).not.toContain("PRIVATE");
    expect(
      localizedAddonText({ ...projected, name: String(projected.name) }, "en").description,
    ).toBe(exact);
    const old = guestAddon({ ...row, details: { ...booking, quantity: 1 } }, booking)!;
    expect(old).not.toHaveProperty("vatRate");
    expect(old).not.toHaveProperty("contentTranslations");
  });
});

describe("atomic owner catalog edits", () => {
  it("sends the observed revision and exact language text without URL filters", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "addon", error: null });
    const client = { rpc } as unknown as SupabaseClient;
    await saveAddonCatalog(
      client,
      "property",
      "addon",
      4,
      { content_translations: translations, vat_rate: 0 },
      ["tent"],
    );
    expect(rpc).toHaveBeenCalledExactlyOnceWith("save_addon_catalog", {
      p_property: "property",
      p_addon: "addon",
      p_original: { revision: 4 },
      p_data: { content_translations: translations, vat_rate: 0 },
      p_unit_ids: ["tent"],
    });
  });
  it("preserves a stale draft on conflict and refuses an unversioned overwrite", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: "addon_catalog_conflict" } });
    const client = { rpc } as unknown as SupabaseClient;
    await expect(saveAddonCatalog(client, "property", "addon", 4, {}, null)).rejects.toSatisfy(
      isAddonCatalogConflict,
    );
    rpc.mockClear();
    await expect(
      saveAddonCatalog(client, "property", "addon", undefined, {}, null),
    ).rejects.toSatisfy(isAddonCatalogConflict);
    expect(rpc).not.toHaveBeenCalled();
  });
});

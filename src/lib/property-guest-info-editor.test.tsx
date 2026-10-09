// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PropertyGuestInfoEditor } from "../components/app/PropertyGuestInfoEditor";
import type { Property } from "./supabase";
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("./supabase", () => ({ supabase: { rpc: mocks.rpc } }));
const source = {
  id: "property-a",
  owner_id: "owner-a",
  directions: "  Svensk ankomst\n\nBehåll allt. ",
  house_rules: "Svenska regler",
  guest_info_translations: {
    sv: { directions: "  Svensk ankomst\n\nBehåll allt. ", house_rules: "Svenska regler" },
    en: { directions: "English arrival", house_rules: "English rules" },
    de: { directions: "Deutsche Anreise", house_rules: "Deutsche Regeln" },
    da: { directions: "Dansk ankomst", house_rules: "Danske regler" },
    no: { directions: "Norsk ankomst", house_rules: "Norske regler" },
  },
} as Property;
let root: Root, container: HTMLDivElement;
const onSaved = vi.fn();
const button = (label: string) =>
  Array.from(container.querySelectorAll("button")).find((b) => b.textContent === label)!;
async function mount(property: Property = source) {
  await act(async () =>
    root.render(<PropertyGuestInfoEditor property={property} onSaved={onSaved} />),
  );
}
async function edit(index: number, value: string) {
  const input = container.querySelectorAll("textarea")[index]!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      input,
      value,
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.rpc.mockReset();
  onSaved.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
describe("separate multilingual guest-info draft editor", () => {
  it("shows all five stored languages and does not save on mount or language switch", async () => {
    await mount();
    for (const [label, text] of [
      ["Svenska", source.directions],
      ["Engelska", "English arrival"],
      ["Tyska", "Deutsche Anreise"],
      ["Danska", "Dansk ankomst"],
      ["Norska", "Norsk ankomst"],
    ]) {
      await act(async () => button(label!).click());
      expect(container.querySelector("textarea")!.value).toBe(text);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(button("Spara gästinformation").disabled).toBe(true);
  });
  it("saves exact Swedish/legacy text once only after the explicit button, with full original CAS", async () => {
    let resolve!: (value: unknown) => void;
    mocks.rpc.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    await mount();
    const exact = "  Ny svensk text\n\n" + "Hela texten. ".repeat(250) + "\n ";
    await edit(0, exact);
    expect(mocks.rpc).not.toHaveBeenCalled();
    await act(async () => {
      const saveButton = button("Spara gästinformation");
      saveButton.click();
      saveButton.click();
    });
    expect(mocks.rpc).toHaveBeenCalledOnce();
    const args = mocks.rpc.mock.calls[0][1];
    expect(args.p_original.directions).toBe(source.directions);
    expect(args.p_draft.directions).toBe(exact);
    expect(args.p_draft.guest_info_translations.sv.directions).toBe(exact);
    expect(args.p_draft.guest_info_translations.no).toEqual(source.guest_info_translations!.no);
    await act(async () => resolve({ data: true, error: null }));
    expect(onSaved).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Gästinformationen är sparad.");
  });
  it("keeps edited text and original snapshot after external refresh and a stale-save conflict", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    await mount();
    await edit(0, "Mitt lokala utkast");
    await mount({
      ...source,
      directions: "Extern ändring",
      guest_info_translations: {
        ...source.guest_info_translations,
        sv: { directions: "Extern ändring", house_rules: source.house_rules },
      },
    });
    expect(container.querySelector("textarea")!.value).toBe("Mitt lokala utkast");
    await act(async () => button("Spara gästinformation").click());
    expect(mocks.rpc.mock.calls[0][1].p_original.directions).toBe(source.directions);
    expect(container.querySelector('[role="alert"]')!.textContent).toContain(
      "Ditt utkast finns kvar",
    );
    expect(container.querySelector("textarea")!.value).toBe("Mitt lokala utkast");
    expect(onSaved).not.toHaveBeenCalled();
  });
  it("makes fallback explicit and preserves intentionally empty foreign text", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    await mount({ ...source, guest_info_translations: {} });
    await act(async () => button("Danska").click());
    expect(container.querySelector("textarea")!.disabled).toBe(true);
    expect(container.querySelector("textarea")!.value).toBe(source.directions);
    await act(async () =>
      container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(),
    );
    expect(container.querySelector("textarea")!.disabled).toBe(false);
    await edit(0, "");
    await act(async () => button("Spara gästinformation").click());
    const draft = mocks.rpc.mock.calls[0][1].p_draft;
    expect(draft.guest_info_translations.da).toEqual({ directions: "", house_rules: null });
    expect(draft.directions).toBe(source.directions);
    expect(draft.guest_info_translations.sv).toBeUndefined();
  });
  it("drops a pending save result when the owner/property context changes", async () => {
    let resolve!: (value: unknown) => void;
    mocks.rpc.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    await mount();
    await edit(0, "Första utkastet");
    await act(async () => button("Spara gästinformation").click());
    await mount({ ...source, id: "property-b", owner_id: "owner-b" });
    await act(async () => resolve({ data: true, error: null }));
    expect(onSaved).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Gästinformationen är sparad.");
    expect(container.querySelector("textarea")!.value).toBe(source.directions);
  });
  it("hides raw save errors and keeps the draft", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "PRIVATE implementation value" } });
    await mount();
    await edit(0, "Bevara mig");
    await act(async () => button("Spara gästinformation").click());
    expect(container.textContent).not.toContain("PRIVATE");
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("kunde inte sparas");
    expect(container.querySelector("textarea")!.value).toBe("Bevara mig");
  });
});

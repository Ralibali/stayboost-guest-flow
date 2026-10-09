// @vitest-environment happy-dom
import { act, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Route } from "../routes/app/installningar";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), update: vi.fn(), reload: vi.fn() }));
const property = {
  id: "property-a",
  owner_id: "owner-a",
  name: "Stored name",
  slug: "property-a",
  directions: "Stored directions",
  house_rules: null,
  guest_info_translations: {},
  checkin_time: "15:00",
  checkout_time: "10:00",
  booking_enabled: false,
  max_stay: 14,
  wifi_name: null,
  wifi_password: null,
  booking_terms_url: null,
  contact_phone: null,
  contact_email: "owner@example.invalid",
  review_url: null,
  swish_number: null,
  swish_hold_minutes: 60,
  chat_enabled: false,
  chat_email: null,
  chat_title: "Chat",
  chat_greeting: "Welcome",
  chat_color: "#123456",
  chat_position: "right",
  chat_button_label: "Chat",
  sirvoy_webhook_token: "unrelated-private-setting",
};
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}));
vi.mock("../components/app/BookingSettings", () => ({ BookingSettings: () => null }));
vi.mock("../components/app/AdminHistory", () => ({ AdminHistory: () => null }));
vi.mock("./supabase", () => ({
  useSession: () => ({ user: { id: "owner-a" } }),
  useProperty: () => ({ property, units: [], reload: mocks.reload }),
  icalExportUrl: () => "",
  supabase: {
    rpc: mocks.rpc,
    from: () => ({
      select: () => ({
        eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }),
      }),
      update: (patch: unknown) => {
        mocks.update(patch);
        return { eq: async () => ({ error: null }) };
      },
    }),
  },
}));
const Settings = Route.options.component as ComponentType;
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.rpc.mockReset().mockResolvedValue({ data: true, error: null });
  mocks.update.mockReset();
  mocks.reload.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function edit(input: HTMLInputElement | HTMLTextAreaElement, text: string) {
  await act(async () => {
    const prototype =
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("saving guest text leaves another unsaved Settings draft intact and the later general save excludes separate editor fields", async () => {
  await act(async () => root.render(<Settings />));
  const nameInput = Array.from(container.querySelectorAll("input")).find(
    (input) => input.value === "Stored name",
  )!;
  await edit(nameInput, "Unsaved owner name");
  const guestText = container.querySelector(
    'section[aria-label="Gästinformation på fem språk"] textarea',
  ) as HTMLTextAreaElement;
  await edit(guestText, "New directions\n\nExact paragraph");
  const click = async (label: string) =>
    act(async () =>
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === label)!
        .click(),
    );
  await click("Spara gästinformation");
  expect(mocks.rpc).toHaveBeenCalledOnce();
  expect(mocks.reload).not.toHaveBeenCalled();
  expect(nameInput.value).toBe("Unsaved owner name");
  expect(guestText.value).toBe("New directions\n\nExact paragraph");
  await click("Spara anläggningen");
  expect(mocks.update).toHaveBeenCalledOnce();
  const patch = mocks.update.mock.calls[0][0];
  expect(patch.name).toBe("Unsaved owner name");
  expect(patch.chat_greeting).toBe("Welcome");
  for (const key of [
    "directions",
    "house_rules",
    "guest_info_translations",
    "booking_enabled",
    "contact_email",
    "max_stay",
    "sirvoy_webhook_token",
  ])
    expect(Object.hasOwn(patch, key)).toBe(false);
  expect(mocks.reload).toHaveBeenCalledOnce();
});

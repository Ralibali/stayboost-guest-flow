// @vitest-environment happy-dom
import { act, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Route } from "../routes/app/kallor";
const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  update: vi.fn(),
  invoke: vi.fn(),
  sources: [] as Record<string, unknown>[],
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}));
vi.mock("./supabase", async (importOriginal) => {
  const original = await importOriginal<typeof import("./supabase")>();
  const property = { id: "property" };
  const units = [{ id: "unit", name: "Tent" }];
  return {
    ...original,
    useSession: () => ({ user: { id: "owner" } }),
    useProperty: () => ({ property, units }),
    supabase: {
      functions: { invoke: mocks.invoke },
      from: () => ({
        select: () => ({
          eq: () => ({ order: async () => ({ data: mocks.sources, error: null }) }),
        }),
        insert: mocks.insert,
        update: (patch: unknown) => {
          mocks.update(patch);
          return { eq: async () => ({ error: null }) };
        },
      }),
    },
  };
});
const Sources = Route.options.component as ComponentType;
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.sources = [];
  mocks.insert.mockReset().mockResolvedValue({ error: null });
  mocks.update.mockReset();
  mocks.invoke.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function edit(input: HTMLInputElement, text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("creates a paused Booking.com source without invoking the importer and explains the two-way delay", async () => {
  await act(async () => root.render(<Sources />));
  await edit(container.querySelectorAll("input")[0], "Booking.com tent");
  await edit(container.querySelectorAll("input")[1], "https://example.test/feed.ics");
  await act(async () =>
    Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent?.includes("Spara pausad"))!
      .click(),
  );
  expect(mocks.insert).toHaveBeenCalledWith({
    property_id: "property",
    unit_id: "unit",
    name: "Booking.com tent",
    url: "https://example.test/feed.ics",
    channel_type: "booking",
    paused: true,
  });
  expect(mocks.invoke).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Kanalens eget hämtningsintervall");
  expect(container.textContent).not.toContain("Sirvoy är fortsatt primär");
});
it("shows a paused configured source as a direct-booking block and starts it only on explicit click", async () => {
  mocks.sources = [
    {
      id: "feed",
      property_id: "property",
      unit_id: "unit",
      name: "Feed",
      url: "https://example.test/feed.ics",
      channel_type: "booking",
      paused: true,
      last_success_at: null,
      consecutive_failures: 0,
      unit: { name: "Tent" },
    },
  ];
  await act(async () => root.render(<Sources />));
  expect(container.textContent).toContain("Direktbokning är spärrad för: Tent");
  expect(mocks.update).not.toHaveBeenCalled();
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Starta källa"]')!.click(),
  );
  expect(mocks.update).toHaveBeenCalledWith({ paused: false });
  expect(mocks.invoke).not.toHaveBeenCalled();
});

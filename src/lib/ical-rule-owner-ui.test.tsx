// @vitest-environment happy-dom
import { act, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Route } from "../routes/app/prisregler";
const mocks = vi.hoisted(() => ({ mutation: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}));
vi.mock("./supabase", async (importOriginal) => {
  const original = await importOriginal<typeof import("./supabase")>();
  const property = { id: "property" };
  const units = [{ id: "unit", name: "Tent" }];
  const rule = {
    property_id: "property",
    unit_id: "unit",
    kind: "closed",
    name: "Closed",
    date_from: "2099-01-01",
    date_to: "2099-01-02",
    active: true,
    priority: 0,
  };
  return {
    ...original,
    useSession: () => ({ user: { id: "owner" } }),
    useProperty: () => ({ property, units }),
    supabase: {
      from: () => {
        const query = {
          select: () => query,
          eq: () => query,
          order: () => query,
          then: (resolve: (v: unknown) => unknown) =>
            Promise.resolve({
              data: [
                { ...rule, id: "calendar", ical_source_id: "source" },
                { ...rule, id: "manual", ical_source_id: null },
              ],
              error: null,
            }).then(resolve),
          update: mocks.mutation,
          delete: mocks.mutation,
        };
        return query;
      },
    },
  };
});
it("keeps calendar closures read-only while ordinary rule controls remain available", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    const Page = Route.options.component as ComponentType;
    await act(async () => {
      root.render(<Page />);
    });
    const articles = container.querySelectorAll("article");
    expect(articles).toHaveLength(2);
    expect(articles[0].querySelectorAll("button")).toHaveLength(0);
    expect(articles[0].textContent).toContain("Styrs av kalenderkällan");
    expect(articles[1].querySelector('[role="switch"]')).not.toBeNull();
    expect(articles[1].querySelector('[title="Redigera"]')).not.toBeNull();
    expect(mocks.mutation).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

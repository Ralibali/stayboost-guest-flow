// @vitest-environment happy-dom
import { act, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import { Route } from "../routes/app/prisregler";
const mocks = vi.hoisted(() => ({
  mutation: vi.fn(),
  notes: {} as Record<string, string>,
}));
beforeEach(() => {
  mocks.mutation.mockReset();
  mocks.notes = {};
});
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
    date_from: "2024-01-01",
    date_to: "2027-01-02",
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
                { ...rule, id: "calendar", ical_source_id: "source", note: mocks.notes.calendar },
                { ...rule, id: "manual", ical_source_id: null, note: mocks.notes.manual },
              ],
              error: null,
            }).then(resolve),
          update: (row: unknown) => {
            mocks.mutation(row);
            return query;
          },
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

async function withPage(check: (container: HTMLDivElement) => Promise<void> | void) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    const Page = Route.options.component as ComponentType;
    await act(async () => root.render(<Page />));
    await check(container);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
}

it("conceals Sirvoy provenance in the list and editor without overwriting it on save", async () => {
  const provenance =
    '  {"source_system":"Sirvoy","source_rule_id":60977,"activation":"pending","sha256":"source-hash","filename":"private-source.json"}  ';
  mocks.notes = { calendar: provenance, manual: provenance };
  await withPage(async (container) => {
    const articles = container.querySelectorAll("article");
    for (const article of articles) {
      expect(article.textContent).toContain("Importerad från Sirvoy");
      expect(article.textContent).toMatch(/1 jan\.? 2024–2 jan\.? 2027/);
      expect(article.textContent).not.toContain("pending");
      expect(article.textContent).not.toContain("source-hash");
      expect(article.textContent).not.toContain("private-source.json");
    }
    expect(articles[0].textContent).toContain("Styrs av kalenderkällan");
    expect(articles[0].querySelectorAll("button")).toHaveLength(0);
    await act(async () =>
      (articles[1].querySelector('[title="Redigera"]') as HTMLButtonElement).click(),
    );
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.textContent).not.toContain("source_system");
    const save = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Spara ändringar",
    )!;
    await act(async () => save.click());
    expect(mocks.mutation).toHaveBeenCalledOnce();
    expect(mocks.mutation.mock.calls[0][0]).not.toHaveProperty("note");
    expect(mocks.notes.manual).toBe(provenance);
  });
});

it.each([
  "Fråga Sirvoy om helgen.",
  '{"source_system":"Other","note":"Behåll denna notering"}',
  '{"source_system":"sirvoy"}',
  '{"source_system":"Sirvoy"',
  '[{"source_system":"Sirvoy"}]',
  "null",
])("preserves ordinary or unrecognized notes in the list, editor and save: %s", async (note) => {
  mocks.notes.manual = note;
  await withPage(async (container) => {
    const article = container.querySelectorAll("article")[1];
    expect(article.textContent).toContain(note);
    await act(async () =>
      (article.querySelector('[title="Redigera"]') as HTMLButtonElement).click(),
    );
    const textarea = container.querySelector("textarea")!;
    expect(textarea.value).toBe(note);
    const save = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Spara ändringar",
    )!;
    await act(async () => save.click());
    expect(mocks.mutation).toHaveBeenCalledOnce();
    expect(mocks.mutation.mock.calls[0][0]).toHaveProperty("note", note);
  });
});

it("keeps an ordinary note editable when its draft happens to become Sirvoy-shaped JSON", async () => {
  mocks.notes.manual = "Min anteckning";
  await withPage(async (container) => {
    await act(async () =>
      (
        container
          .querySelectorAll("article")[1]
          .querySelector('[title="Redigera"]') as HTMLButtonElement
      ).click(),
    );
    const textarea = container.querySelector("textarea")!;
    const draft = '{"source_system":"Sirvoy","note":"Ägarens nya anteckning"}';
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        textarea,
        draft,
      );
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.querySelector("textarea")).toBe(textarea);
    expect(textarea.value).toBe(draft);
    const save = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Spara ändringar",
    )!;
    await act(async () => save.click());
    expect(mocks.mutation).toHaveBeenCalledOnce();
    expect(mocks.mutation.mock.calls[0][0]).toHaveProperty("note", draft);
  });
});

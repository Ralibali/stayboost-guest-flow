// @vitest-environment happy-dom
import { act, type ComponentType, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "../routes/g/$token";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: ComponentType }) => ({
    options,
    useParams: () => ({ token: "a".repeat(24) }),
  }),
}));
vi.mock("framer-motion", () => ({
  motion: {
    main: ({ children, className }: { children: ReactNode; className: string }) => (
      <main className={className}>{children}</main>
    ),
  },
}));
vi.mock("./supabase-config", () => ({ SUPABASE_URL: "https://example.invalid" }));
vi.mock("./boka-i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./boka-i18n")>()),
  detectLang: () => "sv",
  persistLang: vi.fn(),
}));
const GuestPage = Route.options.component as ComponentType;
const base = {
  bookingStatus: "confirmed",
  accessAvailable: false,
  phase: "before",
  guestName: "Example",
  checkinDate: "2099-06-10",
  checkoutDate: "2099-06-12",
  unit: null,
  payment: null,
  property: {
    name: "Property",
    slug: "property",
    checkin_time: "15:00",
    checkout_time: "10:00",
    directions: "Legacy directions",
    house_rules: "Legacy rules",
    wifi_name: null,
    wifi_password: null,
    contact_phone: null,
    swish_number: null,
  },
};
let container: HTMLDivElement, root: Root;
const fetchMock = vi.fn();
async function mount(property: Record<string, unknown>) {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ ...base, property }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  await act(async () => root.render(<GuestPage />));
}
async function choose(label: string) {
  await act(async () =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('nav[aria-label="Language"] button'))
      .find((b) => b.textContent === label)!
      .click(),
  );
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
describe("guest page generic information language display", () => {
  it("switches all five complete paragraphs without refetch or HTML execution", async () => {
    const directions = {
      sv: "Svensk ankomst\n\nAndra stycket",
      en: '<img src=x onerror="PRIVATE()">' + "\n\nEnglish arrival",
      de: "Deutsche Anreise\n\nZweiter Absatz",
      da: "Dansk ankomst\n\nAndet afsnit",
      no: "Norsk ankomst\n\nAndre avsnitt",
    };
    await mount({
      ...base.property,
      guestInfoTranslations: Object.fromEntries(
        Object.entries(directions).map(([lang, text]) => [
          lang,
          { directions: text, house_rules: "Rules-" + lang },
        ]),
      ),
    });
    for (const [lang, text] of Object.entries(directions)) {
      await choose(lang.toUpperCase());
      expect(container.textContent).toContain(text);
      expect(container.textContent).toContain("Rules-" + lang);
      expect(container.textContent).not.toContain("Legacy directions");
    }
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1].body).toBe(JSON.stringify({ token: "a".repeat(24) }));
  });
  it("uses Swedish per-field fallback for null but honors a deliberately empty translation", async () => {
    await mount({
      ...base.property,
      guestInfoTranslations: {
        sv: { directions: "Swedish fallback", house_rules: "Swedish rules fallback" },
        no: { directions: null, house_rules: "" },
      },
    });
    await choose("NO");
    expect(container.textContent).toContain("Swedish fallback");
    expect(container.textContent).not.toContain("Swedish rules fallback");
    expect(container.textContent).not.toContain("Legacy rules");
    await choose("DA");
    expect(container.textContent).toContain("Swedish rules fallback");
  });
  it("continues showing legacy information when older guest responses omit translations", async () => {
    await mount(base.property);
    for (const lang of ["SV", "EN", "DE", "DA", "NO"]) {
      await choose(lang);
      expect(container.textContent).toContain("Legacy directions");
      expect(container.textContent).toContain("Legacy rules");
    }
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

// @vitest-environment happy-dom
import { act, type ComponentType, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "../routes/app/startklart";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  session: { user: { id: "owner-a" } },
  property: {
    id: "property-a",
    contact_email: "owner@example.invalid",
    contact_phone: "000",
    booking_terms_url: "https://example.invalid/terms",
    swish_number: null,
    booking_enabled: false,
  },
  units: [{ active: true, max_guests: 4, base_price: 995 }],
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: ComponentType }) => ({ options }),
  Link: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("./supabase", () => ({
  supabase: { functions: { invoke: mocks.invoke } },
  useSession: () => mocks.session,
  useProperty: () => ({ property: mocks.property, units: mocks.units }),
}));
vi.mock("../components/app/SirvoyArchive", () => ({ SirvoyArchive: () => null }));
vi.mock("../components/app/SirvoySourceRecords", () => ({ SirvoySourceRecords: () => null }));
const LaunchPage = Route.options.component as ComponentType;
const readiness = {
  stripeConfigured: true,
  stripeWebhookConfigured: true,
  emailConfigured: false,
  smsConfigured: false,
  enabledSmsTemplates: 0,
};
const checkedAt = "2026-10-09T20:00:00.000Z";
let container: HTMLDivElement;
let root: Root;
let consoleError: ReturnType<typeof vi.spyOn>;
const buttons = (text: string) =>
  Array.from(container.querySelectorAll("button")).filter((button) => button.textContent === text);
function uniqueControls() {
  expect(buttons("Kontrollera Stripe-anslutning")).toHaveLength(1);
  expect(buttons("Kontrollera skapande och stängning i Stripe")).toHaveLength(1);
}
async function mount() {
  await act(async () => root.render(<LaunchPage />));
}
async function refresh() {
  await act(async () => buttons(" Uppdatera")[0]!.click());
}
beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.session = { user: { id: "owner-a" } };
  mocks.property = { ...mocks.property, id: "property-a" };
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  consoleError.mockRestore();
  vi.unstubAllGlobals();
});

describe("Startklart Stripe controls retain distinct component identities", () => {
  it("keeps one of each real control through readiness loading, refresh errors and recovery", async () => {
    let resolve!: (value: unknown) => void;
    mocks.invoke.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    await mount();
    uniqueControls();
    await act(async () => resolve({ data: readiness, error: null }));
    uniqueControls();
    mocks.invoke.mockResolvedValueOnce({ data: null, error: { message: "unavailable" } });
    await refresh();
    uniqueControls();
    mocks.invoke.mockResolvedValueOnce({ data: readiness, error: null });
    await refresh();
    uniqueControls();
    expect(mocks.invoke.mock.calls).toHaveLength(3);
    expect(
      mocks.invoke.mock.calls.every(
        ([name, options]) => name === "booking-import" && options.body.action === "readiness",
      ),
    ).toBe(true);
    expect(
      consoleError.mock.calls.filter((args: unknown[]) =>
        args.some((value) => String(value).includes("same key")),
      ),
    ).toHaveLength(0);
  });

  it("retains each result on ordinary refresh and clears both on owner or property change", async () => {
    mocks.invoke.mockImplementation(async (name, options) => {
      if (name === "stripe-checkout-diagnostic")
        return { data: { status: "create_and_expire_confirmed", checkedAt }, error: null };
      if (options.body.action === "stripe_diagnostic")
        return { data: { status: "read_access_confirmed", checkedAt }, error: null };
      return { data: readiness, error: null };
    });
    await mount();
    await act(async () => buttons("Kontrollera Stripe-anslutning")[0]!.click());
    await act(async () => buttons("Kontrollera skapande och stängning i Stripe")[0]!.click());
    await refresh();
    uniqueControls();
    expect(container.textContent).toContain("Stripe godkände nyckeln");
    expect(container.textContent).toContain("Stripe kunde skapa och stänga");
    mocks.session = { user: { id: "owner-b" } };
    await mount();
    uniqueControls();
    expect(container.textContent).not.toContain("Stripe godkände nyckeln");
    expect(container.textContent).not.toContain("Stripe kunde skapa och stänga");
    await act(async () => buttons("Kontrollera Stripe-anslutning")[0]!.click());
    mocks.property = { ...mocks.property, id: "property-b" };
    await mount();
    uniqueControls();
    expect(container.textContent).not.toContain("Stripe godkände nyckeln");
    expect(container.textContent).not.toContain("Stripe kunde skapa och stänga");
    expect(
      mocks.invoke.mock.calls.filter(
        ([name, options]) =>
          name === "stripe-checkout-diagnostic" || options.body.action === "stripe_diagnostic",
      ),
    ).toHaveLength(3);
  });
});

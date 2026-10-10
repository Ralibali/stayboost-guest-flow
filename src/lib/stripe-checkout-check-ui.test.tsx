// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StripeCheckoutCheck } from "../components/app/StripeCheckoutCheck";
import { readStripeCheckoutCheck, stripeCheckoutCheckLabels } from "./stripe-checkout-check";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("./supabase", () => ({ supabase: { functions: { invoke: mocks.invoke } } }));
const checkedAt = "2026-10-09T19:00:00.000Z";
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  mocks.invoke.mockReset();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function mount(propertyId = "owned-property", ownerId = "owner") {
  await act(async () => root.render(<StripeCheckoutCheck key={ownerId} propertyId={propertyId} />));
}

describe("explicit owner Stripe create-and-close check", () => {
  it("never calls on mount; sends only propertyId on explicit click with clear payment boundaries", async () => {
    mocks.invoke.mockResolvedValue({
      data: { status: "create_and_expire_confirmed", checkedAt },
      error: null,
    });
    await mount();
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(container.textContent).toContain("obetald provsession i ditt anslutna Stripe-konto");
    expect(container.textContent).toContain("Ingen gästbokning skapas");
    expect(container.textContent).toContain("inga meddelanden skickas");
    expect(container.textContent).toContain("Resultatet verifierar inte en genomförd betalning");
    expect(container.textContent).toContain("återbetalning eller signerad betalningsbekräftelse");
    await act(async () => container.querySelector("button")!.click());
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("stripe-checkout-diagnostic", {
      body: { propertyId: "owned-property" },
    });
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "Stripe kunde skapa och stänga den obetalda provsessionen",
    );
    expect(container.textContent).toContain("Kontrollerad");
    expect(container.querySelector("a")).toBeNull();
  });

  it("deduplicates pending clicks and allows an explicit follow-up without request identity/client flags", async () => {
    let resolve!: (value: unknown) => void;
    mocks.invoke.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    await mount();
    await act(async () => {
      container.querySelector("button")!.click();
      container.querySelector("button")!.click();
    });
    expect(mocks.invoke).toHaveBeenCalledOnce();
    expect(container.querySelector("button")!.disabled).toBe(true);
    await act(async () =>
      resolve({ data: { status: "expiry_not_confirmed", checkedAt }, error: null }),
    );
    expect(container.textContent).toContain("Provsessionsstängningen är inte bekräftad");
    expect(container.querySelector("button")!.disabled).toBe(false);
    await act(async () => container.querySelector("button")!.click());
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.invoke).toHaveBeenLastCalledWith("stripe-checkout-diagnostic", {
      body: { propertyId: "owned-property" },
    });
  });

  it.each(["property", "owner"] as const)(
    "drops pending result after changing %s and does not auto-run for the new context",
    async (change) => {
      let resolve!: (value: unknown) => void;
      mocks.invoke.mockReturnValue(
        new Promise((r) => {
          resolve = r;
        }),
      );
      await mount("property-a", "owner-a");
      await act(async () => container.querySelector("button")!.click());
      await mount(
        change === "property" ? "property-b" : "property-a",
        change === "owner" ? "owner-b" : "owner-a",
      );
      await act(async () =>
        resolve({ data: { status: "create_and_expire_confirmed", checkedAt }, error: null }),
      );
      expect(container.textContent).not.toContain("Stripe kunde skapa");
      expect(container.textContent).not.toContain("Kontrollerad");
      expect(container.querySelector("button")!.disabled).toBe(false);
      expect(mocks.invoke).toHaveBeenCalledOnce();
    },
  );

  it.each(Object.entries(stripeCheckoutCheckLabels))(
    "renders fixed text for %s and discards unexpected provider/customer fields",
    async (status, label) => {
      const response = {
        status,
        checkedAt,
        sessionId: "cs_live_PRIVATE",
        url: "https://private.invalid",
        key: "rk_live_PRIVATE",
        body: "PRIVATE customer content",
      };
      expect(readStripeCheckoutCheck(response)).toEqual({ status, checkedAt });
      mocks.invoke.mockResolvedValue({ data: response, error: null });
      await mount();
      await act(async () => container.querySelector("button")!.click());
      expect(container.querySelector('[role="status"]')?.textContent).toContain(label);
      expect(container.textContent).not.toContain("PRIVATE");
      expect(container.innerHTML).not.toContain("private.invalid");
    },
  );

  it.each([
    {
      data: null,
      error: {
        message: "PRIVATE provider response",
        context: {
          json() {
            throw new Error("must not read");
          },
        },
      },
    },
    { data: { status: "PRIVATE arbitrary status", checkedAt }, error: null },
    { data: { status: "create_and_expire_confirmed", checkedAt: "PRIVATE date" }, error: null },
  ])(
    "shows a generic error for invalid/failed responses without leaking raw values",
    async (response) => {
      mocks.invoke.mockResolvedValue(response);
      await mount();
      await act(async () => container.querySelector("button")!.click());
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "Kontrollens resultat kunde inte hämtas",
      );
      expect(container.textContent).not.toContain("PRIVATE");
      expect(container.textContent).not.toContain("Stripe kunde skapa");
    },
  );

  it("handles rejected transport without rendering its error", async () => {
    mocks.invoke.mockRejectedValue(new Error("PRIVATE transport value"));
    await mount();
    await act(async () => container.querySelector("button")!.click());
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).not.toContain("PRIVATE");
    expect(container.querySelector("button")!.disabled).toBe(false);
  });

  it.each([
    null,
    {},
    [],
    { status: "toString", checkedAt },
    { status: "__proto__", checkedAt },
    { status: "create_and_expire_confirmed", checkedAt: "tomorrow" },
  ])("rejects unknown statuses and invalid timestamps", (value) => {
    expect(readStripeCheckoutCheck(value)).toBeNull();
  });
});

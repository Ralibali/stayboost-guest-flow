// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StripeConnectionCheck } from "../components/app/StripeConnectionCheck";
import { readStripeDiagnostic } from "./stripe-diagnostic";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("./supabase", () => ({ supabase: { functions: { invoke: mocks.invoke } } }));
const checkedAt = "2026-10-09T17:00:00.000Z";
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

async function mount(propertyId = "owned-property") {
  await act(async () => root.render(<StripeConnectionCheck propertyId={propertyId} />));
}

describe("explicit owner Stripe connection check", () => {
  it("never runs on mount, calls only the owned action on click and describes the READ boundary", async () => {
    mocks.invoke.mockResolvedValue({
      data: { status: "read_access_confirmed", checkedAt },
      error: null,
    });
    await mount();
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(container.textContent).toContain("läsåtkomst till Checkout");
    expect(container.textContent).toContain("Den verifierar inte rätten att skapa betalningar");
    expect(container.textContent).toContain("Inga bokningar eller betalningar skapas");
    await act(async () => container.querySelector("button")!.click());
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("booking-import", {
      body: { propertyId: "owned-property", action: "stripe_diagnostic" },
    });
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "Stripe godkände nyckeln och läsåtkomsten till Checkout",
    );
    expect(container.textContent).toContain("Kontrollerad");
    expect(container.textContent).not.toContain("Betalning verifierad");
  });

  it("prevents duplicate in-flight clicks and allows an explicit retry afterward", async () => {
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
    expect(container.querySelector("button")?.disabled).toBe(true);
    await act(async () => resolve({ data: { status: "timeout", checkedAt }, error: null }));
    expect(container.textContent).toContain("Stripe svarade inte inom fem sekunder");
    expect(container.querySelector("button")?.disabled).toBe(false);
    await act(async () => container.querySelector("button")!.click());
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("drops a late previous-property result after the owner switches property", async () => {
    let resolve!: (value: unknown) => void;
    mocks.invoke.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    await mount("property-a");
    await act(async () => container.querySelector("button")!.click());
    await mount("property-b");
    await act(async () =>
      resolve({ data: { status: "read_access_confirmed", checkedAt }, error: null }),
    );
    expect(container.textContent).not.toContain("Stripe godkände");
    expect(container.textContent).not.toContain("Kontrollerad");
    expect(container.querySelector("button")?.disabled).toBe(false);
    expect(mocks.invoke).toHaveBeenCalledOnce();
  });

  it.each([
    {
      data: null,
      error: {
        message: "rk_test_PRIVATE",
        context: {
          json: () => {
            throw new Error("Do not read response body");
          },
        },
      },
    },
    { data: { status: "PRIVATE unexpected status", checkedAt }, error: null },
    {
      data: { status: "read_access_confirmed", checkedAt: "PRIVATE invalid timestamp" },
      error: null,
    },
  ])(
    "shows a generic error for rejected/malformed API results without raw text",
    async (response) => {
      mocks.invoke.mockResolvedValue(response);
      await mount();
      await act(async () => container.querySelector("button")!.click());
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "Kontrollen kunde inte hämtas",
      );
      expect(container.textContent).not.toContain("PRIVATE");
      expect(container.textContent).not.toContain("Stripe godkände");
    },
  );

  it("renders only a fixed status label when unexpected secret fields accompany a valid result", async () => {
    const response = {
      status: "authentication_failed",
      checkedAt,
      secret: "rk_test_PRIVATE",
      body: "PRIVATE customer",
    };
    expect(readStripeDiagnostic(response)).toEqual({ status: "authentication_failed", checkedAt });
    mocks.invoke.mockResolvedValue({ data: response, error: null });
    await mount();
    await act(async () => container.querySelector("button")!.click());
    expect(container.textContent).toContain("Stripe avvisade den sparade API-nyckeln");
    expect(container.textContent).not.toContain("PRIVATE");
  });

  it.each([
    null,
    {},
    { status: "toString", checkedAt },
    { status: "__proto__", checkedAt },
    { status: "read_access_confirmed", checkedAt: "yesterday" },
  ])("rejects unknown statuses and invalid timestamps", (value) => {
    expect(readStripeDiagnostic(value)).toBeNull();
  });
});

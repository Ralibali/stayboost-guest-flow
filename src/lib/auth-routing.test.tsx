// @vitest-environment happy-dom
import { act, type ComponentType, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "../routes/app";
import { useProperty, useSession, type Property, type Unit } from "./supabase";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  unsubscribe: vi.fn(),
  authCallback: null as ((event: string, session: Session | null) => void) | null,
  properties: vi.fn(),
  units: vi.fn(),
  navigate: vi.fn(),
  pathname: "/app",
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getSession: mocks.getSession,
      onAuthStateChange: (callback: typeof mocks.authCallback) => {
        mocks.authCallback = callback;
        return { data: { subscription: { unsubscribe: mocks.unsubscribe } } };
      },
    },
    from: (table: string) => {
      if (table === "properties")
        return { select: () => ({ order: () => ({ limit: mocks.properties }) }) };
      if (table === "units")
        return {
          select: () => ({
            eq: () => ({ order: () => ({ order: mocks.units }) }),
          }),
        };
      throw new Error(`Unexpected table: ${table}`);
    },
  }),
}));

vi.mock("./supabase-config", () => ({
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLIC_KEY: "test-public-key",
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: object) => ({ options }),
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: mocks.pathname }),
  Outlet: () => <div>Current page</div>,
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
vi.mock("@/components/app/AppShell", () => ({
  AppShell: ({ children, propertyName }: { children: ReactNode; propertyName: string }) => (
    <main>
      {propertyName}
      {children}
    </main>
  ),
}));
vi.mock("@/components/OpsAlertPanel", () => ({ OpsAlertPanel: () => null }));

const AppLayout = Route.options.component as ComponentType;
const owner = { user: { id: "owner-a" } } as Session;
const otherOwner = { user: { id: "owner-b" } } as Session;
const property = { id: "property-a", owner_id: "owner-a", name: "Existing property" } as Property;
const otherProperty = { id: "property-b", owner_id: "owner-b", name: "Other property" } as Property;
const unit = { id: "unit-a", property_id: property.id } as Unit;
type QueryResult<T> = { data: T[] | null; error: { message: string } | null };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let root: Root;
let container: HTMLDivElement;
let propertyQuery: ReturnType<typeof deferred<QueryResult<Property>>>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.pathname = "/app";
  mocks.authCallback = null;
  mocks.getSession.mockResolvedValue({ data: { session: null } });
  propertyQuery = deferred<QueryResult<Property>>();
  mocks.properties.mockReturnValue(propertyQuery.promise);
  mocks.units.mockResolvedValue({ data: [unit], error: null });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function signedIn(session = owner) {
  await act(async () => mocks.authCallback!("SIGNED_IN", session));
}

describe("owner routing while authentication and property reads settle", () => {
  it("never sends an existing owner to onboarding after a logged-out render", async () => {
    await act(async () => root.render(<AppLayout />));
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/app/login" });
    mocks.navigate.mockClear();

    await signedIn();
    expect(mocks.properties).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Current page");

    await act(async () => propertyQuery.resolve({ data: [property], error: null }));
    expect(container.textContent).toContain("Existing property");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("sends a new owner to onboarding only after a successful empty property result", async () => {
    await act(async () => root.render(<AppLayout />));
    mocks.navigate.mockClear();
    await signedIn();
    expect(mocks.navigate).not.toHaveBeenCalled();
    await act(async () => propertyQuery.resolve({ data: [], error: null }));
    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith({ to: "/app/onboarding" });
  });

  it("returns a known owner from onboarding without rendering its form", async () => {
    mocks.pathname = "/app/onboarding";
    mocks.getSession.mockResolvedValue({ data: { session: owner } });
    await act(async () => root.render(<AppLayout />));
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Current page");
    await act(async () => propertyQuery.resolve({ data: [property], error: null }));
    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith({ to: "/app", replace: true });
    expect(container.textContent).not.toContain("Current page");
  });

  it("keeps a confirmed new owner on onboarding", async () => {
    mocks.pathname = "/app/onboarding";
    mocks.getSession.mockResolvedValue({ data: { session: owner } });
    await act(async () => root.render(<AppLayout />));
    await act(async () => propertyQuery.resolve({ data: [], error: null }));
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Current page");
  });

  it("shows a retryable property failure instead of treating it as a new owner", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: owner } });
    await act(async () => root.render(<AppLayout />));
    await act(async () => propertyQuery.resolve({ data: null, error: { message: "Offline" } }));
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Kunde inte ladda anläggningen");

    mocks.properties.mockResolvedValue({ data: [property], error: null });
    await act(async () => container.querySelector("button")!.click());
    expect(container.textContent).toContain("Existing property");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});

describe("session-bound property snapshots", () => {
  const renders: ReturnType<typeof useProperty>[] = [];
  function Probe({ session }: { session: Session | null | undefined }) {
    renders.push(useProperty(session));
    return null;
  }

  beforeEach(() => {
    renders.length = 0;
  });

  it("hides the previous owner's data in the first render of a different session", async () => {
    await act(async () => root.render(<Probe session={owner} />));
    await act(async () => propertyQuery.resolve({ data: [property], error: null }));
    expect(renders.at(-1)).toMatchObject({ property, units: [unit] });

    const nextQuery = deferred<QueryResult<Property>>();
    mocks.properties.mockReturnValue(nextQuery.promise);
    renders.length = 0;
    await act(async () => root.render(<Probe session={otherOwner} />));
    expect(renders[0]).toMatchObject({ property: undefined, units: [], error: null });
    expect(renders.every((result) => result.property === undefined)).toBe(true);
    mocks.units.mockResolvedValue({ data: [], error: null });
    await act(async () => nextQuery.resolve({ data: [otherProperty], error: null }));
    expect(renders.at(-1)).toMatchObject({ property: otherProperty, units: [] });
  });

  it("does not reuse a same-owner null from an older session", async () => {
    await act(async () => root.render(<Probe session={owner} />));
    await act(async () => propertyQuery.resolve({ data: [], error: null }));
    const nextQuery = deferred<QueryResult<Property>>();
    mocks.properties.mockReturnValue(nextQuery.promise);
    renders.length = 0;
    await act(async () => root.render(<Probe session={{ ...owner }} />));
    expect(renders[0]).toMatchObject({ property: undefined, units: [], error: null });
    await act(async () => nextQuery.resolve({ data: [property], error: null }));
    expect(renders.at(-1)?.property).toEqual(property);
  });

  it("ignores a previous owner's pending property response and clears units on logout", async () => {
    await act(async () => root.render(<Probe session={owner} />));
    const nextQuery = deferred<QueryResult<Property>>();
    mocks.properties.mockReturnValue(nextQuery.promise);
    await act(async () => root.render(<Probe session={otherOwner} />));
    await act(async () => propertyQuery.resolve({ data: [property], error: null }));
    expect(renders.at(-1)).toMatchObject({ property: undefined, units: [], error: null });
    mocks.units.mockResolvedValue({ data: [], error: null });
    await act(async () => nextQuery.resolve({ data: [otherProperty], error: null }));
    expect(renders.at(-1)?.property).toEqual(otherProperty);
    renders.length = 0;
    await act(async () => root.render(<Probe session={null} />));
    expect(renders.every((result) => result.property === null && result.units.length === 0)).toBe(
      true,
    );
  });
});

describe("initial session reads", () => {
  const sessions: (Session | null | undefined)[] = [];
  function SessionProbe() {
    sessions.push(useSession());
    return null;
  }

  it("does not overwrite a newer sign-in event with an old getSession result", async () => {
    const initial = deferred<{ data: { session: Session | null } }>();
    mocks.getSession.mockReturnValue(initial.promise);
    await act(async () => root.render(<SessionProbe />));
    await signedIn();
    expect(sessions.at(-1)).toBe(owner);
    await act(async () => initial.resolve({ data: { session: null } }));
    expect(sessions.at(-1)).toBe(owner);
  });

  it("does not restore an old owner after a newer sign-out event", async () => {
    const initial = deferred<{ data: { session: Session | null } }>();
    mocks.getSession.mockReturnValue(initial.promise);
    await act(async () => root.render(<SessionProbe />));
    await act(async () => mocks.authCallback!("SIGNED_OUT", null));
    await act(async () => initial.resolve({ data: { session: owner } }));
    expect(sessions.at(-1)).toBe(null);
  });
});

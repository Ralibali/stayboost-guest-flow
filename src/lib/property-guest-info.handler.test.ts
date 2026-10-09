import { readFileSync } from "node:fs";
import { ScriptTarget, transpileModule } from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as guestStay from "../../supabase/functions/_shared/guest-stay";
import * as guestCheckout from "../../supabase/functions/_shared/guest-checkout";
import { normalizeStripeSecret } from "../../supabase/functions/_shared/stripe-config";
import { projectPropertyGuestInfo } from "../../supabase/functions/_shared/property-guest-info";
import { isGuestResponse } from "./public-response";

const token = "abc123".repeat(4);
const source = readFileSync(
  new URL("../../supabase/functions/guest-page/index.ts", import.meta.url),
  "utf8",
).replace(/import[\s\S]*?from\s+["'][^"']+["'];\s*/g, "");
const code = transpileModule(source, {
  compilerOptions: { target: ScriptTarget.ES2022 },
}).outputText;
function runtime(patch: Record<string, unknown> = {}) {
  const booking = {
    id: "booking",
    property_id: "property",
    unit_id: "unit",
    external_id: null,
    status: "confirmed",
    stay_status: "expected",
    guest_name: "Synthetic guest",
    checkin_date: "2026-10-09",
    checkout_date: "2026-10-11",
    payment_status: "paid",
    payment_method: "stripe",
    payment_amount: 1000,
    payment_ref: "ref",
    payment_expires_at: null,
    unit: { name: "Tent", door_code: "private-code", checkin_instructions: "private-instructions" },
    property: {
      name: "Example",
      slug: "example",
      checkin_time: "15:00",
      checkout_time: "10:00",
      directions: "Legacy arrival",
      house_rules: "Legacy rules",
      contact_phone: null,
      swish_number: null,
      wifi_name: "private-network",
      wifi_password: "private-password",
      source_archive: "private-source",
      guest_info_translations: {
        sv: { directions: "Ankomst", house_rules: "Regler", door_code: "nested-private" },
        en: { directions: "Arrival", house_rules: "Rules" },
        no: { directions: "Ankomst NO", house_rules: null },
        fr: { directions: "unknown-language-private" },
      },
    },
    ...patch,
  };
  const calls: Array<{ table: string; filters: Record<string, unknown>; select?: string }> = [];
  const from = vi.fn((table: string) => {
    const call = { table, filters: {} } as (typeof calls)[number];
    calls.push(call);
    const q = {
      select: (value: string) => {
        call.select = value;
        return q;
      },
      eq: (key: string, value: unknown) => {
        call.filters[key] = value;
        return q;
      },
      maybeSingle: async () => ({ data: booking, error: null }),
      order: async () => ({ data: [], error: null }),
    };
    return q;
  });
  const bindings = {
    createClient: () => ({ from }),
    ...guestStay,
    ...guestCheckout,
    normalizeStripeSecret,
    projectPropertyGuestInfo,
  };
  let handler!: (request: Request) => Promise<Response>;
  new Function("Deno", ...Object.keys(bindings), code)(
    {
      serve: (value: typeof handler) => {
        handler = value;
      },
      env: { get: () => "synthetic" },
    },
    ...Object.values(bindings),
  );
  return {
    calls,
    from,
    request: (value = token) =>
      handler(new Request(`https://example.test/guest-page?token=${value}`)),
  };
}
afterEach(() => vi.useRealTimers());

describe("actual guest handler projects only generic translated information", () => {
  it("rejects an invalid token before any database read", async () => {
    const f = runtime();
    expect((await f.request("invalid")).status).toBe(400);
    expect(f.from).not.toHaveBeenCalled();
  });
  it.each([
    { payment_status: "pending" },
    { payment_status: "refunded" },
    { status: "cancelled" },
    { external_id: "sirvoy-csv:source-record", payment_status: "none" },
    { stay_status: "checked_out" },
    { checkin_date: "2026-12-01", checkout_date: "2026-12-03" },
  ])("retains the access gate while returning only allowlisted generic texts", async (patch) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-09T12:00:00Z"));
    const f = runtime(patch);
    const response = await f.request();
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(isGuestResponse(data)).toBe(true);
    expect(data.accessAvailable).toBe(false);
    expect(data.unit).toMatchObject({ door_code: null, checkin_instructions: null });
    expect(data.property).toMatchObject({
      wifi_name: null,
      wifi_password: null,
      guestInfoTranslations: {
        sv: { directions: "Ankomst", house_rules: "Regler" },
        en: { directions: "Arrival", house_rules: "Rules" },
        no: { directions: "Ankomst NO", house_rules: null },
      },
    });
    const serialized = JSON.stringify(data);
    expect(serialized).not.toMatch(
      /private|source_archive|guest_info_translations|unknown-language/,
    );
    expect(f.calls[0].filters).toEqual({ guest_token: token });
    expect(f.calls[0].select).toContain("guest_info_translations");
    expect(f.calls[1].filters).toEqual({
      booking_id: "booking",
      property_id: "property",
      kind: "addon",
    });
  });
  it("keeps legitimate existing access credentials for eligible paid arrivals", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-09T12:00:00Z"));
    const data = await (await runtime().request()).json();
    expect(data.accessAvailable).toBe(true);
    expect(data.unit.door_code).toBe("private-code");
    expect(data.property.wifi_password).toBe("private-password");
    expect(data.property.source_archive).toBeUndefined();
  });
});

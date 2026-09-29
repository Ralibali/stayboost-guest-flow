import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ScriptTarget, transpileModule } from "typescript";
import { isLaunchReadiness, smsLaunchReadiness, type LaunchReadiness } from "./launch-readiness";
import { emailProviderConfigured } from "../../supabase/functions/_shared/email-provider";

const ready: LaunchReadiness = {
  stripeConfigured: true,
  stripeWebhookConfigured: true,
  emailConfigured: true,
  smsConfigured: false,
  enabledSmsTemplates: 0,
};
type Template = { property_id: string; enabled: boolean; channel: string };
const handlerFor = (
  templates: Template[],
  templateFailure = false,
  env: Record<string, string> = {},
) => {
  const calls: string[] = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "owner" } }, error: null }) },
    rpc: () => {
      throw new Error("Readiness must not mutate data");
    },
    from: (table: string) => {
      calls.push(table);
      const filters: Record<string, unknown> = {};
      let channels: string[] = [];
      const builder = {
        select(_columns: string, options?: { count?: string; head?: boolean }) {
          if (table === "message_templates")
            expect(options).toEqual({ count: "exact", head: true });
          return this;
        },
        eq(name: string, value: unknown) {
          filters[name] = value;
          return this;
        },
        in(name: string, values: string[]) {
          expect(name).toBe("channel");
          channels = values;
          return this;
        },
        async maybeSingle() {
          return {
            data:
              filters.id === "property" && filters.owner_id === "owner" ? { id: "property" } : null,
            error: null,
          };
        },
        then(resolve: (value: unknown) => unknown) {
          const count = templates.filter(
            (t) =>
              t.property_id === filters.property_id &&
              t.enabled === filters.enabled &&
              channels.includes(t.channel),
          ).length;
          return Promise.resolve({
            count: templateFailure ? null : count,
            error: templateFailure ? { message: "DB read failed" } : null,
          }).then(resolve);
        },
      };
      return builder;
    },
  };
  const source = readFileSync(
    new URL("../../supabase/functions/booking-import/index.ts", import.meta.url),
    "utf8",
  ).replace(/import[\s\S]*?from\s+["'][^"']+["'];\s*/g, "");
  const code = transpileModule(source, {
    compilerOptions: { target: ScriptTarget.ES2022 },
  }).outputText;
  let handler!: (request: Request) => Promise<Response>;
  new Function("Deno", "createClient", "emailProviderConfigured", code)(
    {
      serve: (fn: typeof handler) => {
        handler = fn;
      },
      env: { get: (name: string) => env[name] },
    },
    () => client,
    emailProviderConfigured,
  );
  const request = (propertyId = "property") =>
    handler(
      new Request("https://example.com/booking-import", {
        method: "POST",
        headers: { authorization: "Bearer owner-token", "content-type": "application/json" },
        body: JSON.stringify({ propertyId, action: "readiness" }),
      }),
    );
  return { request, calls };
};

describe("launch readiness for the actual enabled message channels", () => {
  it.each([
    [
      {
        EMAIL_PROVIDER: "resend",
        RESEND_API_KEY: "SECRET_RESEND",
        RESEND_SENDER_EMAIL: "sender@example.com",
      },
      true,
    ],
    [
      {
        EMAIL_PROVIDER: " RESEND ",
        RESEND_API_KEY: "SECRET_RESEND",
        RESEND_SENDER_EMAIL: "sender@example.com",
      },
      true,
    ],
    [{ EMAIL_PROVIDER: "resend", RESEND_API_KEY: "SECRET_RESEND" }, false],
    [{ EMAIL_PROVIDER: "resend", RESEND_SENDER_EMAIL: "sender@example.com" }, false],
    [
      {
        EMAIL_PROVIDER: "resend",
        RESEND_API_KEY: "SECRET_RESEND",
        RESEND_SENDER_EMAIL: "not-an-email",
      },
      false,
    ],
    [
      {
        EMAIL_PROVIDER: "resend",
        BREVO_API_KEY: "SECRET_BREVO",
        BREVO_SENDER_EMAIL: "sender@example.com",
      },
      false,
    ],
    [
      {
        EMAIL_PROVIDER: "brevo",
        RESEND_API_KEY: "SECRET_RESEND",
        RESEND_SENDER_EMAIL: "sender@example.com",
      },
      false,
    ],
    [
      {
        EMAIL_PROVIDER: "invalid",
        RESEND_API_KEY: "SECRET_RESEND",
        RESEND_SENDER_EMAIL: "sender@example.com",
        BREVO_API_KEY: "SECRET_BREVO",
        BREVO_SENDER_EMAIL: "sender@example.com",
      },
      false,
    ],
  ] as const)(
    "reports email readiness for the selected provider only (%j)",
    async (env, expected) => {
      const response = await handlerFor([], false, env).request();
      const payload = await response.json();
      expect(response.status).toBe(200);
      expect(payload.emailConfigured).toBe(expected);
      expect(isLaunchReadiness(payload)).toBe(true);
      expect(JSON.stringify(payload)).not.toMatch(/SECRET|sender@example/);
    },
  );
  it("marks missing SMS as outstanding only when an active SMS/both template needs it", () => {
    expect(smsLaunchReadiness(ready)).toMatchObject({ required: false, ok: true });
    expect(smsLaunchReadiness({ ...ready, enabledSmsTemplates: 1 })).toMatchObject({
      required: true,
      ok: false,
    });
    expect(
      smsLaunchReadiness({ ...ready, enabledSmsTemplates: 1, smsConfigured: true }),
    ).toMatchObject({ required: true, ok: true });
    expect(smsLaunchReadiness(null).ok).toBe(false);
  });
  it("rejects older/malformed API payloads rather than assuming SMS is optional", () => {
    expect(isLaunchReadiness(ready)).toBe(true);
    for (const value of [
      { ...ready, enabledSmsTemplates: undefined },
      { ...ready, enabledSmsTemplates: -1 },
      { ...ready, enabledSmsTemplates: "0" },
      { ...ready, smsConfigured: undefined },
    ])
      expect(isLaunchReadiness(value)).toBe(false);
  });
  it("counts enabled SMS and both only for the owned property without leaking credentials or causing sends", async () => {
    const edge = handlerFor(
      [
        { property_id: "property", enabled: true, channel: "sms" },
        { property_id: "property", enabled: true, channel: "both" },
        { property_id: "property", enabled: true, channel: "email" },
        { property_id: "property", enabled: false, channel: "sms" },
        { property_id: "other", enabled: true, channel: "sms" },
      ],
      false,
      {
        BREVO_API_KEY: "SECRET_EMAIL_KEY",
        BREVO_SENDER_EMAIL: "private@example.com",
        ELKS_API_USER: "SECRET_USER",
      },
    );
    const response = await edge.request();
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      enabledSmsTemplates: 2,
      emailConfigured: true,
      smsConfigured: false,
    });
    expect(isLaunchReadiness(payload)).toBe(true);
    expect(JSON.stringify(payload)).not.toMatch(/SECRET|private@example/);
    expect(edge.calls).toEqual(["properties", "message_templates"]);
  });
  it("returns a failed check if the channel-count query fails", async () => {
    const response = await handlerFor([], true).request();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "readiness_unavailable" });
  });
  it("requires property ownership before inspecting message-template configuration", async () => {
    const edge = handlerFor([]);
    expect((await edge.request("other-property")).status).toBe(403);
    expect(edge.calls).toEqual(["properties"]);
  });
});

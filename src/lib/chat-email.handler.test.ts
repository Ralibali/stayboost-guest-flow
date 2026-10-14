import { readFileSync } from "node:fs";
import { ScriptTarget, transpileModule } from "typescript";
import { describe, expect, it, vi } from "vitest";
import * as chat from "../../supabase/functions/_shared/chat";
import * as email from "../../supabase/functions/_shared/email-provider";

const source = readFileSync(
  new URL("../../supabase/functions/chat-message/index.ts", import.meta.url),
  "utf8",
).replace(/import[\s\S]*?from\s+["'][^"']+["'];\s*/g, "");
const code = transpileModule(source, {
  compilerOptions: { target: ScriptTarget.ES2022 },
}).outputText;
const MESSAGE_ID = "00000000-0000-0000-0000-000000000123";
const input = {
  slug: "test-property",
  name: "Test Visitor",
  email: "visitor@example.test",
  message: "Is the tent available?",
  pageUrl: "https://example.test/tents",
};
const resend = {
  EMAIL_PROVIDER: "resend",
  RESEND_API_KEY: "synthetic-resend-key",
  RESEND_SENDER_EMAIL: "host@example.test",
};
const brevo = { BREVO_API_KEY: "synthetic-brevo-key", BREVO_SENDER_EMAIL: "host@example.test" };
type Row = Record<string, unknown>;
function fixture(env: Record<string, string> = resend) {
  const state = {
    saveError: false,
    markError: false,
    markReject: false,
    count: 0,
    enabled: true,
    recipient: "owner@example.test" as string | null,
  };
  const messages: Row[] = [];
  const marks: Row[] = [];
  const order: string[] = [];
  const log = vi.fn();
  const response = new Response("private-provider-response", { status: 201 });
  const readText = vi.spyOn(response, "text");
  const readJson = vi.spyOn(response, "json");
  const cancel = vi.spyOn(response.body!, "cancel");
  const provider = vi.fn<typeof fetch>().mockImplementation(async () => {
    order.push("provider");
    return response;
  });
  const client = {
    from(table: string) {
      let inserted: Row | null = null;
      let updated: Row | null = null;
      const filters: Row = {};
      const run = () => {
        if (table === "properties")
          return {
            data: {
              id: "property-id",
              name: "Test property",
              chat_enabled: state.enabled,
              chat_email: state.recipient,
            },
            error: null,
          };
        if (inserted) {
          if (state.saveError) return { data: null, error: { message: "save_failed" } };
          order.push("saved");
          messages.push({ id: MESSAGE_ID, ...inserted });
          return { data: { id: MESSAGE_ID }, error: null };
        }
        if (updated) {
          order.push("mark");
          if (state.markReject) throw new Error("private-database-details");
          if (state.markError)
            return { data: null, error: { message: "private-database-details" } };
          marks.push({ ...updated, ...filters });
          return { data: null, error: null };
        }
        return { data: null, count: state.count, error: null };
      };
      const query = {
        select: () => query,
        eq(key: string, value: unknown) {
          filters[key] = value;
          return query;
        },
        gte: () => query,
        insert(row: Row) {
          inserted = row;
          return query;
        },
        update(row: Row) {
          updated = row;
          return query;
        },
        single: async () => run(),
        maybeSingle: async () => run(),
        then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
          return Promise.resolve().then(run).then(resolve, reject);
        },
      };
      return query;
    },
  };
  let handler!: (request: Request) => Promise<Response>;
  const signals: AbortSignal[] = [];
  const bindings = {
    ...chat,
    ...email,
    createClient: () => client,
    Deno: {
      env: { get: (key: string) => env[key] },
      serve: (callback: typeof handler) => (handler = callback),
    },
    fetch: provider,
    console: { error: log },
    AbortSignal: {
      timeout: vi.fn((ms: number) => {
        expect(ms).toBe(8_000);
        const signal = new AbortController().signal;
        signals.push(signal);
        return signal;
      }),
    },
  };
  new Function(...Object.keys(bindings), code)(...Object.values(bindings));
  return {
    state,
    messages,
    marks,
    order,
    log,
    provider,
    response,
    readText,
    readJson,
    cancel,
    signals,
    send: (extra: Row = {}) =>
      handler(
        new Request("https://edge.example.test/chat-message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...input, ...extra }),
        }),
      ),
    get: () => handler(new Request("https://edge.example.test/chat-message?slug=test-property")),
  };
}

describe("actual chat-message handler notifications", () => {
  it.each([
    ["Resend", resend, "https://api.resend.com/emails"],
    ["Brevo default", brevo, "https://api.brevo.com/v3/smtp/email"],
  ] as const)("saves inbox before notifying the owner through %s", async (_, config, url) => {
    const f = fixture(config);
    const result = await f.send();
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ ok: true });
    expect(f.order).toEqual(["saved", "provider", "mark"]);
    expect(f.messages).toEqual([
      {
        id: MESSAGE_ID,
        property_id: "property-id",
        visitor_name: input.name,
        visitor_email: input.email,
        message: input.message,
        page_url: input.pageUrl,
      },
    ]);
    expect(f.marks).toEqual([{ id: MESSAGE_ID, emailed: true }]);
    const [endpoint, options] = f.provider.mock.calls[0];
    expect(endpoint).toBe(url);
    expect(options).toMatchObject({ method: "POST", redirect: "error", signal: f.signals[0] });
    const body = JSON.parse(String(options!.body));
    if (config === resend) {
      expect(body.to).toEqual(["owner@example.test"]);
      expect(body.reply_to).toBe(input.email);
      expect(new Headers(options!.headers).get("Idempotency-Key")).toBe(
        `stayboost-chat/${MESSAGE_ID}`,
      );
    } else {
      expect(body.to).toEqual([{ email: "owner@example.test" }]);
      expect(body.replyTo).toEqual({ email: input.email, name: input.name });
      expect(body.headers).toEqual({ idempotencyKey: MESSAGE_ID });
    }
    expect(f.readText).not.toHaveBeenCalled();
    expect(f.readJson).not.toHaveBeenCalled();
    expect(f.cancel).toHaveBeenCalledOnce();
    expect(f.log).not.toHaveBeenCalled();
  });

  it.each([{}, { ...brevo, EMAIL_PROVIDER: "resend" }, { ...resend, RESEND_SENDER_EMAIL: "" }])(
    "keeps the inbox without falling back from missing selected configuration %j",
    async (config) => {
      const f = fixture(config);
      expect(await (await f.send()).json()).toEqual({ ok: true });
      expect(f.messages).toHaveLength(1);
      expect(f.provider).not.toHaveBeenCalled();
      expect(f.marks).toEqual([]);
    },
  );

  it("never notifies before a successful inbox insert", async () => {
    const f = fixture();
    f.state.saveError = true;
    expect((await f.send()).status).toBe(500);
    expect(f.messages).toEqual([]);
    expect(f.provider).not.toHaveBeenCalled();
  });

  it.each([400, 401, 429, 500])("preserves inbox and masks provider failure %s", async (status) => {
    const f = fixture();
    const response = new Response("private-provider-body synthetic-resend-key", { status });
    const read = vi.spyOn(response, "text");
    f.provider.mockResolvedValue(response);
    const result = await f.send();
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ ok: true });
    expect(f.messages).toHaveLength(1);
    expect(f.marks).toEqual([]);
    expect(f.provider).toHaveBeenCalledOnce();
    expect(read).not.toHaveBeenCalled();
    expect(f.log.mock.calls).toEqual([["chat_email_notification_failed"]]);
  });

  it.each(["timeout", "redirect", "network"])(
    "does not retry or expose a %s failure",
    async (reason) => {
      const f = fixture();
      f.provider.mockRejectedValue(
        new Error(`${reason}: private-provider-body synthetic-resend-key`),
      );
      expect(await (await f.send()).json()).toEqual({ ok: true });
      expect(f.messages).toHaveLength(1);
      expect(f.marks).toEqual([]);
      expect(f.provider).toHaveBeenCalledOnce();
      expect(f.log.mock.calls).toEqual([["chat_email_notification_failed"]]);
    },
  );

  it.each(["markError", "markReject"] as const)(
    "does not resend or fail saved submission after %s",
    async (field) => {
      const f = fixture();
      f.state[field] = true;
      expect(await (await f.send()).json()).toEqual({ ok: true });
      expect(f.messages).toHaveLength(1);
      expect(f.provider).toHaveBeenCalledOnce();
      expect(f.log.mock.calls.flat().join(" ")).not.toMatch(/private|synthetic/);
    },
  );

  it("stores unsafe reply-to display names without sending them as headers", async () => {
    const f = fixture();
    expect(await (await f.send({ name: "Visitor\r\nBcc: private@example.test" })).json()).toEqual({
      ok: true,
    });
    expect(f.messages).toHaveLength(1);
    expect(f.provider).not.toHaveBeenCalled();
    expect(f.log.mock.calls).toEqual([["chat_email_notification_failed"]]);
  });

  it("leaves GET, honeypot, rate limit and disabled-chat paths without sends", async () => {
    const f = fixture();
    const config = await (await f.get()).json();
    expect(config.enabled).toBe(true);
    expect(config).not.toHaveProperty("chat_email");
    expect(await (await f.send({ company: "bot" })).json()).toEqual({ ok: true });
    f.state.count = 10;
    expect((await f.send()).status).toBe(429);
    f.state.count = 0;
    f.state.enabled = false;
    expect((await f.send()).status).toBe(404);
    expect(f.messages).toEqual([]);
    expect(f.provider).not.toHaveBeenCalled();
  });

  it("keeps messages when no owner notification address is configured", async () => {
    const f = fixture();
    f.state.recipient = null;
    expect(await (await f.send()).json()).toEqual({ ok: true });
    expect(f.messages).toHaveLength(1);
    expect(f.provider).not.toHaveBeenCalled();
  });
});

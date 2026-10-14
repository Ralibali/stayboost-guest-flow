import { describe, expect, it } from "vitest";
import {
  buildEmailRequest,
  emailProviderConfigured,
  getEmailProvider,
} from "../../supabase/functions/_shared/email-provider";

const environment = (values: Record<string, string | undefined>) => (name: string) => values[name];
const brevo = { BREVO_API_KEY: "mock-brevo", BREVO_SENDER_EMAIL: "host@example.test" };
const resend = {
  EMAIL_PROVIDER: "resend",
  RESEND_API_KEY: "mock-resend",
  RESEND_SENDER_EMAIL: "host@example.test",
};
const message = {
  deliveryId: "00000000-0000-0000-0000-000000000001",
  recipientEmail: "guest@example.test",
  recipientName: "Test guest",
  fallbackSenderName: "Bergs Slussar Glamping",
  subject: "Your stay",
  text: "Guest information with åäö.",
};

describe("explicit transactional email provider selection", () => {
  it("preserves Brevo when no selection exists, including its original sender variables", () => {
    const config = getEmailProvider(
      environment({
        ...brevo,
        RESEND_API_KEY: "unused-resend",
        RESEND_SENDER_EMAIL: "other@example.test",
      }),
    );
    expect(config).toMatchObject({
      provider: "brevo",
      apiKey: "mock-brevo",
      senderEmail: "host@example.test",
    });
    expect(emailProviderConfigured(environment(brevo))).toBe(true);
  });
  it("accepts a selected Resend account without any Brevo credentials", () => {
    expect(getEmailProvider(environment(resend))).toMatchObject({
      provider: "resend",
      apiKey: "mock-resend",
    });
    expect(emailProviderConfigured(environment(resend))).toBe(true);
  });
  it("normalizes configuration whitespace and provider case", () => {
    expect(
      getEmailProvider(
        environment({
          EMAIL_PROVIDER: " ReSeNd ",
          RESEND_API_KEY: " mock-key ",
          RESEND_SENDER_EMAIL: " host@example.test ",
          RESEND_SENDER_NAME: " Bergs ",
        }),
      ),
    ).toEqual({
      provider: "resend",
      apiKey: "mock-key",
      senderEmail: "host@example.test",
      senderName: "Bergs",
    });
  });
  it.each([
    {},
    { RESEND_API_KEY: "mock-resend", RESEND_SENDER_EMAIL: "host@example.test" },
    { ...brevo, EMAIL_PROVIDER: "unsupported" },
    { ...brevo, EMAIL_PROVIDER: "resend" },
    { ...resend, RESEND_API_KEY: "" },
    { ...resend, RESEND_SENDER_EMAIL: "" },
    { ...resend, RESEND_API_KEY: "invalid key" },
    { ...resend, RESEND_SENDER_EMAIL: "invalid" },
    { ...resend, RESEND_SENDER_EMAIL: "Host <host@example.test>" },
    { ...resend, RESEND_SENDER_EMAIL: "host@example.test\r\nBcc:other@example.test" },
    { ...resend, RESEND_SENDER_NAME: "Bergs\r\nBcc: other@example.test" },
  ])("fails closed without a complete selected provider %j", (values) => {
    expect(emailProviderConfigured(environment(values))).toBe(false);
    expect(getEmailProvider(environment(values))).toBeNull();
  });
});

describe("provider request contracts", () => {
  it("uses direct Resend with a stable delivery key and plain-text content", () => {
    const request = buildEmailRequest(getEmailProvider(environment(resend))!, message);
    expect(request.provider).toBe("Resend");
    expect(request.url).toBe("https://api.resend.com/emails");
    expect(request.options.method).toBe("POST");
    const headers = new Headers(request.options.headers);
    expect(headers.get("Authorization")).toBe("Bearer mock-resend");
    expect(headers.get("Idempotency-Key")).toBe(`stayboost-scheduled/${message.deliveryId}`);
    expect(headers.has("api-key")).toBe(false);
    expect(JSON.parse(String(request.options.body))).toEqual({
      from: "Bergs Slussar Glamping <host@example.test>",
      to: ["guest@example.test"],
      subject: "Your stay",
      text: message.text,
    });
    expect(buildEmailRequest(getEmailProvider(environment(resend))!, message).options).toEqual(
      request.options,
    );
  });
  it("preserves the Brevo request contract and configured sender name", () => {
    const config = getEmailProvider(environment({ ...brevo, BREVO_SENDER_NAME: "Bergs" }))!;
    const request = buildEmailRequest(config, message);
    expect(request.provider).toBe("Brevo");
    expect(request.url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(new Headers(request.options.headers).get("api-key")).toBe("mock-brevo");
    expect(JSON.parse(String(request.options.body))).toEqual({
      sender: { email: "host@example.test", name: "Bergs" },
      to: [{ email: "guest@example.test", name: "Test guest" }],
      subject: "Your stay",
      textContent: message.text,
    });
  });
  it.each(["", "contains\ncontrol", "x".repeat(257)])(
    "rejects an unsafe idempotency identity %s",
    (deliveryId) => {
      expect(() =>
        buildEmailRequest(getEmailProvider(environment(resend))!, { ...message, deliveryId }),
      ).toThrow("invalid_email_delivery_id");
    },
  );
});

describe("optional chat reply-to and persisted identity", () => {
  it("rejects a non-UUID chat key for Brevo instead of pretending it provides deduplication", () => {
    expect(() =>
      buildEmailRequest(getEmailProvider(environment(brevo))!, {
        ...message,
        deliveryKind: "chat",
        deliveryId: "not-a-persisted-chat-uuid",
      }),
    ).toThrow("invalid_email_delivery_id");
  });
  it.each([brevo, resend])(
    "preserves scheduled request bytes when chat fields are absent %j",
    (env) => {
      const config = getEmailProvider(environment(env))!;
      const request = buildEmailRequest(config, message);
      const expected =
        config.provider === "resend"
          ? {
              from: "Bergs Slussar Glamping <host@example.test>",
              to: [message.recipientEmail],
              subject: message.subject,
              text: message.text,
            }
          : {
              sender: { email: "host@example.test", name: message.fallbackSenderName },
              to: [{ email: message.recipientEmail, name: message.recipientName }],
              subject: message.subject,
              textContent: message.text,
            };
      expect(request.options.body).toBe(JSON.stringify(expected));
    },
  );

  it.each([brevo, resend])(
    "uses stable chat identity, distinct from scheduled delivery %j",
    (env) => {
      const config = getEmailProvider(environment(env))!;
      const notification = {
        ...message,
        deliveryKind: "chat" as const,
        replyToEmail: "visitor@example.test",
        replyToName: "Åsa Visitor",
      };
      const first = buildEmailRequest(config, notification);
      expect(buildEmailRequest(config, notification)).toEqual(first);
      const body = JSON.parse(String(first.options.body));
      if (config.provider === "resend") {
        expect(body.reply_to).toBe("visitor@example.test");
        expect(new Headers(first.options.headers).get("Idempotency-Key")).toBe(
          `stayboost-chat/${message.deliveryId}`,
        );
      } else {
        expect(body.replyTo).toEqual({ email: "visitor@example.test", name: "Åsa Visitor" });
        expect(body.headers.idempotencyKey).toBe(message.deliveryId);
      }
      expect(first.options.body).not.toBe(buildEmailRequest(config, message).options.body);
      expect(
        buildEmailRequest(config, {
          ...notification,
          deliveryId: "00000000-0000-0000-0000-000000000002",
        }),
      ).not.toEqual(first);
    },
  );

  it.each([
    { replyToEmail: "invalid" },
    { replyToEmail: "visitor@example.test,other@example.test" },
    { replyToEmail: "Visitor <visitor@example.test>" },
    { replyToEmail: "visitor@example.test\r\nBcc: other@example.test" },
    { replyToEmail: "vis\0itor@example.test" },
    { replyToEmail: "visitor@example.test", replyToName: "Visitor\nBcc: other" },
    { replyToEmail: "visitor@example.test", replyToName: "<other@example.test>" },
    { replyToEmail: "visitor@example.test", replyToName: "Vis\u007fitor" },
    { replyToName: "Name without address" },
  ])("rejects unsafe optional reply-to on both providers %j", (reply) => {
    for (const env of [brevo, resend])
      expect(() =>
        buildEmailRequest(getEmailProvider(environment(env))!, { ...message, ...reply }),
      ).toThrow("invalid_email_reply_to");
  });

  it.each([brevo, resend])("requires a bounded persisted chat identity %j", (env) => {
    for (const deliveryId of ["", "contains\ncontrol", "x".repeat(257)])
      expect(() =>
        buildEmailRequest(getEmailProvider(environment(env))!, {
          ...message,
          deliveryKind: "chat",
          deliveryId,
        }),
      ).toThrow("invalid_email_delivery_id");
  });
});

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

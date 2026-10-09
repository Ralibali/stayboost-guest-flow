import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StripeReadinessDetails } from "../components/app/StripeReadinessDetails";
import type { LaunchReadiness } from "./launch-readiness";

const readiness: LaunchReadiness = {
  stripeConfigured: true,
  stripeWebhookConfigured: true,
  emailConfigured: false,
  smsConfigured: false,
  enabledSmsTemplates: 0,
};

describe("owner Stripe configuration details", () => {
  it.each([
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ])("shows the two saved format checks independently (%s, %s)", (key, webhook) => {
    const html = renderToStaticMarkup(
      <StripeReadinessDetails
        readiness={{ ...readiness, stripeConfigured: key, stripeWebhookConfigured: webhook }}
      />,
    );
    const expected = (configured: boolean) =>
      configured ? "Giltigt format" : "Saknas eller behöver rättas";
    expect(html).toMatch(new RegExp(`<dt>Betalningsnyckel</dt><dd[^>]*>${expected(key)}</dd>`));
    expect(html).toMatch(
      new RegExp(`<dt>Betalningsbekräftelser</dt><dd[^>]*>${expected(webhook)}</dd>`),
    );
    expect(html).toContain("Stripe – sparad konfiguration");
    expect(html).toContain("En genomförd provbetalning behövs");
    expect(html).not.toContain("Betalning verifierad");
  });

  it("does not call an unavailable or pending check a missing secret", () => {
    const html = renderToStaticMarkup(<StripeReadinessDetails readiness={null} />);
    expect(html.match(/Inte kontrollerat/g)).toHaveLength(2);
    expect(html).not.toContain("Saknas eller behöver rättas");
    expect(html).not.toContain("Giltigt format");
  });

  it("renders only allowlisted booleans, never any unexpected credential fields", () => {
    const data = {
      ...readiness,
      secretKey: "PRIVATE_KEY_MUST_NOT_RENDER",
      webhookSecret: "PRIVATE_WEBHOOK_MUST_NOT_RENDER",
    };
    const html = renderToStaticMarkup(<StripeReadinessDetails readiness={data} />);
    expect(html).not.toContain("PRIVATE_");
    expect(html).toContain("Inga nyckelvärden visas här");
  });
});

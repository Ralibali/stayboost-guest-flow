import { describe, expect, it } from "vitest";
import {
  MESSAGE_LANGUAGES,
  previewMessageTemplate,
  renderMessageContent,
  type MessageTranslations,
} from "../../supabase/functions/_shared/message-content";
import { buildEmailRequest } from "../../supabase/functions/_shared/email-provider";

const translations: MessageTranslations = Object.fromEntries(
  MESSAGE_LANGUAGES.map((lang) => [
    lang,
    {
      subject: `Subject ${lang}`,
      body: `<h3>${lang}</h3><p style="font-size: 12pt;">Hej {{gäst_namn}}</p><p>%bookinginfo%</p>`,
    },
  ]),
);
const template = {
  body: "Legacy",
  subject: "Legacy subject",
  body_format: "html" as const,
  content_translations: translations,
  source_archive_id: "archive",
};
const booking = {
  id: "booking-reference",
  guest_name: '<img src=x onerror="attack()">',
  guest_token: "synthetic-token",
  checkin_date: "2027-06-01",
  checkout_date: "2027-06-03",
  guests: 2,
  unit: { name: "Tent & lake" },
  quote_snapshot: { language: "en", currency: "SEK", grandTotal: 2324.5 },
};
const property = { name: "Property", checkin_time: "15:00", checkout_time: "10:00" };

describe("bounded multilingual message rendering", () => {
  it.each(MESSAGE_LANGUAGES)(
    "uses the booking's exact %s translation and localized links",
    (lang) => {
      const result = renderMessageContent(
        template,
        { ...booking, quote_snapshot: { ...booking.quote_snapshot, language: lang } },
        property,
      );
      expect(result.subject).toBe(`Subject ${lang}`);
      expect(result.language).toBe(lang);
      expect(result.html).toContain(`<h3>${lang}</h3>`);
      expect(result.html).not.toContain("%bookinginfo%");
      expect(result.text).toContain(`https://stayboost.se/g/synthetic-token?lang=${lang}`);
      expect(result.html).toContain("&lt;img");
      expect(result.html).not.toContain("<img src=");
      expect(result.text).toContain("Tent & lake");
      expect(result.html).toContain("<table><tbody>");
    },
  );
  it("renders exact source text without rewriting placeholder subjects or translating content", () => {
    expect(
      previewMessageTemplate(
        {
          ...template,
          content_translations: {
            ...translations,
            da: { subject: "123", body: "<p>Svensk originaltext</p>" },
          },
        },
        "da",
      ).subject,
    ).toBe("123");
    expect(
      previewMessageTemplate(
        {
          ...template,
          content_translations: {
            ...translations,
            da: { subject: "123", body: "<p>Svensk originaltext</p>" },
          },
        },
        "da",
      ).text,
    ).toBe("Svensk originaltext");
  });
  it("does not silently fall back when an imported translation is missing", () => {
    expect(() =>
      renderMessageContent(
        { ...template, content_translations: { sv: translations.sv } },
        booking,
        property,
      ),
    ).toThrow("message_translation_missing");
  });
  it("keeps legacy subject/body available when no translations exist", () => {
    const result = renderMessageContent(
      { subject: "Hej {{gäst_namn}}", body: "{{anläggning}} {{okänd}}" },
      { ...booking, guest_name: "Alex" },
      property,
    );
    expect(result.subject).toBe("Hej Alex");
    expect(result.text).toBe("Property ");
    expect(result.html).toBeUndefined();
  });
  it("renders purchased extras from the frozen quote without catalog lookups or trusting extra fields", () => {
    const result = renderMessageContent(
      template,
      {
        ...booking,
        quote_snapshot: {
          ...booking.quote_snapshot,
          addons: [
            {
              name: "Purchased <extra>",
              quantity: 2,
              lineTotal: 329,
              privateNote: "never display",
            },
          ],
        },
      },
      property,
    );
    expect(result.text).toContain("Purchased <extra> × 2");
    expect(result.html).toContain("Purchased &lt;extra&gt;");
    expect(result.html).not.toContain("never display");
  });
  it("does not assert paid, balances or zero totals from unknown payment facts", () => {
    const result = renderMessageContent(
      template,
      {
        ...booking,
        payment_amount: null,
        payment_status: "none",
        quote_snapshot: { language: "en" },
      },
      property,
    );
    expect(result.text).not.toContain("Booking total");
    expect(result.text).not.toMatch(/paid|balance|0[.,]00/i);
  });
  it.each([
    "<script>alert(1)</script>",
    '<img src=x onerror="alert(1)">',
    '<svg><a href="javascript:attack()">x</a></svg>',
    '<a href="javascript:attack()">x</a>',
    '<a href="java&#10;script:attack()">x</a>',
    '<a href="data:text/html,attack">x</a>',
    '<p onclick="attack()">x</p>',
    '<iframe src="https://tracker.test">x</iframe>',
    "<form><input></form>",
    '<p style="background:url(https://tracker.test)">x</p>',
    '<p style="color:expression(attack())">x</p>',
    '<a href="https://example.test/{{gäst_namn}}">x</a>',
    '<a href="%bookinginfo%">x</a>',
    "<p>%unmapped%</p>",
    "<math><mtext>x</mtext></math>",
    '<a href="https://user:password@example.test">x</a>',
  ])("rejects active, unimplemented or attribute-placeholder HTML: %s", (body) => {
    expect(() => renderMessageContent({ body, body_format: "html" }, booking, property)).toThrow();
  });
  it("emits only allowlisted formatting and links, never editor resource attributes", () => {
    const result = renderMessageContent(
      {
        body: '<p id="private" data-mce-src="https://tracker.test" style="font-family: arial, helvetica, sans-serif; font-size: 12pt;"><strong>A &amp; B</strong><br><a href="https://example.test">Link</a></p>',
        body_format: "html",
      },
      booking,
      property,
    );
    expect(result.html).toContain('rel="noopener noreferrer"');
    expect(result.html).not.toContain("private");
    expect(result.html).not.toContain("tracker");
    expect(result.text).toContain("A & B\nLink (https://example.test/)");
  });
  it.each([
    "font-family: 'times new roman', times; font-size: 12pt;",
    "font-size: 12pt; font-family: 'times new roman', times;",
  ])("renders the observed review-template font stack: %s", (style) => {
    const result = renderMessageContent(
      { body: `<p style="${style}">Tack för besöket.</p>`, body_format: "html" },
      booking,
      property,
    );
    expect(result.html).toContain("font-family:&#39;times new roman&#39;, times");
    expect(result.html).toContain("font-size:12pt");
    expect(result.text).toBe("Tack för besöket.");
  });
  it.each([
    "font-family: 'times new roman', times, url(https://tracker.test)",
    "font-family: 'times new roman', times; background:url(https://tracker.test)",
    "font-family: 'times new roman', times; color:expression(attack())",
    "font-family: 'times new roman', times !important",
    "font-family: 'times new roman', times; @import 'https://tracker.test'",
  ])("keeps unsafe CSS outside the newly allowed font stack: %s", (style) => {
    expect(() =>
      renderMessageContent(
        { body: `<p style="${style}">Text</p>`, body_format: "html" },
        booking,
        property,
      ),
    ).toThrow("message_style_invalid");
  });
  it("bounds malformed and deeply nested HTML without executing anything", () => {
    expect(() =>
      renderMessageContent(
        { body: "<span>".repeat(70) + "text" + "</span>".repeat(70), body_format: "html" },
        booking,
        property,
      ),
    ).toThrow("message_html_too_complex");
    expect(() => renderMessageContent({ body: "x".repeat(100001) }, booking, property)).toThrow(
      "message_content_invalid",
    );
  });
  it("rejects header injection after placeholder interpolation", () => {
    expect(() =>
      renderMessageContent(
        { body: "ok", subject: "{{gäst_namn}}" },
        { ...booking, guest_name: "Alex\r\nBcc: target@example.test" },
        property,
      ),
    ).toThrow("message_subject_invalid");
  });
  it.each(["resend", "brevo"] as const)(
    "gives %s an explicit HTML and readable text alternative",
    (provider) => {
      const rendered = previewMessageTemplate(template, "sv");
      const req = buildEmailRequest(
        { provider, apiKey: "synthetic-key", senderEmail: "from@example.test" },
        {
          deliveryId: "synthetic-id",
          recipientEmail: "to@example.test",
          ...rendered,
        },
      );
      const body = JSON.parse(String(req.options.body));
      expect(body[provider === "resend" ? "html" : "htmlContent"]).toBe(rendered.html);
      expect(body[provider === "resend" ? "text" : "textContent"]).toBe(rendered.text);
    },
  );
});

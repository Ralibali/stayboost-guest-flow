import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { describe, expect, it } from "vitest";
import {
  MESSAGE_LANGUAGES,
  renderMessageContent,
} from "../../supabase/functions/_shared/message-content";

const booking = {
  id: "synthetic-booking",
  guest_name: "Alex",
  guest_token: "a".repeat(24),
  checkin_date: "2027-06-01",
  checkout_date: "2027-06-03",
  quote_snapshot: { language: "sv" },
};
const property = { name: "Synthetic property", checkin_time: "15:00", checkout_time: "10:00" };
const body = "<p>{{gästsida_länk}}</p><p>%bookinginfo%</p><p>{{gäst_namn}}</p>";
function links(html: string) {
  const found: string[] = [];
  const visit = (node: DefaultTreeAdapterMap["childNode"]) => {
    if (!("tagName" in node)) return;
    if (node.tagName === "a") found.push(node.attrs.find((a) => a.name === "href")?.value ?? "");
    node.childNodes.forEach(visit);
  };
  parseFragment(html).childNodes.forEach(visit);
  return found;
}

describe("trusted guest links in messages", () => {
  it.each(MESSAGE_LANGUAGES)(
    "renders the explicit token and booking-info row as clickable %s links with a text alternative",
    (language) => {
      const result = renderMessageContent(
        {
          body: "unused fallback",
          body_format: "html",
          source_archive_id: "synthetic-archive",
          content_translations: { [language]: { subject: `Subject ${language}`, body } },
        },
        { ...booking, quote_snapshot: { language } },
        property,
      );
      const url = `https://stayboost.se/g/${booking.guest_token}?lang=${language}`;
      expect(result.language).toBe(language);
      expect(result.subject).toBe(`Subject ${language}`);
      expect(links(result.html!)).toEqual([url, url]);
      expect(result.text.split(url).length - 1).toBe(2);
      expect(result.text).not.toContain("<a");
      expect(result.html).not.toContain("{{gästsida_länk}}");
      expect(result.html).not.toContain("%bookinginfo%");
      expect(result.html).toContain('rel="noopener noreferrer"');
    },
  );

  it("URL-encodes tokens and never turns interpolated guest text into a link or markup", () => {
    const token = 'token"<&/?#æ';
    const result = renderMessageContent(
      { body, body_format: "html" },
      {
        ...booking,
        guest_token: token,
        guest_name: '{{gästsida_länk}} <img src=x onerror="attack()">',
        quote_snapshot: { language: "en&redirect=evil" },
      },
      property,
    );
    const url = `https://stayboost.se/g/${encodeURIComponent(token)}?lang=sv`;
    expect(links(result.html!)).toEqual([url, url]);
    expect(result.html).toContain("{{gästsida_länk}} &lt;img");
    expect(result.html).not.toContain("<img");
    expect(result.text).toContain(url);
    expect(result.html).not.toContain("redirect=evil");
  });

  it("retains literal text output and legacy guest URL semantics", () => {
    const result = renderMessageContent(
      { body: "Din sida: {{ gästsida_länk }}" },
      booking,
      property,
    );
    expect(result.html).toBeUndefined();
    expect(result.text).toBe(`Din sida: https://stayboost.se/g/${booking.guest_token}`);
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "http://example.test",
    "https://name:password@example.test",
    "https://example.test/#fragment",
    "https://example.test/with\ncontrol",
    `https://example.test/g/${booking.guest_token}?redirect=`,
  ])("rejects an unsafe generated destination in both formats: %s", (base) => {
    for (const body_format of ["html", "text"] as const) {
      expect(() =>
        renderMessageContent({ body: "{{gästsida_länk}}", body_format }, booking, property, base),
      ).toThrow("message_guest_link_invalid");
    }
  });

  it.each(["", ".", ".."])('rejects an empty or path-traversing token "%s"', (guest_token) => {
    expect(() =>
      renderMessageContent(
        { body: "%bookinginfo%", body_format: "html" },
        { ...booking, guest_token },
        property,
      ),
    ).toThrow("message_guest_link_invalid");
  });

  it.each([
    '<a href="{{gästsida_länk}}">Open</a>',
    '<a href="https://example.test/{{gästsida_länk}}">Open</a>',
    '<span title="{{gästsida_länk}}">Open</span>',
    '<a href="%bookinginfo%">Open</a>',
    '<a href="  {{ gästsida_länk }}  ">Open</a>',
    '<a href="https://example.test/&#123;&#123;gästsida_länk&#125;&#125;">Open</a>',
  ])("continues to reject placeholders in attributes: %s", (body) => {
    expect(() => renderMessageContent({ body, body_format: "html" }, booking, property)).toThrow(
      "message_attribute_not_allowed",
    );
  });

  it.each(["{{gästsida_länk}}", "%bookinginfo%"])(
    "rejects %s inside an existing link instead of creating nested anchors",
    (token) => {
      expect(() =>
        renderMessageContent(
          { body: `<a href="https://example.test"><span>${token}</span></a>`, body_format: "html" },
          booking,
          property,
        ),
      ).toThrow("message_guest_link_nested");
    },
  );
});

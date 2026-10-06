import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { formatSvDate, renderTemplate } from "./templates.ts";
import { appBaseUrl } from "./app-url.ts";

export const MESSAGE_LANGUAGES = ["sv", "en", "de", "da", "no"] as const;
export type MessageLanguage = (typeof MESSAGE_LANGUAGES)[number];
export type MessageTranslations = Partial<
  Record<MessageLanguage, { subject: string; body: string }>
>;
export type MessageContentTemplate = {
  subject?: string | null;
  body: string;
  body_format?: "text" | "html";
  content_translations?: MessageTranslations;
  source_archive_id?: string | null;
};
export type MessageBooking = {
  id?: string;
  guest_name?: string | null;
  guest_token: string;
  checkin_date: string;
  checkout_date: string;
  guests?: number | null;
  payment_status?: string | null;
  payment_amount?: number | null;
  quote_snapshot?: {
    language?: unknown;
    currency?: unknown;
    grandTotal?: unknown;
    addons?: unknown;
  } | null;
  unit?: { name?: string | null } | null;
};
export type MessageProperty = {
  name?: string | null;
  checkin_time?: string | null;
  checkout_time?: string | null;
  directions?: string | null;
  wifi_name?: string | null;
  wifi_password?: string | null;
  review_url?: string | null;
};
export class MessageContentError extends Error {}
const language = (value: unknown): MessageLanguage =>
  MESSAGE_LANGUAGES.includes(value as MessageLanguage) ? (value as MessageLanguage) : "sv";
const locales = { sv: "sv-SE", en: "en-GB", de: "de-DE", da: "da-DK", no: "nb-NO" };
const labels: Record<MessageLanguage, string[]> = {
  sv: [
    "Bokningsreferens",
    "Boende",
    "Incheckning",
    "Utcheckning",
    "Antal gäster",
    "Bokningens totalpris",
    "Gästsida",
  ],
  en: [
    "Booking reference",
    "Accommodation",
    "Check-in",
    "Check-out",
    "Guests",
    "Booking total",
    "Guest page",
  ],
  de: [
    "Buchungsreferenz",
    "Unterkunft",
    "Anreise",
    "Abreise",
    "Gäste",
    "Gesamtpreis",
    "Gästeseite",
  ],
  da: [
    "Bookingreference",
    "Overnatning",
    "Indtjekning",
    "Udtjekning",
    "Antal gæster",
    "Samlet pris",
    "Gæsteside",
  ],
  no: [
    "Bestillingsreferanse",
    "Overnatting",
    "Innsjekking",
    "Utsjekking",
    "Antall gjester",
    "Totalpris",
    "Gjesteside",
  ],
};
function escape(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );
}
function date(value: string, lang: MessageLanguage): string {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(Date.parse(`${value}T12:00:00Z`)) ||
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value
  )
    throw new MessageContentError("message_date_invalid");
  return new Date(`${value}T12:00:00Z`).toLocaleDateString(locales[lang], {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Europe/Stockholm",
  });
}
const tags = new Set([
  "p",
  "span",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "h1",
  "h2",
  "h3",
  "h4",
  "br",
  "a",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "blockquote",
]);
const blocks = new Set(["p", "h1", "h2", "h3", "h4", "li", "tr", "blockquote"]);
const tokenPattern = /%[a-zA-Z][a-zA-Z0-9_-]*%/g;
function safeHref(value: string): string {
  if (/\{\{|%[a-zA-Z][a-zA-Z0-9_-]*%/.test(value))
    throw new MessageContentError("message_attribute_placeholder");
  try {
    const url = new URL(value);
    if (!["https:", "mailto:", "tel:"].includes(url.protocol) || url.username || url.password)
      throw new Error();
    return url.href;
  } catch {
    throw new MessageContentError("message_link_invalid");
  }
}
function safeStyle(value: string): string {
  const result: string[] = [];
  for (const declaration of value.split(";")) {
    if (!declaration.trim()) continue;
    const [key, ...parts] = declaration.split(":");
    const name = key.trim().toLowerCase(),
      content = parts.join(":").trim().toLowerCase();
    const valid =
      (name === "font-size" && /^(?:[8-9]|[1-3][0-9]|40)(?:pt|px)$/.test(content)) ||
      (name === "font-family" &&
        (content === "'times new roman', times" ||
          /^(?:arial|helvetica|sans-serif|serif|verdana|georgia|times new roman)(?:,\s*(?:arial|helvetica|sans-serif|serif|verdana|georgia|times new roman))*$/.test(
            content,
          ))) ||
      (name === "text-align" && /^(left|right|center|justify)$/.test(content)) ||
      (name === "font-weight" && /^(normal|bold|[1-9]00)$/.test(content)) ||
      (name === "text-decoration" && /^(none|underline|line-through)$/.test(content)) ||
      (name === "color" &&
        /^(#[a-f0-9]{3}|#[a-f0-9]{6}|black|white|red|blue|green|gray)$/.test(content));
    if (!valid) throw new MessageContentError("message_style_invalid");
    result.push(`${name}:${content}`);
  }
  return result.join(";");
}

/** No DOM, fetch, resource loading or untrusted HTML insertion. Parse then emit an allowlist. */
export function renderMessageContent(
  template: MessageContentTemplate,
  booking: MessageBooking,
  property: MessageProperty,
  baseUrl?: string,
): { language: MessageLanguage; subject: string; text: string; html?: string } {
  const translations = template.content_translations ?? {};
  const legacy =
    template.body_format !== "html" &&
    !template.source_archive_id &&
    !Object.keys(translations).length &&
    !/%[a-zA-Z][a-zA-Z0-9_-]*%/.test(`${template.subject ?? ""} ${template.body}`);
  const lang = legacy ? "sv" : language(booking.quote_snapshot?.language);
  const translated = Object.hasOwn(translations, lang) ? translations[lang] : undefined;
  if (template.source_archive_id && !translated)
    throw new MessageContentError("message_translation_missing");
  const body = translated?.body ?? template.body,
    subjectSource = translated?.subject ?? template.subject ?? "";
  if (
    typeof body !== "string" ||
    body.length > 100_000 ||
    typeof subjectSource !== "string" ||
    subjectSource.length > 1000
  )
    throw new MessageContentError("message_content_invalid");
  const guestUrl = `${appBaseUrl(baseUrl)}/g/${encodeURIComponent(booking.guest_token)}${legacy ? "" : `?lang=${lang}`}`;
  const vars: Record<string, string> = {
    gäst_namn: booking.guest_name || (legacy ? "gäst" : ""),
    anläggning: property.name ?? "",
    enhet: booking.unit?.name ?? "",
    incheckning: legacy ? formatSvDate(booking.checkin_date) : date(booking.checkin_date, lang),
    utcheckning: legacy ? formatSvDate(booking.checkout_date) : date(booking.checkout_date, lang),
    incheckningstid: property.checkin_time ?? "",
    utcheckningstid: property.checkout_time ?? "",
    gästsida_länk: guestUrl,
    wifi_namn: property.wifi_name ?? "",
    wifi_lösenord: property.wifi_password ?? "",
    vägbeskrivning: property.directions ?? "",
    recensionslänk: property.review_url ?? "",
  };
  const values = [
    booking.id ?? "",
    booking.unit?.name ?? "",
    `${vars.incheckning} ${vars.incheckningstid}`.trim(),
    `${vars.utcheckning} ${vars.utcheckningstid}`.trim(),
    booking.guests == null ? "" : String(booking.guests),
  ];
  const total =
    booking.quote_snapshot?.currency === "SEK" ? booking.quote_snapshot.grandTotal : null;
  values.push(
    typeof total === "number" && Number.isFinite(total) && total >= 0
      ? new Intl.NumberFormat(locales[lang], { style: "currency", currency: "SEK" }).format(total)
      : "",
  );
  values.push(guestUrl);
  const rows = values
    .map((value, i) => [labels[lang][i], value])
    .filter(([, value]) => value !== "");
  const addonLabels = { sv: "Tillval", en: "Extras", de: "Extras", da: "Tilvalg", no: "Tillegg" };
  const addons = booking.quote_snapshot?.addons;
  if (booking.quote_snapshot?.currency === "SEK" && Array.isArray(addons) && addons.length <= 100) {
    for (const addon of addons) {
      if (
        !addon ||
        typeof addon !== "object" ||
        typeof addon.name !== "string" ||
        addon.name.length > 2000 ||
        !Number.isInteger(addon.quantity) ||
        addon.quantity < 1 ||
        addon.quantity > 1000 ||
        typeof addon.lineTotal !== "number" ||
        !Number.isFinite(addon.lineTotal) ||
        addon.lineTotal < 0
      )
        continue;
      rows.push([
        addonLabels[lang],
        `${addon.name} × ${addon.quantity}: ${new Intl.NumberFormat(locales[lang], { style: "currency", currency: "SEK" }).format(addon.lineTotal)}`,
      ]);
    }
  }
  const infoText = rows.map(([key, value]) => `${key}: ${value}`).join("\n");
  const infoHtml = `<table><tbody>${rows.map(([key, value]) => `<tr><th>${escape(key)}</th><td>${escape(value)}</td></tr>`).join("")}</tbody></table>`;
  const expand = (input: string, html: boolean): string => {
    const parts = input.split("%bookinginfo%");
    return parts
      .map((part) => {
        if (part.match(tokenPattern)) throw new MessageContentError("message_placeholder_unknown");
        const rendered = renderTemplate(part, vars);
        return html ? escape(rendered) : rendered;
      })
      .join(html ? infoHtml : infoText);
  };
  if (subjectSource.includes("%bookinginfo%") || /[\r\n]/.test(subjectSource))
    throw new MessageContentError("message_subject_invalid");
  const subject = expand(subjectSource, false);
  if (/[\r\n]/.test(subject)) throw new MessageContentError("message_subject_invalid");
  if (template.body_format !== "html")
    return { language: lang, subject, text: expand(body, false) };
  let visited = 0;
  const visit = (
    node: DefaultTreeAdapterMap["childNode"],
    depth: number,
  ): { html: string; text: string } => {
    if (++visited > 10000 || depth > 60) throw new MessageContentError("message_html_too_complex");
    if (node.nodeName === "#text") {
      const value = (node as DefaultTreeAdapterMap["textNode"]).value;
      return { html: expand(value, true), text: expand(value, false) };
    }
    if (node.nodeName === "#comment") return { html: "", text: "" };
    if (
      !("tagName" in node) ||
      node.namespaceURI !== "http://www.w3.org/1999/xhtml" ||
      !tags.has(node.tagName)
    )
      throw new MessageContentError("message_html_not_allowed");
    const attrs: string[] = [];
    let href: string | undefined;
    for (const attr of node.attrs) {
      if (
        /^on/i.test(attr.name) ||
        attr.namespace ||
        /\{\{|%[a-zA-Z][a-zA-Z0-9_-]*%/.test(attr.value)
      )
        throw new MessageContentError("message_attribute_not_allowed");
      if (attr.name === "href" && node.tagName === "a") {
        href = safeHref(attr.value);
        attrs.push(`href="${escape(href)}"`);
      } else if (attr.name === "style") attrs.push(`style="${escape(safeStyle(attr.value))}"`);
      else if (attr.name === "title") attrs.push(`title="${escape(attr.value)}"`);
      // Editor-only class/id/data attributes are deliberately not emitted.
    }
    if (node.tagName === "a") attrs.push('rel="noopener noreferrer"');
    const children = node.childNodes.map((child) => visit(child, depth + 1));
    const childText = children.map((child) => child.text).join("");
    const linkText = href && childText.trim() !== href ? ` (${href})` : "";
    const attributes = attrs.length ? ` ${attrs.join(" ")}` : "";
    return {
      html: `<${node.tagName}${attributes}>${children.map((child) => child.html).join("")}${node.tagName === "br" ? "" : `</${node.tagName}>`}`,
      text: childText + linkText + (blocks.has(node.tagName) || node.tagName === "br" ? "\n" : ""),
    };
  };
  const nodes = parseFragment(body).childNodes.map((node) => visit(node, 0));
  return {
    language: lang,
    subject,
    html: nodes.map((node) => node.html).join(""),
    text: nodes
      .map((node) => node.text)
      .join("")
      .trim(),
  };
}

export function previewMessageTemplate(template: MessageContentTemplate, lang: MessageLanguage) {
  return renderMessageContent(
    template,
    {
      id: "EXEMPEL-001",
      guest_name: "Alex Exempel",
      guest_token: "example",
      checkin_date: "2099-06-10",
      checkout_date: "2099-06-12",
      guests: 2,
      unit: { name: "Exempeltält" },
      quote_snapshot: { language: lang, currency: "SEK", grandTotal: 1990 },
    },
    { name: "Exempelanläggning", checkin_time: "15:00", checkout_time: "10:00" },
  );
}

import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const articles = JSON.parse(
  readFileSync(new URL("../src/content/editorial/articles.json", import.meta.url), "utf8"),
);
const seen = new Set();
const today = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
for (const article of articles) {
  assert.match(article.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert(!seen.has(article.slug), `Duplicate editorial slug: ${article.slug}`);
  seen.add(article.slug);
  assert(article.title || article.h1, "Missing title");
  const date = article.publishDate || article.publishedDate;
  assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
  assert(date <= today, "Future article must stay in draft queue");
  assert(article.intro && article.sections?.length, "Missing complete article");
  assert(
    article.sections.every((s) => s.heading && s.content),
    "Empty section",
  );
  assert(
    article.editorial?.aiAssisted === true && article.editorial.searchIntent,
    "Missing editorial provenance",
  );
  for (const field of ["sourceCheckedAt", "publishedAt"]) {
    const timestamp = Date.parse(article.editorial[field]);
    assert(Number.isFinite(timestamp) && timestamp <= Date.now(), `Invalid ${field}`);
  }
  assert(article.editorial.sourceUrls.length, "Missing source review");
  for (const url of article.editorial.sourceUrls)
    assert(new URL(url).protocol === "https:", "Source must use HTTPS");
  for (const section of article.sections)
    assert(!/<script|javascript:|onerror=/i.test(section.content), "Unsafe article markup");
}
console.log(`Editorial check passed: ${articles.length} original article(s).`);

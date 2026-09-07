import { readFileSync, writeFileSync } from "node:fs";
const articles = JSON.parse(readFileSync("src/content/editorial/articles.json", "utf8"));
let xml = readFileSync("public/sitemap.xml", "utf8");
for (const item of [{ slug: "", publishedDate: articles[0]?.publishedDate }, ...articles]) {
  const url = `https://stayboost.se/blogg${item.slug ? `/${item.slug}` : ""}`;
  if (!xml.includes(`<loc>${url}</loc>`))
    xml = xml.replace(
      "</urlset>",
      `  <url><loc>${url}</loc><lastmod>${item.publishedDate}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>\n</urlset>`,
    );
}
writeFileSync("public/sitemap.xml", xml);

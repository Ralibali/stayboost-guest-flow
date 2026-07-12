import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

describe("launch content", () => {
  test("does not contain known production placeholders", async () => {
    const files = await Promise.all([
      read("src/routes/index.tsx"),
      read("public/robots.txt"),
      read("public/sitemap.xml"),
      read("public/integritet.html"),
      read("public/villkor.html"),
    ]);
    const joined = files.join("\n");
    expect(joined).not.toContain("Namn Efternamn");
    expect(joined).not.toContain("[Anläggning]");
    expect(joined).not.toContain("TODO: byt");
    expect(joined).not.toContain('href="#"');
  });

  test("SMS guide contains all twelve templates", async () => {
    const guide = await read("public/mallar/stayboost-12-sms.html");
    const headings = guide.match(/<h2>\d+\./g) ?? [];
    expect(headings).toHaveLength(12);
  });
});

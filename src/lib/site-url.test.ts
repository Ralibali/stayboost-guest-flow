import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CANONICAL_ORIGIN,
  LEGAL_PATHS,
  canonicalUrl,
  isLovablePreviewHost,
  legalPageUrl,
  publicCanonicalOrigin,
} from "./site-url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");

const LEGAL_ROUTE_FILES = {
  "/integritetspolicy": "src/routes/integritetspolicy.tsx",
  "/villkor": "src/routes/villkor.tsx",
  "/cookies": "src/routes/cookies.tsx",
  "/dpa": "src/routes/dpa.tsx",
} as const;

function canonicalHrefsFromHeadSource(source: string): string[] {
  return [...source.matchAll(/rel:\s*"canonical"[\s\S]*?href:\s*([^,\n}]+)/g)].map((match) =>
    match[1].trim(),
  );
}

describe("kanonisk värd (legal / OG)", () => {
  it("defaultar till stayboost.se och vägrar lovable.app", () => {
    expect(CANONICAL_ORIGIN).toBe("https://stayboost.se");
    expect(isLovablePreviewHost("stayboost-sverige.lovable.app")).toBe(true);
    expect(isLovablePreviewHost("lovable.app")).toBe(true);
    expect(isLovablePreviewHost("stayboost.se")).toBe(false);

    expect(publicCanonicalOrigin(undefined)).toBe("https://stayboost.se");
    expect(publicCanonicalOrigin("")).toBe("https://stayboost.se");
    expect(publicCanonicalOrigin("https://stayboost-sverige.lovable.app")).toBe(
      "https://stayboost.se",
    );
    expect(publicCanonicalOrigin("https://stayboost-sverige.lovable.app/cookies")).toBe(
      "https://stayboost.se",
    );
    expect(publicCanonicalOrigin("not a url")).toBe("https://stayboost.se");
    expect(publicCanonicalOrigin("https://stayboost.se/")).toBe("https://stayboost.se");

    expect(canonicalUrl("/")).toBe("https://stayboost.se/");
    expect(canonicalUrl("/cookies")).toBe("https://stayboost.se/cookies");
    expect(canonicalUrl("villkor")).toBe("https://stayboost.se/villkor");
  });

  it("legal canonical/og är stayboost.se/{path} och inte startsidan", () => {
    for (const path of LEGAL_PATHS) {
      const url = legalPageUrl(path);
      expect(url).toBe(`https://stayboost.se${path}`);
      expect(url).not.toBe("https://stayboost.se/");
      expect(url).not.toMatch(/lovable\.app/);
    }
  });

  it("legal-rutter har exakt en self-canonical och og:url på stayboost.se", () => {
    for (const [path, file] of Object.entries(LEGAL_ROUTE_FILES)) {
      const source = read(file);
      expect(source, file).not.toMatch(/stayboost-sverige\.lovable\.app/);
      expect(source, file).not.toMatch(/https:\/\/[a-z0-9.-]*lovable\.app/);
      expect(source, file).toContain(`legalPageUrl("${path}")`);
      expect(source, file).toContain('property: "og:url"');
      expect(source, file).toContain('rel: "canonical"');

      const hrefs = canonicalHrefsFromHeadSource(source);
      expect(hrefs, `${file} canonical count`).toHaveLength(1);
      expect(hrefs[0]).toMatch(/CANONICAL|legalPageUrl/);
    }
  });

  it("root släpper inte startsidans canonical/og:url på undersidor", () => {
    const rootSource = read("src/routes/__root.tsx");
    expect(rootSource).not.toMatch(/rel:\s*"canonical"/);
    expect(rootSource).not.toMatch(/property:\s*"og:url"/);
    expect(rootSource).not.toMatch(/stayboost-sverige\.lovable\.app/);
  });

  it("startsidan behåller stayboost.se-identitet i index-head", () => {
    const index = read("src/routes/index.tsx");
    expect(index).toContain('canonicalUrl("/")');
    expect(index).toContain('property: "og:url"');
    expect(index).toContain('rel: "canonical"');
    expect(index).not.toMatch(/lovable\.app/);
  });

  it("tidiga-kunder har self-canonical på stayboost.se, inte lovable.app", () => {
    const source = read("src/routes/tidiga-kunder.tsx");
    expect(source).toContain("canonicalUrl(SALES_PATH)");
    expect(source).toContain('property: "og:url"');
    expect(source).toContain('rel: "canonical"');
    expect(source).not.toMatch(/lovable\.app/);
    expect(source).not.toContain("lovable-badge");
    expect(canonicalUrl("/tidiga-kunder")).toBe("https://stayboost.se/tidiga-kunder");
    expect(canonicalUrl("/tidiga-kunder")).not.toMatch(/lovable\.app/);
  });
});

describe("public sitemap", () => {
  const SITEMAP_ALLOWLIST = [
    "https://stayboost.se/",
    "https://stayboost.se/cookies",
    "https://stayboost.se/villkor",
    "https://stayboost.se/integritetspolicy",
    "https://stayboost.se/dpa",
  ] as const;

  it("urlset is exactly the HQ live-200 allowlist", () => {
    const xml = read("public/sitemap.xml");
    expect(xml).not.toMatch(/lovable\.app/i);
    expect(xml).not.toMatch(/\/app(?:\/|"|'|\s|<|$)/);
    expect(xml).not.toMatch(/<!--/);

    const locs = [...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/g)].map((match) => match[1].trim());
    expect(locs).toHaveLength(SITEMAP_ALLOWLIST.length);
    expect(new Set(locs)).toEqual(new Set(SITEMAP_ALLOWLIST));

    for (const loc of locs) {
      const url = new URL(loc);
      expect(url.origin).toBe("https://stayboost.se");
      expect(url.search).toBe("");
      expect(url.hash).toBe("");
      expect(url.pathname.startsWith("/app")).toBe(false);
    }

    expect(locs.filter((loc) => loc === "https://stayboost.se/")).toHaveLength(1);
    expect(locs.filter((loc) => loc.endsWith("/") && loc !== "https://stayboost.se/")).toEqual([]);
  });
});

describe("BLOCKED_BADGE", () => {
  it("legal/index-rutter injicerar inte lovable-badge — host-injektion", () => {
    const files = [
      "src/routes/__root.tsx",
      "src/routes/index.tsx",
      "src/routes/integritetspolicy.tsx",
      "src/routes/villkor.tsx",
      "src/routes/cookies.tsx",
      "src/routes/dpa.tsx",
      "src/components/legal/LegalLayout.tsx",
      "src/lib/site-url.ts",
      "src/routes/tidiga-kunder.tsx",
      "src/components/landing/FoundingOffer.tsx",
      "src/components/landing/DemoCta.tsx",
    ];
    for (const file of files) {
      const text = read(file);
      expect(text, file).not.toContain("lovable-badge");
      expect(text, file).not.toContain("lovable.dev/projects/");
      expect(text, file).not.toMatch(/#lovable-badge/);
    }
    // main landed a first-byte CSS hide in styles.css (Lovable). That is not
    // this PR's legal-canonical fix; the badge markup is still host-injected.
  });
});

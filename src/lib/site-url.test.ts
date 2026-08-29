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

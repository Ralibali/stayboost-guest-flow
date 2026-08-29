import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  GSC_HTML_BODY,
  GSC_HTML_PATH,
  GSC_META_CONTENT,
  gscHtmlResponse,
  isGscVerificationRequest,
} from "./gsc-verification";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");
const readBytes = (...parts: string[]) => readFileSync(join(root, ...parts));

describe("GSC HTML-file verification", () => {
  it("public token file is exactly one line, no BOM", () => {
    const bytes = readBytes("public/google810803ca6fbfcead.html");
    expect(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);
    expect(bytes.toString("utf8")).toBe(GSC_HTML_BODY);
    expect(GSC_HTML_BODY).toBe("google-site-verification: google810803ca6fbfcead.html\n");
    expect(GSC_HTML_BODY.includes("<")).toBe(false);
    expect(GSC_HTML_BODY.toLowerCase()).not.toContain("doctype");
    expect(GSC_HTML_BODY.toLowerCase()).not.toContain("<html");
  });

  it("handler returns 200 text/plain token, never the SPA shell", async () => {
    const get = gscHtmlResponse("GET");
    expect(get.status).toBe(200);
    expect(get.headers.get("content-type")).toMatch(/^text\/plain/);
    const body = await get.text();
    expect(body).toBe(GSC_HTML_BODY);
    expect(body.length).toBeLessThan(80);
    expect(body).not.toMatch(/<!DOCTYPE|<html|StayBoost|Sidan hittades inte/i);

    const req = new Request(`https://stayboost.se${GSC_HTML_PATH}`);
    expect(isGscVerificationRequest(req)).toBe(true);
    expect(isGscVerificationRequest(new Request("https://stayboost.se/"))).toBe(false);
    expect(
      isGscVerificationRequest(
        new Request(`https://stayboost.se${GSC_HTML_PATH}`, { method: "POST" }),
      ),
    ).toBe(false);
  });

  it("server entry intercepts the path before TanStack/Nitro SSR", () => {
    const server = read("src/server.ts");
    expect(server).toContain("isGscVerificationRequest");
    expect(server).toContain("gscHtmlResponse");
    const fetchAt = server.indexOf("async fetch(request");
    const interceptAt = server.indexOf("isGscVerificationRequest(request)", fetchAt);
    const spaAt = server.indexOf("await getServerEntry()", fetchAt);
    expect(fetchAt).toBeGreaterThan(-1);
    expect(interceptAt).toBeGreaterThan(fetchAt);
    expect(spaAt).toBeGreaterThan(interceptAt);
  });

  it("TanStack server route serves the same token", () => {
    const route = read("src/routes/google810803ca6fbfcead[.]html.ts");
    expect(route).toContain('createFileRoute("/google810803ca6fbfcead.html")');
    expect(route).toContain("GSC_HTML_BODY");
    expect(route).toContain("text/plain");
    expect(route).toContain("server:");
    expect(route).toContain("GET:");
    expect(route).not.toContain("component:");
  });

  it("homepage SSR head includes the verification meta", () => {
    const index = read("src/routes/index.tsx");
    const root = read("src/routes/__root.tsx");
    expect(index).toContain('name: "google-site-verification"');
    expect(index).toContain(`content: "${GSC_META_CONTENT}"`);
    expect(root).toContain('name="google-site-verification"');
    expect(root).toContain(GSC_META_CONTENT);
    expect(root).toContain("<head>");
  });
});

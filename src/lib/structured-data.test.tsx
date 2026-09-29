import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FAQ } from "../components/landing/FAQ";
import { Route } from "../routes/__root";

vi.mock("@tanstack/react-router", () => ({
  createRootRouteWithContext: () => (options: unknown) => ({ options }),
  Outlet: () => null,
  Link: () => null,
  useRouter: vi.fn(),
  HeadContent: () => null,
  Scripts: () => null,
}));
vi.mock("../lib/analytics", () => ({ initAnalytics: vi.fn() }));
vi.mock("../lib/lovable-error-reporting", () => ({ reportLovableError: vi.fn() }));

describe("page-specific structured data", () => {
  const root = Route as unknown as {
    options: { head: () => { scripts: { type: string; children: string }[] } };
  };
  const inheritedData = () =>
    root.options.head().scripts.map((script) => JSON.parse(script.children));

  it("does not attach homepage questions to blog and other routes", () => {
    const data = inheritedData();
    expect(data.some((item) => item["@type"] === "FAQPage")).toBe(false);
    expect(data.filter((item) => item["@type"] === "SoftwareApplication")).toHaveLength(1);
  });

  it("keeps one FAQ schema beside the homepage's visible questions", () => {
    const html = renderToStaticMarkup(<FAQ />);
    const scripts = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)];
    const data = [...inheritedData(), ...scripts.map((match) => JSON.parse(match[1]))];
    const faqs = data.filter((item) => item["@type"] === "FAQPage");
    expect(faqs).toHaveLength(1);
    expect(faqs[0].mainEntity).toHaveLength(9);
    const visibleHtml = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
    for (const question of faqs[0].mainEntity) {
      expect(visibleHtml).toContain(question.name);
      expect(question.acceptedAnswer.text.length).toBeGreaterThan(0);
    }
  });
});

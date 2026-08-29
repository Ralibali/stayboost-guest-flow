/** Google Search Console URL-prefix verification for https://stayboost.se/ */

export const GSC_HTML_PATH = "/google810803ca6fbfcead.html";
export const GSC_HTML_BODY = "google-site-verification: google810803ca6fbfcead.html\n";
export const GSC_META_CONTENT = "qQp-5rS0NEPk0bognvzXuH7kaRD1etXS99sMYZKbq_Y";

export function isGscVerificationRequest(request: Request): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  try {
    return new URL(request.url).pathname === GSC_HTML_PATH;
  } catch {
    return false;
  }
}

export function gscHtmlResponse(method = "GET"): Response {
  return new Response(method === "HEAD" ? null : GSC_HTML_BODY, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

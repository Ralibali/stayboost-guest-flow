// Server-only helpers for the subscribe server function.
// Kept out of *.functions.ts because module-scope helpers get stripped
// from server-fn splits and would throw ReferenceError at runtime.

type RateBucket = { count: number; resetAt: number };
const ipHits = new Map<string, RateBucket>();
const HOUR = 60 * 60 * 1000;

export function checkIpRate(ip: string, max = 5, windowMs = HOUR): boolean {
  const now = Date.now();
  const bucket = ipHits.get(ip);
  if (!bucket || bucket.resetAt < now) {
    ipHits.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= max) return false;
  bucket.count += 1;
  return true;
}

export function listIdForSource(source: string): string | undefined {
  if (source === "sms-mallar") return process.env.BREVO_TEMPLATES_LIST_ID;
  return process.env.BREVO_LIST_ID;
}

export async function upsertBrevoContact(
  email: string,
  source: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return { ok: false, message: "missing_api_key" };
  const listId = listIdForSource(source);
  const body: Record<string, unknown> = {
    email,
    attributes: { SOURCE: source },
    updateEnabled: true,
  };
  if (listId) body.listIds = [Number(listId)];

  const res = await fetch("https://api.brevo.com/v3/contacts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify(body),
  });
  if (res.ok || res.status === 201 || res.status === 204) return { ok: true };
  const text = await res.text().catch(() => "");
  // Duplicate contact = success
  if (res.status === 400 && /duplicate/i.test(text)) return { ok: true };
  console.error("[brevo] contact upsert failed", res.status, text);
  return { ok: false, message: "brevo_error" };
}

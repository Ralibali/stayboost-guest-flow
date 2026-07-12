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

function templateIdForSource(source: string): string | undefined {
  if (source === "sms-mallar") return process.env.BREVO_TEMPLATE_ID_SMS_MALLAR;
  return process.env.BREVO_TEMPLATE_ID_TRIAL;
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
    attributes: { SOURCE: source, SIGNUP_AT: new Date().toISOString() },
    updateEnabled: true,
  };
  // Attach to the list the Brevo-automation (drip/trial) lyssnar på.
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
  // Duplicate contact = success (Brevo returnerar 400 med "duplicate_parameter")
  if (res.status === 400 && /duplicate/i.test(text)) return { ok: true };
  console.error("[brevo] contact upsert failed", res.status, text);
  return { ok: false, message: "brevo_error" };
}

/**
 * Skickar ett Brevo-template mail (transaktionellt) direkt vid signup.
 * `sms-mallar` → mallen med PDF-länken. `early-access` → trial-välkomstmail.
 * Långsiktig drip körs som automation kopplad till respektive lista.
 * Fel här ska INTE fälla hela flödet — kontakten är redan tillagd i listan.
 */
export async function sendBrevoTemplate(
  email: string,
  source: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return { ok: false, message: "missing_api_key" };
  const templateId = templateIdForSource(source);
  if (!templateId) return { ok: true }; // ingen mall konfigurerad → hoppa tyst
  const params: Record<string, unknown> = { source };
  if (source === "sms-mallar") {
    params.pdf_url =
      process.env.PUBLIC_LEADMAGNET_PDF_URL ?? "https://stayboost.se/mallar/stayboost-12-sms.pdf";
  }
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      to: [{ email }],
      templateId: Number(templateId),
      params,
    }),
  });
  if (res.ok) return { ok: true };
  const text = await res.text().catch(() => "");
  console.error("[brevo] template send failed", res.status, text);
  return { ok: false, message: "brevo_send_failed" };
}

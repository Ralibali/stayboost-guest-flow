/** Host-configured public links may use HTTPS, with no embedded credentials or control characters. */
export function sanitizedHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value))
    return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

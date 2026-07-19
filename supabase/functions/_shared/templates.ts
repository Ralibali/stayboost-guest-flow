// StayBoost: mallmotor för gästmeddelanden.
// Ren TypeScript utan Deno-beroenden — delas av edge-funktionen
// send-scheduled-messages och av enhetstesterna i src/lib/fas1.test.ts.

/** Ersätter {{variabel}} med värdet ur vars; okända variabler blir tomma. */
export function renderTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (_, key: string) => vars[key.trim()] ?? "");
}

/** "2026-08-14" → "14 augusti" (alltid Europe/Stockholm). */
export function formatSvDate(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("sv-SE", {
    day: "numeric",
    month: "long",
    timeZone: "Europe/Stockholm",
  });
}

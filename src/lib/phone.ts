// StayBoost: telefonhantering för svenska mobilnummer.
// Ren TypeScript utan beroenden — delas av bokningsformulär, admin och tester.
// Normaliserar till E.164 (+46XXXXXXXXX) och accepterar vanliga svenska skrivsätt.

/** Rensar bort mellanslag, bindestreck, parenteser och punkter. */
const strip = (s: string) => s.replace(/[\s().\-]/g, "");

/**
 * Normaliserar ett svenskt mobilnummer till E.164.
 * Returnerar null om numret inte är ett giltigt svenskt mobilnummer (07x…).
 * Tillåter både `070…`, `+4670…`, `004670…` och `4670…`.
 */
export function normalizePhoneSE(input: string): string | null {
  if (!input) return null;
  let n = strip(input);
  if (!n) return null;
  if (n.startsWith("+")) n = n.slice(1);
  else if (n.startsWith("00")) n = n.slice(2);
  else if (n.startsWith("0")) n = "46" + n.slice(1);
  if (!/^\d+$/.test(n)) return null;
  if (!n.startsWith("46")) return null;
  const local = n.slice(2);
  // Svenska mobilnummer börjar med 7 följt av 8 siffror (totalt 9 efter landskod).
  if (!/^7\d{8}$/.test(local)) return null;
  return `+46${local}`;
}

/** Snabb boolean-variant. */
export const isValidPhoneSE = (input: string) => normalizePhoneSE(input) !== null;

/** Presentationsformat: `+46 70 123 45 67` för läsbarhet i UI. */
export function formatPhoneSE(e164: string): string {
  const m = e164.match(/^\+46(7\d)(\d{3})(\d{2})(\d{2})$/);
  return m ? `+46 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : e164;
}

/** Contact numbers are stored in E.164 for the SMS provider. Local numbers default to Sweden. */
export function normalizeGuestPhone(input: string): string | null {
  if (input.length > 60 || !/^[+\d\s().-]*$/.test(input)) return null;
  const compact = input.replace(/[\s().-]/g, "");
  if (!compact) return null;
  let number: string;
  if (compact.startsWith("+")) number = compact;
  else if (compact.startsWith("00")) number = `+${compact.slice(2)}`;
  else if (/^07\d{8}$/.test(compact)) number = `+46${compact.slice(1)}`;
  else if (/^467\d{8}$/.test(compact)) number = `+${compact}`;
  else return null;
  // E.164 has at most 15 digits. Require a country prefix for international guests.
  if (!/^\+[1-9]\d{7,14}$/.test(number)) return null;
  if (number.startsWith("+46") && !/^\+467\d{8}$/.test(number)) return null;
  return number;
}

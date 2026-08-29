/** Single-tenant: public signup is off unless HQ explicitly enables it. */
export function publicSignupEnabled(envValue: string | undefined | null): boolean {
  return envValue === "true";
}

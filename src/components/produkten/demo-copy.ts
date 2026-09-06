export const DEMO_TRUST_LINE = "Förhandsvisning — exempeldata. Inget bokas eller debiteras.";

/** WCAG 2.2 minimum target for primary demo actions on 375–430px. */
export const DEMO_TOUCH_MIN_PX = 44;

/** iOS home-indicator clearance for the demo Fortsätt / cart docks. */
export const DEMO_SAFE_AREA_BOTTOM = "max(0.75rem, env(safe-area-inset-bottom, 0px))";

export function demoHasMobileDock(pathname: string): boolean {
  return pathname === "/produkten/boka" || pathname === "/produkten/gast";
}

/** Short labels so the sticky mobile Fortsätt control stays ≥44px and does not overflow. */
export function demoMobileContinueLabel({
  canNext,
  step,
  hasCheckOut,
}: {
  canNext: boolean;
  step: number;
  hasCheckOut: boolean;
}): string {
  if (canNext) return step === 2 ? "Till betalning" : "Fortsätt";
  if (step === 0 && !hasCheckOut) return "Välj datum först";
  if (step === 1) return "Välj boende";
  if (step === 3) return "Fyll i uppgifter";
  return "Fortsätt";
}

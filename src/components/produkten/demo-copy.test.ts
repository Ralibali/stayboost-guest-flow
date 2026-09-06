import { describe, expect, it } from "vitest";
import {
  DEMO_SAFE_AREA_BOTTOM,
  DEMO_TOUCH_MIN_PX,
  DEMO_TRUST_LINE,
  demoHasMobileDock,
  demoMobileContinueLabel,
} from "@/components/produkten/demo-copy";

describe("produkten demo trust copy", () => {
  it("keeps the locked Swedish preview disclaimer", () => {
    expect(DEMO_TRUST_LINE).toBe("Förhandsvisning — exempeldata. Inget bokas eller debiteras.");
  });
});

describe("produkten demo mobile helpers", () => {
  it("locks the 44px touch floor and safe-area dock padding", () => {
    expect(DEMO_TOUCH_MIN_PX).toBe(44);
    expect(DEMO_SAFE_AREA_BOTTOM).toContain("safe-area-inset-bottom");
  });

  it("marks booking and guest-hub as mobile dock routes", () => {
    expect(demoHasMobileDock("/produkten/boka")).toBe(true);
    expect(demoHasMobileDock("/produkten/gast")).toBe(true);
    expect(demoHasMobileDock("/produkten/admin")).toBe(false);
    expect(demoHasMobileDock("/produkten")).toBe(false);
  });

  it("keeps the mobile Fortsätt label short when dates are missing", () => {
    expect(demoMobileContinueLabel({ canNext: false, step: 0, hasCheckOut: false })).toBe(
      "Välj datum först",
    );
    expect(demoMobileContinueLabel({ canNext: true, step: 0, hasCheckOut: true })).toBe("Fortsätt");
    expect(demoMobileContinueLabel({ canNext: true, step: 2, hasCheckOut: true })).toBe(
      "Till betalning",
    );
    expect(demoMobileContinueLabel({ canNext: false, step: 1, hasCheckOut: true })).toBe(
      "Välj boende",
    );
  });
});

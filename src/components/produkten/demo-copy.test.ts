import { describe, expect, it } from "vitest";
import { DEMO_TRUST_LINE } from "@/components/produkten/demo-copy";

describe("produkten demo trust copy", () => {
  it("keeps the locked Swedish preview disclaimer", () => {
    expect(DEMO_TRUST_LINE).toBe(
      "Förhandsvisning — exempeldata. Inget bokas eller debiteras.",
    );
  });
});

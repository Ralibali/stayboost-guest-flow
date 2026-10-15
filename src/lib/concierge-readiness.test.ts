import { describe, expect, it } from "vitest";
import { conciergeReadiness } from "./concierge-readiness";

describe("concierge readiness", () => {
  it("marks a configured concierge ready", () => {
    expect(
      conciergeReadiness({
        guestAiEnabled: true,
        knowledgeCount: 5,
        hasInstructions: true,
        activeAddonCount: 2,
      }),
    ).toEqual({ score: 100, level: "ready", nextActions: [] });
  });

  it("returns concrete setup actions", () => {
    const result = conciergeReadiness({
      guestAiEnabled: false,
      knowledgeCount: 1,
      hasInstructions: false,
      activeAddonCount: 0,
    });
    expect(result.score).toBe(0);
    expect(result.level).toBe("setup");
    expect(result.nextActions).toHaveLength(4);
    expect(result.nextActions[1]).toContain("2");
  });
});

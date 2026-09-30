export type ConciergeReadinessInput = {
  guestAiEnabled: boolean;
  knowledgeCount: number;
  hasInstructions: boolean;
  activeAddonCount: number;
};

export type ConciergeReadiness = {
  score: number;
  level: "setup" | "pilot" | "ready";
  nextActions: string[];
};

export function conciergeReadiness(input: ConciergeReadinessInput): ConciergeReadiness {
  let score = 0;
  const nextActions: string[] = [];

  if (input.guestAiEnabled) score += 30;
  else nextActions.push("Aktivera Guest AI när kunskapsbasen är granskad.");

  if (input.knowledgeCount >= 3) score += 30;
  else nextActions.push(`Lägg till minst ${Math.max(0, 3 - input.knowledgeCount)} verifierade FAQ-svar till.`);

  if (input.hasInstructions) score += 20;
  else nextActions.push("Skriv instruktioner för ton, gränser och när personal ska ta över.");

  if (input.activeAddonCount > 0) score += 20;
  else nextActions.push("Lägg upp minst ett aktivt tillval om concierge-flödet ska stötta merförsäljning.");

  return {
    score,
    level: score >= 90 ? "ready" : score >= 50 ? "pilot" : "setup",
    nextActions,
  };
}

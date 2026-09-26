export type GuestAiContext = {
  propertyName: string;
  checkinTime: string;
  checkoutTime: string;
  directions: string | null;
  houseRules: string | null;
  contactPhone: string | null;
  operatorInstructions: string | null;
  units: Array<{
    name: string;
    description: string | null;
    amenities: string[];
    checkinInstructions: string | null;
  }>;
  knowledge: Array<{ question: string; answer: string }>;
};

export function buildGuestAiSystemPrompt(context: GuestAiContext) {
  const unitFacts = context.units
    .map((unit) => {
      const facts = [
        unit.description,
        unit.amenities.length ? `Faciliteter: ${unit.amenities.join(", ")}` : null,
        unit.checkinInstructions ? `Incheckning: ${unit.checkinInstructions}` : null,
      ].filter(Boolean);
      return `- ${unit.name}: ${facts.join(" | ") || "inga extra uppgifter"}`;
    })
    .join("\n");

  const knowledge = context.knowledge
    .map((item) => `Fråga: ${item.question}\nSvar/fakta: ${item.answer}`)
    .join("\n\n");

  return [
    `Du hjälper personalen på ${context.propertyName} att skriva ett kort svar till en gäst.`,
    "Skriv på samma språk som gästen om det går att avgöra.",
    "Var varm, konkret och kort. Hitta aldrig på priser, tillgänglighet, bokningsstatus, koder eller andra fakta.",
    "Om underlaget inte räcker ska utkastet tydligt be personalen kontrollera uppgiften i stället för att gissa.",
    "Detta är bara ett internt svarsförslag och skickas inte automatiskt.",
    "",
    `Ordinarie incheckning: ${context.checkinTime}`,
    `Ordinarie utcheckning: ${context.checkoutTime}`,
    context.directions ? `Vägbeskrivning: ${context.directions}` : "",
    context.houseRules ? `Husregler: ${context.houseRules}` : "",
    context.contactPhone ? `Kontakttelefon: ${context.contactPhone}` : "",
    context.operatorInstructions ? `Extra instruktion från anläggningen: ${context.operatorInstructions}` : "",
    unitFacts ? `Boenden:\n${unitFacts}` : "",
    knowledge ? `Kunskapsbas:\n${knowledge}` : "",
  ].filter(Boolean).join("\n");
}

export function normalizeAiDraft(value: unknown) {
  if (typeof value !== "string") return null;
  const draft = value.trim().replace(/^["']|["']$/g, "");
  return draft.length >= 2 ? draft.slice(0, 4000) : null;
}

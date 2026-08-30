export type IcalDisappearancePolicy = "normal" | "mass" | "empty" | "sirvoy";

export const NORMAL_MISSING_CONFIRMATIONS = 2;
export const NORMAL_MISSING_GRACE_MS = 30 * 60 * 1000;
export const MASS_MISSING_CONFIRMATIONS = 3;
export const MASS_MISSING_GRACE_MS = 6 * 60 * 60 * 1000;

export function classifyDisappearancePolicy(input: {
  channelType: string | null | undefined;
  activeFeedEvents: number;
  confirmedFutureBookings: number;
  missingCandidates: number;
}): IcalDisappearancePolicy {
  if (input.channelType === "sirvoy") return "sirvoy";

  if (input.confirmedFutureBookings > 0 && input.activeFeedEvents === 0) {
    return "empty";
  }

  if (
    input.missingCandidates >= 2 &&
    input.confirmedFutureBookings > 0 &&
    input.missingCandidates * 2 >= input.confirmedFutureBookings
  ) {
    return "mass";
  }

  return "normal";
}

export function nextMissingObservation(input: {
  previousMissingSince: string | null | undefined;
  previousMissingCount: number | null | undefined;
  nowIso: string;
  policy: IcalDisappearancePolicy;
}) {
  const missingCount = Math.max(0, Math.floor(input.previousMissingCount ?? 0)) + 1;
  const parsedPrevious = input.previousMissingSince
    ? new Date(input.previousMissingSince).getTime()
    : Number.NaN;
  const missingSince = Number.isFinite(parsedPrevious)
    ? input.previousMissingSince!
    : input.nowIso;
  const elapsedMs = Math.max(0, new Date(input.nowIso).getTime() - new Date(missingSince).getTime());

  if (input.policy === "sirvoy") {
    return {
      missingSince,
      missingCount,
      shouldCancel: false,
      reason: "sirvoy_source_of_truth" as const,
    };
  }

  if (input.policy === "empty") {
    return {
      missingSince,
      missingCount,
      shouldCancel: false,
      reason: "empty_feed_protected" as const,
    };
  }

  const requiredConfirmations =
    input.policy === "mass" ? MASS_MISSING_CONFIRMATIONS : NORMAL_MISSING_CONFIRMATIONS;
  const requiredGraceMs =
    input.policy === "mass" ? MASS_MISSING_GRACE_MS : NORMAL_MISSING_GRACE_MS;
  const shouldCancel = missingCount >= requiredConfirmations && elapsedMs >= requiredGraceMs;

  return {
    missingSince,
    missingCount,
    shouldCancel,
    reason: shouldCancel
      ? ("confirmed_disappearance" as const)
      : input.policy === "mass"
        ? ("mass_disappearance_grace" as const)
        : ("disappearance_grace" as const),
  };
}

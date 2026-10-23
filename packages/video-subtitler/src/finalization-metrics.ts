import type {
  CueDecision,
  FinalizationFinding,
  SubtitleCue,
  SubtitlePresentationResolution,
} from "@mvl/shared";

export interface C5FinalizationRates {
  automaticCueRate: number;
  nonBlockingCueRate: number;
  passiveBaselineAcceptanceRate: number;
  autoResolvedCueRate: number;
  autoMutationCueRate: number;
  presentationAutoResolvedCueRate: number;
  intentionalRepetitionResolvedCueRate: number;
  legalOverlapCueRate: number;
  humanBaselineCueRate: number;
  manualReviewCueRate: number;
  blockingCueRate: number;
}

function rate(count: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.min(1, Math.max(0, count / denominator));
}

function cueIdSet(
  values: readonly { cueIds: readonly string[] }[],
): Set<string> {
  return new Set(values.flatMap((value) => value.cueIds));
}

/**
 * Computes C5.14 rates with separate meanings for passive acceptance,
 * structural auto-resolution, and canonical mutation. `automaticCueRate` is a
 * deprecated compatibility alias of `autoResolvedCueRate`.
 */
export function calculateC5FinalizationRates(input: {
  baselineCues: readonly SubtitleCue[];
  finalCues: readonly SubtitleCue[];
  findings: readonly FinalizationFinding[];
  decisions: readonly CueDecision[];
  presentation: SubtitlePresentationResolution;
  humanReviewedBaseline: boolean;
}): C5FinalizationRates {
  const denominator = input.finalCues.length;
  const finalCueIds = new Set(input.finalCues.map((cue) => cue.id));
  const hasGlobalBlockingFinding = input.findings.some(
    (finding) => finding.severity === "blocking" && finding.cueIds.length === 0,
  );
  const blockingCueIds = hasGlobalBlockingFinding
    ? new Set(finalCueIds)
    : cueIdSet(
        input.findings.filter((finding) => finding.severity === "blocking"),
      );
  const manualReviewCueIds = new Set(
    input.decisions
      .filter((decision) => decision.requiresHumanReview)
      .flatMap((decision) => decision.targetCueIds),
  );
  const presentationEnforced =
    input.presentation.configuration.presentationResolution === "enforce";
  const presentationResolvedCueIds = new Set(
    input.presentation.layoutDecisions
      .filter(
        (decision) =>
          presentationEnforced &&
          decision.changed &&
          decision.resolved &&
          !decision.blocking,
      )
      .map((decision) => decision.cueId),
  );
  const repetitionResolvedCueIds = cueIdSet(
    input.presentation.repetitionDecisions.filter(
      (decision) => presentationEnforced && !decision.blocking,
    ),
  );
  const legalOverlapCueIds = cueIdSet(
    input.presentation.overlapDecisions.filter(
      (decision) =>
        presentationEnforced &&
        !decision.blocking &&
        decision.safeAutomaticAction === "presentation-only",
    ),
  );
  const timingResolvedCueIds = cueIdSet(
    input.presentation.overlapDecisions.filter(
      (decision) =>
        presentationEnforced &&
        !decision.blocking &&
        decision.safeAutomaticAction === "timing-only",
    ),
  );
  const autoResolvedCueIds = new Set([
    ...presentationResolvedCueIds,
    ...repetitionResolvedCueIds,
    ...legalOverlapCueIds,
    ...timingResolvedCueIds,
  ]);
  const baselineById = new Map(input.baselineCues.map((cue) => [cue.id, cue]));
  const mutationCueIds = new Set(
    input.finalCues
      .filter((cue) => {
        const baseline = baselineById.get(cue.id);
        return (
          baseline?.text !== cue.text ||
          baseline.start !== cue.start ||
          baseline.end !== cue.end
        );
      })
      .map((cue) => cue.id),
  );
  const structuralDecisionCueIds = new Set([
    ...input.presentation.layoutDecisions
      .filter((decision) => decision.changed || decision.blocking)
      .map((decision) => decision.cueId),
    ...input.presentation.repetitionDecisions.flatMap(
      (decision) => decision.cueIds,
    ),
    ...input.presentation.overlapDecisions.flatMap(
      (decision) => decision.cueIds,
    ),
  ]);
  const passiveBaselineCueIds = new Set(
    input.finalCues
      .filter((cue) => {
        const baseline = baselineById.get(cue.id);
        return (
          baseline?.text === cue.text &&
          baseline.start === cue.start &&
          baseline.end === cue.end &&
          !structuralDecisionCueIds.has(cue.id)
        );
      })
      .map((cue) => cue.id),
  );
  const humanBaselineCueIds = input.humanReviewedBaseline
    ? new Set(
        input.finalCues
          .filter((cue) => baselineById.has(cue.id))
          .map((cue) => cue.id),
      )
    : new Set<string>();
  const autoResolvedCueRate = rate(autoResolvedCueIds.size, denominator);
  return {
    automaticCueRate: autoResolvedCueRate,
    nonBlockingCueRate: rate(
      Math.max(0, denominator - blockingCueIds.size),
      denominator,
    ),
    passiveBaselineAcceptanceRate: rate(
      passiveBaselineCueIds.size,
      denominator,
    ),
    autoResolvedCueRate,
    autoMutationCueRate: rate(mutationCueIds.size, denominator),
    presentationAutoResolvedCueRate: rate(
      presentationResolvedCueIds.size,
      denominator,
    ),
    intentionalRepetitionResolvedCueRate: rate(
      repetitionResolvedCueIds.size,
      denominator,
    ),
    legalOverlapCueRate: rate(legalOverlapCueIds.size, denominator),
    humanBaselineCueRate: rate(humanBaselineCueIds.size, denominator),
    manualReviewCueRate: rate(manualReviewCueIds.size, denominator),
    blockingCueRate: rate(blockingCueIds.size, denominator),
  };
}

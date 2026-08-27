import {
  c6012PolicyVersion,
  machineTimingNonDegradationSchema,
  type GlobalTokenTimelineMode,
  type MachineCueTimelineEvidence,
  type MachineTimingNonDegradation,
  type SubtitleCue,
} from "@mvl/shared";

import {
  machineQualitySemanticHash,
  overlapSeconds,
} from "./evidence-correlation.js";

function adjacentOverlap(cues: readonly SubtitleCue[], index: number): number {
  const cue = cues[index];
  if (cue === undefined) return 0;
  const previous = cues[index - 1];
  const next = cues[index + 1];
  return (
    (previous === undefined ? 0 : overlapSeconds(previous, cue)) +
    (next === undefined ? 0 : overlapSeconds(cue, next))
  );
}

export function enforceTimingNonDegradation(input: {
  cues: readonly SubtitleCue[];
  evidence: MachineCueTimelineEvidence;
  mode: GlobalTokenTimelineMode;
  generatedAt?: string;
}): { artifact: MachineTimingNonDegradation; cues: SubtitleCue[] } {
  const sorted = input.cues.toSorted(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  const evidenceByCue = new Map(
    input.evidence.cues.map((cue) => [cue.cueId, cue] as const),
  );
  const output = [...sorted];
  const decisions = sorted.map((cue, index) => {
    const evidence = evidenceByCue.get(cue.id);
    const proposed =
      evidence?.timingEligible === true &&
      evidence.trustedTokenInterval !== null
        ? evidence.trustedTokenInterval
        : { start: cue.start, end: cue.end };
    const beforeOverlap = adjacentOverlap(sorted, index);
    const candidate = { ...cue, start: proposed.start, end: proposed.end };
    const candidateList = sorted.map((member, candidateIndex) =>
      candidateIndex === index ? candidate : member,
    );
    const afterOverlap = adjacentOverlap(candidateList, index);
    const durationRatio =
      (candidate.end - candidate.start) / Math.max(0.001, cue.end - cue.start);
    const accepted =
      input.mode === "enforce" &&
      evidence?.timingEligible === true &&
      evidence.lexicalCoverageRatio >= 0.8 &&
      durationRatio >= 0.5 &&
      durationRatio <= 1.8 &&
      afterOverlap <= beforeOverlap;
    if (accepted) output[index] = candidate;
    const proposedChanged =
      proposed.start !== cue.start || proposed.end !== cue.end;
    return {
      cueId: cue.id,
      before: { start: cue.start, end: cue.end },
      proposed,
      result: accepted
        ? ("accepted" as const)
        : proposedChanged
          ? ("rejected" as const)
          : ("unchanged" as const),
      trustedTokenIds: evidence?.trustedTokenIds ?? [],
      overlapSecondsBefore: beforeOverlap,
      overlapSecondsAfter: accepted ? afterOverlap : beforeOverlap,
      reasons: accepted
        ? ["trusted-token-coverage-passed", "timing-non-degradation-passed"]
        : proposedChanged
          ? ["timing-non-degradation-or-coverage-gate-rejected"]
          : ["no-eligible-trusted-token-boundary"],
    };
  });
  const netBoundaryShiftSeconds = decisions.reduce(
    (sum, decision) =>
      sum +
      Math.abs(decision.before.start - decision.proposed.start) +
      Math.abs(decision.before.end - decision.proposed.end),
    0,
  );
  return {
    artifact: machineTimingNonDegradationSchema.parse({
      schemaVersion: "1.0.0",
      policyVersion: c6012PolicyVersion,
      generatedAt: input.generatedAt ?? new Date().toISOString(),
      artifactType: "machine-timing-non-degradation",
      mode: input.mode,
      decisions,
      summary: {
        evaluatedCueCount: decisions.length,
        acceptedMutationCount: decisions.filter(
          (decision) => decision.result === "accepted",
        ).length,
        rejectedMutationCount: decisions.filter(
          (decision) => decision.result === "rejected",
        ).length,
        unchangedCueCount: decisions.filter(
          (decision) => decision.result === "unchanged",
        ).length,
        timingRegressionCount: 0,
        proposedMutationCount: decisions.filter(
          (decision) =>
            decision.proposed.start !== decision.before.start ||
            decision.proposed.end !== decision.before.end,
        ).length,
        expansionRejectedCount: decisions.filter(
          (decision) =>
            decision.result === "rejected" &&
            (decision.proposed.start < decision.before.start ||
              decision.proposed.end > decision.before.end),
        ).length,
        weakEvidenceRejectedCount: decisions.filter(
          (decision) =>
            decision.result === "rejected" &&
            decision.reasons.includes(
              "timing-non-degradation-or-coverage-gate-rejected",
            ),
        ).length,
        trustedTokenAppliedCount: decisions.filter(
          (decision) =>
            decision.result === "accepted" &&
            decision.trustedTokenIds.length > 0,
        ).length,
        mfaAppliedCount: 0,
        ctcAppliedCount: 0,
        netBoundaryShiftSeconds,
      },
      beforeTimingHash: machineQualitySemanticHash(
        sorted.map((cue) => [cue.id, cue.start, cue.end]),
      ),
      afterTimingHash: machineQualitySemanticHash(
        output.map((cue) => [cue.id, cue.start, cue.end]),
      ),
    }),
    cues: output,
  };
}

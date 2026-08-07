import {
  adaptiveRefinementRecordSchema,
  type AdaptiveRefinementRecord,
  type HypothesisQuality,
} from "@mvl/shared";

import {
  arbitrateHypotheses,
  evaluateHypothesisQuality,
  evaluateLocalConsensus,
  type HypothesisArbitrationResult,
  type LocalConsensusResult,
} from "./quality.js";

interface Interval {
  start: number;
  end: number;
}

function overlaps(left: Interval, right: Interval): boolean {
  return left.start < right.end && right.start < left.end;
}

export interface ReplayArbitrationDecision {
  interval: Interval;
  vadQuality: HypothesisQuality;
  noVadQuality: HypothesisQuality;
  refinementQuality: HypothesisQuality;
  consensus: LocalConsensusResult;
  decision: HypothesisArbitrationResult;
}

export interface ReplayArbitrationResult {
  schemaVersion: "1.0.0";
  sourceSchemaVersion: string;
  decisions: ReplayArbitrationDecision[];
  summary: {
    oldNeedsHumanReview: number;
    newNeedsHumanReview: number;
    autoResolvedVad: number;
    autoResolvedNoVad: number;
    autoResolvedLargeV3: number;
    rejectedVadHallucinations: number;
    rejectedNoVadHallucinations: number;
    trueUnresolvedConflicts: number;
  };
  needsHumanReviewIntervals: {
    start: number;
    end: number;
    reasons: string[];
  }[];
}

function finalReplacementRecords(
  record: AdaptiveRefinementRecord,
): AdaptiveRefinementRecord["replacements"] {
  const byInterval = new Map<
    string,
    AdaptiveRefinementRecord["replacements"][number]
  >();
  for (const replacement of record.replacements) {
    const key = `${replacement.interval.start}:${replacement.interval.end}`;
    const current = byInterval.get(key);
    if (
      current === undefined ||
      replacement.refinement.round > current.refinement.round
    ) {
      byInterval.set(key, replacement);
    }
  }
  return [...byInterval.values()].toSorted(
    (left, right) =>
      left.interval.start - right.interval.start ||
      left.interval.end - right.interval.end,
  );
}

export function replayAdaptiveRefinementArbitration(
  input: unknown,
): ReplayArbitrationResult {
  const record = adaptiveRefinementRecordSchema.parse(input);
  const decisions = finalReplacementRecords(record).flatMap((replacement) => {
    const hypotheses = replacement.baselineHypotheses;
    if (hypotheses === undefined) return [];
    // Historical records do not retain per-cue local timing. Replay therefore
    // uses conservative text-window alignment while new runs use timed segments.
    const vadQuality = evaluateHypothesisQuality({
      text: hypotheses.vad.text,
      detectedSpeech: hypotheses.vad.detectedSpeech,
      language: hypotheses.vad.language,
    });
    const noVadQuality = evaluateHypothesisQuality({
      text: hypotheses.noVad.text,
      detectedSpeech: hypotheses.noVad.detectedSpeech,
      language: hypotheses.noVad.language,
    });
    const refinementQuality = evaluateHypothesisQuality({
      text: replacement.refinement.text,
      detectedSpeech: replacement.refinement.text.trim() !== "",
    });
    const speechEvidence =
      replacement.conflict?.speechEvidence ?? ("unknown" as const);
    const highBackgroundNoise =
      replacement.conflict?.highBackgroundNoise ?? false;
    const consensus = evaluateLocalConsensus({
      interval: replacement.interval,
      vadText: hypotheses.vad.text,
      noVadText: hypotheses.noVad.text,
      refinementText: replacement.refinement.text,
      vadQuality,
      noVadQuality,
      refinementQuality,
      speechEvidence,
      highBackgroundNoise,
      noVadTieBreakBonus: 0.04,
    });
    const decision = arbitrateHypotheses({
      vadQuality,
      noVadQuality,
      refinementQuality,
      consensus,
      highBackgroundNoise,
      speechEvidence,
      lastRound: true,
    });
    return [
      {
        interval: replacement.interval,
        vadQuality,
        noVadQuality,
        refinementQuality,
        consensus,
        decision,
      },
    ];
  });

  const reviewResults = record.needsHumanReviewIntervals.map((interval) => {
    const candidates = decisions.filter((decision) =>
      overlaps(decision.interval, interval),
    );
    const resolved =
      candidates.length > 0 &&
      candidates.every((candidate) => candidate.decision.stableConsensus);
    const selected = resolved
      ? (candidates[0]?.decision.selected ?? "none")
      : "none";
    return { interval, resolved, selected };
  });
  const countSelected = (selected: "vad" | "no-vad" | "refinement"): number =>
    reviewResults.filter(
      (result) => result.resolved && result.selected === selected,
    ).length;
  const unresolved = reviewResults
    .filter((result) => !result.resolved)
    .map((result) => result.interval);
  return {
    schemaVersion: "1.0.0",
    sourceSchemaVersion: record.schemaVersion,
    decisions,
    summary: {
      oldNeedsHumanReview: record.needsHumanReviewIntervals.length,
      newNeedsHumanReview: unresolved.length,
      autoResolvedVad: countSelected("vad"),
      autoResolvedNoVad: countSelected("no-vad"),
      autoResolvedLargeV3: countSelected("refinement"),
      rejectedVadHallucinations: decisions.filter(
        (decision) => decision.vadQuality.validity === "invalid-hallucination",
      ).length,
      rejectedNoVadHallucinations: decisions.filter(
        (decision) =>
          decision.noVadQuality.validity === "invalid-hallucination",
      ).length,
      trueUnresolvedConflicts: unresolved.length,
    },
    needsHumanReviewIntervals: unresolved,
  };
}

import type { CtcAlignmentAttempt } from "@mvl/shared";

import { sha256Value } from "./finalization-support.js";

function factorial(value: number): number {
  let output = 1;
  for (let current = 2; current <= value; current += 1) output *= current;
  return output;
}

function overlapRatio(
  left: { start: number; end: number },
  right: { start: number; end: number },
): number {
  const intersection = Math.max(
    0,
    Math.min(left.end, right.end) - Math.max(left.start, right.start),
  );
  return (
    intersection /
    Math.max(0.001, Math.min(left.end - left.start, right.end - right.start))
  );
}

export interface CtcJointAssignmentCue {
  cueId: string;
  originalInterval: { start: number; end: number };
  targetText: string;
  selectedAttempt: CtcAlignmentAttempt | null;
}

export interface CtcJointAssignmentResult {
  componentId: string;
  cueIds: string[];
  candidatePermutationCount: number;
  selectedAssignmentId: string | null;
  selectedCueOrder: string[];
  monotonic: boolean;
  duplicateOccurrenceConflictCount: number;
  illegalOverlapCount: number;
  legalExistingOverlapPreserved: boolean;
  lineageDedupeCount: number;
  resolved: boolean;
  blockers: string[];
  semanticHash: string;
}

export function assignCtcComponentJointly(input: {
  componentId: string;
  cues: readonly CtcJointAssignmentCue[];
}): CtcJointAssignmentResult {
  const ordered = [...input.cues].toSorted(
    (left, right) =>
      left.originalInterval.start - right.originalInterval.start ||
      left.cueId.localeCompare(right.cueId),
  );
  const selectedCueOrder = ordered.map((cue) => cue.cueId);
  const missing = ordered.filter(
    (cue) =>
      cue.selectedAttempt?.selectedBoundary === null ||
      cue.selectedAttempt === null,
  );
  let monotonic = missing.length === 0;
  let duplicateOccurrenceConflictCount = 0;
  let illegalOverlapCount = 0;
  let legalExistingOverlapPreserved = true;
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (previous === undefined || current === undefined) continue;
    const previousBoundary = previous.selectedAttempt?.selectedBoundary;
    const currentBoundary = current.selectedAttempt?.selectedBoundary;
    if (
      previousBoundary === null ||
      previousBoundary === undefined ||
      currentBoundary === null ||
      currentBoundary === undefined
    ) {
      monotonic = false;
      continue;
    }
    if (currentBoundary.start + 1e-6 < previousBoundary.start)
      monotonic = false;
    const candidateOverlap = overlapRatio(previousBoundary, currentBoundary);
    const sourceOverlap = overlapRatio(
      previous.originalInterval,
      current.originalInterval,
    );
    if (
      candidateOverlap >= 0.8 &&
      (previous.targetText === current.targetText ||
        previous.targetText.includes(current.targetText) ||
        current.targetText.includes(previous.targetText))
    ) {
      duplicateOccurrenceConflictCount += 1;
    }
    if (candidateOverlap > sourceOverlap + 0.05) illegalOverlapCount += 1;
    if (sourceOverlap > 0 && candidateOverlap <= 0)
      legalExistingOverlapPreserved = false;
  }
  const lineage = ordered.flatMap(
    (cue) =>
      cue.selectedAttempt?.tokenSpans.map(
        (span) =>
          `${cue.selectedAttempt?.attemptId}:${String(span.targetIndex)}`,
      ) ?? [],
  );
  const lineageDedupeCount = lineage.length - new Set(lineage).size;
  const blockers = [
    ...(missing.length > 0 ? ["CTC_JOINT_ASSIGNMENT_CANDIDATE_MISSING"] : []),
    ...(!monotonic ? ["CTC_JOINT_ASSIGNMENT_NON_MONOTONIC"] : []),
    ...(duplicateOccurrenceConflictCount > 0
      ? ["CTC_DUPLICATE_OCCURRENCE_CONFLICT"]
      : []),
    ...(illegalOverlapCount > 0 ? ["CTC_NEW_ILLEGAL_OVERLAP"] : []),
    ...(!legalExistingOverlapPreserved ? ["CTC_LEGAL_OVERLAP_DELETED"] : []),
  ].toSorted();
  const base = {
    componentId: input.componentId,
    cueIds: ordered.map((cue) => cue.cueId),
    candidatePermutationCount: factorial(ordered.length),
    selectedAssignmentId:
      blockers.length === 0
        ? `ctc-joint-${sha256Value({
            componentId: input.componentId,
            selectedCueOrder,
            boundaries: ordered.map(
              (cue) => cue.selectedAttempt?.selectedBoundary,
            ),
          }).slice(0, 20)}`
        : null,
    selectedCueOrder,
    monotonic,
    duplicateOccurrenceConflictCount,
    illegalOverlapCount,
    legalExistingOverlapPreserved,
    lineageDedupeCount,
    resolved: blockers.length === 0,
    blockers,
  };
  return { ...base, semanticHash: sha256Value(base) };
}

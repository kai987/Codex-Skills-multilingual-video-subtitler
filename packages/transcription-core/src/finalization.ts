import { createHash } from "node:crypto";

import {
  finalizationCandidateSchema,
  type CandidateCoverageMetrics,
  type CueDecision,
  type FinalizationCandidate,
  type FinalizationThresholds,
  type SubtitleCue,
} from "@mvl/shared";

export const DEFAULT_FINALIZATION_THRESHOLDS: Readonly<FinalizationThresholds> =
  {
    minimumAssociationScore: 0.82,
    minimumAssociationMargin: 0.12,
    minimumIndependentSupport: 2,
    minimumExistingCuePreservation: 0.85,
    minimumCandidateCoverage: 0.9,
    maximumContentOmission: 0.15,
    maximumContentAddition: 0.15,
    maximumNeighborCueIntrusion: 0.05,
    minimumLocalSpeechCoverage: 0.8,
  };

const NON_CONTENT = /[\p{P}\p{S}\p{Z}\s]/gu;

export function normalizeFinalizationText(text: string): string {
  return text.normalize("NFKC").toLocaleLowerCase().replace(NON_CONTENT, "");
}

function longestCommonSubsequenceLength(left: string, right: string): number {
  const a = Array.from(left);
  const b = Array.from(right);
  const previous = new Array<number>(b.length + 1).fill(0);
  const current = new Array<number>(b.length + 1).fill(0);
  for (const leftCharacter of a) {
    for (let index = 1; index <= b.length; index += 1) {
      current[index] =
        leftCharacter === b[index - 1]
          ? (previous[index - 1] ?? 0) + 1
          : Math.max(current[index - 1] ?? 0, previous[index] ?? 0);
    }
    for (let index = 0; index <= b.length; index += 1) {
      previous[index] = current[index] ?? 0;
      current[index] = 0;
    }
  }
  return previous[b.length] ?? 0;
}

function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) return numerator === 0 ? 1 : 0;
  return Math.min(1, Math.max(0, numerator / denominator));
}

export function calculateCandidateCoverage(input: {
  currentText: string;
  candidateText: string;
  neighborCueIntrusionRatio?: number;
  localSpeechCoverageRatio?: number;
}): CandidateCoverageMetrics {
  const current = normalizeFinalizationText(input.currentText);
  const candidate = normalizeFinalizationText(input.candidateText);
  const common = longestCommonSubsequenceLength(current, candidate);
  const existingCuePreservationRatio = ratio(
    common,
    Array.from(current).length,
  );
  const candidateCoverageRatio = ratio(common, Array.from(candidate).length);
  return {
    existingCuePreservationRatio,
    candidateCoverageRatio,
    contentOmissionRatio: 1 - existingCuePreservationRatio,
    contentAdditionRatio: 1 - candidateCoverageRatio,
    neighborCueIntrusionRatio: input.neighborCueIntrusionRatio ?? 0,
    localSpeechCoverageRatio: input.localSpeechCoverageRatio ?? 0,
    coverageMethod: "heuristic",
    semanticSimilarity: null,
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function recalibratedIndependentSupport(
  candidate: FinalizationCandidate,
): number {
  const requests = unique(candidate.sourceRequestIds);
  if (requests.length > 0) return requests.length;
  const profiles = unique(candidate.sourceProfileIds);
  if (profiles.length > 0) return profiles.length;
  return 0;
}

function addBlocker(blockers: Set<string>, condition: boolean, code: string) {
  if (condition) blockers.add(code);
}

export function evaluateCandidateMutationSafety(input: {
  candidate: FinalizationCandidate;
  currentText: string;
  thresholds?: FinalizationThresholds;
}): FinalizationCandidate {
  const thresholds = input.thresholds ?? DEFAULT_FINALIZATION_THRESHOLDS;
  const candidate = input.candidate;
  const independentSupportCount = recalibratedIndependentSupport(candidate);
  const coverageMetrics = calculateCandidateCoverage({
    currentText: input.currentText,
    candidateText: candidate.candidateText,
    neighborCueIntrusionRatio:
      candidate.coverageMetrics.neighborCueIntrusionRatio,
    localSpeechCoverageRatio:
      candidate.coverageMetrics.localSpeechCoverageRatio,
  });
  const current = normalizeFinalizationText(input.currentText);
  const proposed = normalizeFinalizationText(candidate.candidateText);
  const strictSubstring =
    proposed.length > 0 &&
    current.length > proposed.length &&
    current.includes(proposed);
  const blockers = new Set(candidate.blockers);

  addBlocker(
    blockers,
    candidate.associationType === "BROAD_WINDOW_ASSOCIATION",
    "BROAD_WINDOW_ASSOCIATION",
  );
  addBlocker(
    blockers,
    candidate.associationType === "AMBIGUOUS_ASSOCIATION",
    "AMBIGUOUS_ASSOCIATION",
  );
  addBlocker(
    blockers,
    candidate.associationType === "UNASSOCIATED",
    "UNASSOCIATED",
  );
  addBlocker(
    blockers,
    candidate.localInterval === null,
    "LOCAL_INTERVAL_MISSING",
  );
  addBlocker(
    blockers,
    !candidate.directAcousticSupport,
    "NO_DIRECT_ACOUSTIC_SUPPORT",
  );
  addBlocker(
    blockers,
    candidate.associationScore === null ||
      candidate.associationScore < thresholds.minimumAssociationScore,
    "ASSOCIATION_SCORE_BELOW_THRESHOLD",
  );
  addBlocker(
    blockers,
    candidate.associationMargin === null ||
      candidate.associationMargin < thresholds.minimumAssociationMargin,
    "ASSOCIATION_MARGIN_BELOW_THRESHOLD",
  );
  addBlocker(blockers, candidate.partialFragment, "PARTIAL_FRAGMENT");
  addBlocker(
    blockers,
    independentSupportCount < thresholds.minimumIndependentSupport,
    "INSUFFICIENT_INDEPENDENT_SUPPORT",
  );
  addBlocker(blockers, !candidate.timingResolved, "TIMING_UNRESOLVED");
  addBlocker(
    blockers,
    !candidate.languageIntegrityPassed,
    "LANGUAGE_INTEGRITY_FAILED",
  );
  addBlocker(
    blockers,
    !candidate.hallucinationQaPassed,
    "HALLUCINATION_QA_FAILED",
  );
  addBlocker(blockers, !candidate.repetitionQaPassed, "REPETITION_QA_FAILED");
  addBlocker(
    blockers,
    !candidate.presentationQaPassed,
    "POST_PRESENTATION_QA_FAILED",
  );
  addBlocker(
    blockers,
    coverageMetrics.existingCuePreservationRatio <
      thresholds.minimumExistingCuePreservation,
    "INCOMPLETE_SEMANTIC_COVERAGE",
  );
  addBlocker(
    blockers,
    coverageMetrics.candidateCoverageRatio <
      thresholds.minimumCandidateCoverage,
    "CANDIDATE_COVERAGE_INSUFFICIENT",
  );
  addBlocker(
    blockers,
    coverageMetrics.contentOmissionRatio > thresholds.maximumContentOmission,
    "CONTENT_OMISSION_RISK",
  );
  addBlocker(
    blockers,
    coverageMetrics.contentAdditionRatio > thresholds.maximumContentAddition,
    "CONTENT_ADDITION_RISK",
  );
  addBlocker(
    blockers,
    coverageMetrics.neighborCueIntrusionRatio >
      thresholds.maximumNeighborCueIntrusion,
    "NEIGHBOR_CUE_INTRUSION",
  );
  addBlocker(
    blockers,
    coverageMetrics.localSpeechCoverageRatio <
      thresholds.minimumLocalSpeechCoverage,
    "LOCAL_SPEECH_COVERAGE_INSUFFICIENT",
  );
  if (strictSubstring) {
    blockers.add("STRICT_SUBSTRING_REPLACEMENT_BLOCKED");
    blockers.add("CONTENT_OMISSION_RISK");
    blockers.add("INCOMPLETE_SEMANTIC_COVERAGE");
  }

  const associationEligible = ["EXACT_TARGET", "PROBABLE_TARGET"].includes(
    candidate.associationType,
  );
  const timingOnly =
    candidate.requestedAction === "TIMING_ONLY" && current === proposed;
  const automaticMutationEligible =
    associationEligible &&
    blockers.size === 0 &&
    candidate.targetCueIds.length === 1 &&
    (timingOnly ||
      [
        "REPLACE",
        "EXPAND",
        "SPLIT",
        "MERGE",
        "REDISTRIBUTE",
        "DELETE_HALLUCINATION",
      ].includes(candidate.requestedAction));

  return finalizationCandidateSchema.parse({
    ...candidate,
    independentSupportCount,
    coverageMetrics,
    blockers: [...blockers].sort((left, right) => left.localeCompare(right)),
    automaticMutationEligible,
    requiresHumanReview:
      candidate.requiresHumanReview || !automaticMutationEligible,
  });
}

function candidateIdentity(candidate: FinalizationCandidate): string {
  const interval = candidate.localInterval ?? candidate.candidateInterval;
  return [
    normalizeFinalizationText(candidate.candidateText),
    interval.start.toFixed(3),
    interval.end.toFixed(3),
    unique(candidate.targetCueIds).join(","),
    candidate.associationType,
    candidate.requestedAction,
  ].join("|");
}

function candidateComparator(
  left: FinalizationCandidate,
  right: FinalizationCandidate,
): number {
  const associationRank = {
    EXACT_TARGET: 5,
    PROBABLE_TARGET: 4,
    BROAD_WINDOW_ASSOCIATION: 3,
    AMBIGUOUS_ASSOCIATION: 2,
    UNASSOCIATED: 1,
  } as const;
  return (
    Number(right.automaticMutationEligible) -
      Number(left.automaticMutationEligible) ||
    associationRank[right.associationType] -
      associationRank[left.associationType] ||
    (right.associationScore ?? -1) - (left.associationScore ?? -1) ||
    (right.associationMargin ?? -1) - (left.associationMargin ?? -1) ||
    right.independentSupportCount - left.independentSupportCount ||
    right.coverageMetrics.existingCuePreservationRatio -
      left.coverageMetrics.existingCuePreservationRatio ||
    left.candidateId.localeCompare(right.candidateId)
  );
}

function decisionId(targetCueIds: readonly string[]): string {
  return `decision-${createHash("sha256")
    .update(unique(targetCueIds).join("\u0000"))
    .digest("hex")
    .slice(0, 20)}`;
}

function overlappingCandidateGroups(
  candidates: readonly FinalizationCandidate[],
): FinalizationCandidate[][] {
  const remaining = [...candidates];
  const groups: FinalizationCandidate[][] = [];
  while (remaining.length > 0) {
    const seed = remaining.shift();
    if (seed === undefined) break;
    const group = [seed];
    const cueIds = new Set(seed.targetCueIds);
    let changed = true;
    while (changed) {
      changed = false;
      for (let index = remaining.length - 1; index >= 0; index -= 1) {
        const candidate = remaining[index];
        if (candidate?.targetCueIds.some((cueId) => cueIds.has(cueId))) {
          group.push(candidate);
          for (const cueId of candidate.targetCueIds) cueIds.add(cueId);
          remaining.splice(index, 1);
          changed = true;
        }
      }
    }
    groups.push(group);
  }
  return groups.sort((left, right) =>
    unique(left.flatMap((candidate) => candidate.targetCueIds))
      .join("\u0000")
      .localeCompare(
        unique(right.flatMap((candidate) => candidate.targetCueIds)).join(
          "\u0000",
        ),
      ),
  );
}

export function aggregateCueDecisions(input: {
  cues: readonly SubtitleCue[];
  candidates: readonly FinalizationCandidate[];
  thresholds?: FinalizationThresholds;
}): { candidates: FinalizationCandidate[]; decisions: CueDecision[] } {
  const cueById = new Map(input.cues.map((cue) => [cue.id, cue]));
  const equivalentGroups = new Map<string, FinalizationCandidate[]>();
  for (const candidate of input.candidates) {
    const key = candidateIdentity(candidate);
    equivalentGroups.set(key, [
      ...(equivalentGroups.get(key) ?? []),
      candidate,
    ]);
  }
  const duplicateAliases = new Map<string, string[]>();
  const merged = [...equivalentGroups.values()].map((group) => {
    const sorted = [...group].sort(candidateComparator);
    const selected = sorted[0];
    if (selected === undefined)
      throw new Error("Empty equivalent candidate group.");
    duplicateAliases.set(
      selected.candidateId,
      sorted.slice(1).map((candidate) => candidate.candidateId),
    );
    return {
      ...selected,
      sourceEvidenceIds: unique(
        group.flatMap((candidate) => candidate.sourceEvidenceIds),
      ),
      sourceRequestIds: unique(
        group.flatMap((candidate) => candidate.sourceRequestIds),
      ),
      sourceProfileIds: unique(
        group.flatMap((candidate) => candidate.sourceProfileIds),
      ),
      blockers: unique(group.flatMap((candidate) => candidate.blockers)),
      requiresHumanReview: group.some(
        (candidate) => candidate.requiresHumanReview,
      ),
    };
  });
  const calibrated = merged.map((candidate) => {
    const currentText = candidate.targetCueIds
      .map((cueId) => cueById.get(cueId)?.text ?? "")
      .filter(Boolean)
      .join("\n");
    return evaluateCandidateMutationSafety({
      candidate,
      currentText,
      ...(input.thresholds === undefined
        ? {}
        : { thresholds: input.thresholds }),
    });
  });
  const candidates = [...calibrated].sort(candidateComparator);
  const decisions = overlappingCandidateGroups(candidates).map((group) => {
    const sorted = [...group].sort(candidateComparator);
    const selected = sorted[0];
    if (selected === undefined) throw new Error("Empty candidate group.");
    const targetCueIds = unique(
      group.flatMap((candidate) => candidate.targetCueIds),
    );
    const currentText = targetCueIds
      .map((cueId) => cueById.get(cueId)?.text ?? "")
      .filter(Boolean)
      .join("\n");
    const groupConflict = selected.targetCueIds.length !== targetCueIds.length;
    const automaticMutationEligible =
      selected.automaticMutationEligible && !groupConflict;
    const blockers = new Set(selected.blockers);
    if (groupConflict) blockers.add("MULTI_DECISION_CONFLICT");
    return {
      decisionId: decisionId(targetCueIds),
      targetCueIds,
      action: automaticMutationEligible
        ? selected.requestedAction
        : "REVIEW_ONLY",
      currentText,
      proposedText: selected.candidateText,
      proposedCues: [],
      selectedCandidateId: selected.candidateId,
      alternativeCandidateIds: sorted
        .slice(1)
        .flatMap((candidate) => [
          candidate.candidateId,
          ...(duplicateAliases.get(candidate.candidateId) ?? []),
        ])
        .concat(duplicateAliases.get(selected.candidateId) ?? []),
      evidenceIds: unique(
        group.flatMap((candidate) => candidate.sourceEvidenceIds),
      ),
      blockers: [...blockers].sort((left, right) => left.localeCompare(right)),
      automaticMutationEligible,
      requiresHumanReview:
        selected.requiresHumanReview || !automaticMutationEligible,
      decisionReasons: automaticMutationEligible
        ? ["SAFE_AUTOMATIC_MUTATION_GATE_PASSED"]
        : ["SUGGESTION_ONLY", ...blockers],
    } satisfies CueDecision;
  });
  return { candidates, decisions };
}

export function applyAutomaticCueDecisions(input: {
  cues: readonly SubtitleCue[];
  candidates: readonly FinalizationCandidate[];
  decisions: readonly CueDecision[];
}): { cues: SubtitleCue[]; mutationCount: number; timingRepairCount: number } {
  const candidateById = new Map(
    input.candidates.map((candidate) => [candidate.candidateId, candidate]),
  );
  const decisionByCueId = new Map<string, CueDecision>();
  for (const decision of input.decisions) {
    for (const cueId of decision.targetCueIds) {
      if (decisionByCueId.has(cueId)) {
        throw new Error(`Multiple final decisions target cue ${cueId}.`);
      }
      decisionByCueId.set(cueId, decision);
    }
  }
  let mutationCount = 0;
  let timingRepairCount = 0;
  const cues = input.cues.map((cue) => {
    const decision = decisionByCueId.get(cue.id);
    if (decision?.automaticMutationEligible !== true) return cue;
    const candidate =
      decision.selectedCandidateId === null
        ? undefined
        : candidateById.get(decision.selectedCandidateId);
    if (candidate === undefined) return cue;
    if (decision.action === "TIMING_ONLY" && candidate.localInterval !== null) {
      timingRepairCount += 1;
      return {
        ...cue,
        start: candidate.localInterval.start,
        end: candidate.localInterval.end,
      };
    }
    if (
      ["REPLACE", "EXPAND", "REDISTRIBUTE"].includes(decision.action) &&
      decision.targetCueIds.length === 1
    ) {
      mutationCount += 1;
      return { ...cue, text: candidate.candidateText };
    }
    return cue;
  });
  return { cues, mutationCount, timingRepairCount };
}

export function repairSafeExactDuplicateCues(input: {
  cues: readonly SubtitleCue[];
  excludedCueIds?: ReadonlySet<string>;
}): { cues: SubtitleCue[]; decisions: CueDecision[] } {
  const removed = new Set<string>();
  const decisions: CueDecision[] = [];
  for (let index = 1; index < input.cues.length; index += 1) {
    const previous = input.cues[index - 1];
    const current = input.cues[index];
    if (previous === undefined || current === undefined) continue;
    if (
      input.excludedCueIds?.has(previous.id) === true ||
      input.excludedCueIds?.has(current.id) === true ||
      normalizeFinalizationText(previous.text) !==
        normalizeFinalizationText(current.text)
    ) {
      continue;
    }
    const overlap =
      Math.max(
        0,
        Math.min(previous.end, current.end) -
          Math.max(previous.start, current.start),
      ) / Math.min(previous.end - previous.start, current.end - current.start);
    const sameBounds =
      Math.abs(previous.start - current.start) <= 0.05 &&
      Math.abs(previous.end - current.end) <= 0.05;
    if (!sameBounds && overlap < 0.9) continue;
    removed.add(current.id);
    decisions.push({
      decisionId: decisionId([current.id]),
      targetCueIds: [current.id],
      action: "DELETE_HALLUCINATION",
      currentText: current.text,
      proposedText: null,
      proposedCues: [],
      selectedCandidateId: null,
      alternativeCandidateIds: [],
      evidenceIds: [previous.id, current.id],
      blockers: [],
      automaticMutationEligible: true,
      requiresHumanReview: false,
      decisionReasons: ["EXACT_DUPLICATE_WITH_EQUIVALENT_TIMING"],
    });
  }
  return {
    cues: input.cues.filter((cue) => !removed.has(cue.id)),
    decisions,
  };
}

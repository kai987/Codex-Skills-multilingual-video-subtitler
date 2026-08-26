import {
  subtitleLocalCtcBoundaryEvidenceSchema,
  type CtcAlignmentAttempt,
  type CtcBoundaryMode,
  type CtcDevice,
  type CtcDeviceUsed,
  type SubtitleLocalCtcBoundaryEvidence,
  type SourceFingerprint,
} from "@mvl/shared";

import { assessCtcWindowStability } from "./ctc-alignment.js";
import {
  assignCtcComponentJointly,
  type CtcJointAssignmentCue,
} from "./ctc-joint-assignment.js";
import { sha256Value } from "./finalization-support.js";

export interface IndependentBoundaryEvidence {
  mfaBoundary: { start: number; end: number } | null;
  mfaStartEvidenceIds: string[];
  mfaEndEvidenceIds: string[];
  mfaValid: boolean;
  mappedTokenBoundary: { start: number; end: number } | null;
  mappedTokenEvidenceIds: string[];
  evidenceDpBoundary: { start: number; end: number } | null;
  rawVadBoundary: { start: number; end: number } | null;
  speakerBoundary: { start: number; end: number } | null;
  speakerEvidenceIds: string[];
  speakerContradiction: boolean;
}

export interface CtcCueEvidenceInput {
  cueId: string;
  componentId: string;
  canonicalText: string;
  alignmentText: string;
  originalInterval: { start: number; end: number };
  narrow: CtcAlignmentAttempt;
  expanded: CtcAlignmentAttempt;
  independent: IndependentBoundaryEvidence;
  neighborIntrusion: boolean;
}

function chooseAttempt(
  narrow: CtcAlignmentAttempt,
  expanded: CtcAlignmentAttempt,
): CtcAlignmentAttempt | null {
  if (narrow.pathStatus !== "success" || expanded.pathStatus !== "success") {
    return null;
  }
  const narrowScore = narrow.meanTokenPosterior ?? -1;
  const expandedScore = expanded.meanTokenPosterior ?? -1;
  return expandedScore > narrowScore ? expanded : narrow;
}

function boundaryComparison(input: {
  side: "start" | "end";
  selected: CtcAlignmentAttempt | null;
  independent: IndependentBoundaryEvidence;
}) {
  const ctcTime = input.selected?.selectedBoundary?.[input.side] ?? null;
  const mfaTime = input.independent.mfaBoundary?.[input.side] ?? null;
  const mappedTokenTime =
    input.independent.mappedTokenBoundary?.[input.side] ?? null;
  const evidenceDpTime =
    input.independent.evidenceDpBoundary?.[input.side] ?? null;
  const rawVadTime = input.independent.rawVadBoundary?.[input.side] ?? null;
  const speakerTime = input.independent.speakerBoundary?.[input.side] ?? null;
  const mfaAgreement =
    input.independent.mfaValid &&
    ctcTime !== null &&
    mfaTime !== null &&
    Math.abs(ctcTime - mfaTime) <= 0.12 + 1e-9;
  const mappedAgreement =
    ctcTime !== null &&
    mappedTokenTime !== null &&
    Math.abs(ctcTime - mappedTokenTime) <= 0.12 + 1e-9;
  const independentLexicalEvidenceIds = [
    ...(mfaAgreement
      ? input.side === "start"
        ? input.independent.mfaStartEvidenceIds
        : input.independent.mfaEndEvidenceIds
      : []),
    ...(mappedAgreement ? input.independent.mappedTokenEvidenceIds : []),
  ].filter((value, index, values) => values.indexOf(value) === index);
  return {
    boundary: input.side,
    ctcTime,
    mfaTime,
    mappedTokenTime,
    evidenceDpTime,
    rawVadTime,
    speakerTime,
    independentLexicalEvidenceIds,
    ctcEvidenceIds:
      input.selected === null
        ? []
        : [
            input.selected.attemptId,
            ...input.selected.tokenSpans.map(
              (span) =>
                `${input.selected?.attemptId}:token:${String(span.targetIndex)}`,
            ),
          ],
    speakerEvidenceIds: input.independent.speakerEvidenceIds,
    independentLexicalAgreement: mfaAgreement || mappedAgreement,
    speakerContradiction: input.independent.speakerContradiction,
  };
}

function buildCueDecision(input: CtcCueEvidenceInput) {
  const selected = chooseAttempt(input.narrow, input.expanded);
  const stability = assessCtcWindowStability({
    narrow: input.narrow.selectedBoundary,
    expanded: input.expanded.selectedBoundary,
    narrowEdgePinned:
      input.narrow.startPinnedToWindowEdge ||
      input.narrow.endPinnedToWindowEdge,
    expandedEdgePinned:
      input.expanded.startPinnedToWindowEdge ||
      input.expanded.endPinnedToWindowEdge,
  });
  const startComparison = boundaryComparison({
    side: "start",
    selected,
    independent: input.independent,
  });
  const endComparison = boundaryComparison({
    side: "end",
    selected,
    independent: input.independent,
  });
  const proposedInterval = selected?.selectedBoundary ?? null;
  const deltaStart =
    proposedInterval === null
      ? Number.POSITIVE_INFINITY
      : Math.abs(proposedInterval.start - input.originalInterval.start);
  const deltaEnd =
    proposedInterval === null
      ? Number.POSITIVE_INFINITY
      : Math.abs(proposedInterval.end - input.originalInterval.end);
  const duration =
    proposedInterval === null
      ? 0
      : proposedInterval.end - proposedInterval.start;
  const blockers = [
    ...(!input.narrow.target.targetEncodable ||
    !input.expanded.target.targetEncodable
      ? ["CTC_TARGET_UNREPRESENTABLE"]
      : []),
    ...(selected === null ? ["CTC_DUAL_WINDOW_PATH_UNAVAILABLE"] : []),
    ...(!stability.startStable ? ["CTC_START_WINDOW_UNSTABLE"] : []),
    ...(!stability.endStable ? ["CTC_END_WINDOW_UNSTABLE"] : []),
    ...(stability.edgePinned ? ["CTC_ALIGNMENT_PINNED_TO_WINDOW_EDGE"] : []),
    ...(!startComparison.independentLexicalAgreement
      ? ["CTC_START_INDEPENDENT_LEXICAL_SUPPORT_MISSING"]
      : []),
    ...(!endComparison.independentLexicalAgreement
      ? ["CTC_END_INDEPENDENT_LEXICAL_SUPPORT_MISSING"]
      : []),
    ...(input.independent.speakerContradiction
      ? ["CTC_SPEAKER_EVIDENCE_CONTRADICTION"]
      : []),
    ...(input.neighborIntrusion ? ["CTC_NEIGHBOR_INTRUSION"] : []),
    ...(deltaStart > 0.5 + 1e-9 ? ["CTC_START_MUTATION_EXCEEDS_LIMIT"] : []),
    ...(deltaEnd > 0.5 + 1e-9 ? ["CTC_END_MUTATION_EXCEEDS_LIMIT"] : []),
    ...(duration < 0.4 - 1e-9 ? ["CTC_POST_REPAIR_CUE_TOO_SHORT"] : []),
  ].toSorted();
  const timingActionable = blockers.length === 0;
  const base = {
    cueId: input.cueId,
    componentId: input.componentId,
    canonicalText: input.canonicalText,
    alignmentText: input.alignmentText,
    originalInterval: input.originalInterval,
    narrowAttemptId: input.narrow.attemptId,
    expandedAttemptId: input.expanded.attemptId,
    narrowBoundary: input.narrow.selectedBoundary,
    expandedBoundary: input.expanded.selectedBoundary,
    selectedBoundary: proposedInterval,
    startWindowDeltaSeconds: stability.startDeltaSeconds,
    endWindowDeltaSeconds: stability.endDeltaSeconds,
    startStable: stability.startStable,
    endStable: stability.endStable,
    windowStable: stability.stable,
    edgePinned: stability.edgePinned,
    duplicateOccurrenceConflict: false,
    startComparison,
    endComparison,
    timingActionable,
    proposedInterval: timingActionable ? proposedInterval : null,
    mutationApplied: false,
    blockers,
    textChanged: false as const,
  };
  return {
    decision: { ...base, semanticHash: sha256Value(base) },
    selected,
  };
}

export function buildLocalCtcBoundaryEvidence(input: {
  generatedAt?: string;
  sourceFingerprint: SourceFingerprint;
  baseCueHash: string;
  baseTimingHash: string;
  alignmentInputRef: string;
  runtimeCapabilityRef: string;
  mode: CtcBoundaryMode;
  deviceRequested: CtcDevice;
  deviceUsed: CtcDeviceUsed;
  attempts: readonly CtcAlignmentAttempt[];
  cues: readonly CtcCueEvidenceInput[];
  speakerResolvedComponentIds: ReadonlySet<string>;
}): SubtitleLocalCtcBoundaryEvidence {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const cueAnalysis = input.cues.map(buildCueDecision);
  const cueById = new Map(
    cueAnalysis.map((entry) => [entry.decision.cueId, entry]),
  );
  const grouped = Map.groupBy(input.cues, (cue) => cue.componentId);
  const components = [...grouped.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([componentId, cues]) => {
      const jointCues: CtcJointAssignmentCue[] = cues.map((cue) => ({
        cueId: cue.cueId,
        originalInterval: cue.originalInterval,
        targetText: cue.alignmentText,
        selectedAttempt: cueById.get(cue.cueId)?.selected ?? null,
      }));
      const jointAssignment = assignCtcComponentJointly({
        componentId,
        cues: jointCues,
      });
      const jointBlocked = !jointAssignment.resolved;
      const cueDecisions = cues.map((cue) => {
        const value = cueById.get(cue.cueId)?.decision;
        if (value === undefined) throw new Error("CTC cue decision missing.");
        const duplicateOccurrenceConflict =
          jointAssignment.duplicateOccurrenceConflictCount > 0;
        const blockers = [
          ...value.blockers,
          ...(jointBlocked ? jointAssignment.blockers : []),
        ]
          .filter((item, index, values) => values.indexOf(item) === index)
          .toSorted();
        const base = {
          ...value,
          duplicateOccurrenceConflict,
          timingActionable: blockers.length === 0,
          proposedInterval:
            blockers.length === 0 ? value.selectedBoundary : null,
          blockers,
        };
        return {
          ...base,
          semanticHash: sha256Value({ ...base, semanticHash: null }),
        };
      });
      const allActionable =
        cueDecisions.length > 0 &&
        cueDecisions.every((cue) => cue.timingActionable);
      const apply = input.mode === "enforce" && allActionable;
      const atomicComponentDecisionId = `ctc-component-${sha256Value({
        componentId,
        jointAssignment: jointAssignment.semanticHash,
        cueDecisions: cueDecisions.map((cue) => cue.semanticHash),
      }).slice(0, 20)}`;
      const mutations = apply
        ? cueDecisions.flatMap((cue) => {
            if (cue.proposedInterval === null) return [];
            return [
              {
                componentId,
                cueId: cue.cueId,
                oldStart: cue.originalInterval.start,
                oldEnd: cue.originalInterval.end,
                newStart: cue.proposedInterval.start,
                newEnd: cue.proposedInterval.end,
                startEvidenceIds: [
                  ...cue.startComparison.ctcEvidenceIds,
                  ...cue.startComparison.independentLexicalEvidenceIds,
                ],
                endEvidenceIds: [
                  ...cue.endComparison.ctcEvidenceIds,
                  ...cue.endComparison.independentLexicalEvidenceIds,
                ],
                ctcEvidenceIds: [
                  ...cue.startComparison.ctcEvidenceIds,
                  ...cue.endComparison.ctcEvidenceIds,
                ].filter(
                  (value, index, values) => values.indexOf(value) === index,
                ),
                independentLexicalEvidenceIds: [
                  ...cue.startComparison.independentLexicalEvidenceIds,
                  ...cue.endComparison.independentLexicalEvidenceIds,
                ].filter(
                  (value, index, values) => values.indexOf(value) === index,
                ),
                speakerEvidenceIds: [
                  ...cue.startComparison.speakerEvidenceIds,
                  ...cue.endComparison.speakerEvidenceIds,
                ].filter(
                  (value, index, values) => values.indexOf(value) === index,
                ),
                deltaStart:
                  cue.proposedInterval.start - cue.originalInterval.start,
                deltaEnd: cue.proposedInterval.end - cue.originalInterval.end,
                atomicComponentDecisionId,
                textChanged: false as const,
              },
            ];
          })
        : [];
      const finalizedCues = cueDecisions.map((cue) => {
        const base = { ...cue, mutationApplied: apply };
        return {
          ...base,
          semanticHash: sha256Value({ ...base, semanticHash: null }),
        };
      });
      const base = {
        componentId,
        cueIds: finalizedCues.map((cue) => cue.cueId),
        componentUnion: {
          start: Math.min(...cues.map((cue) => cue.originalInterval.start)),
          end: Math.max(...cues.map((cue) => cue.originalInterval.end)),
        },
        cueDecisions: finalizedCues,
        jointAssignment,
        directCtcResolved: jointAssignment.resolved,
        timingActionable: allActionable,
        timingMutationApplied: apply,
        subtitleOverlapResolved: apply,
        speakerRelationshipResolved:
          input.speakerResolvedComponentIds.has(componentId),
        // This records the evidence-level atomic decision. Observe mode suppresses
        // materialization, but it must not change the underlying decision proof.
        atomicRollbackApplied: !allActionable,
        mutations,
        blockers: [
          ...jointAssignment.blockers,
          ...finalizedCues.flatMap((cue) => cue.blockers),
        ]
          .filter((value, index, values) => values.indexOf(value) === index)
          .toSorted(),
      };
      return { ...base, semanticHash: sha256Value(base) };
    });
  const cues = components.flatMap((component) => component.cueDecisions);
  const mutations = components.flatMap((component) => component.mutations);
  const summary = {
    targetComponentCount: 7 as const,
    targetCueCount: 16 as const,
    targetEncodableCueCount: input.cues.filter(
      (cue) =>
        cue.narrow.target.targetEncodable &&
        cue.expanded.target.targetEncodable,
    ).length,
    directAttemptCount: 32 as const,
    directInferenceCount: input.attempts.filter(
      (attempt) => attempt.inferenceExecuted,
    ).length,
    directCacheHitCount: input.attempts.filter((attempt) => attempt.cacheHit)
      .length,
    modelLoadCount: input.attempts.reduce(
      (sum, attempt) => sum + attempt.modelLoadCount,
      0,
    ),
    pathSuccessCount: input.attempts.filter(
      (attempt) => attempt.pathStatus === "success",
    ).length,
    windowStableCueCount: cues.filter((cue) => cue.windowStable).length,
    edgePinnedCueCount: cues.filter((cue) => cue.edgePinned).length,
    duplicateOccurrenceConflictCount: components.reduce(
      (sum, component) =>
        sum + component.jointAssignment.duplicateOccurrenceConflictCount,
      0,
    ),
    jointAssignmentResolvedComponentCount: components.filter(
      (component) => component.jointAssignment.resolved,
    ).length,
    timingActionableCueCount: cues.filter((cue) => cue.timingActionable).length,
    timingActionableComponentCount: components.filter(
      (component) => component.timingActionable,
    ).length,
    timingMutationCueCount: mutations.length,
    timingMutationComponentCount: components.filter(
      (component) => component.timingMutationApplied,
    ).length,
    resolvedSubtitleOverlapComponentCount: components.filter(
      (component) => component.subtitleOverlapResolved,
    ).length,
    greedyTextMutationCount: 0 as const,
    tokenRatioRepairCount: 0 as const,
    forbiddenTimingHeuristicUseCount: 0 as const,
    canonicalTextMutationCount: 0 as const,
  };
  const jointAssignmentHash = sha256Value(
    components.map((component) => component.jointAssignment.semanticHash),
  );
  const componentDecisionHash = sha256Value(
    components.map((component) => ({
      componentId: component.componentId,
      timingActionable: component.timingActionable,
      timingMutationApplied: component.timingMutationApplied,
      subtitleOverlapResolved: component.subtitleOverlapResolved,
      blockers: component.blockers,
    })),
  );
  const mutationHash = sha256Value(mutations);
  const base = {
    schemaVersion: "1.0.0" as const,
    artifactType: "subtitle-local-ctc-boundary-evidence" as const,
    evidenceVersion: "C5.18.1" as const,
    generatedAt,
    sourceFingerprint: input.sourceFingerprint,
    baseCueHash: input.baseCueHash,
    baseTimingHash: input.baseTimingHash,
    ctcAlignmentInputRef: input.alignmentInputRef,
    ctcRuntimeCapabilityRef: input.runtimeCapabilityRef,
    ctcPolicyVersion: "c5.18.1-local-ctc-boundary-v1" as const,
    configuration: {
      mode: input.mode,
      deviceRequested: input.deviceRequested,
      deviceUsed: input.deviceUsed,
      windowMode: "dual" as const,
      narrowContextSeconds: 0.5 as const,
      maximumWindowBoundaryDeltaSeconds: 0.12 as const,
      maximumTimingMutationSeconds: 0.5 as const,
      minimumCueDurationSeconds: 0.4 as const,
      jointAssignmentPolicy: "component-monotonic-atomic-v1" as const,
      independentBoundaryPolicy: "side-specific-lexical-consensus-v1" as const,
      scoreCalibrationStatus: "uncalibrated-ctc-score" as const,
    },
    attempts: [...input.attempts].toSorted((left, right) =>
      left.attemptId.localeCompare(right.attemptId),
    ),
    cues: [...cues].toSorted((left, right) =>
      left.cueId.localeCompare(right.cueId),
    ),
    components,
    mutations,
    summary,
    jointAssignmentHash,
    componentDecisionHash,
    mutationHash,
  };
  const semanticProjection = {
    ...base,
    generatedAt: null,
    configuration: {
      ...base.configuration,
      mode: "enforce" as const,
    },
    attempts: base.attempts.map((attempt) => ({
      ...attempt,
      cacheHit: false,
      inferenceExecuted: false,
      modelLoadCount: 0,
      wallClockSeconds: 0,
    })),
    summary: {
      ...base.summary,
      directInferenceCount: 0,
      directCacheHitCount: 0,
      modelLoadCount: 0,
    },
  };
  return subtitleLocalCtcBoundaryEvidenceSchema.parse({
    ...base,
    semanticHash: sha256Value(semanticProjection),
  });
}

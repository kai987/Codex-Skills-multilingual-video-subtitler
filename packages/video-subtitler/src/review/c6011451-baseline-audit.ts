import {
  baselineAudit1451Schema,
  type CoverageUnits145,
  type Inventory142,
  type Planner145,
  type Policy1451,
  type Realizations145,
  type ReviewAudio145,
  type ReviewPlayback145,
  type ReviewTargets145,
  type SafetyTargets145,
  type Samples142,
} from "@mvl/shared";
import { hashed141, union141 } from "./c601141-policy.js";
import { intersection143, sampleCount143 } from "./c601143-policy.js";
import { header1451 } from "./c6011451-policy.js";

const speechTarget = (targetType: string) =>
  /(?:MISSING.*SPEECH|ORPHAN_SPEECH|SAFETY_RESERVE|DETECTOR_EXCLUSIVE|MASKED_SPEECH)/u.test(
    targetType,
  );

const overlapSamples = (left: Samples142[], right: Samples142[]) =>
  sampleCount143(intersection143(left, right));

export function buildBaselineAudit1451(input: {
  policy: Policy1451;
  inventory: Inventory142;
  units: CoverageUnits145;
  planner: Planner145;
  realizations: Realizations145;
  safety: SafetyTargets145;
  targets: ReviewTargets145;
  audio: ReviewAudio145;
  playback: ReviewPlayback145;
  cueIntervals: Samples142[];
  immutableIntervals: Samples142[];
}) {
  const rate = input.inventory.sourceIdentity.sampleRate,
    verified = input.inventory.observations.filter(
      (row) =>
        row.verifiedTimebase && row.speechPositive && !row.strongContradiction,
    ),
    verifiedUnion = union141(verified.map((row) => row.nativeInterval)),
    unitUnion = union141(
      input.units.units.flatMap((row) => row.atomicNativeIntervals),
    ),
    verifiedSamples = sampleCount143(verifiedUnion),
    unitSamples = sampleCount143(unitUnion),
    targetById = new Map(
      input.targets.targets.map((row) => [row.reviewTargetId, row]),
    ),
    unitById = new Map(
      input.units.units.map((row) => [row.coverageUnitId, row]),
    ),
    pairOverlap = (intervals: Samples142[], unitId: string) => {
      const unit = unitById.get(unitId);
      return unit ? overlapSamples(intervals, unit.atomicNativeIntervals) : 0;
    },
    targetPairs = input.targets.targets.flatMap((target) =>
      target.coverageUnitIds.map((unitId) => ({
        target,
        unitId,
        overlap: pairOverlap([target.nativeInterval], unitId),
      })),
    ),
    audioPairs = input.audio.audio.flatMap((audio) =>
      audio.coveredCoverageUnitIds.map((unitId) => ({
        audio,
        unitId,
        overlap: pairOverlap([audio.nativeSourceInterval], unitId),
      })),
    ),
    playbackPairs = input.playback.segments.flatMap((segment) =>
      segment.coverageUnitIds.map((unitId) => ({
        segment,
        unitId,
        overlap: pairOverlap(
          [
            {
              startSample: Math.round(segment.sourceInterval.start * rate),
              endSample: Math.round(segment.sourceInterval.end * rate),
            },
          ],
          unitId,
        ),
      })),
    ),
    selectedRealizations = new Set(input.planner.selectedRealizationIds),
    selectedUnitIds = new Set(input.planner.selectedCoverageUnitIds),
    safetyFallbacks = input.safety.targets.filter(
      (target) => !selectedRealizations.has(target.realizationId),
    ),
    allMandatory = input.playback.plans.find(
      (plan) => plan.planId === "ALL_MANDATORY",
    ),
    fullQueue = input.playback.plans.find(
      (plan) => plan.planId === "FULL_QUEUE",
    ),
    requiredTargets = input.targets.targets.filter((target) =>
      speechTarget(target.targetType),
    ),
    targetEvidenceCount = input.targets.targets.filter(
      (target) =>
        speechTarget(target.targetType) &&
        overlapSamples([target.nativeInterval], verifiedUnion) > 0,
    ).length;
  return baselineAudit1451Schema.parse(
    hashed141({
      ...header1451(input.policy, input.inventory.sourceIdentity),
      artifactType: "machine-c6-0-1-14-5-1-registry-binding-baseline-audit",
      inventoryHash: input.inventory.semanticHash,
      planningUnitsHash: input.units.semanticHash,
      reviewTargetsHash: input.targets.semanticHash,
      reviewAudioHash: input.audio.semanticHash,
      reviewPlaybackHash: input.playback.semanticHash,
      verifiedSpeechRowCount: verified.length,
      verifiedSpeechAtomicIntervalCount: verifiedUnion.length,
      verifiedSpeechUnionSamples: verifiedSamples,
      verifiedSpeechUnionSeconds: verifiedSamples / rate,
      currentCoverageUnitCount: input.units.coverageUnitCount,
      currentCoverageUnitUnionSamples: unitSamples,
      currentCoverageUnitUnionSeconds: unitSamples / rate,
      currentRegistryCoverageRatio: verifiedSamples
        ? unitSamples / verifiedSamples
        : 0,
      cueCoveredSpeechSamples: overlapSamples(
        verifiedUnion,
        input.cueIntervals,
      ),
      immutableTargetCoveredSpeechSamples: overlapSamples(
        verifiedUnion,
        input.immutableIntervals,
      ),
      existingReviewTargetCoveredSpeechSamples: overlapSamples(
        verifiedUnion,
        input.targets.targets.map((target) => target.nativeInterval),
      ),
      uncoveredPlanningSpeechSamples: unitSamples,
      reviewTargetCount: input.targets.targets.length,
      targetWithPositiveMachineSpeechEvidenceCount: targetEvidenceCount,
      targetUnitBoundCount: input.targets.targets.filter(
        (target) => target.coverageUnitIds.length > 0,
      ).length,
      requiredTargetUnitUnboundCount: requiredTargets.filter(
        (target) => target.coverageUnitIds.length === 0,
      ).length,
      optionalNonSpeechTargetCount:
        input.targets.targets.length - requiredTargets.length,
      audioCount: input.audio.audio.length,
      audioUnitBoundCount: input.audio.audio.filter(
        (row) => row.coveredCoverageUnitIds.length > 0,
      ).length,
      playbackSegmentCount: input.playback.segments.length,
      playbackUnitBoundCount: input.playback.segments.filter(
        (row) => row.coverageUnitIds.length > 0,
      ).length,
      targetUnitPairCount: targetPairs.length,
      targetUnitZeroOverlapCount: targetPairs.filter((row) => row.overlap === 0)
        .length,
      audioUnitPairCount: audioPairs.length,
      audioUnitZeroOverlapCount: audioPairs.filter((row) => row.overlap === 0)
        .length,
      playbackUnitPairCount: playbackPairs.length,
      playbackUnitZeroOverlapCount: playbackPairs.filter(
        (row) => row.overlap === 0,
      ).length,
      plannerSelectedRealizationCount: selectedRealizations.size,
      safetyTargetFallbackRealizationCount: safetyFallbacks.length,
      targetBoundToUnselectedRealizationCount: input.targets.targets.filter(
        (target) =>
          target.realizationId !== null &&
          !selectedRealizations.has(target.realizationId),
      ).length,
      productComponentScorableCount: 0,
      productComponentUnscorableCount: 0,
      allMandatoryPlanFound: Boolean(allMandatory),
      allMandatoryResultCopiedFromFullQueue:
        Boolean(allMandatory && fullQueue) &&
        allMandatory?.reviewItemIds.length === fullQueue?.reviewItemIds.length,
      rootCauseClassifications: [
        "COVERAGE_UNIT_BUILDER_FILTERS_COVERED_SPEECH",
        "FULL_REGISTRY_MISSING",
        "PLANNING_PROJECTION_USED_AS_IDENTITY_REGISTRY",
        "INHERITED_TARGET_UNIT_BINDING_MISSING",
        "TARGET_BINDING_PROPAGATION_ONLY",
        ...(targetPairs.some((row) => row.overlap === 0)
          ? ["TARGET_UNIT_ZERO_OVERLAP"]
          : []),
        ...(audioPairs.some((row) => row.overlap === 0)
          ? ["AUDIO_UNIT_ZERO_OVERLAP"]
          : []),
        ...(playbackPairs.some((row) => row.overlap === 0)
          ? ["PLAYBACK_UNIT_ZERO_OVERLAP"]
          : []),
        ...(safetyFallbacks.length
          ? ["PLANNER_UNSELECTED_REALIZATION_FALLBACK"]
          : []),
        "EXISTING_REVIEW_DELIVERY_REALIZATION_MISSING",
        "EVALUATOR_SELECTED_REALIZATIONS_ONLY",
        "SINGLE_UNIT_CONTRACT_ONLY",
        "UNSCORABLE_REPORTED_AS_ZERO",
        "ALL_MANDATORY_COPIED_FROM_FULL_QUEUE",
      ],
    }),
  );
}

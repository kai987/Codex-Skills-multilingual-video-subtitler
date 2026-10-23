import { z } from "zod";
import { c60114SourceIdentitySchema } from "./c6-0-1-14-evidence-schemas.js";
import {
  c601141SampleIntervalSchema as samples,
  c601141IntervalSchema as interval,
} from "./c6-0-1-14-1-speech-inventory-schemas.js";
import {
  hash142Schema as h,
  id142Schema as id,
  count142Schema as n,
  family142Schema as family,
  stratum142Schema as stratum,
} from "./c6-0-1-14-2-selection-detector-schemas.js";

export const version143Schema = z.literal(
  "c6.0.1.14.3-cross-stage-monotonic-safety-selection-v1",
);
const nonnegative = z.number().nonnegative();
const ratio = z.number().min(0).max(1);
export const header143Shape = {
  schemaVersion: z.literal("1.0.0"),
  policyVersion: version143Schema,
  policyHash: h,
  sourceIdentity: c60114SourceIdentitySchema,
  sourceTimebase: z.literal("SOURCE_GLOBAL_NATIVE_SAMPLES"),
  runtimeGoldInputCount: z.literal(0),
  visibility: z.literal("LOCAL_ONLY"),
  semanticHash: h,
};
export const policy143Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    policyVersion: version143Schema,
    executionPolicy: z.literal("replay-only"),
    mode: z.literal("REPLAY_ONLY_SELECTION_AND_DELIVERY_REPAIR"),
    maximumInferenceCount: z.literal(0),
    maximumModelLoadCount: z.literal(0),
    maximumProviderProcessStartCount: z.literal(0),
    maximumActiveSafetyTargets: z.literal(24),
    maximumSpeechCoreUnionSeconds: z.literal(60),
    maximumFullQueueEpisodeRatio: z.literal(0.95),
    minimumObligationCoverageRatio: z.literal(1),
    roundingToleranceSamples: z.literal(1),
    roundingToleranceRequiresVerifiedTransform: z.literal(true),
    minimumChildCoreSeconds: z.literal(0.12),
    preferredMaximumChildCoreSeconds: z.literal(4),
    hardMaximumChildEnvelopeSeconds: z.literal(6),
    hardParentAuditEnvelopeSeconds: z.literal(12),
    maximumBundleEnvelopeSeconds: z.literal(12),
    maximumBundleGapSeconds: z.literal(0.75),
    reviewContextSeconds: z.literal(2),
    diversityBinSeconds: z.literal(60),
    maximumSearchStates: z.literal(5000000),
    objectives: z
      .array(
        z.enum([
          "OBLIGATION_ZERO_REGRESSION",
          "NEW_INDEPENDENT_SPEECH_COVERAGE",
          "FAMILY_STRATUM_NOVELTY",
          "BIN_SCENE_DIVERSITY",
          "MACHINE_PRIORITY",
          "MINIMUM_BUNDLES",
          "MINIMUM_CORE",
          "MINIMUM_INCREMENTAL_AUDIO",
          "MINIMUM_INTERNAL_SILENCE",
          "SOURCE_TIME_FINAL_TIE_BREAK",
        ]),
      )
      .length(10),
    sourceTimeTieBreakOnly: z.literal(true),
    goldBlind: z.literal(true),
    rankerRetrained: z.literal(false),
    newOofRun: z.literal(false),
    canonicalMutationAllowed: z.literal(false),
    semanticHash: h,
  })
  .strict();

export const obligation143Schema = z
  .object({
    obligationId: id,
    originStage: z.literal("C601142_PHASE_A"),
    originTargetIds: z.array(id).min(1),
    originClusterIds: z.array(id).min(1),
    atomicNativeIntervals: z.array(samples).min(1),
    atomicSourceIntervals: z.array(interval).min(1),
    nativeIntervalUnion: z.array(samples).min(1),
    evidenceIds: z.array(id),
    detectorFamilies: z.array(family),
    evidenceStrata: z.array(stratum),
    timelineBins: z.array(n),
    sourceIdentity: c60114SourceIdentitySchema,
    minimumCoverageRatio: z.literal(1),
    equivalentReplacementAllowed: z.literal(true),
    hardConstraint: z.literal(true),
    semanticHash: h,
  })
  .strict();
export const obligations143Schema = z
  .object({
    ...header143Shape,
    artifactType: z.literal("machine-phase-a-coverage-obligations"),
    phaseASelectionHash: h,
    phaseATargetCount: n,
    obligations: z.array(obligation143Schema),
    nativeIntervalUnion: z.array(samples),
    totalNativeSamples: n,
    totalCoreUnionSeconds: nonnegative,
    immutableTargetIds: z.array(id),
    immutableTargetsHash: h,
    hallucinationCurrentCueTargetIds: z.array(id),
    semanticCoverageHash: h,
  })
  .strict();

export const boundary143Schema = z
  .object({
    atSample: n,
    kind: z.enum([
      "PHASE_A_TARGET",
      "PHASE_A_OBLIGATION",
      "IMMUTABLE_TARGET",
      "FINAL_CUE_MASK",
      "VERIFIED_SILENCE",
      "SOURCE_DISCONTINUITY",
      "CONTRADICTION_TRANSITION",
      "TIMEBASE_TRANSITION",
      "DETECTOR_FAMILY_TRANSITION",
      "EVIDENCE_STRATUM_TRANSITION",
      "POSTERIOR_VALLEY",
      "AUDIO_VIEW_TRANSITION",
      "SCENE",
      "SPEAKER",
      "LARGE_INTERNAL_GAP",
    ]),
    hard: z.boolean(),
    strength: nonnegative,
    evidenceHashes: z.array(h),
  })
  .strict();
export const posterior143Schema = z
  .object({
    status: z.enum(["VERIFIED_EXISTING_TRACK", "NO_MAPPABLE_TRACK"]),
    trackHashes: z.array(h),
    frameCount: n,
    minimum: ratio.nullable(),
    maximum: ratio.nullable(),
    mean: ratio.nullable(),
    valleySamples: z.array(n),
  })
  .strict();
export const atom143Schema = z
  .object({
    atomId: id,
    nativeInterval: samples,
    sourceInterval: interval,
    parentClusterIds: z.array(id),
    candidateIds: z.array(id),
    observationIds: z.array(id),
    evidenceIds: z.array(id),
    detectorRunIds: z.array(id),
    detectorFamilies: z.array(family),
    independentFamilies: z.array(id),
    distinctPcmViewIds: z.array(id),
    rootLineageIds: z.array(id),
    evidenceStrata: z.array(stratum),
    timelineBins: z.array(n),
    sceneIds: z.array(id),
    obligationIds: z.array(id),
    verifiedTimebase: z.boolean(),
    strongContradiction: z.boolean(),
    cueCovered: z.boolean(),
    immutableTargetCovered: z.boolean(),
    eligibleEvidence: z.boolean(),
    machinePriority: z.number(),
    posterior: posterior143Schema,
    semanticHash: h,
  })
  .strict();
export const child143Schema = z
  .object({
    childUnitId: id,
    parentClusterIds: z.array(id).min(1),
    atomIds: z.array(id).min(1),
    candidateIds: z.array(id),
    observationIds: z.array(id),
    evidenceIds: z.array(id),
    detectorRunIds: z.array(id),
    rootLineageIds: z.array(id),
    atomicNativeIntervals: z.array(samples).min(1),
    atomicSourceIntervals: z.array(interval).min(1),
    nativeIntervalUnion: z.array(samples).min(1),
    reviewEnvelope: samples,
    coreUnionSeconds: nonnegative,
    internalSilenceSeconds: nonnegative,
    detectorFamilies: z.array(family),
    independentFamilies: z.array(id),
    evidenceStrata: z.array(stratum),
    distinctPcmViewIds: z.array(id),
    timelineBins: z.array(n),
    sceneIds: z.array(id),
    obligationIds: z.array(id),
    overlapsFinalCueMask: z.boolean(),
    overlapsImmutableTarget: z.boolean(),
    verifiedTimebase: z.boolean(),
    strongContradiction: z.boolean(),
    machinePriority: z.number(),
    posterior: posterior143Schema,
    splitReasons: z.array(boundary143Schema),
    eligible: z.boolean(),
    eligibilityReasons: z.array(id),
    unsplittableLargeChild: z.boolean(),
    sourceIdentity: c60114SourceIdentitySchema,
    semanticHash: h,
  })
  .strict();
export const hierarchy143Schema = z
  .object({
    ...header143Shape,
    artifactType: z.literal("machine-selectable-speech-child-units-v1"),
    inventoryHash: h,
    obligationsHash: h,
    parentClustersHash: h,
    scoreTracksHash: h,
    boundaries: z.array(boundary143Schema),
    atoms: z.array(atom143Schema),
    parents: z.array(
      z
        .object({
          parentClusterId: id,
          parentSemanticHash: h,
          reviewEnvelope: samples,
          atomicMemberCount: n,
          childUnitIds: z.array(id),
        })
        .strict(),
    ),
    children: z.array(child143Schema),
    summary: z
      .object({
        parentCount: n,
        atomCount: n,
        childCount: n,
        eligibleChildCount: n,
        multiChildParentCount: n,
        maximumParentMemberCount: n,
        maximumChildMemberCount: n,
        maximumChildCoreSeconds: nonnegative,
        maximumChildEnvelopeSeconds: nonnegative,
        oversizedParentCount: n,
        unsplittableLargeChildCount: n,
        hardSplitCount: n,
        softSplitCount: n,
        posteriorValleyCount: n,
        unmappableTrackCount: n,
        intervalConservationPassed: z.boolean(),
        envelopeAsSpeechCount: z.literal(0),
      })
      .strict(),
  })
  .strict();

export const bundle143Schema = z
  .object({
    bundleId: id,
    childUnitIds: z.array(id).min(1),
    parentClusterIds: z.array(id).min(1),
    obligationIds: z.array(id),
    atomicNativeIntervals: z.array(samples).min(1),
    atomicSourceIntervals: z.array(interval).min(1),
    nativeIntervalUnion: z.array(samples).min(1),
    reviewEnvelope: samples,
    coreUnionSeconds: nonnegative,
    internalSilenceSeconds: nonnegative,
    internalGapIntervals: z.array(samples),
    cueCoveredGapIntervals: z.array(samples),
    detectorFamilies: z.array(family),
    evidenceStrata: z.array(stratum),
    timelineBins: z.array(n),
    sceneIds: z.array(id),
    evidenceIds: z.array(id),
    strongContradiction: z.boolean(),
    machinePriority: z.number(),
    independentSupportedNativeIntervals: z.array(samples),
    targetSlotCost: z.literal(1),
    incrementalFullQueueAudioSeconds: nonnegative,
    predictedAudioIntervals: z.array(samples).min(1),
    sourceIdentity: c60114SourceIdentitySchema,
    verifiedTimebase: z.boolean(),
    eligible: z.boolean(),
    rejectionReasons: z.array(id),
    semanticHash: h,
  })
  .strict();
export const bundles143Schema = z
  .object({
    ...header143Shape,
    artifactType: z.literal("machine-review-target-bundle-candidates-v1"),
    childrenHash: h,
    obligationsHash: h,
    immutableAudioIntervals: z.array(samples),
    baselineUniqueAudioSeconds: nonnegative,
    generationMethod: z.literal(
      "LOCAL_CONTIGUOUS_AND_OBLIGATION_SUBSET_WINDOWS",
    ),
    candidates: z.array(bundle143Schema),
    summary: z
      .object({
        candidateCount: n,
        multiChildBundleCount: n,
        eligibleCount: n,
        cueCoveredInternalGapBundleCount: n,
        rejectedCount: n,
        maximumEnvelopeSeconds: nonnegative,
        wholeEpisodeCatchAllCount: z.literal(0),
      })
      .strict(),
  })
  .strict();
export const dominance143Schema = z
  .object({
    ...header143Shape,
    artifactType: z.literal("machine-target-bundle-dominance-ledger"),
    candidatesHash: h,
    retainedBundleIds: z.array(id),
    entries: z.array(
      z
        .object({
          dominatedBundleId: id,
          dominatingBundleId: id,
          reason: z.literal(
            "SAME_OR_SUPERSET_CORE_NO_GREATER_COST_NO_LESS_DIVERSITY",
          ),
          comparisonHash: h,
        })
        .strict(),
    ),
    dominatedBundleCount: n,
  })
  .strict();

export const preservation143Schema = z.enum([
  "EXACT_TARGET_RETAINED",
  "EQUIVALENT_CHILD_TARGET",
  "EQUIVALENT_TARGET_BUNDLE",
  "SUPERSET_CORE_COVERAGE",
  "REGRESSED_NOT_COVERED",
]);
export const continuityRow143Schema = z
  .object({
    obligationId: id,
    originalTargetIds: z.array(id),
    originalNativeIntervals: z.array(samples),
    finalChildIds: z.array(id),
    finalTargetBundleIds: z.array(id),
    finalCoveredIntervals: z.array(samples),
    uncoveredIntervals: z.array(samples),
    requiredNativeSamples: n,
    coveredNativeSamples: n,
    coverageRatio: ratio,
    preservationMethod: preservation143Schema,
    reason: id,
    regression: z.boolean(),
  })
  .strict();
export const monotonicity143Schema = z
  .object({
    ...header143Shape,
    artifactType: z.literal("machine-cross-stage-coverage-monotonicity"),
    obligationsHash: h,
    finalSelectionHash: h,
    obligationCount: n,
    obligationNativeSamples: n,
    finalCoveredNativeSamples: n,
    uncoveredNativeSamples: n,
    obligationCoverageRatio: ratio,
    exactTargetRetainedCount: n,
    equivalentChildTargetCount: n,
    equivalentBundleReplacementCount: n,
    supersetCoreCoverageCount: n,
    droppedObligationCount: n,
    regressedObligationIds: z.array(id),
    uncoveredNativeIntervals: z.array(samples),
    roundingCorrectionsApplied: z.literal(0),
    monotonicityPassed: z.boolean(),
  })
  .strict();
export const continuity143Schema = z
  .object({
    ...header143Shape,
    artifactType: z.literal("machine-cross-stage-selection-continuity-ledger"),
    obligationsHash: h,
    finalSelectionHash: h,
    entries: z.array(continuityRow143Schema),
    candidateDecisions: z.array(
      z
        .object({
          childUnitId: id,
          newDetectorEvidence: z.boolean(),
          selected: z.boolean(),
          finalBundleIds: z.array(id),
          reason: id,
          coreSeconds: nonnegative,
          addedNativeSamples: n,
        })
        .strict(),
    ),
    monotonicityHash: h,
  })
  .strict();
export const planner143Schema = z
  .object({
    ...header143Shape,
    artifactType: z.literal("machine-final-safety-planner-certificate"),
    plannerVersion: z.literal("DETERMINISTIC_NATIVE_SET_COVER_BNB_V1"),
    obligationsHash: h,
    candidatesHash: h,
    dominanceHash: h,
    immutableTargetsHash: h,
    immutableTargetIds: z.array(id),
    hallucinationCurrentCueTargetIds: z.array(id),
    candidateCountBeforePruning: n,
    candidateCountAfterPruning: n,
    hardConstraintCount: n,
    obligationCount: n,
    exploredStateCount: n,
    prunedStateCount: n,
    searchStateLimit: n.positive(),
    searchBoundMethod: z.enum([
      "NATIVE_SUBSET_SUM_RELAXATION",
      "CONTINUOUS_CORE_RELAXATION",
    ]),
    searchBoundLookupCellCount: n,
    searchComplete: z.boolean(),
    feasibilityStatus: z.enum([
      "FEASIBLE",
      "INFEASIBLE_PROVEN",
      "SEARCH_INCOMPLETE",
    ]),
    selectedBundleIds: z.array(id),
    selectedChildIds: z.array(id),
    activeTargetCount: n,
    speechCoreUnionSeconds: nonnegative,
    predictedFullQueueSeconds: nonnegative,
    predictedFullQueueEpisodeRatio: nonnegative,
    obligationCoverageRatio: ratio,
    evidenceStrataCoverage: z.array(stratum),
    detectorFamilyCoverage: z.array(family),
    timelineBinCoverage: z.array(n),
    sceneCoverage: z.array(id),
    objectiveVector: z.array(z.number()),
    deterministicTieBreakTraceHash: h,
    feasibilityWitnessVerified: z.boolean(),
    hardConstraintResults: z.array(
      z.object({ name: id, passed: z.boolean() }).strict(),
    ),
    fallback: z.enum(["NONE", "PHASE_A_SELECTION_ONLY_HOLD"]),
    diagnosticReasons: z.array(id),
  })
  .strict()
  .refine(
    (v) =>
      (v.feasibilityStatus !== "INFEASIBLE_PROVEN" ||
        (v.searchComplete && !v.feasibilityWitnessVerified)) &&
      (v.feasibilityStatus !== "FEASIBLE" ||
        (v.searchComplete && v.feasibilityWitnessVerified)) &&
      (v.feasibilityStatus !== "SEARCH_INCOMPLETE" || !v.searchComplete),
    "Search status must distinguish a witness from exhaustion",
  );

export const safetyTarget143Schema = bundle143Schema
  .extend({
    targetId: id,
    targetKind: z.enum([
      "SINGLE_CHILD_TARGET",
      "MULTI_CHILD_TARGET_BUNDLE",
      "LEGACY_EXACT_TARGET",
    ]),
    selectionStage: z.literal("C601143_CONSTRAINED_FINAL_PLANNER"),
    plannerCertificateHash: h,
    continuityLedgerHash: h,
    retainedOriginTargetIds: z.array(id),
    supersededOriginTargetIds: z.array(id),
    requiredLevel: z.literal("RECOMMENDED"),
    audioRequired: z.literal(true),
    canonicalInsertAllowed: z.literal(false),
  })
  .strict();
export const safety143Schema = z
  .object({
    ...header143Shape,
    artifactType: z.literal("machine-missing-safety-reserve-targets-v3"),
    obligationsHash: h,
    hierarchyHash: h,
    candidatesHash: h,
    plannerCertificateHash: h,
    continuityLedgerHash: h,
    monotonicityHash: h,
    targets: z.array(safetyTarget143Schema).max(24),
    summary: z
      .object({
        activeTargetCount: n.max(24),
        childUnitCount: n,
        atomicMemberCount: n,
        singleChildTargetCount: n,
        multiChildBundleTargetCount: n,
        speechCoreUnionSeconds: nonnegative.max(60),
        reviewEnvelopeUnionSeconds: nonnegative,
        internalSilenceSeconds: nonnegative,
        wholeEpisodeCatchAllTargetCount: z.literal(0),
        obligationCoverageRatio: z.literal(1),
        canonicalInsertCount: z.literal(0),
        requiredLevelPromotionCount: z.literal(0),
      })
      .strict(),
  })
  .strict();

export const transition143Schema = z
  .object({
    ...header143Shape,
    artifactType: z.literal("machine-cross-stage-selection-transition-audit"),
    stages: z
      .array(
        z
          .object({
            stageId: z.enum([
              "S0_C601141_ACTIVE",
              "S1_C601142_PHASE_A",
              "S2_COMBINED_INVENTORY",
              "S3_OLD_FINAL",
            ]),
            inputSelectionHash: h,
            activeTargetIds: z.array(id),
            atomicNativeIntervals: z.array(samples),
            atomicSourceIntervals: z.array(interval),
            nativeIntervalUnion: z.array(samples),
            speechCoreUnionSeconds: nonnegative,
            evidenceStrata: z.array(stratum),
            detectorFamilies: z.array(family),
            timelineBins: z.array(n),
            targetCount: n,
            carriedForwardTargetIds: z.array(id),
            equivalentReplacementTargetIds: z.array(id),
            droppedTargetIds: z.array(id),
            droppedNativeIntervals: z.array(samples),
            newCoverageIntervals: z.array(samples),
            semanticHash: h,
          })
          .strict(),
      )
      .length(4),
    phaseARegressedNativeIntervals: z.array(samples),
    phaseARegressedNativeSamples: n,
    phaseARegressedTargetCount: n,
    diagnosis: z.array(id),
    goldUsedForDetection: z.literal(false),
  })
  .strict();

export const c601143SelectionSchemas = {
  "c6-0-1-14-3-policy": policy143Schema,
  "machine-phase-a-coverage-obligations": obligations143Schema,
  "machine-selectable-speech-child-units-v1": hierarchy143Schema,
  "machine-review-target-bundle-candidates-v1": bundles143Schema,
  "machine-target-bundle-dominance-ledger": dominance143Schema,
  "machine-cross-stage-coverage-monotonicity": monotonicity143Schema,
  "machine-cross-stage-selection-continuity-ledger": continuity143Schema,
  "machine-final-safety-planner-certificate": planner143Schema,
  "machine-missing-safety-reserve-targets-v3": safety143Schema,
  "machine-cross-stage-selection-transition-audit": transition143Schema,
};
export type Policy143 = z.infer<typeof policy143Schema>;
export type Obligation143 = z.infer<typeof obligation143Schema>;
export type Obligations143 = z.infer<typeof obligations143Schema>;
export type Boundary143 = z.infer<typeof boundary143Schema>;
export type Posterior143 = z.infer<typeof posterior143Schema>;
export type Atom143 = z.infer<typeof atom143Schema>;
export type Child143 = z.infer<typeof child143Schema>;
export type Hierarchy143 = z.infer<typeof hierarchy143Schema>;
export type Bundle143 = z.infer<typeof bundle143Schema>;
export type Bundles143 = z.infer<typeof bundles143Schema>;
export type Dominance143 = z.infer<typeof dominance143Schema>;
export type Monotonicity143 = z.infer<typeof monotonicity143Schema>;
export type Continuity143 = z.infer<typeof continuity143Schema>;
export type Planner143 = z.infer<typeof planner143Schema>;
export type Safety143 = z.infer<typeof safety143Schema>;
export type Transition143 = z.infer<typeof transition143Schema>;

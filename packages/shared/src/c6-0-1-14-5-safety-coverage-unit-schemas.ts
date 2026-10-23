import { z } from "zod";
import { c60114SourceIdentitySchema } from "./c6-0-1-14-evidence-schemas.js";
import {
  c601141SampleIntervalSchema as samples,
  c601141IntervalSchema as interval,
} from "./c6-0-1-14-1-speech-inventory-schemas.js";
import {
  hash142Schema as hash,
  id142Schema as id,
  count142Schema as count,
  family142Schema as family,
  stratum142Schema as stratum,
} from "./c6-0-1-14-2-selection-detector-schemas.js";
import {
  reviewTarget144Schema,
  reviewTargets144Schema,
  reviewItem144Schema,
  reviewItems144Schema,
  reviewRegion144Schema,
  reviewRegions144Schema,
  reviewAudio144Schema,
  reviewPlayback144Schema,
} from "./c6-0-1-14-4-machine-evidence-utility-schemas.js";

export const version145Schema = z.literal(
  "c6.0.1.14.5-safety-coverage-unit-contract-v1",
);
const nonnegative = z.number().nonnegative();
const ratio = z.number().min(0).max(1);
const integer = z.number().int();
const vector = z.array(integer);

export const contract145Schema = z.enum([
  "TARGET_CORE_LOCALIZATION_CONTRACT_V1",
  "MACHINE_ANCHORED_PLAYBACK_AUDIBILITY_CONTRACT_V1",
]);
export const productContract145Schema = z.literal(
  "MACHINE_ANCHORED_PLAYBACK_AUDIBILITY_CONTRACT_V1",
);
export const realizationType145Schema = z.enum([
  "CORE_COMPLETE_REALIZATION",
  "MACHINE_ANCHORED_PLAYBACK_REALIZATION",
]);
export const unitTier145Schema = z.enum([
  "UNIT_TIER_5_MULTI_FAMILY_VERIFIED",
  "UNIT_TIER_4_INDEPENDENT_EXCLUSIVE_VERIFIED",
  "UNIT_TIER_3_SINGLE_FAMILY_VERIFIED",
  "UNIT_TIER_2_MASKED_OR_SUBTHRESHOLD",
  "UNIT_TIER_1_AUDIT_ONLY",
  "UNIT_TIER_0_INELIGIBLE_OR_CONTRADICTED",
]);
export const unitTierCounts145Schema = z
  .object({
    UNIT_TIER_5_MULTI_FAMILY_VERIFIED: count,
    UNIT_TIER_4_INDEPENDENT_EXCLUSIVE_VERIFIED: count,
    UNIT_TIER_3_SINGLE_FAMILY_VERIFIED: count,
    UNIT_TIER_2_MASKED_OR_SUBTHRESHOLD: count,
    UNIT_TIER_1_AUDIT_ONLY: count,
    UNIT_TIER_0_INELIGIBLE_OR_CONTRADICTED: count,
  })
  .strict();

export const header145Shape = {
  schemaVersion: z.literal("1.0.0"),
  policyVersion: version145Schema,
  policyHash: hash,
  sourceIdentity: c60114SourceIdentitySchema,
  sourceTimebase: z.literal("SOURCE_GLOBAL_NATIVE_SAMPLES"),
  runtimeGoldInputCount: z.literal(0),
  visibility: z.literal("LOCAL_ONLY"),
  semanticHash: hash,
};

export const policy145Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    policyVersion: version145Schema,
    artifactType: z.literal("c6-0-1-14-5-safety-coverage-unit-policy"),
    executionPolicy: z.literal("replay-only"),
    mode: z.literal("REPLAY_ONLY_SAFETY_COVERAGE_UNIT_CONTRACT"),
    maximumInferenceCount: z.literal(0),
    maximumModelLoadCount: z.literal(0),
    maximumProviderProcessStartCount: z.literal(0),
    coverageUnitBoundaryPolicyVersion: z.literal(
      "C601145_SOURCE_NATIVE_CONNECTED_COMPONENT_V1",
    ),
    coverageUnitMergeGapSeconds: z.literal(0.3),
    hardBoundaryKinds: z.array(id),
    softBoundaryKinds: z.array(id),
    segmentationInvariantIdentity: z.literal(true),
    segmentationInvariantUtility: z.literal(true),
    atomCountUtilityAllowed: z.literal(false),
    childCountUtilityAllowed: z.literal(false),
    bundleCountUtilityAllowed: z.literal(false),
    rawRecognizedTextAllowed: z.literal(false),
    exactSourceTimestampRiskFeatureAllowed: z.literal(false),
    goldFeaturesAllowed: z.literal(false),
    productGoContract: productContract145Schema,
    targetCoreContract: z.literal("TARGET_CORE_LOCALIZATION_CONTRACT_V1"),
    targetCoreGoldCoverageThreshold: z.literal(0.8),
    unitCoreGoldCoverageThreshold: z.literal(0.8),
    machineAnchorMinimumOverlapSeconds: z.literal(0.2),
    machineAnchorMinimumUnitCoverageRatio: z.literal(0.1),
    playbackGoldCoverageThreshold: z.literal(0.8),
    playbackUnitCoverageThreshold: z.literal(0.95),
    coreCompleteUnitCoverageThreshold: z.literal(0.95),
    maximumReviewEnvelopeSeconds: z.literal(12),
    maximumOneSideContextSeconds: z.literal(3),
    maximumActiveSafetyBundles: z.literal(24),
    maximumSpeechCoreUnionSeconds: z.literal(60),
    maximumFullQueueEpisodeRatio: z.literal(0.95),
    maximumSearchStates: z.literal(5_000_000),
    unitPlannerObjectives: z.array(id).length(14),
    projectionHashRebindingRequired: z.literal(true),
    nestedPreGoldPreflightRequired: z.literal(true),
    productContractFrozenBeforeGold: z.literal(true),
    individuallyFeasibleChildDiagnosticOnly: z.literal(true),
    canonicalMutationAllowed: z.literal(false),
    machineOnlyReleaseAuthorized: z.literal(false),
    rankerRetrained: z.literal(false),
    semanticHash: hash,
  })
  .strict();

const distribution145Schema = z
  .object({
    minimum: nonnegative,
    maximum: nonnegative,
    mean: nonnegative,
    median: nonnegative,
    p90: nonnegative,
  })
  .strict();

export const segmentationAudit145Schema = z
  .object({
    ...header145Shape,
    artifactType: z.literal("machine-segmentation-sensitivity-audit"),
    hierarchyHash: hash,
    atomUtilityHash: hash,
    childUtilityHash: hash,
    bundleUtilityHash: hash,
    plannerHash: hash,
    atomCount: count,
    childCount: count,
    bundleCount: count,
    atomCountPerChildDistribution: distribution145Schema,
    childCountPerContinuousSpeechRegion: distribution145Schema,
    utilityPerAtomCountCorrelation: z.number().min(-1).max(1),
    utilityPerChildCountCorrelation: z.number().min(-1).max(1),
    utilityPerCoreSecondCorrelation: z.number().min(-1).max(1),
    selectedChildDurationDistribution: distribution145Schema,
    selectedChildAtomCountDistribution: distribution145Schema,
    selectedOptionalCoreUnionSeconds: nonnegative,
    selectedOptionalChildCount: count,
    averageSelectedOptionalChildSeconds: nonnegative,
    sameCoreDifferentSegmentationUtilityDelta: integer,
    syntheticProbe: z
      .object({
        childPartitionCounts: z.tuple([
          z.literal(1),
          z.literal(3),
          z.literal(10),
        ]),
        legacyContributionVectors: z.array(vector).length(3),
        coverageUnitIds: z.array(id).length(3),
        unitUtilityVectors: z.array(vector).length(3),
        plannerContributionVectors: z.array(vector).length(3),
        newUnitIdInvariant: z.literal(true),
        newUnitUtilityInvariant: z.literal(true),
        newPlannerContributionInvariant: z.literal(true),
      })
      .strict(),
    segmentationSensitivityDetected: z.boolean(),
    newSegmentationInvariancePassed: z.literal(true),
  })
  .strict();

export const coverageUnit145Schema = z
  .object({
    coverageUnitId: id,
    sourceIdentity: c60114SourceIdentitySchema,
    atomicNativeIntervals: z.array(samples).min(1),
    atomicSourceIntervals: z.array(interval).min(1),
    coreUnionSamples: count.positive(),
    coreUnionSeconds: nonnegative.positive(),
    envelopeInterval: samples,
    envelopeSeconds: nonnegative.positive(),
    internalSilenceIntervals: z.array(samples),
    evidenceAtomIds: z.array(id).min(1),
    childUnitIds: z.array(id).min(1),
    parentClusterIds: z.array(id),
    detectorFamilies: z.array(family),
    independentEvidenceFamilies: z.array(id),
    evidenceStrata: z.array(stratum),
    distinctPcmViewIds: z.array(id),
    posteriorSummary: z
      .object({
        maximum: ratio,
        weightedMean: ratio,
        coveredUnionRatio: ratio,
        webRtcBinarySupport: z.boolean(),
      })
      .strict(),
    phaseAObligationIds: z.array(id),
    timelineBins: z.array(integer.nonnegative()),
    sceneIds: z.array(id),
    candidateIds: z.array(id),
    strongContradiction: z.boolean(),
    verifiedTimebase: z.boolean(),
    existingTargetCoverage: ratio,
    existingPlaybackCoverage: ratio,
    segmentationFingerprint: hash,
    semanticHash: hash,
  })
  .strict();

export const coverageUnits145Schema = z
  .object({
    ...header145Shape,
    artifactType: z.literal("machine-speech-safety-coverage-units-v1"),
    hierarchyHash: hash,
    obligationsHash: hash,
    boundaryPolicyVersion: id,
    mergeGapSamples: count,
    units: z.array(coverageUnit145Schema),
    coverageUnitCount: count,
    eligibleCoverageUnitCount: count,
    sourceOrdered: z.literal(true),
    intervalIntegrityPassed: z.literal(true),
    sourceIdentityConsistent: z.literal(true),
    childPartitionIndependent: z.literal(true),
  })
  .strict();

export const unitUtilityRow145Schema = z
  .object({
    coverageUnitId: id,
    sourceUnitHash: hash,
    speechTier: unitTier145Schema,
    independentDetectorFamilies: z.array(id),
    evidenceStrata: z.array(stratum),
    posteriorSupportClass: z.enum([
      "POSTERIOR_UNAVAILABLE",
      "POSTERIOR_LOW",
      "POSTERIOR_MEDIUM",
      "POSTERIOR_HIGH",
    ]),
    detectorExclusiveNovelty: z.boolean(),
    cappedDurationBucket: z.enum([
      "LT_020",
      "FROM_020_TO_050",
      "FROM_050_TO_100",
      "FROM_100_TO_200",
      "FROM_200_TO_400",
      "GTE_400_CAPPED",
    ]),
    cappedDurationUtility: z.number().int().min(0).max(5),
    textCandidateAvailability: z.boolean(),
    speechEvidenceUtilityVector: vector,
    textCandidateUtilityVector: vector,
    reviewSafetyUtilityVector: vector,
    utilityEligibility: z.boolean(),
    utilityReasons: z.array(id),
    featureHash: hash,
    semanticHash: hash,
  })
  .strict();

export const unitUtility145Schema = z
  .object({
    ...header145Shape,
    artifactType: z.literal("machine-speech-safety-coverage-unit-utility-v1"),
    coverageUnitsHash: hash,
    rows: z.array(unitUtilityRow145Schema),
    rowCount: count,
    eligibleUnitCount: count,
    tierCounts: unitTierCounts145Schema,
    segmentationDependentUnitUtilityCount: z.literal(0),
    atomCountFeatureCount: z.literal(0),
    childCountFeatureCount: z.literal(0),
    bundleCountFeatureCount: z.literal(0),
    goldFeatureCount: z.literal(0),
    utilityGatePassed: z.literal(true),
  })
  .strict();

const contractDefinition145Schema = z
  .object({
    contractType: contract145Schema,
    role: z.enum(["PRODUCT_GO", "LOCALIZATION_DIAGNOSTIC"]),
    goldCoverageThreshold: z.literal(0.8),
    unitCoverageThreshold: ratio.nullable(),
    anchorMinimumOverlapSeconds: nonnegative.nullable(),
    anchorMinimumUnitCoverageRatio: ratio.nullable(),
    maximumReviewEnvelopeSeconds: nonnegative.nullable(),
    maximumOneSideContextSeconds: nonnegative.nullable(),
  })
  .strict();

export const contractPolicy145Schema = z
  .object({
    ...header145Shape,
    artifactType: z.literal("machine-review-safety-contract-policy-v1"),
    productGoContract: productContract145Schema,
    contracts: z.array(contractDefinition145Schema).length(2),
    frozenPreGold: z.literal(true),
    machineOnlyReleaseAuthorized: z.literal(false),
    thresholdChangeAllowedPostFreeze: z.literal(false),
    wholeEpisodeCatchAllAllowed: z.literal(false),
  })
  .strict();

export const realization145Schema = z
  .object({
    realizationId: id,
    coverageUnitId: id,
    contractType: contract145Schema,
    realizationType: realizationType145Schema,
    childUnitIds: z.array(id).min(1),
    bundleIds: z.array(id).min(1),
    atomicTargetCoreIntervals: z.array(samples).min(1),
    targetCoreCoverageOfUnit: ratio,
    anchorOverlapSamples: count,
    anchorCoverageRatio: ratio,
    reviewEnvelope: samples,
    predictedPlaybackCoverageOfUnit: ratio,
    leftContextSeconds: nonnegative,
    rightContextSeconds: nonnegative,
    targetSlotCost: count.positive(),
    speechCoreCostSamples: count.positive(),
    predictedAudioCostSamples: count.positive(),
    internalSilenceCostSamples: count,
    obligationCoverage: ratio,
    sourceIdentity: c60114SourceIdentitySchema,
    eligibility: z.boolean(),
    rejectionReasons: z.array(id),
    semanticHash: hash,
  })
  .strict();

export const realizations145Schema = z
  .object({
    ...header145Shape,
    artifactType: z.literal("machine-coverage-unit-realization-candidates-v1"),
    coverageUnitsHash: hash,
    contractPolicyHash: hash,
    bundleCandidatesHash: hash,
    candidates: z.array(realization145Schema),
    candidateCount: count,
    eligibleCandidateCount: count,
    coreCompleteCandidateCount: count,
    anchoredPlaybackCandidateCount: count,
    unitWithoutCoreCompleteRealizationCount: count,
    unitWithoutAnchoredPlaybackRealizationCount: count,
  })
  .strict();

export const realizationDominance145Schema = z
  .object({
    ...header145Shape,
    artifactType: z.literal(
      "machine-coverage-unit-realization-dominance-ledger",
    ),
    realizationCandidatesHash: hash,
    retainedRealizationIds: z.array(id),
    dominatedRealizationIds: z.array(id),
    dominatedBy: z.record(id, id),
    candidateCount: count,
    retainedCount: count,
    dominatedCount: count,
    strictCostDominanceOnly: z.literal(true),
  })
  .strict();

export const jointFeasibilityRow145Schema = z
  .object({
    coverageUnitId: id,
    contractType: contract145Schema,
    realizationCandidateIds: z.array(id),
    forcedConstraint: z.literal("AT_LEAST_ONE_REALIZATION_FOR_UNIT_CONTRACT"),
    searchMethod: z.literal("DETERMINISTIC_EXACT_LEXICOGRAPHIC_MILP"),
    exploredStates: count,
    prunedStates: count,
    searchComplete: z.boolean(),
    feasibilityStatus: z.enum([
      "JOINTLY_FEASIBLE",
      "INFEASIBLE_PROVEN",
      "SEARCH_INCOMPLETE",
      "NO_REALIZATION_SET",
      "ALREADY_SATISFIED_BY_PRODUCTION_PLAN",
    ]),
    selectedRealizationId: id.nullable(),
    selectedBundleIds: z.array(id),
    selectedChildIds: z.array(id),
    counterfactualRemovedBundleIds: z.array(id),
    targetSlotCost: count,
    speechCoreCostSamples: count,
    predictedAudioCostSamples: count,
    phaseAObligationsPreserved: z.boolean(),
    hardConstraintsPassed: z.boolean(),
    objectiveDelta: vector,
    semanticHash: hash,
  })
  .strict();

export const jointFeasibility145Schema = z
  .object({
    ...header145Shape,
    artifactType: z.literal("machine-coverage-unit-joint-feasibility-results"),
    coverageUnitsHash: hash,
    unitUtilityHash: hash,
    realizationCandidatesHash: hash,
    realizationDominanceHash: hash,
    baselinePlannerHash: hash,
    rows: z.array(jointFeasibilityRow145Schema),
    totalEligibleUnits: count,
    auditedUnits: count,
    unauditedUnits: count,
    unauditedReasons: z.array(id),
    jointlyFeasibleCount: count,
    infeasibleProvenCount: count,
    searchIncompleteCount: count,
    noRealizationSetCount: count,
    allRequiredAuditsComplete: z.boolean(),
    individuallyFeasibleUnselectedHighTierChildCount: count,
    individuallyFeasibleChildDiagnosticOnly: z.literal(true),
  })
  .strict();

export const planner145Schema = z
  .object({
    ...header145Shape,
    artifactType: z.literal(
      "machine-coverage-unit-aware-final-planner-certificate",
    ),
    plannerVersion: z.literal("DETERMINISTIC_UNIT_REALIZATION_COVER_MILP_V1"),
    productGoContract: productContract145Schema,
    unitPolicyHash: hash,
    contractPolicyHash: hash,
    coverageUnitsHash: hash,
    unitUtilityHash: hash,
    realizationCandidatesHash: hash,
    realizationDominanceHash: hash,
    obligationsHash: hash,
    candidatesHash: hash,
    coverageUnitCount: count,
    realizationCandidateCount: count,
    candidateCountAfterPruning: count,
    hardConstraintCount: count,
    obligationCount: count,
    exploredStates: count,
    prunedStates: count,
    searchStateLimit: count.positive(),
    searchComplete: z.boolean(),
    feasibilityStatus: z.enum([
      "FEASIBLE",
      "INFEASIBLE_PROVEN",
      "SEARCH_INCOMPLETE",
    ]),
    oldPlanFeasible: z.boolean(),
    oldPlanObjectiveVector: vector,
    finalObjectiveVector: vector,
    objectiveNonDegradation: z.boolean(),
    unitCoverageByTier: unitTierCounts145Schema,
    selectedCoverageUnitIds: z.array(id),
    selectedRealizationIds: z.array(id),
    selectedBundleIds: z.array(id).max(24),
    selectedChildIds: z.array(id),
    activeBundleCount: count.max(24),
    speechCoreUnionSeconds: nonnegative.max(60),
    predictedFullQueueSeconds: nonnegative,
    predictedFullQueueEpisodeRatio: ratio.max(0.95),
    phaseAObligationCoverage: z.literal(1),
    phaseARegressionCount: z.literal(0),
    deterministicTieBreakHash: hash,
    admissibleBoundMethod: z.literal(
      "LEXICOGRAPHIC_MILP_OPTIMALITY_WITH_BNB_FALLBACK_BOUND",
    ),
    hardConstraintResults: z.array(
      z.object({ name: id, passed: z.boolean() }).strict(),
    ),
    diagnosticReasons: z.array(id),
  })
  .strict();

export const contractLedgerRow145Schema = z
  .object({
    coverageUnitId: id,
    unitTier: unitTier145Schema,
    productionSelected: z.boolean(),
    selectedRealizationId: id.nullable(),
    targetCoreContractMachineStatus: z.enum(["SATISFIED", "NOT_SATISFIED"]),
    anchoredPlaybackContractMachineStatus: z.enum([
      "SATISFIED",
      "NOT_SATISFIED",
    ]),
    targetCoreCoverageOfUnit: ratio,
    anchorOverlapSeconds: nonnegative,
    anchorCoverageRatio: ratio,
    predictedPlaybackCoverageOfUnit: ratio,
    reviewEnvelopeSeconds: nonnegative,
    leftContextSeconds: nonnegative,
    rightContextSeconds: nonnegative,
    contractViolations: z.array(id),
    semanticHash: hash,
  })
  .strict();

export const contractLedger145Schema = z
  .object({
    ...header145Shape,
    artifactType: z.literal("machine-review-safety-contract-coverage-ledger"),
    plannerCertificateHash: hash,
    unitUtilityHash: hash,
    contractPolicyHash: hash,
    realizationCandidatesHash: hash,
    rows: z.array(contractLedgerRow145Schema),
    selectedUnitCount: count,
    targetCoreSatisfiedUnitCount: count,
    anchoredPlaybackSatisfiedUnitCount: count,
    productMachinePreconditionsPassed: z.boolean(),
  })
  .strict();

export const safetyTarget145Schema = z
  .object({
    targetId: id,
    targetKind: z.enum(["PHASE_A_OBLIGATION", "OPTIONAL_SPEECH_SAFETY"]),
    coverageUnitIds: z.array(id).min(1),
    realizationId: id,
    contractType: contract145Schema,
    childUnitIds: z.array(id).min(1),
    bundleIds: z.array(id).min(1),
    atomicTargetCoreIntervals: z.array(samples).min(1),
    speechCoreUnionSeconds: nonnegative,
    reviewEnvelope: samples,
    unitCoreCoverage: ratio,
    machineAnchorOverlapSeconds: nonnegative,
    machineAnchorCoverageRatio: ratio,
    predictedUnitPlaybackCoverage: ratio,
    phaseAObligationIds: z.array(id),
    unitUtilityRefs: z.array(hash).min(1),
    selectionReason: id,
    sourceIdentity: c60114SourceIdentitySchema,
    audioRequired: z.literal(true),
    requiredLevel: z.literal("RECOMMENDED"),
    canonicalInsertAllowed: z.literal(false),
    semanticHash: hash,
  })
  .strict();

export const safetyTargets145Schema = z
  .object({
    ...header145Shape,
    artifactType: z.literal("machine-missing-safety-reserve-targets-v5"),
    sourceSafetyTargetsHash: hash,
    plannerCertificateHash: hash,
    contractLedgerHash: hash,
    targets: z.array(safetyTarget145Schema).max(24),
    activeTargetCount: count.max(24),
    selectedCoverageUnitCount: count,
    speechCoreUnionSeconds: nonnegative.max(60),
    wholeEpisodeCatchAllCount: z.literal(0),
    obligationCoverageRatio: z.literal(1),
  })
  .strict();

const reheaderKeys = {
  schemaVersion: true,
  policyVersion: true,
  policyHash: true,
  sourceIdentity: true,
  sourceTimebase: true,
  runtimeGoldInputCount: true,
  visibility: true,
  semanticHash: true,
  artifactType: true,
} as const;

export const reviewTarget145Schema = reviewTarget144Schema
  .safeExtend({
    coverageUnitIds: z.array(id),
    realizationId: id.nullable(),
    contractType: contract145Schema.nullable(),
    atomicTargetCoreIntervals: z.array(samples),
    reviewEnvelope: samples.nullable(),
    unitUtilityRefs: z.array(hash),
  })
  .strict();
export const reviewTargets145Schema = reviewTargets144Schema
  .omit(reheaderKeys)
  .extend({
    ...header145Shape,
    artifactType: z.literal("machine-review-target-intervals-v7"),
    targets: z.array(reviewTarget145Schema),
    sourceArtifactHash: hash,
    safetyV5Hash: hash,
  })
  .strict();

export const reviewItem145Schema = reviewItem144Schema
  .safeExtend({
    coverageUnitIds: z.array(id),
    contractTypes: z.array(contract145Schema),
  })
  .strict();
export const reviewItems145Schema = reviewItems144Schema
  .omit(reheaderKeys)
  .extend({
    ...header145Shape,
    artifactType: z.literal("machine-review-items-v9"),
    items: z.array(reviewItem145Schema),
    sourceArtifactHash: hash,
    coverageTargetsHash: hash,
  })
  .strict();

export const reviewRegion145Schema = reviewRegion144Schema
  .safeExtend({
    coverageUnitIds: z.array(id),
    contractTypes: z.array(contract145Schema),
  })
  .strict();
export const reviewRegions145Schema = reviewRegions144Schema
  .omit(reheaderKeys)
  .extend({
    ...header145Shape,
    artifactType: z.literal("machine-review-regions-v8"),
    regions: z.array(reviewRegion145Schema),
    sourceArtifactHash: hash,
    coverageItemsHash: hash,
  })
  .strict();

const audioRow145Schema = reviewAudio144Schema.shape.audio.element
  .safeExtend({ coveredCoverageUnitIds: z.array(id) })
  .strict();
export const reviewAudio145Schema = reviewAudio144Schema
  .omit(reheaderKeys)
  .extend({
    ...header145Shape,
    artifactType: z.literal("machine-review-audio-manifest-v8"),
    audio: z.array(audioRow145Schema),
    sourceArtifactHash: hash,
    coverageRegionsHash: hash,
    coverageUnitAudioCoverageRatio: z.literal(1),
  })
  .strict();

const playbackSegment145Schema = reviewPlayback144Schema.shape.segments.element
  .safeExtend({ coverageUnitIds: z.array(id) })
  .strict();
export const reviewPlayback145Schema = reviewPlayback144Schema
  .omit(reheaderKeys)
  .extend({
    ...header145Shape,
    artifactType: z.literal("machine-review-playback-timeline-v7"),
    segments: z.array(playbackSegment145Schema),
    sourceArtifactHash: hash,
    coverageAudioManifestHash: hash,
    playbackToAudioCoverageRatio: z.literal(1),
    playbackToTargetCoverageRatio: z.literal(1),
    playbackToCoverageUnitRatio: z.literal(1),
  })
  .strict();

export const projectionLedger145Schema = z
  .object({
    ...header145Shape,
    artifactType: z.literal("machine-projection-hash-rebinding-ledger-v145"),
    sourceProjectionLedgerHash: hash,
    artifacts: z.array(
      z
        .object({
          artifactType: id,
          sourceArtifactHash: hash,
          projectedArtifactHash: hash,
          rowCount: count,
          sourceRowsVerified: count,
          projectedRowsRehashed: count,
          staleHashCount: z.literal(0),
        })
        .strict(),
    ),
    verifiedSourceRowCount: count,
    projectedRowCount: count,
    staleProjectionHashCount: z.literal(0),
    passed: z.literal(true),
  })
  .strict();

export const nestedPreflight145Schema = z
  .object({
    ...header145Shape,
    artifactType: z.literal("c6-0-1-14-5-nested-semantic-integrity-preflight"),
    verifiedArtifactHashes: z.array(hash),
    verifiedNestedRowCount: count,
    coverageUnitRowCount: count,
    utilityRowCount: count,
    realizationRowCount: count,
    jointFeasibilityRowCount: count,
    reviewDeliveryRowCount: count,
    projectionRowCount: count,
    nestedIntegrityFailures: z.literal(0),
    staleProjectionHashCount: z.literal(0),
    preGold: z.literal(true),
    passed: z.literal(true),
  })
  .strict();

export const freeze145Schema = z
  .object({
    ...header145Shape,
    artifactType: z.literal("c6-0-1-14-5-machine-safety-coverage-freeze"),
    productGoContract: productContract145Schema,
    contractPolicyHash: hash,
    baselineArtifactHashes: z.record(id, hash),
    geometryHashes: z.record(id, hash),
    coverageUnitHash: hash,
    unitUtilityHash: hash,
    realizationHash: hash,
    realizationDominanceHash: hash,
    jointFeasibilityHash: hash,
    plannerCertificateHash: hash,
    contractLedgerHash: hash,
    reviewDeliveryHashes: z.record(id, hash),
    projectionHashes: z.record(id, hash),
    nestedPreflightHash: hash,
    detectorReplaySummary: z
      .object({ expected: count, hits: count, misses: z.literal(0) })
      .strict(),
    asrReplaySummary: z
      .object({ expected: count, hits: count, misses: z.literal(0) })
      .strict(),
    runtimeGoldInputBeforeFreeze: z.literal(0),
    inferenceCount: z.literal(0),
    modelLoadCount: z.literal(0),
    providerProcessStartCount: z.literal(0),
    canonicalTextHash: hash,
    canonicalTimingHash: hash,
    presentationHash: hash,
    subtitleFileHashes: z.record(id, hash),
    freezeCompletedAt: z.iso.datetime(),
    finalRole: z.enum(["A", "B"]),
  })
  .strict();

export const firstGoldRead145Schema = z
  .object({
    ...header145Shape,
    artifactType: z.literal("c6-0-1-14-5-first-gold-read-audit"),
    machineFreezeHash: hash,
    machineFreezeCompletedAt: z.iso.datetime(),
    goldFirstReadAt: z.iso.datetime(),
    freezeBeforeGold: z.literal(true),
    machineStageGoldPathReadCount: z.literal(0),
    machineStageGoldDerivedArtifactReadCount: z.literal(0),
  })
  .strict();

const recall145Schema = z
  .object({ numerator: count, denominator: count, ratio })
  .strict();

export const evaluationProjection145Schema = z
  .object({
    projectionId: z.enum(["C0", "C1", "C2", "C3", "C4", "C5"]),
    name: id,
    integrityStatus: z.literal("PASS"),
    coverageUnitCount: count,
    selectedCoverageUnitCount: count,
    unitCoverageByTier: unitTierCounts145Schema,
    realizationCount: count,
    activeSafetyTargetCount: count,
    safetyCoreUnionSeconds: nonnegative,
    reviewTargetCount: count,
    reviewRegionCount: count,
    physicalAudioCount: count,
    playbackSegmentCount: count,
    fullQueueUniqueAudioSeconds: nonnegative,
    fullQueueEpisodeRatio: ratio,
    phaseAObligationCoverage: z.literal(1),
    phaseARegressionCount: z.literal(0),
    targetCoreLocalizationRecall: recall145Schema,
    machineAnchoredPlaybackAudibilityRecall: recall145Schema,
    missingInventoryRecall: recall145Schema,
    missingTargetRecall: recall145Schema,
    missingPhysicalAudioRecall: recall145Schema,
    missingPlaybackAnyOverlapRecall: recall145Schema,
    missingPlaybackAudibleRecall: recall145Schema,
    missingPlaybackFullRecall: recall145Schema,
    missingLocalizedLexicalRecall: recall145Schema,
    hallucinationTargetRecall: recall145Schema,
    hallucinationAudioRecall: recall145Schema,
    hallucinationPlaybackAudibleRecall: recall145Schema,
    semanticHash: hash,
  })
  .strict();

export const evaluationComponent145Schema = z
  .object({
    componentId: id,
    matchingCoverageUnitIds: z.array(id),
    unitCoreCoverageRatio: ratio,
    selectedRealizationIds: z.array(id),
    targetCoreCoverageRatio: ratio,
    machineAnchorOverlapSeconds: nonnegative,
    machineAnchorCoverageRatio: ratio,
    physicalPlaybackCoverageRatio: ratio,
    playbackCoverageOfUnitRatio: ratio,
    reviewEnvelopeSeconds: nonnegative,
    targetCoreContractStatus: z.enum(["PASS", "FAIL"]),
    anchoredPlaybackContractStatus: z.enum(["PASS", "FAIL"]),
    productGoContractStatus: z.enum(["PASS", "FAIL"]),
    baselineInventoryStatus: id,
    coverageUnitStatus: id,
    realizationStatus: id,
    plannerSelectionStatus: id,
    physicalAudioStatus: id,
    playbackStatus: id,
    lexicalStatus: id,
    bestStageReached: id,
    finalStageStatus: id,
    finalBlockingReason: id.nullable(),
    finalDiagnosis: id,
    semanticHash: hash,
  })
  .strict();

export const goldEvaluation145Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    policyVersion: version145Schema,
    policyHash: hash,
    sourceIdentity: c60114SourceIdentitySchema,
    sourceTimebase: z.literal("SOURCE_GLOBAL_NATIVE_SAMPLES"),
    visibility: z.literal("LOCAL_ONLY"),
    semanticHash: hash,
    artifactType: z.literal(
      "gold-c6-0-1-14-5-review-safety-contract-evaluation",
    ),
    runtimeGoldInputCount: count.positive(),
    firstGoldReadAuditHash: hash,
    machineFreezeHash: hash,
    productGoContract: productContract145Schema,
    projections: z.array(evaluationProjection145Schema).length(6),
    missingComponents: z.array(evaluationComponent145Schema),
    finalTargetCoreLocalizationRecall: recall145Schema,
    finalMachineAnchoredPlaybackAudibilityRecall: recall145Schema,
    finalHallucinationPlaybackAudibleRecall: recall145Schema,
    allMandatoryProductRecall: recall145Schema,
    allMandatoryTargetCoreRecall: recall145Schema,
    requiredItemCount: count,
    requiredRegionCount: count,
    requiredUniqueAudioSeconds: nonnegative,
    targetCoreLocalizationAdvisories: z.array(id),
    goldReadOnly: z.literal(true),
  })
  .strict();

export const routeName145Schema = z.enum([
  "GO_C6_0_1_15_REGION_RANKER_RECALIBRATION",
  "HOLD_FOR_COVERAGE_UNIT_SEGMENTATION_REPAIR",
  "HOLD_FOR_COVERAGE_UNIT_REALIZATION_REPAIR",
  "HOLD_FOR_COVERAGE_UNIT_SELECTION_REPAIR",
  "HOLD_FOR_SAFETY_BUDGET_MODEL_REDESIGN",
  "HOLD_FOR_PLANNER_SEARCH_COMPLETENESS",
  "HOLD_FOR_REVIEW_SAFETY_CONTRACT_DECISION",
  "HOLD_FOR_REVIEW_AUDIO_COVERAGE_REPAIR",
  "HOLD_FOR_EVALUATION_INTEGRITY_REPAIR",
  "HOLD_FOR_ENGINEERING_REPAIR",
]);

export const route145Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    policyVersion: version145Schema,
    policyHash: hash,
    sourceIdentity: c60114SourceIdentitySchema,
    sourceTimebase: z.literal("SOURCE_GLOBAL_NATIVE_SAMPLES"),
    visibility: z.literal("LOCAL_ONLY"),
    semanticHash: hash,
    artifactType: z.literal("c6-0-1-14-5-route-decision"),
    runtimeGoldInputCount: count.positive(),
    evaluationHash: hash,
    productGoContract: productContract145Schema,
    route: routeName145Schema,
    gates: z.array(z.object({ name: id, passed: z.boolean() }).strict()),
    advisories: z.array(id),
    blockingReasons: z.array(id),
    individuallyFeasibleUnselectedChildCount: count,
    individuallyFeasibleChildDiagnosticOnly: z.literal(true),
    forcedFeasibleUnselectedGateRemoved: z.literal(true),
    machineOnlyReleaseAuthorized: z.literal(false),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    c602Status: z.literal("HOLD"),
  })
  .strict();

export const parity145Schema = z
  .object({
    ...header145Shape,
    artifactType: z.literal("c6-0-1-14-5-final-ab-parity"),
    finalAFreezeHash: hash,
    finalBFreezeHash: hash,
    comparedFileCount: count,
    comparedJsonCount: count,
    comparedWavCount: count,
    byteParity: z.literal(true),
    semanticParity: z.literal(true),
    wavHashParity: z.literal(true),
    subtitleParity: z.literal(true),
    mismatches: z.array(id).length(0),
  })
  .strict();

export const validation145Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    policyVersion: version145Schema,
    policyHash: hash,
    sourceIdentity: c60114SourceIdentitySchema,
    sourceTimebase: z.literal("SOURCE_GLOBAL_NATIVE_SAMPLES"),
    visibility: z.literal("LOCAL_ONLY"),
    semanticHash: hash,
    artifactType: z.literal("c6-0-1-14-5-validation"),
    runtimeGoldInputCount: count,
    machineFreezeHash: hash,
    evaluationHash: hash,
    routeHash: hash,
    parityHash: hash,
    schemaValidationPassed: z.literal(true),
    nestedIntegrityPassed: z.literal(true),
    replayOnlyPassed: z.literal(true),
    detectorCacheMissCount: z.literal(0),
    asrCacheMissCount: z.literal(0),
    inferenceCount: z.literal(0),
    modelLoadCount: z.literal(0),
    providerProcessStartCount: z.literal(0),
    canonicalTextMutationCount: z.literal(0),
    canonicalTimingMutationCount: z.literal(0),
    presentationMutationCount: z.literal(0),
    datasetHardcodingCount: z.literal(0),
    testResults: z.array(
      z.object({ name: id, passed: z.boolean(), detail: z.string() }).strict(),
    ),
    passed: z.boolean(),
  })
  .strict();

export const c601145CoverageSchemas = {
  "c6-0-1-14-5-safety-coverage-unit-policy": policy145Schema,
  "machine-segmentation-sensitivity-audit": segmentationAudit145Schema,
  "machine-speech-safety-coverage-units-v1": coverageUnits145Schema,
  "machine-speech-safety-coverage-unit-utility-v1": unitUtility145Schema,
  "machine-review-safety-contract-policy-v1": contractPolicy145Schema,
  "machine-coverage-unit-realization-candidates-v1": realizations145Schema,
  "machine-coverage-unit-realization-dominance-ledger":
    realizationDominance145Schema,
  "machine-coverage-unit-joint-feasibility-results": jointFeasibility145Schema,
  "machine-coverage-unit-aware-final-planner-certificate": planner145Schema,
  "machine-review-safety-contract-coverage-ledger": contractLedger145Schema,
  "machine-missing-safety-reserve-targets-v5": safetyTargets145Schema,
  "machine-review-target-intervals-v7": reviewTargets145Schema,
  "machine-review-items-v9": reviewItems145Schema,
  "machine-review-regions-v8": reviewRegions145Schema,
  "machine-review-audio-manifest-v8": reviewAudio145Schema,
  "machine-review-playback-timeline-v7": reviewPlayback145Schema,
  "machine-projection-hash-rebinding-ledger-v145": projectionLedger145Schema,
  "c6-0-1-14-5-nested-semantic-integrity-preflight": nestedPreflight145Schema,
  "c6-0-1-14-5-machine-safety-coverage-freeze": freeze145Schema,
  "c6-0-1-14-5-first-gold-read-audit": firstGoldRead145Schema,
  "gold-c6-0-1-14-5-review-safety-contract-evaluation": goldEvaluation145Schema,
  "c6-0-1-14-5-route-decision": route145Schema,
  "c6-0-1-14-5-final-ab-parity": parity145Schema,
  "c6-0-1-14-5-validation": validation145Schema,
};

export type Policy145 = z.infer<typeof policy145Schema>;
export type SegmentationAudit145 = z.infer<typeof segmentationAudit145Schema>;
export type CoverageUnit145 = z.infer<typeof coverageUnit145Schema>;
export type CoverageUnits145 = z.infer<typeof coverageUnits145Schema>;
export type UnitUtilityRow145 = z.infer<typeof unitUtilityRow145Schema>;
export type UnitUtility145 = z.infer<typeof unitUtility145Schema>;
export type Contract145 = z.infer<typeof contract145Schema>;
export type ContractPolicy145 = z.infer<typeof contractPolicy145Schema>;
export type Realization145 = z.infer<typeof realization145Schema>;
export type Realizations145 = z.infer<typeof realizations145Schema>;
export type RealizationDominance145 = z.infer<
  typeof realizationDominance145Schema
>;
export type JointFeasibility145 = z.infer<typeof jointFeasibility145Schema>;
export type Planner145 = z.infer<typeof planner145Schema>;
export type ContractLedger145 = z.infer<typeof contractLedger145Schema>;
export type SafetyTargets145 = z.infer<typeof safetyTargets145Schema>;
export type ReviewTargets145 = z.infer<typeof reviewTargets145Schema>;
export type ReviewItems145 = z.infer<typeof reviewItems145Schema>;
export type ReviewRegions145 = z.infer<typeof reviewRegions145Schema>;
export type ReviewAudio145 = z.infer<typeof reviewAudio145Schema>;
export type ReviewPlayback145 = z.infer<typeof reviewPlayback145Schema>;
export type ProjectionLedger145 = z.infer<typeof projectionLedger145Schema>;
export type NestedPreflight145 = z.infer<typeof nestedPreflight145Schema>;
export type Freeze145 = z.infer<typeof freeze145Schema>;
export type GoldEvaluation145 = z.infer<typeof goldEvaluation145Schema>;
export type Route145 = z.infer<typeof route145Schema>;
export type Validation145 = z.infer<typeof validation145Schema>;

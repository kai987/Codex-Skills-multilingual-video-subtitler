import { z } from "zod";
import { c60114SourceIdentitySchema } from "./c6-0-1-14-evidence-schemas.js";
import { c601141SampleIntervalSchema as samples } from "./c6-0-1-14-1-speech-inventory-schemas.js";
import {
  hash142Schema as hash,
  id142Schema as id,
  count142Schema as count,
  family142Schema as family,
  stratum142Schema as stratum,
} from "./c6-0-1-14-2-selection-detector-schemas.js";
import {
  target143Schema,
  item143Schema,
  region143Schema,
  targets143Schema,
  items143Schema,
  regions143Schema,
  audio143Schema,
  playback143Schema,
} from "./c6-0-1-14-3-review-schemas.js";

export const version144Schema = z.literal(
  "c6.0.1.14.4-machine-evidence-utility-selection-v1",
);
const nonnegative = z.number().nonnegative();
const ratio = z.number().min(0).max(1);
const integer = z.number().int();
const vector = z.array(integer);
const tier144Schema = z.enum([
  "TIER_5_VERIFIED_MULTI_FAMILY_SPEECH",
  "TIER_4_VERIFIED_INDEPENDENT_EXCLUSIVE_SPEECH",
  "TIER_3_VERIFIED_SINGLE_FAMILY_SPEECH",
  "TIER_2_MASKED_OR_SUBTHRESHOLD_SPEECH",
  "TIER_1_AUDIT_ONLY_SPEECH_CANDIDATE",
  "TIER_0_INELIGIBLE_OR_CONTRADICTED",
]);
const tierCoverage144Schema = z
  .object({
    TIER_5_VERIFIED_MULTI_FAMILY_SPEECH: count,
    TIER_4_VERIFIED_INDEPENDENT_EXCLUSIVE_SPEECH: count,
    TIER_3_VERIFIED_SINGLE_FAMILY_SPEECH: count,
    TIER_2_MASKED_OR_SUBTHRESHOLD_SPEECH: count,
    TIER_1_AUDIT_ONLY_SPEECH_CANDIDATE: count,
    TIER_0_INELIGIBLE_OR_CONTRADICTED: count,
  })
  .strict();
export const header144Shape = {
  schemaVersion: z.literal("1.0.0"),
  policyVersion: version144Schema,
  policyHash: hash,
  sourceIdentity: c60114SourceIdentitySchema,
  sourceTimebase: z.literal("SOURCE_GLOBAL_NATIVE_SAMPLES"),
  runtimeGoldInputCount: z.literal(0),
  visibility: z.literal("LOCAL_ONLY"),
  semanticHash: hash,
};

export const utilityPolicy144Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    policyVersion: version144Schema,
    artifactType: z.literal("c6-0-1-14-4-machine-evidence-utility-policy"),
    executionPolicy: z.literal("replay-only"),
    mode: z.literal("REPLAY_ONLY_UTILITY_AND_SELECTION_REPAIR"),
    maximumInferenceCount: z.literal(0),
    maximumModelLoadCount: z.literal(0),
    maximumProviderProcessStartCount: z.literal(0),
    maximumActiveSafetyBundles: z.literal(24),
    maximumSpeechCoreUnionSeconds: z.literal(60),
    maximumFullQueueEpisodeRatio: z.literal(0.95),
    forcedInclusionMaximumChildren: z.literal(32),
    maximumSearchStates: z.literal(5_000_000),
    durationBucketsSeconds: z.tuple([
      z.literal(0.2),
      z.literal(0.5),
      z.literal(1),
      z.literal(2),
      z.literal(4),
    ]),
    durationUtilityCap: z.literal(5),
    evidenceStratumOrder: z.tuple([
      z.literal("AUDIT_ONLY"),
      z.literal("MASKED_SUBTHRESHOLD"),
      z.literal("MULTI_VIEW_SAME_DETECTOR"),
      z.literal("PYANNOTE_EXCLUSIVE"),
      z.literal("SILERO_EXCLUSIVE"),
      z.literal("WEBRTC_EXCLUSIVE"),
      z.literal("LEGACY_FINGERPRINT_EXCLUSIVE"),
      z.literal("MULTI_DETECTOR"),
      z.literal("EXISTING_VERIFIED"),
    ]),
    posteriorSupportClasses: z.tuple([
      z.literal("POSTERIOR_UNAVAILABLE"),
      z.literal("POSTERIOR_LOW"),
      z.literal("POSTERIOR_MEDIUM"),
      z.literal("POSTERIOR_HIGH"),
    ]),
    speechEvidenceTiers: z.array(tier144Schema).length(6),
    independentFamilySemantics: z.literal(
      "ONE_VOTE_PER_DETECTOR_OR_LEGACY_CORRELATION_FAMILY",
    ),
    sameDetectorViewProfileDeduplicated: z.literal(true),
    webRtcBinaryNotProbability: z.literal(true),
    sourceTimeUtilityFeatureAllowed: z.literal(false),
    sourceTimeFinalTieBreakOnly: z.literal(true),
    rawRecognizedTextAllowed: z.literal(false),
    goldFeaturesAllowed: z.literal(false),
    reviewSafetyPrimarySignal: z.literal("SPEECH_EVIDENCE_UTILITY"),
    textCandidateSignalOrder: z.literal("LOWER_ORDER_AUXILIARY"),
    contradictionGate: z.literal("INELIGIBLE"),
    fullyProtectedCoverageGate: z.literal("AUDIT_ONLY"),
    plannerObjectives: z.tuple([
      z.literal("HARD_PHASE_A_OBLIGATION_COVERAGE"),
      z.literal("TIER_5_OPTIONAL_REVIEW_UTILITY"),
      z.literal("TIER_4_OPTIONAL_REVIEW_UTILITY"),
      z.literal("TIER_3_OPTIONAL_REVIEW_UTILITY"),
      z.literal("HIGH_TIER_OPTIONAL_CHILD_COUNT_AND_CAPPED_COVERAGE"),
      z.literal("INDEPENDENT_FAMILY_AND_STRATUM_BREADTH"),
      z.literal("TIMELINE_AND_SCENE_DIVERSITY"),
      z.literal("TEXT_CANDIDATE_UTILITY"),
      z.literal("LOW_TIER_CAPPED_COVERAGE"),
      z.literal("MINIMUM_ACTIVE_BUNDLE_COUNT"),
      z.literal("MINIMUM_SPEECH_CORE_UNION"),
      z.literal("MINIMUM_INCREMENTAL_AUDIO"),
      z.literal("MINIMUM_INTERNAL_SILENCE"),
      z.literal("SOURCE_NATIVE_START_AND_STABLE_ID_TIE_BREAK"),
    ]),
    routeDecisionOrder: z.tuple([
      z.literal("INTEGRITY"),
      z.literal("UTILITY_PROPAGATION"),
      z.literal("MONOTONICITY"),
      z.literal("SEARCH_COMPLETENESS"),
      z.literal("FEASIBILITY"),
      z.literal("TARGET_SELECTION"),
      z.literal("REVIEW_AUDIO"),
      z.literal("QUALITY_GATE"),
    ]),
    rankerRetrained: z.literal(false),
    newOofRun: z.literal(false),
    canonicalMutationAllowed: z.literal(false),
    semanticHash: hash,
  })
  .strict();

const rootCause144Schema = z.enum([
  "NO_TEXT_CANDIDATE_PRIORITY_SOURCE",
  "CANDIDATE_TO_ATOM_ASSOCIATION_LOSS",
  "SPEECH_EVIDENCE_NOT_INCLUDED_IN_PRIORITY",
  "CORRELATED_EVIDENCE_DEDUP_FAILURE",
  "PRIORITY_NOT_PROPAGATED_TO_CHILD",
  "PRIORITY_NOT_PROPAGATED_TO_BUNDLE",
  "PLANNER_OBJECTIVE_PRIORITY_DOMINATED",
  "RAW_DURATION_OBJECTIVE_SATURATED",
  "ALL_ZERO_SENTINEL_PROPAGATION",
  "UNKNOWN",
]);
export const pathologyAudit144Schema = z
  .object({
    ...header144Shape,
    artifactType: z.literal("machine-evidence-utility-pathology-audit"),
    candidateArtifactHash: hash,
    hierarchyHash: hash,
    bundleArtifactHash: hash,
    plannerCertificateHash: hash,
    candidateCount: count,
    candidatePriorityNonzeroCount: count,
    candidatePriorityZeroCount: count,
    positiveSpeechCandidateCount: count,
    atomCount: count,
    positiveEvidenceAtomCount: count,
    atomWithAssociatedCandidateCount: count,
    atomWithoutAssociatedCandidateCount: count,
    atomMachinePriorityNonzeroCount: count,
    positiveAtomWithZeroPriorityCount: count,
    childCount: count,
    eligibleChildCount: count,
    eligibleChildMachinePriorityNonzeroCount: count,
    eligibleChildZeroPriorityCount: count,
    bundleCount: count,
    eligibleBundleCount: count,
    eligibleBundleMachinePriorityNonzeroCount: count,
    eligibleBundleZeroPriorityCount: count,
    selectedBundleCount: count,
    selectedBundleMachinePrioritySum: z.number(),
    plannerMachinePriorityObjectiveValue: z.number(),
    allZeroPriorityAtAtomLayer: z.boolean(),
    allZeroPriorityAtChildLayer: z.boolean(),
    allZeroPriorityAtBundleLayer: z.boolean(),
    rawDurationObjectiveSaturated: z.boolean(),
    rootCauseClassifications: z.array(rootCause144Schema).min(1),
    goldReadAttempted: z.literal(false),
  })
  .strict();

export const geometryFreeze144Schema = z
  .object({
    ...header144Shape,
    artifactType: z.literal("c6-0-1-14-4-geometry-freeze"),
    inventoryHash: hash,
    candidatesHash: hash,
    obligationsHash: hash,
    hierarchyHash: hash,
    bundlesHash: hash,
    dominanceHash: hash,
    immutableTargetsHash: hash,
    sourceWorkspaceAudioHash: hash,
    sourcePlaybackHash: hash,
    subtitleFileHashes: z.record(id, hash),
    geometryMutationCount: z.literal(0),
    capturedAt: z.iso.datetime(),
    goldReadAttempted: z.literal(false),
  })
  .strict();

const posteriorClass144Schema = z.enum([
  "POSTERIOR_UNAVAILABLE",
  "POSTERIOR_LOW",
  "POSTERIOR_MEDIUM",
  "POSTERIOR_HIGH",
]);
const uncoveredClass144Schema = z.enum([
  "FULLY_PROTECTED",
  "PARTIALLY_UNCOVERED",
  "FULLY_UNCOVERED",
]);
const durationBucket144Schema = z.enum([
  "LT_020",
  "FROM_020_TO_050",
  "FROM_050_TO_100",
  "FROM_100_TO_200",
  "FROM_200_TO_400",
  "GTE_400_CAPPED",
]);
const textClass144Schema = z.enum([
  "NO_LOCALIZED_TEXT_CANDIDATE",
  "SINGLE_PROVIDER_LOCALIZED",
  "MULTI_PROVIDER_DISAGREEMENT",
  "PRONUNCIATION_AGREEMENT",
  "CROSS_MODEL_LOCALIZED_AGREEMENT",
]);
export const atomUtilityRow144Schema = z
  .object({
    atomId: id,
    sourceAtomHash: hash,
    verifiedTimebase: z.boolean(),
    eligibleEvidence: z.boolean(),
    strongContradiction: z.boolean(),
    detectorFamilies: z.array(family),
    independentEvidenceFamilies: z.array(id),
    evidenceStrata: z.array(stratum),
    distinctPcmViewCount: count,
    posteriorSupportClass: posteriorClass144Schema,
    uncoveredCoverageClass: uncoveredClass144Schema,
    durationBucket: durationBucket144Schema,
    detectorExclusiveNovelty: z.boolean(),
    textCandidateAvailability: z.boolean(),
    textCandidateClass: textClass144Schema,
    textCandidateProviderCount: count,
    speechEvidenceTier: tier144Schema,
    speechEvidenceUtilityVector: vector,
    textCandidateUtilityVector: vector,
    reviewSafetyUtilityVector: vector,
    utilityEligibility: z.boolean(),
    utilityReasons: z.array(id).min(1),
    featureHash: hash,
    semanticHash: hash,
  })
  .strict();
export const atomUtility144Schema = z
  .object({
    ...header144Shape,
    artifactType: z.literal("machine-evidence-atom-utility-v1"),
    hierarchyHash: hash,
    lexicalArtifactHash: hash,
    rows: z.array(atomUtilityRow144Schema),
    rowCount: count,
    positiveEvidenceAtomCount: count,
    nonzeroSpeechUtilityCount: count,
    positiveEvidenceZeroUtilityCount: z.literal(0),
    tierCounts: tierCoverage144Schema,
  })
  .strict()
  .superRefine((value, context) => {
    const eligible = value.rows.filter((row) => row.utilityEligibility);
    const nonzeroRows = value.rows.filter((row) =>
      row.speechEvidenceUtilityVector.some((entry) => entry !== 0),
    );
    if (
      value.rowCount !== value.rows.length ||
      value.positiveEvidenceAtomCount !== eligible.length ||
      value.nonzeroSpeechUtilityCount !== nonzeroRows.length ||
      eligible.some(
        (row) =>
          !row.speechEvidenceUtilityVector.some((entry) => entry !== 0) ||
          !row.reviewSafetyUtilityVector.some((entry) => entry !== 0),
      )
    )
      context.addIssue({
        code: "custom",
        message: "positive eligible atom utility must be nonzero and counted",
      });
  });

export const childUtilityRow144Schema = z
  .object({
    childUnitId: id,
    sourceChildHash: hash,
    memberAtomIds: z.array(id).min(1),
    memberAtomUtilityHashes: z.array(hash).min(1),
    speechEvidenceTierCounts: tierCoverage144Schema,
    highestSpeechEvidenceTier: tier144Schema,
    independentDetectorFamilies: z.array(id),
    evidenceStrata: z.array(stratum),
    verifiedSpeechCoreIntervals: z.array(samples),
    verifiedSpeechCoreUnionSeconds: nonnegative,
    cappedDurationUtility: count.max(5),
    detectorExclusiveNovelty: z.boolean(),
    speechEvidenceUtilityVector: vector,
    textCandidateUtilityVector: vector,
    reviewSafetyUtilityVector: vector,
    utilityEligibility: z.boolean(),
    utilityReasons: z.array(id).min(1),
    semanticHash: hash,
  })
  .strict();
export const childUtility144Schema = z
  .object({
    ...header144Shape,
    artifactType: z.literal("machine-selectable-child-utility-v1"),
    hierarchyHash: hash,
    atomUtilityHash: hash,
    rows: z.array(childUtilityRow144Schema),
    rowCount: count,
    eligibleChildCount: count,
    nonzeroEligibleChildUtilityCount: count,
    eligibleChildZeroUtilityCount: z.literal(0),
    durationCappedChildCount: count,
  })
  .strict()
  .superRefine((value, context) => {
    const eligible = value.rows.filter((row) => row.utilityEligibility);
    if (
      value.rowCount !== value.rows.length ||
      value.eligibleChildCount !== eligible.length ||
      value.nonzeroEligibleChildUtilityCount !== eligible.length ||
      eligible.some(
        (row) => !row.reviewSafetyUtilityVector.some((entry) => entry !== 0),
      )
    )
      context.addIssue({
        code: "custom",
        message:
          "eligible child review-safety utility must be nonzero and counted",
      });
  });

export const bundleUtilityRow144Schema = z
  .object({
    bundleId: id,
    sourceBundleHash: hash,
    childUnitIds: z.array(id).min(1),
    childUtilityHashes: z.array(hash).min(1),
    coveredObligationIds: z.array(id),
    optionalChildIds: z.array(id),
    speechEvidenceTierCounts: tierCoverage144Schema,
    independentDetectorFamilies: z.array(id),
    evidenceStrata: z.array(stratum),
    optionalSpeechCoreIntervals: z.array(samples),
    optionalSpeechCoreUnionSeconds: nonnegative,
    cappedOptionalDurationUtility: count,
    detectorExclusiveNovelty: z.boolean(),
    timelineNovelty: count,
    sceneNovelty: count,
    speechEvidenceUtilityVector: vector,
    textCandidateUtilityVector: vector,
    reviewSafetyUtilityVector: vector,
    optionalReviewSafetyUtilityVector: vector,
    targetSlotCost: z.literal(1),
    coreCostSamples: count,
    predictedAudioCostSamples: count,
    internalSilenceCostSamples: count,
    utilityReasons: z.array(id).min(1),
    semanticHash: hash,
  })
  .strict();
export const bundleUtility144Schema = z
  .object({
    ...header144Shape,
    artifactType: z.literal("machine-target-bundle-utility-v1"),
    bundlesHash: hash,
    childUtilityHash: hash,
    rows: z.array(bundleUtilityRow144Schema),
    rowCount: count,
    eligibleBundleCount: count,
    nonzeroEligibleBundleUtilityCount: count,
    eligibleOptionalBundleZeroUtilityCount: z.literal(0),
  })
  .strict();

export const propagationRow144Schema = z
  .object({
    propagationId: id,
    evidenceObservationIds: z.array(id),
    atomId: id,
    atomUtilityHash: hash,
    childUnitId: id,
    childUtilityHash: hash,
    bundleIds: z.array(id),
    bundleUtilityHashes: z.array(hash),
    independentFamilyDedup: count,
    durationDedup: count,
    tierPropagation: z.boolean(),
    textUtilityPropagation: z.boolean(),
    reviewSafetyPropagation: z.boolean(),
    zeroedAtStage: z.enum(["NONE", "ATOM", "CHILD", "BUNDLE", "PLANNER"]),
    zeroReason: id.nullable(),
    finalPlannerConsumption: z.boolean(),
    semanticHash: hash,
  })
  .strict();
export const propagation144Schema = z
  .object({
    ...header144Shape,
    artifactType: z.literal("machine-evidence-utility-propagation-ledger"),
    atomUtilityHash: hash,
    childUtilityHash: hash,
    bundleUtilityHash: hash,
    plannerCertificateHash: hash.nullable(),
    entries: z.array(propagationRow144Schema),
    positiveEvidenceRows: count,
    atomUtilityProduced: count,
    childUtilityProduced: count,
    bundleUtilityProduced: count,
    plannerUtilityConsumed: count,
    explicitGeometryDropCount: count,
    silentUtilityLossCount: z.literal(0),
    droppedBetweenEvidenceAndAtom: z.literal(0),
    droppedBetweenAtomAndChild: z.literal(0),
    droppedBetweenChildAndBundle: z.literal(0),
    droppedBetweenBundleAndPlanner: z.literal(0),
  })
  .strict();

const feasibility144Schema = z.enum([
  "FEASIBLE",
  "INFEASIBLE_PROVEN",
  "SEARCH_INCOMPLETE",
  "NOT_EVALUATED",
]);
export const forcedInclusionRow144Schema = z
  .object({
    childUnitId: id,
    utilityRank: count.positive(),
    utilityTier: tier144Schema,
    searchComplete: z.boolean(),
    feasibility: feasibility144Schema,
    exploredStateCount: count,
    prunedStateCount: count,
    selectedBundleIds: z.array(id),
    selectedChildIds: z.array(id),
    counterfactualReplacementBundleIds: z.array(id),
    counterfactualObjectiveDelta: vector,
    obligationCoveragePreserved: z.boolean(),
    hardConstraintsPreserved: z.boolean(),
    semanticHash: hash,
  })
  .strict();
export const forcedInclusion144Schema = z
  .object({
    ...header144Shape,
    artifactType: z.literal("machine-forced-inclusion-planner-results"),
    utilityPolicyHash: hash,
    bundleUtilityHash: hash,
    evaluatedChildren: z.array(forcedInclusionRow144Schema).max(32),
    evaluatedCount: count.max(32),
    feasibleCount: count,
    infeasibleCount: count,
    searchIncompleteCount: count,
    goldReadAttempted: z.literal(false),
  })
  .strict();

export const optionalChildRow144Schema = z
  .object({
    childUnitId: id,
    sourceChildHash: hash,
    utilityTier: tier144Schema,
    speechEvidenceUtilityVector: vector,
    reviewSafetyUtilityVector: vector,
    eligibleBundleIds: z.array(id),
    minimumTargetSlotCost: count,
    minimumCoreCostSamples: count,
    minimumAudioCostSamples: count,
    baselineSelected: z.boolean(),
    utilityPlannerSelected: z.boolean(),
    selectedBundleId: id.nullable(),
    utilityRank: count.positive(),
    unselectedReason: id.nullable(),
    forcedInclusionEvaluated: z.boolean(),
    forcedInclusionFeasibility: feasibility144Schema,
    forcedInclusionSearchComplete: z.boolean(),
    counterfactualReplacementBundleIds: z.array(id),
    counterfactualObjectiveDelta: vector,
    obligationCoveragePreserved: z.boolean(),
    semanticHash: hash,
  })
  .strict();
export const optionalChildLedger144Schema = z
  .object({
    ...header144Shape,
    artifactType: z.literal("machine-optional-speech-child-coverage-ledger"),
    hierarchyHash: hash,
    bundleUtilityHash: hash,
    forcedInclusionHash: hash,
    baselinePlannerHash: hash,
    utilityPlannerHash: hash.nullable(),
    entries: z.array(optionalChildRow144Schema),
    optionalChildCount: count,
    highTierOptionalChildCount: count,
    selectedOptionalChildCount: count,
    remainingHighUtilityUnselectedCount: count,
  })
  .strict();

export const planner144Schema = z
  .object({
    ...header144Shape,
    artifactType: z.literal("machine-utility-aware-final-planner-certificate"),
    plannerVersion: z.literal("DETERMINISTIC_UTILITY_NATIVE_SET_COVER_BNB_V2"),
    sourcePlannerHash: hash,
    utilityPolicyHash: hash,
    atomUtilityHash: hash,
    childUtilityHash: hash,
    bundleUtilityHash: hash,
    optionalCoverageLedgerHash: hash.nullable(),
    obligationsHash: hash,
    candidatesHash: hash,
    dominanceHash: hash,
    candidateCount: count,
    candidateCountAfterPruning: count,
    hardConstraintCount: count,
    obligationCount: count,
    exploredStateCount: count,
    prunedStateCount: count,
    searchStateLimit: count.positive(),
    searchComplete: z.boolean(),
    feasibilityStatus: feasibility144Schema.exclude(["NOT_EVALUATED"]),
    oldPlanFeasible: z.boolean(),
    oldPlanObjectiveVector: vector,
    finalObjectiveVector: vector,
    objectiveNonDegradation: z.boolean(),
    selectedBundleIds: z.array(id),
    selectedChildIds: z.array(id),
    selectedOptionalChildIds: z.array(id),
    selectedTierCounts: tierCoverage144Schema,
    activeBundleCount: count.max(24),
    coreUnionSeconds: nonnegative.max(60),
    predictedFullQueueSeconds: nonnegative,
    predictedFullQueueEpisodeRatio: ratio,
    obligationCoverageRatio: z.literal(1),
    droppedObligationCount: z.literal(0),
    deterministicTieBreakHash: hash,
    admissibleBoundMethod: z.literal(
      "SUFFIX_COMPONENTWISE_UTILITY_UPPER_BOUND",
    ),
    feasibilityWitnessVerified: z.boolean(),
    hardConstraintResults: z.array(
      z.object({ name: id, passed: z.boolean() }).strict(),
    ),
    diagnosticReasons: z.array(id),
  })
  .strict();

export const planComparison144Schema = z
  .object({
    ...header144Shape,
    artifactType: z.literal("machine-utility-plan-comparison"),
    oldPlannerHash: hash,
    newPlannerHash: hash,
    oldSelectedBundleIds: z.array(id),
    newSelectedBundleIds: z.array(id),
    retainedBundleIds: z.array(id),
    removedBundleIds: z.array(id),
    addedBundleIds: z.array(id),
    retainedChildIds: z.array(id),
    removedChildIds: z.array(id),
    addedChildIds: z.array(id),
    obligationCoverageBefore: ratio,
    obligationCoverageAfter: ratio,
    phaseARegressionBefore: count,
    phaseARegressionAfter: count,
    utilityTierCoverageBefore: tierCoverage144Schema,
    utilityTierCoverageAfter: tierCoverage144Schema,
    independentFamilyCoverageBefore: count,
    independentFamilyCoverageAfter: count,
    optionalCoreCoverageBefore: nonnegative,
    optionalCoreCoverageAfter: nonnegative,
    targetCountBefore: count,
    targetCountAfter: count,
    coreUnionBefore: nonnegative,
    coreUnionAfter: nonnegative,
    predictedAudioBefore: nonnegative,
    predictedAudioAfter: nonnegative,
    objectiveBefore: vector,
    objectiveAfter: vector,
    objectiveNonDegradation: z.boolean(),
  })
  .strict();

export const safetyTarget144Schema = z
  .object({
    targetId: id,
    bundleId: id,
    childUnitIds: z.array(id).min(1),
    atomicCoreIntervals: z.array(samples).min(1),
    speechCoreUnionSeconds: nonnegative,
    reviewEnvelope: samples,
    internalSilenceIntervals: z.array(samples),
    obligationIds: z.array(id),
    optionalChildIds: z.array(id),
    atomUtilityRefs: z.array(hash),
    childUtilityRefs: z.array(hash).min(1),
    bundleUtilityRef: hash,
    speechEvidenceTierCounts: tierCoverage144Schema,
    reviewSafetyUtilityVector: vector,
    textCandidateUtilityVector: vector,
    plannerCertificateId: hash,
    selectionReason: id,
    sourceIdentity: c60114SourceIdentitySchema,
    audioRequired: z.literal(true),
    requiredLevel: z.literal("RECOMMENDED"),
    canonicalInsertAllowed: z.literal(false),
    semanticHash: hash,
  })
  .strict();
export const safetyTargets144Schema = z
  .object({
    ...header144Shape,
    artifactType: z.literal("machine-missing-safety-reserve-targets-v4"),
    sourceSafetyTargetsHash: hash,
    plannerCertificateHash: hash,
    atomUtilityHash: hash,
    childUtilityHash: hash,
    bundleUtilityHash: hash,
    targets: z.array(safetyTarget144Schema).max(24),
    retainedTargetIds: z.array(id),
    removedTargetIds: z.array(id),
    replacedByTargetIds: z.record(id, z.array(id)),
    activeTargetCount: count.max(24),
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
export const reviewTarget144Schema = target143Schema
  .safeExtend({
    atomUtilityRefs: z.array(hash),
    childUtilityRefs: z.array(hash),
    bundleUtilityRef: hash.nullable(),
  })
  .strict();
export const reviewTargets144Schema = targets143Schema
  .omit(reheaderKeys)
  .extend({
    ...header144Shape,
    artifactType: z.literal("machine-review-target-intervals-v6"),
    targets: z.array(reviewTarget144Schema),
    sourceArtifactHash: hash,
    safetyV4Hash: hash,
  })
  .strict();
export const reviewItem144Schema = item143Schema
  .safeExtend({ utilityTargetHashes: z.array(hash) })
  .strict();
export const reviewItems144Schema = items143Schema
  .omit(reheaderKeys)
  .extend({
    ...header144Shape,
    artifactType: z.literal("machine-review-items-v8"),
    items: z.array(reviewItem144Schema),
    sourceArtifactHash: hash,
    utilityTargetsHash: hash,
  })
  .strict();
export const reviewRegion144Schema = region143Schema
  .safeExtend({ utilityTargetHashes: z.array(hash) })
  .strict();
export const reviewRegions144Schema = regions143Schema
  .omit(reheaderKeys)
  .extend({
    ...header144Shape,
    artifactType: z.literal("machine-review-regions-v7"),
    regions: z.array(reviewRegion144Schema),
    sourceArtifactHash: hash,
    utilityItemsHash: hash,
  })
  .strict();
export const reviewAudio144Schema = audio143Schema
  .omit(reheaderKeys)
  .extend({
    ...header144Shape,
    artifactType: z.literal("machine-review-audio-manifest-v7"),
    sourceArtifactHash: hash,
    utilityRegionsHash: hash,
    plannedAudioCount: count,
    actualAudioCount: count,
    playableAudioCount: count,
    hashVerifiedAudioCount: count,
    audioExtractionFailureCount: count,
  })
  .strict();
export const reviewPlayback144Schema = playback143Schema
  .omit(reheaderKeys)
  .extend({
    ...header144Shape,
    artifactType: z.literal("machine-review-playback-timeline-v6"),
    sourceArtifactHash: hash,
    utilityAudioManifestHash: hash,
    playbackToAudioCoverageRatio: z.literal(1),
    playbackToTargetCoverageRatio: z.literal(1),
  })
  .strict();

export const nestedPreflight144Schema = z
  .object({
    ...header144Shape,
    artifactType: z.literal("c6-0-1-14-4-nested-semantic-integrity-preflight"),
    sourceProjectionPreflightHash: hash,
    verifiedArtifactHashes: z.array(hash),
    verifiedNestedRowCount: count,
    utilityRowCount: count,
    reviewDeliveryRowCount: count,
    projectionRowCount: count,
    nestedIntegrityFailures: z.literal(0),
    staleProjectionHashCount: z.literal(0),
    preGold: z.literal(true),
    passed: z.literal(true),
  })
  .strict();

export const freeze144Schema = z
  .object({
    ...header144Shape,
    artifactType: z.literal("c6-0-1-14-4-machine-utility-selection-freeze"),
    baselineArtifactHashes: z.record(id, hash),
    geometryHashes: z.record(id, hash),
    utilityArtifactHashes: z.record(id, hash),
    plannerCertificateHash: hash,
    planComparisonHash: hash,
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
    freezeCompletedAt: z.iso.datetime(),
    finalRole: z.enum(["A", "B"]),
  })
  .strict();

export const preGoldEngineering144Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    policyVersion: version144Schema,
    visibility: z.literal("LOCAL_ONLY"),
    artifactType: z.literal("c6-0-1-14-4-pre-gold-engineering-validation"),
    codeSnapshotHash: hash,
    checks: z.array(
      z
        .object({
          name: id,
          passed: z.boolean(),
          command: z.string().min(1),
          logRelativePath: z.string().min(1),
          logSha256: hash,
        })
        .strict(),
    ),
    passed: z.literal(true),
    networkUsed: z.literal(false),
    modelInferenceCount: z.literal(0),
    semanticHash: hash,
  })
  .strict();

export const firstGoldRead144Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    policyVersion: version144Schema,
    visibility: z.literal("LOCAL_ONLY_GOLD_EVALUATION"),
    artifactType: z.literal("c6-0-1-14-4-first-gold-read-audit"),
    machineFreezeHash: hash,
    machineFreezeCompletedAt: z.iso.datetime(),
    goldFirstReadAt: z.iso.datetime(),
    freezeBeforeGold: z.literal(true),
    machineStageGoldPathReadCount: z.literal(0),
    machineStageGoldDerivedArtifactReadCount: z.literal(0),
    semanticHash: hash,
  })
  .strict();

const recall144Schema = z
  .object({ numerator: count, denominator: count, ratio })
  .strict();
const coverageStatus144Schema = z.enum([
  "FULL",
  "AUDIBLE",
  "MAJORITY",
  "PARTIAL",
  "NO_OVERLAP",
  "INTEGRITY_FAILED",
  "GOLD_MAPPING_UNRESOLVED",
  "NOT_A_PLAYBACK_RECALL_METRIC",
]);
const diagnosis144Schema = z.enum([
  "BASELINE_ALREADY_AUDIBLE",
  "PRESERVED_BY_UTILITY_PLANNER",
  "RECOVERED_BY_MACHINE_EVIDENCE_UTILITY",
  "RECOVERED_BY_OPTIONAL_CHILD_SELECTION",
  "RECOVERED_BY_UTILITY_AWARE_BUNDLE",
  "INVENTORY_PRESENT_TARGET_MISSING",
  "HIGH_UTILITY_CHILD_UNSELECTED",
  "UTILITY_PROPAGATION_ZEROED",
  "UTILITY_PLANNER_SELECTION_MISS",
  "SAFETY_BUDGET_INFEASIBLE",
  "PLANNER_SEARCH_INCOMPLETE",
  "REVIEW_AUDIO_OMISSION",
  "GOLD_MAPPING_UNRESOLVED",
]);
const componentEvaluation144Schema = z
  .object({
    errorComponentId: id,
    labels: z.array(id),
    baselineInventoryStatus: coverageStatus144Schema,
    baselineTargetStatus: coverageStatus144Schema,
    utilityTargetStatus: coverageStatus144Schema,
    physicalAudioStatus: coverageStatus144Schema,
    playbackStatus: coverageStatus144Schema,
    lexicalStatus: coverageStatus144Schema,
    bestStageReached: z.enum(["U0", "U1", "U2", "U3", "U4"]).nullable(),
    finalStageStatus: coverageStatus144Schema,
    finalBlockingReason: id,
    selectedRelevantOptionalChildIds: z.array(id),
    unselectedHighUtilityChildIds: z.array(id),
    finalDiagnosis: diagnosis144Schema,
  })
  .strict();
const stageMetric144Schema = z
  .object({
    stage: z.enum(["U0", "U1", "U2", "U3", "U4"]),
    integrityStatus: z.enum(["PASSED", "FAILED"]),
    targetCount: count,
    safetyBundleCount: count,
    safetyCoreUnionSeconds: nonnegative,
    reviewRegionCount: count,
    physicalAudioCount: count,
    playbackSegmentCount: count,
    fullQueueUniqueAudioSeconds: nonnegative,
    fullQueueEpisodeRatio: ratio,
    phaseAObligationCoverage: ratio,
    phaseARegressionCount: count,
    utilityTierCoverage: tierCoverage144Schema,
    missingInventory: recall144Schema,
    missingTarget: recall144Schema,
    missingPhysicalAudio: recall144Schema,
    missingPlaybackAny: recall144Schema,
    missingPlaybackAudible: recall144Schema,
    missingPlaybackFull: recall144Schema,
    missingLocalizedLexical: recall144Schema,
    hallucinationTarget: recall144Schema,
    hallucinationPhysicalAudio: recall144Schema,
    hallucinationPlaybackAudible: recall144Schema,
  })
  .strict();
export const goldEvaluation144Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    policyVersion: version144Schema,
    visibility: z.literal("LOCAL_ONLY_GOLD_EVALUATION"),
    artifactType: z.literal("gold-c6-0-1-14-4-utility-selection-evaluation"),
    machineFreezeHash: hash,
    goldFirstReadAt: z.iso.datetime(),
    machineFreezeCompletedAt: z.iso.datetime(),
    freezeBeforeGold: z.boolean(),
    machineStageGoldPathReadCount: z.literal(0),
    machineStageGoldDerivedArtifactReadCount: z.literal(0),
    stages: z.array(stageMetric144Schema).length(5),
    components: z.array(componentEvaluation144Schema),
    finalMissingInventory: recall144Schema,
    finalMissingTarget: recall144Schema,
    finalMissingPhysicalAudio: recall144Schema,
    finalMissingPlaybackAny: recall144Schema,
    finalMissingPlaybackAudible: recall144Schema,
    finalMissingPlaybackFull: recall144Schema,
    finalMissingLocalizedLexical: recall144Schema,
    finalHallucinationTarget: recall144Schema,
    finalHallucinationPhysicalAudio: recall144Schema,
    finalHallucinationPlaybackAudible: recall144Schema,
    utilityRecoveredMissingCount: count,
    remainingHighUtilityUnselectedCount: count,
    finalSafetySelectionMissCount: count,
    finalReviewAudioOmissionCount: count,
    evaluationIntegrityPassed: z.boolean(),
    evaluatorInferenceCount: z.literal(0),
    canonicalMutationCount: z.literal(0),
    semanticHash: hash,
  })
  .strict();

export const routeName144Schema = z.enum([
  "GO_C6_0_1_15_REGION_RANKER_RECALIBRATION",
  "HOLD_FOR_MACHINE_EVIDENCE_UTILITY_PROPAGATION_REPAIR",
  "HOLD_FOR_MACHINE_EVIDENCE_UTILITY_SELECTION_REPAIR",
  "HOLD_FOR_SAFETY_BUDGET_MODEL_REDESIGN",
  "HOLD_FOR_PLANNER_SEARCH_COMPLETENESS",
  "HOLD_FOR_REVIEW_AUDIO_COVERAGE_REPAIR",
  "HOLD_FOR_EVALUATION_INTEGRITY_REPAIR",
  "HOLD_FOR_ENGINEERING_REPAIR",
]);
export const route144Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    policyVersion: version144Schema,
    visibility: z.literal("LOCAL_ONLY"),
    artifactType: z.literal("c6-0-1-14-4-route-decision"),
    evaluationHash: hash,
    plannerHash: hash,
    freezeHash: hash,
    route: routeName144Schema,
    engineeringGate: z.boolean(),
    integrityGate: z.boolean(),
    utilityPropagationGate: z.boolean(),
    monotonicityGate: z.boolean(),
    plannerGate: z.boolean(),
    safetyBudgetGate: z.boolean(),
    finalTargetSelectionGate: z.boolean(),
    reviewDeliveryGate: z.boolean(),
    playbackGate: z.boolean(),
    fullQueueCoverageGate: z.boolean(),
    fullQueueQualityGate: z.boolean(),
    reasons: z.array(id),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    machineOnlyReleaseAuthorized: z.literal(false),
    c602Status: z.literal("HOLD"),
    semanticHash: hash,
  })
  .strict();

const fileIdentity144Schema = z
  .object({
    sha256: hash,
    size: count,
    mtimeMs: nonnegative,
    inode: count,
  })
  .strict();
export const postFreezeAudit144Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    policyVersion: version144Schema,
    visibility: z.literal("LOCAL_ONLY_GOLD_EVALUATION"),
    artifactType: z.literal("c6-0-1-14-4-post-freeze-evaluation-audit"),
    firstGoldReadAuditHash: hash,
    finalAFreezeHash: hash,
    finalBFreezeHash: hash,
    finalABParityHash: hash,
    sourceIdentityBefore: fileIdentity144Schema,
    sourceIdentityAfter: fileIdentity144Schema,
    goldIdentityBefore: fileIdentity144Schema,
    goldIdentityAfter: fileIdentity144Schema,
    qualityEvaluationIdentityBefore: fileIdentity144Schema,
    qualityEvaluationIdentityAfter: fileIdentity144Schema,
    regionLabelsIdentityBefore: fileIdentity144Schema,
    regionLabelsIdentityAfter: fileIdentity144Schema,
    upstreamEvaluationIdentityBefore: fileIdentity144Schema,
    upstreamEvaluationIdentityAfter: fileIdentity144Schema,
    sourceReadOnly: z.literal(true),
    goldReadOnly: z.literal(true),
    freezeBeforeGold: z.literal(true),
    machineStageGoldPathReadCount: z.literal(0),
    machineStageGoldDerivedArtifactReadCount: z.literal(0),
    evaluatorGoldInputCount: z.literal(1),
    newInferenceCount: z.literal(0),
    modelLoadCount: z.literal(0),
    providerProcessStartCount: z.literal(0),
    matchingRulesChanged: z.literal(false),
    canonicalMutationCount: z.literal(0),
    rankerRetrained: z.literal(false),
    newOofRun: z.literal(false),
    semanticHash: hash,
  })
  .strict();

export const validation144Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    policyVersion: version144Schema,
    visibility: z.literal("LOCAL_ONLY"),
    artifactType: z.literal("c6-0-1-14-4-validation"),
    routeDecisionHash: hash,
    checks: z.array(
      z.object({ name: id, passed: z.boolean(), evidence: id }).strict(),
    ),
    passedCount: count,
    failedCount: count,
    schemaValidatedArtifactCount: count,
    generatedSchemaCount: count,
    unitPassed: count,
    unitSkipped: count,
    e2ePassed: count,
    e2eSkipped: count,
    uiPassed: count,
    browserPassed: count,
    targetedPassed: count,
    crossVersionPassed: count,
    skillValidationPassed: z.boolean(),
    networkUsedForAcceptance: z.literal(false),
    sourceReadOnlyVerified: z.boolean(),
    goldReadOnlyVerified: z.boolean(),
    worktreeCleanAtValidation: z.boolean(),
    engineeringPassed: z.boolean(),
    semanticHash: hash,
  })
  .strict();

const browserCheckId144Schema = z.enum([
  "PAGE_IDENTITY",
  "MEANINGFUL_CONTENT",
  "NO_FRAMEWORK_OVERLAY",
  "CONSOLE_HEALTH",
  "BUNDLE_SUMMARY_RENDERED",
  "CHILD_PROVENANCE_RENDERED",
  "OBLIGATION_GAPS_RENDERED",
  "FROZEN_CANDIDATE_COPY_RENDERED",
  "AUDIO_CONTROL_RESPONDS",
  "READ_ONLY_STATE_PRESERVED",
  "NO_SAVE_OR_CANONICAL_INSERT_CONTROL",
  "RESPONSIVE_LAYOUT",
]);
export const browserAudit144Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    policyVersion: version144Schema,
    visibility: z.literal("LOCAL_ONLY"),
    artifactType: z.literal("c6-0-1-14-4-browser-read-only-acceptance"),
    checkedAt: z.iso.datetime(),
    workspaceDataByteHash: hash,
    workspaceJavascriptByteHash: hash,
    checks: z
      .array(
        z
          .object({
            id: browserCheckId144Schema,
            passed: z.boolean(),
            detail: z.string().min(1),
          })
          .strict(),
      )
      .length(12),
    consoleErrorCount: count,
    sessionBefore: z.null(),
    sessionAfter: z.null(),
    savedHumanDecisionCount: z.literal(0),
    humanTrialStarted: z.literal(false),
    passed: z.boolean(),
    semanticHash: hash,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(value.checks.map((check) => check.id)).size !== 12 ||
      value.passed !==
        (value.consoleErrorCount === 0 &&
          value.checks.every((check) => check.passed))
    )
      context.addIssue({
        code: "custom",
        message: "browser acceptance must contain 12 unique truthful checks",
      });
  });

export const shareableSummary144Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    policyVersion: version144Schema,
    visibility: z.literal("SHAREABLE_AGGREGATE_ONLY"),
    artifactType: z.literal("c6-0-1-14-4-shareable-acceptance-summary"),
    policyHash: hash,
    atomUtilityHash: hash,
    childUtilityHash: hash,
    bundleUtilityHash: hash,
    plannerHash: hash,
    finalAFreezeHash: hash,
    finalBFreezeHash: hash,
    evaluationHash: hash,
    routeDecisionHash: hash,
    atomCount: count,
    positiveEvidenceAtomCount: count,
    positiveEvidenceZeroUtilityCount: z.literal(0),
    eligibleChildCount: count,
    eligibleChildZeroUtilityCount: z.literal(0),
    eligibleBundleCount: count,
    eligibleOptionalBundleZeroUtilityCount: z.literal(0),
    tierCounts: tierCoverage144Schema,
    oldPlanObjectiveVector: vector,
    newPlanObjectiveVector: vector,
    forcedInclusionEvaluatedCount: count,
    forcedInclusionFeasibleCount: count,
    forcedInclusionInfeasibleCount: count,
    forcedInclusionSearchIncompleteCount: count,
    selectedBundleCount: count,
    selectedChildCount: count,
    selectedOptionalChildCount: count,
    safetyCoreUnionSeconds: nonnegative,
    fullQueueEpisodeRatio: ratio,
    finalMissingInventoryRatio: ratio,
    finalMissingTargetRatio: ratio,
    finalMissingPhysicalAudioRatio: ratio,
    finalMissingPlaybackAudibleRatio: ratio,
    finalHallucinationPlaybackAudibleRatio: ratio,
    route: routeName144Schema,
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    c602Status: z.literal("HOLD"),
    canonicalMutationCount: z.literal(0),
    audioPayloadIncluded: z.literal(false),
    dialoguePayloadIncluded: z.literal(false),
    goldIntervalsIncluded: z.literal(false),
    localPathsIncluded: z.literal(false),
    semanticHash: hash,
  })
  .strict();

export const shareableAudit144Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("c6-0-1-14-4-shareable-audit"),
    summaryByteHash: hash,
    strictSchemaPassed: z.boolean(),
    absolutePathLeakCount: count,
    secretPatternCount: count,
    rawDialogueOrAudioFieldCount: count,
    sourceOrGoldIntervalFieldCount: count,
    brokenRelativeReferenceCount: count,
    passed: z.boolean(),
  })
  .strict();

export const parity144Schema = z
  .object({
    ...header144Shape,
    artifactType: z.literal("c6-0-1-14-4-final-ab-parity"),
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

export const c601144UtilitySchemas = {
  "c6-0-1-14-4-machine-evidence-utility-policy": utilityPolicy144Schema,
  "machine-evidence-utility-pathology-audit": pathologyAudit144Schema,
  "c6-0-1-14-4-geometry-freeze": geometryFreeze144Schema,
  "machine-evidence-atom-utility-v1": atomUtility144Schema,
  "machine-selectable-child-utility-v1": childUtility144Schema,
  "machine-target-bundle-utility-v1": bundleUtility144Schema,
  "machine-evidence-utility-propagation-ledger": propagation144Schema,
  "machine-forced-inclusion-planner-results": forcedInclusion144Schema,
  "machine-optional-speech-child-coverage-ledger": optionalChildLedger144Schema,
  "machine-utility-aware-final-planner-certificate": planner144Schema,
  "machine-utility-plan-comparison": planComparison144Schema,
  "machine-missing-safety-reserve-targets-v4": safetyTargets144Schema,
  "machine-review-target-intervals-v6": reviewTargets144Schema,
  "machine-review-items-v8": reviewItems144Schema,
  "machine-review-regions-v7": reviewRegions144Schema,
  "machine-review-audio-manifest-v7": reviewAudio144Schema,
  "machine-review-playback-timeline-v6": reviewPlayback144Schema,
  "c6-0-1-14-4-nested-semantic-integrity-preflight": nestedPreflight144Schema,
  "c6-0-1-14-4-machine-utility-selection-freeze": freeze144Schema,
  "c6-0-1-14-4-pre-gold-engineering-validation": preGoldEngineering144Schema,
  "c6-0-1-14-4-first-gold-read-audit": firstGoldRead144Schema,
  "gold-c6-0-1-14-4-utility-selection-evaluation": goldEvaluation144Schema,
  "c6-0-1-14-4-route-decision": route144Schema,
  "c6-0-1-14-4-post-freeze-evaluation-audit": postFreezeAudit144Schema,
  "c6-0-1-14-4-validation": validation144Schema,
  "c6-0-1-14-4-final-ab-parity": parity144Schema,
  "c6-0-1-14-4-browser-read-only-acceptance": browserAudit144Schema,
  "c6-0-1-14-4-shareable-acceptance-summary": shareableSummary144Schema,
  "c6-0-1-14-4-shareable-audit": shareableAudit144Schema,
};

export type UtilityPolicy144 = z.infer<typeof utilityPolicy144Schema>;
export type PathologyAudit144 = z.infer<typeof pathologyAudit144Schema>;
export type GeometryFreeze144 = z.infer<typeof geometryFreeze144Schema>;
export type AtomUtilityRow144 = z.infer<typeof atomUtilityRow144Schema>;
export type AtomUtility144 = z.infer<typeof atomUtility144Schema>;
export type ChildUtilityRow144 = z.infer<typeof childUtilityRow144Schema>;
export type ChildUtility144 = z.infer<typeof childUtility144Schema>;
export type BundleUtilityRow144 = z.infer<typeof bundleUtilityRow144Schema>;
export type BundleUtility144 = z.infer<typeof bundleUtility144Schema>;
export type Propagation144 = z.infer<typeof propagation144Schema>;
export type ForcedInclusion144 = z.infer<typeof forcedInclusion144Schema>;
export type OptionalChildLedger144 = z.infer<
  typeof optionalChildLedger144Schema
>;
export type Planner144 = z.infer<typeof planner144Schema>;
export type PlanComparison144 = z.infer<typeof planComparison144Schema>;
export type SafetyTargets144 = z.infer<typeof safetyTargets144Schema>;
export type ReviewTargets144 = z.infer<typeof reviewTargets144Schema>;
export type ReviewItems144 = z.infer<typeof reviewItems144Schema>;
export type ReviewRegions144 = z.infer<typeof reviewRegions144Schema>;
export type ReviewAudio144 = z.infer<typeof reviewAudio144Schema>;
export type ReviewPlayback144 = z.infer<typeof reviewPlayback144Schema>;
export type Freeze144 = z.infer<typeof freeze144Schema>;
export type PreGoldEngineering144 = z.infer<typeof preGoldEngineering144Schema>;
export type FirstGoldRead144 = z.infer<typeof firstGoldRead144Schema>;
export type GoldEvaluation144 = z.infer<typeof goldEvaluation144Schema>;
export type Route144 = z.infer<typeof route144Schema>;
export type PostFreezeAudit144 = z.infer<typeof postFreezeAudit144Schema>;
export type Validation144 = z.infer<typeof validation144Schema>;
export type BrowserAudit144 = z.infer<typeof browserAudit144Schema>;
export type ShareableSummary144 = z.infer<typeof shareableSummary144Schema>;

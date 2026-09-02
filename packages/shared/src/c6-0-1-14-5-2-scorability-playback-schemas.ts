import { z } from "zod";
import { c60114SourceIdentitySchema } from "./c6-0-1-14-evidence-schemas.js";
import {
  c601141IntervalSchema as interval,
  c601141SampleIntervalSchema as samples,
} from "./c6-0-1-14-1-speech-inventory-schemas.js";
import {
  reviewAudio1451Schema,
  reviewItems1451Schema,
  reviewPlayback1451Schema,
  reviewRegions1451Schema,
  reviewTargets1451Schema,
} from "./c6-0-1-14-5-1-registry-binding-schemas.js";

const id = z.string().min(1);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const count = z.number().int().nonnegative();
const positiveCount = z.number().int().positive();
const nonnegative = z.number().nonnegative();
const ratio = z.number().min(0).max(1);

export const version1452Schema = z.literal(
  "c6.0.1.14.5.2-product-scorability-playback-realization-v1",
);

export const header1452Shape = {
  schemaVersion: z.literal("1.0.0"),
  policyVersion: version1452Schema,
  policyHash: hash,
  sourceIdentity: c60114SourceIdentitySchema,
  sourceTimebase: z.literal("SOURCE_GLOBAL_NATIVE_SAMPLES"),
  runtimeGoldInputCount: z.literal(0),
  visibility: z.literal("LOCAL_ONLY"),
  semanticHash: hash,
};

export const policy1452Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    policyVersion: version1452Schema,
    artifactType: z.literal(
      "c6-0-1-14-5-2-product-scorability-playback-realization-policy",
    ),
    executionPolicy: z.literal(
      "REPLAY_ONLY_PRODUCT_SCORABILITY_AND_PLAYBACK_REALIZATION",
    ),
    maximumInferenceCount: z.literal(0),
    maximumModelLoadCount: z.literal(0),
    maximumProviderProcessStartCount: z.literal(0),
    minimumSpeechAnchorPolicyVersion: z.literal(
      "C601143_MINIMUM_CHILD_CORE_SECONDS_V1",
    ),
    minimumSpeechAnchorSeconds: z.literal(0.12),
    degenerateOrphanPolicyVersion: z.literal(
      "C6011452_DEGENERATE_ORPHAN_BOUNDARY_SLIVER_V1",
    ),
    physicalContainerPlaybackSeparationVersion: z.literal(
      "C6011452_PHYSICAL_CONTAINER_PLAYBACK_UNION_V1",
    ),
    playbackSetSearchVersion: z.literal(
      "C6011452_EXACT_BOUNDED_INTERVAL_COVER_SEARCH_V1",
    ),
    witnessConnectivityVersion: z.literal(
      "C6011452_GOLD_FREE_WITNESS_CONNECTIVITY_V2",
    ),
    productOutcomeDeterminacyVersion: z.literal(
      "C6011452_DETERMINATE_PRODUCT_OUTCOME_V1",
    ),
    machineAnchorMinimumOverlapSeconds: z.literal(0.2),
    machineAnchorMinimumUnitCoverageRatio: z.literal(0.1),
    unitToGoldCoverageThreshold: z.literal(0.8),
    playbackToGoldCoverageThreshold: z.literal(0.8),
    playbackToUnitCoverageThreshold: z.literal(0.95),
    maximumReviewEnvelopeSeconds: z.literal(12),
    maximumOneSideContextSeconds: z.literal(3),
    maximumUnitsPerWitnessCandidate: z.literal(8),
    maximumRealizationsPerWitnessCandidate: z.literal(8),
    maximumWitnessReviewEnvelopeSeconds: z.literal(20),
    maximumInternalMachineGapSeconds: z.literal(0.5),
    coverageUnitMergeGapSeconds: z.literal(0.3),
    maximumPlaybackSetSearchSegments: z.literal(20),
    auditOnlyTargetSemantics: z.literal(true),
    exactPlaybackSegmentSetEnumeration: z.literal(true),
    completeRejectionLedgerRequired: z.literal(true),
    determinateAbsenceIsScorableFail: z.literal(true),
    notScorableReservedForInfrastructure: z.literal(true),
    trueAllMandatoryPreserved: z.literal(true),
    goldFeaturesAllowedBeforeFreeze: z.literal(false),
    targetGeometryMutationAllowed: z.literal(false),
    regionGeometryMutationAllowed: z.literal(false),
    audioGeometryMutationAllowed: z.literal(false),
    playbackGeometryMutationAllowed: z.literal(false),
    canonicalMutationAllowed: z.literal(false),
    plannerMutationAllowed: z.literal(false),
    machineOnlyReleaseAuthorized: z.literal(false),
    rankerRetrained: z.literal(false),
    semanticHash: hash,
  })
  .strict();

export const degenerateClassification1452Schema = z.enum([
  "DEGENERATE_ORPHAN_BOUNDARY_SLIVER",
  "AUDIT_ONLY_ORPHAN_BOUNDARY_RESIDUE",
  "NOT_DEGENERATE",
]);

const degenerateAuditRow1452Schema = z
  .object({
    targetId: id,
    targetType: id,
    sourceInterval: interval,
    nativeSourceInterval: samples,
    durationSamples: positiveCount,
    durationSeconds: z.number().positive(),
    localizationStatus: id,
    durationStatus: z.enum(["SUB_MINIMUM", "AT_OR_ABOVE_MINIMUM"]),
    evidenceIds: z.array(id),
    evidenceIntervalUnion: z.array(samples),
    fullRegistryPositiveOverlapSamples: count,
    fullRegistryBoundaryContactCount: count,
    nearestLeftUnitGapSamples: count.nullable(),
    nearestRightUnitGapSamples: count.nullable(),
    parentEvidenceDurationSamples: positiveCount,
    targetToParentDurationRatio: ratio,
    independentLocalizedSpeechCore: z.boolean(),
    sourceIdentityMatch: z.boolean(),
    existingBindingRequirement: id,
    existingBindingStatus: id,
    existingProductEligibility: z.boolean(),
    degenerateSliverCandidate: z.boolean(),
    reasons: z.array(id),
    semanticHash: hash,
  })
  .strict();

export const degenerateAudit1452Schema = z
  .object({
    ...header1452Shape,
    artifactType: z.literal("machine-degenerate-orphan-target-baseline-audit"),
    reviewTargetsHash: hash,
    fullRegistryHash: hash,
    bindingHash: hash,
    minimumDurationPolicyVersion: id,
    minimumDurationSamples: positiveCount,
    minimumDurationSeconds: z.number().positive(),
    rows: z.array(degenerateAuditRow1452Schema),
    auditedSpeechTargetCount: count,
    orphanSpeechTargetCount: count,
    subMinimumOrphanCount: count,
    boundaryContactOnlyCount: count,
    degenerateSliverCandidateCount: count,
  })
  .strict();

export const finalBindingRequirement1452Schema = z.enum([
  "UNIT_BINDING_REQUIRED",
  "UNIT_BINDING_OPTIONAL",
  "UNIT_BINDING_NOT_APPLICABLE",
  "UNIT_BINDING_OPTIONAL_AUDIT_ONLY",
]);

const degenerateEligibilityRow1452Schema = z
  .object({
    targetId: id,
    previousBindingRequirement: id,
    finalBindingRequirement: finalBindingRequirement1452Schema,
    previousProductEligibility: z.boolean(),
    finalProductEligibility: z.boolean(),
    classification: degenerateClassification1452Schema,
    productOutcomeRole: z.enum([
      "AUDIT_ONLY_BOUNDARY_RESIDUE",
      "PRODUCT_CONTRACT_TARGET",
      "NON_SPEECH_AUDIT_TARGET",
    ]),
    durationPolicyVersion: id,
    minimumDurationSamples: positiveCount,
    positiveOverlapSamples: count,
    boundaryContactOnly: z.boolean(),
    auditRetention: z.literal(true),
    geometryChanged: z.literal(false),
    reasons: z.array(id),
    semanticHash: hash,
  })
  .strict();

export const degenerateEligibility1452Schema = z
  .object({
    ...header1452Shape,
    artifactType: z.literal("machine-degenerate-orphan-target-eligibility-v1"),
    auditHash: hash,
    rows: z.array(degenerateEligibilityRow1452Schema),
    degenerateSliverClassifiedCount: count,
    degenerateSliverAuditRetainedCount: count,
    degenerateSliverGeometryMutationCount: z.literal(0),
    degenerateSliverDeletedCount: z.literal(0),
    degenerateSliverFakeBindingCount: z.literal(0),
    productRequiredDegenerateSliverCountBefore: count,
    productRequiredDegenerateSliverCountAfter: z.literal(0),
    bindingRequiredTargetCountBefore: count,
    bindingRequiredTargetCountAfter: count,
    requiredTargetBoundCountAfter: count,
    requiredTargetUnboundCountAfter: z.literal(0),
    reviewTargetCountBefore: count,
    reviewTargetCountAfter: count,
    targetIntervalMutationCount: z.literal(0),
    passed: z.literal(true),
  })
  .strict();

export const realizationKind1452Schema = z.enum([
  "TARGET_SCOPED_PLAYBACK_REALIZATION",
  "REGION_SCOPED_PLAYBACK_REALIZATION",
  "MULTI_TARGET_REGION_PLAYBACK_REALIZATION",
]);

export const playbackSetSearchStatus1452Schema = z.enum([
  "FEASIBLE",
  "INFEASIBLE_PROVEN",
  "SEARCH_INCOMPLETE",
]);

export const realizationRejectionReason1452Schema = z.enum([
  "NO_TARGET_UNIT_BINDING",
  "ZERO_MACHINE_ANCHOR_OVERLAP",
  "MACHINE_ANCHOR_BELOW_SECONDS",
  "MACHINE_ANCHOR_BELOW_RATIO",
  "NO_PHYSICAL_AUDIO",
  "WAV_NOT_VERIFIED",
  "NO_BOUND_PLAYBACK_SEGMENT",
  "PLAYBACK_UNIT_COVERAGE_BELOW_0_95",
  "REVIEW_PLAYBACK_ENVELOPE_EXCEEDS_12_SECONDS",
  "LEFT_CONTEXT_EXCEEDS_3_SECONDS",
  "RIGHT_CONTEXT_EXCEEDS_3_SECONDS",
  "SOURCE_IDENTITY_MISMATCH",
  "PLAYBACK_CHAIN_DISCONNECTED",
  "PLAYBACK_SET_SEARCH_INCOMPLETE",
  "DUPLICATE_DOMINATED_CANDIDATE",
  "UNKNOWN",
]);

export const realizationCandidate1452Schema = z
  .object({
    candidateId: id,
    realizationKind: realizationKind1452Schema,
    targetIds: z.array(id).min(1),
    unitIds: z.array(id).min(1),
    regionId: id,
    audioId: id,
    physicalAudioContainerInterval: samples,
    playbackSegmentIds: z.array(id),
    selectedPlaybackIntervals: z.array(samples),
    playbackUnionSeconds: nonnegative,
    reviewPlaybackEnvelope: samples.nullable(),
    reviewPlaybackEnvelopeSeconds: nonnegative,
    machineAnchorIntervals: z.array(samples),
    machineAnchorOverlapSamples: count,
    machineAnchorCoverageRatios: z.record(id, ratio),
    playbackCoverageOfUnitRatios: z.record(id, ratio),
    leftContextSeconds: nonnegative,
    rightContextSeconds: nonnegative,
    sourceIdentityMatch: z.boolean(),
    physicalAudioVerified: z.boolean(),
    wavHashVerified: z.boolean(),
    playbackVerified: z.boolean(),
    searchStatus: playbackSetSearchStatus1452Schema,
    searchedSubsetCount: count,
    accepted: z.boolean(),
    rejectionReasons: z.array(realizationRejectionReason1452Schema),
    semanticHash: hash,
  })
  .strict();

export const realizationCandidateLedger1452Schema = z
  .object({
    ...header1452Shape,
    artifactType: z.literal(
      "machine-inherited-realization-candidate-ledger-v2",
    ),
    bindingHash: hash,
    eligibilityHash: hash,
    reviewPlaybackHash: hash,
    fullQueuePlanHash: hash,
    candidates: z.array(realizationCandidate1452Schema),
    targetScopedCandidateCount: count,
    regionScopedCandidateCount: count,
    multiTargetRegionCandidateCount: count,
    candidateCount: count,
    acceptedCandidateCount: count,
    rejectedCandidateCount: count,
    searchCompleteCandidateCount: count,
    searchIncompleteCandidateCount: count,
    rejectionReasonDistribution: z.record(id, count),
    candidateConservationPassed: z.literal(true),
    unknownSilentRejectionCount: z.literal(0),
    enumerationComplete: z.literal(true),
    searchComplete: z.literal(true),
  })
  .strict();

export const inheritedRealization1452Schema = z
  .object({
    realizationId: id,
    realizationOrigin: z.literal(
      "INHERITED_EXISTING_REVIEW_DELIVERY_REALIZATION",
    ),
    realizationKind: realizationKind1452Schema,
    targetIds: z.array(id).min(1),
    fullCoverageUnitIds: z.array(id).min(1),
    regionIds: z.array(id).min(1),
    audioIds: z.array(id).min(1),
    playbackSegmentIds: z.array(id).min(1),
    physicalAudioContainerIntervals: z.array(samples).min(1),
    playbackIntervals: z.array(samples).min(1),
    playbackIntervalUnion: z.array(samples).min(1),
    reviewPlaybackEnvelope: samples,
    machineAnchorIntervals: z.array(samples).min(1),
    anchorCoverageByUnit: z.record(id, ratio),
    playbackCoverageByUnit: z.record(id, ratio),
    playbackUnionSeconds: z.number().positive(),
    envelopeSeconds: z.number().positive().max(12),
    leftContextSeconds: nonnegative.max(3),
    rightContextSeconds: nonnegative.max(3),
    candidateLedgerIds: z.array(id).min(1),
    sourceIdentity: c60114SourceIdentitySchema,
    physicalAudioVerified: z.literal(true),
    playbackVerified: z.literal(true),
    contractPreconditionsPassed: z.literal(true),
    semanticHash: hash,
  })
  .strict();

export const inheritedRealizations1452Schema = z
  .object({
    ...header1452Shape,
    artifactType: z.literal("machine-existing-review-delivery-realizations-v2"),
    candidateLedgerHash: hash,
    realizations: z.array(inheritedRealization1452Schema),
    inheritedTargetRealizationCount: count,
    inheritedRegionRealizationCount: count,
    inheritedMultiTargetRealizationCount: count,
    inheritedV2UnitZeroOverlapCount: z.literal(0),
    inheritedV2MissingAudioCount: z.literal(0),
    inheritedV2MissingPlaybackCount: z.literal(0),
    inheritedV2SourceMismatchCount: z.literal(0),
    inheritedV2PlaybackSetSearchIncompleteCount: z.literal(0),
  })
  .strict();

export const realizationComparison1452Schema = z
  .object({
    ...header1452Shape,
    artifactType: z.literal("machine-inherited-realization-v1-v2-comparison"),
    v1Hash: hash,
    v2Hash: hash,
    candidateCountV1: count,
    acceptedCountV1: count,
    candidateCountV2: count,
    acceptedCountV2: count,
    newlyAcceptedCount: count,
    noLongerAcceptedCount: count,
    retainedAcceptedCount: count,
    changedEnvelopeSemanticCount: count,
    changedPlaybackSegmentSetCount: count,
    geometryMutationCount: z.literal(0),
    rejectionReasonDelta: z.record(id, z.number().int()),
  })
  .strict();

export const effectiveOrigin1452Schema = z.enum([
  "PLANNER_SELECTED_REALIZATION",
  "INHERITED_EXISTING_REVIEW_DELIVERY_REALIZATION",
]);

export const effectiveRealization1452Schema = z
  .object({
    effectiveRealizationId: id,
    fullCoverageUnitIds: z.array(id).min(1),
    realizationOrigins: z.array(effectiveOrigin1452Schema).min(1),
    equivalentRealizationIds: z.array(id).min(1),
    preferredOrigin: effectiveOrigin1452Schema,
    targetIds: z.array(id),
    regionIds: z.array(id),
    audioIds: z.array(id),
    playbackSegmentIds: z.array(id),
    machineAnchorIntervals: z.array(samples).min(1),
    unitAtomicIntervals: z.array(samples).min(1),
    physicalAudioContainerIntervals: z.array(samples).min(1),
    playbackIntervalUnion: z.array(samples).min(1),
    anchorCoverageByUnit: z.record(id, ratio),
    playbackCoverageByUnit: z.record(id, ratio),
    reviewPlaybackEnvelope: samples,
    leftContextSeconds: nonnegative,
    rightContextSeconds: nonnegative,
    physicalAudioVerified: z.literal(true),
    playbackVerified: z.literal(true),
    deduplicationRelation: z.enum([
      "UNIQUE_PLANNER_REALIZATION",
      "UNIQUE_INHERITED_REALIZATION",
      "PLANNER_INHERITED_GEOMETRY_EQUIVALENT",
      "MULTIPLE_INHERITED_GEOMETRY_EQUIVALENT",
    ]),
    semanticHash: hash,
  })
  .strict();

const deduplicationRow1452Schema = z
  .object({
    effectiveRealizationId: id,
    signatureHash: hash,
    equivalentRealizationIds: z.array(id).min(1),
    preferredOrigin: effectiveOrigin1452Schema,
    semanticHash: hash,
  })
  .strict();

export const effectiveRealizations1452Schema = z
  .object({
    ...header1452Shape,
    artifactType: z.literal(
      "machine-effective-product-realization-registry-v2",
    ),
    plannerHash: hash,
    inheritedV2Hash: hash,
    realizations: z.array(effectiveRealization1452Schema),
    deduplicationLedger: z.array(deduplicationRow1452Schema),
    plannerSelectedRealizationCount: count,
    inheritedRealizationCount: count,
    plannerInheritedDuplicateCount: count,
    effectiveRealizationDedupCount: count,
    effectiveProductRealizationCount: count,
    complete: z.literal(true),
  })
  .strict();

export const witnessConnectionType1452Schema = z.enum([
  "SHARED_PHYSICAL_AUDIO",
  "SHARED_REVIEW_REGION",
  "CONTINUOUS_PLAYBACK_CHAIN",
  "SOURCE_ADJACENT_UNITS",
  "SHARED_PARENT_SPEECH_ISLAND",
  "SHARED_MACHINE_EVIDENCE_LINEAGE",
]);

const witnessConnectivityRow1452Schema = z
  .object({
    connectivityId: id,
    realizationA: id,
    realizationB: id,
    connectionTypes: z.array(witnessConnectionType1452Schema),
    sharedRegionIds: z.array(id),
    sharedAudioIds: z.array(id),
    sharedPlaybackChainIds: z.array(id),
    unitGapSamples: count.nullable(),
    sharedParentIds: z.array(id),
    sharedEvidenceIds: z.array(id),
    sourceIdentityMatch: z.boolean(),
    hardBoundaryCrossed: z.boolean(),
    connected: z.boolean(),
    reasons: z.array(id),
    semanticHash: hash,
  })
  .strict();

export const witnessConnectivity1452Schema = z
  .object({
    ...header1452Shape,
    artifactType: z.literal("machine-witness-connectivity-ledger-v2"),
    effectiveRealizationRegistryHash: hash,
    rows: z.array(witnessConnectivityRow1452Schema),
    pairCount: count,
    connectedPairCount: count,
    disconnectedPairCount: count,
    sharedAudioConnectionCount: count,
    sharedRegionConnectionCount: count,
    continuousPlaybackConnectionCount: count,
    sourceAdjacentConnectionCount: count,
    sharedParentOrLineageConnectionCount: count,
    timeProximityOnlyConnectionCount: z.literal(0),
    complete: z.literal(true),
  })
  .strict();

export const witnessGroup1452Schema = z
  .object({
    witnessGroupId: id,
    fullCoverageUnitIds: z.array(id).min(1).max(8),
    realizationIds: z.array(id).min(1).max(8),
    realizationOrigins: z.array(effectiveOrigin1452Schema).min(1),
    targetIds: z.array(id),
    regionIds: z.array(id),
    audioIds: z.array(id),
    playbackSegmentIds: z.array(id),
    unitAtomicIntervals: z.array(samples).min(1),
    targetAnchorIntervals: z.array(samples).min(1),
    physicalAudioContainerIntervals: z.array(samples).min(1),
    playbackIntervalUnion: z.array(samples).min(1),
    sourceIdentity: c60114SourceIdentitySchema,
    connectedBy: z.array(
      z.union([
        witnessConnectionType1452Schema,
        z.literal("SINGLE_REALIZATION"),
      ]),
    ),
    maximumInternalGapSeconds: nonnegative.max(0.5),
    reviewPlaybackEnvelope: samples,
    witnessEligibility: z.literal(true),
    rejectionReasons: z.array(id).length(0),
    semanticHash: hash,
  })
  .strict();

export const witnessGroups1452Schema = z
  .object({
    ...header1452Shape,
    artifactType: z.literal("machine-product-contract-witness-groups-v2"),
    effectiveRealizationRegistryHash: hash,
    connectivityLedgerHash: hash,
    groups: z.array(witnessGroup1452Schema),
    witnessGroupCount: count,
    singleUnitWitnessCandidateCount: count,
    multiUnitWitnessCandidateCount: count,
    maximumUnitsPerWitness: count.max(8),
    maximumRealizationsPerWitness: count.max(8),
    witnessGroupBuildComplete: z.literal(true),
    witnessSearchComplete: z.literal(true),
    goldInputCount: z.literal(0),
  })
  .strict();

export const determinacyPolicy1452Schema = z
  .object({
    ...header1452Shape,
    artifactType: z.literal("machine-product-outcome-determinacy-policy-v1"),
    passOutcome: z.literal("SCORABLE_PASS_PRODUCT_CONTRACT"),
    determinateFailOutcomes: z.array(id).length(6),
    infrastructureIncompleteOutcomes: z.array(id).min(1),
    integrityOutcome: z.literal("INTEGRITY_FAILED"),
    completeGraphAbsenceIsScorableFail: z.literal(true),
    formalRecallIncludesDeterminateFailures: z.literal(true),
    formalRecallNullOnlyForIndeterminateOrIntegrity: z.literal(true),
  })
  .strict();

const completeness1452Schema = z
  .object({
    fullRegistryComplete: z.boolean(),
    sourceReconciliationComplete: z.boolean(),
    targetBindingEnumerationComplete: z.boolean(),
    audioBindingEnumerationComplete: z.boolean(),
    playbackBindingEnumerationComplete: z.boolean(),
    inheritedCandidateEnumerationComplete: z.boolean(),
    inheritedCandidateSearchComplete: z.boolean(),
    effectiveRealizationRegistryComplete: z.boolean(),
    witnessGroupBuildComplete: z.boolean(),
    witnessSearchComplete: z.boolean(),
    physicalManifestComplete: z.boolean(),
    playbackManifestComplete: z.boolean(),
    nestedIntegrityComplete: z.boolean(),
  })
  .strict();

export const determinacyPreflight1452Schema = z
  .object({
    ...header1452Shape,
    artifactType: z.literal("machine-product-outcome-determinacy-preflight"),
    determinacyPolicyHash: hash,
    globalCompletenessFlags: completeness1452Schema,
    componentPrerequisiteMatrix: z.array(
      z.object({ prerequisite: id, complete: z.boolean() }).strict(),
    ),
    determinateComponentCountBeforeGold: z.literal(0),
    indeterminateComponentCountBeforeGold: z.literal(0),
    indeterminateReasons: z.array(id).length(0),
    integrityFailureCount: z.literal(0),
    formalRecallEligibleAfterGoldMapping: z.literal(true),
    passed: z.literal(true),
  })
  .strict();

const reviewTarget1452Schema = reviewTargets1451Schema.shape.targets.element
  .safeExtend({
    degenerateOrphanClassification: degenerateClassification1452Schema,
    productOutcomeRole: id,
    finalBindingRequirement: finalBindingRequirement1452Schema,
    finalProductEligibility: z.boolean(),
    inheritedRealizationV2Ids: z.array(id),
    productScorabilityRole: id,
  })
  .strict();
export const reviewTargets1452Schema = reviewTargets1451Schema
  .omit({
    policyVersion: true,
    policyHash: true,
    artifactType: true,
    semanticHash: true,
  })
  .extend({
    policyVersion: version1452Schema,
    policyHash: hash,
    artifactType: z.literal("machine-review-target-intervals-v9"),
    targets: z.array(reviewTarget1452Schema),
    eligibilityHash: hash,
    realizationV2Hash: hash,
    semanticHash: hash,
  })
  .strict();

const reviewItem1452Schema = reviewItems1451Schema.shape.items.element
  .safeExtend({
    inheritedRealizationV2Ids: z.array(id),
    productOutcomeRoles: z.array(id),
    productScorabilityStatus: id,
  })
  .strict();
export const reviewItems1452Schema = reviewItems1451Schema
  .omit({
    policyVersion: true,
    policyHash: true,
    artifactType: true,
    semanticHash: true,
  })
  .extend({
    policyVersion: version1452Schema,
    policyHash: hash,
    artifactType: z.literal("machine-review-items-v11"),
    items: z.array(reviewItem1452Schema),
    eligibilityHash: hash,
    realizationV2Hash: hash,
    semanticHash: hash,
  })
  .strict();

const reviewRegion1452Schema = reviewRegions1451Schema.shape.regions.element
  .safeExtend({
    inheritedRegionRealizationIds: z.array(id),
    regionPlaybackChainIds: z.array(id),
    effectiveRealizationIds: z.array(id),
    productWitnessGroupIds: z.array(id),
  })
  .strict();
export const reviewRegions1452Schema = reviewRegions1451Schema
  .omit({
    policyVersion: true,
    policyHash: true,
    artifactType: true,
    semanticHash: true,
  })
  .extend({
    policyVersion: version1452Schema,
    policyHash: hash,
    artifactType: z.literal("machine-review-regions-v10"),
    regions: z.array(reviewRegion1452Schema),
    realizationV2Hash: hash,
    witnessGroupV2Hash: hash,
    semanticHash: hash,
  })
  .strict();

const reviewAudioRow1452Schema = reviewAudio1451Schema.shape.audio.element
  .safeExtend({
    physicalAudioContainerInterval: samples,
    inheritedRealizationV2Ids: z.array(id),
    productWitnessGroupIds: z.array(id),
    boundPlaybackSegmentIds: z.array(id),
  })
  .strict();
export const reviewAudio1452Schema = reviewAudio1451Schema
  .omit({
    policyVersion: true,
    policyHash: true,
    artifactType: true,
    semanticHash: true,
  })
  .extend({
    policyVersion: version1452Schema,
    policyHash: hash,
    artifactType: z.literal("machine-review-audio-manifest-v10"),
    audio: z.array(reviewAudioRow1452Schema),
    realizationV2Hash: hash,
    witnessGroupV2Hash: hash,
    semanticHash: hash,
  })
  .strict();

const reviewPlaybackRow1452Schema =
  reviewPlayback1451Schema.shape.segments.element
    .safeExtend({
      playbackChainId: id,
      inheritedRealizationV2Ids: z.array(id),
      effectiveRealizationIds: z.array(id),
      witnessGroupIds: z.array(id),
    })
    .strict();
export const reviewPlayback1452Schema = reviewPlayback1451Schema
  .omit({
    policyVersion: true,
    policyHash: true,
    artifactType: true,
    semanticHash: true,
  })
  .extend({
    policyVersion: version1452Schema,
    policyHash: hash,
    artifactType: z.literal("machine-review-playback-timeline-v9"),
    segments: z.array(reviewPlaybackRow1452Schema),
    realizationV2Hash: hash,
    witnessGroupV2Hash: hash,
    semanticHash: hash,
  })
  .strict();

const projectionLedgerRow1452Schema = z
  .object({
    artifactType: id,
    sourceArtifactHash: hash,
    projectionArtifactHash: hash,
    sourceHashDomain: id,
    projectionHashDomain: id,
    removedFields: z.array(id),
    addedFields: z.array(id),
    sourceRowCount: count,
    projectedRowCount: count,
    projectedRowHashes: z.array(hash),
    semanticHash: hash,
  })
  .strict();
export const projectionLedger1452Schema = z
  .object({
    ...header1452Shape,
    artifactType: z.literal("machine-projection-hash-rebinding-ledger"),
    rows: z.array(projectionLedgerRow1452Schema),
    projectionRebindingRowCount: count,
    sourceRowsVerified: count,
    projectedRowsRehashed: count,
    staleProjectionHashCount: z.literal(0),
    passed: z.literal(true),
  })
  .strict();

export const nestedPreflight1452Schema = z
  .object({
    ...header1452Shape,
    artifactType: z.literal(
      "c6-0-1-14-5-2-nested-semantic-integrity-preflight",
    ),
    verifiedArtifactHashes: z.array(hash),
    verifiedNestedRowCount: count,
    degenerateAuditRowCount: count,
    eligibilityRowCount: count,
    candidateRowCount: count,
    inheritedRealizationRowCount: count,
    effectiveRealizationRowCount: count,
    connectivityRowCount: count,
    witnessGroupRowCount: count,
    reviewDeliveryRowCount: count,
    projectionRowCount: count,
    nestedIntegrityFailureCount: z.literal(0),
    staleProjectionHashCount: z.literal(0),
    preGold: z.literal(true),
    passed: z.literal(true),
  })
  .strict();

export const freeze1452Schema = z
  .object({
    ...header1452Shape,
    artifactType: z.literal(
      "c6-0-1-14-5-2-machine-scorability-playback-freeze",
    ),
    baselineReplayHash: hash,
    geometryFreezeHash: hash,
    degenerateAuditHash: hash,
    degenerateEligibilityHash: hash,
    realizationCandidateLedgerHash: hash,
    inheritedRealizationV2Hash: hash,
    realizationComparisonHash: hash,
    effectiveRealizationRegistryV2Hash: hash,
    witnessConnectivityHash: hash,
    witnessGroupV2Hash: hash,
    determinacyPolicyHash: hash,
    determinacyPreflightHash: hash,
    reviewDeliveryHashes: z.record(id, hash),
    mandatoryPlanHash: hash,
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

export const parity1452Schema = z
  .object({
    ...header1452Shape,
    artifactType: z.literal("c6-0-1-14-5-2-final-ab-parity"),
    finalAFreezeHash: hash,
    finalBFreezeHash: hash,
    comparedArtifactCount: positiveCount,
    semanticParity: z.literal(true),
    geometryParity: z.literal(true),
    wavHashParity: z.literal(true),
    subtitleParity: z.literal(true),
    mismatches: z.array(id).length(0),
  })
  .strict();

export const firstGoldRead1452Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    policyVersion: version1452Schema,
    policyHash: hash,
    sourceIdentity: c60114SourceIdentitySchema,
    sourceTimebase: z.literal("SOURCE_GLOBAL_NATIVE_SAMPLES"),
    visibility: z.literal("LOCAL_ONLY"),
    artifactType: z.literal("c6-0-1-14-5-2-first-gold-read-audit"),
    runtimeGoldInputCount: z.literal(1),
    machineFreezeHash: hash,
    machineFreezeCompletedAt: z.iso.datetime(),
    goldFirstReadAt: z.iso.datetime(),
    freezeBeforeGold: z.literal(true),
    machineStageGoldPathReadCount: z.literal(0),
    machineStageGoldDerivedArtifactReadCount: z.literal(0),
    semanticHash: hash,
  })
  .strict();

export const productOutcome1452Schema = z.enum([
  "SCORABLE_PASS_PRODUCT_CONTRACT",
  "SCORABLE_FAIL_INVENTORY_ABSENT",
  "SCORABLE_FAIL_TARGET_ABSENT",
  "SCORABLE_FAIL_REALIZATION_ABSENT",
  "SCORABLE_FAIL_AUDIO_ABSENT",
  "SCORABLE_FAIL_PLAYBACK_ABSENT",
  "SCORABLE_FAIL_CONTRACT_THRESHOLD",
  "NOT_SCORABLE_REGISTRY_RECONCILIATION_INCOMPLETE",
  "NOT_SCORABLE_TARGET_BINDING_ENUMERATION_INCOMPLETE",
  "NOT_SCORABLE_REALIZATION_ENUMERATION_INCOMPLETE",
  "NOT_SCORABLE_WITNESS_GROUP_BUILD_INCOMPLETE",
  "NOT_SCORABLE_WITNESS_SEARCH_INCOMPLETE",
  "NOT_SCORABLE_SOURCE_IDENTITY_UNRESOLVED",
  "NOT_SCORABLE_AMBIGUOUS_MACHINE_MAPPING",
  "NOT_SCORABLE_REQUIRED_ARTIFACT_MISSING",
  "INTEGRITY_FAILED",
]);

const recall1452Schema = z
  .object({ numerator: count, denominator: count, ratio })
  .strict();

export const evaluationComponent1452Schema = z
  .object({
    componentId: id,
    matchingFullCoverageUnitIds: z.array(id),
    targetBindingIds: z.array(id),
    targetEligibilityStatuses: z.array(id),
    inheritedRealizationV1Ids: z.array(id),
    inheritedRealizationV2Ids: z.array(id),
    effectiveRealizationIds: z.array(id),
    witnessGroupIds: z.array(id),
    selectedWitnessRealizationIds: z.array(id),
    selectedPlaybackSegmentIds: z.array(id),
    physicalAudioContainerIntervals: z.array(samples),
    reviewPlaybackEnvelopes: z.array(samples),
    machineAnchorCoverage: z.record(id, ratio),
    unitPlaybackCoverage: z.record(id, ratio),
    unitToGoldCoverageRatio: ratio,
    targetCoreGoldCoverageRatio: ratio,
    physicalAudioGoldCoverageRatio: ratio,
    goldPlaybackCoverage: ratio,
    globalCompletenessPrerequisites: completeness1452Schema,
    outcomeDeterminacyStatus: z.enum([
      "DETERMINATE",
      "INDETERMINATE",
      "INTEGRITY_FAILED",
    ]),
    scorabilityStatus: z.enum(["SCORABLE", "NOT_SCORABLE", "INTEGRITY_FAILED"]),
    productContractStatus: productOutcome1452Schema,
    productContractPassed: z.boolean(),
    finalBlockingReason: id.nullable(),
    finalDiagnosis: id,
    rejectionReasons: z.array(id),
    semanticHash: hash,
  })
  .strict();

const evaluationProjection1452Schema = z
  .object({
    projectionId: z.enum(["S0", "S1", "S2", "S3", "S4", "S5", "S6", "S7"]),
    name: id,
    integrityStatus: z.enum(["PASS", "FAIL"]),
    machineGraphCompleteness: z.boolean(),
    determinateOutcomeCount: count,
    scorablePassCount: count,
    scorableFailCount: count,
    notScorableCount: count,
    integrityFailedCount: count,
    formalRecallStatus: z.enum([
      "SCORABLE",
      "NOT_SCORABLE",
      "INTEGRITY_FAILED",
    ]),
    formalRecall: recall1452Schema.nullable(),
    measuredScorableSubsetRecall: recall1452Schema.nullable(),
    targetCoreRecall: recall1452Schema,
    ordinaryPhysicalAudioRecall: recall1452Schema,
    ordinaryPlaybackAnyOverlapRecall: recall1452Schema,
    ordinaryPlaybackAudibleRecall: recall1452Schema,
    ordinaryPlaybackFullRecall: recall1452Schema,
    productContractRecall: recall1452Schema.nullable(),
    hallucinationRecall: recall1452Schema,
    targetCount: count,
    regionCount: count,
    audioCount: count,
    playbackSegmentCount: count,
    uniqueAudioSeconds: nonnegative,
    semanticHash: hash,
  })
  .strict();

export const evaluation1452Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    policyVersion: version1452Schema,
    policyHash: hash,
    sourceIdentity: c60114SourceIdentitySchema,
    sourceTimebase: z.literal("SOURCE_GLOBAL_NATIVE_SAMPLES"),
    visibility: z.literal("LOCAL_ONLY"),
    artifactType: z.literal("gold-c6-0-1-14-5-2-product-outcome-evaluation"),
    runtimeGoldInputCount: z.literal(1),
    firstGoldReadAuditHash: hash,
    machineFreezeHash: hash,
    projections: z.array(evaluationProjection1452Schema).length(8),
    components: z.array(evaluationComponent1452Schema),
    totalComponentCount: count,
    determinateOutcomeCount: count,
    scorablePassCount: count,
    scorableFailCount: count,
    notScorableCount: count,
    integrityFailedCount: count,
    formalRecallStatus: z.enum([
      "SCORABLE",
      "NOT_SCORABLE",
      "INTEGRITY_FAILED",
    ]),
    formalRecall: recall1452Schema.nullable(),
    measuredScorableSubsetRecall: recall1452Schema.nullable(),
    measuredScorableSubsetDiagnosticOnly: z.literal(true),
    targetCoreRecall: recall1452Schema,
    ordinaryPhysicalAudioRecall: recall1452Schema,
    ordinaryPlaybackAnyOverlapRecall: recall1452Schema,
    ordinaryPlaybackAudibleRecall: recall1452Schema,
    ordinaryPlaybackFullRecall: recall1452Schema,
    productContractRecall: recall1452Schema.nullable(),
    hallucinationTargetRecall: recall1452Schema,
    hallucinationPhysicalAudioRecall: recall1452Schema,
    hallucinationPlaybackAudibleRecall: recall1452Schema,
    regionPlaybackClosureRecoveredCount: count,
    inheritedV2RecoveredCount: count,
    multiUnitWitnessRecoveredCount: count,
    goldReadOnly: z.literal(true),
    semanticHash: hash,
  })
  .strict();

export const mandatoryEvaluation1452Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    policyVersion: version1452Schema,
    policyHash: hash,
    sourceIdentity: c60114SourceIdentitySchema,
    sourceTimebase: z.literal("SOURCE_GLOBAL_NATIVE_SAMPLES"),
    visibility: z.literal("LOCAL_ONLY"),
    artifactType: z.literal("gold-c6-0-1-14-5-2-all-mandatory-evaluation"),
    runtimeGoldInputCount: z.literal(1),
    machineFreezeHash: hash,
    planId: z.literal("ALL_MANDATORY"),
    itemCount: count,
    regionCount: count,
    targetCount: count,
    audioCount: count,
    playbackSegmentCount: count,
    uniqueAudioSeconds: nonnegative,
    components: z.array(evaluationComponent1452Schema),
    formalProductStatus: z.enum([
      "SCORABLE",
      "NOT_SCORABLE",
      "INTEGRITY_FAILED",
    ]),
    formalProductRecall: recall1452Schema.nullable(),
    targetCoreRecall: recall1452Schema,
    ordinaryMissingAudibleRecall: recall1452Schema,
    hallucinationRecall: recall1452Schema,
    fullQueueCopy: z.literal(false),
    rankerRetrained: z.literal(false),
    semanticHash: hash,
  })
  .strict();

export const unexpectedProductAudit1452Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    policyVersion: version1452Schema,
    policyHash: hash,
    artifactType: z.literal("unexpected-product-vs-ordinary-audibility-audit"),
    visibility: z.literal("LOCAL_ONLY"),
    productPassCount: count,
    ordinaryAudiblePassCount: count,
    productUsedWavContainerAsPlaybackCount: z.literal(0),
    productUsedEnvelopeAsCoverageCount: z.literal(0),
    unrelatedPlaybackCount: z.literal(0),
    thresholdMutationCount: z.literal(0),
    passed: z.literal(true),
    semanticHash: hash,
  })
  .strict();

export const route1452Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    policyVersion: version1452Schema,
    policyHash: hash,
    sourceIdentity: c60114SourceIdentitySchema,
    sourceTimebase: z.literal("SOURCE_GLOBAL_NATIVE_SAMPLES"),
    visibility: z.literal("LOCAL_ONLY"),
    artifactType: z.literal("c6-0-1-14-5-2-route-decision"),
    runtimeGoldInputCount: z.literal(1),
    evaluationHash: hash,
    route: z.enum([
      "GO_C6_0_1_15_REGION_RANKER_RECALIBRATION",
      "HOLD_FOR_DEGENERATE_ORPHAN_ELIGIBILITY_REPAIR",
      "HOLD_FOR_INHERITED_PLAYBACK_REALIZATION_REPAIR",
      "HOLD_FOR_REALIZATION_CANDIDATE_ENUMERATION_REPAIR",
      "HOLD_FOR_MULTI_UNIT_PRODUCT_WITNESS_REPAIR",
      "HOLD_FOR_CONTRACT_SCORABILITY_REPAIR",
      "HOLD_FOR_REMAINING_INVENTORY_TO_TARGET_COVERAGE_REPAIR",
      "HOLD_FOR_REVIEW_AUDIO_COVERAGE_REPAIR",
      "HOLD_FOR_SAFETY_BUDGET_MODEL_REDESIGN",
      "HOLD_FOR_EVALUATION_INTEGRITY_REPAIR",
      "HOLD_FOR_ENGINEERING_REPAIR",
    ]),
    gates: z.array(z.object({ name: id, passed: z.boolean() }).strict()),
    earliestFailureLayer: id.nullable(),
    blockingReasons: z.array(id),
    advisories: z.array(id),
    engineeringGatePassed: z.boolean(),
    productQualityGatePassed: z.boolean(),
    machineOnlyReleaseAuthorized: z.literal(false),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    c602Status: z.literal("HOLD"),
    semanticHash: hash,
  })
  .strict();

export const shareableSummary1452Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    policyVersion: version1452Schema,
    artifactType: z.literal("c6-0-1-14-5-2-aggregate-shareable-summary"),
    visibility: z.literal("SHAREABLE_AGGREGATE_ONLY"),
    policyHash: hash,
    orphanClassificationCounts: z.record(id, count),
    candidateCounts: z.record(id, count),
    realizationCounts: z.record(id, count),
    determinacyCounts: z.record(id, count),
    recallRatios: z.record(id, ratio.nullable()),
    mandatoryMetrics: z.record(
      id,
      z.union([count, nonnegative, id, ratio.nullable()]),
    ),
    artifactHashes: z.record(id, hash),
    route: id,
    containsRawAudio: z.literal(false),
    containsDialogueText: z.literal(false),
    containsGoldRows: z.literal(false),
    containsAbsolutePaths: z.literal(false),
    semanticHash: hash,
  })
  .strict();

export const shareableAudit1452Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("c6-0-1-14-5-2-shareable-audit"),
    auditedFileCount: positiveCount,
    absolutePathLeakCount: z.literal(0),
    secretLeakCount: z.literal(0),
    goldLeakCount: z.literal(0),
    brokenRelativeReferenceCount: z.literal(0),
    passed: z.literal(true),
    semanticHash: hash,
  })
  .strict();

export const validation1452Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    policyVersion: version1452Schema,
    policyHash: hash,
    artifactType: z.literal("c6-0-1-14-5-2-validation"),
    visibility: z.literal("LOCAL_ONLY"),
    checks: z.array(
      z.object({ name: id, passed: z.boolean(), detail: id }).strict(),
    ),
    passedCheckCount: count,
    failedCheckCount: z.literal(0),
    artifactValidationCount: count,
    schemaValidationCount: count,
    sourceReadOnly: z.literal(true),
    goldReadOnly: z.literal(true),
    inferenceCount: z.literal(0),
    modelLoadCount: z.literal(0),
    providerProcessStartCount: z.literal(0),
    networkUsed: z.literal(false),
    passed: z.literal(true),
    semanticHash: hash,
  })
  .strict();

export type Policy1452 = z.infer<typeof policy1452Schema>;
export type DegenerateAudit1452 = z.infer<typeof degenerateAudit1452Schema>;
export type DegenerateEligibility1452 = z.infer<
  typeof degenerateEligibility1452Schema
>;
export type RealizationCandidateLedger1452 = z.infer<
  typeof realizationCandidateLedger1452Schema
>;
export type InheritedRealizations1452 = z.infer<
  typeof inheritedRealizations1452Schema
>;
export type EffectiveRealizations1452 = z.infer<
  typeof effectiveRealizations1452Schema
>;
export type WitnessConnectivity1452 = z.infer<
  typeof witnessConnectivity1452Schema
>;
export type WitnessGroups1452 = z.infer<typeof witnessGroups1452Schema>;
export type DeterminacyPreflight1452 = z.infer<
  typeof determinacyPreflight1452Schema
>;
export type ReviewTargets1452 = z.infer<typeof reviewTargets1452Schema>;
export type ReviewItems1452 = z.infer<typeof reviewItems1452Schema>;
export type ReviewRegions1452 = z.infer<typeof reviewRegions1452Schema>;
export type ReviewAudio1452 = z.infer<typeof reviewAudio1452Schema>;
export type ReviewPlayback1452 = z.infer<typeof reviewPlayback1452Schema>;
export type Evaluation1452 = z.infer<typeof evaluation1452Schema>;
export type EvaluationComponent1452 = z.infer<
  typeof evaluationComponent1452Schema
>;
export type Route1452 = z.infer<typeof route1452Schema>;

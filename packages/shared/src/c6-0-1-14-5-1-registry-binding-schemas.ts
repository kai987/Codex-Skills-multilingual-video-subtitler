import { z } from "zod";
import { c60114SourceIdentitySchema } from "./c6-0-1-14-evidence-schemas.js";
import {
  c601141IntervalSchema as interval,
  c601141SampleIntervalSchema as samples,
} from "./c6-0-1-14-1-speech-inventory-schemas.js";
import {
  reviewAudio145Schema,
  reviewItem145Schema,
  reviewItems145Schema,
  reviewPlayback145Schema,
  reviewRegion145Schema,
  reviewRegions145Schema,
  reviewTarget145Schema,
  reviewTargets145Schema,
} from "./c6-0-1-14-5-safety-coverage-unit-schemas.js";

const id = z.string().min(1);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const count = z.number().int().nonnegative();
const positiveCount = z.number().int().positive();
const nonnegative = z.number().nonnegative();
const ratio = z.number().min(0).max(1);

export const version1451Schema = z.literal(
  "c6.0.1.14.5.1-full-unit-registry-review-binding-v1",
);

export const header1451Shape = {
  schemaVersion: z.literal("1.0.0"),
  policyVersion: version1451Schema,
  policyHash: hash,
  sourceIdentity: c60114SourceIdentitySchema,
  sourceTimebase: z.literal("SOURCE_GLOBAL_NATIVE_SAMPLES"),
  runtimeGoldInputCount: z.literal(0),
  visibility: z.literal("LOCAL_ONLY"),
  semanticHash: hash,
};

export const coverageState1451Schema = z.enum([
  "CUE_COVERED",
  "IMMUTABLE_REVIEW_TARGET_COVERED",
  "EXISTING_REVIEW_TARGET_COVERED",
  "SAFETY_PLANNING_SELECTED",
  "SAFETY_PLANNING_UNSELECTED",
  "PARTIALLY_COVERED",
  "UNCOVERED_SPEECH",
  "MULTI_STATE_ATOMIC_PARTITION",
]);

export const policy1451Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    policyVersion: version1451Schema,
    artifactType: z.literal(
      "c6-0-1-14-5-1-full-unit-registry-review-binding-policy",
    ),
    executionPolicy: z.literal(
      "REPLAY_ONLY_REGISTRY_BINDING_AND_CONTRACT_REEVALUATION",
    ),
    maximumInferenceCount: z.literal(0),
    maximumModelLoadCount: z.literal(0),
    maximumProviderProcessStartCount: z.literal(0),
    registryBoundaryPolicyVersion: z.literal(
      "C6011451_INVENTORY_ATOMIC_COVERAGE_STATE_PARTITION_V1",
    ),
    coverageStatePartitionVersion: z.literal(
      "C6011451_COVERAGE_STATE_PARTITION_V1",
    ),
    planningProjectionPolicyVersion: z.literal(
      "C601145_UNCOVERED_SAFETY_PLANNING_PROJECTION_V1",
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
    witnessAdjacencySeconds: z.literal(0.3),
    fullRegistryRequiredCoverageRatio: z.literal(1),
    positiveOverlapRequired: z.literal(true),
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

export const baselineAudit1451Schema = z
  .object({
    ...header1451Shape,
    artifactType: z.literal(
      "machine-c6-0-1-14-5-1-registry-binding-baseline-audit",
    ),
    inventoryHash: hash,
    planningUnitsHash: hash,
    reviewTargetsHash: hash,
    reviewAudioHash: hash,
    reviewPlaybackHash: hash,
    verifiedSpeechRowCount: count,
    verifiedSpeechAtomicIntervalCount: count,
    verifiedSpeechUnionSamples: count,
    verifiedSpeechUnionSeconds: nonnegative,
    currentCoverageUnitCount: count,
    currentCoverageUnitUnionSamples: count,
    currentCoverageUnitUnionSeconds: nonnegative,
    currentRegistryCoverageRatio: ratio,
    cueCoveredSpeechSamples: count,
    immutableTargetCoveredSpeechSamples: count,
    existingReviewTargetCoveredSpeechSamples: count,
    uncoveredPlanningSpeechSamples: count,
    reviewTargetCount: count,
    targetWithPositiveMachineSpeechEvidenceCount: count,
    targetUnitBoundCount: count,
    requiredTargetUnitUnboundCount: count,
    optionalNonSpeechTargetCount: count,
    audioCount: count,
    audioUnitBoundCount: count,
    playbackSegmentCount: count,
    playbackUnitBoundCount: count,
    targetUnitPairCount: count,
    targetUnitZeroOverlapCount: count,
    audioUnitPairCount: count,
    audioUnitZeroOverlapCount: count,
    playbackUnitPairCount: count,
    playbackUnitZeroOverlapCount: count,
    plannerSelectedRealizationCount: count,
    safetyTargetFallbackRealizationCount: count,
    targetBoundToUnselectedRealizationCount: count,
    productComponentScorableCount: count,
    productComponentUnscorableCount: count,
    allMandatoryPlanFound: z.boolean(),
    allMandatoryResultCopiedFromFullQueue: z.boolean(),
    rootCauseClassifications: z.array(id),
  })
  .strict();

export const fullRegistryUnit1451Schema = z
  .object({
    fullCoverageUnitId: id,
    legacyPlanningCoverageUnitIds: z.array(id),
    sourceIdentity: c60114SourceIdentitySchema,
    atomicNativeIntervals: z.array(samples).min(1),
    atomicSourceIntervals: z.array(interval).min(1),
    coreUnionSamples: positiveCount,
    coreUnionSeconds: z.number().positive(),
    envelopeInterval: samples,
    internalSilenceIntervals: z.array(samples),
    detectorFamilies: z.array(id),
    independentEvidenceFamilies: z.array(id),
    evidenceStrata: z.array(id),
    evidenceObservationIds: z.array(id).min(1),
    evidenceAtomIds: z.array(id),
    parentClusterIds: z.array(id),
    childUnitIds: z.array(id),
    cueCoverageRatio: ratio,
    immutableTargetCoverageRatio: ratio,
    existingReviewTargetCoverageRatio: ratio,
    existingPlaybackCoverageRatio: ratio,
    safetyPlanningCoverageRatio: ratio,
    coverageStates: z.array(coverageState1451Schema).min(1),
    planningEligibility: z.boolean(),
    verifiedTimebase: z.literal(true),
    strongContradiction: z.literal(false),
    semanticHash: hash,
  })
  .strict();

export const fullRegistry1451Schema = z
  .object({
    ...header1451Shape,
    artifactType: z.literal("machine-full-speech-evidence-unit-registry-v1"),
    inventoryHash: hash,
    hierarchyHash: hash,
    planningUnitsHash: hash,
    boundaryPolicyVersion: id,
    coverageStatePartitionVersion: id,
    units: z.array(fullRegistryUnit1451Schema),
    fullRegistryUnitCount: count,
    fullRegistryAtomicIntervalCount: count,
    registeredVerifiedSpeechUnionSamples: count,
    registeredVerifiedSpeechUnionSeconds: nonnegative,
    upstreamVerifiedSpeechUnionSamples: count,
    upstreamVerifiedSpeechUnionSeconds: nonnegative,
    unregisteredVerifiedSpeechSamples: z.literal(0),
    registeredVerifiedSpeechCoverageRatio: z.literal(1),
    cueCoveredUnitCount: count,
    immutableTargetCoveredUnitCount: count,
    existingReviewTargetCoveredUnitCount: count,
    uncoveredPlanningUnitCount: count,
    partiallyCoveredUnitCount: count,
    sourceOrdered: z.literal(true),
    sourceIdentityConsistent: z.literal(true),
    complete: z.literal(true),
  })
  .strict();

const reconciliationRow1451Schema = z
  .object({
    evidenceObservationId: id,
    sourceNativeInterval: samples,
    fullCoverageUnitIds: z.array(id).min(1),
    mappedSamples: positiveCount,
    sourceSamples: positiveCount,
    coverageRatio: z.literal(1),
    hierarchyAtomIds: z.array(id),
    reconciliationStatus: z.enum([
      "EXACT_HIERARCHY_AND_INVENTORY",
      "INVENTORY_ONLY_REGISTERED",
      "PARTIAL_HIERARCHY_PROVENANCE",
    ]),
    semanticHash: hash,
  })
  .strict();

export const sourceReconciliation1451Schema = z
  .object({
    ...header1451Shape,
    artifactType: z.literal("machine-full-registry-source-reconciliation"),
    inventoryHash: hash,
    hierarchyHash: hash,
    fullRegistryHash: hash,
    rows: z.array(reconciliationRow1451Schema),
    verifiedSpeechRowCount: count,
    mappedVerifiedSpeechRowCount: count,
    unmappedVerifiedSpeechRowCount: z.literal(0),
    exactHierarchyAndInventoryCount: count,
    inventoryOnlyRegisteredCount: count,
    partialHierarchyProvenanceCount: count,
    registeredUnionParity: z.literal(true),
  })
  .strict();

const planningProjectionRow1451Schema = z
  .object({
    legacyPlanningCoverageUnitId: id,
    fullRegistryCoverageUnitIds: z.array(id).min(1),
    atomicNativeIntervals: z.array(samples).min(1),
    coreUnionSamples: positiveCount,
    selectedByPlanner: z.boolean(),
    semanticHash: hash,
  })
  .strict();

export const planningProjection1451Schema = z
  .object({
    ...header1451Shape,
    artifactType: z.literal("machine-uncovered-safety-unit-projection-v1"),
    sourcePlanningUnitsHash: hash,
    fullRegistryHash: hash,
    rows: z.array(planningProjectionRow1451Schema),
    planningUnitCount: count,
    planningUnitUnionSamples: count,
    planningProjectionSemanticParity: z.literal(true),
    plannerSelectedBundleParity: z.literal(true),
    plannerSelectedChildParity: z.literal(true),
    plannerSelectedRealizationParity: z.literal(true),
    plannerObjectiveParity: z.literal(true),
  })
  .strict();

export const compatibilityRelation1451Schema = z.enum([
  "EXACT_EQUIVALENT",
  "LEGACY_SUBSET_OF_FULL_UNIT",
  "FULL_UNIT_SUBSET_OF_LEGACY",
  "ONE_TO_MANY_ATOMIC_PARTITION",
  "MANY_TO_ONE_COMPATIBILITY",
  "NO_COMPATIBLE_REGISTRY_UNIT",
]);

const compatibilityRow1451Schema = z
  .object({
    legacyPlanningCoverageUnitId: id,
    fullRegistryCoverageUnitIds: z.array(id),
    relationType: compatibilityRelation1451Schema,
    sourceNativeIntersectionSamples: count,
    legacyCoverageRatio: ratio,
    fullRegistryCoverageRatios: z.array(ratio),
    evidenceFamilyCompatibility: z.boolean(),
    sourceIdentityMatch: z.boolean(),
    relationVerified: z.boolean(),
    reasons: z.array(id),
    semanticHash: hash,
  })
  .strict();

export const compatibilityMap1451Schema = z
  .object({
    ...header1451Shape,
    artifactType: z.literal(
      "machine-coverage-unit-registry-compatibility-map-v1",
    ),
    planningUnitsHash: hash,
    fullRegistryHash: hash,
    rows: z.array(compatibilityRow1451Schema),
    exactCount: count,
    oneToManyCount: count,
    manyToOneCount: count,
    unresolvedCount: count,
    unresolvedPlannerSelectedUnitMappings: z.literal(0),
    plannerSelectedUnitMappingCoverageRatio: z.literal(1),
  })
  .strict();

export const bindingRequirement1451Schema = z.enum([
  "UNIT_BINDING_REQUIRED",
  "UNIT_BINDING_OPTIONAL",
  "UNIT_BINDING_NOT_APPLICABLE",
]);

export const bindingStatus1451Schema = z.enum([
  "BOUND_EXACT_LINEAGE",
  "BOUND_SHARED_EVIDENCE",
  "BOUND_VERIFIED_CORE_OVERLAP",
  "BOUND_MULTI_UNIT",
  "OPTIONAL_BINDING",
  "NOT_APPLICABLE_NON_SPEECH_TARGET",
  "UNBOUND_NO_VERIFIED_SPEECH",
  "UNBOUND_AMBIGUOUS_INTERVAL_ONLY",
  "REJECTED_ZERO_OVERLAP",
  "REJECTED_SOURCE_IDENTITY_MISMATCH",
]);

const targetBindingRow1451Schema = z
  .object({
    bindingLedgerId: id,
    targetId: id,
    bindingRequirement: bindingRequirement1451Schema,
    targetType: id,
    targetCoreIntervals: z.array(samples),
    coreDerivationMethod: z.enum([
      "ATOMIC_TARGET_CORE",
      "LEGACY_SPEECH_TARGET_SOURCE_INTERVAL",
      "NOT_APPLICABLE",
    ]),
    evidenceIds: z.array(id),
    fullCoverageUnitId: id.nullable(),
    legacyPlanningCoverageUnitIds: z.array(id),
    bindingBasis: z.enum([
      "SHARED_MACHINE_EVIDENCE_LINEAGE",
      "SHARED_SPEECH_ISLAND_OR_INVENTORY_IDENTITY",
      "SHARED_ATOM_OR_CHILD_PROVENANCE",
      "VERIFIED_SOURCE_NATIVE_CORE_OVERLAP",
      "INTERVAL_ONLY_AMBIGUOUS",
      "NOT_APPLICABLE",
    ]),
    sourceIdentityMatch: z.boolean(),
    overlapSamples: count,
    targetCoreCoverageRatio: ratio,
    unitCoreCoverageRatio: ratio,
    sharedEvidenceIds: z.array(id),
    sharedLineageIds: z.array(id),
    bindingStatus: bindingStatus1451Schema,
    productBindingEligible: z.boolean(),
    reasons: z.array(id),
    semanticHash: hash,
  })
  .strict();

const regionBindingRow1451Schema = z
  .object({
    bindingLedgerId: id,
    regionId: id,
    targetIds: z.array(id),
    fullCoverageUnitId: id.nullable(),
    regionInterval: samples,
    overlapSamples: count,
    sourceIdentityMatch: z.boolean(),
    bindingStatus: bindingStatus1451Schema,
    productBindingEligible: z.boolean(),
    semanticHash: hash,
  })
  .strict();

const audioBindingRow1451Schema = z
  .object({
    bindingLedgerId: id,
    audioId: id,
    targetIds: z.array(id),
    fullCoverageUnitId: id.nullable(),
    actualSourceInterval: samples,
    unitAtomicIntervals: z.array(samples),
    overlapSamples: count,
    unitCoreCoverageRatio: ratio,
    audioCoverageRatio: ratio,
    physicalFileVerified: z.boolean(),
    wavHashVerified: z.boolean(),
    sourceIdentityMatch: z.boolean(),
    bindingStatus: bindingStatus1451Schema,
    productBindingEligible: z.boolean(),
    semanticHash: hash,
  })
  .strict();

const playbackBindingRow1451Schema = z
  .object({
    bindingLedgerId: id,
    playbackSegmentId: id,
    audioId: id,
    targetIds: z.array(id),
    fullCoverageUnitId: id.nullable(),
    playbackSourceInterval: samples,
    overlapSamples: count,
    unitCoreCoverageRatio: ratio,
    playbackCoverageRatio: ratio,
    audioBindingVerified: z.boolean(),
    targetBindingVerified: z.boolean(),
    sourceIdentityMatch: z.boolean(),
    bindingStatus: bindingStatus1451Schema,
    productBindingEligible: z.boolean(),
    semanticHash: hash,
  })
  .strict();

export const reviewBinding1451Schema = z
  .object({
    ...header1451Shape,
    artifactType: z.literal("machine-review-delivery-coverage-unit-binding-v1"),
    fullRegistryHash: hash,
    reviewTargetsHash: hash,
    reviewRegionsHash: hash,
    reviewAudioHash: hash,
    reviewPlaybackHash: hash,
    targetBindings: z.array(targetBindingRow1451Schema),
    regionBindings: z.array(regionBindingRow1451Schema),
    audioBindings: z.array(audioBindingRow1451Schema),
    playbackBindings: z.array(playbackBindingRow1451Schema),
    targetCount: count,
    unitBindingRequiredTargetCount: count,
    unitBindingOptionalTargetCount: count,
    unitBindingNotApplicableTargetCount: count,
    requiredTargetBoundCount: count,
    requiredTargetUnboundCount: count,
    targetUnitPairCount: count,
    targetUnitZeroOverlapRejectedCount: count,
    productEligibleTargetUnitZeroOverlapCount: z.literal(0),
    regionUnitPairCount: count,
    audioUnitPairCount: count,
    audioUnitZeroOverlapRejectedCount: count,
    productEligibleAudioUnitZeroOverlapCount: z.literal(0),
    playbackUnitPairCount: count,
    playbackUnitZeroOverlapRejectedCount: count,
    productEligiblePlaybackUnitZeroOverlapCount: z.literal(0),
    playbackWithoutAudioBindingCount: count,
    playbackWithoutTargetBindingCount: count,
    targetSourceIdentityMismatchCount: count,
    fullDeliveryBoundUnitCount: count,
  })
  .strict();

export const realizationOrigin1451Schema = z.enum([
  "PLANNER_SELECTED_REALIZATION",
  "INHERITED_EXISTING_REVIEW_DELIVERY_REALIZATION",
  "PHASE_A_OBLIGATION_REALIZATION",
  "AUDIT_ONLY_UNBOUND_REALIZATION",
]);

export const inheritedRealization1451Schema = z
  .object({
    realizationId: id,
    realizationOrigin: z.literal(
      "INHERITED_EXISTING_REVIEW_DELIVERY_REALIZATION",
    ),
    realizationKind: z.enum([
      "INHERITED_TARGET_REALIZATION",
      "INHERITED_REGION_REALIZATION",
      "INHERITED_MULTI_TARGET_REGION_REALIZATION",
    ]),
    fullCoverageUnitIds: z.array(id).min(1),
    targetIds: z.array(id).min(1),
    regionIds: z.array(id),
    audioIds: z.array(id).min(1),
    playbackSegmentIds: z.array(id).min(1),
    atomicAnchorIntervals: z.array(samples).min(1),
    unitCoreCoverageRatios: z.array(ratio).min(1),
    machineAnchorOverlapSamples: positiveCount,
    machineAnchorCoverageRatios: z.array(ratio).min(1),
    actualAudioIntervals: z.array(samples).min(1),
    actualPlaybackIntervals: z.array(samples).min(1),
    playbackCoverageOfUnitRatios: z.array(ratio).min(1),
    reviewEnvelope: samples,
    envelopeSeconds: z.number().positive().max(12),
    leftContextSeconds: nonnegative.max(3),
    rightContextSeconds: nonnegative.max(3),
    sourceIdentity: c60114SourceIdentitySchema,
    physicalAudioVerified: z.literal(true),
    playbackVerified: z.literal(true),
    contractPreconditionsPassed: z.literal(true),
    contractViolations: z.array(id).length(0),
    semanticHash: hash,
  })
  .strict();

export const inheritedRealizations1451Schema = z
  .object({
    ...header1451Shape,
    artifactType: z.literal("machine-existing-review-delivery-realizations-v1"),
    bindingHash: hash,
    realizations: z.array(inheritedRealization1451Schema),
    inheritedTargetRealizationCount: count,
    inheritedRegionRealizationCount: count,
    inheritedMultiTargetRealizationCount: count,
    inheritedRealizationRejectionCount: count,
    inheritedRealizationUnitZeroOverlapCount: z.literal(0),
    inheritedRealizationMissingAudioCount: z.literal(0),
    inheritedRealizationMissingPlaybackCount: z.literal(0),
    inheritedRealizationSourceMismatchCount: z.literal(0),
  })
  .strict();

export const effectiveRealization1451Schema = z
  .object({
    effectiveRealizationId: id,
    fullCoverageUnitIds: z.array(id).min(1),
    realizationOrigins: z.array(realizationOrigin1451Schema).min(1),
    equivalentRealizationIds: z.array(id).min(1),
    preferredOrigin: realizationOrigin1451Schema,
    targetIds: z.array(id),
    regionIds: z.array(id),
    audioIds: z.array(id),
    playbackSegmentIds: z.array(id),
    atomicAnchorIntervals: z.array(samples).min(1),
    unitAtomicIntervals: z.array(samples).min(1),
    actualAudioIntervals: z.array(samples).min(1),
    actualPlaybackIntervals: z.array(samples).min(1),
    anchorOverlapSamples: positiveCount,
    anchorCoverageRatios: z.array(ratio).min(1),
    playbackCoverageOfUnitRatios: z.array(ratio).min(1),
    reviewEnvelope: samples,
    leftContextSeconds: nonnegative.max(3),
    rightContextSeconds: nonnegative.max(3),
    physicalAudioVerified: z.literal(true),
    playbackVerified: z.literal(true),
    deduplicationRelation: z.enum([
      "UNIQUE_PLANNER_REALIZATION",
      "UNIQUE_INHERITED_REALIZATION",
      "PLANNER_INHERITED_GEOMETRY_EQUIVALENT",
    ]),
    semanticHash: hash,
  })
  .strict();

export const effectiveRealizations1451Schema = z
  .object({
    ...header1451Shape,
    artifactType: z.literal(
      "machine-effective-product-realization-registry-v1",
    ),
    plannerHash: hash,
    inheritedHash: hash,
    realizations: z.array(effectiveRealization1451Schema),
    plannerSelectedRealizationCount: count,
    inheritedRealizationCount: count,
    plannerInheritedDuplicateCount: count,
    effectiveRealizationDedupCount: count,
    effectiveProductRealizationCount: count,
  })
  .strict();

export const witnessGroup1451Schema = z
  .object({
    witnessGroupId: id,
    fullCoverageUnitIds: z.array(id).min(1).max(8),
    realizationIds: z.array(id).min(1).max(8),
    realizationOrigins: z.array(realizationOrigin1451Schema).min(1),
    targetIds: z.array(id),
    regionIds: z.array(id),
    audioIds: z.array(id),
    playbackSegmentIds: z.array(id),
    unitAtomicIntervals: z.array(samples).min(1),
    targetAnchorIntervals: z.array(samples).min(1),
    physicalAudioIntervals: z.array(samples).min(1),
    playbackIntervals: z.array(samples).min(1),
    sourceIdentity: c60114SourceIdentitySchema,
    connectedBy: z.array(
      z.enum([
        "SHARED_REVIEW_REGION",
        "SHARED_PHYSICAL_AUDIO",
        "CONTINUOUS_PLAYBACK_CHAIN",
        "SOURCE_ADJACENT_UNIT_CORES",
        "SHARED_MACHINE_LINEAGE",
        "SINGLE_REALIZATION",
      ]),
    ),
    maximumInternalGapSeconds: nonnegative.max(0.5),
    reviewEnvelope: samples,
    witnessEligibility: z.boolean(),
    rejectionReasons: z.array(id),
    semanticHash: hash,
  })
  .strict();

export const witnessGroups1451Schema = z
  .object({
    ...header1451Shape,
    artifactType: z.literal("machine-product-contract-witness-groups-v1"),
    effectiveRealizationRegistryHash: hash,
    groups: z.array(witnessGroup1451Schema),
    witnessGroupCount: count,
    singleUnitWitnessCandidateCount: count,
    multiUnitWitnessCandidateCount: count,
    maximumUnitsPerWitness: count.max(8),
    maximumRealizationsPerWitness: count.max(8),
    witnessSearchComplete: z.literal(true),
    goldInputCount: z.literal(0),
  })
  .strict();

export const geometryFreeze1451Schema = z
  .object({
    ...header1451Shape,
    artifactType: z.literal("machine-c6-0-1-14-5-1-geometry-freeze"),
    inventoryHash: hash,
    hierarchyHash: hash,
    planningUnitsHash: hash,
    plannerHash: hash,
    selectedBundleIdsHash: hash,
    selectedChildIdsHash: hash,
    selectedRealizationIdsHash: hash,
    reviewTargetGeometryHash: hash,
    reviewRegionGeometryHash: hash,
    reviewAudioGeometryHash: hash,
    reviewAudioBytesHash: hash,
    playbackGeometryHash: hash,
    protectedSubtitleFileHashes: z.record(id, hash),
    plannerGeometryParity: z.literal(true),
    targetIntervalParity: z.literal(true),
    regionIntervalParity: z.literal(true),
    audioByteParity: z.literal(true),
    playbackIntervalParity: z.literal(true),
  })
  .strict();

export const projectionLedger1451Schema = z
  .object({
    ...header1451Shape,
    artifactType: z.literal("machine-projection-hash-rebinding-ledger-v1451"),
    artifacts: z.array(
      z
        .object({
          artifactType: id,
          sourceArtifactHash: hash,
          projectedArtifactHash: hash,
          sourceRowCount: count,
          projectedRowCount: count,
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

export const nestedPreflight1451Schema = z
  .object({
    ...header1451Shape,
    artifactType: z.literal(
      "c6-0-1-14-5-1-nested-semantic-integrity-preflight",
    ),
    verifiedArtifactHashes: z.array(hash),
    verifiedNestedRowCount: count,
    registryUnitRowCount: count,
    reconciliationRowCount: count,
    compatibilityRowCount: count,
    planningProjectionRowCount: count,
    targetBindingRowCount: count,
    regionBindingRowCount: count,
    audioBindingRowCount: count,
    playbackBindingRowCount: count,
    inheritedRealizationRowCount: count,
    effectiveRealizationRowCount: count,
    witnessGroupRowCount: count,
    reviewDeliveryRowCount: count,
    projectionRowCount: count,
    nestedIntegrityFailureCount: z.literal(0),
    staleProjectionHashCount: z.literal(0),
    preGold: z.literal(true),
    passed: z.literal(true),
  })
  .strict();

export const parity1451Schema = z
  .object({
    ...header1451Shape,
    artifactType: z.literal("c6-0-1-14-5-1-final-ab-parity"),
    finalAFreezeHash: hash,
    finalBFreezeHash: hash,
    comparedArtifactCount: count,
    semanticParity: z.literal(true),
    geometryParity: z.literal(true),
    wavHashParity: z.literal(true),
    subtitleParity: z.literal(true),
    mismatches: z.array(id).length(0),
  })
  .strict();

const reviewTarget1451Schema = reviewTarget145Schema
  .safeExtend({
    fullCoverageUnitIds: z.array(id),
    planningCoverageUnitIds: z.array(id),
    unitBindingRequirement: bindingRequirement1451Schema,
    unitBindingStatus: bindingStatus1451Schema,
    unitBindingLedgerIds: z.array(id),
    realizationIds: z.array(id),
    realizationOrigins: z.array(realizationOrigin1451Schema),
    targetCoreIntervals: z.array(samples),
    coreDerivationMethod: id,
    productBindingEligible: z.boolean(),
  })
  .strict();
export const reviewTargets1451Schema = reviewTargets145Schema
  .omit({
    policyVersion: true,
    policyHash: true,
    artifactType: true,
    semanticHash: true,
  })
  .extend({
    policyVersion: version1451Schema,
    policyHash: hash,
    artifactType: z.literal("machine-review-target-intervals-v8"),
    targets: z.array(reviewTarget1451Schema),
    bindingHash: hash,
    semanticHash: hash,
  })
  .strict();

const reviewItem1451Schema = reviewItem145Schema
  .safeExtend({
    fullCoverageUnitIds: z.array(id),
    inheritedRealizationIds: z.array(id),
    productBindingStatus: id,
  })
  .strict();
export const reviewItems1451Schema = reviewItems145Schema
  .omit({
    policyVersion: true,
    policyHash: true,
    artifactType: true,
    semanticHash: true,
  })
  .extend({
    policyVersion: version1451Schema,
    policyHash: hash,
    artifactType: z.literal("machine-review-items-v10"),
    items: z.array(reviewItem1451Schema),
    bindingHash: hash,
    semanticHash: hash,
  })
  .strict();

const reviewRegion1451Schema = reviewRegion145Schema
  .safeExtend({
    fullCoverageUnitIds: z.array(id),
    inheritedRealizationIds: z.array(id),
    unitBindingLedgerIds: z.array(id),
    productBindingStatus: id,
  })
  .strict();
export const reviewRegions1451Schema = reviewRegions145Schema
  .omit({
    policyVersion: true,
    policyHash: true,
    artifactType: true,
    semanticHash: true,
  })
  .extend({
    policyVersion: version1451Schema,
    policyHash: hash,
    artifactType: z.literal("machine-review-regions-v9"),
    regions: z.array(reviewRegion1451Schema),
    bindingHash: hash,
    semanticHash: hash,
  })
  .strict();

const reviewAudioRow1451Schema = reviewAudio145Schema.shape.audio.element
  .safeExtend({
    coveredFullCoverageUnitIds: z.array(id),
    audioUnitBindingLedgerIds: z.array(id),
    inheritedRealizationIds: z.array(id),
    actualUnitCoverageRatios: z.record(id, ratio),
    productBindingStatus: id,
  })
  .strict();
export const reviewAudio1451Schema = reviewAudio145Schema
  .omit({
    policyVersion: true,
    policyHash: true,
    artifactType: true,
    semanticHash: true,
  })
  .extend({
    policyVersion: version1451Schema,
    policyHash: hash,
    artifactType: z.literal("machine-review-audio-manifest-v9"),
    audio: z.array(reviewAudioRow1451Schema),
    bindingHash: hash,
    semanticHash: hash,
  })
  .strict();

const reviewPlaybackRow1451Schema =
  reviewPlayback145Schema.shape.segments.element
    .safeExtend({
      fullCoverageUnitIds: z.array(id),
      playbackUnitBindingLedgerIds: z.array(id),
      inheritedRealizationIds: z.array(id),
      actualUnitCoverageRatios: z.record(id, ratio),
      productBindingStatus: id,
    })
    .strict();
export const reviewPlayback1451Schema = reviewPlayback145Schema
  .omit({
    policyVersion: true,
    policyHash: true,
    artifactType: true,
    semanticHash: true,
  })
  .extend({
    policyVersion: version1451Schema,
    policyHash: hash,
    artifactType: z.literal("machine-review-playback-timeline-v8"),
    segments: z.array(reviewPlaybackRow1451Schema),
    bindingHash: hash,
    semanticHash: hash,
  })
  .strict();

export const freeze1451Schema = z
  .object({
    ...header1451Shape,
    artifactType: z.literal("c6-0-1-14-5-1-machine-registry-binding-freeze"),
    geometryFreezeHash: hash,
    fullRegistryHash: hash,
    sourceReconciliationHash: hash,
    planningProjectionHash: hash,
    compatibilityMapHash: hash,
    reviewBindingHash: hash,
    inheritedRealizationHash: hash,
    effectiveRealizationRegistryHash: hash,
    witnessGroupHash: hash,
    reviewDeliveryHashes: z.record(id, hash),
    mandatoryPlanHash: hash,
    scorabilityPolicyHash: hash,
    projectionHashes: z.record(id, hash),
    nestedPreflightHash: hash,
    reviewJavascriptHash: hash,
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

export const firstGoldRead1451Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    policyVersion: version1451Schema,
    policyHash: hash,
    sourceIdentity: c60114SourceIdentitySchema,
    sourceTimebase: z.literal("SOURCE_GLOBAL_NATIVE_SAMPLES"),
    visibility: z.literal("LOCAL_ONLY"),
    artifactType: z.literal("c6-0-1-14-5-1-first-gold-read-audit"),
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

export const witnessSearchStatus1451Schema = z.enum([
  "SCORABLE_SINGLE_UNIT_PASS",
  "SCORABLE_MULTI_UNIT_PASS",
  "SCORABLE_FAIL",
  "NOT_SCORABLE_NO_REGISTRY_UNIT",
  "NOT_SCORABLE_NO_TARGET_BINDING",
  "NOT_SCORABLE_NO_EFFECTIVE_REALIZATION",
  "NOT_SCORABLE_NO_PHYSICAL_AUDIO",
  "NOT_SCORABLE_NO_PLAYBACK",
  "NOT_SCORABLE_WITNESS_SEARCH_INCOMPLETE",
  "INTEGRITY_FAILED",
]);

const recall1451Schema = z
  .object({ numerator: count, denominator: count, ratio })
  .strict();

export const evaluationComponent1451Schema = z
  .object({
    componentId: id,
    status: witnessSearchStatus1451Schema,
    matchingFullCoverageUnitIds: z.array(id),
    matchingPlanningCoverageUnitIds: z.array(id),
    targetBindingIds: z.array(id),
    realizationOrigins: z.array(realizationOrigin1451Schema),
    witnessGroupIds: z.array(id),
    witnessGroupId: id.nullable(),
    fullCoverageUnitIds: z.array(id),
    effectiveRealizationIds: z.array(id),
    targetIds: z.array(id),
    audioIds: z.array(id),
    playbackSegmentIds: z.array(id),
    singleUnitWitnessStatus: witnessSearchStatus1451Schema,
    multiUnitWitnessStatus: witnessSearchStatus1451Schema,
    unitToGoldCoverageRatio: ratio,
    targetCoreGoldCoverageRatio: ratio,
    physicalAudioGoldCoverageRatio: ratio,
    playbackToGoldCoverageRatio: ratio,
    minimumUnitAnchorOverlapSeconds: nonnegative,
    minimumUnitAnchorCoverageRatio: ratio,
    minimumPlaybackCoverageOfUnitRatio: ratio,
    playbackCoverageByUnit: z.record(id, ratio),
    anchorCoverageByUnit: z.record(id, ratio),
    targetCorePassed: z.boolean(),
    physicalAudioPassed: z.boolean(),
    ordinaryPlaybackAudiblePassed: z.boolean(),
    productContractPassed: z.boolean(),
    finalBlockingReason: id.nullable(),
    finalDiagnosis: id,
    rejectionReasons: z.array(id),
    semanticHash: hash,
  })
  .strict();

const projectionEvaluation1451Schema = z
  .object({
    projectionId: z.enum(["R0", "R1", "R2", "R3", "R4", "R5", "R6", "R7"]),
    name: id,
    integrityStatus: z.enum(["PASS", "FAIL"]),
    scorabilityStatus: z.enum(["SCORABLE", "NOT_SCORABLE", "INTEGRITY_FAILED"]),
    fullRegistryUnitCount: count,
    registeredSpeechUnionSeconds: nonnegative,
    registryCoverageRatio: ratio,
    targetBindingCount: count,
    inheritedRealizationCount: count,
    effectiveRealizationCount: count,
    witnessGroupCount: count,
    singleUnitWitnessCount: count,
    multiUnitWitnessCount: count,
    reviewTargetCount: count,
    reviewRegionCount: count,
    physicalAudioCount: count,
    playbackSegmentCount: count,
    uniqueAudioSeconds: nonnegative,
    scorableComponentCount: count,
    productPassCount: count,
    productFailCount: count,
    productUnscorableCount: count,
    productRecall: recall1451Schema.nullable(),
    targetCoreRecall: recall1451Schema,
    ordinaryPhysicalAudioRecall: recall1451Schema,
    ordinaryPlaybackAudibleRecall: recall1451Schema,
    hallucinationRecall: recall1451Schema,
    semanticHash: hash,
  })
  .strict();

export const witnessEvaluation1451Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    policyVersion: version1451Schema,
    policyHash: hash,
    sourceIdentity: c60114SourceIdentitySchema,
    sourceTimebase: z.literal("SOURCE_GLOBAL_NATIVE_SAMPLES"),
    visibility: z.literal("LOCAL_ONLY"),
    artifactType: z.literal("gold-c6-0-1-14-5-1-multi-unit-witness-evaluation"),
    runtimeGoldInputCount: z.literal(1),
    machineFreezeHash: hash,
    witnessGroupHash: hash,
    witnessSearchComplete: z.boolean(),
    components: z.array(evaluationComponent1451Schema),
    singleUnitPassCount: count,
    multiUnitPassCount: count,
    scorableFailCount: count,
    unscorableCount: count,
    semanticHash: hash,
  })
  .strict();

export const evaluation1451Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    policyVersion: version1451Schema,
    policyHash: hash,
    sourceIdentity: c60114SourceIdentitySchema,
    sourceTimebase: z.literal("SOURCE_GLOBAL_NATIVE_SAMPLES"),
    visibility: z.literal("LOCAL_ONLY"),
    artifactType: z.literal(
      "gold-c6-0-1-14-5-1-registry-binding-contract-evaluation",
    ),
    runtimeGoldInputCount: z.literal(1),
    firstGoldReadAuditHash: hash,
    machineFreezeHash: hash,
    projections: z.array(projectionEvaluation1451Schema).length(8),
    components: z.array(evaluationComponent1451Schema),
    totalComponentCount: count,
    scorableComponentCount: count,
    scorablePassCount: count,
    scorableFailCount: count,
    unscorableComponentCount: count,
    integrityFailedComponentCount: count,
    formalRecallStatus: z.enum([
      "SCORABLE",
      "NOT_SCORABLE",
      "INTEGRITY_FAILED",
    ]),
    formalRecall: recall1451Schema.nullable(),
    measuredScorableSubsetRecall: recall1451Schema.nullable(),
    targetCoreRecall: recall1451Schema,
    ordinaryPhysicalAudioRecall: recall1451Schema,
    ordinaryPlaybackAnyOverlapRecall: recall1451Schema,
    ordinaryPlaybackAudibleRecall: recall1451Schema,
    ordinaryPlaybackFullRecall: recall1451Schema,
    hallucinationTargetRecall: recall1451Schema,
    hallucinationPhysicalAudioRecall: recall1451Schema,
    hallucinationPlaybackAudibleRecall: recall1451Schema,
    allMandatory: z
      .object({
        planId: z.literal("ALL_MANDATORY"),
        itemCount: count,
        regionCount: count,
        targetCount: count,
        audioCount: count,
        playbackSegmentCount: count,
        uniqueAudioSeconds: nonnegative,
        productScorability: z.enum([
          "SCORABLE",
          "NOT_SCORABLE",
          "INTEGRITY_FAILED",
        ]),
        productRecall: recall1451Schema.nullable(),
        targetCoreRecall: recall1451Schema,
        ordinaryAudibleRecall: recall1451Schema,
        hallucinationRecall: recall1451Schema,
      })
      .strict(),
    safetyCompletionStatus: z.enum(["PASS", "FAIL_CLOSED"]),
    goldReadOnly: z.literal(true),
    semanticHash: hash,
  })
  .strict();

export const route1451Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    policyVersion: version1451Schema,
    policyHash: hash,
    sourceIdentity: c60114SourceIdentitySchema,
    sourceTimebase: z.literal("SOURCE_GLOBAL_NATIVE_SAMPLES"),
    visibility: z.literal("LOCAL_ONLY"),
    artifactType: z.literal("c6-0-1-14-5-1-route-decision"),
    runtimeGoldInputCount: z.literal(1),
    evaluationHash: hash,
    route: z.enum([
      "GO_C6_0_1_15_REGION_RANKER_RECALIBRATION",
      "HOLD_FOR_EVALUATION_INTEGRITY_REPAIR",
      "HOLD_FOR_FULL_SPEECH_UNIT_REGISTRY_REPAIR",
      "HOLD_FOR_REVIEW_DELIVERY_UNIT_BINDING_REPAIR",
      "HOLD_FOR_INHERITED_REALIZATION_REPAIR",
      "HOLD_FOR_MULTI_UNIT_PRODUCT_WITNESS_REPAIR",
      "HOLD_FOR_CONTRACT_SCORABILITY_REPAIR",
      "HOLD_FOR_REMAINING_INVENTORY_TO_TARGET_COVERAGE_REPAIR",
      "HOLD_FOR_REVIEW_AUDIO_COVERAGE_REPAIR",
      "HOLD_FOR_SAFETY_BUDGET_MODEL_REDESIGN",
      "HOLD_FOR_ENGINEERING_REPAIR",
    ]),
    gates: z.array(z.object({ name: id, passed: z.boolean() }).strict()),
    blockingReasons: z.array(id),
    advisories: z.array(id),
    machineOnlyReleaseAuthorized: z.literal(false),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    c602Status: z.literal("HOLD"),
    semanticHash: hash,
  })
  .strict();

export const shareableSummary1451Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("c6-0-1-14-5-1-aggregate-shareable-summary"),
    visibility: z.literal("SHAREABLE_AGGREGATE_ONLY"),
    policyVersion: version1451Schema,
    policyHash: hash,
    fullRegistryUnitCount: count,
    registeredVerifiedSpeechUnionSeconds: nonnegative,
    registeredVerifiedSpeechCoverageRatio: ratio,
    unregisteredVerifiedSpeechSamples: count,
    planningUnitCount: count,
    targetCount: count,
    requiredTargetCount: count,
    requiredTargetBoundCount: count,
    requiredTargetUnboundCount: count,
    targetUnitPairCount: count,
    audioUnitPairCount: count,
    playbackUnitPairCount: count,
    inheritedRealizationCount: count,
    effectiveProductRealizationCount: count,
    witnessGroupCount: count,
    singleUnitWitnessCount: count,
    multiUnitWitnessCount: count,
    scorableComponentCount: count,
    scorablePassCount: count,
    scorableFailCount: count,
    unscorableComponentCount: count,
    formalRecallStatus: z.enum([
      "SCORABLE",
      "NOT_SCORABLE",
      "INTEGRITY_FAILED",
    ]),
    formalRecall: recall1451Schema.nullable(),
    targetCoreRecall: recall1451Schema,
    ordinaryPhysicalAudioRecall: recall1451Schema,
    ordinaryPlaybackAudibleRecall: recall1451Schema,
    hallucinationPlaybackAudibleRecall: recall1451Schema,
    mandatory: z
      .object({
        itemCount: count,
        regionCount: count,
        targetCount: count,
        audioCount: count,
        playbackSegmentCount: count,
        uniqueAudioSeconds: nonnegative,
        productScorability: z.enum([
          "SCORABLE",
          "NOT_SCORABLE",
          "INTEGRITY_FAILED",
        ]),
        productRecall: recall1451Schema.nullable(),
      })
      .strict(),
    machineFreezeHash: hash,
    evaluationHash: hash,
    routeHash: hash,
    route: route1451Schema.shape.route,
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    c602Status: z.literal("HOLD"),
    semanticHash: hash,
  })
  .strict();

export const shareableAudit1451Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("c6-0-1-14-5-1-shareable-audit"),
    visibility: z.literal("SHAREABLE_AUDIT"),
    summaryHash: hash,
    pathPolicy: z.literal("NO_ABSOLUTE_OR_LOCAL_PATHS"),
    aggregateOnly: z.literal(true),
    absolutePathLeakCount: z.literal(0),
    secretFindingCount: z.literal(0),
    rawAudioReferenceCount: z.literal(0),
    dialogueTextFindingCount: z.literal(0),
    goldContentFindingCount: z.literal(0),
    credentialFindingCount: z.literal(0),
    passed: z.literal(true),
    semanticHash: hash,
  })
  .strict();

export const validation1451Schema = z
  .object({
    ...header1451Shape,
    artifactType: z.literal("c6-0-1-14-5-1-validation"),
    checks: z.array(
      z
        .object({ name: id, passed: z.boolean(), details: z.array(id) })
        .strict(),
    ),
    passedCount: count,
    failedCount: z.literal(0),
    allPassed: z.literal(true),
  })
  .strict();

export type Policy1451 = z.infer<typeof policy1451Schema>;
export type BaselineAudit1451 = z.infer<typeof baselineAudit1451Schema>;
export type FullRegistry1451 = z.infer<typeof fullRegistry1451Schema>;
export type FullRegistryUnit1451 = z.infer<typeof fullRegistryUnit1451Schema>;
export type SourceReconciliation1451 = z.infer<
  typeof sourceReconciliation1451Schema
>;
export type PlanningProjection1451 = z.infer<
  typeof planningProjection1451Schema
>;
export type CompatibilityMap1451 = z.infer<typeof compatibilityMap1451Schema>;
export type ReviewBinding1451 = z.infer<typeof reviewBinding1451Schema>;
export type InheritedRealizations1451 = z.infer<
  typeof inheritedRealizations1451Schema
>;
export type EffectiveRealizations1451 = z.infer<
  typeof effectiveRealizations1451Schema
>;
export type WitnessGroups1451 = z.infer<typeof witnessGroups1451Schema>;
export type Evaluation1451 = z.infer<typeof evaluation1451Schema>;
export type Route1451 = z.infer<typeof route1451Schema>;
export type ShareableSummary1451 = z.infer<typeof shareableSummary1451Schema>;
export type ShareableAudit1451 = z.infer<typeof shareableAudit1451Schema>;

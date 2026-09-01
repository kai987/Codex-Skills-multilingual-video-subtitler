import { z } from "zod";
import { c60114SourceIdentitySchema } from "./c6-0-1-14-evidence-schemas.js";

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const id = z.string().min(1);
const count = z.number().int().nonnegative();
const ratio = z.number().min(0).max(1);

export const version1431Schema = z.literal(
  "c6.0.1.14.3.1-projection-hash-integrity-v1",
);
export const hashDomain1431Schema = z.enum([
  "SOURCE_WORKSPACE_AUDIO_ROW",
  "STRICT_C601143_COVERAGE_AUDIO_PROJECTION_ROW",
  "STRICT_C601143_COVERAGE_PLAYBACK_PROJECTION_ROW",
  "C601143_PROJECTION_VARIANT",
  "C601143_PROJECTION_SET",
]);
export const integrityFailureCode1431Schema = z.enum([
  "SOURCE_ROW_HASH_INVALID",
  "PROJECTED_ROW_HASH_STALE",
  "PROJECTED_ROW_HASH_MISSING",
  "PROJECTED_ROW_SCHEMA_INVALID",
  "NESTED_ROW_HASH_INVALID",
  "OUTER_HASH_VALID_NESTED_HASH_INVALID",
  "HASH_DOMAIN_NOT_REBOUND",
  "UNKNOWN_HASHABLE_ROW_TYPE",
]);

const header = {
  schemaVersion: z.literal("1.0.0"),
  policyVersion: version1431Schema,
  visibility: z.literal("LOCAL_ONLY"),
  semanticHash: hash,
};
export const projectionIntegrityPolicy1431Schema = z
  .object({
    ...header,
    artifactType: z.literal("c6-0-1-14-3-1-projection-integrity-policy"),
    executionPolicy: z.literal("replay-only"),
    sourceDomain: z.literal("SOURCE_WORKSPACE_AUDIO_ROW"),
    projectedDomain: z.literal("STRICT_C601143_COVERAGE_AUDIO_PROJECTION_ROW"),
    requiredOperationOrder: z.tuple([
      z.literal("ASSERT_SOURCE_HASH"),
      z.literal("PROJECT_FIELDS"),
      z.literal("REMOVE_OLD_SEMANTIC_HASH"),
      z.literal("COMPUTE_CANONICAL_PROJECTED_HASH"),
      z.literal("STRICT_SCHEMA_PARSE"),
      z.literal("ASSERT_PROJECTED_HASH"),
    ]),
    canonicalHashHelper: z.literal("hashed141"),
    preGoldNestedPreflightRequired: z.literal(true),
    unknownHashableRowFailsClosed: z.literal(true),
    maximumInferenceCount: z.literal(0),
    maximumModelLoadCount: z.literal(0),
    maximumProviderProcessStartCount: z.literal(0),
    canonicalMutationAllowed: z.literal(false),
  })
  .strict();

export const integrityFailure1431Schema = z
  .object({
    code: integrityFailureCode1431Schema,
    path: id,
    domain: hashDomain1431Schema.nullable(),
    expectedHash: hash.nullable(),
    actualHash: hash.nullable(),
  })
  .strict();

export const baselineHashFailure1431Schema = z
  .object({
    ...header,
    artifactType: z.literal("c6-0-1-14-3-1-baseline-hash-failure-reproduction"),
    sourceIdentity: c60114SourceIdentitySchema,
    sourceWorkspaceAudioRows: count,
    sourceWorkspaceAudioHashesValid: count,
    strictProjectedAudioRows: count,
    staleProjectedAudioHashReuseCount: count,
    strictProjectedAudioHashesValid: count,
    playbackRows: count,
    playbackHashesValid: count,
    affectedStages: z.array(
      z.enum(["A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7"]),
    ),
    reproduced: z.boolean(),
    failures: z.array(integrityFailure1431Schema),
    goldReadAttempted: z.literal(false),
    inferenceCount: z.literal(0),
  })
  .strict()
  .refine(
    (value) =>
      value.reproduced ===
      (value.staleProjectedAudioHashReuseCount > 0 &&
        value.strictProjectedAudioHashesValid < value.strictProjectedAudioRows),
    "Reproduction status must reflect stale projected hashes",
  );

export const projectionRebindingLedgerEntry1431Schema = z
  .object({
    audioId: id,
    sourceDomain: z.literal("SOURCE_WORKSPACE_AUDIO_ROW"),
    projectedDomain: z.literal("STRICT_C601143_COVERAGE_AUDIO_PROJECTION_ROW"),
    sourceSemanticHash: hash,
    projectedSemanticHash: hash,
    sourceHashValid: z.literal(true),
    projectedHashValid: z.literal(true),
    projectedSchemaValid: z.literal(true),
    hashDomainRebound: z.literal(true),
    removedFields: z.tuple([z.literal("nativeSourceInterval")]),
    audioByteHashPreserved: z.literal(true),
    physicalMetadataPreserved: z.literal(true),
  })
  .strict();
export const projectionRebindingLedger1431Schema = z
  .object({
    ...header,
    artifactType: z.literal("machine-projection-hash-rebinding-ledger"),
    sourceIdentity: c60114SourceIdentitySchema,
    entries: z.array(projectionRebindingLedgerEntry1431Schema),
    sourceRowCount: count,
    projectedRowCount: count,
    reboundRowCount: count,
    sourceHashesValid: count,
    projectedHashesValid: count,
    projectedSchemasValid: count,
    failureCount: z.literal(0),
    inferenceCount: z.literal(0),
    goldInputCount: z.literal(0),
  })
  .strict()
  .refine(
    (value) =>
      value.entries.length === value.sourceRowCount &&
      value.sourceRowCount === value.projectedRowCount &&
      value.projectedRowCount === value.reboundRowCount &&
      value.reboundRowCount === value.sourceHashesValid &&
      value.sourceHashesValid === value.projectedHashesValid &&
      value.projectedHashesValid === value.projectedSchemasValid,
    "Every source row must be validated and rebound exactly once",
  );

export const nestedPreflight1431Schema = z
  .object({
    ...header,
    artifactType: z.literal(
      "c6-0-1-14-3-1-nested-semantic-integrity-preflight",
    ),
    scope: z.literal("PRE_GOLD_MACHINE_FREEZE"),
    projectionSetHash: hash,
    sourceIdentity: c60114SourceIdentitySchema,
    projectionVariantCount: count,
    inspectedOuterHashCount: count,
    validOuterHashCount: count,
    projectedAudioRowCount: count,
    validProjectedAudioHashCount: count,
    playbackRowCount: count,
    validPlaybackHashCount: count,
    unknownHashableRowCount: count,
    failures: z.array(integrityFailure1431Schema),
    integrityPassed: z.boolean(),
    goldReadAttempted: z.literal(false),
    inferenceCount: z.literal(0),
  })
  .strict()
  .refine(
    (value) =>
      value.integrityPassed ===
      (value.failures.length === 0 &&
        value.inspectedOuterHashCount === value.validOuterHashCount &&
        value.projectedAudioRowCount === value.validProjectedAudioHashCount &&
        value.playbackRowCount === value.validPlaybackHashCount &&
        value.unknownHashableRowCount === 0),
    "Nested integrity pass must reflect every recursively validated hash",
  );

export const projectionChangeAudit1431Schema = z
  .object({
    ...header,
    artifactType: z.literal("c6-0-1-14-3-1-projection-change-audit"),
    beforeProjectionSetHash: hash,
    afterProjectionSetHash: hash,
    allowedChangeClasses: z.tuple([
      z.literal("PROJECTED_AUDIO_ROW_SEMANTIC_HASH"),
      z.literal("PROJECTION_VARIANT_SEMANTIC_HASH"),
      z.literal("PROJECTION_SET_SEMANTIC_HASH"),
      z.literal("UPSTREAM_FREEZE_BINDING_HASH"),
    ]),
    changedProjectedAudioHashCount: count,
    changedVariantHashCount: count,
    changedOuterHashCount: count,
    playbackRowsByteEquivalent: z.boolean(),
    plannerEquivalent: z.boolean(),
    targetEquivalent: z.boolean(),
    regionEquivalent: z.boolean(),
    audioBytesEquivalent: z.boolean(),
    playbackIntervalsEquivalent: z.boolean(),
    rowCountsEquivalent: z.boolean(),
    canonicalTextEquivalent: z.boolean(),
    canonicalTimingEquivalent: z.boolean(),
    presentationEquivalent: z.boolean(),
    forbiddenChanges: z.array(id),
    passed: z.boolean(),
  })
  .strict()
  .refine(
    (value) =>
      value.passed ===
      (value.forbiddenChanges.length === 0 &&
        value.playbackRowsByteEquivalent &&
        value.plannerEquivalent &&
        value.targetEquivalent &&
        value.regionEquivalent &&
        value.audioBytesEquivalent &&
        value.playbackIntervalsEquivalent &&
        value.rowCountsEquivalent &&
        value.canonicalTextEquivalent &&
        value.canonicalTimingEquivalent &&
        value.presentationEquivalent),
    "Projection change audit may pass only for the declared hash-only changes",
  );

export const machineRefreeze1431Schema = z
  .object({
    ...header,
    artifactType: z.literal("c6-0-1-14-3-1-machine-refreeze"),
    sourceIdentity: c60114SourceIdentitySchema,
    finalAFreezeHash: hash,
    finalBFreezeHash: hash,
    finalAProjectionHash: hash,
    finalBProjectionHash: hash,
    rebindingLedgerHash: hash,
    changeAuditHash: hash,
    nestedPreflightHash: hash,
    finalABByteParity: z.literal(true),
    finalABSemanticParity: z.literal(true),
    wavHashParity: z.literal(true),
    wavPcmParity: z.literal(true),
    wavDurationParity: z.literal(true),
    wavMappingParity: z.literal(true),
    wavPlayableCount: count,
    detectorReplayHits: count,
    detectorReplayExpected: count,
    asrReplayHits: count,
    asrReplayExpected: count,
    cacheMissCount: z.literal(0),
    inferenceCount: z.literal(0),
    modelLoadCount: z.literal(0),
    providerProcessStartCount: z.literal(0),
    canonicalTextHash: hash,
    canonicalTimingHash: hash,
    presentationHash: hash,
    canonicalTextMutationCount: z.literal(0),
    canonicalTimingMutationCount: z.literal(0),
    presentationMutationCount: z.literal(0),
    goldReadStarted: z.literal(false),
    refreezePassed: z.literal(true),
  })
  .strict()
  .refine(
    (value) =>
      value.detectorReplayHits === value.detectorReplayExpected &&
      value.asrReplayHits === value.asrReplayExpected,
    "Machine refreeze requires exact cache replay completeness",
  );

const stageMetrics = z
  .object({
    stage: z.enum(["A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7"]),
    integrityFailureCount: z.literal(0),
    missingAudible: count,
    missingTotal: count,
    hallucinationAudible: count,
    hallucinationTotal: count,
  })
  .strict();
export const cleanEvaluation1431Schema = z
  .object({
    ...header,
    artifactType: z.literal("gold-c6-0-1-14-3-1-clean-evaluation"),
    generatedAt: z.iso.datetime(),
    machineRefreezeHash: hash,
    nestedPreflightHash: hash,
    sourceEvaluationHash: hash,
    firstGoldReadIntentHash: hash,
    integrityFailureCount: z.literal(0),
    evaluationIntegrityPassed: z.literal(true),
    stageMetrics: z.array(stageMetrics).length(8),
    officialStage: z.literal("A7"),
    missingAudible: count,
    missingTotal: count,
    hallucinationAudible: count,
    hallucinationTotal: count,
    matchingRulesChanged: z.literal(false),
    evaluatorInferenceCount: z.literal(0),
    canonicalMutationCount: z.literal(0),
  })
  .strict();

export const routeDecisionNames1431 = [
  "GO_C6_0_1_15_REGION_RANKER_RECALIBRATION",
  "HOLD_FOR_PROJECTION_HASH_INTEGRITY_REPAIR",
  "HOLD_FOR_NESTED_SEMANTIC_INTEGRITY_REPAIR",
  "HOLD_FOR_EVALUATION_INTEGRITY_REPAIR",
  "HOLD_FOR_HIERARCHICAL_TARGET_SELECTION_REPAIR",
  "HOLD_FOR_REVIEW_AUDIO_COVERAGE_REPAIR",
  "HOLD_FOR_ENGINEERING_REPAIR",
] as const;
export const route1431Schema = z
  .object({
    ...header,
    artifactType: z.literal("c6-0-1-14-3-1-route-decision"),
    primaryDecision: z.enum(routeDecisionNames1431),
    blockers: z.array(id),
    projectionHashIntegrityPassed: z.boolean(),
    nestedSemanticIntegrityPassed: z.boolean(),
    evaluationIntegrityPassed: z.boolean(),
    engineeringPassed: z.boolean(),
    plannerPassed: z.boolean(),
    finalTargetCoveragePassed: z.boolean(),
    reviewAudioCoveragePassed: z.boolean(),
    playbackCoveragePassed: z.boolean(),
    missingPlaybackAudible: z.object({ covered: count, total: count }).strict(),
    hallucinationPlaybackAudible: z
      .object({ covered: count, total: count })
      .strict(),
    inferenceCount: z.literal(0),
    modelLoadCount: z.literal(0),
    providerProcessStartCount: z.literal(0),
    canonicalTextMutationCount: z.literal(0),
    canonicalTimingMutationCount: z.literal(0),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    c602Status: z.literal("HOLD"),
  })
  .strict();

export const validation1431Schema = z
  .object({
    ...header,
    artifactType: z.literal("c6-0-1-14-3-1-validation"),
    generatedAt: z.iso.datetime(),
    checks: z.array(
      z.object({ id, passed: z.boolean(), evidenceHash: hash }).strict(),
    ),
    passed: z.boolean(),
    routeDecision: z.enum(routeDecisionNames1431),
    schemaValidatedArtifactCount: count,
    generatedSchemaCount: count,
    networkUsedForAcceptance: z.literal(false),
    realModelExecuted: z.literal(false),
    goldReadBeforeRefreeze: z.literal(false),
  })
  .strict()
  .refine(
    (value) => value.passed === value.checks.every((check) => check.passed),
    "Validation pass must reflect every check",
  );

export const shareable1431Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("c6-0-1-14-3-1-shareable-summary"),
    policyVersion: version1431Schema,
    visibility: z.literal("SHAREABLE_AGGREGATE_ONLY"),
    sourceRowCount: count,
    reboundRowCount: count,
    projectedHashValidityRatio: ratio,
    playbackHashValidityRatio: ratio,
    integrityFailureCount: count,
    detectorReplayHits: count,
    asrReplayHits: count,
    inferenceCount: z.literal(0),
    modelLoadCount: z.literal(0),
    providerProcessStartCount: z.literal(0),
    evaluationIntegrityPassed: z.boolean(),
    route: z.enum(routeDecisionNames1431),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    rawDialogueIncluded: z.literal(false),
    goldIncluded: z.literal(false),
    localPathsIncluded: z.literal(false),
    semanticHash: hash,
  })
  .strict();

export const c6011431IntegritySchemas = {
  "c6-0-1-14-3-1-projection-integrity-policy":
    projectionIntegrityPolicy1431Schema,
  "c6-0-1-14-3-1-baseline-hash-failure-reproduction":
    baselineHashFailure1431Schema,
  "machine-projection-hash-rebinding-ledger":
    projectionRebindingLedger1431Schema,
  "c6-0-1-14-3-1-nested-semantic-integrity-preflight":
    nestedPreflight1431Schema,
  "c6-0-1-14-3-1-projection-change-audit": projectionChangeAudit1431Schema,
  "c6-0-1-14-3-1-machine-refreeze": machineRefreeze1431Schema,
  "gold-c6-0-1-14-3-1-clean-evaluation": cleanEvaluation1431Schema,
  "c6-0-1-14-3-1-route-decision": route1431Schema,
  "c6-0-1-14-3-1-validation": validation1431Schema,
  "c6-0-1-14-3-1-shareable-summary": shareable1431Schema,
};

export type ProjectionIntegrityPolicy1431 = z.infer<
  typeof projectionIntegrityPolicy1431Schema
>;
export type BaselineHashFailure1431 = z.infer<
  typeof baselineHashFailure1431Schema
>;
export type ProjectionRebindingLedger1431 = z.infer<
  typeof projectionRebindingLedger1431Schema
>;
export type NestedPreflight1431 = z.infer<typeof nestedPreflight1431Schema>;
export type ProjectionChangeAudit1431 = z.infer<
  typeof projectionChangeAudit1431Schema
>;
export type MachineRefreeze1431 = z.infer<typeof machineRefreeze1431Schema>;
export type CleanEvaluation1431 = z.infer<typeof cleanEvaluation1431Schema>;
export type Route1431 = z.infer<typeof route1431Schema>;

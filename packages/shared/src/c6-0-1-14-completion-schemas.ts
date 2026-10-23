import { z } from "zod";
import {
  c60114Sha256Schema as hash,
  c60114IntervalSchema as interval,
  c60114CountSchema as count,
  c60114RatioSchema as ratio,
  c60114SourceIdentitySchema,
  c60114MachineArtifactHeader,
} from "./c6-0-1-14-evidence-schemas.js";
import { c60114ProbeProviderSchema } from "./c6-0-1-14-probe-schemas.js";

const ids = z.array(z.string().min(1));
export const c60114CompletionPolicySchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("c6-0-1-14-completion-policy"),
    policyVersion: z.literal("c6.0.1.14-completion-v1"),
    maximumNewInferenceCount: z.literal(0),
    maximumNewProviderProcessCount: z.literal(0),
    maximumModelLoadCount: z.literal(0),
    runtimeGoldInputCount: z.literal(0),
    cacheMode: z.literal("FROZEN_REQUEST_SET_READ_ONLY_NO_FALLBACK"),
    guardContactMaximumSeconds: z.literal(0.05),
    boundaryRoundingToleranceSeconds: z.literal(0.001),
    shadowTimeBinCount: z.literal(8),
    shadowExecutionAllowed: z.literal(false),
    lexicalCompletenessIsAdvisoryWhenAudible: z.literal(true),
    mandatorySubsetRecallIsReleaseGate: z.literal(false),
    rankerRecalibrationAllowed: z.literal(false),
    canonicalMutationAllowed: z.literal(false),
    semanticHash: hash,
  })
  .strict();
export const c60114RelocalizationStatusSchema = z.enum([
  "CORE_EXACT_ISLAND_LOCALIZED",
  "TRUSTED_GLOBAL_TOKEN_PROJECTION",
  "CORE_CLEAN_GUARD_CONTACT_ONLY",
  "CORE_CONTAMINATED_BY_NEIGHBOR",
  "CONTEXT_TEXT_UNPROJECTABLE",
  "CORE_LOCALIZATION_UNRESOLVED",
  "EMPTY",
  "FAILED",
]);
export const c60114RelocalizedRequestSchema = z
  .object({
    requestId: z.string().min(1),
    targetId: z.string().min(1),
    sourceIslandId: z.string().min(1),
    provider: c60114ProbeProviderSchema,
    windowType: z.enum(["CORE_EXACT", "CORE_CONTEXT"]),
    sourceInterval: interval,
    extractionInterval: interval,
    originalRequestSemanticHash: hash,
    originalRawOutputHash: hash.nullable(),
    status: c60114RelocalizationStatusSchema,
    localizedText: z.string().nullable(),
    candidateText: z.string(),
    coreNeighborOverlapSeconds: z.number().nonnegative(),
    guardNeighborOverlapSeconds: z.number().nonnegative(),
    coreBoundaryCrossingTokenCount: count,
    trustedProjectedTokenCount: count,
    projectedSourceIntervals: z.array(interval),
    wholeTokenChainVerified: z.boolean(),
    eligibleForCrossModelReconciliation: z.boolean(),
    localizationVerified: z.boolean(),
    guardContactCaution: z.boolean(),
    reasons: ids,
    semanticHash: hash,
  })
  .strict();
export const c60114ProbeRelocalizationSchema = z
  .object({
    ...c60114MachineArtifactHeader,
    artifactType: z.literal("machine-existing-probe-relocalization"),
    completionPolicyHash: hash,
    originalProbeSemanticHash: hash,
    originalSelectionHash: hash,
    requests: z.array(c60114RelocalizedRequestSchema),
    newInferenceCount: z.literal(0),
    originalResultsModified: z.literal(false),
    semanticHash: hash,
  })
  .strict();
export const c60114LineageStatusSchema = z.enum([
  "VERIFIED_EXISTING_TRANSFORM",
  "VERIFIED_FROM_PARENT_SAMPLE_CHAIN",
  "QUARANTINED_INSUFFICIENT_PROVENANCE",
  "QUARANTINED_CONFLICTING_TRANSFORM",
  "OUT_OF_SOURCE_BOUNDS",
  "NON_MONOTONIC_MAPPING",
]);
export const c60114LineageTransformSchema = z
  .object({
    transformHash: hash,
    parentArtifactSha256: hash,
    childArtifactSha256: hash,
    parentSampleRate: z.number().int().positive(),
    childSampleRate: z.number().int().positive(),
    parentStartSample: count,
    parentEndSample: count,
    childTotalSamples: count,
  })
  .strict();
export const c60114LineageReconciliationSchema = z
  .object({
    ...c60114MachineArtifactHeader,
    artifactType: z.literal("machine-source-global-lineage-reconciliation"),
    inputEvidenceHash: hash,
    artifactHashes: z.record(z.string(), hash),
    entries: z.array(
      z
        .object({
          evidenceId: z.string().min(1),
          originalStatus: z.enum(["VERIFIED", "QUARANTINED"]),
          family: z.string().min(1),
          artifactId: z.string().min(1),
          sourceIdentity: c60114SourceIdentitySchema,
          parentRequestIds: ids,
          transformChain: z.array(c60114LineageTransformSchema),
          expectedSourceInterval: interval.nullable(),
          recomputedSourceInterval: interval.nullable(),
          driftSeconds: z.number().nonnegative().nullable(),
          status: c60114LineageStatusSchema,
          reasons: ids,
          eligibleForSpeechIsland: z.boolean(),
          eligibleForLexicalLocalization: z.boolean(),
          nativeSpeechObservation: z.boolean(),
          semanticHash: hash,
        })
        .strict(),
    ),
    summary: z
      .object({
        originalVerifiedCount: count,
        originalQuarantinedCount: count,
        newlyVerifiedCount: count,
        remainingQuarantinedCount: count,
        statusCounts: z.record(c60114LineageStatusSchema, count),
        sourceGlobalInferenceCount: z.literal(0),
        coordinateGuessCount: z.literal(0),
      })
      .strict(),
    semanticHash: hash,
  })
  .strict();
const shadowCandidate = z
  .object({
    targetId: z.string().min(1),
    sourceIslandId: z.string().min(1),
    sourceInterval: interval,
    evidenceIds: ids,
    familyCount: count,
    independentSourceCount: count,
    speechStrength: ratio,
    uncoveredRatio: ratio,
    durationSeconds: z.number().positive(),
    mappingQuality: ratio,
    lexicalAbsence: z.boolean(),
    parentOrGlobalOrigin: z.enum(["CHILD", "GLOBAL", "ORPHAN"]),
    timelineBin: count,
    selected: z.boolean(),
    score: z.number(),
    reasonCodes: ids,
    executionStatus: z.literal("PROBE_NOT_RUN_AUTHORIZATION_EXHAUSTED"),
  })
  .strict();
export const c60114ProbeSelectionV2ShadowSchema = z
  .object({
    ...c60114MachineArtifactHeader,
    artifactType: z.literal(
      "machine-missing-dialogue-probe-selection-v2-shadow",
    ),
    completionPolicyHash: hash,
    originalSelectionHash: hash,
    executedTargetIds: ids,
    proposedTargetIds: ids,
    addedTargetIds: ids,
    removedTargetIds: ids,
    highValueBudgetExhaustedTargetIds: ids,
    targets: z.array(shadowCandidate),
    context: z.array(
      z
        .object({
          targetId: z.string().min(1),
          score: z.number(),
          selected: z.boolean(),
          previouslySelected: z.boolean(),
          timelineBin: count,
          reasonCodes: ids,
          executionStatus: z.literal("PROBE_NOT_RUN_AUTHORIZATION_EXHAUSTED"),
        })
        .strict(),
    ),
    newInferenceCount: z.literal(0),
    goldUsed: z.literal(false),
    semanticHash: hash,
  })
  .strict();
export const c60114ExistingProbeReplaySchema = z
  .object({
    ...c60114MachineArtifactHeader,
    artifactType: z.literal("c6-0-1-14-existing-probe-replay-receipt"),
    completionPolicyHash: hash,
    originalProbeByteHash: hash,
    originalProbeSemanticHash: hash,
    selectionHash: hash,
    requestSetHash: hash,
    cacheInventoryHash: hash,
    requestIds: ids,
    cacheHitCount: count,
    cacheMissCount: z.literal(0),
    newInferenceCount: z.literal(0),
    physicalAudioVerificationStatus: z.enum(["VERIFIED", "NOT_REQUESTED"]),
    physicalAudioCount: count,
    modelLoadCount: z.literal(0),
    providerProcessStartCount: z.literal(0),
    inferenceBudgetRemaining: z.literal(0),
    cacheReadOnlyVerified: z.literal(true),
    rows: z.array(
      z
        .object({
          requestId: z.string().min(1),
          cacheKey: hash,
          cacheByteHash: hash,
          rawOutputHash: hash,
          requestSemanticHash: hash,
          provider: c60114ProbeProviderSchema,
          audioSha256: hash,
          runtimeIdentityHash: hash,
          modelIdentityHash: hash,
        })
        .strict(),
    ),
    semanticHash: hash,
  })
  .strict();
export type C60114RelocalizedRequest = z.infer<
  typeof c60114RelocalizedRequestSchema
>;
export type C60114ProbeRelocalization = z.infer<
  typeof c60114ProbeRelocalizationSchema
>;
export type C60114LineageReconciliation = z.infer<
  typeof c60114LineageReconciliationSchema
>;
export type C60114LineageTransform = z.infer<
  typeof c60114LineageTransformSchema
>;
export type C60114ProbeSelectionV2Shadow = z.infer<
  typeof c60114ProbeSelectionV2ShadowSchema
>;
export type C60114ExistingProbeReplay = z.infer<
  typeof c60114ExistingProbeReplaySchema
>;

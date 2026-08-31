import { z } from "zod";
import {
  c60114ParentGapSchema,
  c60114SourceIdentitySchema,
} from "./c6-0-1-14-evidence-schemas.js";

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const c60114PreProbeFreezeSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("c6-0-1-14-pre-probe-freeze"),
    policyHash: hash,
    selectionHash: hash,
    policyByteHash: hash,
    selectionByteHash: hash,
    sourceIdentity: c60114SourceIdentitySchema,
    runtimeGoldInputCount: z.literal(0),
    frozenAt: z.iso.datetime(),
    semanticHash: hash,
  })
  .strict();
export type C60114PreProbeFreeze = z.infer<typeof c60114PreProbeFreezeSchema>;
const interval = z
  .object({ start: z.number().nonnegative(), end: z.number().positive() })
  .strict()
  .refine((v) => v.end > v.start);
export const c60114ProbeProviderSchema = z.enum([
  "whisper-large-v3",
  "reazonspeech-k2-v2",
]);
export const c60114ProbeProviderAccountingSchema = z
  .object({
    inferenceAttemptCount: z.number().int().nonnegative(),
    actualFreshInferences: z.number().int().nonnegative(),
    cacheHits: z.number().int().nonnegative(),
    failedRequests: z.number().int().nonnegative(),
    emptyOutputs: z.number().int().nonnegative(),
    modelLoadCount: z.number().int().nonnegative(),
    processStartCount: z.number().int().nonnegative(),
  })
  .strict();
export const c60114ProbeTokenSchema = z
  .object({
    text: z.string(),
    sourceInterval: interval.nullable(),
    trusted: z.boolean(),
    probability: z.number().min(0).max(1).nullable(),
    reason: z.string(),
  })
  .strict();
export const c60114ProbeRuntimeSchema = z
  .object({
    provider: c60114ProbeProviderSchema,
    modelId: z.string().min(1),
    modelRevision: z.string().min(1),
    modelIdentityHash: hash,
    runtimeIdentityHash: hash,
    modelFileHashes: z.record(z.string(), hash),
    manifestSha256: hash,
    binarySha256: hash,
    workerSha256: hash.nullable(),
    precision: z.string().min(1),
    device: z.string().min(1),
    verified: z.literal(true),
  })
  .strict();
export const c60114ProbeRequestSchema = z
  .object({
    requestId: z.string().min(1),
    targetId: z.string().min(1),
    provider: c60114ProbeProviderSchema,
    windowType: z.enum(["CORE_EXACT", "CORE_CONTEXT"]),
    coreInterval: interval,
    extractionInterval: interval,
    sourceMediaSha256: hash,
    sourceIdentityHash: hash,
    policyHash: hash,
    selectionHash: hash,
    audioSha256: hash.nullable(),
    sampleCount: z.number().int().positive().nullable(),
    extractionIdentityHash: hash,
    cacheKey: hash,
    runtimeIdentityHash: hash,
    modelIdentityHash: hash,
    prompt: z.literal(""),
    vadEnabled: z.literal(false),
    status: z.enum([
      "SUCCESS",
      "EMPTY_OUTPUT",
      "PROVIDER_ERROR",
      "EXTRACTION_ERROR",
      "CACHE_MISS",
      "CACHE_INVALID",
    ]),
    execution: z.enum([
      "FRESH_INFERENCE",
      "FRESH_ATTEMPT_FAILED",
      "VERIFIED_EXACT_REPLAY",
      "NOT_EXECUTED",
    ]),
    rawText: z.string(),
    rawOutput: z.json().nullable(),
    rawOutputHash: hash.nullable(),
    tokens: z.array(c60114ProbeTokenSchema),
    decoder: z
      .object({
        averageLogProbability: z.number().nullable(),
        noSpeechProbability: z.number().min(0).max(1).nullable(),
        temperature: z.number().nullable(),
      })
      .strict(),
    localization: z
      .object({
        status: z.enum([
          "CORE_EXACT_ISLAND_LOCALIZED",
          "TRUSTED_GLOBAL_TOKEN_PROJECTION",
          "CONTEXT_TEXT_UNPROJECTABLE",
          "CORE_GUARD_OR_NEIGHBOR_UNRESOLVED",
          "EMPTY",
          "FAILED",
        ]),
        localizedText: z.string().nullable(),
        guardSeconds: z.number().nonnegative(),
        guardNeighborOverlapSeconds: z.number().nonnegative(),
        coreNeighborOverlapSeconds: z.number().nonnegative(),
        completeness: z.enum([
          "WHOLE_EXACT_ISLAND",
          "TOKEN_CHAIN_COMPLETE",
          "PARTIAL",
          "UNKNOWN",
          "EMPTY",
        ]),
        projectionTokenCount: z.number().int().nonnegative(),
        reasons: z.array(z.string()),
      })
      .strict(),
    hallucinationRisk: z.number().min(0).max(1),
    errorCode: z.string().nullable(),
    warnings: z.array(z.string()),
    wallClockSeconds: z.number().nonnegative(),
    semanticHash: hash,
  })
  .strict();
export const c60114ProbeRawResultSchema = z
  .object({
    inferenceExecuted: z.boolean().optional(),
    status: z.enum(["SUCCESS", "EMPTY_OUTPUT", "PROVIDER_ERROR"]),
    text: z.string(),
    rawOutput: z.json().nullable(),
    tokens: z.array(c60114ProbeTokenSchema),
    decoder: c60114ProbeRequestSchema.shape.decoder,
    warnings: z.array(z.string()),
    wallClockSeconds: z.number().nonnegative(),
  })
  .strict();
export const c60114ProbeJournalSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("c6-0-1-14-probe-request-journal"),
    sourceIdentity: c60114SourceIdentitySchema,
    sourceTimebase: z.literal("SOURCE_GLOBAL_SECONDS"),
    runtimeGoldInputCount: z.literal(0),
    requestId: z.string().min(1),
    sourceIdentityHash: hash,
    sourceMediaSha256: hash,
    policyHash: hash,
    selectionHash: hash,
    phase: z.enum([
      "PROVIDER_RAW",
      "NORMALIZED_RESULT",
      "INFERENCE_DISPATCH",
      "FINAL_REQUEST",
    ]),
    request: c60114ProbeRequestSchema,
    payload: z.json(),
    journalHash: hash,
  })
  .strict();
export const c60114ProbePersistenceSchema = z
  .object({
    resultCount: z.number().int().nonnegative(),
    persistedSuccessCount: z.number().int().nonnegative(),
    entries: z.array(
      z
        .object({
          requestId: z.string().min(1),
          cacheKey: hash,
          provider: c60114ProbeProviderSchema,
          status: c60114ProbeRequestSchema.shape.status,
          requestSemanticHash: hash,
          rawOutputHash: hash.nullable(),
          cacheByteSha256: hash,
        })
        .strict(),
    ),
    semanticHash: hash,
  })
  .strict();
export const c60114ProbeBudgetExceptionSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("c6-0-1-14-probe-budget-exception"),
    authorizationId: z.string().min(1),
    authorizationHash: hash,
    authorizedBy: z.literal("USER_EXPLICIT"),
    authorizedAt: z.iso.datetime(),
    sourceIdentityHash: hash,
    policyHash: hash,
    selectionHash: hash,
    originalProbeByteHash: hash,
    lossAuditByteHash: hash,
    previousConsumedInferences: z.number().int().nonnegative(),
    previousPersistedSuccessCount: z.number().int().nonnegative(),
    previousLostRawResultCount: z.number().int().nonnegative(),
    maxAdditionalInferences: z.number().int().positive().max(2),
    maxCumulativeInferences: z.number().int().positive().max(66),
    affectedRequestIds: z.array(z.string().min(1)).min(1).max(2),
    semanticHash: hash,
  })
  .strict();
export type C60114ProbeBudgetException = z.infer<
  typeof c60114ProbeBudgetExceptionSchema
>;
export const c60114ProbeCacheManifestSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("c6-0-1-14-probe-cache-manifest-local-only"),
    sourceIdentity: c60114SourceIdentitySchema,
    sourceTimebase: z.literal("SOURCE_GLOBAL_SECONDS"),
    runtimeGoldInputCount: z.literal(0),
    policyHash: hash,
    selectionHash: hash,
    probeSemanticHash: hash,
    cacheNamespace: z.literal("c6.0.1.14-missing-local-probes-v1"),
    cacheDirectory: z.string().min(1),
    persistence: c60114ProbePersistenceSchema,
  })
  .strict();
export const c60114ProbeCompletionCheckpointSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("c6-0-1-14-probe-completion-checkpoint"),
    sourceIdentity: c60114SourceIdentitySchema,
    sourceTimebase: z.literal("SOURCE_GLOBAL_SECONDS"),
    runtimeGoldInputCount: z.literal(0),
    payload: z.json(),
    checkpointHash: hash,
  })
  .strict();
export const c60114ProbeExecutionSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("missing-dialogue-local-probe"),
    policyVersion: z.literal(
      "c6.0.1.14-missing-localization-playback-integrity-v1",
    ),
    generatedAt: z.string(),
    policyHash: hash,
    selectionHash: hash,
    sourceIdentityHash: hash,
    sourceIdentity: c60114SourceIdentitySchema,
    sourceTimebase: z.literal("SOURCE_GLOBAL_SECONDS"),
    runtimeGoldInputCount: z.literal(0),
    cacheNamespace: z.literal("c6.0.1.14-missing-local-probes-v1"),
    mode: z.enum(["fresh", "exact-cache-only", "completion-inherited-fresh"]),
    persistence: c60114ProbePersistenceSchema.optional(),
    budgetException: c60114ProbeBudgetExceptionSchema.optional(),
    completion: z
      .object({
        originalProbeByteHash: hash,
        originalProbeSemanticHash: hash,
        inheritedFreshCount: z.number().int().nonnegative(),
        supplementalFreshCount: z.number().int().nonnegative(),
        originalFailedRequestCount: z.number().int().nonnegative(),
        completedRequestIds: z.array(z.string()),
        extractionRepair: z.literal(
          "SOURCE_VIDEO_EXACT_SAMPLE_TRIM_NO_PADDING",
        ),
        policyUnchanged: z.literal(true),
        selectionUnchanged: z.literal(true),
        successfulRequestsRerun: z.literal(0),
        originalContextSelection: z.array(
          z
            .object({
              targetId: z.string(),
              selected: z.boolean(),
              reasons: z.array(z.string()),
            })
            .strict(),
        ),
        repairs: z.array(
          z
            .object({
              requestId: z.string(),
              sourceInterval: interval,
              expectedSampleCount: z.number().int().positive(),
              actualSampleCount: z.number().int().positive(),
              audioSha256: hash,
            })
            .strict(),
        ),
      })
      .strict()
      .optional(),
    runtime: z.array(c60114ProbeRuntimeSchema).length(2),
    requests: z.array(c60114ProbeRequestSchema).max(64),
    contextSelection: z.array(
      z
        .object({
          targetId: z.string(),
          selected: z.boolean(),
          reasons: z.array(z.string()),
        })
        .strict(),
    ),
    accounting: z
      .object({
        selectedTargets: z.number().int().min(0).max(24),
        contextTargets: z.number().int().min(0).max(8),
        plannedRequests: z.number().int().min(0).max(64),
        actualFreshInferences: z.number().int().nonnegative(),
        inferenceAttemptCount: z.number().int().nonnegative(),
        cacheHits: z.number().int().nonnegative(),
        cacheMisses: z.number().int().nonnegative(),
        extractionCount: z.number().int().nonnegative(),
        extractionFailures: z.number().int().nonnegative(),
        modelLoadCount: z.number().int().nonnegative(),
        processStartCount: z.number().int().nonnegative(),
        failedRequests: z.number().int().nonnegative(),
        emptyOutputs: z.number().int().nonnegative(),
        fullMediaRequests: z.literal(0),
        sourceMutationCount: z.literal(0),
        promptLeakageCount: z.literal(0),
        canonicalMutationCount: z.literal(0),
        perProvider: z
          .object({
            "whisper-large-v3": c60114ProbeProviderAccountingSchema,
            "reazonspeech-k2-v2": c60114ProbeProviderAccountingSchema,
          })
          .strict(),
      })
      .strict(),
    semanticHash: hash,
  })
  .strict();
export const c60114ProbeFailureAuditSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("c6-0-1-14-probe-bounded-failure-audit"),
    policyVersion: z.literal(
      "c6.0.1.14-missing-localization-playback-integrity-v1",
    ),
    status: z.literal("BLOCKED_RAW_RESULTS_NOT_PERSISTED"),
    sourceIdentity: c60114SourceIdentitySchema,
    sourceTimebase: z.literal("SOURCE_GLOBAL_SECONDS"),
    runtimeGoldInputCount: z.literal(0),
    policyHash: hash,
    selectionHash: hash,
    freezeSemanticHash: hash,
    originalProbeByteSha256: hash,
    originalProbeSemanticHash: hash,
    completionFailureStatusByteSha256: hash,
    accounting: z
      .object({
        selectedTargets: z.number().int().min(0).max(24),
        contextTargets: z.number().int().min(0).max(8),
        plannedRequests: z.number().int().min(0).max(64),
        originalActualFreshInferences: z.number().int().nonnegative(),
        supplementalActualFreshInferences: z.number().int().nonnegative(),
        cumulativeActualFreshInferences: z.number().int().nonnegative(),
        remainingAuthorizedInferences: z.literal(0),
        originalCacheJsonRecords: z.number().int().nonnegative(),
        originalSuccessRawRecords: z.number().int().nonnegative(),
        originalExtractionErrorRecords: z.number().int().nonnegative(),
        completedCacheJsonRecords: z.number().int().nonnegative(),
        supplementalRawResultsLost: z.number().int().positive(),
        cumulativeModelLoadCount: z.number().int().nonnegative(),
        cumulativeProcessStartCount: z.number().int().nonnegative(),
        perProviderCumulativeActualFreshInferences: z
          .object({
            "whisper-large-v3": z.number().int().nonnegative(),
            "reazonspeech-k2-v2": z.number().int().nonnegative(),
          })
          .strict(),
        perProviderCumulativeModelLoadCount: z
          .object({
            "whisper-large-v3": z.number().int().nonnegative(),
            "reazonspeech-k2-v2": z.number().int().nonnegative(),
          })
          .strict(),
        perProviderCumulativeProcessStartCount: z
          .object({
            "whisper-large-v3": z.number().int().nonnegative(),
            "reazonspeech-k2-v2": z.number().int().nonnegative(),
          })
          .strict(),
        fullMediaInferenceCount: z.literal(0),
        canonicalMutationCount: z.literal(0),
        sourceMutationCount: z.literal(0),
      })
      .strict(),
    repairedAudio: z
      .object({
        sourceInterval: interval,
        sampleRate: z.literal(16000),
        sampleCount: z.number().int().positive(),
        channels: z.literal(1),
        bitsPerSample: z.literal(16),
        audioSha256: hash,
        method: z.literal("SOURCE_VIDEO_EXACT_SAMPLE_TRIM_NO_PADDING"),
        originalSampleCount: z.number().int().positive(),
        sourceDecodedPrefixMatchesOriginal: z.literal(true),
      })
      .strict(),
    unpersistedRequests: z.array(
      z
        .object({
          requestId: z.string().min(1),
          provider: c60114ProbeProviderSchema,
          observedProviderStatus: z.literal("SUCCESS"),
          observedExecution: z.literal("FRESH_INFERENCE"),
          rawResultStatus: z.literal("NOT_PERSISTED"),
          lexicalEvidenceAvailable: z.literal(false),
        })
        .strict(),
    ),
    failure: z
      .object({
        type: z.string(),
        code: z.string(),
        path: z.array(z.string()),
        keys: z.array(z.string()),
        stage: z.string(),
        cause: z.string(),
        processExitCode: z.number().int(),
      })
      .strict(),
    recoveryInspection: z
      .object({
        scope: z.array(z.string()),
        findings: z.array(z.string()),
        rawRecoveryPossibleFromVerifiedArtifacts: z.literal(false),
      })
      .strict(),
    replayStatus: z.literal("NOT_RUN_RAW_RESULTS_MISSING"),
    completionAccepted: z.literal(false),
    additionalInferenceForbiddenWithoutExplicitNewAuthorization:
      z.literal(true),
  })
  .strict();
export const c60114LocalizedLexicalEvidenceSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("localized-missing-lexical-evidence"),
    policyVersion: z.literal(
      "c6.0.1.14-missing-localization-playback-integrity-v1",
    ),
    sourceIdentityHash: hash,
    sourceIdentity: c60114SourceIdentitySchema,
    sourceTimebase: z.literal("SOURCE_GLOBAL_SECONDS"),
    runtimeGoldInputCount: z.literal(0),
    policyHash: hash,
    probeSemanticHash: hash,
    readingMechanism: z
      .object({
        status: z.enum(["VERIFIED_SUDACHI", "UNAVAILABLE"]),
        runtimeIdentityHash: hash.nullable(),
        reason: z.string().nullable(),
      })
      .strict(),
    targets: z.array(
      z
        .object({
          targetId: z.string(),
          sourceInterval: interval,
          sourceIslandId: z.string().min(1).optional(),
          evidenceFamilies: z.array(c60114ProbeProviderSchema).optional(),
          semanticHash: hash.optional(),
          candidates: z.array(
            z
              .object({
                requestId: z.string(),
                provider: c60114ProbeProviderSchema,
                windowType: z.enum(["CORE_EXACT", "CORE_CONTEXT"]),
                displayText: z.string(),
                lexicalText: z.string(),
                pronunciationText: z.string().nullable(),
                localized: z.boolean(),
                hallucinationRisk: z.number().min(0).max(1),
                localizationStatus: z.string().min(1).optional(),
                eligibleForCrossModelReconciliation: z.boolean().optional(),
                guardContactCaution: z.boolean().optional(),
              })
              .strict(),
          ),
          classification: z.enum([
            "CROSS_MODEL_LEXICAL_AGREEMENT",
            "PRONUNCIATION_AGREEMENT",
            "WHISPER_ONLY_LOCALIZED",
            "REAZON_ONLY_LOCALIZED",
            "CROSS_MODEL_LEXICAL_DISAGREEMENT",
            "BOTH_EMPTY",
            "HALLUCINATION_RISK",
            "CONTEXT_ONLY_UNPROJECTABLE",
            "LOCALIZATION_UNRESOLVED",
            "GUARD_CONTACT_CROSS_MODEL_LEXICAL_SUPPORT",
          ]),
          displayAgreement: z.boolean(),
          lexicalAgreement: z.boolean(),
          pronunciationAgreement: z.boolean().nullable(),
          lexicalSimilarity: z.number().min(0).max(1).nullable(),
          pronunciationSimilarity: z.number().min(0).max(1).nullable(),
          crossModelLocalizedAgreement: z.boolean(),
          singleProviderExactContextStable: z.boolean(),
          evidenceRequestIds: z.array(z.string()),
          reasons: z.array(z.string()),
          requiresHumanReview: z.literal(true),
        })
        .strict(),
    ),
    semanticHash: hash,
  })
  .strict();
export const c60114MissingSpeechEvidenceV3Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("missing-speech-evidence-v3"),
    policyVersion: z.literal(
      "c6.0.1.14-missing-localization-playback-integrity-v1",
    ),
    sourceIdentityHash: hash,
    sourceIdentity: c60114SourceIdentitySchema,
    sourceTimebase: z.literal("SOURCE_GLOBAL_SECONDS"),
    runtimeGoldInputCount: z.literal(0),
    policyHash: hash,
    lexicalEvidenceHash: hash,
    targets: z.array(
      z
        .object({
          targetId: z.string(),
          sourceInterval: interval,
          classification: z.enum([
            "SPEECH_ISLAND_OBSERVED",
            "MISSING_DIALOGUE_LEXICAL_POSSIBLE",
            "MISSING_DIALOGUE_CROSS_MODEL_STRONG",
            "MISSING_DIALOGUE_SINGLE_MODEL_STABLE",
            "MISSING_DIALOGUE_ASR_DISAGREEMENT",
            "MISSING_DIALOGUE_ASR_EMPTY",
            "NON_SPEECH_CONTRADICTED",
            "MACHINE_DETECTION_ORPHAN",
            "LOCALIZATION_UNRESOLVED",
            "SOURCE_GLOBAL_LINEAGE_UNVERIFIED",
          ]),
          validSourceIdentity: z.boolean(),
          verifiedUncovered: z.boolean(),
          cueCoveredRatio: z.number().min(0).max(1),
          crossModelLocalizedAgreement: z.boolean(),
          singleProviderStable: z.boolean(),
          evidenceRequestIds: z.array(z.string()),
          reasons: z.array(z.string()),
          requiresHumanReview: z.literal(true),
          canonicalCoverageCredit: z.literal(false),
          autoCueGenerationAllowed: z.literal(false),
        })
        .strict(),
    ),
    parentGaps: z.array(c60114ParentGapSchema),
    migratedV2GapIds: z.array(z.string()),
    deprecatedEnvelopeOnlyEvidenceCount: z.number().int().nonnegative(),
    parentGapNotUsedAsSpeechEvidenceCount: z.number().int().nonnegative(),
    canonicalMutationCount: z.literal(0),
    semanticHash: hash,
  })
  .strict();
export type C60114ProbeProvider = z.infer<typeof c60114ProbeProviderSchema>;
export type C60114ProbeToken = z.infer<typeof c60114ProbeTokenSchema>;
export type C60114ProbeRuntime = z.infer<typeof c60114ProbeRuntimeSchema>;
export type C60114ProbeRequest = z.infer<typeof c60114ProbeRequestSchema>;
export type C60114ProbeExecution = z.infer<typeof c60114ProbeExecutionSchema>;
export type C60114LocalizedLexicalEvidence = z.infer<
  typeof c60114LocalizedLexicalEvidenceSchema
>;
export type C60114MissingSpeechEvidenceV3 = z.infer<
  typeof c60114MissingSpeechEvidenceV3Schema
>;

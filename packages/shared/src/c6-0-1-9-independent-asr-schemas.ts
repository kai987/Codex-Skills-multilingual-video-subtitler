import { z } from "zod";

export const c6019PolicyVersion =
  "c6.0.1.9-independent-asr-complementarity-v1" as const;

const schemaVersion = z.literal("1.0.0");
const policyVersion = z.literal(c6019PolicyVersion);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const count = z.number().int().nonnegative();
const ratio = z.number().min(0).max(1);
const finite = z.number().finite();
const interval = z
  .object({ start: z.number().nonnegative(), end: z.number().positive() })
  .strict()
  .refine((value) => value.end > value.start, {
    message: "Interval end must be greater than start.",
  });
const artifactHeader = {
  schemaVersion,
  policyVersion,
  generatedAt: z.iso.datetime(),
} as const;

export const c6019DiagnosticRoleSchema = z.enum(["TARGET", "CONTROL"]);
export const independentAsrWindowTypeSchema = z.enum([
  "CORE_EXACT",
  "CORE_CONTEXT",
]);
export const independentAsrRequestStatusSchema = z.enum([
  "SUCCESS",
  "EMPTY_OUTPUT",
  "PROVIDER_ERROR",
  "INVALID_AUDIO",
  "UNSUPPORTED_DURATION",
  "TIMEOUT",
  "MODEL_FAILURE",
  "SECOND_ASR_UNAVAILABLE",
]);
export const independentAsrTimestampAvailabilitySchema = z.enum([
  "POINT_TIMESTAMPS_ONLY",
  "UNAVAILABLE",
]);

const modelFileSchema = z
  .object({ fileName: z.string().min(1), size: count, sha256 })
  .strict();

export const independentAsrModelIdentitySchema = z
  .object({
    providerId: z.literal("reazonspeech-k2-v2"),
    modelId: z.literal("reazon-research/reazonspeech-k2-v2"),
    modelRevision: z.string().regex(/^[a-f0-9]{40}$/u),
    architecture: z.literal("Zipformer character RNN-T"),
    modelFiles: z.array(modelFileSchema).length(4),
    modelSnapshotHash: sha256,
    precision: z.literal("fp32"),
    device: z.literal("cpu"),
    language: z.literal("ja"),
  })
  .strict();

export const machineSecondAsrDiagnosticSetSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-second-asr-diagnostic-set"),
    sourceMediaSha256: sha256,
    upstreamTargetSemanticHash: sha256,
    selectionPolicy: z.literal(
      "c6018-targets-plus-machine-low-risk-core-localizable-controls-v1",
    ),
    targetEventIds: z.array(z.string().min(1)).length(12),
    controlEventIds: z.array(z.string().min(1)).length(12),
    events: z
      .array(
        z
          .object({
            eventId: z.string().min(1),
            role: c6019DiagnosticRoleSchema,
            coreInterval: interval,
            coreStatus: z.enum([
              "VERIFIED",
              "VERIFIED_WITH_CAUTION",
              "MACHINE_CONTROL_CORE",
            ]),
            selectionReasons: z.array(z.string().min(1)).min(1),
            machineEvidenceIds: z.array(z.string().min(1)).min(1),
            semanticHash: sha256,
          })
          .strict(),
      )
      .length(24),
    frozenBeforeGold: z.literal(true),
    runtimeGoldInputCount: z.literal(0),
    semanticHash: sha256,
  })
  .strict()
  .superRefine((value, context) => {
    const ids = [...value.targetEventIds, ...value.controlEventIds];
    if (new Set(ids).size !== 24) {
      context.addIssue({
        code: "custom",
        path: ["controlEventIds"],
        message: "Target and control IDs must be unique.",
      });
    }
    const eventIds = value.events.map((event) => event.eventId);
    if (
      new Set(eventIds).size !== 24 ||
      ids.some((id) => !eventIds.includes(id))
    ) {
      context.addIssue({
        code: "custom",
        path: ["events"],
        message: "Diagnostic events must exactly cover the frozen IDs.",
      });
    }
  });

const runtimeCountsSchema = z
  .object({
    requestCount: count,
    successfulRequestCount: count,
    failedRequestCount: count,
    emptyOutputCount: count,
    cacheHitCount: count,
    inferenceCount: count,
    modelLoadCount: count,
    processStartCount: count,
  })
  .strict();

export const machineIndependentAsrRuntimeSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-independent-asr-runtime"),
    executionKind: z.enum([
      "OFFICIAL_FRESH_INFERENCE",
      "FROZEN_EXACT_CACHE_REPLAY",
    ]),
    provider: z
      .object({
        providerId: z.literal("reazonspeech-k2-v2"),
        adapterType: z.literal("DIRECT_SHERPA_ONNX_OFFICIAL_REAZON_FP32"),
        adapterReason: z.string().min(1),
        providerInterfaceVersion: z.literal("independent-asr-provider-v1"),
      })
      .strict(),
    modelIdentity: independentAsrModelIdentitySchema,
    runtimeIdentity: z
      .object({
        runtimeId: sha256,
        os: z.string().min(1),
        arch: z.string().min(1),
        cpu: z.string().min(1),
        pythonVersion: z.string().min(1),
        sherpaOnnxVersion: z.string().min(1),
        adapterSourceSha256: sha256,
        threadCount: z.number().int().positive(),
      })
      .strict(),
    decoding: z
      .object({
        method: z.literal("greedy_search"),
        sampleRate: z.literal(16_000),
        featureDim: z.literal(80),
        maxAudioSeconds: z.literal(30),
        padSeconds: z.literal(0.9),
        hotwordsEnabled: z.literal(false),
        contextualBiasingEnabled: z.literal(false),
        externalLanguageModelEnabled: z.literal(false),
      })
      .strict(),
    bootstrap: z
      .object({
        performed: z.boolean(),
        networkUsedDuringBootstrap: z.boolean(),
        modelCompleteBeforeAcceptance: z.boolean(),
        runtimeCompleteBeforeAcceptance: z.boolean(),
        hashesFrozenBeforeAcceptance: z.boolean(),
      })
      .strict(),
    acceptance: z
      .object({
        networkUsed: z.literal(false),
        remoteApiUsed: z.literal(false),
        runtimeGoldInputCount: z.literal(0),
        localOnlyVerified: z.literal(true),
      })
      .strict(),
    counts: runtimeCountsSchema,
    performance: z
      .object({
        modelLoadSeconds: finite.nonnegative(),
        totalInferenceSeconds: finite.nonnegative(),
        meanRequestSeconds: finite.nonnegative(),
        p50RequestSeconds: finite.nonnegative(),
        p95RequestSeconds: finite.nonnegative(),
        realTimeFactor: finite.nonnegative(),
        peakRssBytes: count.nullable(),
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

const timestampPointSchema = z
  .object({
    token: z.string(),
    paddedAudioSeconds: z.number().nonnegative(),
    sourcePointSeconds: z.number().nonnegative(),
  })
  .strict();

export const independentAsrCandidateSchema = z
  .object({
    candidateId: z.string().min(1),
    providerId: z.literal("reazonspeech-k2-v2"),
    modelIdentityHash: sha256,
    eventId: z.string().min(1),
    diagnosticRole: c6019DiagnosticRoleSchema,
    windowType: independentAsrWindowTypeSchema,
    sourceInterval: interval,
    audioIdentity: z
      .object({
        sourceMediaSha256: sha256,
        sampleRate: z.literal(16_000),
        sampleCount: count,
        audioSha256: sha256,
        extractionConfigHash: sha256,
      })
      .strict(),
    displayText: z.string(),
    normalizedDisplayText: z.string(),
    pronunciationText: z.string(),
    requestStatus: independentAsrRequestStatusSchema,
    diagnostics: z
      .object({
        wallClockSeconds: finite.nonnegative(),
        tokenCount: count,
        repetitionRisk: ratio,
        textDensityPerSecond: finite.nonnegative(),
        warnings: z.array(z.string()),
      })
      .strict(),
    timestampEvidence: z
      .object({
        availability: independentAsrTimestampAvailabilitySchema,
        characterIntervalsAvailable: z.literal(false),
        points: z.array(timestampPointSchema),
      })
      .strict(),
    evidenceAvailability: z.enum(["COMPLETE", "INCOMPLETE"]),
    cacheKey: sha256,
    cacheHit: z.boolean(),
    inferenceExecuted: z.boolean(),
    runtimeGoldInputCount: z.literal(0),
    semanticHash: sha256,
  })
  .strict();

export const machineIndependentAsrCandidatesSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-independent-asr-candidates"),
    executionKind: z.enum([
      "OFFICIAL_FRESH_INFERENCE",
      "FROZEN_EXACT_CACHE_REPLAY",
    ]),
    diagnosticSetSemanticHash: sha256,
    modelIdentityHash: sha256,
    candidates: z.array(independentAsrCandidateSchema).length(48),
    summary: z
      .object({
        plannedRequestCount: z.literal(48),
        actualRequestCount: count,
        coreExactRequestCount: count,
        coreContextRequestCount: count,
        successfulRequestCount: count,
        failedRequestCount: count,
        emptyOutputCount: count,
        candidateCount: count,
        evidenceCompleteCount: count,
        evidenceIncompleteCount: count,
        timestampAvailableCount: count,
        timestampUnavailableCount: count,
        cacheHitCount: count,
        inferenceCount: count,
        runtimeGoldInputCount: z.literal(0),
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const secondAsrStabilityClassSchema = z.enum([
  "REAZON_CORE_STABLE",
  "REAZON_CONTEXT_EXTENSION_ONLY",
  "REAZON_LEXICALLY_UNSTABLE",
  "REAZON_HALLUCINATION_UNSTABLE",
  "REAZON_EMPTY_UNSTABLE",
  "UNCOMPARABLE",
]);

export const machineSecondAsrStabilitySchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-second-asr-stability"),
    candidatesSemanticHash: sha256,
    events: z.array(
      z
        .object({
          eventId: z.string().min(1),
          diagnosticRole: c6019DiagnosticRoleSchema,
          coreExactCandidateId: z.string().min(1),
          coreContextCandidateId: z.string().min(1),
          stabilityClass: secondAsrStabilityClassSchema,
          exactSimilarity: ratio,
          normalizedSimilarity: ratio,
          pronunciationSimilarity: ratio,
          contextExtensionObserved: z.boolean(),
          semanticHash: sha256,
        })
        .strict(),
    ),
    summary: z
      .object({
        eventCount: z.literal(24),
        coreStableCount: count,
        contextExtensionOnlyCount: count,
        lexicallyUnstableCount: count,
        hallucinationUnstableCount: count,
        emptyUnstableCount: count,
        uncomparableCount: count,
        stableRate: ratio,
        runtimeGoldInputCount: z.literal(0),
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const crossModelDisagreementClassSchema = z.enum([
  "EXACT_AGREEMENT",
  "NORMALIZED_AGREEMENT",
  "PRONUNCIATION_AGREEMENT",
  "ORTHOGRAPHY_ONLY_DIFFERENCE",
  "LEXICAL_DISAGREEMENT",
  "WHISPER_HALLUCINATION_RISK",
  "REAZON_HALLUCINATION_RISK",
  "BOTH_LOW_SUPPORT",
  "REAZON_EMPTY",
  "WHISPER_EMPTY",
  "UNCOMPARABLE",
]);

const comparisonCandidateSchema = z
  .object({
    candidateId: z.string().min(1),
    displayText: z.string(),
    normalizedDisplayText: z.string(),
    pronunciationText: z.string(),
    hallucinationRisk: ratio,
  })
  .strict();

export const machineCrossModelComparisonSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-cross-model-comparison"),
    diagnosticSetSemanticHash: sha256,
    independentCandidatesSemanticHash: sha256,
    events: z.array(
      z
        .object({
          eventId: z.string().min(1),
          diagnosticRole: c6019DiagnosticRoleSchema,
          whisperCandidates: z.array(comparisonCandidateSchema),
          reazonCandidate: comparisonCandidateSchema,
          exactAgreement: z.boolean(),
          normalizedAgreement: z.boolean(),
          pronunciationAgreement: z.boolean(),
          bestNormalizedSimilarity: ratio,
          bestPronunciationSimilarity: ratio,
          disagreementClass: crossModelDisagreementClassSchema,
          providerDiagnostics: z.array(z.string()),
          semanticHash: sha256,
        })
        .strict(),
    ),
    summary: z
      .object({
        eventCount: z.literal(24),
        exactAgreementCount: count,
        normalizedAgreementCount: count,
        pronunciationAgreementCount: count,
        orthographyOnlyDifferenceCount: count,
        lexicalDisagreementCount: count,
        whisperHallucinationRiskCount: count,
        reazonHallucinationRiskCount: count,
        bothLowSupportCount: count,
        reazonEmptyCount: count,
        whisperEmptyCount: count,
        uncomparableCount: count,
        runtimeGoldInputCount: z.literal(0),
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const ctcArbitrationOutcomeSchema = z.enum([
  "CTC_FAVORS_WHISPER",
  "CTC_FAVORS_REAZON",
  "CTC_AMBIGUOUS",
  "CTC_UNSCORABLE",
]);

export const machineCrossModelCtcArbitrationSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-cross-model-ctc-arbitration"),
    comparisonSemanticHash: sha256,
    ctcRuntimeIdentityHash: sha256,
    ctcModelSnapshotHash: sha256,
    correlationPolicy: z.literal(
      "DATA_FAMILY_CORRELATED_NOT_AN_INDEPENDENT_VOTE",
    ),
    events: z.array(
      z
        .object({
          eventId: z.string().min(1),
          whisperProjection: z.string(),
          reazonProjection: z.string(),
          ctcWhisperEvidence: finite.nullable(),
          ctcReazonEvidence: finite.nullable(),
          scoreDifferenceReazonMinusWhisper: finite.nullable(),
          outcome: ctcArbitrationOutcomeSchema,
          correlationWarning: z.literal("DATA_FAMILY_CORRELATED"),
          evidenceIds: z.array(z.string().min(1)),
          semanticHash: sha256,
        })
        .strict(),
    ),
    summary: z
      .object({
        eligibleCount: count,
        favorsWhisperCount: count,
        favorsReazonCount: count,
        ambiguousCount: count,
        unscorableCount: count,
        inferenceCount: count,
        modelLoadCount: count,
        runtimeGoldInputCount: z.literal(0),
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const machineCrossModelShadowCandidateSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-cross-model-shadow-candidate"),
    comparisonSemanticHash: sha256,
    ctcArbitrationSemanticHash: sha256,
    winnerSelectionPolicyImplemented: z.literal(false),
    productionMutationAllowed: z.literal(false),
    events: z.array(
      z
        .object({
          eventId: z.string().min(1),
          agreementClass: crossModelDisagreementClassSchema,
          ctcOutcome: ctcArbitrationOutcomeSchema.nullable(),
          ambiguityRetained: z.boolean(),
          candidateWinnerId: z.null(),
          semanticHash: sha256,
        })
        .strict(),
    ),
    runtimeGoldInputCount: z.literal(0),
    semanticHash: sha256,
  })
  .strict();

export const goldCrossModelTaxonomySchema = z.enum([
  "BOTH_CORRECT_OR_EQUIVALENT",
  "WHISPER_ONLY_BETTER",
  "REAZON_ONLY_BETTER",
  "WHISPER_ONLY_CORRECT",
  "REAZON_ONLY_CORRECT",
  "BOTH_WRONG_REAZON_BETTER",
  "BOTH_WRONG_WHISPER_BETTER",
  "BOTH_WRONG_SIMILAR",
  "BOTH_WRONG_DIFFERENT",
  "ORTHOGRAPHY_ONLY",
  "WHISPER_HALLUCINATION_ONLY",
  "REAZON_HALLUCINATION_ONLY",
  "BOTH_HALLUCINATE",
  "UNEVALUABLE",
]);

export const goldCrossModelComplementarityEvaluationSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("gold-cross-model-complementarity-evaluation"),
    evaluationPhase: z.literal("post-freeze-gold-isolated"),
    machineFreezeHash: sha256,
    goldIdentityHash: sha256,
    runtimeGoldInputCount: z.literal(0),
    goldTextIncluded: z.literal(false),
    events: z.array(
      z
        .object({
          eventId: z.string().min(1),
          diagnosticRole: c6019DiagnosticRoleSchema,
          localEvaluationStatus: z.string().min(1),
          whisperCoreError: count.nullable(),
          bestWhisperPoolError: count.nullable(),
          reazonCoreError: count.nullable(),
          unionPoolError: count.nullable(),
          taxonomy: goldCrossModelTaxonomySchema,
          baselineWrong: z.boolean().nullable(),
          ctcOutcome: ctcArbitrationOutcomeSchema.nullable(),
          ctcPreferenceCorrect: z.boolean().nullable(),
          semanticHash: sha256,
        })
        .strict(),
    ),
    summary: z
      .object({
        targetEvaluableCount: count,
        targetBaselineWrongCount: count,
        controlEvaluableCount: count,
        taxonomyCounts: z.record(goldCrossModelTaxonomySchema, count),
        reazonOnlyBetterCount: count,
        whisperOnlyBetterCount: count,
        bothEquivalentCount: count,
        bothWrongCount: count,
        reazonOnlyCorrectCount: count,
        whisperOnlyCorrectCount: count,
        disagreementEvaluableCount: count,
        ctcCorrectPreferenceCount: count,
        ctcWrongPreferenceCount: count,
        ctcAmbiguousCount: count,
        ctcUnscorableCount: count,
        ctcArbitrationAccuracy: ratio.nullable(),
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const machineCrossModelUnionOracleEvaluationSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-cross-model-union-oracle-evaluation"),
    evaluationPhase: z.literal("post-freeze-gold-isolated"),
    metricDirection: z.literal("LOWER_IS_BETTER"),
    gainDefinition: z.literal("whisperOnlyOracleError-minus-unionOracleError"),
    complementarityEvaluationSemanticHash: sha256,
    events: z.array(
      z
        .object({
          eventId: z.string().min(1),
          whisperOnlyOracleError: count.nullable(),
          unionOracleError: count.nullable(),
          complementarityGain: count.nullable(),
          improved: z.boolean().nullable(),
          reazonAddedBestCandidate: z.boolean().nullable(),
          semanticHash: sha256,
        })
        .strict(),
    ),
    summary: z
      .object({
        evaluableCount: count,
        whisperOnlyOracleError: count,
        unionOracleError: count,
        absoluteGain: count,
        relativeGain: ratio,
        improvedEventCount: count,
        reazonOnlyInformationGainEventCount: count,
        complementarityRate: ratio,
      })
      .strict(),
    runtimeGoldInputCount: z.literal(0),
    semanticHash: sha256,
  })
  .strict();

export const goldSecondAsrControlRegressionSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("gold-second-asr-control-regression"),
    evaluationPhase: z.literal("post-freeze-gold-isolated"),
    complementarityEvaluationSemanticHash: sha256,
    events: z.array(
      z
        .object({
          eventId: z.string().min(1),
          evaluable: z.boolean(),
          result: z.enum([
            "REAZON_BETTER",
            "WHISPER_BETTER",
            "EQUIVALENT",
            "REAZON_HALLUCINATION",
            "REAZON_EMPTY",
            "UNEVALUABLE",
          ]),
          blindlySelectingReazonWouldRegress: z.boolean().nullable(),
          semanticHash: sha256,
        })
        .strict(),
    ),
    summary: z
      .object({
        controlEvaluableCount: count,
        reazonBetterCount: count,
        whisperBetterCount: count,
        equivalentCount: count,
        reazonHallucinationCount: count,
        reazonEmptyCount: count,
        blindReazonRegressionCount: count,
      })
      .strict(),
    runtimeGoldInputCount: z.literal(0),
    semanticHash: sha256,
  })
  .strict();

export const c6019ComplementarityResultSchema = z.enum([
  "SECOND_ASR_COMPLEMENTARITY_CONFIRMED",
  "SECOND_ASR_COMPLEMENTARITY_WEAK",
  "SECOND_ASR_NOT_USEFUL",
  "SECOND_ASR_TOO_UNSTABLE",
  "INSUFFICIENT_SECOND_ASR_EVIDENCE",
]);
export const c6019RouteValueSchema = z.enum([
  "GO_C6_0_1_10_CROSS_MODEL_ARBITRATION",
  "HOLD_FOR_SECOND_ASR_SELECTION_DECISION",
  "REJECT_REAZONSPEECH_K2_AS_ENSEMBLE_MEMBER",
  "INSUFFICIENT_SECOND_ASR_EVIDENCE",
]);

export const c6019RouteDecisionSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-9-route-decision"),
    complementarityResult: c6019ComplementarityResultSchema,
    routeDecision: c6019RouteValueSchema,
    confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
    supportingMetrics: z
      .object({
        targetEvaluableCount: count,
        targetBaselineWrongCount: count,
        reazonOnlyBetterCount: count,
        reazonOnlyCorrectCount: count,
        unionOracleAbsoluteGain: count,
        unionOracleRelativeGain: ratio,
        unionOracleImprovedEventCount: count,
        complementarityRate: ratio,
        controlEvaluableCount: count,
        blindReazonRegressionCount: count,
        secondAsrStabilityRate: ratio,
      })
      .strict(),
    reasons: z.array(z.string().min(1)).min(1),
    blockers: z.array(z.string().min(1)),
    recommendCrossModelArbitrationNext: z.boolean(),
    rejectReazonK2: z.boolean(),
    canonicalTextMutationCount: z.literal(0),
    canonicalTimingMutationCount: z.literal(0),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    machineReleaseAuthorized: z.literal(false),
    goC602: z.literal(false),
    runtimeGoldInputCount: z.literal(0),
    semanticHash: sha256,
  })
  .strict();

export const c6019QualityPolicySchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-9-quality-policy"),
    modes: z
      .object({
        independentAsr: z.literal("observe"),
        crossModelComparison: z.literal("observe"),
        ctcArbitration: z.literal("observe"),
      })
      .strict(),
    goldIsolation: z
      .object({
        runtimeGoldInputAllowed: z.literal(false),
        diagnosticSetFrozenBeforeGold: z.literal(true),
        machineArtifactsFrozenBeforeGold: z.literal(true),
      })
      .strict(),
    frozenRules: z
      .object({
        whisperRulesChanged: z.literal(false),
        timingRulesChanged: z.literal(false),
        overlapRulesChanged: z.literal(false),
        canonicalMutationAllowed: z.literal(false),
        hotwordsAllowed: z.literal(false),
        humanMemoryAllowed: z.literal(false),
      })
      .strict(),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    machineReleaseAuthorized: z.literal(false),
    semanticHash: sha256,
  })
  .strict();

export const c6019ValidationSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-9-validation"),
    branch: z.literal("codex/c6-0-1-9-independent-asr-complementarity"),
    repositoryCommit: z.string().regex(/^[a-f0-9]{40}$/u),
    sourceMediaSha256: sha256,
    goldSha256: sha256,
    checks: z.array(
      z
        .object({
          id: z.string().min(1),
          passed: z.boolean(),
          evidence: z.array(z.string()),
        })
        .strict(),
    ),
    finalABParity: z
      .object({
        diagnosticSet: z.boolean(),
        candidates: z.boolean(),
        stability: z.boolean(),
        comparison: z.boolean(),
        ctcArbitration: z.boolean(),
        routeDecision: z.boolean(),
        productionText: z.boolean(),
        productionTiming: z.boolean(),
      })
      .strict(),
    productionHashes: z
      .object({
        canonicalText: sha256,
        canonicalTiming: sha256,
        presentation: sha256,
        ass: sha256,
        srt: sha256,
        vtt: sha256,
      })
      .strict(),
    sourceReadOnlyVerified: z.boolean(),
    goldReadOnlyVerified: z.boolean(),
    networkUsedDuringAcceptance: z.literal(false),
    runtimeGoldInputCount: z.literal(0),
    datasetHardcodingFindingCount: count,
    canonicalTextMutationCount: z.literal(0),
    canonicalTimingMutationCount: z.literal(0),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    machineReleaseAuthorized: z.literal(false),
    engineeringPassed: z.boolean(),
    diagnosticPassed: z.boolean(),
    strictC602QualityGatePassed: z.literal(false),
    semanticHash: sha256,
  })
  .strict();

export type MachineSecondAsrDiagnosticSet = z.infer<
  typeof machineSecondAsrDiagnosticSetSchema
>;
export type IndependentAsrModelIdentity = z.infer<
  typeof independentAsrModelIdentitySchema
>;
export type MachineIndependentAsrRuntime = z.infer<
  typeof machineIndependentAsrRuntimeSchema
>;
export type IndependentAsrCandidate = z.infer<
  typeof independentAsrCandidateSchema
>;
export type MachineIndependentAsrCandidates = z.infer<
  typeof machineIndependentAsrCandidatesSchema
>;
export type MachineSecondAsrStability = z.infer<
  typeof machineSecondAsrStabilitySchema
>;
export type MachineCrossModelComparison = z.infer<
  typeof machineCrossModelComparisonSchema
>;
export type MachineCrossModelCtcArbitration = z.infer<
  typeof machineCrossModelCtcArbitrationSchema
>;
export type MachineCrossModelShadowCandidate = z.infer<
  typeof machineCrossModelShadowCandidateSchema
>;
export type GoldCrossModelComplementarityEvaluation = z.infer<
  typeof goldCrossModelComplementarityEvaluationSchema
>;
export type MachineCrossModelUnionOracleEvaluation = z.infer<
  typeof machineCrossModelUnionOracleEvaluationSchema
>;
export type GoldSecondAsrControlRegression = z.infer<
  typeof goldSecondAsrControlRegressionSchema
>;
export type C6019RouteDecision = z.infer<typeof c6019RouteDecisionSchema>;
export type C6019QualityPolicy = z.infer<typeof c6019QualityPolicySchema>;
export type C6019Validation = z.infer<typeof c6019ValidationSchema>;

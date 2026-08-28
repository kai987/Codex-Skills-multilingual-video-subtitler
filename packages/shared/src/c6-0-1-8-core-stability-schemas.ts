import { z } from "zod";

import { c6015QualityMetricsSchema } from "./c6-0-1-5-evidence-application-schemas.js";

export const c6018PolicyVersion =
  "c6.0.1.8-core-span-asr-stability-v1" as const;

const schemaVersion = z.literal("1.0.0");
const policyVersion = z.literal(c6018PolicyVersion);
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
const nullableInterval = interval.nullable();
const artifactHeader = {
  schemaVersion,
  policyVersion,
  generatedAt: z.iso.datetime(),
} as const;

export const c6018ModeSchema = z.enum(["off", "observe", "enforce"]);
export const c6018ObserveModeSchema = z.enum(["off", "observe"]);

export const coreSpanStatusSchema = z.enum([
  "VERIFIED",
  "VERIFIED_WITH_CAUTION",
  "AMBIGUOUS",
  "UNAVAILABLE",
]);

export const coreSpanAmbiguityReasonSchema = z.enum([
  "NO_AMBIGUITY",
  "TRUSTED_TOKEN_SPAN_UNAVAILABLE",
  "VAD_SPAN_UNAVAILABLE",
  "CTC_SPAN_UNAVAILABLE",
  "FRESH_TOKEN_FALLBACK_USED",
  "NEIGHBORING_EVENT_OVERLAP",
  "OVERLAP_CORE_AMBIGUITY",
  "CROSS_EVENT_CORE_AMBIGUITY",
  "CHANT_OR_CROWD_CORE",
  "CORE_DURATION_TOO_SHORT",
  "SOURCE_BOUNDARY_CLAMPED",
  "NO_LOCALIZED_ACOUSTIC_EVIDENCE",
]);

const neighboringIntervalsSchema = z
  .object({ previous: nullableInterval, next: nullableInterval })
  .strict();

export const coreAcousticSpanEventSchema = z
  .object({
    eventId: z.string().min(1),
    sourceMediaIdentity: sha256,
    machineEventInterval: interval,
    trustedTokenInterval: nullableInterval,
    vadIntervals: z.array(interval),
    ctcInterval: nullableInterval,
    neighboringEventIntervals: neighboringIntervalsSchema,
    proposedCoreStart: z.number().nonnegative(),
    proposedCoreEnd: z.number().positive(),
    evidenceIds: z.array(z.string().min(1)),
    coreSpanStatus: coreSpanStatusSchema,
    ambiguityReasons: z.array(coreSpanAmbiguityReasonSchema).min(1),
    goldUsed: z.literal(false),
    semanticHash: sha256,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.proposedCoreEnd <= value.proposedCoreStart) {
      context.addIssue({
        code: "custom",
        path: ["proposedCoreEnd"],
        message: "Proposed Core Span must be positive.",
      });
    }
    if (value.coreSpanStatus === "UNAVAILABLE") {
      context.addIssue({
        code: "custom",
        path: ["coreSpanStatus"],
        message:
          "Unavailable events must be omitted instead of fabricating a span.",
      });
    }
  });

export const machineCoreAcousticSpanSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-core-acoustic-span"),
    mode: c6018ModeSchema,
    sourceIdentity: z
      .object({
        sourceMediaSha256: sha256,
        durationSeconds: z.number().positive(),
        sourceReadOnlyVerified: z.boolean(),
      })
      .strict(),
    selectionSemanticHash: sha256,
    corePolicy: z.literal(
      "trusted-token-then-acoustic-vad-with-fresh-token-fallback-no-gold",
    ),
    events: z.array(coreAcousticSpanEventSchema),
    summary: z
      .object({
        selectedEventCount: count,
        emittedEventCount: count,
        verifiedCount: count,
        verifiedWithCautionCount: count,
        ambiguousCount: count,
        unavailableCount: count,
        overlapAmbiguityCount: count,
        freshTokenFallbackCount: count,
        runtimeGoldInputCount: z.literal(0),
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const coreProjectionStatusSchema = z.enum([
  "EXACT_TOKEN_PROJECTED",
  "PARTIAL_TOKEN_PROJECTED",
  "CONTEXT_ONLY_EXCESS",
  "UNTIMED_UNPROJECTABLE",
  "CROSS_EVENT_AMBIGUOUS",
  "OVERLAP_AMBIGUOUS",
  "NO_CORE_CONTENT",
]);

export const coreProjectionOriginSchema = z.enum([
  "ORIGINAL",
  "RECOVERY",
  "HISTORICAL_REASR",
  "FRESH_A",
  "FRESH_B",
  "FRESH_C",
  "FRESH_CORE_VERIFICATION",
]);

export const groupedTokenMappingStatusSchema = z.enum([
  "VERIFIED_CHILDREN",
  "PARTIAL_CHILDREN",
  "CANDIDATE_INTERVAL_WHOLE",
  "UNMAPPED",
]);

export const coreProjectionBoundaryStatusSchema = z.enum([
  "NONE",
  "PARTIAL_BOUNDARY_TOKEN",
  "UNPROJECTABLE_TOKEN",
  "CROSS_EVENT_AMBIGUITY",
  "OVERLAP_AMBIGUITY",
]);

export const groupedProjectedTokenSchema = z
  .object({
    groupId: z.string().min(1),
    text: z.string(),
    interval: nullableInterval,
    childTokenIds: z.array(z.string().min(1)).min(1),
    childIntervals: z.array(nullableInterval).min(1),
    mappingStatus: groupedTokenMappingStatusSchema,
    semanticHash: sha256,
  })
  .strict()
  .refine(
    (value) => value.childTokenIds.length === value.childIntervals.length,
    {
      message: "Grouped-word child IDs and intervals must have equal lengths.",
    },
  );

export const coreTextProjectionCandidateSchema = z
  .object({
    eventId: z.string().min(1),
    candidateId: z.string().min(1),
    origin: coreProjectionOriginSchema,
    requestId: z.string().min(1).nullable(),
    sourceGlobalInterval: nullableInterval,
    fullWindowText: z.string(),
    fullWindowTextHash: sha256,
    normalizedFullWindowTextHash: sha256,
    coreProjectedText: z.string(),
    coreProjectedTextHash: sha256,
    normalizedCoreProjectedTextHash: sha256,
    preCoreText: z.string(),
    postCoreText: z.string(),
    groupedTokens: z.array(groupedProjectedTokenSchema),
    coreTokenIds: z.array(z.string().min(1)),
    projectedTokenIds: z.array(z.string().min(1)),
    unprojectableTokenIds: z.array(z.string().min(1)),
    projectionCoverage: ratio,
    coreCoverage: ratio,
    boundaryAmbiguity: coreProjectionBoundaryStatusSchema,
    ctcSupport: ratio.nullable(),
    pronunciationSupport: ratio.nullable(),
    averageTokenProbability: ratio.nullable(),
    projectionStatus: coreProjectionStatusSchema,
    evidenceIds: z.array(z.string().min(1)),
    semanticHash: sha256,
  })
  .strict();

export const machineCoreTextProjectionSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-core-text-projection"),
    mode: c6018ModeSchema,
    coreSpanSemanticHash: sha256,
    groupedWordPolicy: z.literal(
      "preserve-child-token-identities-and-intervals-no-character-ratio-timing",
    ),
    candidates: z.array(coreTextProjectionCandidateSchema),
    summary: z
      .object({
        eventCount: count,
        candidateCount: count,
        exactTokenProjectedCount: count,
        partialTokenProjectedCount: count,
        contextOnlyExcessCount: count,
        untimeableCount: count,
        crossEventAmbiguousCount: count,
        overlapAmbiguousCount: count,
        noCoreContentCount: count,
        groupedTokenCount: count,
        runtimeGoldInputCount: z.literal(0),
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const localizedComparabilityStatusSchema = z.enum([
  "CORE_COMPARABLE",
  "PARTIALLY_COMPARABLE",
  "CONTEXT_ONLY_COMPARABLE",
  "UNLOCALIZABLE",
  "OVERLAP_AMBIGUOUS",
]);

const localizedCandidateSummarySchema = z
  .object({
    candidateId: z.string().min(1),
    origin: coreProjectionOriginSchema,
    normalizedCoreTextHash: sha256,
    normalizedCoreTextLength: count,
    projectionStatus: coreProjectionStatusSchema,
    tokenCount: count,
    ctcSupport: ratio.nullable(),
    pronunciationSupport: ratio.nullable(),
    timingCoverage: ratio,
  })
  .strict();

const localizedPairwiseComparisonSchema = z
  .object({
    leftCandidateId: z.string().min(1),
    rightCandidateId: z.string().min(1),
    lexicalEditDistance: count,
    lexicalSimilarity: ratio,
    tokenAgreement: ratio,
    pronunciationAgreement: ratio.nullable(),
    ctcAgreement: ratio.nullable(),
    timingAgreement: ratio.nullable(),
    sameCoreText: z.boolean(),
    fullWindowOnlyDifference: z.boolean(),
    semanticHash: sha256,
  })
  .strict();

export const localizedCandidateComparabilityEventSchema = z
  .object({
    eventId: z.string().min(1),
    coreInterval: interval,
    candidateIds: z.array(z.string().min(1)),
    comparableCandidateIds: z.array(z.string().min(1)),
    unprojectableCandidateIds: z.array(z.string().min(1)),
    coreTexts: z.array(
      z
        .object({
          candidateId: z.string().min(1),
          text: z.string(),
          normalizedTextHash: sha256,
        })
        .strict(),
    ),
    candidates: z.array(localizedCandidateSummarySchema),
    pairwiseRelations: z.array(localizedPairwiseComparisonSchema),
    pairwiseComparisons: z.array(localizedPairwiseComparisonSchema),
    comparableCandidateCount: count,
    distinctCoreTextCount: count,
    comparabilityStatus: localizedComparabilityStatusSchema,
    status: localizedComparabilityStatusSchema,
    blockers: z.array(z.string().min(1)),
    semanticHash: sha256,
  })
  .strict();

export const machineLocalizedCandidateComparabilitySchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-localized-candidate-comparability"),
    mode: c6018ObserveModeSchema,
    coreSpanSemanticHash: sha256,
    projectionSemanticHash: sha256,
    comparisonLocus: z.literal("same-source-global-core-span"),
    events: z.array(localizedCandidateComparabilityEventSchema),
    summary: z
      .object({
        eventCount: count,
        coreComparableCount: count,
        partiallyComparableCount: count,
        contextOnlyComparableCount: count,
        unlocalizableCount: count,
        overlapAmbiguousCount: count,
        runtimeGoldInputCount: z.literal(0),
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const coreAsrStabilityClassSchema = z.enum([
  "CORE_TEXT_CONSISTENT",
  "CONTEXT_ONLY_DIFFERENCE",
  "LEXICAL_CORE_DISAGREEMENT",
  "HALLUCINATION_DISAGREEMENT",
  "ADJACENT_UTTERANCE_CONTAMINATION",
  "SPEAKER_CONTENT_MIX",
  "PARTIAL_CORE_AGREEMENT",
  "UNLOCALIZABLE",
  "UNEVALUABLE",
]);

export const coreAsrStabilityEventSchema = z
  .object({
    eventId: z.string().min(1),
    coreSpanId: z.string().min(1),
    candidateIds: z.array(z.string().min(1)),
    projectedTexts: z.array(
      z
        .object({
          candidateId: z.string().min(1),
          text: z.string(),
          normalizedTextHash: sha256,
        })
        .strict(),
    ),
    fullTexts: z.array(
      z
        .object({
          candidateId: z.string().min(1),
          text: z.string(),
          normalizedTextHash: sha256,
        })
        .strict(),
    ),
    stabilityClass: coreAsrStabilityClassSchema,
    class: coreAsrStabilityClassSchema,
    lexicalAgreement: ratio,
    pronunciationAgreement: ratio.nullable(),
    localizationCoverage: ratio,
    comparableCandidateIds: z.array(z.string().min(1)),
    distinctCoreTextHashes: z.array(sha256),
    stableCoreTextHash: sha256.nullable(),
    contextDifferenceObserved: z.boolean(),
    adjacentContaminationObserved: z.boolean(),
    machineSpeakerMixObserved: z.boolean(),
    hallucinationEvidenceObserved: z.boolean(),
    supportingEvidenceIds: z.array(z.string().min(1)),
    blockers: z.array(z.string().min(1)),
    semanticHash: sha256,
  })
  .strict();

export const machineCoreAsrStabilitySchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-core-asr-stability"),
    mode: c6018ObserveModeSchema,
    comparabilitySemanticHash: sha256,
    speakerEvidencePolicy: z.literal("machine-evidence-only"),
    events: z.array(coreAsrStabilityEventSchema),
    summary: z
      .object({
        eventCount: count,
        classCounts: z.record(coreAsrStabilityClassSchema, count),
        stableEventCount: count,
        lexicalInstabilityCount: count,
        hallucinationInstabilityCount: count,
        localizationBlockedCount: count,
        runtimeGoldInputCount: z.literal(0),
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const localGoldEvaluationStatusSchema = z.enum([
  "EVALUABLE_EXACT_LOCAL",
  "EVALUABLE_MONOTONIC_LOCAL",
  "EVALUABLE_WITH_AMBIGUITY",
  "UNEVALUABLE_INSUFFICIENT_REFERENCE",
  "UNEVALUABLE_OVERLAP",
  "UNEVALUABLE_MAPPING_CONFLICT",
]);

export const goldLocalCoreEvaluationEventSchema = z
  .object({
    eventId: z.string().min(1),
    coreInterval: interval,
    evaluationInterval: interval,
    matchedGoldCueIds: z.array(z.string().min(1)),
    machineToGoldCardinality: z.enum(["ONE_TO_ONE", "ONE_TO_MANY", "NONE"]),
    goldToMachineCardinality: z.enum(["ONE_TO_ONE", "MANY_TO_ONE", "NONE"]),
    monotonicOrder: z.boolean(),
    evaluationStatus: localGoldEvaluationStatusSchema,
    goldTextHash: sha256.nullable(),
    goldTextIncluded: z.literal(false),
    blockers: z.array(z.string().min(1)),
    semanticHash: sha256,
  })
  .strict();

export const goldLocalCoreEvaluationSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("gold-local-core-evaluation"),
    evaluationPhase: z.literal("post-freeze-gold-isolated"),
    machineFreezeHash: sha256,
    goldIdentityHash: sha256,
    evaluationMarginSeconds: z.literal(0.35),
    alignmentPolicy: z.literal("monotonic-local-many-to-many-v1"),
    runtimeGoldInputCount: z.literal(0),
    events: z.array(goldLocalCoreEvaluationEventSchema),
    summary: z
      .object({
        eventCount: count,
        evaluableEventCount: count,
        exactLocalCount: count,
        monotonicLocalCount: count,
        ambiguousEvaluableCount: count,
        unevaluableEventCount: count,
        oneMachineToManyGoldCount: count,
        manyMachineToOneGoldCount: count,
        targetNineOfTwelvePassed: z.boolean(),
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const machineCoreFreshVerificationSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-core-fresh-verification"),
    mode: c6018ObserveModeSchema,
    decision: z.enum([
      "NOT_REQUIRED_EXISTING_FRESH_SUFFICIENT",
      "EXECUTED_BOUNDED_CORE_VERIFICATION",
      "BLOCKED_RUNTIME_UNAVAILABLE",
    ]),
    justification: z.array(z.string().min(1)).min(1),
    reusedC6017FreshSemanticHash: sha256,
    reusedFreshRequestCount: z.literal(36),
    maximumRequestsPerUnresolvedEvent: z.literal(2),
    episodeRequestBudget: z.literal(24),
    unresolvedEventIds: z.array(z.string().min(1)),
    executedEventIds: z.array(z.string().min(1)),
    requests: z.array(
      z
        .object({
          requestId: z.string().min(1),
          eventId: z.string().min(1),
          coreInterval: interval,
          promptPresent: z.literal(false),
          runtimeGoldInputCount: z.literal(0),
          cacheHit: z.literal(false),
          inferenceExecuted: z.literal(true),
          responseTextHash: sha256,
          tokenEvidenceIds: z.array(z.string().min(1)),
          semanticHash: sha256,
        })
        .strict(),
    ),
    inferenceRuntime: z
      .object({
        runtimeType: z.string().min(1),
        runtimeBinarySha256: sha256,
        runtimePatchSha256: sha256,
        modelSha256: sha256,
        device: z.string().min(1),
      })
      .strict(),
    summary: z
      .object({
        requestedEventCount: count,
        requestCount: count,
        freshInferenceCount: count,
        cacheHitCount: z.literal(0),
        modelLoadCount: count,
        processStartCount: count,
        promptLeakCount: z.literal(0),
        runtimeGoldInputCount: z.literal(0),
        networkUsed: z.literal(false),
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const whisperCoreDiagnosisSchema = z.enum([
  "PIPELINE_CORRECT_CANDIDATE_EXISTS",
  "CONTEXT_DIFFERENCE_ONLY",
  "ASR_CORE_STABLE_CORRECT",
  "ASR_CORE_STABLE_WRONG",
  "ASR_CORE_LEXICALLY_UNSTABLE",
  "ASR_HALLUCINATION_UNSTABLE",
  "CANDIDATE_APPLICATION_BLOCKED",
  "LOCALIZATION_BLOCKED",
  "REFERENCE_ALIGNMENT_BLOCKED",
  "UNEVALUABLE",
]);

export const machineWhisperCoreStabilityEvaluationSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-whisper-core-stability-evaluation"),
    evaluationPhase: z.literal("post-freeze-gold-isolated"),
    machineFreezeHash: sha256,
    goldLocalEvaluationSemanticHash: sha256,
    runtimeGoldInputCount: z.literal(0),
    events: z.array(
      z
        .object({
          eventId: z.string().min(1),
          diagnosis: whisperCoreDiagnosisSchema,
          stabilityClass: coreAsrStabilityClassSchema,
          localEvaluationStatus: localGoldEvaluationStatusSchema,
          currentFinalError: finite.nonnegative().nullable(),
          bestExistingCoreError: finite.nonnegative().nullable(),
          bestFreshCoreError: finite.nonnegative().nullable(),
          bestCandidateId: z.string().min(1).nullable(),
          supportingEvidenceIds: z.array(z.string().min(1)),
          semanticHash: sha256,
        })
        .strict(),
    ),
    summary: z
      .object({
        eventCount: count,
        evaluableEventCount: count,
        diagnosisCounts: z.record(whisperCoreDiagnosisSchema, count),
        pipelineLimitedCount: count,
        asrLimitedCount: count,
        localizationBlockedCount: count,
        referenceBlockedCount: count,
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const coreCandidateOracleSourceSchema = z.enum([
  "CURRENT_FINAL",
  "EXISTING_CORE",
  "C6017_FRESH_CORE",
  "C6018_CORE_VERIFICATION",
]);

export const machineCoreCandidateOracleEvaluationSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-core-candidate-oracle-evaluation"),
    evaluationPhase: z.literal("post-freeze-gold-isolated"),
    metricDirection: z.literal("LOWER_IS_BETTER"),
    deltaDefinition: z.literal("newError-minus-oldError"),
    machineFreezeHash: sha256,
    goldLocalEvaluationSemanticHash: sha256,
    runtimeGoldInputCount: z.literal(0),
    events: z.array(
      z
        .object({
          eventId: z.string().min(1),
          evaluationStatus: localGoldEvaluationStatusSchema,
          currentFinalCandidateId: z.string().min(1).nullable(),
          currentFinalError: finite.nonnegative().nullable(),
          oracleCandidateId: z.string().min(1).nullable(),
          oracleSource: coreCandidateOracleSourceSchema.nullable(),
          oracleError: finite.nonnegative().nullable(),
          delta: finite.nullable(),
          improvement: z.boolean().nullable(),
          regression: z.boolean().nullable(),
          candidateErrors: z.array(
            z
              .object({
                candidateId: z.string().min(1),
                source: coreCandidateOracleSourceSchema,
                error: finite.nonnegative(),
                semanticHash: sha256,
              })
              .strict(),
          ),
          goldTextIncluded: z.literal(false),
          semanticHash: sha256,
        })
        .strict(),
    ),
    summary: z
      .object({
        eventCount: count,
        evaluableEventCount: count,
        currentFinalErrorTotal: finite.nonnegative(),
        oracleErrorTotal: finite.nonnegative(),
        oracleImprovementTotal: finite.nonnegative(),
        oracleImprovedEventCount: count,
        existingCoreOracleWinCount: count,
        c6017FreshOracleWinCount: count,
        c6018CoreVerificationOracleWinCount: count,
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const c6018RouteDecisionValueSchema = z.enum([
  "CONTINUE_FINAL_PIPELINE_APPLICATION",
  "RECOMMEND_SECOND_ASR_ENSEMBLE",
  "MIXED_PIPELINE_AND_ASR",
  "INSUFFICIENT_LOCAL_COMPARABILITY",
  "GO_C6_0_2",
]);

export const c6018RouteDecisionSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-8-route-decision"),
    decision: c6018RouteDecisionValueSchema,
    confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
    recommendation: z.enum([
      "STOP_SINGLE_WHISPER_RULE_EXPANSION",
      "ONE_SMALL_FINAL_PIPELINE_APPLICATION",
      "RESOLVE_MINIMAL_LOCALIZATION_BLOCKER",
      "ADVANCE_TO_C6_0_2",
    ]),
    supportingCounts: z
      .object({
        evaluableEventCount: count,
        coreComparableEventCount: count,
        pipelineLimitedCount: count,
        asrLimitedCount: count,
        localizationBlockedCount: count,
        referenceBlockedCount: count,
        oracleImprovedEventCount: count,
      })
      .strict(),
    blockers: z.array(z.string().min(1)),
    strictC602QualityGatePassed: z.boolean(),
    runtimeGoldInputCount: z.literal(0),
    releaseAuthorized: z.literal(false),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    semanticHash: sha256,
  })
  .strict();

export const c6018QualityPolicySchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-8-quality-policy"),
    defaultModes: z
      .object({
        coreSpanProjection: z.literal("observe"),
        coreAsrStability: z.literal("observe"),
        coreFreshVerification: z.literal("off"),
      })
      .strict(),
    goldIsolation: z
      .object({
        machineArtifactGoldInputAllowed: z.literal(false),
        postFreezeEvaluationOnly: z.literal(true),
        goldMayDefineCoreSpan: z.literal(false),
      })
      .strict(),
    frozenRules: z
      .object({
        timingRulesChanged: z.literal(false),
        overlapTrimmingChanged: z.literal(false),
        missingDialogueRecoveryChanged: z.literal(false),
        associationRulesChanged: z.literal(false),
        canonicalAssemblyChanged: z.literal(false),
        riskRulesChanged: z.literal(false),
        secondAsrUsed: z.literal(false),
        ensembleUsed: z.literal(false),
      })
      .strict(),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    machineReleaseAuthorized: z.literal(false),
    semanticHash: sha256,
  })
  .strict();

export const c6018AblationSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-8-ablation"),
    stages: z.array(
      z
        .object({
          stage: z.enum([
            "V0_C6017_BASELINE",
            "V1_CORE_SPAN",
            "V2_CORE_PROJECTION",
            "V3_COMPARABILITY",
            "V4_STABILITY",
            "V5_LOCAL_GOLD_EVALUATION",
            "V6_OPTIONAL_CORE_FRESH",
            "FINAL_DIAGNOSIS",
          ]),
          outputIdentityHash: sha256,
          machineMutationCount: count,
          runtimeGoldInputCount: z.literal(0),
          notes: z.array(z.string().min(1)),
        })
        .strict(),
    ),
    baselineMetrics: c6015QualityMetricsSchema,
    finalMetrics: c6015QualityMetricsSchema,
    semanticHash: sha256,
  })
  .strict();

export const c6018ValidationSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-8-validation"),
    branch: z.literal("codex/c6-0-1-8-core-span-asr-stability"),
    repositoryCommit: z.string().regex(/^[a-f0-9]{40}$/u),
    sourceMediaSha256: sha256,
    goldSha256: sha256,
    sourceReadOnlyVerified: z.boolean(),
    goldReadOnlyVerified: z.boolean(),
    runtimeGoldInputCount: z.literal(0),
    datasetHardcodingFindingCount: z.literal(0),
    unsafeFinalizationEscapeCount: z.literal(0),
    networkUsed: z.literal(false),
    checks: z.array(
      z
        .object({
          id: z.string().min(1),
          passed: z.boolean(),
          evidence: z.array(z.string().min(1)),
        })
        .strict(),
    ),
    finalABParity: z
      .object({
        text: z.boolean(),
        timing: z.boolean(),
        presentation: z.boolean(),
        coreSpan: z.boolean(),
        coreProjection: z.boolean(),
        comparability: z.boolean(),
        stability: z.boolean(),
        localGoldEvaluation: z.boolean(),
        oracle: z.boolean(),
        routeDecision: z.boolean(),
      })
      .strict(),
    canonicalHashes: z
      .object({
        baselineText: sha256,
        finalAText: sha256,
        finalBText: sha256,
        baselineTiming: sha256,
        finalATiming: sha256,
        finalBTiming: sha256,
        baselinePresentation: sha256,
        finalAPresentation: sha256,
        finalBPresentation: sha256,
      })
      .strict(),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    machineReleaseAuthorized: z.literal(false),
    c6018EngineeringPassed: z.boolean(),
    localizedComparabilityPassed: z.boolean(),
    coreStabilityDiagnosticPassed: z.boolean(),
    goldIsolationPassed: z.boolean(),
    strictC602QualityGatePassed: z.boolean(),
    routeDecision: c6018RouteDecisionValueSchema,
    semanticHash: sha256,
  })
  .strict();

export const c6018ShareableSummarySchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-8-shareable-summary"),
    stage: z.enum(["final-a", "final-b"]),
    sourceMediaSha256: sha256,
    machineFreezeHash: sha256,
    runtimeGoldInputCount: z.literal(0),
    networkUsed: z.literal(false),
    fullGoldTextIncluded: z.literal(false),
    privateAudioIncluded: z.literal(false),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    reusedFreshRuntime: z
      .object({
        requestCount: z.literal(36),
        originalFreshInferenceCount: z.literal(36),
        additionalCoreInferenceCount: z.literal(0),
        runtimeBinarySha256: sha256,
        runtimePatchSha256: sha256,
        modelSha256: sha256,
        device: z.string().min(1),
      })
      .strict(),
    coreSpanSummary: machineCoreAcousticSpanSchema.shape.summary,
    projectionSummary: machineCoreTextProjectionSchema.shape.summary,
    comparabilitySummary:
      machineLocalizedCandidateComparabilitySchema.shape.summary,
    stabilitySummary: machineCoreAsrStabilitySchema.shape.summary,
    localGoldSummary: goldLocalCoreEvaluationSchema.shape.summary,
    oracleSummary: machineCoreCandidateOracleEvaluationSchema.shape.summary,
    diagnosisSummary: machineWhisperCoreStabilityEvaluationSchema.shape.summary,
    route: z
      .object({
        decision: c6018RouteDecisionValueSchema,
        confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
        recommendation: z.enum([
          "STOP_SINGLE_WHISPER_RULE_EXPANSION",
          "ONE_SMALL_FINAL_PIPELINE_APPLICATION",
          "RESOLVE_MINIMAL_LOCALIZATION_BLOCKER",
          "ADVANCE_TO_C6_0_2",
        ]),
        strictC602QualityGatePassed: z.boolean(),
      })
      .strict(),
    artifactRelativePaths: z.array(
      z
        .string()
        .min(1)
        .regex(/^(?!\/)(?![A-Za-z]:[\\/])(?!\\\\).+/u),
    ),
    canonicalHashes: z
      .object({
        text: sha256,
        timing: sha256,
        presentation: sha256,
        ass: sha256,
        srt: sha256,
        vtt: sha256,
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export type C6018Mode = z.infer<typeof c6018ModeSchema>;
export type C6018ObserveMode = z.infer<typeof c6018ObserveModeSchema>;
export type CoreSpanStatus = z.infer<typeof coreSpanStatusSchema>;
export type CoreSpanAmbiguityReason = z.infer<
  typeof coreSpanAmbiguityReasonSchema
>;
export type CoreAcousticSpanEvent = z.infer<typeof coreAcousticSpanEventSchema>;
export type MachineCoreAcousticSpan = z.infer<
  typeof machineCoreAcousticSpanSchema
>;
export type CoreProjectionStatus = z.infer<typeof coreProjectionStatusSchema>;
export type CoreProjectionOrigin = z.infer<typeof coreProjectionOriginSchema>;
export type GroupedProjectedToken = z.infer<typeof groupedProjectedTokenSchema>;
export type CoreTextProjectionCandidate = z.infer<
  typeof coreTextProjectionCandidateSchema
>;
export type MachineCoreTextProjection = z.infer<
  typeof machineCoreTextProjectionSchema
>;
export type LocalizedComparabilityStatus = z.infer<
  typeof localizedComparabilityStatusSchema
>;
export type LocalizedCandidateComparabilityEvent = z.infer<
  typeof localizedCandidateComparabilityEventSchema
>;
export type MachineLocalizedCandidateComparability = z.infer<
  typeof machineLocalizedCandidateComparabilitySchema
>;
export type CoreAsrStabilityClass = z.infer<typeof coreAsrStabilityClassSchema>;
export type MachineCoreAsrStability = z.infer<
  typeof machineCoreAsrStabilitySchema
>;
export type LocalGoldEvaluationStatus = z.infer<
  typeof localGoldEvaluationStatusSchema
>;
export type GoldLocalCoreEvaluation = z.infer<
  typeof goldLocalCoreEvaluationSchema
>;
export type MachineCoreFreshVerification = z.infer<
  typeof machineCoreFreshVerificationSchema
>;
export type WhisperCoreDiagnosis = z.infer<typeof whisperCoreDiagnosisSchema>;
export type MachineWhisperCoreStabilityEvaluation = z.infer<
  typeof machineWhisperCoreStabilityEvaluationSchema
>;
export type CoreCandidateOracleSource = z.infer<
  typeof coreCandidateOracleSourceSchema
>;
export type MachineCoreCandidateOracleEvaluation = z.infer<
  typeof machineCoreCandidateOracleEvaluationSchema
>;
export type C6018RouteDecisionValue = z.infer<
  typeof c6018RouteDecisionValueSchema
>;
export type C6018RouteDecision = z.infer<typeof c6018RouteDecisionSchema>;
export type C6018QualityPolicy = z.infer<typeof c6018QualityPolicySchema>;
export type C6018Ablation = z.infer<typeof c6018AblationSchema>;
export type C6018Validation = z.infer<typeof c6018ValidationSchema>;
export type C6018ShareableSummary = z.infer<typeof c6018ShareableSummarySchema>;

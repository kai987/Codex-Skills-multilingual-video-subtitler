import { z } from "zod";

import { c6015QualityMetricsSchema } from "./c6-0-1-5-evidence-application-schemas.js";

export const c6017PolicyVersion =
  "c6.0.1.7-fresh-targeted-reasr-asr-ceiling-v1" as const;

const schemaVersion = z.literal("1.0.0");
const policyVersion = z.literal(c6017PolicyVersion);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const count = z.number().int().nonnegative();
const ratio = z.number().min(0).max(1);
const interval = z
  .object({ start: z.number().nonnegative(), end: z.number().positive() })
  .strict()
  .refine((value) => value.end > value.start, {
    message: "Interval end must be greater than start.",
  });
const sampleInterval = z
  .object({
    startSample: count,
    endSample: z.number().int().positive(),
  })
  .strict()
  .refine((value) => value.endSample > value.startSample, {
    message: "Sample interval end must be greater than start.",
  });
const artifactHeader = {
  schemaVersion,
  policyVersion,
  generatedAt: z.iso.datetime(),
} as const;

export const c6017ModeSchema = z.enum(["off", "observe", "enforce"]);
export const c6017CeilingModeSchema = z.enum(["off", "observe"]);
export const reAsrEvidenceClassSchema = z.enum([
  "POSITIVE_ERROR_EVIDENCE",
  "SUPPORTING_ERROR_EVIDENCE",
  "EVIDENCE_ABSENCE",
  "POSITIVE_CORRECTNESS_EVIDENCE",
  "CONFLICTING_EVIDENCE",
  "UNKNOWN",
]);
export const reAsrProviderFamilySchema = z.enum([
  "TOKEN",
  "CTC",
  "DECODER",
  "SPEECH_VAD",
  "REQUEST_EDGE",
  "CROSS_WINDOW",
  "TEXT_SHAPE",
  "ASSOCIATION",
]);
export const c6017RiskSeveritySchema = z.enum([
  "NONE",
  "WEAK",
  "STRONG",
  "UNKNOWN",
]);

export const reAsrRiskFactV2Schema = z
  .object({
    factType: z.string().min(1),
    evidenceClass: reAsrEvidenceClassSchema,
    severity: c6017RiskSeveritySchema,
    providerFamily: reAsrProviderFamilySchema,
    positiveErrorEvidence: z.boolean(),
    evidenceMissing: z.boolean(),
    sourceEvidenceIds: z.array(z.string().min(1)),
    reasons: z.array(z.string().min(1)),
    semanticHash: sha256,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.positiveErrorEvidence !==
      (value.evidenceClass === "POSITIVE_ERROR_EVIDENCE")
    ) {
      context.addIssue({
        code: "custom",
        path: ["positiveErrorEvidence"],
        message: "Positive-error flag must match evidence class.",
      });
    }
    if (
      value.evidenceMissing !==
      (value.evidenceClass === "EVIDENCE_ABSENCE")
    ) {
      context.addIssue({
        code: "custom",
        path: ["evidenceMissing"],
        message: "Evidence-missing flag must match evidence class.",
      });
    }
  });

export const reAsrRiskEventV2Schema = z
  .object({
    eventId: z.string().min(1),
    candidateId: z.string().min(1),
    riskFacts: z.array(reAsrRiskFactV2Schema),
    positiveErrorEvidenceCount: count,
    strongPositiveErrorEvidenceCount: count,
    supportingEvidenceFamilies: z.array(reAsrProviderFamilySchema),
    evidenceAbsenceCount: count,
    correctnessEvidenceCount: count,
    conflictingEvidence: z.boolean(),
    absenceOnly: z.boolean(),
    eligibility: z.boolean(),
    recommendedAction: z.enum(["KEEP", "VERIFY", "RE_ASR", "REVIEW"]),
    priorityClass: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "NONE"]),
    selectionReason: z.string().min(1),
    stableTieBreakHash: sha256,
    budgetSelected: z.boolean(),
    semanticHash: sha256,
  })
  .strict();

export const machineReAsrRiskV2Schema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-reasr-risk-v2"),
    mode: c6017ModeSchema,
    semantics: z.literal("positive-error-vs-evidence-absence-v2"),
    triggerPolicy: z.literal(
      "one-strong-positive-or-two-supporting-provider-families-or-independent-window-or-incomplete-speech",
    ),
    episodeRequestBudget: z.literal(36),
    maximumRequestsPerEvent: z.literal(3),
    events: z.array(reAsrRiskEventV2Schema),
    summary: z
      .object({
        eventCount: count,
        oldEligibleCount: count,
        eligibleCount: count,
        positiveErrorEvidenceEventCount: count,
        supportingMultiFamilyEventCount: count,
        evidenceAbsenceOnlyEventCount: count,
        selectedEventCount: count,
        selectedAbsenceOnlyEventCount: count,
        plannedRequestCount: count,
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

const decoderEvidenceSchema = z
  .object({
    averageLogProbability: z.number().nullable(),
    noSpeechProbability: z.number().min(0).max(1).nullable(),
    compressionRatio: z.number().nonnegative().nullable(),
    temperature: z.number().nonnegative().nullable(),
    fallbackCount: count.nullable(),
    tokenTimestampAvailable: z.boolean(),
    decoderSegmentCount: count,
    semanticHash: sha256,
  })
  .strict();

const tokenEvidenceSchema = z
  .object({
    tokenId: z.string().min(1),
    text: z.string(),
    probability: z.number().min(0).max(1),
    special: z.boolean(),
    requestLocalInterval: interval.nullable(),
    sourceGlobalInterval: interval.nullable(),
    mappingVerified: z.boolean(),
    semanticHash: sha256,
  })
  .strict();

export const freshReAsrRequestSchema = z
  .object({
    requestId: z.string().min(1),
    requestFamilyId: z.string().min(1),
    eventId: z.string().min(1),
    windowType: z.enum(["near-exact", "small-context", "expanded-context"]),
    sourceGlobalSampleInterval: sampleInterval,
    sourceGlobalInterval: interval,
    extractionIdentity: sha256,
    requestIdentity: sha256,
    audioSha256: sha256,
    sampleCount: z.number().int().positive(),
    sampleRate: z.literal(16000),
    prompt: z.null(),
    promptPresent: z.literal(false),
    candidateTextPromptLeakCount: z.literal(0),
    humanMemoryPromptLeakCount: z.literal(0),
    runtimeGoldInputCount: z.literal(0),
    cacheNamespace: z.literal("c6-0-1-7-fresh-targeted-reasr-v1"),
    cacheHit: z.boolean(),
    inferenceExecuted: z.boolean(),
    modelLoadCount: count,
    processStartCount: count,
    transcriptionSeconds: z.number().nonnegative(),
    responseText: z.string(),
    decoderEvidence: decoderEvidenceSchema,
    tokens: z.array(tokenEvidenceSchema),
    semanticHash: sha256,
  })
  .strict();

export const freshReAsrCandidateSchema = z
  .object({
    candidateId: z.string().min(1),
    eventId: z.string().min(1),
    requestIds: z.array(z.string().min(1)).min(1),
    text: z.string().min(1),
    textHash: sha256,
    normalizedTextHash: sha256,
    sourceGlobalInterval: interval,
    decoderEvidence: decoderEvidenceSchema,
    tokenEvidenceIds: z.array(z.string().min(1)),
    globalTokenMappingVerified: z.boolean(),
    ctcEvidence: z
      .object({
        status: z.enum(["SCORABLE", "UNSCORABLE", "UNAVAILABLE"]),
        score: ratio.nullable(),
        evidenceId: z.string().min(1).nullable(),
        runtimeIdentityHash: sha256.nullable(),
        modelSnapshotHash: sha256.nullable(),
        edgePinned: z.boolean().nullable(),
      })
      .strict(),
    requestEdgeEvidence: z
      .object({
        severity: c6017RiskSeveritySchema,
        evidenceIds: z.array(z.string().min(1)),
      })
      .strict(),
    pronunciationProjection: z
      .object({
        status: z.enum(["PROJECTED", "UNSCORABLE"]),
        projectionTextHash: sha256.nullable(),
        unresolvedUnits: z.array(z.string()),
      })
      .strict(),
    independentLineageIds: z.array(z.string().min(1)),
    correlatedLineageIds: z.array(z.string().min(1)),
    windowSupportCount: z.number().int().positive(),
    evidenceComplete: z.boolean(),
    semanticHash: sha256,
  })
  .strict();

export const machineFreshTargetedReAsrSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-fresh-targeted-reasr"),
    mode: c6017ModeSchema,
    generationKind: z.enum(["FRESH_INFERENCE", "FROZEN_EXACT_CACHE_REPLAY"]),
    sourceIdentity: z
      .object({
        sourceMediaSha256: sha256,
        sourceSampleRate: z.literal(16000),
        sourceTotalSamples: z.number().int().positive(),
        readOnly: z.literal(true),
      })
      .strict(),
    selectedEvents: z.array(
      z
        .object({
          eventId: z.string().min(1),
          candidateId: z.string().min(1),
          sourceGlobalInterval: interval,
          selectionEvidenceIds: z.array(z.string().min(1)),
          semanticHash: sha256,
        })
        .strict(),
    ),
    requests: z.array(freshReAsrRequestSchema),
    candidates: z.array(freshReAsrCandidateSchema),
    stableWindowFamilies: z.array(z.string().min(1)),
    unstableWindowFamilies: z.array(z.string().min(1)),
    inferenceRuntime: z
      .object({
        runtimeType: z.literal("whisper.cpp-mvl"),
        whisperCppVersion: z.string().min(1),
        runtimeBinarySha256: sha256,
        runtimePatchSha256: sha256,
        modelSha256: sha256,
        modelBasename: z.string().min(1),
        device: z.enum(["metal", "cpu"]),
        persistentWorker: z.literal(true),
        requestStateIsolation: z.literal("require-safe"),
      })
      .strict(),
    summary: z
      .object({
        selectedEventCount: count,
        plannedRequestCount: count,
        actualRequestCount: count,
        extractionCount: count,
        uniqueAudioShaCount: count,
        cacheHitCount: count,
        freshInferenceCount: count,
        modelLoadCount: count,
        processStartCount: count,
        transcriptionSeconds: z.number().nonnegative(),
        freshCandidateCount: count,
        evidenceCompleteCandidateCount: count,
        evidenceIncompleteCandidateCount: count,
        promptIsolationPassed: z.boolean(),
        candidateTextPromptLeakCount: z.literal(0),
        humanMemoryLeakCount: z.literal(0),
        runtimeGoldInputCount: z.literal(0),
        networkUsed: z.literal(false),
        freshReasrValidationPassed: z.boolean(),
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const freshCandidateOutcomeSchema = z.enum([
  "NEW_CANDIDATE_DOMINATES",
  "ORIGINAL_DOMINATES",
  "FRESH_CANDIDATES_AGREE",
  "FRESH_CANDIDATES_DISAGREE",
  "ALL_CANDIDATES_WEAK",
  "AMBIGUOUS",
]);

const comparisonCandidateSchema = z
  .object({
    candidateId: z.string().min(1),
    origin: z.enum(["ORIGINAL", "RECOVERY", "HISTORICAL_REASR", "FRESH_REASR"]),
    textHash: sha256,
    ctcSupport: ratio.nullable(),
    decoderSupport: ratio.nullable(),
    independentWindowSupport: count,
    trustedTokenCoverage: ratio,
    speechCompleteness: ratio,
    requestEdgeRisk: c6017RiskSeveritySchema,
    pronunciationSupport: ratio.nullable(),
    repetitionRisk: ratio,
    hallucinationRisk: ratio,
    evidenceComplete: z.boolean(),
    dominanceEvidenceCount: count,
    semanticHash: sha256,
  })
  .strict();

export const machineFreshCandidateComparisonSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-fresh-candidate-comparison"),
    zone: z.literal("runtime-machine-only"),
    runtimeGoldInputCount: z.literal(0),
    events: z.array(
      z
        .object({
          eventId: z.string().min(1),
          originalCandidateId: z.string().min(1),
          candidates: z.array(comparisonCandidateSchema).min(1),
          outcome: freshCandidateOutcomeSchema,
          topCandidateId: z.string().min(1).nullable(),
          freshTopCandidateId: z.string().min(1).nullable(),
          replacementProposed: z.boolean(),
          replacementApplied: z.boolean(),
          applicationBlocker: z.enum([
            "NONE",
            "SELECTOR",
            "SPAN_LINEAGE",
            "SAFETY_GATE",
            "ASSOCIATION",
            "POOL_NOT_IMPROVED",
          ]),
          reasons: z.array(z.string().min(1)),
          semanticHash: sha256,
        })
        .strict(),
    ),
    summary: z
      .object({
        eventCount: count,
        newCandidateDominatesCount: count,
        originalDominatesCount: count,
        freshCandidatesAgreeCount: count,
        freshCandidatesDisagreeCount: count,
        allCandidatesWeakCount: count,
        ambiguousCount: count,
        freshCandidateTop1Count: count,
        replacementProposalCount: count,
        replacementAppliedCount: count,
        freshPoolImprovedRuntimeProxyCount: count,
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const reAsrCausalClassSchema = z.enum([
  "BEFORE_CORRECT",
  "BEFORE_WRONG_AFTER_IMPROVED",
  "BEFORE_WRONG_AFTER_SAME",
  "BEFORE_WRONG_AFTER_WORSE",
  "BEFORE_WRONG_AFTER_UNSTABLE",
  "UNEVALUABLE",
]);

export const machineReAsrCausalEvaluationSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-reasr-causal-evaluation"),
    zone: z.literal("evaluation-only-gold-isolated-post-freeze"),
    runtimeGoldInputCount: z.literal(0),
    events: z.array(
      z
        .object({
          eventId: z.string().min(1),
          classification: reAsrCausalClassSchema,
          baselineDistance: z.number().nonnegative().nullable(),
          oldPoolBestDistance: z.number().nonnegative().nullable(),
          freshPoolBestDistance: z.number().nonnegative().nullable(),
          runtimeSelectedDistance: z.number().nonnegative().nullable(),
          baselineGoldError: z.boolean().nullable(),
          poolImproved: z.boolean().nullable(),
          safeReplacementGoldImproved: z.boolean().nullable(),
          evidenceIds: z.array(z.string().min(1)),
          semanticHash: sha256,
        })
        .strict(),
    ),
    summary: z
      .object({
        selectedEventCount: count,
        evaluableCount: count,
        selectedEventGoldErrorHitCount: count,
        baselineWrongSelectedCount: count,
        beforeCorrectCount: count,
        improvedCount: count,
        noImprovementCount: count,
        worsenedCount: count,
        unstableCount: count,
        unevaluableCount: count,
        baselineErrorHitRate: ratio,
        recoveryRate: ratio,
        safeReplacementRate: ratio,
        oldPoolOracleQuality: ratio,
        freshPoolOracleQuality: ratio,
        oracleImprovement: z.number(),
        selectorRegretBefore: ratio,
        selectorRegretAfter: ratio,
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const asrCeilingClassV2Schema = z.enum([
  "REASR_UNTESTED_POTENTIAL",
  "REASR_TESTED_IMPROVED_POOL",
  "REASR_TESTED_NO_IMPROVEMENT",
  "REASR_TESTED_WORSENED_POOL",
  "REASR_TESTED_SAFE_REPLACEMENT",
  "REASR_TESTED_UNSAFE_REPLACEMENT",
  "WHISPER_MULTIWINDOW_CONSISTENT_ERROR",
  "WHISPER_WINDOW_INSTABILITY",
  "SELECTOR_APPLICATION_BLOCKER",
  "SPAN_APPLICATION_BLOCKER",
  "POOL_INSUFFICIENT",
  "UNEVALUABLE",
]);

export const machineAsrCeilingEvaluationV2Schema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-asr-ceiling-evaluation-v2"),
    zone: z.literal("evaluation-only-gold-isolated-post-freeze"),
    runtimeGoldInputCount: z.literal(0),
    perEventEntries: z.array(
      z
        .object({
          eventId: z.string().min(1),
          classification: asrCeilingClassV2Schema,
          freshInferenceVerified: z.boolean(),
          audioIntervalVerified: z.boolean(),
          promptIsolationVerified: z.boolean(),
          decoderOutputValid: z.boolean(),
          freshWindowAgreement: z.enum(["CONSISTENT", "UNSTABLE", "UNKNOWN"]),
          runtimeReplacementApplied: z.boolean(),
          goldImproved: z.boolean().nullable(),
          evidenceIds: z.array(z.string().min(1)),
          semanticHash: sha256,
        })
        .strict(),
    ),
    summary: z
      .object({
        untestedPotential: count,
        testedImprovedPool: count,
        testedNoImprovement: count,
        testedWorsened: count,
        testedSafeReplacement: count,
        testedUnsafeReplacement: count,
        whisperMultiwindowConsistentError: count,
        whisperWindowInstability: count,
        selectorApplicationBlocker: count,
        spanApplicationBlocker: count,
        poolInsufficient: count,
        unevaluable: count,
        pipelineVsAsrDecision: z.enum([
          "PIPELINE_STILL_PRIMARY",
          "ASR_STILL_PRIMARY",
          "MIXED",
          "INSUFFICIENT_EVIDENCE",
        ]),
        recommendAsrEnsembleNext: z.boolean(),
        ceilingValidationPassed: z.boolean(),
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const associationErrorClassSchema = z.enum([
  "TRUE_ASSOCIATION_MISMATCH",
  "NON_UNIQUE_EVENT_TO_CUE_MAPPING",
  "SEGMENTATION_AMBIGUITY",
  "MANY_TO_ONE_EXPECTED",
  "ONE_TO_MANY_EXPECTED",
  "EVENT_BOUNDARY_AMBIGUITY",
  "SPAN_LINEAGE_AMBIGUITY",
  "UNKNOWN_ASSOCIATION",
]);

export const machineAssociationErrorTaxonomySchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-association-error-taxonomy"),
    zone: z.literal("evaluation-only-gold-isolated-post-freeze"),
    runtimeGoldInputCount: z.literal(0),
    entries: z.array(
      z
        .object({
          errorId: z.string().min(1),
          eventIds: z.array(z.string().min(1)),
          finalCueIds: z.array(z.string().min(1)),
          classification: associationErrorClassSchema,
          evidenceIds: z.array(z.string().min(1)),
          reasons: z.array(z.string().min(1)),
          semanticHash: sha256,
        })
        .strict(),
    ),
    summary: z
      .object({
        oldAssociationErrorCount: count,
        trueAssociationMismatchCount: count,
        nonUniqueMappingCount: count,
        segmentationAmbiguityCount: count,
        manyToOneExpectedCount: count,
        oneToManyExpectedCount: count,
        eventBoundaryAmbiguityCount: count,
        spanLineageAmbiguityCount: count,
        unknownAssociationCount: count,
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const c6017QualityPolicySchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-7-quality-policy"),
    policyFrozenAt: z.iso.datetime(),
    goldAccessBeforeFreezeCount: z.literal(0),
    riskTriggerPolicy: z.literal(
      "one-strong-positive-or-two-supporting-provider-families-or-independent-window-or-incomplete-speech",
    ),
    freshWindowPolicy: z.literal("near-exact-small-context-expanded-context"),
    eventBudget: z.literal(12),
    requestBudget: z.literal(36),
    maximumRequestsPerEvent: z.literal(3),
    freshCacheNamespace: z.literal("c6-0-1-7-fresh-targeted-reasr-v1"),
    promptAllowed: z.literal(false),
    runtimeGoldInputAllowed: z.literal(false),
    timingPolicy: z.literal("frozen-c6-0-1-5-safe-six-no-new-rules"),
    c602Thresholds: z
      .object({
        coverageMinimum: z.literal(0.9),
        missingMaximum: z.literal(15),
        hallucinationMaximum: z.literal(2),
        materialErrorMaximum: z.literal(45),
        normalizedCerMaximum: z.literal(0.55),
        severeTimingMaximum: z.literal(30),
        startMaeMaximumSeconds: z.literal(1.2),
        endMaeMaximumSeconds: z.literal(1.2),
        p95MaximumSeconds: z.literal(3.5),
        overlapMaximum: z.literal(20),
      })
      .strict(),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    machineReleaseAuthorized: z.literal(false),
    policyHash: sha256,
    semanticHash: sha256,
  })
  .strict();

export const c6017QualityMetricsSchema = c6015QualityMetricsSchema
  .extend({
    freshSelectedEventCount: count,
    freshInferenceCount: count,
    freshCandidateCount: count,
    freshReplacementAppliedCount: count,
  })
  .strict();

export const c6017AblationSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-7-ablation"),
    stages: z.array(
      z
        .object({
          id: z.enum([
            "V0",
            "V1",
            "V2",
            "V3",
            "V4",
            "V5",
            "V6",
            "final-a",
            "final-b",
          ]),
          label: z.string().min(1),
          outputPath: z.string().min(1),
          outputFreezeHash: sha256.nullable(),
          metrics: c6017QualityMetricsSchema.nullable(),
          status: z.enum(["completed", "not-run", "failed"]),
          generationKind: z.enum([
            "NO_MODEL",
            "FRESH_INFERENCE",
            "FROZEN_EXACT_CACHE_REPLAY",
          ]),
          modelExecutionHash: sha256,
        })
        .strict(),
    ),
    semanticHash: sha256,
  })
  .strict();

export const c6017ValidationSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-7-validation"),
    branch: z.literal("codex/c6-0-1-7-fresh-reasr-asr-ceiling-validation"),
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
        riskV2: z.boolean(),
        freshRequests: z.boolean(),
        freshCandidates: z.boolean(),
        comparison: z.boolean(),
        mutation: z.boolean(),
        shadowOutcome: z.boolean(),
      })
      .strict(),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    machineReleaseAuthorized: z.literal(false),
    freshReAsrEngineeringPassed: z.boolean(),
    asrCeilingValidationPassed: z.boolean(),
    riskSemanticsPassed: z.boolean(),
    associationTaxonomyPassed: z.boolean(),
    pipelineQualityMilestonePassed: z.boolean(),
    strictC602QualityGatePassed: z.boolean(),
    outcome: z.enum([
      "HOLD_FOR_FINAL_PIPELINE_APPLICATION",
      "HOLD_AND_RECOMMEND_ASR_ENSEMBLE",
      "HOLD_MIXED_PIPELINE_AND_ASR",
      "GO_C6_0_2",
    ]),
    semanticHash: sha256,
  })
  .strict();

export type C6017Mode = z.infer<typeof c6017ModeSchema>;
export type C6017CeilingMode = z.infer<typeof c6017CeilingModeSchema>;
export type ReAsrEvidenceClass = z.infer<typeof reAsrEvidenceClassSchema>;
export type ReAsrProviderFamily = z.infer<typeof reAsrProviderFamilySchema>;
export type C6017RiskSeverity = z.infer<typeof c6017RiskSeveritySchema>;
export type ReAsrRiskFactV2 = z.infer<typeof reAsrRiskFactV2Schema>;
export type ReAsrRiskEventV2 = z.infer<typeof reAsrRiskEventV2Schema>;
export type MachineReAsrRiskV2 = z.infer<typeof machineReAsrRiskV2Schema>;
export type FreshReAsrRequest = z.infer<typeof freshReAsrRequestSchema>;
export type FreshReAsrCandidate = z.infer<typeof freshReAsrCandidateSchema>;
export type MachineFreshTargetedReAsr = z.infer<
  typeof machineFreshTargetedReAsrSchema
>;
export type MachineFreshCandidateComparison = z.infer<
  typeof machineFreshCandidateComparisonSchema
>;
export type ReAsrCausalClass = z.infer<typeof reAsrCausalClassSchema>;
export type MachineReAsrCausalEvaluation = z.infer<
  typeof machineReAsrCausalEvaluationSchema
>;
export type AsrCeilingClassV2 = z.infer<typeof asrCeilingClassV2Schema>;
export type MachineAsrCeilingEvaluationV2 = z.infer<
  typeof machineAsrCeilingEvaluationV2Schema
>;
export type AssociationErrorClass = z.infer<typeof associationErrorClassSchema>;
export type MachineAssociationErrorTaxonomy = z.infer<
  typeof machineAssociationErrorTaxonomySchema
>;
export type C6017QualityPolicy = z.infer<typeof c6017QualityPolicySchema>;
export type C6017QualityMetrics = z.infer<typeof c6017QualityMetricsSchema>;
export type C6017Ablation = z.infer<typeof c6017AblationSchema>;
export type C6017Validation = z.infer<typeof c6017ValidationSchema>;

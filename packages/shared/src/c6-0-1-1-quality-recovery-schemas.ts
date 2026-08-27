import { z } from "zod";

export const machineQualityRecoveryModeSchema = z.enum([
  "off",
  "observe",
  "enforce",
]);

export const machineQualityRecoveryProfileSchema = z.enum([
  "legacy",
  "diagnostics",
  "coverage",
  "timing",
  "full",
]);

const schemaVersion = z.literal("1.0.0");
const policyVersion = z.literal("c6.0.1.1-machine-quality-recovery-v1");
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const gitCommitSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const nullableSha256Schema = sha256Schema.nullable();
const finiteNonNegative = z.number().nonnegative();
const count = z.number().int().nonnegative();

const runIdentitySchema = z
  .object({
    runId: z.string().min(1),
    repositoryCommit: gitCommitSchema,
    sourceMediaSha256: sha256Schema,
    goldRuntimeInputCount: z.literal(0),
  })
  .strict();

const artifactHeader = {
  schemaVersion,
  policyVersion,
  generatedAt: z.iso.datetime(),
  mode: machineQualityRecoveryModeSchema,
  profile: machineQualityRecoveryProfileSchema,
  run: runIdentitySchema,
} as const;

const evidenceQualitySchema = z
  .object({
    status: z.enum(["verified", "partial", "unavailable", "rejected"]),
    inspectedArtifactCount: count,
    schemaValidatedArtifactCount: count,
    semanticEvidenceCount: count,
    reasons: z.array(z.string()),
  })
  .strict();

export const machineGenerationSurvivalFunnelSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-generation-survival-funnel"),
    stages: z.array(
      z
        .object({
          id: z.string().min(1),
          inputCount: count,
          outputCount: count,
          droppedCount: count,
          retentionRatio: z.number().min(0).max(1),
          lossReasons: z.array(
            z.object({ reason: z.string().min(1), count }).strict(),
          ),
        })
        .strict(),
    ),
    snapshots: z.array(
      z
        .object({
          id: z.enum([
            "source-media",
            "speech-region",
            "asr-request",
            "raw-asr-segment",
            "raw-asr-token",
            "normalized-asr-segment",
            "candidate",
            "localized-candidate",
            "associated-candidate",
            "deduplicated-candidate",
            "accepted-canonical-unit",
            "merged-canonical-unit",
            "final-machine-cue",
          ]),
          unitCount: count,
          textCharacterCount: count,
          temporalCoverageSeconds: finiteNonNegative,
          uniqueTemporalCoverageSeconds: finiteNonNegative,
          sourceUnitIds: z.array(z.string().min(1)),
        })
        .strict(),
    ),
    finalCueLineage: z.array(
      z
        .object({
          finalCueId: z.string().min(1),
          rawAsrSegmentIds: z.array(z.string().min(1)),
          sourceRequestIds: z.array(z.string().min(1)),
          audioIntervals: z.array(
            z
              .object({ start: finiteNonNegative, end: finiteNonNegative })
              .strict(),
          ),
          decisionPath: z.array(z.string().min(1)),
          unresolvedLineageReasons: z.array(z.string().min(1)),
        })
        .strict(),
    ),
    rejectedUnits: z.array(
      z
        .object({
          unitId: z.string().min(1),
          stage: z.string().min(1),
          reason: z.enum([
            "empty-text",
            "low-confidence",
            "duplicate",
            "broad-window-only",
            "ambiguous-association",
            "missing-local-interval",
            "partial-fragment",
            "hallucination-risk",
            "repetition-collapse",
            "overlap-conflict",
            "timing-integrity-failure",
            "candidate-not-selected",
            "post-merge-absorbed",
            "quality-gate-rejected",
            "unknown",
          ]),
          evidenceIds: z.array(z.string().min(1)),
        })
        .strict(),
    ),
    summary: z
      .object({
        whisperRequestCount: count,
        baselineChunkCount: count,
        baselineAcceptedCueCount: count,
        recoveryRequestCount: count,
        recoveredCueCount: count,
        rawSegmentCount: count,
        finalCueCount: count,
        dominantLossStage: z.string().nullable(),
        dominantLossCount: count,
        unknownRejectionCount: count,
        lineageCompleteCueCount: count,
        lineageIncompleteCueCount: count,
      })
      .strict(),
  })
  .strict();

export const asrRetentionAuditSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("asr-retention-audit"),
    baseline: z
      .object({
        chunkCount: count,
        rawSegmentCount: count,
        canonicalUtteranceCount: count,
        acceptedCueCount: count,
        suspectedHallucinationCount: count,
        crossUtteranceLoopCount: count,
      })
      .strict(),
    candidateRetention: z
      .object({
        canonicalUtteranceCount: count,
        candidateCount: count,
        clusterCount: count,
        winnerCount: count,
        postDeduplicationCount: count,
        postFragmentRepairCount: count,
        postNormalizationCount: count,
        finalIntegrityCandidateCount: count,
        finalCueCount: count,
      })
      .strict(),
    promptContamination: z
      .object({
        recoveryAttemptCount: count,
        attemptsWithAdjacentText: count,
        attemptsWithUnverifiedAdjacentText: count,
        uniqueAdjacentPromptCount: count,
        contaminationDetected: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const whisperRuntimeExecutionAuditSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("whisper-runtime-execution-audit"),
    runtime: z
      .object({
        intendedVersion: z.string(),
        actualVersion: z.string(),
        whisperCppVersion: z.string(),
        modelName: z.string(),
        modelSha256: nullableSha256Schema,
        binarySha256: nullableSha256Schema,
        runtimeManifest: z.string(),
        compatibilityReason: z.string(),
        device: z.string(),
        requestedMode: z.string(),
        actualMode: z.string(),
      })
      .strict(),
    execution: z
      .object({
        asrRequestCount: count,
        cacheHitCount: count,
        inferenceCount: count,
        processCount: count,
        workerStartCount: count,
        modelLoadCount: count,
        transcriptionSeconds: finiteNonNegative,
        fallbackProcessCount: count,
        uniqueAudioIntervalCount: count,
        duplicateIntervalCount: count,
        narrowRequestCount: count,
        broadRequestCount: count,
        recoveryRequestCount: count,
        primaryGenerationRequestCount: count,
        averageAudioSeconds: finiteNonNegative,
        totalAudioSecondsProcessed: finiteNonNegative,
        duplicateAudioSecondsProcessed: finiteNonNegative,
      })
      .strict(),
    evidenceQuality: evidenceQualitySchema,
  })
  .strict();

export const machineSpeechCoverageGapSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-speech-coverage-gap"),
    speechIntervalCount: count,
    cueCount: count,
    speechSeconds: finiteNonNegative,
    coveredSpeechSeconds: finiteNonNegative,
    coverageRatio: z.number().min(0).max(1),
    gaps: z.array(
      z
        .object({
          id: z.string(),
          start: finiteNonNegative,
          end: finiteNonNegative,
          duration: finiteNonNegative,
          reason: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

export const machineCoverageRecoverySchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-coverage-recovery"),
    recoveryUnitCount: count,
    recoveryRequestCount: count,
    recoveredUnitCount: count,
    unresolvedUnitCount: count,
    cacheHitCount: count,
    adjacentPromptPolicy: z.enum([
      "legacy-all-cues",
      "diagnostic-only",
      "machine-verified-only",
      "disabled-unverified-context",
    ]),
    adjacentPromptCount: count,
    unverifiedAdjacentPromptCount: count,
    canonicalCueMutationCount: count,
    canonicalTimingMutationCount: count,
  })
  .strict();

export const machineTokenTimestampRecoverySchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-token-timestamp-recovery"),
    baselineCueCount: count,
    baselineCueWithTokenCount: count,
    recoveryAttemptCount: count,
    recoveryAttemptWithTokenCount: count,
    mappedTokenCount: count,
    unmappedTokenCount: count,
    trustedForCanonicalTiming: z.boolean(),
    rejectionReasons: z.array(z.string()),
  })
  .strict();

export const machineTimingEvidenceSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-timing-evidence"),
    timestampStrategy: z.string(),
    targetChunkSeconds: finiteNonNegative.nullable(),
    vadEnabled: z.boolean(),
    rawVadEvidenceAvailable: z.boolean(),
    mappedTokenEvidenceAvailable: z.boolean(),
    stockVadTimelineTrusted: z.boolean(),
    timingEvidenceApplied: z.boolean(),
    timingMutationCount: count,
    reasons: z.array(z.string()),
  })
  .strict();

const integrationSchema = (artifactType: string) =>
  z
    .object({
      ...artifactHeader,
      artifactType: z.literal(artifactType),
      integration: z
        .object({
          status: z.enum([
            "not-requested",
            "unavailable",
            "observed",
            "applied",
            "rejected",
          ]),
          runtimeIdentity: z.string().nullable(),
          modelInferenceCount: count,
          cacheHitCount: count,
          candidateCount: count,
          appliedCount: count,
          canonicalCueMutationCount: count,
          canonicalTimingMutationCount: count,
          reasons: z.array(z.string()),
        })
        .strict(),
      evidenceQuality: evidenceQualitySchema,
    })
    .strict();

export const machineMfaIntegrationSchema = integrationSchema(
  "machine-mfa-integration",
);
export const machineCtcIntegrationSchema = integrationSchema(
  "machine-ctc-integration",
);
export const machineSpeakerOverlapRecoverySchema = integrationSchema(
  "machine-speaker-overlap-recovery",
);

export const machineQualityRecoveryPolicySchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-quality-recovery-policy"),
    defaultMode: z.literal("off"),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    machineOnlyReleaseAuthorized: z.literal(false),
    humanDerivedRuntimeInputAllowed: z.literal(false),
    strategies: z
      .object({
        targetChunkSeconds: finiteNonNegative.nullable(),
        vadMode: z.enum(["off", "on", "evidence-gated"]),
        sceneRouting: z.string(),
        adjacentPromptPolicy: z.string(),
      })
      .strict(),
    milestone: z
      .object({
        normalizedCerMaximum: z.number().min(0),
        coverageMinimum: z.number().min(0).max(1),
        missingDialogueMaximum: count,
        materialTextDefectMaximum: count,
        startMaeSecondsMaximum: finiteNonNegative,
        endMaeSecondsMaximum: finiteNonNegative,
        p95BoundaryErrorSecondsMaximum: finiteNonNegative,
        severeTimingDefectMaximum: count,
        hallucinationMaximum: count,
      })
      .strict(),
  })
  .strict();

export const machineQualityRecoveryAblationSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-quality-recovery-ablation"),
    configurationHash: sha256Schema,
    enabledStrategies: z.array(z.string()),
    rejectedStrategies: z.array(
      z.object({ strategy: z.string(), reason: z.string() }).strict(),
    ),
    runtimeGoldInputCount: z.literal(0),
    canonicalCueHash: nullableSha256Schema,
    timingHash: nullableSha256Schema,
    presentationHash: nullableSha256Schema,
  })
  .strict();

export const goldLossAttributionSchema = z
  .object({
    schemaVersion,
    policyVersion,
    generatedAt: z.iso.datetime(),
    artifactType: z.literal("gold-loss-attribution"),
    evaluationOnly: z.literal(true),
    goldRuntimeInputCount: z.literal(0),
    machineRunId: z.string(),
    goldArtifactSha256: sha256Schema,
    machineMetrics: z
      .object({
        cueCount: count,
        normalizedCer: z.number().nonnegative(),
        speechCoverage: z.number().min(0).max(1),
        missingDialogueCount: count,
        materialTextDefectCount: count,
        severeTimingDefectCount: count,
      })
      .strict(),
    attribution: z.array(
      z
        .object({
          stage: z.string(),
          estimatedGoldLossCount: count,
          evidence: z.array(z.string()),
        })
        .strict(),
    ),
  })
  .strict();

export const c6011QualityMetricsSchema = z
  .object({
    cueCount: count,
    normalizedCer: z.number().nonnegative(),
    speechCoverage: z.number().min(0).max(1),
    missingDialogueCount: count,
    materialTextDefectCount: count,
    severeTimingDefectCount: count,
    startMaeSeconds: finiteNonNegative,
    endMaeSeconds: finiteNonNegative,
    p95BoundaryErrorSeconds: finiteNonNegative,
    hallucinationCount: count,
    p1DefectCount: count,
  })
  .strict();

export const c6011QualityComparisonSchema = z
  .object({
    schemaVersion,
    policyVersion,
    generatedAt: z.iso.datetime(),
    artifactType: z.literal("c6-0-1-1-quality-comparison"),
    runs: z.array(
      z
        .object({
          runId: z.string(),
          profile: machineQualityRecoveryProfileSchema,
          metrics: c6011QualityMetricsSchema,
          runtimeGoldInputCount: z.literal(0),
          machineArtifactHash: sha256Schema,
        })
        .strict(),
    ),
    deterministicRanking: z.array(z.string()),
    selectedRunId: z.string().nullable(),
    selectionReasons: z.array(z.string()),
  })
  .strict();

export const c6011QualityValidationSchema = z
  .object({
    schemaVersion,
    policyVersion,
    generatedAt: z.iso.datetime(),
    artifactType: z.literal("c6-0-1-1-quality-validation"),
    baselineSchemaCount: z.literal(149),
    generatedSchemaCount: count,
    checks: z.array(
      z
        .object({
          id: z.string(),
          passed: z.boolean(),
          details: z.string(),
        })
        .strict(),
    ),
    milestonePassed: z.boolean(),
    finalAAndBReproducible: z.boolean(),
    goldRuntimeIsolationPassed: z.boolean(),
    safetyRegressionCount: count,
    machineOnlyReleaseAuthorized: z.literal(false),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    nextStep: z.enum(["GO_C6_0_2", "HOLD_C6_0_2"]),
  })
  .strict();

export type MachineQualityRecoveryMode = z.infer<
  typeof machineQualityRecoveryModeSchema
>;
export type MachineQualityRecoveryProfile = z.infer<
  typeof machineQualityRecoveryProfileSchema
>;
export type C6011QualityMetrics = z.infer<typeof c6011QualityMetricsSchema>;

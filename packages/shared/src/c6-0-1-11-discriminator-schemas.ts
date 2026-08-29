import { z } from "zod";

export const c60111PolicyVersion =
  "c6.0.1.11-paired-evidence-independent-discriminator-v1" as const;

const schemaVersion = z.literal("1.0.0");
const policyVersion = z.literal(c60111PolicyVersion);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const count = z.number().int().nonnegative();
const finite = z.number().finite();
const ratio = finite.min(0).max(1);
const artifactHeader = {
  schemaVersion,
  policyVersion,
  generatedAt: z.iso.datetime(),
} as const;

const intervalSchema = z
  .object({ start: finite.nonnegative(), end: finite.positive() })
  .strict()
  .refine((value) => value.end > value.start, {
    message: "Interval end must be greater than start.",
  });

const crossModelRelationSchema = z.enum([
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

export const whisperCoreStabilityV2Schema = z.enum([
  "WHISPER_CORE_STABLE",
  "WHISPER_CONTEXT_EXTENSION_ONLY",
  "WHISPER_LEXICALLY_UNSTABLE",
  "WHISPER_HALLUCINATION_UNSTABLE",
  "WHISPER_EMPTY_UNSTABLE",
  "WHISPER_PARTIAL_AGREEMENT",
  "WHISPER_UNCOMPARABLE",
]);

const machineCandidateSchema = z
  .object({
    candidateId: z.string().min(1),
    displayText: z.string(),
    normalizedText: z.string(),
    pronunciationText: z.string(),
    hallucinationRisk: ratio,
    semanticHash: sha256,
  })
  .strict();

export const machineCrossModelCalibrationCorpusSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-cross-model-calibration-corpus"),
    sourceMediaSha256: sha256,
    baselineEvidenceSemanticHash: sha256,
    inclusionPolicy: z.literal(
      "machine-localizable-disagreements-plus-deterministic-low-risk-controls-v1",
    ),
    controlSelectionPolicy: z.literal(
      "relation-stratified-stable-hash-first-without-gold-v1",
    ),
    events: z.array(
      z
        .object({
          eventId: z.string().min(1),
          role: z.enum(["DISAGREEMENT", "CONTROL"]),
          sourceInterval: intervalSchema,
          coreInterval: intervalSchema,
          crossModelRelation: crossModelRelationSchema,
          selectionReasons: z.array(z.string().min(1)).min(1),
          audioGroupId: z.string().min(1),
          goldSeenAtSelection: z.literal(false),
          semanticHash: sha256,
        })
        .strict(),
    ),
    summary: z
      .object({
        eventCount: count,
        disagreementCount: count,
        controlCount: count,
        machineLocalizableCount: count,
        reconstructableAudioCount: count,
        runtimeGoldInputCount: z.literal(0),
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

const whisperDecoderEvidenceSchema = z
  .object({
    averageLogProbability: finite.nullable(),
    noSpeechProbability: ratio.nullable(),
    compressionRatio: finite.nonnegative().nullable(),
    temperature: finite.nonnegative().nullable(),
    fallbackCount: count.nullable(),
    tokenTimestampAvailable: z.boolean(),
    decoderSegmentCount: count,
  })
  .strict();

const pairedWhisperCandidateSchema = machineCandidateSchema.extend({
  requestId: z.string().min(1),
  windowType: z.enum(["CORE_EXACT", "CORE_CONTEXT"]),
  sourceInterval: intervalSchema,
  audioSha256: sha256,
  cacheKey: sha256,
  execution: z.enum(["FRESH_INFERENCE", "VERIFIED_EXACT_REPLAY"]),
  decoderEvidence: whisperDecoderEvidenceSchema,
  tokenEvidenceAvailable: z.boolean(),
});

export const machinePairedWhisperEvidenceSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-paired-whisper-evidence"),
    corpusSemanticHash: sha256,
    sourceMediaSha256: sha256,
    contextPolicy: z.literal("symmetric-one-second-source-context-v1"),
    promptPolicy: z.literal("null-prompt-no-candidate-no-gold-v1"),
    modelIdentity: z
      .object({
        modelId: z.literal("whisper.cpp/large-v3"),
        modelSha256: sha256,
        runtimeId: sha256,
        runtimeBinarySha256: sha256,
        runtimePatchSha256: sha256,
        device: z.enum(["metal", "cpu"]),
        precision: z.string().min(1),
      })
      .strict(),
    requests: z
      .object({
        coreExactPlannedCount: count,
        coreExactActualCount: count,
        coreExactFreshInferenceCount: count,
        coreExactCacheReplayCount: count,
        coreContextPlannedCount: count,
        coreContextActualCount: count,
        coreContextFreshInferenceCount: count,
        coreContextCacheReplayCount: count,
        failedCount: count,
        modelLoadCount: count,
        processStartCount: count,
      })
      .strict(),
    events: z.array(
      z
        .object({
          eventId: z.string().min(1),
          whisperCurrentCandidate: machineCandidateSchema,
          whisperCoreExact: pairedWhisperCandidateSchema.nullable(),
          whisperCoreContext: pairedWhisperCandidateSchema.nullable(),
          stabilityClass: whisperCoreStabilityV2Schema,
          exactAudioSha256: sha256.nullable(),
          contextAudioSha256: sha256.nullable(),
          semanticHash: sha256,
        })
        .strict(),
    ),
    summary: z
      .object({
        requiredEventCount: count,
        pairedEvidenceAvailableCount: count,
        exactOnlyCount: count,
        contextMissingCount: count,
        uncomparableCount: count,
        coverage: ratio,
        stabilityCounts: z.record(whisperCoreStabilityV2Schema, count),
        runtimeGoldInputCount: z.literal(0),
        networkUsed: z.literal(false),
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const machineIndependentVerifierRuntimeSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-independent-verifier-runtime"),
    modelIdentity: z
      .object({
        modelId: z.literal(
          "jonatasgrosman/wav2vec2-large-xlsr-53-japanese",
        ),
        requestedRevision: z.string().min(7),
        resolvedRevision: z.string().regex(/^[a-f0-9]{40}$/u),
        modelSnapshotHash: sha256,
        configSha256: sha256,
        preprocessorSha256: sha256,
        vocabularySha256: sha256,
        modelWeightSha256: sha256,
        processorSha256: sha256,
      })
      .strict(),
    runtimeIdentity: z
      .object({
        runtimeId: sha256,
        pythonVersion: z.string().min(1),
        torchVersion: z.string().min(1),
        transformersVersion: z.string().min(1),
        scikitLearnVersion: z.string().min(1),
        numpyVersion: z.string().min(1),
        scipyVersion: z.string().min(1),
        device: z.literal("cpu"),
        precision: z.literal("fp32"),
        sampleRate: z.literal(16000),
        workerSourceSha256: sha256,
      })
      .strict(),
    requests: z
      .object({
        plannedCount: count,
        actualCount: count,
        freshInferenceCount: count,
        cacheHitCount: count,
        failedCount: count,
        modelLoadCount: count,
        processStartCount: count,
        wallClockSeconds: finite.nonnegative(),
      })
      .strict(),
    bootstrapNetworkUsed: z.boolean(),
    inferenceNetworkUsed: z.literal(false),
    runtimeGoldInputCount: z.literal(0),
    semanticHash: sha256,
  })
  .strict();

const projectedCandidateScoreSchema = z
  .object({
    candidateId: z.string().min(1),
    representation: z.enum(["NORMALIZED_DISPLAY", "PRONUNCIATION"]),
    representationHash: sha256,
    encodedTokenCount: count,
    unknownTokenCount: count,
    coverageRatio: ratio,
    rawNll: finite.nonnegative().nullable(),
    nllPerTargetToken: finite.nonnegative().nullable(),
    acousticFrameCount: count,
    targetCoverage: ratio,
    blockers: z.array(z.string()),
  })
  .strict();

export const independentAcousticOutcomeSchema = z.enum([
  "INDEPENDENT_FAVORS_WHISPER",
  "INDEPENDENT_FAVORS_REAZON",
  "INDEPENDENT_NEAR_TIE",
  "INDEPENDENT_UNSCORABLE",
]);

export const machineIndependentAcousticDiscriminatorSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-independent-acoustic-discriminator"),
    corpusSemanticHash: sha256,
    pairedWhisperSemanticHash: sha256,
    verifierRuntimeSemanticHash: sha256,
    lowerIsBetter: z.literal(true),
    marginDefinition: z.literal(
      "whisperNllPerTargetToken-minus-reazonNllPerTargetToken",
    ),
    oldCorrelatedCtcRole: z.literal("AUDIT_ONLY"),
    events: z.array(
      z
        .object({
          eventId: z.string().min(1),
          audioSha256: sha256,
          whisper: projectedCandidateScoreSchema,
          reazon: projectedCandidateScoreSchema,
          pairwiseMargin: finite.nullable(),
          outcome: independentAcousticOutcomeSchema,
          scorability: z.enum(["SCORABLE", "UNSCORABLE"]),
          semanticHash: sha256,
        })
        .strict(),
    ),
    summary: z
      .object({
        eventCount: count,
        scorableCount: count,
        unscorableCount: count,
        scorableCoverage: ratio,
        favorsWhisperCount: count,
        favorsReazonCount: count,
        nearTieCount: count,
        runtimeGoldInputCount: z.literal(0),
        networkUsed: z.literal(false),
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

const featureValueSchema = finite.nullable();

export const machineCrossModelDiscriminatorFeaturesSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-cross-model-discriminator-features"),
    corpusSemanticHash: sha256,
    pairedWhisperSemanticHash: sha256,
    independentDiscriminatorSemanticHash: sha256,
    featureSchemaHash: sha256,
    featureNames: z.array(z.string().min(1)).min(1),
    featuresFrozenBeforeGold: z.literal(true),
    events: z.array(
      z
        .object({
          eventId: z.string().min(1),
          audioGroupId: z.string().min(1),
          featureValues: z.record(z.string().min(1), featureValueSchema),
          missingIndicators: z.record(z.string().min(1), z.boolean()),
          metadata: z
            .object({
              coreStart: finite.nonnegative(),
              coreEnd: finite.positive(),
              mutationSafetyEligible: z.boolean(),
              spanLineageStatus: z.string().min(1),
            })
            .strict(),
          semanticHash: sha256,
        })
        .strict(),
    ),
    audit: z
      .object({
        rawTextFeatureCount: z.literal(0),
        datasetSpecificFeatureCount: z.literal(0),
        eventIdSemanticFeatureCount: z.literal(0),
        goldFeatureCount: z.literal(0),
        fullDataImputationCount: z.literal(0),
        fullDataStandardizationCount: z.literal(0),
      })
      .strict(),
    runtimeGoldInputCount: z.literal(0),
    semanticHash: sha256,
  })
  .strict();

export const crossModelCalibrationLabelSchema = z.enum([
  "REAZON_BETTER",
  "WHISPER_BETTER",
  "EQUIVALENT",
  "UNEVALUABLE",
]);

export const goldCrossModelCalibrationLabelsSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("gold-cross-model-calibration-labels"),
    datasetRole: z.literal("CALIBRATION_DATASET"),
    featureFreezeSemanticHash: sha256,
    foldFreezeSemanticHash: sha256,
    goldIdentityHash: sha256,
    fullGoldTextIncluded: z.literal(false),
    events: z.array(
      z
        .object({
          eventId: z.string().min(1),
          label: crossModelCalibrationLabelSchema,
          whisperLocalError: count.nullable(),
          reazonLocalError: count.nullable(),
          localErrorDelta: z.number().int().nullable(),
          evaluationEvidenceIds: z.array(z.string().min(1)),
          semanticHash: sha256,
        })
        .strict(),
    ),
    summary: z
      .object({
        reazonBetterCount: count,
        whisperBetterCount: count,
        equivalentCount: count,
        unevaluableCount: count,
        availableOracleGain: count,
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

const foldAssignmentSchema = z
  .object({
    eventId: z.string().min(1),
    audioGroupId: z.string().min(1),
    fold: z.number().int().min(1).max(5),
    timeBlockStart: finite.nonnegative(),
    timeBlockEnd: finite.positive(),
    semanticHash: sha256,
  })
  .strict();

export const c60111CalibrationFoldsSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-11-calibration-folds"),
    corpusSemanticHash: sha256,
    groupingPolicy: z.literal("overlap-components-then-contiguous-time-blocks-v1"),
    foldCount: z.literal(5),
    constructedBeforeLabels: z.literal(true),
    randomSplitUsed: z.literal(false),
    assignments: z.array(foldAssignmentSchema),
    semanticHash: sha256,
  })
  .strict();

export const c60111DataQualityAuditSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-11-data-quality-audit"),
    corpusSemanticHash: sha256,
    featureSemanticHash: sha256,
    foldSemanticHash: sha256,
    duplicateEventCount: count,
    overlappingAudioAcrossTrainTestCount: count,
    rawTextFeatureCount: z.literal(0),
    datasetSpecificFeatureCount: z.literal(0),
    goldFeatureCount: z.literal(0),
    fullDataPreprocessingLeakCount: z.literal(0),
    foldConstructionLabelInputCount: z.literal(0),
    passed: z.boolean(),
    failures: z.array(z.string()),
    semanticHash: sha256,
  })
  .strict();

const selectiveMetricsSchema = z
  .object({
    selectedCount: count,
    correctCount: count,
    wrongCount: count,
    neutralCount: count,
    precision: ratio.nullable(),
    harmRate: ratio,
    selectiveCoverage: ratio,
    realizedGain: z.number().int(),
    availableOracleGain: count,
    oracleCaptureRate: finite.nullable(),
  })
  .strict();

const foldResultSchema = z
  .object({
    fold: z.number().int().min(1).max(5),
    trainCount: count,
    testCount: count,
    threshold: finite,
    metrics: selectiveMetricsSchema,
    semanticHash: sha256,
  })
  .strict();

export const c60111CvResultsSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-11-cv-results"),
    modelId: z.enum(["M0", "M1", "M2", "M3", "M4", "M5"]),
    modelType: z.literal("L2_LOGISTIC_REGRESSION"),
    featureSet: z.array(z.string().min(1)),
    nestedThresholdCalibration: z.literal(true),
    outerTestLabelsUsedForThreshold: z.literal(false),
    foldResults: z.array(foldResultSchema).length(5),
    aggregate: selectiveMetricsSchema.extend({
      precisionWilsonLower: ratio.nullable(),
      precisionWilsonUpper: ratio.nullable(),
      negativeGainFoldCount: count,
      zeroHarmFoldCount: count,
    }),
    coefficients: z.record(z.string().min(1), finite),
    semanticHash: sha256,
  })
  .strict();

export const c60111OutOfFoldPredictionsSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-11-out-of-fold-predictions"),
    modelId: z.enum(["M0", "M1", "M2", "M3", "M4", "M5"]),
    cvSemanticHash: sha256,
    predictions: z.array(
      z
        .object({
          eventId: z.string().min(1),
          fold: z.number().int().min(1).max(5),
          score: ratio,
          threshold: finite,
          decision: z.enum(["SELECT_REAZON", "ABSTAIN"]),
          label: crossModelCalibrationLabelSchema,
          localGain: z.number().int().nullable(),
          semanticHash: sha256,
        })
        .strict(),
    ),
    inSamplePredictionCount: z.literal(0),
    semanticHash: sha256,
  })
  .strict();

export const c60111FeatureAblationReportSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-11-feature-ablation-report"),
    variants: z.array(
      z
        .object({
          modelId: z.enum(["M0", "M1", "M2", "M3", "M4", "M5"]),
          description: z.string().min(1),
          featureSet: z.array(z.string().min(1)),
          metrics: selectiveMetricsSchema,
          negativeGainFoldCount: count,
          zeroHarmFoldCount: count,
          semanticHash: sha256,
        })
        .strict(),
    ).length(6),
    bestModelId: z.enum(["M0", "M1", "M2", "M3", "M4", "M5"]),
    selectionPerformedWithoutOuterTestRetuning: z.literal(true),
    semanticHash: sha256,
  })
  .strict();

export const c60111SelectiveDiscriminatorFreezeSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-11-selective-discriminator-freeze"),
    created: z.boolean(),
    modelType: z.literal("L2_LOGISTIC_REGRESSION").nullable(),
    modelId: z.enum(["M0", "M1", "M2", "M3", "M4", "M5"]).nullable(),
    featureSchemaHash: sha256,
    coefficients: z.record(z.string().min(1), finite),
    intercept: finite.nullable(),
    threshold: finite.nullable(),
    preprocessing: z
      .object({
        medians: z.record(z.string().min(1), finite),
        means: z.record(z.string().min(1), finite),
        scales: z.record(z.string().min(1), finite.positive()),
      })
      .strict(),
    productionEnforcementEnabled: z.literal(false),
    trainedOnEpisode1CalibrationOnly: z.literal(true),
    semanticHash: sha256,
  })
  .strict();

export const c60111RouteDecisionSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-11-route-decision"),
    decision: z.enum([
      "GO_C6_0_1_12_PROSPECTIVE_DISCRIMINATOR_ARBITRATION",
      "SELECTIVE_CALIBRATION_PROMISING_BUT_NOT_PROVEN",
      "HOLD_FOR_INDEPENDENT_VERIFIER_REDESIGN",
      "INDEPENDENT_VERIFIER_NOT_USEFUL",
      "AUTOMATIC_PROVIDER_SELECTION_NOT_SUPPORTED",
    ]),
    automaticProviderSelectionSupported: z.boolean(),
    strongCalibrationPass: z.boolean(),
    promisingCalibration: z.boolean(),
    stopAutomaticProviderSwitchExpansion: z.boolean(),
    nextStage: z.enum([
      "PROSPECTIVE_FROZEN_OBSERVE_ONLY",
      "ADD_INDEPENDENT_EPISODE_CALIBRATION_DATA",
      "REDESIGN_INDEPENDENT_VERIFIER",
      "MULTI_ASR_REVIEW_ASSISTANCE",
    ]),
    reasons: z.array(z.string().min(1)).min(1),
    productionProfile: z.literal("DISABLED"),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    machineOnlyReleaseAuthorized: z.literal(false),
    c602Status: z.literal("HOLD"),
    semanticHash: sha256,
  })
  .strict();

export const c60111ValidationSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-11-validation"),
    baselineReplayPassed: z.boolean(),
    artifactSchemasPassed: z.boolean(),
    dataQualityPassed: z.boolean(),
    finalParityPassed: z.boolean(),
    sourceReadOnly: z.boolean(),
    goldReadOnly: z.boolean(),
    canonicalTextMutationCount: z.literal(0),
    canonicalTimingMutationCount: z.literal(0),
    finalAssParity: z.boolean(),
    finalSrtParity: z.boolean(),
    finalVttParity: z.boolean(),
    runtimeGoldInputCount: z.literal(0),
    datasetHardcodingCount: z.literal(0),
    inferenceNetworkUsed: z.literal(false),
    checks: z.record(z.string().min(1), z.boolean()),
    passed: z.boolean(),
    semanticHash: sha256,
  })
  .strict();

export type MachineCrossModelCalibrationCorpus = z.infer<
  typeof machineCrossModelCalibrationCorpusSchema
>;
export type MachinePairedWhisperEvidence = z.infer<
  typeof machinePairedWhisperEvidenceSchema
>;
export type MachineIndependentVerifierRuntime = z.infer<
  typeof machineIndependentVerifierRuntimeSchema
>;
export type MachineIndependentAcousticDiscriminator = z.infer<
  typeof machineIndependentAcousticDiscriminatorSchema
>;
export type MachineCrossModelDiscriminatorFeatures = z.infer<
  typeof machineCrossModelDiscriminatorFeaturesSchema
>;
export type GoldCrossModelCalibrationLabels = z.infer<
  typeof goldCrossModelCalibrationLabelsSchema
>;
export type C60111CalibrationFolds = z.infer<
  typeof c60111CalibrationFoldsSchema
>;
export type C60111DataQualityAudit = z.infer<
  typeof c60111DataQualityAuditSchema
>;
export type C60111CvResults = z.infer<typeof c60111CvResultsSchema>;
export type C60111OutOfFoldPredictions = z.infer<
  typeof c60111OutOfFoldPredictionsSchema
>;
export type C60111FeatureAblationReport = z.infer<
  typeof c60111FeatureAblationReportSchema
>;
export type C60111SelectiveDiscriminatorFreeze = z.infer<
  typeof c60111SelectiveDiscriminatorFreezeSchema
>;
export type C60111RouteDecision = z.infer<typeof c60111RouteDecisionSchema>;
export type C60111Validation = z.infer<typeof c60111ValidationSchema>;

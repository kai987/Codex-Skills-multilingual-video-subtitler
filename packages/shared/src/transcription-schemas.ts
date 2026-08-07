import { z } from "zod";

import { languageTagSchema } from "./language.js";

const transcriptionSchemaVersionSchema = z.literal("1.0.0");

export const transcriptionIntervalSchema = z
  .object({
    start: z.number().nonnegative(),
    end: z.number().positive(),
  })
  .strict()
  .refine((interval) => interval.end > interval.start, {
    message: "Interval end must be greater than start.",
  });

export const coreMLProbeStatusSchema = z.enum([
  "unsupported-platform",
  "not-compiled",
  "encoder-missing",
  "encoder-mismatch",
  "load-failed",
  "available",
  "disabled-by-user",
]);

export type CoreMLProbeStatus = z.infer<typeof coreMLProbeStatusSchema>;

export const coreMLCapabilityStateSchema = z
  .object({
    supported: z.boolean(),
    status: coreMLProbeStatusSchema,
    deviceCapable: z.boolean(),
    whisperCppCompiledWithCoreML: z.boolean(),
    encoderAvailable: z.boolean(),
    encoderPath: z.string().min(1).nullable(),
    encoderFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .nullable()
      .optional(),
    runtimeValidated: z.boolean(),
    reason: z.string().min(1).nullable(),
  })
  .strict();

export type CoreMLCapabilityState = z.infer<typeof coreMLCapabilityStateSchema>;

export const whisperModelCapabilitySchema = z
  .object({
    id: z.string().min(1),
    modelPath: z.string().min(1),
    modelHash: z.string().regex(/^[a-f0-9]{64}$/u),
    modelFamily: z.string().min(1),
    runtime: z.enum(["cpu", "coreml"]),
    qualityTier: z.enum(["maximum", "high", "balanced", "fast"]),
    quantization: z.string().min(1).nullable(),
    coreML: coreMLCapabilityStateSchema,
    estimatedMemoryBytes: z.number().int().positive().nullable(),
    roles: z.array(z.enum(["baseline", "refinement", "fallback"])).min(1),
  })
  .strict();

export type WhisperModelCapability = z.infer<
  typeof whisperModelCapabilitySchema
>;

export const deviceProfileSchema = z
  .object({
    schemaVersion: transcriptionSchemaVersionSchema,
    platform: z.string().min(1),
    architecture: z.string().min(1),
    appleSilicon: z.boolean(),
    memory: z
      .object({
        totalGiB: z.number().nonnegative(),
        availableGiB: z.number().nonnegative().nullable(),
      })
      .strict(),
    cpu: z
      .object({
        physicalCores: z.number().int().positive().nullable(),
        logicalCores: z.number().int().positive(),
        model: z.string().min(1),
      })
      .strict(),
    ffmpeg: z
      .object({
        available: z.boolean(),
        version: z.string().min(1).nullable(),
      })
      .strict(),
    ffprobe: z
      .object({
        available: z.boolean(),
        version: z.string().min(1).nullable(),
      })
      .strict(),
    whisperCpp: z
      .object({
        available: z.boolean(),
        executablePath: z.string().min(1).nullable(),
        version: z.string().min(1).nullable(),
        metalAvailable: z.boolean(),
        coreMLCompiled: z.boolean(),
        tokenTimestampsAvailable: z.boolean().optional(),
        fullJsonAvailable: z.boolean().optional(),
      })
      .strict(),
    coreMLEncoders: z.array(
      z
        .object({
          path: z.string().min(1),
          modelFamily: z.string().min(1),
          fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
        })
        .strict(),
    ),
    models: z.array(whisperModelCapabilitySchema),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();

export type DeviceProfile = z.infer<typeof deviceProfileSchema>;

export const mediaProfileSchema = z
  .object({
    schemaVersion: transcriptionSchemaVersionSchema,
    durationSeconds: z.number().nonnegative(),
    dialogueLanguages: z.array(languageTagSchema),
    audioTrack: z
      .object({
        index: z.number().int().nonnegative(),
        sampleRate: z.number().int().positive().nullable(),
        channels: z.number().int().positive().nullable(),
      })
      .strict(),
    speechDurationSeconds: z.number().nonnegative(),
    speechRatio: z.number().min(0).max(1),
    effectiveSpeechDurationSeconds: z.number().nonnegative(),
    musicHeavy: z.boolean(),
    longSilenceRatio: z.number().min(0).max(1),
    availableEmbeddedSubtitle: z.boolean(),
    availableReferenceSubtitle: z.boolean(),
    availablePrimarySubtitle: z.boolean(),
    speechIntervals: z.array(transcriptionIntervalSchema),
    profilingMethod: z.enum([
      "ffmpeg-silencedetect",
      "vad",
      "duration-fallback",
    ]),
  })
  .strict();

export type MediaProfile = z.infer<typeof mediaProfileSchema>;

export const acousticSceneLabelSchema = z.enum([
  "clean-dialogue",
  "quiet-dialogue",
  "noisy-dialogue",
  "singing",
  "non-speech",
  "unknown",
]);

export type AcousticSceneLabel = z.infer<typeof acousticSceneLabelSchema>;

export const sceneAnalysisModeSchema = z.enum(["off", "observe", "route"]);
export const sceneRoutingModeSchema = z.enum([
  "conservative",
  "balanced",
  "aggressive",
]);
export const asrRoutingStrategySchema = z.enum([
  "vad-only",
  "extra-sensitive-vad",
  "vad-plus-no-vad",
  "lyrics-no-vad",
  "observe-only",
  "skip-dialogue-asr",
  "conservative-default",
]);

export const acousticSceneProbabilitiesSchema = z
  .object({
    speech: z.number().min(0).max(1),
    vocal: z.number().min(0).max(1),
    music: z.number().min(0).max(1),
    drums: z.number().min(0).max(1),
    crowd: z.number().min(0).max(1),
    overlap: z.number().min(0).max(1),
    silence: z.number().min(0).max(1),
  })
  .strict();

const acousticSceneFeaturesSchema = z
  .object({
    rmsDb: z.number().nullable(),
    snrDb: z.number().nullable(),
    spectralFlatness: z.number().min(0).max(1).nullable(),
    spectralFlux: z.number().min(0).max(1).nullable(),
    zeroCrossingRate: z.number().min(0).max(1).nullable(),
    speechActivityRatio: z.number().min(0).max(1),
    silenceRatio: z.number().min(0).max(1),
  })
  .strict();

export const acousticSceneAnalysisConfigSchema = z
  .object({
    sceneWindowSeconds: z.number().positive(),
    sceneHopSeconds: z.number().positive(),
    sceneMinimumDurationSeconds: z.number().positive(),
    sceneConfidenceThreshold: z.number().min(0).max(1),
    nonSpeechSkipConfidence: z.number().min(0).max(1),
  })
  .strict();

const asrRoutingDecisionSchema = z
  .object({
    strategy: asrRoutingStrategySchema,
    useVad: z.boolean(),
    useExtraSensitiveVad: z.boolean(),
    useNoVad: z.boolean(),
    useLyricsMode: z.boolean(),
    requireIndependentConsensus: z.boolean(),
    requireLargeV3RefinementOnConflict: z.boolean(),
    requireHumanReviewOnUnresolved: z.boolean(),
    reasons: z.array(z.string().min(1)).min(1),
  })
  .strict();

const acousticSceneWindowSchema = z
  .object({
    id: z.string().min(1),
    interval: transcriptionIntervalSchema,
    probabilities: acousticSceneProbabilitiesSchema,
    features: acousticSceneFeaturesSchema,
    proposedLabel: acousticSceneLabelSchema,
    smoothedLabel: acousticSceneLabelSchema,
    confidence: z.number().min(0).max(1),
    evidence: z.array(z.string().min(1)).min(1),
  })
  .strict();

const acousticSceneSegmentSchema = z
  .object({
    id: z.string().min(1),
    interval: transcriptionIntervalSchema,
    label: acousticSceneLabelSchema,
    confidence: z.number().min(0).max(1),
    probabilities: acousticSceneProbabilitiesSchema,
    sourceWindowIds: z.array(z.string().min(1)).min(1),
    evidence: z.array(z.string().min(1)).min(1),
    boundarySource: z.enum([
      "window-hop",
      "hysteresis",
      "minimum-duration-absorption",
    ]),
    routingDecision: asrRoutingDecisionSchema,
  })
  .strict();

export const acousticSceneWindowsArtifactSchema = z
  .object({
    schemaVersion: transcriptionSchemaVersionSchema,
    status: z.enum(["completed", "failed"]),
    generatedAt: z.iso.datetime(),
    analysisVersion: z.string().min(1),
    classifier: z
      .object({
        id: z.string().min(1),
        version: z.string().min(1),
        kind: z.enum(["heuristic", "local-model"]),
      })
      .strict(),
    config: acousticSceneAnalysisConfigSchema,
    sourceAudio: z
      .object({
        sha256: z.string().regex(/^[a-f0-9]{64}$/u),
        sampleRate: z.number().int().positive(),
        channels: z.literal(1),
        durationSeconds: z.number().nonnegative(),
      })
      .strict()
      .nullable(),
    cache: z
      .object({
        key: z
          .string()
          .regex(/^[a-f0-9]{64}$/u)
          .nullable(),
        hit: z.boolean(),
      })
      .strict(),
    failure: z.string().min(1).nullable(),
    windows: z.array(acousticSceneWindowSchema),
  })
  .strict();

export type AcousticSceneWindowsArtifact = z.infer<
  typeof acousticSceneWindowsArtifactSchema
>;

export const acousticScenesArtifactSchema = z
  .object({
    schemaVersion: transcriptionSchemaVersionSchema,
    status: z.enum(["completed", "failed"]),
    generatedAt: z.iso.datetime(),
    analysisVersion: z.string().min(1),
    config: acousticSceneAnalysisConfigSchema,
    failure: z.string().min(1).nullable(),
    scenes: z.array(acousticSceneSegmentSchema),
  })
  .strict();

export type AcousticScenesArtifact = z.infer<
  typeof acousticScenesArtifactSchema
>;

export const asrRoutingPlanArtifactSchema = z
  .object({
    schemaVersion: transcriptionSchemaVersionSchema,
    status: z.enum(["completed", "failed"]),
    generatedAt: z.iso.datetime(),
    sceneAnalysisMode: sceneAnalysisModeSchema,
    sceneRoutingMode: sceneRoutingModeSchema,
    additiveOnly: z.literal(true),
    selectiveSkipEnabled: z.literal(false),
    analysisVersion: z.string().min(1),
    failure: z.string().min(1).nullable(),
    entries: z.array(
      z
        .object({
          sceneId: z.string().min(1),
          interval: transcriptionIntervalSchema,
          label: acousticSceneLabelSchema,
          confidence: z.number().min(0).max(1),
          probabilities: acousticSceneProbabilitiesSchema,
          recommendedStrategy: asrRoutingStrategySchema,
          actualStrategy: z.union([
            asrRoutingStrategySchema,
            z.literal("legacy-baseline"),
          ]),
          observeOnly: z.boolean(),
          decision: asrRoutingDecisionSchema,
          execution: z
            .object({
              vadBaseline: z.boolean(),
              extraSensitiveVad: z.boolean(),
              noVad: z.boolean(),
              lyricsMode: z.boolean(),
              cacheHits: z.number().int().nonnegative(),
              asrRequestIds: z.array(z.string().min(1)),
            })
            .strict(),
          reasons: z.array(z.string().min(1)).min(1),
        })
        .strict(),
    ),
    summary: z
      .object({
        sceneCount: z.number().int().nonnegative(),
        proactiveNoVadScenes: z.number().int().nonnegative(),
        proactiveExtraSensitiveVadScenes: z.number().int().nonnegative(),
        proactiveLyricsScenes: z.number().int().nonnegative(),
        noVadRequests: z.number().int().nonnegative(),
        extraSensitiveVadRequests: z.number().int().nonnegative(),
        lyricsRequests: z.number().int().nonnegative(),
        cacheHits: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export type AsrRoutingPlanArtifact = z.infer<
  typeof asrRoutingPlanArtifactSchema
>;

const whisperBenchmarkEntrySchema = z
  .object({
    capabilityId: z.string().min(1),
    modelHash: z.string().regex(/^[a-f0-9]{64}$/u),
    whisperCppVersion: z.string().min(1),
    coreML: z.boolean(),
    encoderPath: z.string().min(1).nullable().optional(),
    encoderFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .nullable()
      .optional(),
    audioSeconds: z.number().positive(),
    processingSeconds: z.number().nonnegative(),
    rtf: z.number().nonnegative(),
  })
  .strict();

export const whisperBenchmarkSchema = z
  .object({
    schemaVersion: transcriptionSchemaVersionSchema,
    status: z.enum(["executed", "reused", "skipped"]),
    skipReason: z.string().min(1).nullable(),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    deviceFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    sampleAudioSeconds: z.number().positive(),
    entries: z.array(whisperBenchmarkEntrySchema),
    errors: z.array(
      z
        .object({
          capabilityId: z.string().min(1),
          modelHash: z.string().regex(/^[a-f0-9]{64}$/u),
          whisperCppVersion: z.string().min(1),
          coreML: z.boolean(),
          encoderPath: z.string().min(1).nullable().optional(),
          encoderFingerprint: z
            .string()
            .regex(/^[a-f0-9]{64}$/u)
            .nullable()
            .optional(),
          message: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict();

export type WhisperBenchmark = z.infer<typeof whisperBenchmarkSchema>;

const transcriptionPlanPassSchema = z
  .object({
    capabilityId: z.string().min(1),
    modelFamily: z.string().min(1),
    model: z.string().min(1),
    coreML: z.boolean(),
    coreMLCapability: coreMLCapabilityStateSchema.optional(),
    role: z.enum(["baseline", "refinement", "fallback"]),
  })
  .strict();

export const transcriptionPlanSchema = z
  .object({
    schemaVersion: transcriptionSchemaVersionSchema,
    requestedStrategy: z.enum(["auto", "quality", "fast", "adaptive"]),
    strategy: z.enum(["quality", "fast", "adaptive"]),
    reason: z.array(z.string().min(1)).min(1),
    baseline: transcriptionPlanPassSchema,
    refinement: transcriptionPlanPassSchema
      .safeExtend({
        fallbackCoreML: z.boolean(),
        maxRounds: z.number().int().min(0).max(10),
        contextSeconds: z.number().nonnegative(),
        mergeGapSeconds: z.number().nonnegative(),
        maxMergedRefinementSeconds: z.number().positive().max(45).optional(),
        noVadTieBreakBonus: z.number().min(0).max(0.05).optional(),
      })
      .nullable(),
    estimatedRuntime: z
      .object({
        baselineSeconds: z.number().nonnegative().nullable(),
        fullQualitySeconds: z.number().nonnegative().nullable(),
      })
      .strict(),
    maxFullQualityRuntimeSeconds: z.number().positive(),
    fullSecondPass: z.boolean(),
    fallbacks: z.array(
      z
        .object({
          from: z.string().min(1),
          to: z.string().min(1),
          reason: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict();

export type TranscriptionPlan = z.infer<typeof transcriptionPlanSchema>;

export const transcriptionClassificationSchema = z.enum([
  "normal",
  "ambiguous-speech",
  "suspected-hallucination",
  "probable-non-speech",
  "overlapping-speech",
]);

export type TranscriptionClassification = z.infer<
  typeof transcriptionClassificationSchema
>;

export const hypothesisValiditySchema = z.enum([
  "valid",
  "weak",
  "invalid-hallucination",
  "invalid-empty",
  "invalid-timing",
  "invalid-language",
]);

export type HypothesisValidity = z.infer<typeof hypothesisValiditySchema>;

export const hypothesisQualitySignalSchema = z.enum([
  "EXACT_SENTENCE_LOOP",
  "EXTREME_REPETITION_RATIO",
  "LONG_PHRASE_LOOP",
  "CONSECUTIVE_DUPLICATE_SEGMENTS",
  "PROMPT_ECHO_LOOP",
  "LOW_UNIQUE_CONTENT_RATIO",
  "EMPTY_TEXT",
  "INVALID_INTERVAL",
  "OVERMERGED_TIMING",
  "LANGUAGE_MISMATCH",
  "LOW_DECODER_CONFIDENCE",
]);

export type HypothesisQualitySignal = z.infer<
  typeof hypothesisQualitySignalSchema
>;

export const hypothesisQualitySchema = z
  .object({
    validity: hypothesisValiditySchema,
    qualityScore: z.number().int().min(0).max(100),
    hardReject: z.boolean(),
    repetitionHallucination: z.boolean(),
    signals: z.array(hypothesisQualitySignalSchema),
    metrics: z
      .object({
        normalizedCharacters: z.number().int().nonnegative(),
        sentenceCount: z.number().int().nonnegative(),
        uniqueSentenceRatio: z.number().min(0).max(1),
        repeatedTextRatio: z.number().min(0).max(1),
        exactSentenceMaxRun: z.number().int().nonnegative(),
        longestRepeatedPhraseCharacters: z.number().int().nonnegative(),
        consecutiveDuplicateSegments: z.number().int().nonnegative(),
        promptEchoCount: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export type HypothesisQuality = z.infer<typeof hypothesisQualitySchema>;

export const vadNoVadHypothesisSchema = z
  .object({
    text: z.string(),
    model: z.string().min(1),
    detectedSpeech: z.boolean(),
    language: languageTagSchema.nullable(),
    quality: hypothesisQualitySchema.optional(),
    segments: z
      .array(
        z
          .object({
            start: z.number().nonnegative(),
            end: z.number().positive(),
            text: z.string(),
            confidence: z.number().min(0).max(1).nullable(),
            language: languageTagSchema,
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

export const vadNoVadComparisonSchema = z
  .object({
    interval: transcriptionIntervalSchema,
    vad: vadNoVadHypothesisSchema,
    noVad: vadNoVadHypothesisSchema,
    metrics: z
      .object({
        normalizedSimilarity: z.number().min(0).max(1),
        characterEditDistance: z.number().int().nonnegative(),
        timingOverlap: z.number().min(0).max(1).nullable(),
        startDifferenceSeconds: z.number().nonnegative().nullable().optional(),
        endDifferenceSeconds: z.number().nonnegative().nullable().optional(),
        durationDifferenceSeconds: z
          .number()
          .nonnegative()
          .nullable()
          .optional(),
        segmentCountDifference: z.number().int().nonnegative().optional(),
        speechBoundaryDifferenceSeconds: z
          .number()
          .nonnegative()
          .nullable()
          .optional(),
        boundaryDisagreement: z.boolean().optional(),
        vadBoundary: transcriptionIntervalSchema.nullable().optional(),
        noVadBoundary: transcriptionIntervalSchema.nullable().optional(),
        lengthRatio: z.number().min(0).max(1),
        languageConflict: z.boolean(),
        oneSideEmpty: z.boolean(),
        repetitionConflict: z.boolean(),
      })
      .strict(),
    vadNoVadConflict: z.boolean(),
    validCandidateConflict: z.boolean().optional(),
    conflictCodes: z
      .array(
        z.enum([
          "VAD_NO_VAD_VALID_CONFLICT",
          "VAD_NO_VAD_BOUNDARY_DISAGREEMENT",
          "NO_VAD_HALLUCINATION",
          "VAD_HALLUCINATION",
          "VAD_INVALID",
          "NO_VAD_INVALID",
        ]),
      )
      .optional(),
    highBackgroundNoise: z.boolean(),
    speechEvidence: z.enum(["strong", "weak", "unknown"]),
    stableConsensus: z.boolean().default(false),
    largeV3Conflict: z.boolean().default(false),
    selectedHypothesis: z
      .enum(["vad", "no-vad", "refinement"])
      .nullable()
      .optional(),
    resolutionStatus: z.literal("accepted-after-refinement").optional(),
    classification:
      transcriptionClassificationSchema.default("ambiguous-speech"),
  })
  .strict();

export type VadNoVadComparison = z.infer<typeof vadNoVadComparisonSchema>;

const qualitySignalsSchema = z
  .object({
    confidence: z.enum(["ok", "low", "unavailable"]),
    lowTokenProbability: z.boolean().nullable(),
    averageLogProbabilityLow: z.boolean().nullable(),
    noSpeechConflict: z.boolean(),
    decoderFallback: z.boolean().nullable(),
    highEntropy: z.boolean().nullable(),
    repeatedPhrase: z.boolean(),
    repeatedCharacters: z.boolean(),
    hallucinationPattern: z.boolean(),
    vadSpeechButEmpty: z.boolean(),
    speechTextMismatch: z.boolean(),
    charactersPerSecond: z.number().nonnegative().nullable(),
    charactersPerSecondStatus: z.enum(["low", "ok", "high", "unknown"]),
    languageConflict: z.boolean(),
    referenceConflict: z.boolean().nullable(),
    timestampAnomaly: z.boolean(),
    timestampAnomalyScore: z.number().int().min(0).max(100).optional(),
    timestampAnomalyBand: z
      .enum(["pass", "suspicious", "auto-refine", "mandatory-refine"])
      .optional(),
    timestampAnomalyReasons: z.array(z.string().min(1)).optional(),
    overlapAnomaly: z.boolean(),
    continuityConcern: z.boolean(),
    vadNoVadConflict: z.boolean().default(false),
    largeV3Conflict: z.boolean().default(false),
    highBackgroundNoise: z.boolean().default(false),
    stableConsensus: z.boolean().default(false),
  })
  .strict();

const transcriptionQualitySegmentSchema = z
  .object({
    id: z.string().min(1),
    cueId: z.string().min(1).nullable(),
    interval: transcriptionIntervalSchema,
    text: z.string(),
    status: z.enum([
      "accepted",
      "accepted-after-refinement",
      "needs-refinement",
      "needs-human-review",
    ]),
    classification: transcriptionClassificationSchema.default("normal"),
    signals: qualitySignalsSchema,
    timing: z
      .object({
        durationSeconds: z.number().positive(),
        visibleCharacters: z.number().int().nonnegative(),
        charactersPerSecond: z.number().nonnegative().nullable(),
        speechStart: z.number().nonnegative().nullable(),
        speechEnd: z.number().positive().nullable(),
        leadingSilenceSeconds: z.number().nonnegative().nullable(),
        trailingSilenceSeconds: z.number().nonnegative().nullable(),
        speechDurationSeconds: z.number().nonnegative(),
        speechRatio: z.number().min(0).max(1),
        maxInternalSilenceSeconds: z.number().nonnegative(),
        vadNoVadStartDifferenceSeconds: z.number().nonnegative().nullable(),
        vadNoVadEndDifferenceSeconds: z.number().nonnegative().nullable(),
        vadNoVadDurationDifferenceSeconds: z.number().nonnegative().nullable(),
        vadBoundary: transcriptionIntervalSchema.nullable(),
        noVadBoundary: transcriptionIntervalSchema.nullable(),
        vadNoVadTextSimilarity: z.number().min(0).max(1).nullable(),
        tokenTimestampsAvailable: z.boolean(),
        tokenTimestampsUsed: z.boolean(),
        alignmentSource: z.string().min(1),
        repairAttempted: z.boolean().default(false),
        repairMethod: z.string().min(1).nullable().default(null),
        requiresHumanReview: z.boolean().default(false),
      })
      .strict()
      .optional(),
    reasons: z.array(z.string().min(1)),
    refinementRounds: z.number().int().nonnegative(),
  })
  .strict();

export const transcriptionQualitySchema = z
  .object({
    schemaVersion: transcriptionSchemaVersionSchema,
    evaluatorVersion: z.string().min(1),
    segments: z.array(transcriptionQualitySegmentSchema),
    summary: z
      .object({
        accepted: z.number().int().nonnegative(),
        needsRefinement: z.number().int().nonnegative(),
        needsHumanReview: z.number().int().nonnegative(),
        vadNoVadConflicts: z.number().int().nonnegative().default(0),
        resolvedByLargeV3: z.number().int().nonnegative().default(0),
        suspectedHallucinations: z.number().int().nonnegative().default(0),
        probableNonSpeech: z.number().int().nonnegative().default(0),
        autoResolvedVad: z.number().int().nonnegative().default(0).optional(),
        autoResolvedNoVad: z.number().int().nonnegative().default(0).optional(),
        autoResolvedLargeV3: z
          .number()
          .int()
          .nonnegative()
          .default(0)
          .optional(),
        rejectedVadHallucinations: z
          .number()
          .int()
          .nonnegative()
          .default(0)
          .optional(),
        rejectedNoVadHallucinations: z
          .number()
          .int()
          .nonnegative()
          .default(0)
          .optional(),
        trueUnresolvedConflicts: z
          .number()
          .int()
          .nonnegative()
          .default(0)
          .optional(),
      })
      .strict(),
    needsHumanReviewCount: z.number().int().nonnegative(),
    needsHumanReviewIntervals: z.array(
      transcriptionIntervalSchema.safeExtend({
        reasons: z.array(z.string().min(1)).min(1),
      }),
    ),
  })
  .strict();

export type TranscriptionQuality = z.infer<typeof transcriptionQualitySchema>;

export const canonicalAsrSourceAdapterSchema = z.enum([
  "whisper-cli",
  "whisper-server",
  "openai",
]);

const canonicalAsrTokenSchema = z
  .object({
    text: z.string(),
    start: z.number().nonnegative(),
    end: z.number().nonnegative(),
    probability: z.number().min(0).max(1).nullable().optional(),
  })
  .strict()
  .refine((token) => token.end >= token.start, {
    message: "Token end must be at or after start.",
  });

const canonicalAsrEvidenceBaseSchema = z
  .object({
    id: z.string().min(1),
    start: z.number().nonnegative(),
    end: z.number().positive(),
    text: z.string(),
    sourceAdapter: canonicalAsrSourceAdapterSchema,
    chunkId: z.string().min(1).optional(),
    speaker: z.string().min(1).nullable().optional(),
    language: languageTagSchema.optional(),
    confidence: z.number().min(0).max(1).nullable().optional(),
    averageLogProbability: z.number().nullable().optional(),
    noSpeechProbability: z.number().min(0).max(1).nullable().optional(),
    tokens: z.array(canonicalAsrTokenSchema).optional(),
  })
  .strict();

export const canonicalAsrUtteranceSchema = canonicalAsrEvidenceBaseSchema
  .omit({ speaker: true })
  .safeExtend({
    sourceSegmentIds: z.array(z.string().min(1)).min(1),
    speechIslandId: z.string().min(1).optional(),
    speaker: z.string().min(1).nullable().optional(),
    tokenTimestampsAvailable: z.boolean().optional(),
    canonicalization: z
      .object({
        operation: z.enum(["preserved", "merged", "split"]),
        reasons: z.array(z.string().min(1)).min(1),
      })
      .strict(),
    qualityStatus: z.enum(["accepted", "suspected-hallucination"]).optional(),
    qualityReasons: z.array(z.string().min(1)).optional(),
    repetitionEvidence: z
      .object({
        normalizedCorePhrase: z.string().min(1),
        occurrences: z.number().int().min(2),
        contributingSegmentIds: z.array(z.string().min(1)).min(1),
        suffixVariants: z.array(z.string()),
        repeatedCharacterRatio: z.number().min(0).max(1),
      })
      .strict()
      .optional(),
  })
  .refine((utterance) => utterance.end > utterance.start, {
    message: "Canonical utterance end must be after start.",
  });

export const canonicalAsrSegmentsArtifactSchema = z
  .object({
    schemaVersion: transcriptionSchemaVersionSchema,
    sourceAdapter: canonicalAsrSourceAdapterSchema,
    rawSegmentCount: z.number().int().nonnegative(),
    canonicalUtteranceCount: z.number().int().nonnegative(),
    rawSegments: z.array(
      canonicalAsrEvidenceBaseSchema.refine(
        (segment) => segment.end > segment.start,
        { message: "Raw segment end must be after start." },
      ),
    ),
    utterances: z.array(canonicalAsrUtteranceSchema),
  })
  .strict();

export type CanonicalAsrSegmentsArtifact = z.infer<
  typeof canonicalAsrSegmentsArtifactSchema
>;

export const vocalRegionTypeSchema = z.enum([
  "dialogue",
  "singing",
  "music-with-possible-vocals",
  "instrumental",
  "unknown",
]);

export const vocalRegionSchema = z
  .object({
    id: z.string().min(1),
    interval: transcriptionIntervalSchema,
    type: vocalRegionTypeSchema,
    vocalEvidence: z.boolean(),
    vocalEvidenceConfidence: z.number().min(0).max(1),
    reasons: z.array(z.string().min(1)).min(1),
    sourceRecoveryUnitIds: z.array(z.string().min(1)).optional(),
    sourceSceneIds: z.array(z.string().min(1)).optional(),
  })
  .strict();

const repetitionEvidenceSchema = z
  .object({
    normalizedCorePhrase: z.string().min(1),
    occurrences: z.number().int().min(2),
    contributingSegmentIds: z.array(z.string().min(1)).min(1),
    suffixVariants: z.array(z.string()),
    repeatedCharacterRatio: z.number().min(0).max(1),
  })
  .strict();

const finalSubtitleIntegrityMetricsSchema = z
  .object({
    singleCueDuplicateLineCount: z.number().int().nonnegative(),
    crossCueExactDuplicateCount: z.number().int().nonnegative(),
    crossCueSentenceLoopCount: z.number().int().nonnegative(),
    crossCueLongPhraseLoopCount: z.number().int().nonnegative(),
    missingLyricsRegionCount: z.number().int().nonnegative(),
    uncoveredVocalRegionCount: z.number().int().nonnegative(),
    invalidTimestampCount: z.number().int().nonnegative(),
    outOfOrderCount: z.number().int().nonnegative(),
    overlapCount: z.number().int().nonnegative(),
    unsupportedLongCueCount: z.number().int().nonnegative(),
    intraCueHypothesisRepetitionCount: z
      .number()
      .int()
      .nonnegative()
      .optional(),
    unnaturalJapaneseSpacingCount: z.number().int().nonnegative().optional(),
    lineExceedsCharacterLimitCount: z.number().int().nonnegative().optional(),
    cueExceedsTwoLinesCount: z.number().int().nonnegative().optional(),
    unresolvedPresentationCapacityCount: z
      .number()
      .int()
      .nonnegative()
      .optional(),
    uniqueNormalizedCueRatio: z.number().min(0).max(1),
  })
  .strict();

export const finalSubtitleIntegrityFindingSchema = z
  .object({
    id: z.string().min(1),
    code: z.enum([
      "PRESENTATION_DUPLICATE_LINE",
      "CROSS_CUE_EXACT_DUPLICATE",
      "CROSS_CUE_SENTENCE_LOOP",
      "CROSS_CUE_LONG_PHRASE_LOOP",
      "MISSING_LYRICS",
      "VOCAL_REGION_UNCOVERED",
      "INVALID_SUBTITLE_TIMESTAMP",
      "SUBTITLE_OUT_OF_ORDER",
      "SUBTITLE_OVERLAP",
      "UNSUPPORTED_LONG_CUE",
      "SCENE_VOCAL_REGION_UNCOVERED",
      "SCENE_DIALOGUE_REGION_UNCOVERED",
      "SCENE_SINGING_REGION_UNCOVERED",
      "SCENE_ROUTING_CONFLICT",
      "SCENE_HIGH_CONFIDENCE_MISROUTE",
      "FINAL_SINGLE_CHARACTER_FRAGMENT",
      "FINAL_EXTREME_SHORT_DURATION",
      "FINAL_INCOMPLETE_MORPHEME",
      "FINAL_INCOMPLETE_CLAUSE",
      "FINAL_TEXT_BOUNDARY_BREAK",
      "FINAL_COMPETING_HYPOTHESES",
      "FINAL_NEAR_DUPLICATE_SEMANTIC_CUE",
      "FINAL_UNSUPPORTED_CONTENT_WORD",
      "FINAL_INVALID_JAPANESE_FRAGMENT",
      "FINAL_LYRICS_HALLUCINATION",
      "FINAL_LYRICS_INCOMPLETE_LINE",
      "FINAL_REFERENCE_SEMANTIC_CONFLICT",
      "FINAL_VISUAL_LINE_WORD_BREAK",
      "FINAL_INTRA_CUE_HYPOTHESIS_REPETITION",
      "FINAL_UNNATURAL_JAPANESE_SPACING",
      "FINAL_LINE_EXCEEDS_CHARACTER_LIMIT",
      "FINAL_CUE_EXCEEDS_TWO_LINES",
      "FINAL_UNRESOLVED_PRESENTATION_CAPACITY",
      "SEGMENTATION_UNRESOLVED",
    ]),
    severity: z.enum(["hard", "warning"]),
    category: z.enum([
      "repetition",
      "coverage",
      "timing",
      "fragment",
      "text",
      "hypothesis",
      "lyrics",
      "segmentation",
      "semantic",
      "presentation",
    ]),
    interval: transcriptionIntervalSchema,
    cueIds: z.array(z.string().min(1)),
    sourceCueIds: z.array(z.string().min(1)).optional(),
    sourceRequestIds: z.array(z.string().min(1)).optional(),
    referenceAnchorIds: z.array(z.string().min(1)).optional(),
    vocalRegionIds: z.array(z.string().min(1)).optional(),
    sceneIds: z.array(z.string().min(1)).optional(),
    repetitionEvidence: repetitionEvidenceSchema.optional(),
    reasons: z.array(z.string().min(1)).min(1),
  })
  .strict();

export type FinalSubtitleIntegrityFinding = z.infer<
  typeof finalSubtitleIntegrityFindingSchema
>;

const vocalCoverageSchema = z
  .object({
    regionCount: z.number().int().nonnegative(),
    highConfidenceRegionCount: z.number().int().nonnegative(),
    totalVocalDurationSeconds: z.number().nonnegative(),
    subtitleCoveredVocalDurationSeconds: z.number().nonnegative(),
    explicitReviewVocalDurationSeconds: z.number().nonnegative(),
    uncoveredVocalDurationSeconds: z.number().nonnegative(),
    subtitleCoverageRatio: z.number().min(0).max(1),
  })
  .strict();

export const finalSubtitleIntegrityArtifactSchema = z
  .object({
    schemaVersion: transcriptionSchemaVersionSchema,
    generatedAt: z.iso.datetime(),
    validationStatus: z.enum(["passed", "needs-review"]),
    candidateCueCount: z.number().int().nonnegative(),
    finalCueCount: z.number().int().nonnegative(),
    quarantinedCueIds: z.array(z.string().min(1)),
    candidateMetrics: finalSubtitleIntegrityMetricsSchema,
    metrics: finalSubtitleIntegrityMetricsSchema,
    findings: z.array(finalSubtitleIntegrityFindingSchema),
    vocalRegions: z.array(
      vocalRegionSchema.safeExtend({
        finalCueIds: z.array(z.string().min(1)),
        coverageRatio: z.number().min(0).max(1),
        missingLyrics: z.boolean(),
      }),
    ),
    vocalCoverage: vocalCoverageSchema,
    gateFailures: z.array(z.string().min(1)),
  })
  .strict();

export type FinalSubtitleIntegrityArtifact = z.infer<
  typeof finalSubtitleIntegrityArtifactSchema
>;

export const portableAsrCacheIdentityV2Schema = z
  .object({
    schemaVersion: z.literal("2.0.0"),
    audioContentSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    extractedIntervalMilliseconds: z
      .object({
        start: z.number().int().nonnegative(),
        end: z.number().int().positive(),
      })
      .strict()
      .refine((interval) => interval.end > interval.start),
    extraction: z
      .object({
        sampleRate: z.number().int().positive(),
        channels: z.number().int().positive(),
        codec: z.string().min(1),
      })
      .strict(),
    adapterId: z.string().min(1),
    model: z.string().min(1),
    modelHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .nullable(),
    modelFamily: z.string().min(1).nullable(),
    coreML: z.boolean().nullable(),
    whisperCppVersion: z.string().min(1).nullable(),
    language: languageTagSchema.nullable(),
    vadMode: z.string().min(1),
    timestampStrategy: z.string().min(1),
    tokenTimestamps: z.boolean(),
    promptSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    decodeConfigurationSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();

export type PortableAsrCacheIdentityV2 = z.infer<
  typeof portableAsrCacheIdentityV2Schema
>;

export const portableTranscriptionChunkResultSchema = z
  .object({
    text: z.string(),
    segments: z.array(
      z
        .object({
          start: z.number().nonnegative(),
          end: z.number().positive(),
          text: z.string().min(1),
          speaker: z.string().min(1).nullable(),
          confidence: z.number().min(0).max(1).nullable(),
          tokens: z
            .array(
              z
                .object({
                  text: z.string(),
                  start: z.number().nonnegative(),
                  end: z.number().nonnegative(),
                  probability: z.number().min(0).max(1).nullable().optional(),
                })
                .strict(),
            )
            .optional(),
          metrics: z
            .object({
              averageLogProbability: z.number().nullable().optional(),
              noSpeechProbability: z
                .number()
                .min(0)
                .max(1)
                .nullable()
                .optional(),
              tokenProbability: z.number().min(0).max(1).nullable().optional(),
              entropy: z.number().nonnegative().nullable().optional(),
              decoderFallback: z.boolean().nullable().optional(),
              detectedLanguage: languageTagSchema.nullable().optional(),
            })
            .strict()
            .optional(),
        })
        .strict()
        .refine((segment) => segment.end > segment.start),
    ),
    raw: z.unknown(),
  })
  .strict();

export const asrCacheRequestTypeSchema = z.enum([
  "baseline",
  "refinement",
  "recovery",
  "lyrics",
  "coverage-recovery",
]);

export const portableAsrCacheEntryV2Schema = z
  .object({
    schemaVersion: z.literal("2.0.0"),
    createdAt: z.iso.datetime(),
    cacheKey: z.string().regex(/^[a-f0-9]{64}$/u),
    identity: portableAsrCacheIdentityV2Schema,
    result: portableTranscriptionChunkResultSchema,
    provenance: z
      .object({
        requestType: asrCacheRequestTypeSchema,
        sourceOutputDirectory: z.string().min(1).nullable(),
        migratedFromLegacyKey: z.string().min(1).nullable(),
        migratedFromPath: z.string().min(1).nullable(),
      })
      .strict(),
    resultSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();

export type PortableAsrCacheEntryV2 = z.infer<
  typeof portableAsrCacheEntryV2Schema
>;

export const asrCacheManifestArtifactSchema = z
  .object({
    schemaVersion: transcriptionSchemaVersionSchema,
    generatedAt: z.iso.datetime(),
    portableRoot: z.string().min(1).nullable(),
    mode: z.enum(["off", "read", "read-write"]),
    summary: z
      .object({
        requestCount: z.number().int().nonnegative(),
        portableHitCount: z.number().int().nonnegative(),
        taskLocalHitCount: z.number().int().nonnegative(),
        legacyHitCount: z.number().int().nonnegative(),
        migratedEntryCount: z.number().int().nonnegative(),
        missCount: z.number().int().nonnegative(),
        rejectedLegacyEntryCount: z.number().int().nonnegative(),
        corruptEntryCount: z.number().int().nonnegative(),
        writtenEntryCount: z.number().int().nonnegative(),
        workerRequestsAvoided: z.number().int().nonnegative(),
        workerStartsAvoided: z.number().int().nonnegative().optional(),
        modelLoadsAvoided: z.number().int().nonnegative(),
      })
      .strict(),
    entries: z.array(
      z
        .object({
          requestId: z.string().min(1),
          requestType: asrCacheRequestTypeSchema,
          currentKey: z.string().regex(/^[a-f0-9]{64}$/u),
          legacyKeysTried: z.array(z.string().min(1)),
          selectedPath: z.string().min(1).nullable(),
          hitType: z.enum([
            "portable",
            "task-local-v2",
            "legacy",
            "miss",
            "off",
          ]),
          compatibilityChecks: z.array(z.string().min(1)),
          migrationStatus: z.enum([
            "not-needed",
            "migrated",
            "rejected",
            "disabled",
          ]),
        })
        .strict(),
    ),
  })
  .strict();

export type AsrCacheManifestArtifact = z.infer<
  typeof asrCacheManifestArtifactSchema
>;

export const asrCacheMigrationArtifactSchema = z
  .object({
    schemaVersion: transcriptionSchemaVersionSchema,
    generatedAt: z.iso.datetime(),
    importedRoots: z.array(z.string().min(1)),
    entries: z.array(
      z
        .object({
          requestId: z.string().min(1),
          legacyKey: z.string().min(1),
          legacyPath: z.string().min(1),
          currentKey: z.string().regex(/^[a-f0-9]{64}$/u),
          status: z.enum(["migrated", "rejected", "corrupt", "not-found"]),
          checks: z.array(z.string().min(1)),
        })
        .strict(),
    ),
    summary: z
      .object({
        migratedEntryCount: z.number().int().nonnegative(),
        rejectedEntryCount: z.number().int().nonnegative(),
        corruptEntryCount: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export type AsrCacheMigrationArtifact = z.infer<
  typeof asrCacheMigrationArtifactSchema
>;

const lyricsCueEvidenceSchema = z
  .object({
    id: z.string().min(1),
    start: z.number().nonnegative(),
    end: z.number().positive(),
    text: z.string().min(1),
    language: languageTagSchema,
    style: z.literal("music").optional(),
  })
  .loose()
  .refine((cue) => cue.end > cue.start, {
    message: "Lyrics cue end must be after start.",
  });

export const lyricsTranscriptionArtifactSchema = z
  .object({
    schemaVersion: transcriptionSchemaVersionSchema,
    generatedAt: z.iso.datetime(),
    maximumWindowSeconds: z.number().positive().max(30),
    summary: z
      .object({
        detectedSongRegions: z.number().int().nonnegative(),
        lyricsAcceptedRegions: z.number().int().nonnegative(),
        missingLyricsRegions: z.number().int().nonnegative(),
        musicCueCount: z.number().int().nonnegative(),
        lyricsAsrRequests: z.number().int().nonnegative(),
        cacheHits: z.number().int().nonnegative(),
      })
      .strict(),
    regions: z.array(
      z
        .object({
          region: vocalRegionSchema,
          attempts: z.array(
            z
              .object({
                id: z.string().min(1),
                profile: z.enum([
                  "phrase-window-15",
                  "context-window-25",
                  "offset-window-20",
                ]),
                interval: transcriptionIntervalSchema,
                asrRequestId: z.string().min(1),
                model: z.string().min(1),
                coreML: z.boolean(),
                vadEnabled: z.literal(false),
                promptMode: z.literal("prompt-free"),
                cacheKey: z.string().min(1),
                cacheHit: z.boolean(),
                text: z.string(),
                canonicalCues: z.array(lyricsCueEvidenceSchema),
                quality: hypothesisQualitySchema,
              })
              .strict(),
          ),
          decision: z.enum(["lyrics-accepted", "missing-lyrics"]),
          acceptedMusicCues: z.array(lyricsCueEvidenceSchema),
          supportedCueIds: z.array(z.string().min(1)),
          independentSupportProfiles: z.array(
            z.enum([
              "phrase-window-15",
              "context-window-25",
              "offset-window-20",
            ]),
          ),
          reasons: z.array(z.string().min(1)).min(1),
        })
        .strict(),
    ),
  })
  .strict();

export type LyricsTranscriptionArtifact = z.infer<
  typeof lyricsTranscriptionArtifactSchema
>;

export const findingStatusSchema = z.enum([
  "open",
  "repaired",
  "resolved",
  "superseded",
  "informational",
  "needs-human-review",
]);

export const findingSourceStageSchema = z.enum([
  "baseline-qa",
  "canonical-qa",
  "no-vad-comparison",
  "refinement",
  "timing-repair",
  "presentation",
  "post-presentation-qa",
  "final-integrity-gate",
  "coverage-integrity",
  "scene-coverage-integrity",
  "hypothesis-resolution",
  "japanese-normalization",
]);

export const reviewCategorySchema = z.enum([
  "text",
  "timing",
  "presentation",
  "mixed",
]);

export type ReviewCategory = z.infer<typeof reviewCategorySchema>;

export const reviewEventCategorySchema = z.enum([
  "missing-dialogue",
  "missing-lyrics",
  "hallucination",
  "low-confidence-text",
  "timing",
  "mixed",
]);

export type ReviewEventCategory = z.infer<typeof reviewEventCategorySchema>;

export const reviewEventSchema = z
  .object({
    id: z.string().min(1),
    category: reviewEventCategorySchema,
    interval: transcriptionIntervalSchema,
    reviewGroupIds: z.array(z.string().min(1)).min(1),
    findingIds: z.array(z.string().min(1)).min(1),
    finalCueIds: z.array(z.string().min(1)),
    speechIslandIds: z.array(z.string().min(1)).optional(),
    refinementIds: z.array(z.string().min(1)).optional(),
    sceneIds: z.array(z.string().min(1)).optional(),
    subIntervals: z.array(transcriptionIntervalSchema).min(1),
    userAction: z.enum([
      "listen-and-transcribe",
      "listen-and-transcribe-lyrics",
      "verify-text",
      "verify-timing",
      "verify-text-and-timing",
    ]),
  })
  .strict();

export type ReviewEvent = z.infer<typeof reviewEventSchema>;

export const refinementNotRunReasonSchema = z.enum([
  "not-needed",
  "covered-by-neighbor",
  "covered-by-parent-refinement",
  "superseded",
  "duplicate-work",
  "timing-only-repair-sufficient",
  "budget-limit",
  "missing-acoustic-evidence",
  "missing-model-capability",
  "execution-failed",
]);

export const transcriptionFindingSchema = z
  .object({
    id: z.string().min(1),
    code: z.string().min(1),
    interval: transcriptionIntervalSchema,
    sourceStage: findingSourceStageSchema,
    status: findingStatusSchema,
    category: reviewCategorySchema,
    cueIds: z.array(z.string().min(1)).optional(),
    refinementIds: z.array(z.string().min(1)).optional(),
    sceneIds: z.array(z.string().min(1)).optional(),
    replacedByCueIds: z.array(z.string().min(1)).optional(),
    supersededByFindingIds: z.array(z.string().min(1)).optional(),
    selectedHypothesis: z
      .enum(["baseline", "refinement", "vad", "no-vad", "unknown"])
      .optional(),
    rejectedHypothesis: z
      .enum(["baseline", "refinement", "vad", "no-vad"])
      .optional(),
    refinementNotRunReason: refinementNotRunReasonSchema.optional(),
    coveredByRefinementId: z.string().min(1).optional(),
    resolvedBy: z
      .object({
        stage: z.string().min(1),
        operation: z.string().min(1),
        artifact: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    reasons: z.array(z.string().min(1)).optional(),
    missingDialogue: z.boolean().optional(),
    missingLyrics: z.boolean().optional(),
    integrityIssue: z.boolean().optional(),
    requiresAudioReview: z.boolean().optional(),
    vocalRegionIds: z.array(z.string().min(1)).optional(),
    acceptedCueReview: z
      .object({
        finalCueId: z.string().min(1),
        finalText: z.string().min(1),
        rawAsrText: z.string(),
        repairedText: z.string(),
        normalizedText: z.string(),
        winnerScore: z.number().min(0).max(1).nullable(),
        runnerUpCueId: z.string().min(1).nullable(),
        runnerUpScore: z.number().min(0).max(1).nullable(),
        scoreGap: z.number().min(0).max(1).nullable(),
        replacementCount: z.number().int().nonnegative(),
        timingDonorCueId: z.string().min(1).nullable(),
        deduplicationActions: z.array(z.string().min(1)),
        reviewReasons: z.array(z.string().min(1)),
      })
      .strict()
      .optional(),
  })
  .strict();

export type TranscriptionFinding = z.infer<typeof transcriptionFindingSchema>;

export const transcriptionTimingFindingsSchema = z
  .object({
    schemaVersion: transcriptionSchemaVersionSchema,
    generatedAt: z.iso.datetime(),
    allFindings: z.array(transcriptionFindingSchema),
    finalFindings: z.array(transcriptionFindingSchema),
    diagnostics: z
      .object({
        total: z.number().int().nonnegative(),
        repaired: z.number().int().nonnegative(),
        resolved: z.number().int().nonnegative(),
        superseded: z.number().int().nonnegative(),
        informational: z.number().int().nonnegative(),
        open: z.number().int().nonnegative(),
        needsHumanReview: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export type TranscriptionTimingFindings = z.infer<
  typeof transcriptionTimingFindingsSchema
>;

export const finalReviewQueueSchema = z
  .object({
    schemaVersion: transcriptionSchemaVersionSchema,
    generatedAt: z.iso.datetime(),
    reviewGroupGapSeconds: z.number().nonnegative(),
    diagnosticFindingCount: z.number().int().nonnegative(),
    openFindingCount: z.number().int().nonnegative(),
    humanReviewFindingCount: z.number().int().nonnegative(),
    uniqueReviewGroupCount: z.number().int().nonnegative(),
    acceptedButReviewRecommendedCount: z
      .number()
      .int()
      .nonnegative()
      .optional(),
    trueMissingDialogueGroupCount: z.number().int().nonnegative().optional(),
    reviewSummary: z
      .object({
        textFindings: z.number().int().nonnegative(),
        timingFindings: z.number().int().nonnegative(),
        presentationFindings: z.number().int().nonnegative(),
        mixedFindings: z.number().int().nonnegative(),
        textGroups: z.number().int().nonnegative(),
        timingGroups: z.number().int().nonnegative(),
        presentationGroups: z.number().int().nonnegative(),
        mixedGroups: z.number().int().nonnegative(),
        uniqueReviewGroups: z.number().int().nonnegative(),
      })
      .strict(),
    groups: z.array(
      z
        .object({
          id: z.string().min(1),
          category: reviewCategorySchema,
          interval: transcriptionIntervalSchema,
          finalCueIds: z.array(z.string().min(1)),
          findingIds: z.array(z.string().min(1)).min(1),
          reasons: z.array(z.string().min(1)).min(1),
          missingDialogue: z.boolean().optional(),
          missingLyrics: z.boolean().optional(),
          integrityIssue: z.boolean().optional(),
          needsAudioTranscription: z.boolean().optional(),
          speechIslandIds: z.array(z.string().min(1)).optional(),
          refinementIds: z.array(z.string().min(1)).optional(),
          sceneIds: z.array(z.string().min(1)).optional(),
          vocalRegionIds: z.array(z.string().min(1)).optional(),
          acceptedCueReviews: z
            .array(
              z
                .object({
                  finalCueId: z.string().min(1),
                  finalText: z.string().min(1),
                  rawAsrText: z.string(),
                  repairedText: z.string(),
                  normalizedText: z.string(),
                  winnerScore: z.number().min(0).max(1).nullable(),
                  runnerUpCueId: z.string().min(1).nullable(),
                  runnerUpScore: z.number().min(0).max(1).nullable(),
                  scoreGap: z.number().min(0).max(1).nullable(),
                  replacementCount: z.number().int().nonnegative(),
                  timingDonorCueId: z.string().min(1).nullable(),
                  deduplicationActions: z.array(z.string().min(1)),
                  reviewReasons: z.array(z.string().min(1)),
                })
                .strict(),
            )
            .optional(),
          evidence: z
            .object({
              textIntegrityRepair: z.array(z.string().min(1)).optional(),
              subtitleIntegrityRepair: z.array(z.string().min(1)).optional(),
              coverageRecovery: z.array(z.string().min(1)).optional(),
              targetedAsrAttempts: z.array(z.string().min(1)).optional(),
              referenceClassification: z.array(z.string().min(1)).optional(),
              normalizationCandidates: z.array(z.string().min(1)).optional(),
              cacheHitType: z
                .array(
                  z.enum([
                    "portable",
                    "task-local-v2",
                    "legacy",
                    "miss",
                    "off",
                  ]),
                )
                .optional(),
            })
            .strict()
            .optional(),
        })
        .strict(),
    ),
    reviewEventCount: z.number().int().nonnegative().optional(),
    reviewAudioDurationSeconds: z.number().nonnegative().optional(),
    maximumReviewEventSpanSeconds: z.number().nonnegative().optional(),
    maximumPlayableSubIntervalSeconds: z
      .number()
      .nonnegative()
      .max(30)
      .optional(),
    events: z.array(reviewEventSchema).optional(),
  })
  .strict();

export type FinalReviewQueue = z.infer<typeof finalReviewQueueSchema>;

export const missingDialogueRecoveryProfileSchema = z.enum([
  "current-sensitive-vad",
  "extra-sensitive-vad",
  "no-vad",
]);

const recoveryCueEvidenceSchema = z
  .object({
    id: z.string().min(1),
    start: z.number().nonnegative(),
    end: z.number().positive(),
    text: z.string(),
    language: languageTagSchema,
  })
  .loose()
  .refine((cue) => cue.end > cue.start, {
    message: "Recovery cue end must be after start.",
  });

export const missingDialogueRecoveryArtifactSchema = z
  .object({
    schemaVersion: transcriptionSchemaVersionSchema,
    generatedAt: z.iso.datetime(),
    maximumActualWavSeconds: z.number().positive().max(30),
    summary: z
      .object({
        inputReviewGroups: z.number().int().nonnegative(),
        recoveryUnits: z.number().int().nonnegative(),
        recoveredUnits: z.number().int().nonnegative(),
        probableNonSpeechUnits: z.number().int().nonnegative(),
        suspectedHallucinationUnits: z.number().int().nonnegative(),
        stillNeedsReviewUnits: z.number().int().nonnegative(),
        autoCreatedFinalCues: z.number().int().nonnegative(),
        closedMissingDialogueReviews: z.number().int().nonnegative(),
        recoveryAsrRequests: z.number().int().nonnegative(),
        cacheHits: z.number().int().nonnegative(),
        profileAttempts: z
          .object({
            "current-sensitive-vad": z.number().int().nonnegative(),
            "extra-sensitive-vad": z.number().int().nonnegative(),
            "no-vad": z.number().int().nonnegative(),
          })
          .strict(),
      })
      .strict(),
    units: z.array(
      z
        .object({
          id: z.string().min(1),
          parentReviewGroupId: z.string().min(1),
          interval: transcriptionIntervalSchema,
          extractedInterval: transcriptionIntervalSchema,
          speechIslandIds: z.array(z.string().min(1)),
          contextBeforeSeconds: z.number().nonnegative(),
          contextAfterSeconds: z.number().nonnegative(),
          sourceReasons: z.array(z.string().min(1)).min(1),
          maximumUnitSeconds: z.number().positive().max(30).optional(),
          preferredContextSeconds: z.number().nonnegative().optional(),
          referenceAnchorIds: z.array(z.string().min(1)).optional(),
          referenceUnitId: z.string().min(1).optional(),
          expectedCueCount: z.number().int().positive().optional(),
          sceneId: z.string().min(1).optional(),
          sceneLabel: acousticSceneLabelSchema.optional(),
          requestedProfiles: z
            .array(missingDialogueRecoveryProfileSchema)
            .optional(),
          routingReasons: z.array(z.string().min(1)).optional(),
          attempts: z.array(
            z
              .object({
                id: z.string().min(1),
                profile: missingDialogueRecoveryProfileSchema,
                asrRequestId: z.string().min(1),
                model: z.string().min(1),
                coreML: z.boolean(),
                vadEnabled: z.boolean(),
                prompt: z
                  .object({
                    confirmedNames: z.array(z.string().min(1)),
                    adjacentOriginalLanguageText: z.array(z.string().min(1)),
                    translatedReferenceUsedAsTarget: z.literal(false),
                  })
                  .strict(),
                cacheKey: z.string().regex(/^[a-f0-9]{64}$/u),
                cacheHit: z.boolean(),
                text: z.string(),
                canonicalCues: z.array(recoveryCueEvidenceSchema),
                quality: hypothesisQualitySchema,
                qualityFindingCount: z.number().int().nonnegative(),
                timingValid: z.boolean(),
                decision: z.enum([
                  "candidate-valid",
                  "invalid-hallucination",
                  "invalid-empty",
                  "invalid-timing",
                  "invalid-language",
                  "weak",
                ]),
              })
              .strict(),
          ),
          decision: z.enum([
            "recovered",
            "probable-non-speech",
            "suspected-hallucination",
            "needs-human-review",
          ]),
          selectedAttemptId: z.string().min(1).nullable(),
          decisionReasons: z.array(z.string().min(1)).min(1),
        })
        .strict(),
    ),
  })
  .strict();

export type MissingDialogueRecoveryArtifact = z.infer<
  typeof missingDialogueRecoveryArtifactSchema
>;

export const whisperExecutionModeSchema = z.enum([
  "auto",
  "persistent",
  "batch",
  "process",
]);

export type WhisperExecutionMode = z.infer<typeof whisperExecutionModeSchema>;

export const whisperExecutionMetricsSchema = z
  .object({
    schemaVersion: transcriptionSchemaVersionSchema,
    requestedMode: whisperExecutionModeSchema,
    executionMode: z.enum(["persistent", "batch", "process"]),
    backend: z.enum(["coreml", "cpu", "mixed"]),
    asrRequestCount: z.number().int().nonnegative(),
    cacheHitCount: z.number().int().nonnegative(),
    workerStartCount: z.number().int().nonnegative(),
    modelLoadCount: z.number().int().nonnegative(),
    initializationSeconds: z.number().nonnegative(),
    modelLoadSeconds: z.number().nonnegative(),
    coreMLWarmupSeconds: z.number().nonnegative(),
    transcriptionSeconds: z.number().nonnegative(),
    totalWorkerSeconds: z.number().nonnegative(),
    fallbackProcessCount: z.number().int().nonnegative(),
    requests: z.array(
      z
        .object({
          requestId: z.string().min(1),
          batchKey: z.string().min(1),
          cacheHit: z.boolean(),
          mode: z.enum(["persistent", "batch", "process"]),
          status: z.enum(["succeeded", "failed", "fallback-succeeded"]),
          retryCount: z.number().int().nonnegative(),
          fallbackMode: z.literal("process").nullable(),
          durationSeconds: z.number().nonnegative(),
          error: z.string().min(1).nullable(),
        })
        .strict(),
    ),
    workers: z.array(
      z
        .object({
          batchKey: z.string().min(1),
          mode: z.enum(["persistent", "batch"]),
          backend: z.enum(["coreml", "cpu"]),
          requestCount: z.number().int().nonnegative(),
          warmupCount: z.number().int().nonnegative(),
          initializationSeconds: z.number().nonnegative(),
          modelLoadSeconds: z.number().nonnegative(),
          coreMLWarmupSeconds: z.number().nonnegative(),
          transcriptionSeconds: z.number().nonnegative(),
          exitReason: z.string().min(1).nullable(),
        })
        .strict(),
    ),
    fallbackReason: z.string().min(1).nullable(),
  })
  .strict();

export type WhisperExecutionMetrics = z.infer<
  typeof whisperExecutionMetricsSchema
>;

export const adaptiveRefinementRecordSchema = z
  .object({
    schemaVersion: transcriptionSchemaVersionSchema,
    strategy: z.literal("adaptive"),
    basePass: z
      .object({
        adapter: z.literal("whisper-cpp"),
        model: z.string().min(1),
        coreML: z.boolean(),
        timestampStrategy: z.literal("segment"),
      })
      .strict(),
    replacements: z.array(
      z
        .object({
          interval: transcriptionIntervalSchema,
          expandedInterval: transcriptionIntervalSchema,
          sceneId: z.string().min(1).optional(),
          sceneLabel: acousticSceneLabelSchema.optional(),
          sceneConfidence: z.number().min(0).max(1).optional(),
          sceneProbabilities: acousticSceneProbabilitiesSchema.optional(),
          sceneRoutingReasons: z.array(z.string().min(1)).optional(),
          baseline: z
            .object({
              model: z.string().min(1),
              coreML: z.boolean(),
              text: z.string(),
            })
            .strict(),
          baselineHypotheses: z
            .object({
              vad: vadNoVadHypothesisSchema,
              noVad: vadNoVadHypothesisSchema,
            })
            .strict()
            .optional(),
          conflict: z
            .object({
              vadNoVadConflict: z.boolean(),
              normalizedSimilarity: z.number().min(0).max(1),
              characterEditDistance: z.number().int().nonnegative(),
              timingOverlap: z.number().min(0).max(1).nullable(),
              startDifferenceSeconds: z
                .number()
                .nonnegative()
                .nullable()
                .optional(),
              endDifferenceSeconds: z
                .number()
                .nonnegative()
                .nullable()
                .optional(),
              durationDifferenceSeconds: z
                .number()
                .nonnegative()
                .nullable()
                .optional(),
              segmentCountDifference: z.number().int().nonnegative().optional(),
              speechBoundaryDifferenceSeconds: z
                .number()
                .nonnegative()
                .nullable()
                .optional(),
              boundaryDisagreement: z.boolean().optional(),
              vadBoundary: transcriptionIntervalSchema.nullable().optional(),
              noVadBoundary: transcriptionIntervalSchema.nullable().optional(),
              lengthRatio: z.number().min(0).max(1),
              languageConflict: z.boolean(),
              oneSideEmpty: z.boolean(),
              repetitionConflict: z.boolean(),
              validCandidateConflict: z.boolean().optional(),
              conflictCodes: z
                .array(
                  z.enum([
                    "VAD_NO_VAD_VALID_CONFLICT",
                    "VAD_NO_VAD_BOUNDARY_DISAGREEMENT",
                    "NO_VAD_HALLUCINATION",
                    "VAD_HALLUCINATION",
                    "VAD_INVALID",
                    "NO_VAD_INVALID",
                  ]),
                )
                .optional(),
              highBackgroundNoise: z.boolean(),
              speechEvidence: z.enum(["strong", "weak", "unknown"]),
            })
            .strict()
            .optional(),
          refinement: z
            .object({
              model: z.string().min(1),
              coreML: z.boolean(),
              round: z.number().int().positive(),
              text: z.string(),
              tokenTimestampsAvailable: z.boolean().optional(),
              tokenTimestampsUsed: z.boolean().optional(),
              quality: hypothesisQualitySchema.optional(),
            })
            .strict(),
          consensus: z
            .object({
              localComparison: z.boolean(),
              alignmentMode: z.enum([
                "time-aligned",
                "text-window-fallback",
                "unavailable",
              ]),
              localInterval: transcriptionIntervalSchema.nullable(),
              vadSupport: z.number().min(0).max(1),
              noVadSupport: z.number().min(0).max(1),
              refinementSupport: z.number().min(0).max(1),
              tieBreakApplied: z.boolean(),
            })
            .strict()
            .optional(),
          timingRepair: z
            .object({
              attempted: z.boolean(),
              method: z.enum([
                "none",
                "timing-only-token",
                "timing-only-speech",
                "retranscription",
                "human-review",
              ]),
              before: transcriptionIntervalSchema,
              after: transcriptionIntervalSchema.nullable(),
              reasons: z.array(z.string().min(1)),
              repairType: z.literal("timing-only").optional(),
              textChanged: z.boolean().optional(),
              asrRerun: z.boolean().optional(),
            })
            .strict()
            .optional(),
          decision: z
            .object({
              selected: z.enum([
                "baseline",
                "refinement",
                "vad",
                "no-vad",
                "none",
                "needs-human-review",
              ]),
              reason: z.array(z.string().min(1)).min(1),
              similarity: z.number().min(0).max(1),
              status: z
                .enum([
                  "accepted",
                  "accepted-after-refinement",
                  "needs-refinement",
                  "needs-human-review",
                ])
                .optional(),
              classification: transcriptionClassificationSchema.optional(),
              stableConsensus: z.boolean().optional(),
            })
            .strict(),
        })
        .strict(),
    ),
    maxRounds: z.number().int().nonnegative(),
    roundsExecuted: z.number().int().nonnegative(),
    qualitySummary: z
      .object({
        accepted: z.number().int().nonnegative(),
        refined: z.number().int().nonnegative(),
        needsHumanReview: z.number().int().nonnegative(),
        vadNoVadConflicts: z.number().int().nonnegative().default(0),
        resolvedByLargeV3: z.number().int().nonnegative().default(0),
        suspectedHallucinations: z.number().int().nonnegative().default(0),
        probableNonSpeech: z.number().int().nonnegative().default(0),
        autoResolvedVad: z.number().int().nonnegative().default(0).optional(),
        autoResolvedNoVad: z.number().int().nonnegative().default(0).optional(),
        autoResolvedLargeV3: z
          .number()
          .int()
          .nonnegative()
          .default(0)
          .optional(),
        rejectedVadHallucinations: z
          .number()
          .int()
          .nonnegative()
          .default(0)
          .optional(),
        rejectedNoVadHallucinations: z
          .number()
          .int()
          .nonnegative()
          .default(0)
          .optional(),
        trueUnresolvedConflicts: z
          .number()
          .int()
          .nonnegative()
          .default(0)
          .optional(),
      })
      .strict(),
    needsHumanReviewCount: z.number().int().nonnegative(),
    needsHumanReviewIntervals: z.array(
      transcriptionIntervalSchema.safeExtend({
        reasons: z.array(z.string().min(1)).min(1),
      }),
    ),
  })
  .strict();

export type AdaptiveRefinementRecord = z.infer<
  typeof adaptiveRefinementRecordSchema
>;

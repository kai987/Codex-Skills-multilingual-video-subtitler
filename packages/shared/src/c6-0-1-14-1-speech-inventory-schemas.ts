import { z } from "zod";
import { c60114SourceIdentitySchema } from "./c6-0-1-14-evidence-schemas.js";
import {
  c60114ProbeTokenSchema,
  c60114LocalizedLexicalEvidenceSchema,
} from "./c6-0-1-14-probe-schemas.js";

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const id = z.string().min(1);
const count = z.number().int().nonnegative();
const ratio = z.number().min(0).max(1);
export const c601141SampleIntervalSchema = z
  .object({
    startSample: count,
    endSample: z.number().int().positive(),
  })
  .strict()
  .refine((v) => v.endSample > v.startSample, "Empty sample interval");
export const c601141IntervalSchema = z
  .object({
    start: z.number().nonnegative(),
    end: z.number().positive(),
  })
  .strict()
  .refine((v) => v.end > v.start, "Empty interval");
export const c601141HeaderShape = {
  schemaVersion: z.literal("1.0.0"),
  policyVersion: z.literal("c6.0.1.14.1-multiview-speech-inventory-v1"),
  sourceIdentity: c60114SourceIdentitySchema,
  sourceTimebase: z.literal("SOURCE_GLOBAL_NATIVE_SAMPLES"),
  policyHash: hash,
  runtimeGoldInputCount: z.literal(0),
  semanticHash: hash,
};
const profile = z
  .object({
    profileId: id,
    threshold: ratio,
    minSpeechMs: count,
    minSilenceMs: count,
    maxSpeechSeconds: z.number().positive(),
    speechPadMs: count,
    samplesOverlap: ratio,
  })
  .strict();
export const c601141PolicySchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    policyVersion: c601141HeaderShape.policyVersion,
    profiles: z.array(profile).length(2),
    maxViews: z.literal(5),
    maxDetectorRuns: z.literal(12),
    maxSileroRuns: z.literal(10),
    maxPyannoteRuns: z.literal(2),
    maxAsrRequests: z.literal(32),
    maxAsrTargets: z.literal(12),
    maxContextTargets: z.literal(4),
    maxSafetyTargets: z.literal(24),
    maxSafetyUnionSeconds: z.literal(60),
    maxTargetSeconds: z.literal(12),
    maxFingerprintClips: z.literal(256),
    maxFingerprintSeconds: z.literal(900),
    fingerprint: z
      .object({
        minimumClipSeconds: z.number().positive(),
        minimumRms: z.number().positive(),
        minimumNormalizedCorrelation: ratio,
        minimumScoreMargin: ratio,
        maximumNormalizedResidual: ratio,
        secondPeakExclusionSeconds: z.number().positive(),
        maximumSpectralPeakRatio: ratio,
        maximumLagOneCorrelation: ratio,
      })
      .strict(),
    fusion: z
      .object({
        minimumIslandSeconds: z.number().positive(),
        splitMaximumSeconds: z.literal(12),
        sameFamilyMergeGapSeconds: z.literal(0),
        minimumIndependentOverlapSeconds: z.number().positive(),
        timeDiversityBinSeconds: z.number().positive(),
      })
      .strict(),
    asr: z
      .object({
        exactGuardSeconds: z.number().nonnegative(),
        contextSeconds: z.number().nonnegative(),
        prompt: z.literal(""),
        vadEnabled: z.literal(false),
        retryCount: z.literal(0),
        providers: z.tuple([
          z.literal("whisper-large-v3"),
          z.literal("reazonspeech-k2-v2"),
        ]),
      })
      .strict(),
    fullMediaAsrAllowed: z.literal(false),
    modelDownloadAllowed: z.literal(false),
    automaticCanonicalMutationAllowed: z.literal(false),
    semanticHash: hash,
  })
  .strict();
export const c601141TimeMappingSchema = z
  .object({
    sourceStartSample: count,
    sourceSampleRate: z.number().int().positive(),
    outputSampleRate: z.literal(16000),
    numerator: z.number().int().positive(),
    denominator: z.number().int().positive(),
    outputStartSample: z.literal(0),
    mappingStatus: z.literal("VERIFIED_INTEGER_RATIONAL"),
    measuredImpulsePeakDelaySamples: z.number().int(),
    syntheticValidationHash: hash,
  })
  .strict();
export const c601141AudioViewSchema = z
  .object({
    viewId: id,
    role: z.enum([
      "NATIVE_MONO",
      "LEFT",
      "RIGHT",
      "CENTER_OR_MID",
      "VOICE_BAND_CENTER",
    ]),
    sourceAudioStreamIndex: count,
    nativeSampleRate: z.number().int().positive(),
    nativeChannelLayout: id,
    sourcePtsStartSeconds: z.number(),
    filterGraph: id,
    decodeCommandIdentity: hash,
    ffmpegIdentity: hash,
    relativePath: id,
    sampleRate: z.literal(16000),
    channels: z.literal(1),
    bitDepth: z.literal(16),
    frameCount: z.number().int().positive(),
    durationSeconds: z.number().positive(),
    audioSha256: hash,
    pcmSha256: hash,
    timeMapping: c601141TimeMappingSchema,
    duplicateOfViewId: id.nullable(),
    detectorEligible: z.boolean(),
    semanticHash: hash,
  })
  .strict();
export const c601141AudioViewsSchema = z
  .object({
    ...c601141HeaderShape,
    artifactType: z.literal("machine-source-audio-views-v1"),
    views: z.array(c601141AudioViewSchema).max(5),
    summary: z
      .object({
        viewCount: count,
        uniquePcmViewCount: count,
        rejectedCount: count,
      })
      .strict(),
  })
  .strict();
export const c601141FingerprintStatusSchema = z.enum([
  "LEGACY_EXACT_PCM_RECOVERED",
  "LEGACY_SAMPLE_CHAIN_RECOVERED",
  "LEGACY_UNIQUE_FINGERPRINT_RECOVERED",
  "FINGERPRINT_AMBIGUOUS",
  "FINGERPRINT_LOW_SUPPORT",
  "SOURCE_AUDIO_BYTES_NOT_RETAINED",
  "EXTRACTION_CONFIG_UNRESOLVED",
  "SILENT_OR_REPETITIVE_CLIP",
  "PROVENANCE_STILL_INSUFFICIENT",
]);
export const c601141FingerprintEntrySchema = z
  .object({
    evidenceId: id,
    requestIds: z.array(id),
    retainedPath: id.nullable(),
    retainedAudioSha256: hash.nullable(),
    retainedPcmSha256: hash.nullable(),
    clipSeconds: z.number().nonnegative(),
    searched: z.boolean(),
    searchScope: z.literal("FULL_SOURCE_ONLY"),
    searchViewId: id.nullable(),
    bestOffsetSamples16k: count.nullable(),
    secondOffsetSamples16k: count.nullable(),
    bestScore: z.number().min(-1).max(1).nullable(),
    secondScore: z.number().min(-1).max(1).nullable(),
    scoreMargin: z.number().nullable(),
    residual: z.number().nonnegative().nullable(),
    uniquenessPassed: z.boolean(),
    status: c601141FingerprintStatusSchema,
    nativeInterval: c601141SampleIntervalSchema.nullable(),
    speechPositive: z.boolean(),
    lexicalEvidenceEligible: z.boolean(),
    lexicalProvenanceReasons: z.array(id),
    reasons: z.array(id),
    semanticHash: hash,
  })
  .strict()
  .refine(
    (v) =>
      v.uniquenessPassed === v.status.startsWith("LEGACY_") &&
      (!(v.speechPositive || v.lexicalEvidenceEligible || v.nativeInterval) ||
        (v.uniquenessPassed &&
          v.searched &&
          v.retainedAudioSha256 !== null &&
          v.nativeInterval !== null)),
    "Ambiguous, unavailable or unverified audio cannot be a localized speech/lexical observation",
  );
export const c601141FingerprintSchema = z
  .object({
    ...c601141HeaderShape,
    artifactType: z.literal("machine-legacy-audio-fingerprint-reconciliation"),
    inputLineageHash: hash,
    viewsHash: hash,
    syntheticControlsHash: hash,
    entries: z.array(c601141FingerprintEntrySchema),
    summary: z
      .object({
        quarantinedEntryCount: count,
        retainedClipCount: count,
        uniqueSearchedClips: count.max(256),
        searchedClipSeconds: z.number().min(0).max(900),
        recoveredEntries: count,
        ambiguousEntries: count,
        noBytesEntries: count,
        rejectedEntries: count,
        lexicalEligibleEntries: count,
      })
      .strict(),
  })
  .strict();
export const c601141RuntimeIdentitySchema = z
  .object({
    detectorFamily: z.enum(["SILERO", "PYANNOTE"]),
    modelId: id,
    modelSnapshotHash: hash,
    runtimeIdentityHash: hash,
    workerSha256: hash,
    binarySha256: hash,
    device: z.enum(["cpu", "mps", "metal"]),
    offline: z.literal(true),
    modelDownloadCount: z.literal(0),
    versions: z.record(id, id),
  })
  .strict();
export const c601141DetectorRunSchema = z
  .object({
    runId: id,
    viewId: id,
    pcmSha256: hash,
    profileId: id,
    runtime: c601141RuntimeIdentitySchema,
    cacheKey: hash,
    rawUnit: z.enum(["CENTISECONDS", "SECONDS"]),
    rawIntervals: z.array(c601141IntervalSchema),
    exclusiveRawIntervals: z.array(c601141IntervalSchema),
    nativeIntervals: z.array(c601141SampleIntervalSchema),
    inferenceConsumed: z.boolean(),
    resultPersisted: z.boolean(),
    status: z.enum([
      "SUCCESS",
      "DETECTOR_RUNTIME_UNAVAILABLE",
      "FAILED",
      "INFERENCE_CONSUMED_RESULT_NOT_PERSISTED",
    ]),
    modelLoadDelta: count,
    providerProcessDelta: count,
    errorCode: id.nullable(),
    rawResultHash: hash.nullable(),
    semanticHash: hash,
  })
  .strict();
export const c601141SweepsSchema = z
  .object({
    ...c601141HeaderShape,
    artifactType: z.literal("machine-whole-media-speech-activity-sweeps"),
    mode: z.enum(["FRESH", "EXACT_CACHE_ONLY"]),
    viewsHash: hash,
    planHash: hash,
    runs: z.array(c601141DetectorRunSchema).max(12),
    accounting: z
      .object({
        plannedRuns: count.max(12),
        sileroRuns: count.max(10),
        pyannoteRuns: count.max(2),
        inferenceCount: count.max(12),
        cacheHits: count,
        cacheMisses: count,
        modelLoadCount: count,
        providerProcessStartCount: count,
        fullMediaAsrCount: z.literal(0),
        retryCount: z.literal(0),
      })
      .strict(),
    evidenceSemanticHash: hash,
  })
  .strict();
export const c601141ObservationSchema = z
  .object({
    observationId: id,
    nativeInterval: c601141SampleIntervalSchema,
    family: z.enum([
      "SILERO",
      "PYANNOTE",
      "LEGACY_FINGERPRINT",
      "EXISTING_VERIFIED",
      "LOCALIZED_LEXICAL",
    ]),
    correlationGroup: id,
    viewId: id.nullable(),
    profileId: id.nullable(),
    evidenceIds: z.array(id).min(1),
    requestIds: z.array(id),
    verifiedTimebase: z.boolean(),
    speechPositive: z.boolean(),
    strongContradiction: z.boolean(),
    reliableLexical: z.boolean(),
  })
  .strict();
export const c601141IslandSchema = z
  .object({
    islandId: id,
    nativeInterval: c601141SampleIntervalSchema,
    sourceInterval: c601141IntervalSchema,
    observationIds: z.array(id).min(1),
    evidenceIds: z.array(id).min(1),
    requestIds: z.array(id),
    independentFamilies: z.array(id),
    independentFamilyCount: count,
    distinctPcmViewIds: z.array(id),
    evidenceClass: z.enum([
      "MULTI_DETECTOR_CONFIRMED",
      "LEGACY_FINGERPRINT_CONFIRMED",
      "EXISTING_VERIFIED_SPEECH",
      "MULTI_VIEW_SPEECH_POSITIVE",
      "PYANNOTE_ONLY_SPEECH_POSITIVE",
      "SINGLE_DETECTOR_HIGH_RECALL",
      "DETECTOR_DISAGREEMENT",
      "LOW_SUPPORT_VIEW_SPECIFIC",
      "STRONG_CONTRADICTION",
      "TIMEBASE_UNVERIFIED",
    ]),
    verifiedTimebase: z.boolean(),
    strongContradiction: z.boolean(),
    reliableLexical: z.boolean(),
    semanticHash: hash,
  })
  .strict();
export const c601141InventorySchema = z
  .object({
    ...c601141HeaderShape,
    artifactType: z.literal("machine-source-global-speech-inventory-v4"),
    viewsHash: hash,
    fingerprintHash: hash,
    sweepsEvidenceHash: hash,
    previousIslandsHash: hash,
    observations: z.array(c601141ObservationSchema),
    islands: z.array(c601141IslandSchema),
    summary: z
      .object({
        observationCount: count,
        islandCount: count,
        multiDetectorCount: count,
        nativeUnionSeconds: z.number().nonnegative(),
        unresolvedCount: count,
        parentEnvelopeAsSpeechCount: z.literal(0),
        correlationInflationCount: z.literal(0),
      })
      .strict(),
  })
  .strict();
export const c601141UncoveredCandidateSchema = c601141IslandSchema.extend({
  candidateId: id,
  parentIslandId: id,
  uncoveredRatio: ratio,
  partialCueOverlap: z.boolean(),
  partialExistingTargetOverlap: z.boolean(),
  priority: z.number(),
  diversityBin: count,
});
export const c601141UncoveredSchema = z
  .object({
    ...c601141HeaderShape,
    artifactType: z.literal("machine-uncovered-speech-candidates-v1"),
    inventoryHash: hash,
    finalCueHash: hash,
    previousTargetsHash: hash,
    candidates: z.array(c601141UncoveredCandidateSchema),
    summary: z
      .object({
        candidateCount: count,
        uncoveredSeconds: z.number().nonnegative(),
      })
      .strict(),
  })
  .strict();
export const c601141SafetyTargetSchema = c601141UncoveredCandidateSchema.extend(
  {
    targetId: id,
    targetType: z.enum([
      "SPEECH_INVENTORY_STRONG_UNCOVERED",
      "SPEECH_INVENTORY_POSSIBLE_UNCOVERED",
    ]),
    requiredLevel: z.literal("RECOMMENDED"),
    canonicalInsertAllowed: z.literal(false),
  },
);
export const c601141SafetySchema = z
  .object({
    ...c601141HeaderShape,
    artifactType: z.literal("machine-missing-safety-reserve-targets-v1"),
    uncoveredHash: hash,
    targets: z.array(c601141SafetyTargetSchema).max(24),
    audit: z.array(
      z
        .object({
          candidateId: id,
          status: z.enum([
            "SELECTED",
            "LOW_SUPPORT_AUDIT_ONLY",
            "BUDGET_OVERFLOW",
          ]),
          reason: id,
        })
        .strict(),
    ),
    summary: z
      .object({
        targetCount: count.max(24),
        strongCount: count,
        possibleCount: count,
        targetUnionSeconds: z.number().min(0).max(60),
        overflowCount: count,
        auditOnlyCount: count,
        catchAllTargetCount: z.literal(0),
        requiredLevelPromotionCount: z.literal(0),
      })
      .strict(),
  })
  .strict()
  .refine(
    (v) =>
      v.summary.targetCount === v.targets.length &&
      v.targets.every(
        (t) =>
          t.verifiedTimebase &&
          !t.strongContradiction &&
          t.sourceInterval.end - t.sourceInterval.start <= 12 + 1e-8 &&
          t.sourceInterval.end <= v.sourceIdentity.durationSeconds + 1e-8 &&
          Math.abs(
            t.sourceInterval.start * v.sourceIdentity.sampleRate -
              t.nativeInterval.startSample,
          ) < 1e-6 &&
          Math.abs(
            t.sourceInterval.end * v.sourceIdentity.sampleRate -
              t.nativeInterval.endSample,
          ) < 1e-6,
      ),
    "Safety targets require bounded verified source-native evidence, never a catch-all envelope",
  );
export const c601141AsrSelectionSchema = z
  .object({
    ...c601141HeaderShape,
    artifactType: z.literal("machine-c6-0-1-14-1-asr-probe-selection"),
    safetyHash: hash,
    targets: z.array(c601141SafetyTargetSchema).max(12),
    contextEligibleTargetIds: z.array(id).max(4),
    maximumAuthorizedRequests: count.max(32),
    selectionFrozenAt: z.iso.datetime(),
    targetBackfillAllowed: z.literal(false),
    goldBlind: z.literal(true),
  })
  .strict();
export const c601141AsrRequestSchema = z
  .object({
    requestId: id,
    targetId: id,
    provider: z.enum(["whisper-large-v3", "reazonspeech-k2-v2"]),
    windowType: z.enum(["CORE_EXACT", "CORE_CONTEXT"]),
    targetInterval: c601141IntervalSchema,
    extractionInterval: c601141IntervalSchema,
    nativeInterval: c601141SampleIntervalSchema,
    cacheKey: hash,
    requestIdentityHash: hash,
    runtimeIdentityHash: hash,
    modelSnapshotHash: hash,
    audioSha256: hash.nullable(),
    relativeAudioPath: id.nullable(),
    sampleCount: count,
    prompt: z.literal(""),
    vadEnabled: z.literal(false),
    inferenceConsumed: z.boolean(),
    resultPersisted: z.boolean(),
    status: z.enum([
      "SUCCESS",
      "EMPTY_OUTPUT",
      "FAILED",
      "INFERENCE_CONSUMED_RESULT_NOT_PERSISTED",
      "RUNTIME_UNAVAILABLE",
    ]),
    rawResultHash: hash.nullable(),
    displayText: z.string(),
    normalizedText: z.string(),
    readingText: z.string().nullable(),
    readingRuntimeHash: hash.nullable(),
    tokens: z.array(c60114ProbeTokenSchema),
    localizedText: z.string(),
    localizationStatus: z.enum([
      "EXACT_SOURCE_WINDOW",
      "TRUSTED_TOKEN_PROJECTION",
      "CONTEXT_UNPROJECTABLE",
      "EMPTY",
      "FAILED",
    ]),
    hallucinationRisk: ratio,
    strongContradiction: z.boolean(),
    modelLoadDelta: count,
    providerProcessDelta: count,
    errorCode: id.nullable(),
    semanticHash: hash,
  })
  .strict();
export const c601141AsrProbesSchema = z
  .object({
    ...c601141HeaderShape,
    artifactType: z.literal("machine-c6-0-1-14-1-local-asr-probes"),
    mode: z.enum(["FRESH", "EXACT_CACHE_ONLY"]),
    selectionHash: hash,
    requests: z.array(c601141AsrRequestSchema).max(32),
    contextDecisions: z
      .array(
        z
          .object({ targetId: id, executed: z.boolean(), reasons: z.array(id) })
          .strict(),
      )
      .max(4),
    accounting: z
      .object({
        inferenceCount: count.max(32),
        exactCount: count.max(24),
        contextCount: count.max(8),
        cacheHits: count,
        cacheMisses: count,
        modelLoadCount: count,
        providerProcessStartCount: count,
        resultPersistedCount: count,
        failedCount: count,
        hiddenRetryCount: z.literal(0),
        fullMediaAsrCount: z.literal(0),
      })
      .strict(),
    evidenceSemanticHash: hash,
  })
  .strict();
export const c601141LexicalRowSchema = z
  .object({
    targetId: id,
    requestIds: z.array(id),
    evidenceFamilies: z.array(id),
    sourceInterval: c601141IntervalSchema,
    nativeInterval: c601141SampleIntervalSchema,
    evidenceClass: z.enum([
      "CROSS_MODEL_LOCALIZED_AGREEMENT",
      "PRONUNCIATION_AGREEMENT",
      "WHISPER_ONLY_LOCALIZED",
      "REAZON_ONLY_LOCALIZED",
      "CROSS_MODEL_DISAGREEMENT",
      "HISTORICAL_FINGERPRINT_LOCALIZED",
      "CONTEXT_ONLY_UNPROJECTABLE",
      "BOTH_EMPTY",
      "HALLUCINATION_RISK",
      "LOCALIZATION_UNRESOLVED",
    ]),
    localizedTextCandidates: z.array(
      z
        .object({
          requestId: id,
          text: z.string(),
          reading: z.string().nullable(),
        })
        .strict(),
    ),
    reliableLocalizedLexical: z.boolean(),
    canonicalInsertAllowed: z.literal(false),
    semanticHash: hash,
  })
  .strict();
export const c601141LexicalSchema = z
  .object({
    ...c601141HeaderShape,
    artifactType: z.literal("machine-missing-lexical-evidence-v4"),
    probesEvidenceHash: hash,
    targets: z.array(c601141LexicalRowSchema),
    existingProbeEvidence: c60114LocalizedLexicalEvidenceSchema.nullable(),
    existingProbeEvidenceHash: hash.nullable(),
    fingerprintEvidenceHash: hash.nullable(),
    historicalFingerprintCandidates: z.array(
      z
        .object({
          evidenceId: id,
          requestIds: z.array(id),
          nativeInterval: c601141SampleIntervalSchema,
          sourceInterval: c601141IntervalSchema,
          displayText: z.string().min(1),
          normalizedText: z.string(),
          classification: z.literal("HISTORICAL_FINGERPRINT_LOCALIZED"),
          sourceLocalizationVerified: z.literal(true),
          lexicalTruthGuaranteed: z.literal(false),
          canonicalInsertAllowed: z.literal(false),
          semanticHash: hash,
        })
        .strict(),
    ),
    summary: z
      .object({
        targetCount: count,
        crossModelCount: count,
        readingAgreementCount: count,
        singleModelCount: count,
        emptyCount: count,
        disagreementCount: count,
        reliableLocalizedCount: count,
        existingProbeTargetCount: count,
        historicalFingerprintCandidateCount: count,
        canonicalInsertCount: z.literal(0),
      })
      .strict(),
  })
  .strict();
export const c601141MissingEvidenceSchema = z
  .object({
    ...c601141HeaderShape,
    artifactType: z.literal("machine-missing-speech-evidence-v4"),
    inventoryHash: hash,
    safetyHash: hash,
    lexicalHash: hash,
    targets: z.array(
      z
        .object({
          targetId: id,
          sourceInterval: c601141IntervalSchema,
          nativeInterval: c601141SampleIntervalSchema,
          evidenceIds: z.array(id),
          requestIds: z.array(id),
          speechEvidenceClass: id,
          lexicalEvidenceClass: id,
          evidenceFlags: z.array(
            z.enum([
              "SPEECH_INVENTORY_STRONG",
              "SPEECH_INVENTORY_SAFETY_RESERVE",
              "LEGACY_FINGERPRINT_RECOVERED",
              "LEXICAL_CROSS_MODEL_SUPPORT",
              "LEXICAL_SINGLE_MODEL_SUPPORT",
              "ASR_DISAGREEMENT",
              "ASR_EMPTY",
              "DETECTOR_DISAGREEMENT",
              "NON_SPEECH_CONTRADICTED",
              "SPEECH_DETECTION_UNRESOLVED",
            ]),
          ),
          missingEvidenceClass: z.enum([
            "MISSING_DIALOGUE_STRONG",
            "SPEECH_INVENTORY_STRONG",
            "SPEECH_INVENTORY_SAFETY_RESERVE",
            "LEGACY_FINGERPRINT_RECOVERED",
            "LEXICAL_SINGLE_MODEL_SUPPORT",
            "ASR_DISAGREEMENT",
            "ASR_EMPTY",
            "NON_SPEECH_CONTRADICTED",
            "SPEECH_DETECTION_UNRESOLVED",
          ]),
          subtitleAction: z.literal("HUMAN_REVIEW_ONLY"),
          semanticHash: hash,
        })
        .strict(),
    ),
    summary: z
      .object({
        targetCount: count,
        strongMissingCount: count,
        safetyOnlyCount: count,
        canonicalInsertCount: z.literal(0),
      })
      .strict(),
  })
  .strict();
export const c601141MachineFreezeSchema = z
  .object({
    ...c601141HeaderShape,
    artifactType: z.literal("c6-0-1-14-1-machine-speech-inventory-freeze"),
    stage: z.enum([
      "PRE_INFERENCE_POLICY",
      "PRE_ASR_SELECTION",
      "FINAL_MACHINE_DELIVERY",
    ]),
    freezeCompletedAt: z.iso.datetime(),
    artifacts: z.array(
      z
        .object({
          relativePath: id,
          byteHash: hash,
          semanticHash: hash.nullable(),
        })
        .strict(),
    ),
    protectedMachineFiles: z.array(
      z.object({ relativePath: id, byteHash: hash }).strict(),
    ),
    sourceReadOnlyIdentity: z
      .object({ sha256: hash, size: count, mtimeMs: z.number(), inode: count })
      .strict(),
    canonicalTextHash: hash,
    canonicalTimingHash: hash,
    presentationHash: hash,
    canonicalTextMutationCount: z.literal(0),
    canonicalTimingMutationCount: z.literal(0),
    presentationMutationCount: z.literal(0),
    goldReadCountBeforeFreeze: z.literal(0),
    rankerRetrained: z.literal(false),
    oofTrainingRun: z.literal(false),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    machineOnlyReleaseAuthorized: z.literal(false),
    c602Status: z.literal("HOLD"),
    acquisitionSummary: z
      .object({
        detectorRuntimes: z.array(c601141RuntimeIdentitySchema),
        speechFresh: c601141SweepsSchema.shape.accounting,
        speechReplay: c601141SweepsSchema.shape.accounting,
        asrFresh: c601141AsrProbesSchema.shape.accounting,
        asrReplay: c601141AsrProbesSchema.shape.accounting,
        startupFailureProviderStarts: count,
        startupFailureModelLoads: z.literal(0),
        startupFailureConsumedInference: z.literal(0),
        nonSourceWarmupTransportCount: count,
        nonSourceWarmupEncoderDecoderCount: z.literal(0),
        warmupAccountingBasis: z.literal(
          "OBSERVED_EARLY_RETURN_STDERR_AND_PINNED_90MS_SPECTROGRAM_GUARD",
        ),
        asrRuntimeIdentityHashes: z.array(hash),
        asrModelIdentityHashes: z.array(hash),
        codeSnapshotHash: hash,
        projectionsHash: hash,
      })
      .strict()
      .optional(),
  })
  .strict();

export const c601141Schemas = {
  "c6-0-1-14-1-policy": c601141PolicySchema,
  "machine-source-audio-views-v1": c601141AudioViewsSchema,
  "machine-legacy-audio-fingerprint-reconciliation": c601141FingerprintSchema,
  "machine-whole-media-speech-activity-sweeps": c601141SweepsSchema,
  "machine-source-global-speech-inventory-v4": c601141InventorySchema,
  "machine-uncovered-speech-candidates-v1": c601141UncoveredSchema,
  "machine-missing-safety-reserve-targets-v1": c601141SafetySchema,
  "machine-c6-0-1-14-1-asr-probe-selection": c601141AsrSelectionSchema,
  "machine-c6-0-1-14-1-local-asr-probes": c601141AsrProbesSchema,
  "machine-missing-lexical-evidence-v4": c601141LexicalSchema,
  "machine-missing-speech-evidence-v4": c601141MissingEvidenceSchema,
  "c6-0-1-14-1-machine-speech-inventory-freeze": c601141MachineFreezeSchema,
};
export type C601141Policy = z.infer<typeof c601141PolicySchema>;
export type C601141Samples = z.infer<typeof c601141SampleIntervalSchema>;
export type C601141AudioView = z.infer<typeof c601141AudioViewSchema>;
export type C601141AudioViews = z.infer<typeof c601141AudioViewsSchema>;
export type C601141Fingerprint = z.infer<typeof c601141FingerprintSchema>;
export type C601141FingerprintEntry = z.infer<
  typeof c601141FingerprintEntrySchema
>;
export type C601141RuntimeIdentity = z.infer<
  typeof c601141RuntimeIdentitySchema
>;
export type C601141DetectorRun = z.infer<typeof c601141DetectorRunSchema>;
export type C601141Sweeps = z.infer<typeof c601141SweepsSchema>;
export type C601141Observation = z.infer<typeof c601141ObservationSchema>;
export type C601141Island = z.infer<typeof c601141IslandSchema>;
export type C601141Inventory = z.infer<typeof c601141InventorySchema>;
export type C601141Uncovered = z.infer<typeof c601141UncoveredSchema>;
export type C601141SafetyTarget = z.infer<typeof c601141SafetyTargetSchema>;
export type C601141Safety = z.infer<typeof c601141SafetySchema>;
export type C601141AsrSelection = z.infer<typeof c601141AsrSelectionSchema>;
export type C601141AsrRequest = z.infer<typeof c601141AsrRequestSchema>;
export type C601141AsrProbes = z.infer<typeof c601141AsrProbesSchema>;
export type C601141Lexical = z.infer<typeof c601141LexicalSchema>;
export type C601141MissingEvidence = z.infer<
  typeof c601141MissingEvidenceSchema
>;
export type C601141MachineFreeze = z.infer<typeof c601141MachineFreezeSchema>;

import { z } from "zod";
import {
  c601141SampleIntervalSchema,
  c601141IntervalSchema,
  c601141TimeMappingSchema,
  c601141RuntimeIdentitySchema,
} from "./c6-0-1-14-1-speech-inventory-schemas.js";
import {
  header142Shape,
  hash142Schema as h,
  id142Schema as id,
  count142Schema as n,
  ratio142Schema as ratio,
  family142Schema,
  observation142Schema,
  island142Schema,
} from "./c6-0-1-14-2-selection-detector-schemas.js";
const samples = c601141SampleIntervalSchema,
  interval = c601141IntervalSchema;
export const viewRole142Schema = z.enum([
  "NATIVE_MONO",
  "LEFT",
  "RIGHT",
  "CENTER_OR_MID",
  "VOICE_BAND_CENTER",
  "DIALOGUE_COMPRESSED_MID_V2",
  "PREEMPHASIS_VOICE_BAND_V1",
  "LIGHT_DENOISED_CENTER_V1",
]);
export const acousticFeatures142Schema = z
  .object({
    rms: z.number().nonnegative(),
    levelDbfsProxy: z.number(),
    dynamicRangeDb: z.number().nonnegative(),
    voiceBandRatio: ratio,
    lowBandRatio: ratio,
    highBandRatio: ratio,
    spectralFlatness: ratio,
    modulation2To16HzRatio: ratio,
    harmonicityProxy: ratio,
    pitchContinuityProxy: ratio,
    onsetDensityPerSecond: z.number().nonnegative(),
    centerSideEnergyRatio: z.number().nonnegative().nullable(),
  })
  .strict();
export const viewAuditRow142Schema = z
  .object({
    viewId: id,
    role: viewRole142Schema,
    pcmSha256: h,
    parentPcmSha256: h,
    frameCount: n,
    durationDeltaSamples: z.number().int(),
    parentCorrelation: z.number().min(-1).max(1),
    maximumCrossCorrelation: z.number().min(-1).max(1),
    maximumCrossCorrelationLagSamples16k: z.number().int(),
    spectralShapeDifference: z.number().nonnegative(),
    features: acousticFeatures142Schema,
    duplicateOfViewId: id.nullable(),
    amplitudeOnlyNoOp: z.boolean(),
    effectiveNoOp: z.boolean(),
    measuredImpulseDelayNativeSamples: z.number().int(),
    verifiedTimebase: z.boolean(),
    detectorEligible: z.boolean(),
    rejectionReason: id.nullable(),
    semanticHash: h,
  })
  .strict();
export const viewAudit142Schema = z
  .object({
    ...header142Shape,
    artifactType: z.literal("machine-audio-view-effectiveness-audit"),
    baselineViewsHash: h,
    featureAlgorithm: z.literal("pcm-rms-stft-modulation-autocorrelation-v1"),
    syntheticControlsHash: h,
    rows: z.array(viewAuditRow142Schema),
    newInferenceCount: z.literal(0),
    canonicalMutationCount: z.literal(0),
  })
  .strict();
export const dialogueView142Schema = z
  .object({
    viewId: id,
    role: viewRole142Schema,
    parentViewId: id,
    parentPcmSha256: h,
    relativePath: id,
    sampleRate: z.literal(16000),
    channels: z.literal(1),
    bitDepth: z.literal(16),
    frameCount: n,
    durationSeconds: z.number().positive(),
    audioSha256: h,
    pcmSha256: h,
    recipe: id,
    recipeHash: h,
    workerHash: h,
    timeMapping: c601141TimeMappingSchema,
    duplicateOfViewId: id.nullable(),
    effectiveNoOp: z.boolean(),
    detectorEligible: z.boolean(),
    rejectionReason: id.nullable(),
    semanticHash: h,
  })
  .strict();
export const dialogueViews142Schema = z
  .object({
    ...header142Shape,
    artifactType: z.literal("machine-dialogue-emphasis-audio-views-v2"),
    baselineViewsHash: h,
    syntheticControlsHash: h,
    views: z.array(dialogueView142Schema).max(3),
    summary: z
      .object({
        logicalViewCount: n.max(3),
        uniqueEffectiveViewCount: n.max(3),
        rejectedViewCount: n,
        modelInferenceCount: z.literal(0),
        neuralSourceSeparationCount: z.literal(0),
      })
      .strict(),
  })
  .strict();
export const webrtcRuntime142Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("machine-independent-speech-presence-runtime"),
    visibility: z.literal("LOCAL_ONLY"),
    status: z.enum(["AVAILABLE", "WEBRTC_RUNTIME_UNAVAILABLE"]),
    detectorFamily: z.literal("WEBRTC"),
    packageName: z.literal("webrtcvad-wheels"),
    packageVersion: z.literal("2.0.14"),
    implementation: z.literal("WEBRTC_GMM_VAD_NO_ASR_NO_NEURAL_MODEL"),
    implementationHash: h.nullable(),
    pythonVersion: id.nullable(),
    pythonBinaryHash: h.nullable(),
    platform: id.nullable(),
    moduleHash: h.nullable(),
    packageRecordHash: h.nullable(),
    workerHash: h,
    runtimeIdentityHash: h,
    modelLoadCount: z.literal(0),
    inferenceCount: z.literal(0),
    networkUsedForBootstrap: z.boolean(),
    inferenceNetworkAllowed: z.literal(false),
    errorCode: id.nullable(),
    semanticHash: h,
  })
  .strict();
export const detectorRuntime142Schema = c601141RuntimeIdentitySchema
  .extend({
    detectorFamily: z.enum(["SILERO", "PYANNOTE", "WEBRTC"]),
    implementationHash: h,
    posteriorCapture: z.enum([
      "SILERO_VAD_PROBS",
      "PYANNOTE_PRE_CONVERSION_POWERSET_ANONYMOUS",
      "WEBRTC_BINARY_DECISIONS",
    ]),
  })
  .strict();
export const detectorJob142Schema = z
  .object({
    runId: id,
    cacheKey: h,
    family: z.enum(["SILERO", "PYANNOTE", "WEBRTC"]),
    viewId: id,
    viewRole: viewRole142Schema,
    pcmSha256: h,
    audioSha256: h,
    frameCount: n,
    timeMapping: c601141TimeMappingSchema,
    runtime: detectorRuntime142Schema,
    profileId: id,
    mainThreshold: ratio,
    auditThreshold: ratio,
    profileHash: h,
  })
  .strict();
export const detectorPlan142Schema = z
  .object({
    ...header142Shape,
    artifactType: z.literal("machine-c6-0-1-14-2-detector-plan"),
    phaseAHash: h,
    audioViewsHash: h,
    viewAuditHash: h,
    independentRuntimeHash: h,
    frozenAt: z.iso.datetime(),
    jobs: z.array(detectorJob142Schema).max(8),
    skippedViews: z.array(
      z.object({ role: viewRole142Schema, family: id, reason: id }).strict(),
    ),
    scorePolicyHash: h,
    runtimeUnavailable: z.boolean(),
    maximumRuns: z.literal(8),
    maximumWebrtc: z.literal(4),
    maximumSilero: z.literal(2),
    maximumPyannote: z.literal(2),
    automaticRetryAllowed: z.literal(false),
    backfillAllowed: z.literal(false),
    goldBlind: z.literal(true),
  })
  .strict()
  .refine(
    (v) =>
      new Set(v.jobs.map((j) => j.runId)).size === v.jobs.length &&
      v.jobs.filter((j) => j.family === "WEBRTC").length <= 4 &&
      v.jobs.filter((j) => j.family === "SILERO").length <= 2 &&
      v.jobs.filter((j) => j.family === "PYANNOTE").length <= 2 &&
      new Set(v.jobs.map((j) => `${j.family}:${j.pcmSha256}:${j.profileId}`))
        .size === v.jobs.length,
    "Duplicate or over-budget detector runs",
  );
export const detectorFreeze142Schema = z
  .object({
    ...header142Shape,
    artifactType: z.literal("machine-c601142-pre-detector-freeze"),
    frozenAt: z.iso.datetime(),
    planHash: h,
    phaseAHash: h,
    policyHash: h,
    runtimeManifestHash: h,
    files: z.array(
      z
        .object({
          domain: z.enum(["SOURCE_CODE", "OUTPUT", "WEBRTC_RUNTIME"]),
          relativePath: id,
          sha256: h,
        })
        .strict(),
    ),
    detectorInferenceBeforeFreeze: z.literal(0),
    asrInferenceBeforeFreeze: z.literal(0),
    goldReadBeforeFreeze: z.literal(false),
  })
  .strict();
export const scoreStats142Schema = z
  .object({
    minimum: ratio,
    maximum: ratio,
    mean: ratio,
    q05: ratio,
    q25: ratio,
    q50: ratio,
    q75: ratio,
    q95: ratio,
    q99: ratio,
  })
  .strict();
export const scoreTrack142Schema = z
  .object({
    runId: id,
    family: z.enum(["SILERO", "PYANNOTE", "WEBRTC"]),
    viewId: id,
    pcmSha256: h,
    scoreKind: z.enum(["PROBABILITY", "BINARY_DECISION"]),
    relativePath: id,
    scoreSha256: h,
    dtype: z.literal("FLOAT32_LITTLE_ENDIAN"),
    frameCount: n,
    frameHopSamples16k: n.positive(),
    frameWindowSamples16k: n.positive(),
    frameOffsetSamples16k: z.number().int(),
    timeMapping: c601141TimeMappingSchema,
    maximumNativeSample: n,
    mainThreshold: ratio,
    auditThreshold: ratio,
    statistics: scoreStats142Schema,
    mainCrossingNativeIntervals: z.array(samples),
    subthresholdPeakNativeIntervals: z.array(samples),
    originalChunkScores: z
      .object({
        relativePath: id,
        sha256: h,
        shape: z.array(n).length(2),
        chunkStepSamples16k: n.positive(),
        frameHopSamples16k: n.positive(),
        frameWindowSamples16k: n.positive(),
        frameOffsetSamples16k: z.number().int(),
        anonymousReduction: z.literal("ONE_MINUS_EMPTY_POWERSET_PROBABILITY"),
        aggregation: z.literal("MEAN_OVERLAP_CELL_PROJECTION_10MS"),
      })
      .strict()
      .nullable(),
    semanticHash: h,
  })
  .strict();
export const scoreTracks142Schema = z
  .object({
    ...header142Shape,
    artifactType: z.literal("machine-speech-detector-score-tracks-v1"),
    planHash: h,
    tracks: z.array(scoreTrack142Schema).max(8),
    scorePolicyHash: h,
    rawScoresPreserved: z.literal(true),
    postGoldThresholdChangeCount: z.literal(0),
  })
  .strict();
export const detectorRun142Schema = z
  .object({
    runId: id,
    cacheKey: h,
    jobHash: h,
    family: detectorJob142Schema.shape.family,
    runtimeIdentityHash: h,
    viewId: id,
    pcmSha256: h,
    status: z.enum([
      "SUCCESS",
      "FAILED",
      "DETECTOR_RUNTIME_UNAVAILABLE",
      "INFERENCE_CONSUMED_RESULT_NOT_PERSISTED",
    ]),
    inferenceConsumed: z.boolean(),
    resultPersisted: z.boolean(),
    modelLoadCount: n,
    providerProcessStartCount: n,
    rawResultHash: h,
    rawIntervals: z.array(interval),
    exclusiveRawIntervals: z.array(interval),
    nativeIntervals: z.array(samples),
    scoreTrack: scoreTrack142Schema.nullable(),
    errorCode: id.nullable(),
    semanticHash: h,
  })
  .strict();
export const accounting142Schema = z
  .object({
    plannedRuns: n.max(8),
    inferenceCount: n.max(8),
    cacheHits: n,
    cacheMisses: n,
    modelLoadCount: n,
    providerProcessStartCount: n,
    webrtcRuns: n.max(4),
    sileroRuns: n.max(2),
    pyannoteRuns: n.max(2),
    persistedResultCount: n,
    failedCount: n,
    retryCount: z.literal(0),
    backfillCount: z.literal(0),
    fullMediaAsrCount: z.literal(0),
    networkRequestCount: z.literal(0),
  })
  .strict();
export const sweeps142Schema = z
  .object({
    ...header142Shape,
    artifactType: z.literal("machine-independent-speech-presence-sweeps"),
    mode: z.enum(["FRESH", "EXACT_CACHE_ONLY"]),
    planHash: h,
    runs: z.array(detectorRun142Schema).max(8),
    accounting: accounting142Schema,
    evidenceSemanticHash: h,
  })
  .strict();
export const maskedCandidate142Schema = z
  .object({
    candidateId: id,
    nativeInterval: samples,
    sourceInterval: interval,
    evidenceClass: z.enum([
      "VERIFIED_INDEPENDENT_DETECTOR_SPEECH",
      "WEBRTC_EXCLUSIVE_SPEECH_CANDIDATE",
      "SUBTHRESHOLD_MULTI_VIEW_CANDIDATE",
      "CROSS_DETECTOR_SUBTHRESHOLD_CANDIDATE",
      "MASKED_SPEECH_SAFETY_CANDIDATE",
      "ENERGY_ONLY_UNSUPPORTED",
      "MUSIC_DOMINATED_UNRESOLVED",
      "NO_SPEECH_SUPPORT",
    ]),
    mainRunIds: z.array(id),
    auditRunIds: z.array(id),
    detectorFamilies: z.array(family142Schema),
    distinctPcmViewIds: z.array(id),
    independentFamilyCount: n,
    scoreTrackHashes: z.array(h),
    acousticFeatures: acousticFeatures142Schema,
    acousticSupport: z.boolean(),
    acousticContradiction: z.boolean(),
    eligibleSafetyCandidate: z.boolean(),
    transcriptTruthVerified: z.literal(false),
    reasons: z.array(id),
    semanticHash: h,
  })
  .strict();
export const masked142Schema = z
  .object({
    ...header142Shape,
    artifactType: z.literal("machine-masked-speech-candidates-v1"),
    scoreTracksHash: h,
    candidates: z.array(maskedCandidate142Schema),
    featureSourcePcmHash: h,
    summary: z
      .object({
        candidateCount: n,
        eligibleCount: n,
        mainSupportedCount: n,
        subthresholdOnlyCount: n,
        independentCrossDetectorCount: n,
        musicUnresolvedCount: n,
        energyOnlyPromotedCount: z.literal(0),
        sameFamilyVoteInflationCount: z.literal(0),
      })
      .strict(),
  })
  .strict();
export const inventory142Schema = z
  .object({
    ...header142Shape,
    artifactType: z.literal("machine-source-global-speech-inventory-v5"),
    previousInventoryHash: h,
    newDetectorEvidenceHash: h,
    maskedEvidenceHash: h,
    boundaryHash: h,
    observations: z.array(observation142Schema),
    islands: z.array(island142Schema),
    summary: z
      .object({
        observationCount: n,
        islandCount: n,
        multiDetectorCount: n,
        mainSpeechUnionSeconds: z.number().nonnegative(),
        maskedCandidateUnionSeconds: z.number().nonnegative(),
        totalEvidenceUnionSeconds: z.number().nonnegative(),
        newDetectorObservationCount: n,
        unresolvedCount: n,
        parentEnvelopeAsSpeechCount: z.literal(0),
        correlationInflationCount: z.literal(0),
      })
      .strict(),
  })
  .strict();
export const c601142AcousticSchemas = {
  "machine-audio-view-effectiveness-audit": viewAudit142Schema,
  "machine-dialogue-emphasis-audio-views-v2": dialogueViews142Schema,
  "machine-independent-speech-presence-runtime": webrtcRuntime142Schema,
  "machine-c6-0-1-14-2-detector-plan": detectorPlan142Schema,
  "machine-c601142-pre-detector-freeze": detectorFreeze142Schema,
  "machine-speech-detector-score-tracks-v1": scoreTracks142Schema,
  "machine-independent-speech-presence-sweeps": sweeps142Schema,
  "machine-masked-speech-candidates-v1": masked142Schema,
  "machine-source-global-speech-inventory-v5": inventory142Schema,
};
export type AcousticFeatures142 = z.infer<typeof acousticFeatures142Schema>;
export type DialogueView142 = z.infer<typeof dialogueView142Schema>;
export type DialogueViews142 = z.infer<typeof dialogueViews142Schema>;
export type ViewAudit142 = z.infer<typeof viewAudit142Schema>;
export type DetectorRuntime142 = z.infer<typeof detectorRuntime142Schema>;
export type DetectorJob142 = z.infer<typeof detectorJob142Schema>;
export type DetectorPlan142 = z.infer<typeof detectorPlan142Schema>;
export type ScoreTrack142 = z.infer<typeof scoreTrack142Schema>;
export type ScoreTracks142 = z.infer<typeof scoreTracks142Schema>;
export type DetectorRun142 = z.infer<typeof detectorRun142Schema>;
export type Sweeps142 = z.infer<typeof sweeps142Schema>;
export type WebrtcRuntime142 = z.infer<typeof webrtcRuntime142Schema>;
export type Masked142 = z.infer<typeof masked142Schema>;
export type Inventory142 = z.infer<typeof inventory142Schema>;

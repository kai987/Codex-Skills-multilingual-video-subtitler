import { z } from "zod";

import {
  sourceFingerprintSchema,
  subtitleIntervalSchema,
} from "./finalization-schemas.js";
import { schemaVersionSchema } from "./schemas.js";

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const gitRevisionSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const relativePathSchema = z
  .string()
  .min(1)
  .regex(/^(?!\/)(?![A-Za-z]:[\\/])(?!\\\\).+/u, "Path must be relative.");
const packageVersionSchema = z
  .object({ name: z.string().min(1), version: z.string().min(1) })
  .strict();

export const ctcDeviceSchema = z.enum(["auto", "mps", "cpu"]);
export const ctcDeviceUsedSchema = z.enum(["mps", "cpu"]);
export const ctcCacheModeSchema = z.enum(["off", "read", "read-write"]);
export const ctcBoundaryModeSchema = z.enum(["off", "observe", "enforce"]);
export const ctcWindowTypeSchema = z.enum(["narrow", "expanded"]);
export const ctcPathStatusSchema = z.enum([
  "success",
  "no-valid-path",
  "target-unrepresentable",
  "frame-mapping-invalid",
  "invalid-logits",
]);
export const sourceSeparationFallbackSchema = z.enum(["off", "observe"]);

export const ctcModelFileSchema = z
  .object({
    relativePath: relativePathSchema,
    size: z.number().int().nonnegative(),
    sha256: hashSchema,
  })
  .strict();

export const ctcRuntimeManifestSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("ctc-runtime-manifest"),
    runtimeVersion: z.literal("C5.18.1"),
    generatedAt: z.iso.datetime(),
    runtimeId: z.string().min(1),
    runtimeDirectory: z.string().min(1),
    pythonExecutable: z.string().min(1),
    pythonVersion: z.string().min(1),
    packages: z.array(packageVersionSchema),
    explicitSpecPath: z.string().min(1),
    explicitSpecSha256: hashSchema,
    dependencySpecSha256: hashSchema,
    runtimeIdentityHash: hashSchema,
  })
  .strict();

const separationModelSnapshotSchema = z
  .object({
    modelRepo: z.literal("speechbrain/sepformer-whamr16k"),
    requestedRevision: gitRevisionSchema,
    resolvedRevision: gitRevisionSchema,
    snapshotDirectory: z.string().min(1),
    modelSnapshotHash: hashSchema,
    modelFiles: z.array(ctcModelFileSchema).min(1),
    license: z.string().min(1),
    domain: z.literal("WHAMR 16 kHz English mixtures"),
    targetDomainCompatibility: z.literal("cross-domain-experimental"),
  })
  .strict();

export const ctcModelManifestSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("ctc-model-manifest"),
    modelVersion: z.literal("C5.18.1"),
    generatedAt: z.iso.datetime(),
    modelRepo: z.literal("reazon-research/japanese-wav2vec2-large-rs35kh"),
    requestedRevision: gitRevisionSchema,
    resolvedRevision: gitRevisionSchema,
    snapshotDirectory: z.string().min(1),
    modelSnapshotHash: hashSchema,
    modelFiles: z.array(ctcModelFileSchema).min(1),
    architecture: z.literal("Wav2Vec2ForCTC"),
    language: z.literal("ja"),
    license: z.literal("Apache-2.0"),
    trustRemoteCode: z.literal(false),
    networkUsedDuringPreparation: z.boolean(),
    hfTokenStored: z.literal(false),
    separationModel: separationModelSnapshotSchema.nullable(),
  })
  .strict();

const ctcFrameMappingSchema = z
  .object({
    sampleRate: z.literal(16_000),
    convKernel: z.array(z.number().int().positive()).min(1),
    convStride: z.array(z.number().int().positive()).min(1),
    totalStrideSamples: z.number().int().positive(),
    receptiveFieldSamples: z.number().int().positive(),
    frameCountFormula: z.literal("iterated-valid-convolution-v1"),
    frameIntervalPolicy: z.literal("receptive-field-clipped-v1"),
  })
  .strict();

export const ctcRuntimeCapabilitySchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("ctc-runtime-capability"),
    runtimeVersion: z.literal("C5.18.1"),
    generatedAt: z.iso.datetime(),
    runtimeIdentityHash: hashSchema,
    backend: z.literal("reazon-wav2vec2-ctc"),
    runtimeLockHash: hashSchema,
    modelRepo: z.literal("reazon-research/japanese-wav2vec2-large-rs35kh"),
    modelRevision: gitRevisionSchema,
    modelSnapshotHash: hashSchema,
    modelFileCount: z.number().int().positive(),
    modelFiles: z.array(ctcModelFileSchema).min(1),
    license: z.literal("Apache-2.0"),
    citations: z.array(z.url()).min(1),
    architecture: z.literal("Wav2Vec2ForCTC"),
    processorClass: z.string().min(1),
    modelClass: z.literal("Wav2Vec2ForCTC"),
    tokenizerClass: z.string().min(1),
    tokenizerVocabularyHash: hashSchema,
    tokenizerVocabularySize: z.number().int().positive(),
    blankTokenId: z.number().int().nonnegative(),
    padTokenId: z.number().int().nonnegative(),
    unknownTokenId: z.number().int().nonnegative().nullable(),
    pythonVersion: z.string().min(1),
    torchVersion: z.string().min(1),
    transformersVersion: z.string().min(1),
    huggingfaceHubVersion: z.string().min(1),
    safetensorsVersion: z.string().min(1),
    numpyVersion: z.string().min(1),
    soundfileVersion: z.string().min(1),
    frameMapping: ctcFrameMappingSchema,
    sampleRate: z.literal(16_000),
    ctcAlignmentAlgorithm: z.literal("mvl-ctc-viterbi-v1"),
    viterbiPolicy: z.literal("mvl-ctc-viterbi-v1"),
    scoreCalibrationStatus: z.literal("uncalibrated-ctc-score"),
    torchaudioForcedAlignUsed: z.literal(false),
    deviceRequested: ctcDeviceSchema,
    deviceUsed: ctcDeviceUsedSchema,
    fallback: z
      .object({
        applied: z.boolean(),
        from: z.literal("mps").nullable(),
        to: z.literal("cpu").nullable(),
        reason: z.string().min(1).nullable(),
      })
      .strict(),
    mpsAvailable: z.boolean(),
    cpuProbePassed: z.boolean(),
    mpsProbePassed: z.boolean().nullable(),
    cpuMpsTokenPathParity: z.boolean().nullable(),
    cpuMpsMaximumBoundaryDeltaSeconds: z.number().nonnegative().nullable(),
    finiteOutputVerified: z.boolean(),
    frameCountVerified: z.boolean(),
    targetEncodable: z.boolean(),
    networkUsedDuringInference: z.literal(false),
    runtimePath: z.null(),
    modelCachePath: z.null(),
    shareable: z.literal(true),
    validationPassed: z.boolean(),
    semanticHash: hashSchema,
  })
  .strict();

const ctcNormalizationOperationSchema = z
  .object({
    operation: z.enum([
      "nfc",
      "whitespace-collapse",
      "remove-display-newline",
      "remove-nonspoken-punctuation",
    ]),
    count: z.number().int().nonnegative(),
  })
  .strict();

export const ctcTargetEncodingSchema = z
  .object({
    targetText: z.string(),
    targetTextSha256: hashSchema,
    tokenIds: z.array(z.number().int().nonnegative()),
    tokenPieces: z.array(z.string()),
    unknownTokenCount: z.number().int().nonnegative(),
    specialTokenCount: z.number().int().nonnegative(),
    targetEncodable: z.boolean(),
    blockers: z.array(z.string().min(1)),
  })
  .strict();

export const ctcAlignmentInputCueSchema = z
  .object({
    cueId: z.string().min(1),
    componentId: z.string().min(1),
    originalInterval: subtitleIntervalSchema,
    canonicalText: z.string().min(1),
    canonicalTextSha256: hashSchema,
    alignmentText: z.string().min(1),
    alignmentTextSha256: hashSchema,
    ctcTargetText: z.string(),
    ctcTargetTextSha256: hashSchema,
    normalizationOperations: z.array(ctcNormalizationOperationSchema),
    lexicalCharacterDeletionCount: z.literal(0),
    encoding: ctcTargetEncodingSchema,
    canonicalTextMutated: z.literal(false),
  })
  .strict();

export const subtitleCtcAlignmentInputSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("subtitle-ctc-alignment-input"),
    alignmentVersion: z.literal("C5.18.1"),
    generatedAt: z.iso.datetime(),
    baseCueHash: hashSchema,
    baseTimingHash: hashSchema,
    sourceAlignmentInputHash: hashSchema,
    ctcRuntimeIdentityHash: hashSchema,
    ctcModelSnapshotHash: hashSchema,
    tokenizerIdentityHash: hashSchema,
    cues: z.array(ctcAlignmentInputCueSchema).length(16),
    summary: z
      .object({
        componentCount: z.literal(7),
        cueCount: z.literal(16),
        targetEncodableCueCount: z.number().int().min(0).max(16),
        targetUnrepresentableCueCount: z.number().int().min(0).max(16),
        unknownTokenCount: z.number().int().nonnegative(),
        specialTokenCount: z.number().int().nonnegative(),
        lexicalCharacterDeletionCount: z.literal(0),
        canonicalTextMutationCount: z.literal(0),
      })
      .strict(),
    semanticHash: hashSchema,
  })
  .strict();

const ctcTokenSpanSchema = z
  .object({
    targetIndex: z.number().int().nonnegative(),
    tokenId: z.number().int().nonnegative(),
    token: z.string(),
    startFrame: z.number().int().nonnegative(),
    endFrameExclusive: z.number().int().positive(),
    startSecondsLocal: z.number().nonnegative(),
    endSecondsLocal: z.number().positive(),
    startMediaGlobal: z.number().nonnegative(),
    endMediaGlobal: z.number().positive(),
    meanPosterior: z.number().min(0).max(1),
    meanLogPosterior: z.number(),
    minLogPosterior: z.number(),
    firstFrameIntervalLocal: subtitleIntervalSchema,
    lastFrameIntervalLocal: subtitleIntervalSchema,
    representativeStartMediaGlobal: z.number().nonnegative(),
    representativeEndMediaGlobal: z.number().positive(),
  })
  .strict();

export const ctcAlignmentAttemptSchema = z
  .object({
    attemptId: z.string().min(1),
    cueId: z.string().min(1),
    componentId: z.string().min(1),
    windowType: ctcWindowTypeSchema,
    audioSha256: hashSchema,
    audioSampleRate: z.literal(16_000),
    audioFrameCount: z.number().int().positive(),
    audioDurationSeconds: z.number().positive(),
    audioLocalInterval: subtitleIntervalSchema,
    mediaGlobalInterval: subtitleIntervalSchema,
    target: ctcTargetEncodingSchema,
    targetTokenCount: z.number().int().nonnegative(),
    cacheHit: z.boolean(),
    inferenceExecuted: z.boolean(),
    modelLoadCount: z.number().int().min(0).max(1),
    pathStatus: ctcPathStatusSchema,
    pathExists: z.boolean(),
    predictedFrameCount: z.number().int().nonnegative(),
    logitsFrameCount: z.number().int().nonnegative(),
    expectedFrameCount: z.number().int().nonnegative(),
    frameCountVerified: z.boolean(),
    tokenSpans: z.array(ctcTokenSpanSchema),
    selectedBoundary: subtitleIntervalSchema.nullable(),
    startPinnedToWindowEdge: z.boolean(),
    endPinnedToWindowEdge: z.boolean(),
    meanTokenPosterior: z.number().min(0).max(1).nullable(),
    minimumTokenPosterior: z.number().min(0).max(1).nullable(),
    alignedTokenMeanLogPosterior: z.number().nullable(),
    alignedTokenMinLogPosterior: z.number().nullable(),
    pathScore: z.number().nullable(),
    normalizedPathLogScore: z.number().nullable(),
    blankFrameRatio: z.number().min(0).max(1).nullable(),
    targetSpanDurationSeconds: z.number().nonnegative().nullable(),
    targetSpanToWindowRatio: z.number().nonnegative().nullable(),
    scoreCalibrationStatus: z.literal("uncalibrated-ctc-score"),
    greedyText: z.string(),
    greedyTextMatchesTarget: z.boolean(),
    greedyNormalizedSimilarity: z.number().min(0).max(1),
    greedyEditRatio: z.number().nonnegative(),
    greedyDiagnosticOnly: z.literal(true),
    workerRequestVerified: z.literal(true),
    viterbiPolicy: z.literal("mvl-ctc-viterbi-v1"),
    frameMapping: ctcFrameMappingSchema,
    deviceRequested: ctcDeviceSchema,
    deviceUsed: ctcDeviceUsedSchema,
    wallClockSeconds: z.number().nonnegative(),
    warnings: z.array(z.string().min(1)),
    blockers: z.array(z.string().min(1)),
  })
  .strict();

export const ctcAlignmentCacheIdentitySchema = z
  .object({
    requestType: z.literal("local-ctc-boundary-alignment"),
    audioSha256: hashSchema,
    audioFrameInterval: z
      .object({
        startFrame: z.number().int().nonnegative(),
        endFrameExclusive: z.number().int().positive(),
      })
      .strict(),
    targetTextSha256: hashSchema,
    targetTokenIdsSha256: hashSchema,
    windowType: ctcWindowTypeSchema,
    audioLocalInterval: subtitleIntervalSchema,
    mediaGlobalInterval: subtitleIntervalSchema,
    sampleRate: z.literal(16_000),
    runtimeIdentityHash: hashSchema,
    modelRepo: z.literal("reazon-research/japanese-wav2vec2-large-rs35kh"),
    modelRevision: gitRevisionSchema,
    modelSnapshotHash: hashSchema,
    tokenizerIdentityHash: hashSchema,
    device: ctcDeviceSchema,
    alignmentPolicyVersion: z.literal("c5.18.1-local-ctc-boundary-v1"),
    normalizationPolicyVersion: z.literal(
      "c5.18.1-ctc-target-normalization-v1",
    ),
    viterbiPolicy: z.literal("mvl-ctc-viterbi-v1"),
    frameMappingPolicy: z.literal("wav2vec2-conv-receptive-field-v1"),
  })
  .strict();

export const ctcAlignmentCacheEntrySchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("ctc-alignment-cache-entry"),
    cacheVersion: z.literal("C5.18.1"),
    createdAt: z.iso.datetime(),
    cacheKey: hashSchema,
    identity: ctcAlignmentCacheIdentitySchema,
    result: ctcAlignmentAttemptSchema,
    semanticHash: hashSchema,
  })
  .strict();

export const ctcAlignmentCacheManifestSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("ctc-alignment-cache-manifest"),
    cacheVersion: z.literal("C5.18.1"),
    generatedAt: z.iso.datetime(),
    mode: ctcCacheModeSchema,
    cacheRootShareableName: z.string().min(1),
    requests: z.array(
      z
        .object({
          attemptId: z.string().min(1),
          cueId: z.string().min(1),
          componentId: z.string().min(1),
          windowType: ctcWindowTypeSchema,
          cacheKey: hashSchema,
          cacheHit: z.boolean(),
          audioSha256: hashSchema,
          entrySemanticHash: hashSchema,
        })
        .strict(),
    ),
    summary: z
      .object({
        requestCount: z.number().int().nonnegative(),
        hitCount: z.number().int().nonnegative(),
        missCount: z.number().int().nonnegative(),
        writeCount: z.number().int().nonnegative(),
        inferenceCount: z.number().int().nonnegative(),
        modelLoadCount: z.number().int().nonnegative(),
      })
      .strict(),
    cacheIdentityHash: hashSchema,
    semanticHash: hashSchema,
  })
  .strict();

const boundaryComparisonSchema = z
  .object({
    boundary: z.enum(["start", "end"]),
    ctcTime: z.number().nonnegative().nullable(),
    mfaTime: z.number().nonnegative().nullable(),
    mappedTokenTime: z.number().nonnegative().nullable(),
    evidenceDpTime: z.number().nonnegative().nullable(),
    rawVadTime: z.number().nonnegative().nullable(),
    speakerTime: z.number().nonnegative().nullable(),
    independentLexicalEvidenceIds: z.array(z.string().min(1)),
    ctcEvidenceIds: z.array(z.string().min(1)),
    speakerEvidenceIds: z.array(z.string().min(1)),
    independentLexicalAgreement: z.boolean(),
    speakerContradiction: z.boolean(),
  })
  .strict();

const ctcCueBoundaryDecisionSchema = z
  .object({
    cueId: z.string().min(1),
    componentId: z.string().min(1),
    canonicalText: z.string().min(1),
    alignmentText: z.string().min(1),
    originalInterval: subtitleIntervalSchema,
    narrowAttemptId: z.string().min(1),
    expandedAttemptId: z.string().min(1),
    narrowBoundary: subtitleIntervalSchema.nullable(),
    expandedBoundary: subtitleIntervalSchema.nullable(),
    selectedBoundary: subtitleIntervalSchema.nullable(),
    startWindowDeltaSeconds: z.number().nonnegative().nullable(),
    endWindowDeltaSeconds: z.number().nonnegative().nullable(),
    startStable: z.boolean(),
    endStable: z.boolean(),
    windowStable: z.boolean(),
    edgePinned: z.boolean(),
    duplicateOccurrenceConflict: z.boolean(),
    startComparison: boundaryComparisonSchema,
    endComparison: boundaryComparisonSchema,
    timingActionable: z.boolean(),
    proposedInterval: subtitleIntervalSchema.nullable(),
    mutationApplied: z.boolean(),
    blockers: z.array(z.string().min(1)),
    textChanged: z.literal(false),
    semanticHash: hashSchema,
  })
  .strict();

const ctcJointAssignmentSchema = z
  .object({
    componentId: z.string().min(1),
    cueIds: z.array(z.string().min(1)).min(2),
    candidatePermutationCount: z.number().int().positive(),
    selectedAssignmentId: z.string().min(1).nullable(),
    selectedCueOrder: z.array(z.string().min(1)),
    monotonic: z.boolean(),
    duplicateOccurrenceConflictCount: z.number().int().nonnegative(),
    illegalOverlapCount: z.number().int().nonnegative(),
    legalExistingOverlapPreserved: z.boolean(),
    lineageDedupeCount: z.number().int().nonnegative(),
    resolved: z.boolean(),
    blockers: z.array(z.string().min(1)),
    semanticHash: hashSchema,
  })
  .strict();

const ctcTimingMutationSchema = z
  .object({
    componentId: z.string().min(1),
    cueId: z.string().min(1),
    oldStart: z.number().nonnegative(),
    oldEnd: z.number().positive(),
    newStart: z.number().nonnegative(),
    newEnd: z.number().positive(),
    startEvidenceIds: z.array(z.string().min(1)).min(1),
    endEvidenceIds: z.array(z.string().min(1)).min(1),
    ctcEvidenceIds: z.array(z.string().min(1)).min(1),
    independentLexicalEvidenceIds: z.array(z.string().min(1)).min(1),
    speakerEvidenceIds: z.array(z.string().min(1)),
    deltaStart: z.number(),
    deltaEnd: z.number(),
    atomicComponentDecisionId: z.string().min(1),
    textChanged: z.literal(false),
  })
  .strict();

const ctcBoundaryComponentSchema = z
  .object({
    componentId: z.string().min(1),
    cueIds: z.array(z.string().min(1)).min(2),
    componentUnion: subtitleIntervalSchema,
    cueDecisions: z.array(ctcCueBoundaryDecisionSchema).min(2),
    jointAssignment: ctcJointAssignmentSchema,
    directCtcResolved: z.boolean(),
    timingActionable: z.boolean(),
    timingMutationApplied: z.boolean(),
    subtitleOverlapResolved: z.boolean(),
    speakerRelationshipResolved: z.boolean(),
    atomicRollbackApplied: z.boolean(),
    mutations: z.array(ctcTimingMutationSchema),
    blockers: z.array(z.string().min(1)),
    semanticHash: hashSchema,
  })
  .strict();

export const subtitleLocalCtcBoundaryEvidenceSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("subtitle-local-ctc-boundary-evidence"),
    evidenceVersion: z.literal("C5.18.1"),
    generatedAt: z.iso.datetime(),
    sourceFingerprint: sourceFingerprintSchema,
    baseCueHash: hashSchema,
    baseTimingHash: hashSchema,
    ctcAlignmentInputRef: relativePathSchema,
    ctcRuntimeCapabilityRef: relativePathSchema,
    ctcPolicyVersion: z.literal("c5.18.1-local-ctc-boundary-v1"),
    configuration: z
      .object({
        mode: ctcBoundaryModeSchema,
        deviceRequested: ctcDeviceSchema,
        deviceUsed: ctcDeviceUsedSchema,
        windowMode: z.literal("dual"),
        narrowContextSeconds: z.literal(0.5),
        maximumWindowBoundaryDeltaSeconds: z.literal(0.12),
        maximumTimingMutationSeconds: z.literal(0.5),
        minimumCueDurationSeconds: z.literal(0.4),
        jointAssignmentPolicy: z.literal("component-monotonic-atomic-v1"),
        independentBoundaryPolicy: z.literal(
          "side-specific-lexical-consensus-v1",
        ),
        scoreCalibrationStatus: z.literal("uncalibrated-ctc-score"),
      })
      .strict(),
    attempts: z.array(ctcAlignmentAttemptSchema).length(32),
    cues: z.array(ctcCueBoundaryDecisionSchema).length(16),
    components: z.array(ctcBoundaryComponentSchema).length(7),
    mutations: z.array(ctcTimingMutationSchema),
    summary: z
      .object({
        targetComponentCount: z.literal(7),
        targetCueCount: z.literal(16),
        targetEncodableCueCount: z.number().int().min(0).max(16),
        directAttemptCount: z.literal(32),
        directInferenceCount: z.number().int().min(0).max(32),
        directCacheHitCount: z.number().int().min(0).max(32),
        modelLoadCount: z.number().int().min(0).max(1),
        pathSuccessCount: z.number().int().min(0).max(32),
        windowStableCueCount: z.number().int().min(0).max(16),
        edgePinnedCueCount: z.number().int().min(0).max(16),
        duplicateOccurrenceConflictCount: z.number().int().nonnegative(),
        jointAssignmentResolvedComponentCount: z.number().int().min(0).max(7),
        timingActionableCueCount: z.number().int().min(0).max(16),
        timingActionableComponentCount: z.number().int().min(0).max(7),
        timingMutationCueCount: z.number().int().min(0).max(16),
        timingMutationComponentCount: z.number().int().min(0).max(7),
        resolvedSubtitleOverlapComponentCount: z.number().int().min(0).max(7),
        greedyTextMutationCount: z.literal(0),
        tokenRatioRepairCount: z.literal(0),
        forbiddenTimingHeuristicUseCount: z.literal(0),
        canonicalTextMutationCount: z.literal(0),
      })
      .strict(),
    jointAssignmentHash: hashSchema,
    componentDecisionHash: hashSchema,
    mutationHash: hashSchema,
    semanticHash: hashSchema,
  })
  .strict();

const separatedStreamSchema = z
  .object({
    streamId: z.enum(["stream-a", "stream-b"]),
    label: z.enum(["Candidate Stream A", "Candidate Stream B"]),
    audioSha256: hashSchema,
    durationSeconds: z.number().positive(),
    rmsDbfs: z.number().nullable(),
    nonSilentDurationSeconds: z.number().nonnegative(),
    finiteSampleCheck: z.boolean(),
    lengthParity: z.boolean(),
    correlationWithMixture: z.number().min(-1).max(1).nullable(),
    zeroStream: z.boolean(),
    highCorrelation: z.boolean(),
    lengthMismatch: z.boolean(),
    ctcAttemptIds: z.array(z.string().min(1)),
  })
  .strict();

export const subtitleLocalSeparatedStreamEvidenceSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("subtitle-local-separated-stream-evidence"),
    evidenceVersion: z.literal("C5.18.1"),
    generatedAt: z.iso.datetime(),
    mode: sourceSeparationFallbackSchema,
    separationRuntimeIdentityHash: hashSchema.nullable(),
    separationModelRepo: z.literal("speechbrain/sepformer-whamr16k"),
    separationModelRevision: gitRevisionSchema,
    separationModelSnapshotHash: hashSchema.nullable(),
    trainingLanguage: z.literal("English"),
    targetLanguage: z.literal("Japanese"),
    domainMatched: z.literal(false),
    crossDomainUse: z.literal("experimental-observe-only"),
    crossDomainWarning: z.literal(
      "English WHAMR separation is experimental observe-only evidence for Japanese dialogue.",
    ),
    timingActionable: z.literal(false),
    components: z.array(
      z
        .object({
          componentId: z.string().min(1),
          cueIds: z.array(z.string().min(1)).min(2),
          triggered: z.boolean(),
          triggerReasons: z.array(z.string().min(1)),
          separationCacheHit: z.boolean(),
          separationInferenceExecuted: z.boolean(),
          streams: z.array(separatedStreamSchema).max(2),
          streamCorrelation: z.number().min(-1).max(1).nullable(),
          mixtureReconstructionError: z.number().nonnegative().nullable(),
          qualityStatus: z.enum([
            "not-triggered",
            "usable-observe-only",
            "unreliable",
          ]),
          bestStreamByCue: z.record(z.string(), z.string().nullable()),
          scoreMarginByCue: z.record(z.string(), z.number().nullable()),
          qualityBlockers: z.array(z.string().min(1)),
          semanticHash: hashSchema,
        })
        .strict(),
    ),
    summary: z
      .object({
        targetComponentCount: z.literal(7),
        triggeredComponentCount: z.number().int().min(0).max(4),
        separationRequestCount: z.number().int().min(0).max(4),
        separationInferenceCount: z.number().int().min(0).max(4),
        separationCacheHitCount: z.number().int().min(0).max(4),
        separationModelLoadCount: z.number().int().min(0).max(1),
        separatedStreamCtcAttemptCount: z.number().int().min(0).max(20),
        separatedStreamCtcInferenceCount: z.number().int().min(0).max(20),
        separatedStreamCtcCacheHitCount: z.number().int().min(0).max(20),
        timingMutationCount: z.literal(0),
        textMutationCount: z.literal(0),
      })
      .strict(),
    semanticHash: hashSchema,
  })
  .strict();

const runHashSetSchema = z
  .object({
    ctcAlignmentInputSemanticHash: hashSchema,
    ctcEvidenceSemanticHash: hashSchema,
    jointAssignmentHash: hashSchema,
    sourceSeparationEvidenceHash: hashSchema,
    componentDecisionHash: hashSchema,
    mutationHash: hashSchema,
    outputCueHash: hashSchema,
    timingHash: hashSchema,
    presentationHash: hashSchema,
  })
  .strict();

export const c5181CtcBoundaryReplaySummarySchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("c5-18-1-ctc-boundary-replay-summary"),
    replayVersion: z.literal("C5.18.1"),
    generatedAt: z.iso.datetime(),
    runId: z.string().min(1),
    sourceTaskName: z.string().min(1),
    outputTaskName: z.string().min(1),
    mode: ctcBoundaryModeSchema,
    cacheMode: ctcCacheModeSchema,
    sourceSeparationMode: sourceSeparationFallbackSchema,
    runtimeIdentityHash: hashSchema,
    modelSnapshotHash: hashSchema,
    deviceRequested: ctcDeviceSchema,
    deviceUsed: ctcDeviceUsedSchema,
    counts: z
      .object({
        targetComponentCount: z.literal(7),
        targetCueCount: z.literal(16),
        directCtcRequestCount: z.literal(32),
        directCtcInferenceCount: z.number().int().min(0).max(32),
        directCtcCacheHitCount: z.number().int().min(0).max(32),
        ctcModelLoadCount: z.number().int().min(0).max(1),
        wholeMediaCtcInferenceCount: z.literal(0),
        speakerInferenceCount: z.literal(0),
        mfaProcessCount: z.literal(0),
        whisperRequestCount: z.literal(0),
        wholeMediaAsrRequestCount: z.literal(0),
        openAiRequestCount: z.literal(0),
        onlineSubtitleSearchCount: z.literal(0),
        separationInferenceCount: z.number().int().min(0).max(4),
        separationCacheHitCount: z.number().int().min(0).max(4),
        separationModelLoadCount: z.number().int().min(0).max(1),
        separatedStreamCtcAttemptCount: z.number().int().min(0).max(20),
        separatedStreamCtcInferenceCount: z.number().int().min(0).max(20),
        separatedStreamCtcCacheHitCount: z.number().int().min(0).max(20),
        canonicalTextMutationCount: z.literal(0),
        canonicalTimingMutationCount: z.number().int().min(0).max(16),
        greedyTextMutationCount: z.literal(0),
        tokenRatioRepairCount: z.literal(0),
        forbiddenTimingHeuristicUseCount: z.literal(0),
        speakerRelationshipResolvedComponentCount: z.literal(1),
        subtitleOverlapResolvedComponentCount: z.number().int().min(0).max(7),
        remainingReviewComponentCount: z.number().int().min(0).max(7),
      })
      .strict(),
    hashes: runHashSetSchema,
    runtimeCapabilityPath: relativePathSchema,
    alignmentInputPath: relativePathSchema,
    boundaryEvidencePath: relativePathSchema,
    cacheManifestPath: relativePathSchema,
    separatedStreamEvidencePath: relativePathSchema,
    reviewDeliveryIntegrityPassed: z.boolean(),
    shareableAuditPassed: z.boolean(),
    networkUsedDuringInference: z.literal(false),
    sourceReadOnlyVerified: z.boolean(),
    humanSubtitleReadOnlyVerified: z.boolean(),
    finalStatus: z.enum(["finalized", "needs-review"]),
    finalizationMethod: z.enum(["automatic", "none"]),
    semanticHash: hashSchema,
  })
  .strict();

export const c5181FreshCacheObserveValidationSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("c5-18-1-fresh-cache-observe-validation"),
    validationVersion: z.literal("C5.18.1"),
    generatedAt: z.iso.datetime(),
    freshTaskName: z.string().min(1),
    observeTaskName: z.string().min(1),
    cacheReplayTaskName: z.string().min(1),
    fresh: c5181CtcBoundaryReplaySummarySchema,
    observe: c5181CtcBoundaryReplaySummarySchema,
    cacheReplay: c5181CtcBoundaryReplaySummarySchema,
    parity: z
      .object({
        ctcAlignmentInputSemanticHash: z.boolean(),
        ctcEvidenceSemanticHash: z.boolean(),
        jointAssignmentHash: z.boolean(),
        sourceSeparationEvidenceHash: z.boolean(),
        componentDecisionHash: z.boolean(),
        mutationHash: z.boolean(),
        outputCueHash: z.boolean(),
        allPassed: z.boolean(),
      })
      .strict(),
    observeMutationCount: z.literal(0),
    cacheReplayInferenceCount: z.literal(0),
    cacheReplayModelLoadCount: z.literal(0),
    validationPassed: z.boolean(),
    semanticHash: hashSchema,
  })
  .strict();

export type CtcDevice = z.infer<typeof ctcDeviceSchema>;
export type CtcDeviceUsed = z.infer<typeof ctcDeviceUsedSchema>;
export type CtcCacheMode = z.infer<typeof ctcCacheModeSchema>;
export type CtcBoundaryMode = z.infer<typeof ctcBoundaryModeSchema>;
export type CtcRuntimeManifest = z.infer<typeof ctcRuntimeManifestSchema>;
export type CtcModelManifest = z.infer<typeof ctcModelManifestSchema>;
export type CtcRuntimeCapability = z.infer<typeof ctcRuntimeCapabilitySchema>;
export type CtcTargetEncoding = z.infer<typeof ctcTargetEncodingSchema>;
export type CtcAlignmentAttempt = z.infer<typeof ctcAlignmentAttemptSchema>;
export type CtcAlignmentCacheIdentity = z.infer<
  typeof ctcAlignmentCacheIdentitySchema
>;
export type CtcAlignmentCacheEntry = z.infer<
  typeof ctcAlignmentCacheEntrySchema
>;
export type CtcAlignmentCacheManifest = z.infer<
  typeof ctcAlignmentCacheManifestSchema
>;
export type SubtitleCtcAlignmentInput = z.infer<
  typeof subtitleCtcAlignmentInputSchema
>;
export type SubtitleLocalCtcBoundaryEvidence = z.infer<
  typeof subtitleLocalCtcBoundaryEvidenceSchema
>;
export type SubtitleLocalSeparatedStreamEvidence = z.infer<
  typeof subtitleLocalSeparatedStreamEvidenceSchema
>;
export type C5181CtcBoundaryReplaySummary = z.infer<
  typeof c5181CtcBoundaryReplaySummarySchema
>;
export type C5181FreshCacheObserveValidation = z.infer<
  typeof c5181FreshCacheObserveValidationSchema
>;

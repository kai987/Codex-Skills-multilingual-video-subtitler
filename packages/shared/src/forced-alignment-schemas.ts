import { z } from "zod";

import {
  sourceFingerprintSchema,
  subtitleIntervalSchema,
} from "./finalization-schemas.js";
import { schemaVersionSchema } from "./schemas.js";

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const relativePathSchema = z
  .string()
  .min(1)
  .regex(/^(?!\/)(?![A-Za-z]:[\\/]).+/u, "Path must be relative.");

export const forcedAlignmentModeSchema = z.enum(["off", "observe", "enforce"]);
export const forcedAlignmentBackendSchema = z.enum([
  "evidence-dp",
  "mfa-japanese",
  "hybrid",
]);
export const forcedAlignmentWindowTypeSchema = z.enum(["narrow", "expanded"]);
export const forcedAlignmentCoordinateSystemSchema = z.enum([
  "attempt-audio-local",
  "component-audio-local",
  "original-media-global",
]);

export const forcedAlignmentIntervalSchema = z
  .object({
    start: z.number().nonnegative(),
    end: z.number().nonnegative(),
    coordinateSystem: forcedAlignmentCoordinateSystemSchema,
  })
  .strict()
  .refine((value) => value.end > value.start, {
    message: "Interval end must be greater than start.",
  });

export const canonicalMorphemeSchema = z
  .object({
    surface: z.string().min(1),
    normalizedSurface: z.string().min(1),
    dictionaryForm: z.string().min(1),
    reading: z.string().min(1).nullable(),
    partOfSpeech: z.array(z.string()).min(1),
    isOov: z.boolean(),
    startCharacter: z.number().int().nonnegative(),
    endCharacter: z.number().int().positive(),
    readingSource: z.enum([
      "verified-terminology",
      "sudachi-dictionary",
      "official-mfa-g2p",
      "kana-literal",
      "unresolved",
    ]),
    dialectSurface: z.string().min(1).nullable(),
  })
  .strict()
  .refine((value) => value.endCharacter > value.startCharacter, {
    message: "Morpheme endCharacter must be greater than startCharacter.",
  });

export const canonicalAlignmentWordUnitSchema = z
  .object({
    unitId: z.string().min(1),
    surface: z.string().min(1),
    normalizedSurface: z.string().min(1),
    reading: z.string().min(1).nullable(),
    readingSource: z.enum([
      "verified-terminology",
      "sudachi-dictionary",
      "official-mfa-g2p",
      "kana-literal",
      "unresolved",
    ]),
    morphemeIndexes: z.array(z.number().int().nonnegative()).min(1),
    punctuation: z.boolean(),
    criticalOov: z.boolean(),
  })
  .strict();

export const canonicalAlignmentCueInputSchema = z
  .object({
    cueId: z.string().min(1),
    componentId: z.string().min(1),
    originalInterval: subtitleIntervalSchema,
    canonicalText: z.string().min(1),
    canonicalTextSha256: hashSchema,
    alignmentText: z.string().min(1),
    alignmentTextSha256: hashSchema,
    displayNewlinesRemoved: z.number().int().nonnegative(),
    styleMarkersRemoved: z.number().int().nonnegative(),
    punctuationHandling: z.literal("separated-not-deleted-from-canonical"),
    morphemes: z.array(canonicalMorphemeSchema),
    wordUnits: z.array(canonicalAlignmentWordUnitSchema),
    normalizedReading: z.string().min(1).nullable(),
    readingAvailable: z.boolean(),
    readingCoverageRatio: z.number().min(0).max(1),
    unresolvedOov: z.array(z.string().min(1)),
    verifiedTerminologyMatches: z.array(
      z
        .object({
          surface: z.string().min(1),
          reading: z.string().min(1),
          evidenceId: z.string().min(1),
        })
        .strict(),
    ),
    alignmentEligibility: z.boolean(),
    blockers: z.array(z.string().min(1)),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.canonicalTextSha256 === value.alignmentTextSha256) return;
    if (value.canonicalText === value.alignmentText) {
      context.addIssue({
        code: "custom",
        path: ["alignmentTextSha256"],
        message:
          "Identical canonical and alignment text must have identical hashes.",
      });
    }
  });

export const subtitleCanonicalAlignmentInputSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("subtitle-canonical-alignment-input"),
    alignmentVersion: z.literal("C5.17"),
    generatedAt: z.iso.datetime(),
    baseCueHash: hashSchema,
    baseTimingHash: hashSchema,
    configuration: z
      .object({
        unicodeNormalization: z.literal("NFKC"),
        displayNewlines: z.literal("remove-from-alignment-only"),
        styleMarkers: z.literal("remove-from-alignment-only"),
        punctuation: z.literal("separate-for-alignment"),
        dialectPolicy: z.literal("preserve-surface"),
        oovPolicy: z.literal(
          "terminology-then-sudachi-then-official-g2p-then-kana-else-unresolved",
        ),
      })
      .strict(),
    cues: z.array(canonicalAlignmentCueInputSchema),
    summary: z
      .object({
        componentCount: z.number().int().nonnegative(),
        cueCount: z.number().int().nonnegative(),
        eligibleCueCount: z.number().int().nonnegative(),
        ineligibleCueCount: z.number().int().nonnegative(),
        unresolvedOovCount: z.number().int().nonnegative(),
        canonicalTextMutationCount: z.literal(0),
      })
      .strict(),
  })
  .strict();

export const forcedAlignmentModelIdentitySchema = z
  .object({
    modelType: z.enum(["acoustic", "dictionary", "g2p"]),
    name: z.string().min(1),
    version: z.string().min(1),
    fileBasename: z.string().min(1),
    size: z.number().int().nonnegative(),
    sha256: hashSchema,
    license: z.string().min(1),
    citation: z.string().min(1),
    metadataSha256: hashSchema,
    officialSource: z.literal("MontrealCorpusTools"),
  })
  .strict();

export const forcedAlignmentRuntimeCapabilitySchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("forced-alignment-runtime-capability"),
    runtimeVersion: z.literal("C5.17"),
    generatedAt: z.iso.datetime(),
    backend: z.literal("mfa-japanese"),
    mfaVersion: z.literal("3.4.2"),
    pythonVersion: z.string().min(1),
    kalpyVersion: z.string().min(1),
    kaldiVersion: z.string().min(1),
    pyniniVersion: z.string().min(1),
    sudachiVersion: z.string().min(1),
    praatioVersion: z.string().min(1),
    commandCapabilities: z
      .object({
        alignOneCommand: z.enum(["align_one", "align_one_legacy"]),
        outputFormats: z.array(z.enum(["json", "long_textgrid"])).min(1),
        selectedOutputFormat: z.enum(["json", "long_textgrid"]),
        jsonHasWordTier: z.boolean(),
        jsonHasPhoneTier: z.boolean(),
        g2pSupported: z.boolean(),
        originalTextSupported: z.boolean(),
        tokenizationMode: z.enum(["sudachi", "mfa-default-japanese"]),
        speakerAdaptationSkipped: z.literal(true),
      })
      .strict(),
    acousticModel: forcedAlignmentModelIdentitySchema,
    dictionaryModel: forcedAlignmentModelIdentitySchema,
    g2pModel: forcedAlignmentModelIdentitySchema,
    environmentExplicitSpecSha256: hashSchema,
    runtimeIdentityHash: hashSchema,
    platform: z.string().min(1),
    architecture: z.string().min(1),
    networkUsedDuringPreparation: z.boolean(),
    networkUsedDuringAlignment: z.literal(false),
    shareable: z.literal(true),
  })
  .strict();

export const forcedAlignmentWordIntervalSchema = z
  .object({
    alignmentId: z.string().min(1),
    label: z.string(),
    expectedUnitIds: z.array(z.string().min(1)),
    rawInterval: forcedAlignmentIntervalSchema,
    mappedInterval: forcedAlignmentIntervalSchema,
    oov: z.boolean(),
  })
  .strict();

export const forcedAlignmentPhoneIntervalSchema = z
  .object({
    alignmentId: z.string().min(1),
    label: z.string(),
    wordAlignmentId: z.string().min(1).nullable(),
    rawInterval: forcedAlignmentIntervalSchema,
    mappedInterval: forcedAlignmentIntervalSchema,
  })
  .strict();

export const forcedAlignmentAttemptSchema = z
  .object({
    attemptId: z.string().min(1),
    requestType: z.literal("canonical-forced-alignment"),
    componentId: z.string().min(1),
    cueId: z.string().min(1),
    windowType: forcedAlignmentWindowTypeSchema,
    windowLocalInterval: forcedAlignmentIntervalSchema,
    windowMediaInterval: forcedAlignmentIntervalSchema,
    audioSha256: hashSchema,
    audioDurationSeconds: z.number().positive(),
    canonicalTextSha256: hashSchema,
    alignmentTextSha256: hashSchema,
    readingManifestSha256: hashSchema,
    runtimeIdentityHash: hashSchema,
    acousticModelHash: hashSchema,
    dictionaryModelHash: hashSchema,
    g2pModelHash: hashSchema,
    commandMode: z.enum(["align_one", "align_one_legacy", "mock"]),
    outputFormat: z.enum(["json", "long_textgrid", "mock-json"]),
    parserVersion: z.string().min(1),
    cacheHit: z.boolean(),
    exitCode: z.number().int(),
    wallClockSeconds: z.number().nonnegative(),
    wordAlignments: z.array(forcedAlignmentWordIntervalSchema),
    phoneAlignments: z.array(forcedAlignmentPhoneIntervalSchema),
    silenceIntervals: z.array(forcedAlignmentIntervalSchema),
    utteranceInterval: forcedAlignmentIntervalSchema.nullable(),
    alignedWordCount: z.number().int().nonnegative(),
    expectedWordCount: z.number().int().nonnegative(),
    alignedPhoneCount: z.number().int().nonnegative(),
    oovCount: z.number().int().nonnegative(),
    wordCoverageRatio: z.number().min(0).max(1),
    readingCoverageRatio: z.number().min(0).max(1),
    phoneCoverageRatio: z.number().min(0).max(1),
    boundaryStart: z.number().nonnegative().nullable(),
    boundaryEnd: z.number().nonnegative().nullable(),
    startPinnedToWindowEdge: z.boolean(),
    endPinnedToWindowEdge: z.boolean(),
    alignmentSucceeded: z.boolean(),
    failure: z.string().min(1).nullable(),
    warnings: z.array(z.string().min(1)),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.alignmentSucceeded &&
      (value.boundaryStart === null ||
        value.boundaryEnd === null ||
        value.boundaryEnd <= value.boundaryStart)
    ) {
      context.addIssue({
        code: "custom",
        path: ["alignmentSucceeded"],
        message:
          "A successful alignment requires increasing global boundaries.",
      });
    }
  });

export const evidenceDpUnitSchema = z
  .object({
    evidenceId: z.string().min(1),
    text: z.string(),
    reading: z.string().min(1).nullable(),
    interval: forcedAlignmentIntervalSchema.nullable(),
    source: z.enum([
      "trusted-mapped-token",
      "raw-vad",
      "decoded-segment",
      "source-cue-prior",
      "pause",
    ]),
    timingUsable: z.boolean(),
  })
  .strict();

export const evidenceDpResultSchema = z
  .object({
    cueId: z.string().min(1),
    matchedCanonicalUnits: z.array(
      z
        .object({
          unitId: z.string().min(1),
          evidenceIds: z.array(z.string().min(1)).min(1),
          surfaceScore: z.number().min(0).max(1),
          readingScore: z.number().min(0).max(1),
        })
        .strict(),
    ),
    unmatchedCanonicalUnits: z.array(z.string().min(1)),
    matchedEvidenceUnits: z.array(z.string().min(1)),
    unusedEvidenceUnits: z.array(z.string().min(1)),
    pathScore: z.number().min(0).max(1),
    lexicalScore: z.number().min(0).max(1),
    readingScore: z.number().min(0).max(1),
    temporalScore: z.number().min(0).max(1),
    coverageRatio: z.number().min(0).max(1),
    startBoundary: z.number().nonnegative().nullable(),
    endBoundary: z.number().nonnegative().nullable(),
    boundaryEvidenceIds: z.array(z.string().min(1)),
    blockers: z.array(z.string().min(1)),
    fabricatedBoundaryCount: z.literal(0),
  })
  .strict();

export const antiForcingMetricsSchema = z
  .object({
    wordCoverageRatio: z.number().min(0).max(1),
    phoneCoverageRatio: z.number().min(0).max(1),
    readingCoverageRatio: z.number().min(0).max(1),
    oovRatio: z.number().min(0).max(1),
    windowBoundaryPinningScore: z.number().min(0).max(1),
    windowStabilityScore: z.number().min(0).max(1),
    phoneDurationPlausibility: z.number().min(0).max(1),
    silenceIntrusionRatio: z.number().min(0).max(1),
    mappedWhisperAgreement: z.number().min(0).max(1),
    rawVadBoundaryAgreement: z.number().min(0).max(1),
    decodedSegmentAgreement: z.number().min(0).max(1),
    evidenceDpAgreement: z.number().min(0).max(1),
    sourceCuePriorAgreement: z.number().min(0).max(1),
    neighborCueIntrusionRatio: z.number().min(0).max(1),
    duplicateOccurrenceOverlapRatio: z.number().min(0).max(1),
  })
  .strict();

export const forcedAlignmentCueDecisionSchema = z
  .object({
    cueId: z.string().min(1),
    canonicalText: z.string().min(1),
    alignmentText: z.string().min(1),
    normalizedReading: z.string().min(1).nullable(),
    unresolvedOov: z.array(z.string().min(1)),
    narrowAttemptId: z.string().min(1).nullable(),
    expandedAttemptId: z.string().min(1).nullable(),
    evidenceDp: evidenceDpResultSchema,
    selectedBoundary: subtitleIntervalSchema.nullable(),
    acousticOccurrenceId: z.string().min(1).nullable(),
    antiForcingMetrics: antiForcingMetricsSchema,
    antiForcingPassed: z.boolean(),
    blockers: z.array(z.string().min(1)),
    boundaryEvidenceIds: z.array(z.string().min(1)),
    boundarySources: z.array(
      z.enum([
        "mfa-narrow",
        "mfa-expanded",
        "evidence-dp",
        "mapped-token",
        "raw-vad",
        "decoded-segment",
        "source-cue-prior",
        "pause",
      ]),
    ),
    textChanged: z.literal(false),
  })
  .strict();

export const forcedAlignmentHypothesisSchema = z
  .object({
    relationship: z.enum([
      "ordered-no-overlap",
      "rapid-turn-taking",
      "nested-background-foreground",
      "same-occurrence-alternative",
      "partial-alignment",
      "unresolved",
    ]),
    score: z.number().min(0).max(1),
    selectedAttemptIds: z.array(z.string().min(1)),
    occurrenceIds: z.array(z.string().min(1)),
    blockers: z.array(z.string().min(1)),
    speakerEvidenceRequired: z.boolean(),
    speakerEvidenceAvailable: z.boolean(),
  })
  .strict();

export const forcedAlignmentTimingMutationSchema = z
  .object({
    mutationId: z.string().min(1),
    componentId: z.string().min(1),
    cueId: z.string().min(1),
    beforeStart: z.number().nonnegative(),
    beforeEnd: z.number().positive(),
    afterStart: z.number().nonnegative(),
    afterEnd: z.number().positive(),
    startDelta: z.number(),
    endDelta: z.number(),
    boundarySources: z.array(z.string().min(1)).min(2),
    mfaEvidenceIds: z.array(z.string().min(1)).min(1),
    mappedTokenEvidenceIds: z.array(z.string().min(1)),
    rawVadEvidenceIds: z.array(z.string().min(1)),
    textChanged: z.literal(false),
    method: z.literal("evidence-backed-forced-alignment-boundaries"),
  })
  .strict()
  .refine((value) => value.afterEnd > value.afterStart, {
    message: "Mutation must preserve a positive cue interval.",
  });

export const forcedAlignmentComponentSchema = z
  .object({
    componentId: z.string().min(1),
    cueIds: z.array(z.string().min(1)).min(2),
    componentInterval: subtitleIntervalSchema,
    cueAlignments: z.array(forcedAlignmentCueDecisionSchema).min(2),
    counterfactualHypotheses: z.array(forcedAlignmentHypothesisSchema).min(1),
    bestHypothesis: forcedAlignmentHypothesisSchema,
    runnerUpHypothesis: forcedAlignmentHypothesisSchema,
    bestHypothesisScore: z.number().min(0).max(1),
    runnerUpHypothesisScore: z.number().min(0).max(1),
    decisionMargin: z.number().min(0).max(1),
    scoreCalibrationStatus: z.literal("uncalibrated-heuristic"),
    duplicateOccurrenceConflicts: z.array(
      z
        .object({
          leftCueId: z.string().min(1),
          rightCueId: z.string().min(1),
          acousticOccurrenceId: z.string().min(1),
          intervalOverlapRatio: z.number().min(0).max(1),
          wordOverlapRatio: z.number().min(0).max(1),
          phoneOverlapRatio: z.number().min(0).max(1),
        })
        .strict(),
    ),
    proposedMutations: z.array(forcedAlignmentTimingMutationSchema),
    appliedMutations: z.array(forcedAlignmentTimingMutationSchema),
    atomicApplicationPassed: z.boolean(),
    resolved: z.boolean(),
    blocking: z.boolean(),
    blockers: z.array(z.string().min(1)),
    reviewRequired: z.boolean(),
  })
  .strict();

export const forcedAlignmentConfigurationSchema = z
  .object({
    mode: forcedAlignmentModeSchema,
    backend: forcedAlignmentBackendSchema,
    narrowContextSeconds: z.number().nonnegative().max(1),
    expandedContextSeconds: z.number().nonnegative().max(2),
    maximumAttemptsPerCue: z.literal(2),
    maximumTotalAlignmentAttempts: z.number().int().positive().max(40),
    concurrency: z.number().int().min(1).max(2),
    minimumWordCoverageRatio: z.number().min(0).max(1),
    minimumReadingCoverageRatio: z.number().min(0).max(1),
    minimumPhoneCoverageRatio: z.number().min(0).max(1),
    maximumWindowBoundaryDifferenceSeconds: z.number().nonnegative(),
    maximumTimingAdjustmentSeconds: z.number().nonnegative().max(0.5),
    minimumPostRepairCueDurationSeconds: z.number().positive().min(0.4),
    maximumNeighborIntrusionRatio: z.number().min(0).max(1),
    minimumBestHypothesisScore: z.number().min(0).max(1),
    minimumDecisionMargin: z.number().min(0).max(1),
    antiForcePolicyVersion: z.string().min(1),
    jointAssignmentPolicyVersion: z.string().min(1),
    outputParserVersion: z.string().min(1),
    wholeMediaAsrAllowed: z.literal(false),
    whisperPromptAllowed: z.literal(false),
  })
  .strict();

export const subtitleCanonicalForcedAlignmentSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("subtitle-canonical-forced-alignment"),
    alignmentVersion: z.literal("C5.17"),
    generatedAt: z.iso.datetime(),
    sourceFingerprint: sourceFingerprintSchema,
    baseCueHash: hashSchema,
    baseTimingHash: hashSchema,
    baseOverlapArtifactHash: hashSchema,
    runtimeCapabilityRef: relativePathSchema.nullable(),
    canonicalInputRef: relativePathSchema,
    configuration: forcedAlignmentConfigurationSchema,
    attempts: z.array(forcedAlignmentAttemptSchema),
    cueAlignments: z.array(forcedAlignmentCueDecisionSchema),
    components: z.array(forcedAlignmentComponentSchema),
    mutations: z.array(forcedAlignmentTimingMutationSchema),
    summary: z
      .object({
        componentCount: z.number().int().nonnegative(),
        cueCount: z.number().int().nonnegative(),
        eligibleCueCount: z.number().int().nonnegative(),
        ineligibleCueCount: z.number().int().nonnegative(),
        attemptCount: z.number().int().nonnegative().max(40),
        successfulAttemptCount: z.number().int().nonnegative(),
        failedAttemptCount: z.number().int().nonnegative(),
        cacheHitCount: z.number().int().nonnegative(),
        mfaProcessCount: z.number().int().nonnegative(),
        stableWindowAlignmentCount: z.number().int().nonnegative(),
        unstableWindowAlignmentCount: z.number().int().nonnegative(),
        windowEdgePinnedCount: z.number().int().nonnegative(),
        criticalOovCount: z.number().int().nonnegative(),
        mfaAlignedCueCount: z.number().int().nonnegative(),
        evidenceDpAlignedCueCount: z.number().int().nonnegative(),
        hybridAlignedCueCount: z.number().int().nonnegative(),
        duplicateOccurrenceConflictCount: z.number().int().nonnegative(),
        autoResolvedComponentCount: z.number().int().nonnegative(),
        timingMutationCount: z.number().int().nonnegative(),
        unresolvedComponentCount: z.number().int().nonnegative(),
        canonicalTextMutationCount: z.literal(0),
        untrustedForcedAlignmentTimingUseCount: z.literal(0),
        duplicateOccurrenceAssignedCount: z.literal(0),
        wholeMediaAsrRequestCount: z.literal(0),
        whisperAsrRequestCount: z.literal(0),
        openAiRequestCount: z.literal(0),
        onlineSubtitleLookupCount: z.literal(0),
        whisperPromptContaminationCount: z.literal(0),
        midpointRepairCount: z.literal(0),
        characterRatioRepairCount: z.literal(0),
        readingRatioRepairCount: z.literal(0),
        phoneCountRatioRepairCount: z.literal(0),
      })
      .strict(),
  })
  .strict();

export const forcedAlignmentCacheManifestSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("forced-alignment-cache-manifest"),
    cacheVersion: z.literal("C5.17"),
    generatedAt: z.iso.datetime(),
    requestType: z.literal("canonical-forced-alignment"),
    cacheRootShareableName: z.string().min(1),
    entries: z.array(
      z
        .object({
          cacheKey: hashSchema,
          attemptId: z.string().min(1),
          cueId: z.string().min(1),
          componentId: z.string().min(1),
          windowType: forcedAlignmentWindowTypeSchema,
          entrySha256: hashSchema,
          hit: z.boolean(),
        })
        .strict(),
    ),
    summary: z
      .object({
        entryCount: z.number().int().nonnegative(),
        hitCount: z.number().int().nonnegative(),
        missCount: z.number().int().nonnegative(),
        mfaProcessCount: z.number().int().nonnegative(),
        legacyAsrCacheHitCount: z.literal(0),
      })
      .strict(),
  })
  .strict();

export const forcedAlignmentCacheIdentitySchema = z
  .object({
    requestType: z.literal("canonical-forced-alignment"),
    audioSha256: hashSchema,
    windowMediaInterval: subtitleIntervalSchema,
    windowAudioInterval: subtitleIntervalSchema,
    canonicalTextSha256: hashSchema,
    alignmentTextSha256: hashSchema,
    readingManifestSha256: hashSchema,
    backend: forcedAlignmentBackendSchema,
    runtimeIdentityHash: hashSchema,
    environmentExplicitSpecSha256: hashSchema,
    acousticModelSha256: hashSchema,
    dictionaryModelSha256: hashSchema,
    g2pModelSha256: hashSchema,
    commandMode: z.enum(["align_one", "align_one_legacy", "mock"]),
    mfaConfigurationHash: hashSchema,
    outputParserVersion: z.string().min(1),
    antiForcePolicyVersion: z.string().min(1),
    jointAssignmentPolicyVersion: z.string().min(1),
  })
  .strict();

export const forcedAlignmentCacheEntrySchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("forced-alignment-cache-entry"),
    cacheVersion: z.literal("C5.17"),
    requestType: z.literal("canonical-forced-alignment"),
    createdAt: z.iso.datetime(),
    cacheKey: hashSchema,
    identity: forcedAlignmentCacheIdentitySchema,
    attempt: forcedAlignmentAttemptSchema,
  })
  .strict();

export const c517ForcedAlignmentReplaySummarySchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("c5-17-forced-alignment-replay-summary"),
    replayVersion: z.literal("C5.17"),
    generatedAt: z.iso.datetime(),
    runKind: z.enum(["fresh", "cache-replay", "observe"]),
    inputTaskName: z.string().min(1),
    outputTaskName: z.string().min(1),
    forcedAlignmentMode: forcedAlignmentModeSchema,
    backend: forcedAlignmentBackendSchema,
    runtimeIdentityHash: hashSchema.nullable(),
    canonicalInputHash: hashSchema,
    alignmentHash: hashSchema,
    componentDecisionHash: hashSchema,
    outputCueHash: hashSchema,
    sourceSha256Before: hashSchema,
    sourceSha256After: hashSchema,
    humanSubtitleSha256Before: hashSchema,
    humanSubtitleSha256After: hashSchema,
    sourceReadOnly: z
      .object({
        sizeBefore: z.number().int().nonnegative(),
        sizeAfter: z.number().int().nonnegative(),
        mtimeMsBefore: z.number().nonnegative(),
        mtimeMsAfter: z.number().nonnegative(),
        verified: z.boolean(),
      })
      .strict(),
    humanSubtitleReadOnly: z
      .object({
        sizeBefore: z.number().int().nonnegative(),
        sizeAfter: z.number().int().nonnegative(),
        mtimeMsBefore: z.number().nonnegative(),
        mtimeMsAfter: z.number().nonnegative(),
        verified: z.boolean(),
      })
      .strict(),
    metrics: z
      .object({
        componentCount: z.number().int().nonnegative(),
        cueCount: z.number().int().nonnegative(),
        attemptCount: z.number().int().nonnegative().max(40),
        successCount: z.number().int().nonnegative(),
        failureCount: z.number().int().nonnegative(),
        cacheHitCount: z.number().int().nonnegative(),
        mfaProcessCount: z.number().int().nonnegative(),
        wallClockSeconds: z.number().nonnegative(),
        timingMutationCount: z.number().int().nonnegative(),
        reviewItemCount: z.number().int().nonnegative(),
        wholeMediaAsrRequestCount: z.literal(0),
        whisperAsrRequestCount: z.literal(0),
        openAiRequestCount: z.literal(0),
        onlineSubtitleLookupCount: z.literal(0),
      })
      .strict(),
    canonicalTimingUnchanged: z.boolean(),
    blockersClosed: z.number().int().nonnegative(),
    finalStatus: z.enum(["needs-review", "human-validated"]),
    finalizationMethod: z.enum(["none", "human"]),
  })
  .strict();

export type ForcedAlignmentMode = z.infer<typeof forcedAlignmentModeSchema>;
export type ForcedAlignmentBackend = z.infer<
  typeof forcedAlignmentBackendSchema
>;
export type ForcedAlignmentWindowType = z.infer<
  typeof forcedAlignmentWindowTypeSchema
>;
export type CanonicalMorpheme = z.infer<typeof canonicalMorphemeSchema>;
export type CanonicalAlignmentWordUnit = z.infer<
  typeof canonicalAlignmentWordUnitSchema
>;
export type CanonicalAlignmentCueInput = z.infer<
  typeof canonicalAlignmentCueInputSchema
>;
export type SubtitleCanonicalAlignmentInput = z.infer<
  typeof subtitleCanonicalAlignmentInputSchema
>;
export type ForcedAlignmentModelIdentity = z.infer<
  typeof forcedAlignmentModelIdentitySchema
>;
export type ForcedAlignmentRuntimeCapability = z.infer<
  typeof forcedAlignmentRuntimeCapabilitySchema
>;
export type ForcedAlignmentWordInterval = z.infer<
  typeof forcedAlignmentWordIntervalSchema
>;
export type ForcedAlignmentPhoneInterval = z.infer<
  typeof forcedAlignmentPhoneIntervalSchema
>;
export type ForcedAlignmentAttempt = z.infer<
  typeof forcedAlignmentAttemptSchema
>;
export type EvidenceDpUnit = z.infer<typeof evidenceDpUnitSchema>;
export type EvidenceDpResult = z.infer<typeof evidenceDpResultSchema>;
export type AntiForcingMetrics = z.infer<typeof antiForcingMetricsSchema>;
export type ForcedAlignmentCueDecision = z.infer<
  typeof forcedAlignmentCueDecisionSchema
>;
export type ForcedAlignmentHypothesis = z.infer<
  typeof forcedAlignmentHypothesisSchema
>;
export type ForcedAlignmentTimingMutation = z.infer<
  typeof forcedAlignmentTimingMutationSchema
>;
export type ForcedAlignmentComponent = z.infer<
  typeof forcedAlignmentComponentSchema
>;
export type ForcedAlignmentConfiguration = z.infer<
  typeof forcedAlignmentConfigurationSchema
>;
export type SubtitleCanonicalForcedAlignment = z.infer<
  typeof subtitleCanonicalForcedAlignmentSchema
>;
export type ForcedAlignmentCacheManifest = z.infer<
  typeof forcedAlignmentCacheManifestSchema
>;
export type ForcedAlignmentCacheIdentity = z.infer<
  typeof forcedAlignmentCacheIdentitySchema
>;
export type ForcedAlignmentCacheEntry = z.infer<
  typeof forcedAlignmentCacheEntrySchema
>;
export type C517ForcedAlignmentReplaySummary = z.infer<
  typeof c517ForcedAlignmentReplaySummarySchema
>;

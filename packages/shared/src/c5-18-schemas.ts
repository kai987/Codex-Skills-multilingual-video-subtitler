import { z } from "zod";

import {
  humanActionSchema,
  sourceFingerprintSchema,
  subtitleIntervalSchema,
} from "./finalization-schemas.js";
import { schemaVersionSchema } from "./schemas.js";

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);

export const reviewActionHardeningModeSchema = z.enum([
  "off",
  "observe",
  "enforce",
]);

export const reviewActionValidationErrorSchema = z
  .object({
    code: z.string().min(1),
    reviewId: z.string().min(1).nullable(),
    action: humanActionSchema.nullable(),
    field: z.string().min(1).nullable(),
    message: z.string().min(1),
  })
  .strict();

export const reviewActionValidationReportSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("review-action-validation-report"),
    validationVersion: z.literal("C5.18-PHASE0"),
    policyVersion: z.literal("c5.18-review-action-semantics-v1"),
    generatedAt: z.iso.datetime(),
    mode: reviewActionHardeningModeSchema,
    reviewPackageHash: hashSchema,
    reviewVersion: z.string().min(1),
    itemCount: z.number().int().nonnegative(),
    resolutionCount: z.number().int().nonnegative(),
    allowedActionValidationCount: z.number().int().nonnegative(),
    invalidActionCount: z.number().int().nonnegative(),
    quarantinedSavedActionCount: z.number().int().nonnegative(),
    shortcutBypassCount: z.number().int().nonnegative(),
    downloadBlockedCount: z.number().int().nonnegative(),
    preFixReproduction: z
      .object({
        invalidAcceptShortcutGeneratedCount: z.number().int().nonnegative(),
        invalidResolutionDownloadAllowedCount: z.number().int().nonnegative(),
        shortcutActionBypassedAllowedActionsCount: z
          .number()
          .int()
          .nonnegative(),
      })
      .strict(),
    errors: z.array(reviewActionValidationErrorSchema),
    summary: z
      .object({
        invalidAcceptShortcutGeneratedCount: z.literal(0),
        invalidResolutionDownloadAllowedCount: z.literal(0),
        shortcutActionBypassedAllowedActionsCount: z.literal(0),
        noCandidateShortcutResolutionDelta: z.literal(0),
        coreBrowserPolicyHash: hashSchema,
        validationPassed: z.boolean(),
      })
      .strict(),
    semanticHash: hashSchema,
  })
  .strict();

export type ReviewActionHardeningMode = z.infer<
  typeof reviewActionHardeningModeSchema
>;
export type ReviewActionValidationError = z.infer<
  typeof reviewActionValidationErrorSchema
>;
export type ReviewActionValidationReport = z.infer<
  typeof reviewActionValidationReportSchema
>;

const relativePathSchema = z
  .string()
  .min(1)
  .regex(/^(?!\/)(?![A-Za-z]:[\\/])(?!\\\\).+/u, "Path must be relative.");
const gitRevisionSchema = z.string().regex(/^[a-f0-9]{40}$/u);

export const speakerEvidenceModeSchema = z.enum(["off", "observe", "enforce"]);
export const speakerBackendSchema = z.literal("pyannote-community-1");
export const speakerDeviceSchema = z.enum(["auto", "mps", "cpu"]);
export const speakerDeviceUsedSchema = z.enum(["mps", "cpu"]);
export const speakerWindowModeSchema = z.enum(["context", "union", "dual"]);
export const speakerPresentationResolutionModeSchema = z.enum([
  "off",
  "observe",
  "enforce",
]);
export const speakerCacheModeSchema = z.enum(["off", "read", "read-write"]);
export const speakerWindowTypeSchema = z.enum(["context", "union"]);
export const speakerRelationshipSchema = z.enum([
  "ordered-different-speaker-turns",
  "same-speaker-boundary-overlap",
  "stable-multi-speaker-overlap",
  "nested-multi-speaker-activity",
  "single-speaker-only",
  "speaker-evidence-conflict",
  "unresolved",
]);

export const speakerRuntimeManifestSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("speaker-runtime-manifest"),
    runtimeVersion: z.literal("C5.18"),
    generatedAt: z.iso.datetime(),
    runtimeId: z.string().min(1),
    runtimeDirectory: z.string().min(1),
    pythonExecutable: z.string().min(1),
    pythonVersion: z.string().min(1),
    packages: z.array(
      z
        .object({ name: z.string().min(1), version: z.string().min(1) })
        .strict(),
    ),
    explicitSpecPath: z.string().min(1),
    explicitSpecSha256: hashSchema,
    dependencySpecSha256: hashSchema,
    runtimeIdentityHash: hashSchema,
  })
  .strict();

export const speakerModelFileSchema = z
  .object({
    relativePath: relativePathSchema,
    size: z.number().int().nonnegative(),
    sha256: hashSchema,
  })
  .strict();

export const speakerModelSnapshotSchema = z
  .object({
    modelRepo: z.string().min(1),
    modelRevision: gitRevisionSchema,
    snapshotSubdirectory: relativePathSchema,
    modelSnapshotHash: hashSchema,
    files: z.array(speakerModelFileSchema).min(1),
  })
  .strict();

export const speakerModelManifestSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("speaker-model-manifest"),
    modelVersion: z.literal("C5.18"),
    generatedAt: z.iso.datetime(),
    backend: speakerBackendSchema,
    modelRepo: z.literal("pyannote/speaker-diarization-community-1"),
    requestedRevision: gitRevisionSchema,
    resolvedRevision: gitRevisionSchema,
    snapshotDirectory: z.string().min(1),
    modelSnapshotHash: hashSchema,
    modelFiles: z.array(speakerModelFileSchema).min(1),
    dependencyModelSnapshots: z.array(speakerModelSnapshotSchema),
    license: z.literal("cc-by-4.0"),
    citations: z
      .array(
        z
          .object({
            title: z.string().min(1),
            url: z.url(),
          })
          .strict(),
      )
      .min(1),
    networkUsedDuringPreparation: z.boolean(),
    hfTokenEnvName: z.string().min(1),
    hfTokenStored: z.literal(false),
  })
  .strict();

export const speakerEvidenceRuntimeCapabilitySchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("speaker-evidence-runtime-capability"),
    runtimeVersion: z.literal("C5.18"),
    generatedAt: z.iso.datetime(),
    backend: speakerBackendSchema,
    pythonVersion: z.string().min(1),
    pyannoteAudioVersion: z.string().min(1),
    torchVersion: z.string().min(1),
    torchaudioVersion: z.string().min(1),
    huggingfaceHubVersion: z.string().min(1),
    numpyVersion: z.string().min(1),
    scipyVersion: z.string().min(1),
    soundfileVersion: z.string().min(1),
    runtimeExplicitSpecSha256: hashSchema,
    dependencySpecSha256: hashSchema,
    runtimeIdentityHash: hashSchema,
    modelRepo: z.literal("pyannote/speaker-diarization-community-1"),
    modelRevision: gitRevisionSchema,
    modelSnapshotHash: hashSchema,
    modelFiles: z.array(speakerModelFileSchema).min(1),
    license: z.literal("cc-by-4.0"),
    citations: z
      .array(z.object({ title: z.string().min(1), url: z.url() }).strict())
      .min(1),
    dependencyModelSnapshots: z.array(speakerModelSnapshotSchema),
    standardDiarizationAvailable: z.boolean(),
    exclusiveDiarizationAvailable: z.boolean(),
    overlapTrackAvailable: z.boolean(),
    segmentationConfidenceAvailable: z.boolean(),
    speakerConfidenceAvailable: z.boolean(),
    confidenceStatus: z.enum(["available", "unavailable"]),
    deviceRequested: speakerDeviceSchema,
    deviceUsed: speakerDeviceUsedSchema,
    fallback: z
      .object({
        applied: z.boolean(),
        from: z.literal("mps").nullable(),
        to: z.literal("cpu").nullable(),
        reason: z.string().min(1).nullable(),
      })
      .strict(),
    mpsAvailable: z.boolean(),
    allPipelineModulesOnDevice: z.boolean(),
    finiteOutputVerified: z.boolean(),
    mpsCpuSemanticComparable: z.boolean().nullable(),
    networkUsedDuringPreparation: z.boolean(),
    networkUsedDuringInference: z.literal(false),
    hfTokenStored: z.literal(false),
    runtimePath: z.null(),
    modelCachePath: z.null(),
    shareable: z.literal(true),
    semanticHash: hashSchema,
  })
  .strict();

export const speakerTurnSchema = z
  .object({
    turnId: z.string().min(1),
    speakerId: z.string().min(1),
    startLocal: z.number().nonnegative(),
    endLocal: z.number().positive(),
    startMediaGlobal: z.number().nonnegative(),
    endMediaGlobal: z.number().positive(),
    source: z.enum(["standard", "exclusive"]),
    overlapParticipant: z.boolean(),
    evidenceLineageId: z.string().min(1),
  })
  .strict()
  .refine((value) => value.endLocal > value.startLocal, {
    message: "Local turn end must be greater than start.",
  })
  .refine((value) => value.endMediaGlobal > value.startMediaGlobal, {
    message: "Global turn end must be greater than start.",
  });

const speakerOverlapIntervalSchema = z
  .object({
    overlapId: z.string().min(1),
    interval: subtitleIntervalSchema,
    durationSeconds: z.number().positive(),
    activeSpeakerIds: z.array(z.string().min(1)).min(2),
    contextWindowObserved: z.boolean(),
    unionWindowObserved: z.boolean(),
    crossWindowIoU: z.number().min(0).max(1),
    stabilityStatus: z.enum(["stable", "unstable", "single-window"]),
    evidenceLineageIds: z.array(z.string().min(1)).min(1),
  })
  .strict();

const speakerChangePointSchema = z
  .object({
    changeId: z.string().min(1),
    beforeSpeakerId: z.string().min(1),
    afterSpeakerId: z.string().min(1),
    timeMediaGlobal: z.number().nonnegative(),
    contextTime: z.number().nonnegative().nullable(),
    unionTime: z.number().nonnegative().nullable(),
    differenceSeconds: z.number().nonnegative().nullable(),
    stable: z.boolean(),
    evidenceLineageIds: z.array(z.string().min(1)).min(1),
  })
  .strict();

const cueSpeakerHypothesisSchema = z
  .object({
    cueId: z.string().min(1),
    assignmentWindow: subtitleIntervalSchema,
    assignmentWindowSource: z.enum([
      "forced-alignment-selected",
      "mfa-lexical",
      "evidence-dp",
      "source-cue-prior",
    ]),
    speakerCoverageByCluster: z.record(
      z.string().min(1),
      z.number().min(0).max(1),
    ),
    dominantSpeakerId: z.string().min(1).nullable(),
    dominantSpeakerCoverage: z.number().min(0).max(1),
    runnerUpSpeakerId: z.string().min(1).nullable(),
    runnerUpSpeakerCoverage: z.number().min(0).max(1),
    speakerAssignmentMargin: z.number().min(0).max(1),
    speakerChangeInsideCue: z.boolean(),
    overlapSpeechCoverage: z.number().min(0).max(1),
    exclusiveTurnCoverage: z.number().min(0).max(1),
    contextUnionAgreement: z.number().min(0).max(1),
    assignmentStatus: z.enum([
      "stable-single-speaker",
      "stable-multi-speaker",
      "ambiguous",
      "unavailable",
    ]),
    evidenceLineageIds: z.array(z.string().min(1)),
    blockers: z.array(z.string().min(1)),
  })
  .strict();

const acousticProminenceSchema = z
  .object({
    speakerId: z.string().min(1),
    exclusiveRmsDbfsMedian: z.number().nullable(),
    exclusiveRmsDbfsP90: z.number().nullable(),
    exclusiveActivityDuration: z.number().nonnegative(),
    activityPersistenceRatio: z.number().min(0).max(1),
    overlapOccupancyRatio: z.number().min(0).max(1),
    nonOverlapSampleDuration: z.number().nonnegative(),
    forcedAlignmentCoverage: z.number().min(0).max(1),
    mappedTokenLexicalCoverage: z.number().min(0).max(1),
    chantRepetitionScore: z.number().min(0).max(1),
    status: z.enum([
      "prominent-likely",
      "background-likely",
      "co-primary",
      "insufficient-exclusive-audio",
      "unknown",
    ]),
    scoreCalibrationStatus: z.literal("uncalibrated-heuristic"),
    blockers: z.array(z.string().min(1)),
  })
  .strict();

const relationshipHypothesisSchema = z
  .object({
    relationship: speakerRelationshipSchema.exclude(["unresolved"]),
    score: z.number().min(0).max(1),
    evidenceLineageIds: z.array(z.string().min(1)),
    reasons: z.array(z.string().min(1)),
  })
  .strict();

const speakerPresentationOverrideSchema = z
  .object({
    cueId: z.string().min(1),
    assLayer: z.number().int().nonnegative(),
    assAlignment: z.number().int().min(1).max(9).nullable(),
    vttSettings: z.string().min(1),
    srtWarning: z.string().min(1),
    reason: z.string().min(1),
  })
  .strict();

const speakerTimingProposalSchema = z
  .object({
    eligible: z.boolean(),
    applied: z.boolean(),
    textChanged: z.literal(false),
    mutations: z.array(
      z
        .object({
          cueId: z.string().min(1),
          before: subtitleIntervalSchema,
          after: subtitleIntervalSchema,
          startEvidenceIds: z.array(z.string().min(1)),
          endEvidenceIds: z.array(z.string().min(1)),
          maximumDeltaSeconds: z.number().nonnegative(),
        })
        .strict(),
    ),
    blockers: z.array(z.string().min(1)),
    atomicRollbackApplied: z.boolean(),
    forbiddenHeuristicUseCount: z.literal(0),
  })
  .strict();

export const speakerEvidenceAttemptSchema = z
  .object({
    attemptId: z.string().min(1),
    componentId: z.string().min(1),
    windowType: speakerWindowTypeSchema,
    audioPath: relativePathSchema,
    audioSha256: hashSchema,
    audioLocalInterval: subtitleIntervalSchema,
    mediaGlobalInterval: subtitleIntervalSchema,
    runtimeIdentityHash: hashSchema,
    modelSnapshotHash: hashSchema,
    device: speakerDeviceUsedSchema,
    minSpeakers: z.number().int().min(1).max(3),
    maxSpeakers: z.number().int().min(1).max(3),
    standardTurns: z.array(speakerTurnSchema),
    exclusiveTurns: z.array(speakerTurnSchema),
    speakerCount: z.number().int().nonnegative(),
    speakerLabels: z.array(z.string().min(1)),
    overlapSpeechIntervals: z.array(subtitleIntervalSchema),
    speakerChangePoints: z.array(z.number().nonnegative()),
    wallClockSeconds: z.number().nonnegative(),
    cacheHit: z.boolean(),
    confidenceStatus: z.enum(["available", "unavailable"]),
    failure: z.string().min(1).nullable(),
    warnings: z.array(z.string().min(1)),
    semanticHash: hashSchema,
  })
  .strict();

export const speakerEvidenceComponentSchema = z
  .object({
    componentId: z.string().min(1),
    cueIds: z.array(z.string().min(1)).min(1),
    componentUnion: subtitleIntervalSchema,
    contextAttemptId: z.string().min(1).nullable(),
    unionAttemptId: z.string().min(1).nullable(),
    speakerWindowMapping: z.array(
      z
        .object({
          contextSpeakerId: z.string().min(1),
          unionSpeakerId: z.string().min(1),
          mappingScore: z.number().min(0).max(1),
        })
        .strict(),
    ),
    unmappedSpeakers: z.array(z.string().min(1)),
    windowStability: z
      .object({
        speakerCountStable: z.boolean(),
        speakerTurnBoundaryStability: z.number().min(0).max(1),
        overlapIntervalStability: z.number().min(0).max(1),
        exclusiveTurnStability: z.number().min(0).max(1),
        speakerActivityIntersectionOverUnion: z.number().min(0).max(1),
        speakerChangePointDifferenceSeconds: z
          .number()
          .nonnegative()
          .nullable(),
        stable: z.boolean(),
        blockers: z.array(z.string().min(1)),
      })
      .strict(),
    speakerTracks: z.array(
      z
        .object({
          speakerId: z.string().min(1),
          standardTurns: z.array(speakerTurnSchema),
          exclusiveTurns: z.array(speakerTurnSchema),
          totalActivityDuration: z.number().nonnegative(),
          firstActivityTime: z.number().nonnegative().nullable(),
        })
        .strict(),
    ),
    overlapSpeechIntervals: z.array(speakerOverlapIntervalSchema),
    speakerChangePoints: z.array(speakerChangePointSchema),
    cueSpeakerHypotheses: z.array(cueSpeakerHypothesisSchema),
    prominenceEvidence: z.array(acousticProminenceSchema),
    relationshipHypotheses: z.array(relationshipHypothesisSchema),
    selectedRelationship: speakerRelationshipSchema,
    bestActionableHypothesis: speakerRelationshipSchema
      .exclude(["unresolved"])
      .nullable(),
    bestActionableHypothesisScore: z.number().min(0).max(1).nullable(),
    runnerUpActionableHypothesis: speakerRelationshipSchema
      .exclude(["unresolved"])
      .nullable(),
    runnerUpActionableHypothesisScore: z.number().min(0).max(1).nullable(),
    actionableDecisionMargin: z.number().min(0).max(1),
    scoreCalibrationStatus: z.literal("uncalibrated-heuristic"),
    resolutionStatus: z.enum([
      "resolved",
      "presentation-only",
      "timing-only",
      "unresolved",
      "failed",
    ]),
    blockers: z.array(z.string().min(1)),
    presentationOverrides: z.array(speakerPresentationOverrideSchema),
    timingProposal: speakerTimingProposalSchema,
    semanticHash: hashSchema,
  })
  .strict();

export const subtitleLocalSpeakerEvidenceSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("subtitle-local-speaker-evidence"),
    evidenceVersion: z.literal("C5.18"),
    generatedAt: z.iso.datetime(),
    sourceFingerprint: sourceFingerprintSchema,
    baseCueHash: hashSchema,
    baseTimingHash: hashSchema,
    runtimeCapabilityRef: z
      .object({ path: relativePathSchema, sha256: hashSchema })
      .strict(),
    reviewPackageRef: z
      .object({ path: relativePathSchema, sha256: hashSchema })
      .strict(),
    forcedAlignmentRef: z
      .object({ path: relativePathSchema, sha256: hashSchema })
      .strict(),
    overlapAcousticRef: z
      .object({ path: relativePathSchema, sha256: hashSchema })
      .strict(),
    configuration: z
      .object({
        mode: speakerEvidenceModeSchema,
        backend: speakerBackendSchema,
        deviceRequested: speakerDeviceSchema,
        deviceUsed: speakerDeviceUsedSchema,
        windowMode: speakerWindowModeSchema,
        minimumSpeakers: z.number().int().min(1).max(3),
        maximumSpeakers: z.number().int().min(1).max(3),
        concurrency: z.literal(1),
        persistSpeakerEmbeddings: z.literal(false),
        speakerNormalizationPolicy: z.string().min(1),
        windowMappingPolicy: z.string().min(1),
        overlapPolicy: z.string().min(1),
        prominencePolicy: z.string().min(1),
        cueAssignmentPolicy: z.string().min(1),
        relationshipPolicy: z.string().min(1),
        policyHash: hashSchema,
      })
      .strict(),
    attempts: z.array(speakerEvidenceAttemptSchema).max(14),
    components: z.array(speakerEvidenceComponentSchema).max(7),
    summary: z
      .object({
        targetComponentCount: z.number().int().nonnegative().max(7),
        targetCueCount: z.number().int().nonnegative(),
        attemptCount: z.number().int().nonnegative().max(14),
        cacheHitCount: z.number().int().nonnegative().max(14),
        pipelineInferenceCount: z.number().int().nonnegative().max(14),
        modelLoadCount: z.number().int().nonnegative(),
        standardDiarizationObserved: z.boolean(),
        exclusiveDiarizationObserved: z.boolean(),
        stableComponentCount: z.number().int().nonnegative(),
        resolvedComponentCount: z.number().int().nonnegative(),
        presentationOnlyComponentCount: z.number().int().nonnegative(),
        timingOnlyComponentCount: z.number().int().nonnegative(),
        unresolvedComponentCount: z.number().int().nonnegative(),
        duplicateSpeakerEvidenceLineageCount: z.number().int().nonnegative(),
        speakerEvidenceDoubleCountPreventedCount: z
          .number()
          .int()
          .nonnegative(),
        crossComponentSpeakerLinkCount: z.literal(0),
        realPersonIdentificationCount: z.literal(0),
        speakerConfidenceFabricatedCount: z.literal(0),
        rawVadUsedAsSpeakerIdentityCount: z.literal(0),
        mfaUsedAsSpeakerIdentityCount: z.literal(0),
        mappedTokenUsedAsSpeakerIdentityCount: z.literal(0),
        rawEmbeddingPersistedCount: z.literal(0),
        timingMutationCount: z.number().int().nonnegative(),
        canonicalTextMutationCount: z.literal(0),
        forbiddenTimingHeuristicUseCount: z.literal(0),
      })
      .strict(),
    componentDecisionHash: hashSchema,
    mutationHash: hashSchema,
    semanticHash: hashSchema,
  })
  .strict();

export const speakerEvidenceCacheEntrySchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    requestType: z.literal("local-speaker-evidence"),
    cacheKey: hashSchema,
    createdAt: z.iso.datetime(),
    requestIdentity: z
      .object({
        requestType: z.literal("local-speaker-evidence"),
        audioSha256: hashSchema,
        windowType: speakerWindowTypeSchema,
        audioLocalInterval: subtitleIntervalSchema,
        mediaGlobalInterval: subtitleIntervalSchema,
        runtimeIdentityHash: hashSchema,
        pyannoteAudioVersion: z.string().min(1),
        torchVersion: z.string().min(1),
        torchaudioVersion: z.string().min(1),
        modelRepo: z.literal("pyannote/speaker-diarization-community-1"),
        modelRevision: gitRevisionSchema,
        modelSnapshotHash: hashSchema,
        dependencyModelHashes: z.array(hashSchema),
        device: speakerDeviceUsedSchema,
        minSpeakers: z.number().int().min(1).max(3),
        maxSpeakers: z.number().int().min(1).max(3),
        speakerNormalizationPolicy: z.string().min(1),
        windowMappingPolicy: z.string().min(1),
        overlapPolicy: z.string().min(1),
        prominencePolicy: z.string().min(1),
        cueAssignmentPolicy: z.string().min(1),
        relationshipPolicy: z.string().min(1),
      })
      .strict(),
    result: z
      .object({
        standardTurns: z.array(
          z
            .object({
              speaker: z.string().min(1),
              start: z.number().nonnegative(),
              end: z.number().positive(),
            })
            .strict(),
        ),
        exclusiveTurns: z.array(
          z
            .object({
              speaker: z.string().min(1),
              start: z.number().nonnegative(),
              end: z.number().positive(),
            })
            .strict(),
        ),
        confidenceStatus: z.enum(["available", "unavailable"]),
        warnings: z.array(z.string().min(1)),
      })
      .strict(),
    semanticHash: hashSchema,
  })
  .strict();

export const speakerEvidenceCacheManifestSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("speaker-evidence-cache-manifest"),
    cacheVersion: z.literal("C5.18"),
    generatedAt: z.iso.datetime(),
    requestType: z.literal("local-speaker-evidence"),
    mode: speakerCacheModeSchema,
    requests: z.array(
      z
        .object({
          attemptId: z.string().min(1),
          cacheKey: hashSchema,
          cacheHit: z.boolean(),
          entrySemanticHash: hashSchema,
          audioSha256: hashSchema,
          windowType: speakerWindowTypeSchema,
        })
        .strict(),
    ),
    summary: z
      .object({
        requestCount: z.number().int().nonnegative().max(14),
        hitCount: z.number().int().nonnegative().max(14),
        missCount: z.number().int().nonnegative().max(14),
        writeCount: z.number().int().nonnegative().max(14),
        inferenceCount: z.number().int().nonnegative().max(14),
        modelLoadCount: z.number().int().nonnegative(),
      })
      .strict(),
    cacheIdentityHash: hashSchema,
    semanticHash: hashSchema,
  })
  .strict();

const readOnlyIdentitySchema = z
  .object({
    sizeBefore: z.number().int().nonnegative(),
    sizeAfter: z.number().int().nonnegative(),
    mtimeMsBefore: z.number().nonnegative(),
    mtimeMsAfter: z.number().nonnegative(),
    sha256Before: hashSchema,
    sha256After: hashSchema,
    verified: z.boolean(),
  })
  .strict();

export const c518SpeakerEvidenceReplaySummarySchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("c5-18-speaker-evidence-replay-summary"),
    replayVersion: z.literal("C5.18"),
    generatedAt: z.iso.datetime(),
    runId: z.string().min(1),
    sourceTaskName: z.string().min(1),
    outputTaskName: z.string().min(1),
    reviewActionHardening: reviewActionHardeningModeSchema,
    speakerEvidenceMode: speakerEvidenceModeSchema,
    speakerPresentationResolution: speakerPresentationResolutionModeSchema,
    cacheMode: speakerCacheModeSchema,
    runtimeCapabilityHash: hashSchema,
    speakerEvidenceArtifactHash: hashSchema,
    cacheManifestHash: hashSchema,
    reviewActionValidationReportHash: hashSchema,
    reviewDeliveryIntegrityHash: hashSchema,
    sourceReviewPackageHash: hashSchema,
    outputReviewPackageHash: hashSchema,
    canonicalCueHashBefore: hashSchema,
    canonicalCueHashAfter: hashSchema,
    canonicalTimingHashBefore: hashSchema,
    canonicalTimingHashAfter: hashSchema,
    presentationHashBefore: hashSchema,
    presentationHashAfter: hashSchema,
    componentDecisionHash: hashSchema,
    mutationHash: hashSchema,
    sourceTaskCriticalArtifactsReadOnly: z.boolean(),
    sourceVideoReadOnly: readOnlyIdentitySchema.nullable(),
    humanSubtitleReadOnly: readOnlyIdentitySchema.nullable(),
    execution: z
      .object({
        speakerInferenceCount: z.number().int().nonnegative().max(14),
        speakerModelLoadCount: z.number().int().nonnegative(),
        wholeMediaSpeakerInferenceCount: z.literal(0),
        wholeMediaAsrRequestCount: z.literal(0),
        whisperRequestCount: z.literal(0),
        mfaProcessCount: z.literal(0),
        openAiRequestCount: z.literal(0),
        onlineSubtitleSearchCount: z.literal(0),
        networkUsedDuringInference: z.literal(false),
      })
      .strict(),
    outcome: z
      .object({
        speakerRuntimeIdentityVerified: z.boolean(),
        speakerModelSnapshotVerified: z.boolean(),
        targetComponentCount: z.number().int().nonnegative().max(7),
        targetCueCount: z.number().int().nonnegative(),
        reviewItemCountBefore: z.number().int().nonnegative(),
        reviewItemCountAfter: z.number().int().nonnegative(),
        reviewAudioPlayableCount: z.number().int().nonnegative(),
        reviewDeliveryIntegrityPassed: z.boolean(),
        cueCount: z.number().int().nonnegative(),
        canonicalTextMutationCount: z.literal(0),
        timingMutationCount: z.number().int().nonnegative(),
        finalStatus: z.literal("needs-review"),
        finalizationMethod: z.literal("none"),
        skill2CompatibilityPassed: z.boolean(),
        skill3CompatibilityPassed: z.boolean(),
      })
      .strict(),
    semanticHash: hashSchema,
  })
  .strict();

export const c518FreshCacheObserveValidationSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("c5-18-fresh-cache-observe-validation"),
    validationVersion: z.literal("C5.18"),
    generatedAt: z.iso.datetime(),
    freshRunId: z.string().min(1),
    observeRunId: z.string().min(1),
    cacheReplayRunId: z.string().min(1),
    freshSpeakerEvidenceSemanticHash: hashSchema,
    observeSpeakerEvidenceSemanticHash: hashSchema,
    cacheSpeakerEvidenceSemanticHash: hashSchema,
    freshComponentDecisionHash: hashSchema,
    observeComponentDecisionHash: hashSchema,
    cacheComponentDecisionHash: hashSchema,
    freshMutationHash: hashSchema,
    observeMutationHash: hashSchema,
    cacheMutationHash: hashSchema,
    freshOutputCueHash: hashSchema,
    observeOutputCueHash: hashSchema,
    cacheOutputCueHash: hashSchema,
    freshInferenceCount: z.number().int().nonnegative().max(14),
    observeInferenceCount: z.number().int().nonnegative().max(14),
    cacheHitCount: z.literal(14),
    cacheInferenceCount: z.literal(0),
    cacheModelLoadCount: z.literal(0),
    observeTimingMutationCount: z.literal(0),
    speakerEvidenceSemanticParity: z.boolean(),
    componentDecisionParity: z.boolean(),
    mutationParity: z.boolean(),
    outputCueParity: z.boolean(),
    validationPassed: z.boolean(),
    semanticHash: hashSchema,
  })
  .strict();

export type SpeakerEvidenceMode = z.infer<typeof speakerEvidenceModeSchema>;
export type SpeakerDevice = z.infer<typeof speakerDeviceSchema>;
export type SpeakerDeviceUsed = z.infer<typeof speakerDeviceUsedSchema>;
export type SpeakerWindowMode = z.infer<typeof speakerWindowModeSchema>;
export type SpeakerWindowType = z.infer<typeof speakerWindowTypeSchema>;
export type SpeakerCacheMode = z.infer<typeof speakerCacheModeSchema>;
export type SpeakerRuntimeManifest = z.infer<
  typeof speakerRuntimeManifestSchema
>;
export type SpeakerModelManifest = z.infer<typeof speakerModelManifestSchema>;
export type SpeakerEvidenceRuntimeCapability = z.infer<
  typeof speakerEvidenceRuntimeCapabilitySchema
>;
export type SpeakerEvidenceAttempt = z.infer<
  typeof speakerEvidenceAttemptSchema
>;
export type SpeakerEvidenceComponent = z.infer<
  typeof speakerEvidenceComponentSchema
>;
export type SubtitleLocalSpeakerEvidence = z.infer<
  typeof subtitleLocalSpeakerEvidenceSchema
>;
export type SpeakerEvidenceCacheEntry = z.infer<
  typeof speakerEvidenceCacheEntrySchema
>;
export type SpeakerEvidenceCacheIdentity =
  SpeakerEvidenceCacheEntry["requestIdentity"];
export type SpeakerEvidenceCacheManifest = z.infer<
  typeof speakerEvidenceCacheManifestSchema
>;
export type C518SpeakerEvidenceReplaySummary = z.infer<
  typeof c518SpeakerEvidenceReplaySummarySchema
>;
export type C518FreshCacheObserveValidation = z.infer<
  typeof c518FreshCacheObserveValidationSchema
>;

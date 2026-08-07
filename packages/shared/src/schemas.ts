import { z } from "zod";

import { languageTagSchema } from "./language.js";
import {
  adaptiveRefinementRecordSchema,
  coreMLProbeStatusSchema,
} from "./transcription-schemas.js";

export const schemaVersionSchema = z.literal("1.0.0");

export const mediaTypeSchema = z.enum([
  "movie",
  "series",
  "anime",
  "documentary",
  "unknown",
]);

export const mediaIdentitySchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    title: z.string().min(1).nullable(),
    originalTitle: z.string().min(1).nullable(),
    alternativeTitles: z.array(z.string().min(1)),
    mediaType: mediaTypeSchema,
    season: z.number().int().positive().nullable(),
    episode: z.number().int().positive().nullable(),
    episodeTitle: z.string().min(1).nullable(),
    year: z.number().int().min(1888).max(2200).nullable(),
    runtimeSeconds: z.number().nonnegative().nullable(),
    releaseSource: z.string().min(1).nullable(),
    releaseGroup: z.string().min(1).nullable(),
    dialogueLanguages: z.array(languageTagSchema),
    primarySubtitleLanguages: z.array(languageTagSchema),
    referenceSubtitleLanguages: z.array(languageTagSchema),
    identificationSource: z.enum([
      "filename",
      "container-metadata",
      "filename-and-container-metadata",
      "user",
      "filename-and-user-confirmation",
      "unknown",
    ]),
    confidence: z.number().min(0).max(1),
    needsConfirmation: z.boolean(),
    confirmationReasons: z.array(z.string().min(1)),
  })
  .strict();

export type MediaIdentity = z.infer<typeof mediaIdentitySchema>;

export const subtitleCueSourceLayerSchema = z.enum([
  "baseline-vad",
  "scene-extra-sensitive-vad",
  "no-vad",
  "large-v3-refinement",
  "recovery",
  "lyrics-asr",
  "reference-original-language",
  "embedded",
  "online",
]);

export const subtitleCueProvenanceSchema = z
  .object({
    sourceLayer: subtitleCueSourceLayerSchema,
    sourceRequestIds: z.array(z.string().min(1)).default([]),
    sourceProfileIds: z.array(z.string().min(1)).default([]),
    referenceAnchorIds: z.array(z.string().min(1)).default([]),
    referenceUnitIds: z.array(z.string().min(1)).default([]),
    recoveryUnitId: z.string().min(1).nullable().default(null),
    sceneId: z.string().min(1).nullable().default(null),
    sceneLabel: z.string().min(1).nullable().default(null),
    independentSupportCount: z.number().int().nonnegative().default(0),
    qualityScore: z.number().min(0).max(1).nullable().default(null),
  })
  .strict();

export type SubtitleCueProvenance = z.infer<typeof subtitleCueProvenanceSchema>;

export const subtitleCueTextAuditSchema = z
  .object({
    rawAsrText: z.string(),
    repairedText: z.string(),
    normalizedText: z.string(),
    winnerClusterIds: z.array(z.string().min(1)).default([]),
    sourceWinnerCueIds: z.array(z.string().min(1)).default([]),
    winnerScore: z.number().min(0).max(1).nullable().optional(),
    runnerUpCueId: z.string().min(1).nullable().optional(),
    runnerUpScore: z.number().min(0).max(1).nullable().optional(),
    scoreGap: z.number().min(0).max(1).nullable().optional(),
    replacements: z
      .array(
        z
          .object({
            original: z.string().min(1),
            replacement: z.string().min(1),
            category: z.string().min(1),
            confidence: z.number().min(0).max(1),
            evidence: z.array(z.string().min(1)),
          })
          .strict(),
      )
      .default([]),
    deduplicationActions: z.array(z.string().min(1)).default([]),
    repairType: z.string().min(1).nullable().optional(),
    timingDonorCueId: z.string().min(1).nullable().optional(),
    timingRepairMethod: z.string().min(1).nullable().optional(),
    reviewRecommended: z.boolean(),
    reviewReasons: z.array(z.string().min(1)),
  })
  .strict();

export type SubtitleCueTextAudit = z.infer<typeof subtitleCueTextAuditSchema>;

export const subtitleCueSchema = z
  .object({
    id: z.string().min(1),
    start: z.number().nonnegative(),
    end: z.number().positive(),
    language: languageTagSchema,
    languages: z.array(languageTagSchema).min(1),
    text: z.string().min(1),
    style: z.enum(["default", "thought", "music"]).optional(),
    textSource: z
      .enum(["audio-asr", "reference-original-language", "embedded", "online"])
      .optional(),
    speaker: z.string().min(1).nullable(),
    confidence: z.number().min(0).max(1).nullable(),
    provenance: subtitleCueProvenanceSchema.optional(),
    textAudit: subtitleCueTextAuditSchema.optional(),
    transcriptionMetrics: z
      .object({
        averageLogProbability: z.number().nullable().optional(),
        noSpeechProbability: z.number().min(0).max(1).nullable().optional(),
        tokenProbability: z.number().min(0).max(1).nullable().optional(),
        entropy: z.number().nonnegative().nullable().optional(),
        decoderFallback: z.boolean().nullable().optional(),
        detectedLanguage: languageTagSchema.nullable().optional(),
      })
      .strict()
      .optional(),
    timingEvidence: z
      .object({
        sourceTrusted: z.boolean().default(false),
        speechStart: z.number().nonnegative().nullable(),
        speechEnd: z.number().positive().nullable(),
        tokenTimestampsAvailable: z.boolean().default(false),
        tokenTimestampsUsed: z.boolean().default(false),
        tokens: z
          .array(
            z
              .object({
                text: z.string(),
                start: z.number().nonnegative(),
                end: z.number().nonnegative(),
                probability: z.number().min(0).max(1).nullable().optional(),
              })
              .strict()
              .refine((token) => token.end >= token.start, {
                message: "Token end must be at or after token start.",
              }),
          )
          .default([]),
        alignmentSource: z.enum([
          "source",
          "token",
          "speech",
          "vad",
          "segment",
          "pause",
          "semantic",
          "character-ratio",
        ]),
        presentationTimingMethod: z
          .enum([
            "preserved-source",
            "token",
            "speech-boundary",
            "pause",
            "semantic",
            "vad",
            "character-ratio",
          ])
          .nullable()
          .default(null),
        chunkBoundaryConflict: z.boolean().optional(),
        speechIntervals: z
          .array(
            z
              .object({
                start: z.number().nonnegative(),
                end: z.number().positive(),
              })
              .strict()
              .refine((interval) => interval.end > interval.start, {
                message: "Speech interval end must be greater than start.",
              }),
          )
          .optional(),
        speechBoundarySource: z.enum(["silence", "vad", "segment"]).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((cue) => cue.end > cue.start, {
    message: "Cue end must be greater than cue start.",
  });

export type SubtitleCue = z.infer<typeof subtitleCueSchema>;

const relativeArtifactPathSchema = z
  .string()
  .min(1)
  .regex(/^(?!\/)(?![A-Za-z]:[\\/]).+/u, "Path must be relative.");

export const subtitlePackageSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    packageType: z.literal("multilingual-subtitle-package"),
    status: z.enum([
      "ready",
      "needs-subtitle-selection",
      "needs-subtitle-search",
      "needs-audio-transcription",
      "no-text-subtitle",
    ]),
    sourceLanguage: languageTagSchema,
    detectedLanguages: z.array(languageTagSchema),
    source: z
      .object({
        fileName: z.string().min(1),
        container: z.string().min(1).nullable(),
        durationSeconds: z.number().nonnegative(),
      })
      .strict(),
    identity: z
      .object({
        title: z.string().min(1).nullable(),
        season: z.number().int().positive().nullable(),
        episode: z.number().int().positive().nullable(),
        year: z.number().int().min(1888).max(2200).nullable(),
      })
      .strict(),
    primarySubtitle: z
      .object({
        language: languageTagSchema,
        sourceType: z.enum(["embedded", "online", "transcription"]),
        validationStatus: z.enum(["validated", "needs-review", "rejected"]),
        streamIndex: z.number().int().nonnegative().nullable(),
      })
      .strict()
      .nullable(),
    subtitleFiles: z
      .object({
        srt: relativeArtifactPathSchema.nullable(),
        vtt: relativeArtifactPathSchema.nullable(),
        ass: relativeArtifactPathSchema.nullable(),
      })
      .strict(),
    referenceSubtitles: z.array(
      z
        .object({
          language: languageTagSchema,
          path: relativeArtifactPathSchema,
          matchScore: z.number().min(0).max(100),
        })
        .strict(),
    ),
    video: z
      .object({
        sourcePath: z.null(),
        subtitledPath: relativeArtifactPathSchema.nullable(),
      })
      .strict(),
    cues: z.array(subtitleCueSchema),
    warnings: z.array(z.string()),
    referenceGuidance: z
      .object({
        mode: z.enum([
          "reference-free",
          "reference-assisted",
          "reference-guided",
        ]),
        referenceLanguage: languageTagSchema.nullable(),
        blindGenerationProofPath: relativeArtifactPathSchema.nullable(),
        analysisPath: relativeArtifactPathSchema.nullable(),
        classificationReviewPath: relativeArtifactPathSchema
          .nullable()
          .optional(),
        timelinePath: relativeArtifactPathSchema.nullable(),
        alignmentPath: relativeArtifactPathSchema.nullable(),
        evaluationPath: relativeArtifactPathSchema.nullable(),
        coverageIntegrityPath: relativeArtifactPathSchema.nullable(),
        coverageRecoveryPlanPath: relativeArtifactPathSchema
          .nullable()
          .optional(),
        coverageRecoveryResultsPath: relativeArtifactPathSchema
          .nullable()
          .optional(),
        referenceTextUsedAsTargetPrompt: z.literal(false),
      })
      .strict()
      .optional(),
    transcription: z
      .object({
        provider: z.string().min(1),
        strategy: z.enum(["quality", "fast", "adaptive"]),
        coreML: z
          .object({
            status: coreMLProbeStatusSchema,
            fallback: z
              .object({
                from: z.string().min(1),
                to: z.string().min(1),
                reason: z.string().min(1),
              })
              .strict()
              .nullable(),
          })
          .strict()
          .optional(),
        qualitySummary: z
          .object({
            accepted: z.number().int().nonnegative(),
            refined: z.number().int().nonnegative(),
            needsHumanReview: z.number().int().nonnegative(),
            vadNoVadConflicts: z.number().int().nonnegative().optional(),
            resolvedByLargeV3: z.number().int().nonnegative().optional(),
            suspectedHallucinations: z.number().int().nonnegative().optional(),
            probableNonSpeech: z.number().int().nonnegative().optional(),
            autoResolvedVad: z.number().int().nonnegative().optional(),
            autoResolvedNoVad: z.number().int().nonnegative().optional(),
            autoResolvedLargeV3: z.number().int().nonnegative().optional(),
            rejectedVadHallucinations: z
              .number()
              .int()
              .nonnegative()
              .optional(),
            rejectedNoVadHallucinations: z
              .number()
              .int()
              .nonnegative()
              .optional(),
            trueUnresolvedConflicts: z.number().int().nonnegative().optional(),
          })
          .strict(),
        canonicalSegmentation: z
          .object({
            artifactPath: relativeArtifactPathSchema,
            rawSegmentCount: z.number().int().nonnegative(),
            canonicalUtteranceCount: z.number().int().nonnegative(),
          })
          .strict()
          .optional(),
        missingDialogueRecovery: z
          .object({
            artifactPath: relativeArtifactPathSchema,
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
          .strict()
          .optional(),
        lyricsTranscription: z
          .object({
            artifactPath: relativeArtifactPathSchema,
            detectedSongRegions: z.number().int().nonnegative(),
            lyricsAcceptedRegions: z.number().int().nonnegative(),
            missingLyricsRegions: z.number().int().nonnegative(),
            musicCueCount: z.number().int().nonnegative(),
            lyricsAsrRequests: z.number().int().nonnegative(),
            cacheHits: z.number().int().nonnegative(),
          })
          .strict()
          .optional(),
        sceneAnalysis: z
          .object({
            windowsArtifactPath: relativeArtifactPathSchema,
            scenesArtifactPath: relativeArtifactPathSchema,
            routingPlanArtifactPath: relativeArtifactPathSchema,
            status: z.enum(["completed", "failed"]),
            mode: z.enum(["off", "observe", "route"]),
            routingMode: z.enum(["conservative", "balanced", "aggressive"]),
            sceneCount: z.number().int().nonnegative(),
            proactiveNoVadScenes: z.number().int().nonnegative(),
            proactiveExtraSensitiveVadScenes: z.number().int().nonnegative(),
            proactiveLyricsScenes: z.number().int().nonnegative(),
            noVadRequests: z.number().int().nonnegative(),
            extraSensitiveVadRequests: z.number().int().nonnegative(),
            lyricsRequests: z.number().int().nonnegative(),
            cacheHits: z.number().int().nonnegative(),
          })
          .strict()
          .optional(),
        finalSubtitleIntegrity: z
          .object({
            artifactPath: relativeArtifactPathSchema,
            validationStatus: z.enum(["passed", "needs-review"]),
            finalCueCount: z.number().int().nonnegative(),
            quarantinedCueCount: z.number().int().nonnegative(),
            hardFindingCount: z.number().int().nonnegative(),
            subtitleCoverageRatio: z.number().min(0).max(1),
          })
          .strict()
          .optional(),
        textIntegrityRepair: z
          .object({
            artifactPath: relativeArtifactPathSchema,
            attempted: z.number().int().nonnegative(),
            succeeded: z.number().int().nonnegative(),
            stillHardBlocked: z.number().int().nonnegative(),
          })
          .strict()
          .optional(),
        finalSubtitleRepair: z
          .object({
            artifactPath: relativeArtifactPathSchema,
            repaired: z.number().int().nonnegative(),
            unresolved: z.number().int().nonnegative(),
          })
          .strict()
          .optional(),
        asrCache: z
          .object({
            manifestPath: relativeArtifactPathSchema,
            migrationPath: relativeArtifactPathSchema,
            mode: z.enum(["off", "read", "read-write"]),
            requestCount: z.number().int().nonnegative(),
            hitCount: z.number().int().nonnegative(),
            migratedEntryCount: z.number().int().nonnegative(),
            missCount: z.number().int().nonnegative(),
            workerRequestsAvoided: z.number().int().nonnegative(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type SubtitlePackage = z.infer<typeof subtitlePackageSchema>;

const subtitleScoreBreakdownSchema = z
  .object({
    title: z.number().min(0).max(20),
    seasonEpisode: z.number().min(0).max(25),
    year: z.number().min(0).max(5),
    runtime: z.number().min(0).max(20),
    release: z.number().min(0).max(10),
    boundaries: z.number().min(0).max(5),
    sampledDialogue: z.number().min(0).max(10),
    integrity: z.number().min(0).max(5),
  })
  .strict();

export const subtitleSearchResultsSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    searchPerformed: z.boolean(),
    skippedReason: z.string().min(1).nullable(),
    sourceErrors: z.array(
      z
        .object({
          sourceId: z.string().min(1),
          message: z.string().min(1),
        })
        .strict(),
    ),
    candidates: z.array(
      z
        .object({
          id: z.string().min(1),
          source: z
            .object({ id: z.string().min(1), displayName: z.string().min(1) })
            .strict(),
          title: z.string().min(1),
          originalTitle: z.string().min(1).nullable(),
          season: z.number().int().positive().nullable(),
          episode: z.number().int().positive().nullable(),
          year: z.number().int().min(1888).max(2200).nullable(),
          runtimeSeconds: z.number().positive().nullable(),
          releaseSource: z.string().min(1).nullable(),
          releaseGroup: z.string().min(1).nullable(),
          language: languageTagSchema,
          kind: z.enum([
            "original",
            "hearing-impaired",
            "translation",
            "machine-translation",
            "unknown",
          ]),
          format: z.enum(["srt", "vtt", "ass", "ssa"]),
          sourcePage: z.string().min(1).nullable(),
          license: z.string().min(1).nullable(),
          score: z.number().min(0).max(100),
          scoreBreakdown: subtitleScoreBreakdownSchema,
          classification: z.enum([
            "primary",
            "needs-review",
            "reference",
            "rejected",
          ]),
          integrity: z
            .object({
              valid: z.boolean(),
              cueCount: z.number().int().nonnegative(),
              error: z.string().min(1).nullable(),
            })
            .strict(),
          downloadedRelativePath: relativeArtifactPathSchema.nullable(),
        })
        .strict(),
    ),
  })
  .strict();

export type SubtitleSearchResults = z.infer<typeof subtitleSearchResultsSchema>;

const positiveIntervalSchema = z
  .object({
    start: z.number().nonnegative(),
    end: z.number().positive(),
  })
  .strict()
  .refine((interval) => interval.end > interval.start, {
    message: "Interval end must be greater than start.",
  });

const hybridVadTranscriptionRefinementSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    strategy: z.literal("hybrid-vad"),
    basePass: z
      .object({
        adapter: z.literal("whisper-cpp"),
        model: z.string().min(1),
        vadProfile: z.literal("sensitive-v2"),
        timestampStrategy: z.literal("segment"),
      })
      .strict(),
    replacements: z
      .array(
        positiveIntervalSchema.safeExtend({
          purpose: z.enum(["opening-dialogue", "prologue-music-dialogue"]),
          adapter: z.literal("whisper-cpp"),
          model: z.string().min(1),
          vadEnabled: z.literal(false),
        }),
      )
      .min(1),
    corrections: z
      .object({
        relativePath: relativeArtifactPathSchema,
        appliedCount: z.number().int().nonnegative(),
      })
      .strict(),
    music: positiveIntervalSchema.safeExtend({
      label: z.string().min(1),
      source: z.literal("local-audio-and-authoritative-identification"),
    }),
    thought: positiveIntervalSchema.safeExtend({
      style: z.literal("thought"),
    }),
  })
  .strict();

export const transcriptionRefinementSchema = z.discriminatedUnion("strategy", [
  hybridVadTranscriptionRefinementSchema,
  adaptiveRefinementRecordSchema,
]);

export type TranscriptionRefinement = z.infer<
  typeof transcriptionRefinementSchema
>;

export const grammarLevelSystemSchema = z.enum([
  "JLPT",
  "HSK",
  "CEFR",
  "unknown",
]);

const grammarExampleSchema = z
  .object({
    text: z.string().min(1),
    reading: z.string().min(1).nullable(),
    translation: z.string().min(1).nullable(),
  })
  .strict();

const grammarPointSchema = z
  .object({
    id: z.string().min(1),
    language: languageTagSchema,
    surface: z.string().min(1),
    pattern: z.string().min(1),
    category: z.string().min(1),
    formation: z.string().min(1),
    meaning: z.string().min(1),
    explanation: z.string().min(1),
    nuance: z.string().min(1).nullable(),
    context: z.string().min(1).nullable(),
    examples: z.array(grammarExampleSchema).min(1).max(1),
    levelSystem: grammarLevelSystemSchema,
    level: z.string().min(1),
    confidence: z.number().min(0).max(1),
  })
  .strict();

const vocabularyItemSchema = z
  .object({
    surface: z.string().min(1),
    language: languageTagSchema,
    reading: z.string().min(1).nullable(),
    meaning: z.string().min(1),
  })
  .strict();

const grammarSentenceSchema = z
  .object({
    id: z.string().min(1),
    cueIds: z.array(z.string().min(1)),
    start: z.number().nonnegative().nullable(),
    end: z.number().positive().nullable(),
    language: languageTagSchema,
    languages: z.array(languageTagSchema).min(1),
    text: z.string().min(1),
    reading: z.string().min(1).nullable(),
    translation: z.string().min(1).nullable(),
    previousSentenceId: z.string().min(1).nullable(),
    nextSentenceId: z.string().min(1).nullable(),
    reconstructionConfidence: z.number().min(0).max(1),
    needsReview: z.boolean(),
    grammar: z.array(grammarPointSchema),
    vocabulary: z.array(vocabularyItemSchema),
  })
  .strict()
  .refine(
    (sentence) =>
      sentence.start === null ||
      sentence.end === null ||
      sentence.end > sentence.start,
    { message: "Sentence end must be greater than start." },
  );

export const grammarReportSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    reportType: z.literal("multilingual-grammar-report"),
    explanationLanguage: z.enum(["zh-CN", "ja-JP", "en"]),
    languages: z.array(languageTagSchema),
    source: z
      .object({
        type: z.enum(["subtitle", "text", "subtitle-package"]),
        title: z.string().min(1).nullable(),
      })
      .strict(),
    analysis: z
      .object({
        model: z.string().min(1),
        modelConfigurationHash: z.string().min(1),
        analyzerVersion: z.string().min(1),
        generatedAt: z.iso.datetime(),
      })
      .strict(),
    summary: z
      .object({
        sentenceCount: z.number().int().nonnegative(),
        grammarPointCount: z.number().int().nonnegative(),
        languageCounts: z.record(z.string(), z.number().int().nonnegative()),
        levelCounts: z.record(z.string(), z.number().int().nonnegative()),
      })
      .strict(),
    sentences: z.array(grammarSentenceSchema),
  })
  .strict();

export type GrammarReport = z.infer<typeof grammarReportSchema>;

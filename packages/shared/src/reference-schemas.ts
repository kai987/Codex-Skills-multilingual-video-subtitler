import { z } from "zod";

import { languageTagSchema } from "./language.js";
import { subtitleCueSchema } from "./schemas.js";
import {
  acousticSceneLabelSchema,
  transcriptionIntervalSchema,
} from "./transcription-schemas.js";

const versionSchema = z.literal("1.0.0");
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const timestampSchema = z.iso.datetime();

export const transcriptionGuidanceModeSchema = z.enum([
  "reference-free",
  "reference-assisted",
  "reference-guided",
]);
export type TranscriptionGuidanceMode = z.infer<
  typeof transcriptionGuidanceModeSchema
>;

export const referenceTimingModeSchema = z.enum(["trusted", "verify", "auto"]);
export type ReferenceTimingMode = z.infer<typeof referenceTimingModeSchema>;

export const referenceContentPolicySchema = z.enum([
  "dialogue-only",
  "dialogue-and-lyrics",
  "all",
]);
export type ReferenceContentPolicy = z.infer<
  typeof referenceContentPolicySchema
>;

export const referenceRepairModeSchema = z.enum([
  "off",
  "missing-only",
  "conflicts",
  "all",
]);
export type ReferenceRepairMode = z.infer<typeof referenceRepairModeSchema>;

export const referenceSemanticValidationModeSchema = z.enum([
  "off",
  "auto",
  "on",
]);
export type ReferenceSemanticValidationMode = z.infer<
  typeof referenceSemanticValidationModeSchema
>;

export const referenceCueKindSchema = z.enum([
  "dialogue",
  "narration",
  "lyrics-original",
  "lyrics-romanization",
  "lyrics-translation",
  "on-screen-text",
  "character-introduction",
  "credit",
  "translator-note",
  "sound-description",
  "unknown",
]);
export type ReferenceCueKind = z.infer<typeof referenceCueKindSchema>;

export const referenceCueSchema = z
  .object({
    id: z.string().min(1),
    sourceIndex: z.number().int().nonnegative(),
    interval: transcriptionIntervalSchema,
    rawText: z.string().min(1),
    normalizedText: z.string().min(1),
    detectedLanguage: languageTagSchema.nullable(),
    kind: referenceCueKindSchema,
    classificationConfidence: z.number().min(0).max(1),
    overlappingCueIds: z.array(z.string().min(1)),
    evidence: z.array(z.string().min(1)).min(1),
    timingTrust: z.enum(["trusted", "verified", "suspect"]),
  })
  .strict();
export type ReferenceCue = z.infer<typeof referenceCueSchema>;

const artifactInputSchema = z
  .object({
    referencePath: z.string().min(1),
    referenceSha256: sha256Schema,
    referenceLanguage: languageTagSchema,
    mediaDurationSeconds: z.number().positive(),
  })
  .strict();

export const referenceSubtitleAnalysisArtifactSchema = z
  .object({
    schemaVersion: versionSchema,
    generatedAt: timestampSchema,
    parserVersion: z.string().min(1),
    classifierVersion: z.string().min(1),
    timelineVersion: z.string().min(1),
    cacheKey: sha256Schema,
    cacheHit: z.boolean(),
    input: artifactInputSchema,
    format: z.enum(["srt", "vtt", "ass"]),
    configuration: z
      .object({
        timingMode: referenceTimingModeSchema,
        contentPolicy: referenceContentPolicySchema,
      })
      .strict(),
    summary: z
      .object({
        rawCueCount: z.number().int().nonnegative(),
        classifiedCueCount: z.number().int().nonnegative(),
        suspectTimingCueCount: z.number().int().nonnegative(),
        overlappingCueCount: z.number().int().nonnegative(),
      })
      .strict(),
    timingValidation: z
      .object({
        status: z.enum(["trusted", "verified", "suspect"]),
        referenceEndSeconds: z.number().nonnegative(),
        durationDeltaSeconds: z.number(),
        outOfBoundsCueCount: z.number().int().nonnegative(),
        abnormalShortCueCount: z.number().int().nonnegative(),
        duplicateEffectCueCount: z.number().int().nonnegative(),
        multiTrackIntervalCount: z.number().int().nonnegative(),
        globalOffsetSeconds: z.number().nullable(),
        driftSeconds: z.number().nullable(),
        audioEvidenceMethod: z.enum(["available", "unavailable"]),
        evidence: z.array(z.string().min(1)),
      })
      .strict(),
    fallback: z.string().min(1).nullable(),
  })
  .strict();
export type ReferenceSubtitleAnalysisArtifact = z.infer<
  typeof referenceSubtitleAnalysisArtifactSchema
>;

export const referenceCueClassificationArtifactSchema = z
  .object({
    schemaVersion: versionSchema,
    generatedAt: timestampSchema,
    input: artifactInputSchema,
    classifierVersion: z.string().min(1),
    configuration: z
      .object({
        timingMode: referenceTimingModeSchema,
      })
      .strict()
      .default({ timingMode: "auto" }),
    cues: z.array(referenceCueSchema),
    counts: z.record(referenceCueKindSchema, z.number().int().nonnegative()),
    fallback: z.string().min(1).nullable().default(null),
  })
  .strict();
export type ReferenceCueClassificationArtifact = z.infer<
  typeof referenceCueClassificationArtifactSchema
>;

export const referenceClassificationReviewArtifactSchema = z
  .object({
    schemaVersion: versionSchema,
    generatedAt: timestampSchema,
    referenceSha256: sha256Schema,
    configuration: z
      .object({
        reviewThreshold: z.number().min(0).max(1),
        lowConfidenceExpectedSpeechDisabled: z.literal(true),
      })
      .strict(),
    entries: z.array(
      z
        .object({
          cueId: z.string().min(1),
          originalKind: referenceCueKindSchema,
          refinedKind: referenceCueKindSchema,
          originalConfidence: z.number().min(0).max(1),
          refinedConfidence: z.number().min(0).max(1),
          expectedSpeech: z.boolean(),
          expectedSinging: z.boolean(),
          reviewRequired: z.boolean(),
          evidence: z.array(z.string().min(1)).min(1),
        })
        .strict(),
    ),
    summary: z
      .object({
        rawCueCount: z.number().int().nonnegative(),
        reclassifiedCueCount: z.number().int().nonnegative(),
        dialogueToCreditCount: z.number().int().nonnegative(),
        dialogueToCharacterIntroductionCount: z.number().int().nonnegative(),
        dialogueToOnScreenTextCount: z.number().int().nonnegative(),
        dialogueToUnknownCount: z.number().int().nonnegative(),
        originalRecallDenominatorCueCount: z.number().int().nonnegative(),
        refinedRecallDenominatorCueCount: z.number().int().nonnegative(),
        reviewRequiredCount: z.number().int().nonnegative(),
      })
      .strict(),
    fallback: z.string().min(1).nullable(),
  })
  .strict();

export type ReferenceClassificationReviewArtifact = z.infer<
  typeof referenceClassificationReviewArtifactSchema
>;

export const referenceAnchorKindSchema = z.enum([
  "dialogue",
  "narration",
  "lyrics-original",
  "lyrics-translation",
  "visual-text",
]);
export const referenceAnchorSchema = z
  .object({
    id: z.string().min(1),
    interval: transcriptionIntervalSchema,
    kind: referenceAnchorKindSchema,
    sourceCueIds: z.array(z.string().min(1)).min(1),
    referenceText: z.string().min(1),
    timingTrusted: z.boolean(),
    expectedSpeech: z.boolean(),
    expectedSinging: z.boolean(),
    overlappingAnchorIds: z.array(z.string().min(1)),
    evidence: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type ReferenceAnchor = z.infer<typeof referenceAnchorSchema>;

export const referenceTimelineArtifactSchema = z
  .object({
    schemaVersion: versionSchema,
    generatedAt: timestampSchema,
    input: artifactInputSchema,
    normalizationVersion: z.string().min(1),
    configuration: z
      .object({
        timingMode: referenceTimingModeSchema,
        contentPolicy: referenceContentPolicySchema,
      })
      .strict(),
    anchors: z.array(referenceAnchorSchema),
    sourceCueToAnchor: z.record(z.string().min(1), z.string().min(1)),
    lyricsGroups: z.array(
      z
        .object({
          id: z.string().min(1),
          interval: transcriptionIntervalSchema,
          originalCueIds: z.array(z.string().min(1)),
          romanizationCueIds: z.array(z.string().min(1)),
          translationCueIds: z.array(z.string().min(1)),
          selectedAnchorId: z.string().min(1),
        })
        .strict(),
    ),
    summary: z
      .object({
        rawCueCount: z.number().int().nonnegative(),
        mergedEffectCueCount: z.number().int().nonnegative(),
        dialogueAnchorCount: z.number().int().nonnegative(),
        narrationAnchorCount: z.number().int().nonnegative(),
        lyricsGroupCount: z.number().int().nonnegative(),
        lyricsOriginalCount: z.number().int().nonnegative(),
        visualTextCount: z.number().int().nonnegative(),
        creditCount: z.number().int().nonnegative(),
        translatorNoteCount: z.number().int().nonnegative(),
        unknownCount: z.number().int().nonnegative(),
      })
      .strict(),
    fallback: z.string().min(1).nullable().default(null),
  })
  .strict();
export type ReferenceTimelineArtifact = z.infer<
  typeof referenceTimelineArtifactSchema
>;

export const referenceTranscriptionStrategySchema = z.enum([
  "reference-vad",
  "reference-extra-sensitive-vad",
  "reference-vad-plus-no-vad",
  "reference-lyrics",
  "reference-original-text",
]);
export type ReferenceTranscriptionStrategy = z.infer<
  typeof referenceTranscriptionStrategySchema
>;
export const referenceTranscriptionUnitSchema = z
  .object({
    id: z.string().min(1),
    anchorIds: z.array(z.string().min(1)).min(1),
    targetInterval: transcriptionIntervalSchema,
    extractionInterval: transcriptionIntervalSchema,
    expectedCueCount: z.number().int().positive(),
    unitSizingPolicy: z
      .enum([
        "dense-dialogue",
        "normal-dialogue",
        "narration",
        "noisy-dialogue",
        "singing",
      ])
      .default("normal-dialogue"),
    anchorCount: z.number().int().positive().default(1),
    anchorDensity: z.number().nonnegative().default(0),
    targetDurationSeconds: z.number().positive().default(1),
    contextSeconds: z.number().nonnegative().max(2).default(1.5),
    sceneId: z.string().min(1).optional(),
    sceneLabel: acousticSceneLabelSchema.optional(),
    strategy: referenceTranscriptionStrategySchema,
    reasons: z.array(z.string().min(1)).min(1),
    referenceTextUsedAsTargetPrompt: z.literal(false),
  })
  .strict();
export type ReferenceTranscriptionUnit = z.infer<
  typeof referenceTranscriptionUnitSchema
>;

export const referenceTranscriptionPlanArtifactSchema = z
  .object({
    schemaVersion: versionSchema,
    generatedAt: timestampSchema,
    input: artifactInputSchema,
    guidanceMode: z.literal("reference-guided"),
    configuration: z
      .object({
        maximumUnitSeconds: z.number().positive().max(30),
        contextSeconds: z.number().nonnegative().max(2),
        maximumUnitSecondsByContent: z
          .object({
            dialogue: z.number().positive().max(30),
            narration: z.number().positive().max(30),
            lyrics: z.number().positive().max(30),
          })
          .strict()
          .default({
            dialogue: 10,
            narration: 16,
            lyrics: 25,
          }),
        denseAnchorLimit: z.number().int().positive().default(4),
      })
      .strict()
      .default({
        maximumUnitSeconds: 25,
        contextSeconds: 1.5,
        maximumUnitSecondsByContent: {
          dialogue: 10,
          narration: 16,
          lyrics: 25,
        },
        denseAnchorLimit: 4,
      }),
    maximumUnitSeconds: z.number().positive().max(30),
    contextSeconds: z.number().nonnegative().max(2),
    units: z.array(referenceTranscriptionUnitSchema),
    referenceTextUsedAsTargetPrompt: z.literal(false),
    fallback: z.string().min(1).nullable().default(null),
  })
  .strict();
export type ReferenceTranscriptionPlanArtifact = z.infer<
  typeof referenceTranscriptionPlanArtifactSchema
>;

export const referenceAlignmentMappingSchema = z.enum([
  "one-to-one",
  "one-to-many",
  "many-to-one",
  "many-to-many",
  "unmatched-reference",
  "unmatched-generated",
]);
export const referenceAlignmentEntrySchema = z
  .object({
    id: z.string().min(1),
    mapping: referenceAlignmentMappingSchema,
    referenceAnchorIds: z.array(z.string().min(1)),
    generatedCueIds: z.array(z.string().min(1)),
    interval: transcriptionIntervalSchema,
    temporalIou: z.number().min(0).max(1),
    startErrorSeconds: z.number().nullable(),
    endErrorSeconds: z.number().nullable(),
    sceneAgreement: z.boolean().nullable(),
    speechEvidence: z.enum(["supported", "unsupported", "unavailable"]),
    semanticSimilarity: z.number().min(0).max(1).nullable(),
    evidence: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type ReferenceAlignmentEntry = z.infer<
  typeof referenceAlignmentEntrySchema
>;

export const referenceCueAlignmentArtifactSchema = z
  .object({
    schemaVersion: versionSchema,
    generatedAt: timestampSchema,
    referenceSha256: sha256Schema,
    generatedSubtitleSha256: sha256Schema,
    algorithmVersion: z.string().min(1),
    configuration: z
      .object({
        boundaryToleranceSeconds: z.number().nonnegative(),
        semanticSimilarityMethod: z.enum([
          "unavailable",
          "local-model",
          "external-model",
        ]),
      })
      .strict()
      .default({
        boundaryToleranceSeconds: 0.6,
        semanticSimilarityMethod: "unavailable",
      }),
    entries: z.array(referenceAlignmentEntrySchema),
    summary: z.record(
      referenceAlignmentMappingSchema,
      z.number().int().nonnegative(),
    ),
    fallback: z.string().min(1).nullable().default(null),
  })
  .strict();
export type ReferenceCueAlignmentArtifact = z.infer<
  typeof referenceCueAlignmentArtifactSchema
>;

export const referenceDifferenceCategorySchema = z.enum([
  "TEXT_SUBSTITUTION",
  "TEXT_OMISSION",
  "TEXT_INSERTION",
  "HALLUCINATION",
  "CROSS_CUE_REPETITION",
  "MISSING_DIALOGUE",
  "MISSING_LYRICS",
  "TIMING_START_ERROR",
  "TIMING_END_ERROR",
  "OVERMERGE",
  "OVERSPLIT",
  "STYLE_MISMATCH",
  "REFERENCE_EDITORIAL_DIFFERENCE",
  "ACCEPTABLE_VARIANT",
  "REFERENCE_POSSIBLE_ERROR",
]);

export const referenceCoverageFindingCodeSchema = z.enum([
  "REFERENCE_DIALOGUE_UNCOVERED",
  "REFERENCE_NARRATION_UNCOVERED",
  "REFERENCE_LYRICS_UNCOVERED",
  "REFERENCE_UNSUPPORTED_INSERTION",
  "REFERENCE_TIMING_AUDIO_CONFLICT",
  "REFERENCE_SEMANTIC_CONFLICT",
  "REFERENCE_CUE_CLASSIFICATION_UNCERTAIN",
  "REFERENCE_DUPLICATE_EFFECT_CUES",
]);
const coverageFindingSchema = z
  .object({
    id: z.string().min(1),
    code: referenceCoverageFindingCodeSchema,
    interval: transcriptionIntervalSchema,
    anchorIds: z.array(z.string().min(1)),
    cueIds: z.array(z.string().min(1)),
    activeReview: z.boolean(),
    evidence: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const referenceCoverageIntegrityArtifactSchema = z
  .object({
    schemaVersion: versionSchema,
    generatedAt: timestampSchema,
    referenceSha256: sha256Schema,
    generatedSubtitleSha256: sha256Schema,
    configuration: z
      .object({
        coverageRule: z.literal("temporal-alignment"),
        promoteUncoveredToActiveReview: z.boolean(),
      })
      .strict()
      .default({
        coverageRule: "temporal-alignment",
        promoteUncoveredToActiveReview: false,
      }),
    validationStatus: z.enum(["passed", "needs-review"]),
    findings: z.array(coverageFindingSchema),
    summary: z
      .object({
        trustedExpectedAnchors: z.number().int().nonnegative(),
        coveredAnchors: z.number().int().nonnegative(),
        uncoveredWithActiveReview: z.number().int().nonnegative(),
        uncoveredWithoutReview: z.number().int().nonnegative(),
        unsupportedInsertions: z.number().int().nonnegative(),
      })
      .strict(),
    fallback: z.string().min(1).nullable().default(null),
  })
  .strict();
export type ReferenceCoverageIntegrityArtifact = z.infer<
  typeof referenceCoverageIntegrityArtifactSchema
>;

export const subtitleEvaluationArtifactSchema = z
  .object({
    schemaVersion: versionSchema,
    generatedAt: timestampSchema,
    referenceSha256: sha256Schema,
    generatedSubtitleSha256: sha256Schema,
    guidanceMode: transcriptionGuidanceModeSchema,
    configuration: z
      .object({
        referenceIsStrongEvidenceNotAbsoluteTruth: z.literal(true),
      })
      .strict()
      .default({ referenceIsStrongEvidenceNotAbsoluteTruth: true }),
    metrics: z
      .object({
        dialogueAnchorRecall: z.number().min(0).max(1).nullable(),
        narrationAnchorRecall: z.number().min(0).max(1).nullable(),
        lyricsAnchorRecall: z.number().min(0).max(1).nullable(),
        referenceDurationCoverage: z.number().min(0).max(1),
        generatedDurationCoverage: z.number().min(0).max(1),
        unmatchedReferenceAnchors: z.number().int().nonnegative(),
        unmatchedGeneratedCues: z.number().int().nonnegative(),
        medianStartErrorSeconds: z.number().nonnegative().nullable(),
        medianEndErrorSeconds: z.number().nonnegative().nullable(),
        timingIouDistribution: z
          .object({
            below025: z.number().int().nonnegative(),
            from025To05: z.number().int().nonnegative(),
            from05To075: z.number().int().nonnegative(),
            atLeast075: z.number().int().nonnegative(),
          })
          .strict(),
        overmergeCount: z.number().int().nonnegative(),
        oversplitCount: z.number().int().nonnegative(),
        exactDuplicateCount: z.number().int().nonnegative(),
        sentenceLoopCount: z.number().int().nonnegative(),
        longPhraseLoopCount: z.number().int().nonnegative(),
        duplicateAssLineCount: z.number().int().nonnegative(),
        missingDialogueDurationSeconds: z.number().nonnegative(),
        missingLyricsDurationSeconds: z.number().nonnegative(),
        falseQuarantineCount: z.number().int().nonnegative(),
        falseAcceptanceCount: z.number().int().nonnegative(),
      })
      .strict(),
    fallback: z.string().min(1).nullable().default(null),
    differences: z.array(
      z
        .object({
          id: z.string().min(1),
          category: referenceDifferenceCategorySchema,
          alignmentId: z.string().min(1),
          interval: transcriptionIntervalSchema,
          evidence: z.array(z.string().min(1)).min(1),
        })
        .strict(),
    ),
    semanticValidation: z
      .object({
        method: z.enum(["unavailable", "local-model", "external-model"]),
        reason: z.string().min(1).nullable(),
        evaluatedAlignmentCount: z.number().int().nonnegative(),
        entityAgreement: z.number().min(0).max(1).nullable(),
        numberAgreement: z.number().min(0).max(1).nullable(),
        negationConflictCount: z.number().int().nonnegative().nullable(),
      })
      .strict(),
  })
  .strict();
export type SubtitleEvaluationArtifact = z.infer<
  typeof subtitleEvaluationArtifactSchema
>;

export const referenceSemanticValidationArtifactSchema = z
  .object({
    schemaVersion: versionSchema,
    generatedAt: timestampSchema,
    referenceSha256: sha256Schema,
    generatedSubtitleSha256: sha256Schema,
    mode: referenceSemanticValidationModeSchema,
    configuration: z
      .object({
        requestedMode: referenceSemanticValidationModeSchema,
      })
      .strict()
      .default({ requestedMode: "auto" }),
    method: z.enum(["unavailable", "local-model", "external-model"]),
    reason: z.string().min(1).nullable(),
    results: z.array(
      z
        .object({
          alignmentId: z.string().min(1),
          semanticSimilarity: z.number().min(0).max(1).nullable(),
          entityAgreement: z.boolean().nullable(),
          numberAgreement: z.boolean().nullable(),
          negationConflict: z.boolean().nullable(),
        })
        .strict(),
    ),
    fallback: z.string().min(1).nullable().default(null),
  })
  .strict();

export const quarantineEvaluationSchema = z.enum([
  "true-quarantine",
  "false-quarantine",
  "false-acceptance",
  "unresolved",
]);
export const falseQuarantineReportArtifactSchema = z
  .object({
    schemaVersion: versionSchema,
    generatedAt: timestampSchema,
    referenceSha256: sha256Schema,
    generatedSubtitleSha256: sha256Schema,
    configuration: z
      .object({
        referenceIsStrongEvidenceNotAbsoluteTruth: z.literal(true),
      })
      .strict()
      .default({ referenceIsStrongEvidenceNotAbsoluteTruth: true }),
    inspectedLayers: z.array(
      z.enum([
        "raw-vad",
        "raw-no-vad",
        "large-v3-refinement",
        "recovery",
        "canonical-rejected",
        "quarantined",
        "final-accepted",
      ]),
    ),
    entries: z.array(
      z
        .object({
          id: z.string().min(1),
          layer: z.string().min(1),
          interval: transcriptionIntervalSchema,
          cueId: z.string().min(1).nullable(),
          evaluation: quarantineEvaluationSchema,
          anchorIds: z.array(z.string().min(1)),
          evidence: z.array(z.string().min(1)).min(1),
        })
        .strict(),
    ),
    summary: z.record(
      quarantineEvaluationSchema,
      z.number().int().nonnegative(),
    ),
    unavailableLayers: z.array(z.string().min(1)),
    fallback: z.string().min(1).nullable().default(null),
  })
  .strict();
export type FalseQuarantineReportArtifact = z.infer<
  typeof falseQuarantineReportArtifactSchema
>;

export const blindGenerationProofArtifactSchema = z
  .object({
    schemaVersion: versionSchema,
    guidanceMode: z.enum(["reference-free", "reference-assisted"]),
    referencePathKnownBeforeGeneration: z.boolean(),
    referenceOpenedBeforeGeneration: z.literal(false),
    referenceTimingUsedByAsr: z.literal(false),
    referenceTextUsedByAsr: z.literal(false),
    referenceTextUsedAsPrompt: z.literal(false),
    generatedSubtitleSha256: sha256Schema,
    canonicalTranscriptSha256: sha256Schema,
    configuration: z
      .object({
        isolationPhase: z.literal("blind-generation"),
      })
      .strict()
      .default({ isolationPhase: "blind-generation" }),
    fallback: z.string().min(1).nullable().default(null),
    completedAt: timestampSchema,
  })
  .strict();
export type BlindGenerationProofArtifact = z.infer<
  typeof blindGenerationProofArtifactSchema
>;

export const discoveredSpeechAnchorSchema = z
  .object({
    id: z.string().min(1),
    interval: transcriptionIntervalSchema,
    sources: z
      .array(
        z.enum([
          "vad",
          "extra-sensitive-vad",
          "vocal-detector",
          "scene-analysis",
          "no-vad-probe",
          "token-timestamps",
          "lyrics-detector",
        ]),
      )
      .min(1),
    speechProbability: z.number().min(0).max(1),
    vocalProbability: z.number().min(0).max(1),
    expectedContent: z.enum(["dialogue", "singing", "uncertain"]),
    confidence: z.number().min(0).max(1),
    evidence: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type DiscoveredSpeechAnchor = z.infer<
  typeof discoveredSpeechAnchorSchema
>;

export const discoveredSpeechAnchorsArtifactSchema = z
  .object({
    schemaVersion: versionSchema,
    generatedAt: timestampSchema,
    sourceAudioSha256: sha256Schema,
    discoveryVersion: z.string().min(1),
    configuration: z
      .object({
        highConfidenceThreshold: z.number().min(0).max(1),
      })
      .strict()
      .default({ highConfidenceThreshold: 0.75 }),
    anchors: z.array(discoveredSpeechAnchorSchema),
    summary: z
      .object({
        total: z.number().int().nonnegative(),
        dialogue: z.number().int().nonnegative(),
        singing: z.number().int().nonnegative(),
        uncertain: z.number().int().nonnegative(),
        highConfidence: z.number().int().nonnegative(),
      })
      .strict(),
    fallback: z.string().min(1).nullable().default(null),
  })
  .strict();
export type DiscoveredSpeechAnchorsArtifact = z.infer<
  typeof discoveredSpeechAnchorsArtifactSchema
>;

export const anchorCoverageFindingCodeSchema = z.enum([
  "DISCOVERED_SPEECH_ANCHOR_UNCOVERED",
  "DISCOVERED_SINGING_ANCHOR_UNCOVERED",
  "ANCHOR_FINAL_CUE_COVERAGE_INSUFFICIENT",
]);
export const anchorCoverageIntegrityArtifactSchema = z
  .object({
    schemaVersion: versionSchema,
    generatedAt: timestampSchema,
    sourceAudioSha256: sha256Schema,
    configuration: z
      .object({
        highConfidenceThreshold: z.number().min(0).max(1),
        minimumCoverageRatio: z.number().min(0).max(1),
      })
      .strict()
      .default({
        highConfidenceThreshold: 0.75,
        minimumCoverageRatio: 0.2,
      }),
    validationStatus: z.enum(["passed", "needs-review"]),
    findings: z.array(
      z
        .object({
          id: z.string().min(1),
          code: anchorCoverageFindingCodeSchema,
          interval: transcriptionIntervalSchema,
          anchorId: z.string().min(1),
          cueIds: z.array(z.string().min(1)),
          coverageRatio: z.number().min(0).max(1),
          activeReview: z.boolean(),
          evidence: z.array(z.string().min(1)).min(1),
        })
        .strict(),
    ),
    summary: z
      .object({
        highConfidenceAnchors: z.number().int().nonnegative(),
        coveredAnchors: z.number().int().nonnegative(),
        uncoveredWithActiveReview: z.number().int().nonnegative(),
        uncoveredWithoutReview: z.number().int().nonnegative(),
      })
      .strict(),
    fallback: z.string().min(1).nullable().default(null),
  })
  .strict();
export type AnchorCoverageIntegrityArtifact = z.infer<
  typeof anchorCoverageIntegrityArtifactSchema
>;

export const referenceAwareSubtitleCueSchema = subtitleCueSchema;

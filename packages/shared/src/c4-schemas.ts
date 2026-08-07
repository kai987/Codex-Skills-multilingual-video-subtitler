import { z } from "zod";

import { referenceCueKindSchema } from "./reference-schemas.js";
import {
  finalSubtitleRepairArtifactSchema,
  finalTextIntegrityArtifactSchema,
  japaneseLexicalNormalizationArtifactSchema,
  lineLayoutIntegrityArtifactSchema,
  textIntegrityRepairArtifactSchema,
} from "./text-quality-schemas.js";
import {
  finalSubtitleIntegrityArtifactSchema,
  whisperExecutionMetricsSchema,
} from "./transcription-schemas.js";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const countSchema = z.number().int().nonnegative();
const sourceVideoSchema = z
  .object({
    path: z.string().min(1),
    sha256: sha256Schema,
    sizeBytes: countSchema,
    inode: countSchema,
    mtimeMs: z.number().nonnegative(),
  })
  .strict();

const coverageKindSchema = z
  .object({
    temporalRecall: z.number().min(0).max(1),
    validTextRecall: z.number().min(0).max(1),
    verifiedTextRecall: z.number().min(0).max(1),
  })
  .strict();

export const c4ReplayReportArtifactSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    generatedAt: z.iso.datetime(),
    runType: z.literal("C4 cached coverage-recovery replay"),
    sourceC3: z.string().min(1),
    outputDirectory: z.string().min(1),
    wholeEpisodeWhisperExecuted: z.literal(false),
    targetedAsrExecuted: z.boolean(),
    statistics: z
      .object({
        c3CandidateCount: countSchema,
        targetedCandidateCount: countSchema,
        atomicCandidateCount: countSchema,
        atomicClusterCount: countSchema,
        topScoreWinnerCount: countSchema,
        c3TextQuarantineCount: countSchema,
        preliminaryTextFindingCount: countSchema,
        textRepairAttemptedCount: countSchema,
        textRepairSucceededCount: countSchema,
        textStillHardBlockedCount: countSchema,
        textRepairStrategies: z.record(z.string().min(1), countSchema),
        c3SubtitleFindingCount: countSchema,
        preliminarySubtitleFindingCount: countSchema,
        subtitleRepairSucceededCount: countSchema,
        subtitleRepairStrategies: z.record(z.string().min(1), countSchema),
        normalizationChangedCueCount: countSchema,
        kanaToKanjiCount: countSchema,
        dialectPreservedCount: countSchema,
        referenceReclassifiedCount: countSchema,
        referenceReclassifiedCueIds: z.array(z.string().min(1)),
        referenceClassificationCounts: z.record(
          referenceCueKindSchema,
          countSchema,
        ),
        expectedSpeechDenominator: countSchema,
        coverageRecoveryUnitCount: countSchema,
        coverageRecoveryAutomaticRequestCount: countSchema,
        coverageRecoveryPriorityCounts: z.record(
          z.enum(["P0", "P1", "P2", "P3", "P4"]),
          countSchema,
        ),
        targetedAsrRequestCount: countSchema,
        targetedAsrCacheHitCount: countSchema,
        acceptedTargetedCandidateCount: countSchema,
        c3FinalCueCount: countSchema,
        finalCueCount: countSchema,
        finalCueIncrease: z.number().int(),
        c3MissingDialogueGroupCount: countSchema,
        trueMissingDialogueGroupCount: countSchema,
        anchorCoverage: z
          .object({
            expectedAnchors: countSchema,
            temporalCovered: countSchema,
            validTextCovered: countSchema,
            verifiedTextCovered: countSchema,
            activeReview: countSchema,
            uncovered: countSchema,
            dialogue: coverageKindSchema,
            narration: coverageKindSchema,
            lyrics: coverageKindSchema,
          })
          .strict(),
        finalHardIntegrityErrorCount: countSchema,
        visualLineWordBreakCount: countSchema,
        invalidTimestampCount: countSchema,
        overlapCount: countSchema,
        characterRatioFallbackCount: countSchema,
      })
      .strict(),
    repairDetails: z
      .object({
        text: textIntegrityRepairArtifactSchema.shape.repairs,
        subtitle: finalSubtitleRepairArtifactSchema.shape.repairs,
        reclassifiedReferenceCues: z.array(
          z
            .object({
              cueId: z.string().min(1),
              before: z.string().min(1),
              after: referenceCueKindSchema,
              confidence: z.number().min(0).max(1),
              text: z.string().min(1),
            })
            .strict(),
        ),
        normalizationChanges:
          japaneseLexicalNormalizationArtifactSchema.shape.cues,
      })
      .strict(),
    sourceVideo: sourceVideoSchema,
    wallClockSeconds: z.number().nonnegative(),
  })
  .strict();

export type C4ReplayReportArtifact = z.infer<
  typeof c4ReplayReportArtifactSchema
>;

export const c4FinalOutputAuditArtifactSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    generatedAt: z.iso.datetime(),
    finalTextIntegrity: finalTextIntegrityArtifactSchema,
    finalSubtitleIntegrity: finalSubtitleIntegrityArtifactSchema,
    lineLayoutIntegrity: lineLayoutIntegrityArtifactSchema,
    acceptedCueCount: countSchema,
    finalHardIntegrityErrorCount: countSchema,
    characterRatioFallbackCount: countSchema,
    subtitleHashes: z
      .object({ srt: sha256Schema, vtt: sha256Schema, ass: sha256Schema })
      .strict(),
    sourceVideo: sourceVideoSchema,
  })
  .strict();

export type C4FinalOutputAuditArtifact = z.infer<
  typeof c4FinalOutputAuditArtifactSchema
>;

export const c4PersistentWorkerVerificationArtifactSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    verificationKind: z.literal(
      "all-c4-targeted-requests-single-persistent-worker",
    ),
    generatedAt: z.iso.datetime(),
    authoritativeCandidateSource: z.literal(false),
    note: z.string().min(1),
    sourceResultPath: z.string().min(1),
    requestCount: countSchema,
    resultCount: countSchema,
    execution: whisperExecutionMetricsSchema,
    results: z.array(
      z
        .object({
          round: z.number().int().min(1).max(2),
          unitId: z.string().min(1),
          requestId: z.string().min(1),
          duration: z.number().positive(),
          segmentCount: countSchema,
          textSha256: sha256Schema,
        })
        .strict(),
    ),
  })
  .strict();

export type C4PersistentWorkerVerificationArtifact = z.infer<
  typeof c4PersistentWorkerVerificationArtifactSchema
>;

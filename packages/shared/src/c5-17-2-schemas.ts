import { z } from "zod";

import { subtitleIntervalSchema } from "./finalization-schemas.js";
import { schemaVersionSchema } from "./schemas.js";

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const relativePathSchema = z
  .string()
  .min(1)
  .regex(/^(?!\/)(?![A-Za-z]:[\\/])(?!\\\\).+/u, "Path must be relative.");

export const reviewAudioModeSchema = z.enum([
  "auto",
  "generate",
  "reuse-only",
  "off",
]);

export const reviewEvidenceReconciliationModeSchema = z.enum([
  "off",
  "observe",
  "enforce",
]);

export const reviewDeliveryIntegrityModeSchema = z.enum([
  "off",
  "observe",
  "enforce",
]);

export const subtitleReviewDeliveryIntegrityItemSchema = z
  .object({
    reviewId: z.string().min(1),
    componentId: z.string().min(1),
    cueIds: z.array(z.string().min(1)).min(1),
    componentUnionInterval: subtitleIntervalSchema,
    audioClipPath: relativePathSchema.nullable(),
    audioIncludedInShareable: z.boolean().default(false),
    audioFileName: z.string().min(1).nullable(),
    audioDurationSeconds: z.number().nonnegative().nullable(),
    audioFileExists: z.boolean(),
    audioPathIsRelative: z.boolean(),
    audioPathWithinTaskRoot: z.boolean(),
    audioHashExpected: hashSchema.nullable(),
    audioHashActual: hashSchema.nullable(),
    audioHashMatches: z.boolean(),
    audioMetadataValid: z.boolean(),
    audioFullyCoversComponent: z.boolean(),
    rootReviewPackageMatchesReviewDataCopy: z.boolean(),
    mappedTokenEvidenceResolved: z.boolean(),
    rawVadEvidenceResolved: z.boolean(),
    decodedSegmentEvidenceResolved: z.boolean(),
    mfaEvidenceResolved: z.boolean(),
    evidenceDpResolved: z.boolean(),
    legacyProjectionConsistent: z.boolean(),
    reviewPageAudioResolvable: z.boolean(),
    reviewPageEvidenceResolvable: z.boolean(),
    deliveryPassed: z.boolean(),
    failures: z.array(z.string().min(1)),
  })
  .strict();

export const subtitleReviewDeliveryIntegritySchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("subtitle-review-delivery-integrity"),
    deliveryVersion: z.literal("C5.17.2"),
    policyVersion: z.literal("c5.17.2-review-delivery-integrity-v1"),
    generatedAt: z.iso.datetime(),
    sourceTaskIdentity: z
      .object({
        taskName: z.string().min(1),
        sourceReviewPackageHash: hashSchema,
        sourceFinalizationReportHash: hashSchema,
      })
      .strict(),
    baseCueHash: hashSchema,
    baseTimingHash: hashSchema,
    reviewPackageHash: hashSchema,
    finalizationReportHash: hashSchema,
    evidenceReconciliationHash: hashSchema,
    items: z.array(subtitleReviewDeliveryIntegrityItemSchema),
    crossArtifactChecks: z
      .object({
        rootReviewPackageMatchesReviewDataCopy: z.boolean(),
        reviewSummaryMatchesItems: z.boolean(),
        finalizationMetricsMatchReviewSummary: z.boolean(),
        reviewPageAssetsPresent: z.boolean(),
        reviewPageAudioReferencesResolvable: z.boolean(),
        reviewPageEvidenceReferencesResolvable: z.boolean(),
        shareableContainsNoAudio: z.boolean(),
        shareableContainsNoBrokenAudioReference: z.boolean(),
        canonicalCueHashUnchanged: z.boolean(),
        canonicalTimingHashUnchanged: z.boolean(),
      })
      .strict(),
    summary: z
      .object({
        itemCount: z.number().int().nonnegative(),
        passedItemCount: z.number().int().nonnegative(),
        failedItemCount: z.number().int().nonnegative(),
        reviewAudioPhysicalFileCount: z.number().int().nonnegative(),
        reviewAudioReferencedCount: z.number().int().nonnegative(),
        reviewAudioPlayableCount: z.number().int().nonnegative(),
        reviewAudioReusedExistingCount: z.number().int().nonnegative(),
        reviewAudioReusedOverlapCount: z.number().int().nonnegative(),
        reviewAudioGeneratedCount: z.number().int().nonnegative(),
        reviewAudioHashMismatchCount: z.number().int().nonnegative(),
        reviewAudioCoverageFailureCount: z.number().int().nonnegative(),
        reviewAudioMetadataFailureCount: z.number().int().nonnegative(),
        mappedTokenEvidenceCount: z.number().int().nonnegative(),
        rawVadEvidenceCount: z.number().int().nonnegative(),
        decodedSegmentEvidenceCount: z.number().int().nonnegative(),
        mappedTokenBoundaryCopiedFromEvidenceDpCount: z
          .number()
          .int()
          .nonnegative(),
        decodedSegmentMislabelledAsRawVadCount: z.number().int().nonnegative(),
        unresolvedEvidenceReferenceCount: z.number().int().nonnegative(),
        rootReviewDataMismatchCount: z.number().int().nonnegative(),
        finalizationReviewMetricMismatchCount: z.number().int().nonnegative(),
        reviewPageBrokenAudioReferenceCount: z.number().int().nonnegative(),
        reviewDeliveryIntegrityPassed: z.boolean(),
      })
      .strict(),
    failures: z.array(z.string().min(1)),
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

export const c5172ReviewDeliveryReplaySummarySchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("c5-17-2-review-delivery-replay-summary"),
    replayVersion: z.literal("C5.17.2"),
    generatedAt: z.iso.datetime(),
    sourceTaskName: z.string().min(1),
    outputTaskName: z.string().min(1),
    reviewAudioMode: reviewAudioModeSchema,
    reviewEvidenceReconciliation: reviewEvidenceReconciliationModeSchema,
    reviewDeliveryIntegrity: reviewDeliveryIntegrityModeSchema,
    reviewPageTimeline: z.boolean(),
    sourceReviewPackageHash: hashSchema,
    sourceFinalizationReportHash: hashSchema,
    outputReviewPackageHash: hashSchema,
    outputFinalizationReportHash: hashSchema,
    reviewPackageSemanticHash: hashSchema,
    finalizationSemanticHash: hashSchema,
    reviewAudioHashes: z.array(
      z
        .object({
          reviewId: z.string().min(1),
          sha256: hashSchema.nullable(),
        })
        .strict(),
    ),
    evidenceReconciliationHash: hashSchema,
    deliveryIntegritySemanticHash: hashSchema,
    canonicalCueHashBefore: hashSchema,
    canonicalCueHashAfter: hashSchema,
    canonicalTimingHashBefore: hashSchema,
    canonicalTimingHashAfter: hashSchema,
    presentationHashBefore: hashSchema,
    presentationHashAfter: hashSchema,
    reviewPageAssetsHash: hashSchema,
    sourceTaskCriticalArtifactsReadOnly: z.boolean(),
    sourceVideoReadOnly: readOnlyIdentitySchema.nullable(),
    humanSubtitleReadOnly: readOnlyIdentitySchema.nullable(),
    execution: z
      .object({
        mfaProcessCount: z.literal(0),
        whisperProcessCount: z.literal(0),
        sudachiProcessCount: z.literal(0),
        g2pProcessCount: z.literal(0),
        ffmpegProcessCount: z.literal(0),
        wholeMediaAsrRequestCount: z.literal(0),
        openAiRequestCount: z.literal(0),
        onlineSubtitleLookupCount: z.literal(0),
      })
      .strict(),
    outcome: z
      .object({
        cueCount: z.number().int().nonnegative(),
        reviewItemCount: z.number().int().nonnegative(),
        reviewAudioPlayableCount: z.number().int().nonnegative(),
        reviewDeliveryIntegrityPassed: z.boolean(),
        finalStatus: z.literal("needs-review"),
        finalizationMethod: z.literal("none"),
      })
      .strict(),
    semanticHash: hashSchema,
  })
  .strict();

export type ReviewAudioMode = z.infer<typeof reviewAudioModeSchema>;
export type ReviewEvidenceReconciliationMode = z.infer<
  typeof reviewEvidenceReconciliationModeSchema
>;
export type ReviewDeliveryIntegrityMode = z.infer<
  typeof reviewDeliveryIntegrityModeSchema
>;
export type SubtitleReviewDeliveryIntegrity = z.infer<
  typeof subtitleReviewDeliveryIntegritySchema
>;
export type C5172ReviewDeliveryReplaySummary = z.infer<
  typeof c5172ReviewDeliveryReplaySummarySchema
>;

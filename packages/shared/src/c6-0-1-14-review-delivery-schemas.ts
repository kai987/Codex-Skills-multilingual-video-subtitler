import { z } from "zod";
import {
  c60113ReviewItemV3Schema,
  c60113Sha256Schema,
  c60113CountSchema,
  c60113RatioSchema,
  c60113PriorityVectorSchema,
} from "./c6-0-1-13-review-rank-schemas.js";
import {
  reviewItemTypeSchema,
  reviewRequiredLevelSchema,
} from "./c6-0-1-12-review-assistance-schemas.js";
import {
  c60114IntervalSchema,
  c60114SourceIdentitySchema,
} from "./c6-0-1-14-evidence-schemas.js";

const hash = c60113Sha256Schema;
const count = c60113CountSchema;
const ratio = c60113RatioSchema;
const ids = z.array(z.string().min(1));
export const c60114DeliveryHeader = {
  schemaVersion: z.literal("1.0.0"),
  policyVersion: z.literal(
    "c6.0.1.14-missing-localization-playback-integrity-v1",
  ),
  policyHash: hash,
  sourceIdentity: c60114SourceIdentitySchema,
  sourceTimebase: z.literal("SOURCE_GLOBAL_SECONDS"),
  runtimeGoldInputCount: z.literal(0),
};

export const c60114ReviewItemTypeSchema = z.union([
  reviewItemTypeSchema,
  z.enum([
    "MISSING_SPEECH_ISLAND_REVIEW",
    "ORPHAN_SPEECH_REVIEW",
    "MISSING_LOCAL_ASR_DISAGREEMENT",
    "MISSING_LOCAL_ASR_EMPTY",
    "HALLUCINATION_AUDIO_TARGET_REPAIR",
    "REVIEW_AUDIO_COVERAGE_RISK",
  ]),
]);
export const c60114ReviewItemV4Schema = c60113ReviewItemV3Schema.extend({
  itemTypes: z.array(c60114ReviewItemTypeSchema).min(1),
  reviewTargetIds: ids,
  sourceIntervals: z.array(c60114IntervalSchema),
  origin: z.enum(["MIGRATED_C60113", "SPEECH_ISLAND", "ORPHAN_SPEECH"]),
  speechIslandIds: ids,
  orphanIds: ids,
  missingClassificationV3: z.string().min(1).nullable(),
  legacyItemIds: ids,
  canonicalMutationAllowed: z.literal(false),
});
export const c60114ReviewItemsV4Schema = z
  .object({
    ...c60114DeliveryHeader,
    artifactType: z.literal("machine-review-items-v4"),
    previousItemsHash: hash,
    targetsHash: hash,
    missingEvidenceHash: hash,
    items: z.array(c60114ReviewItemV4Schema),
    summary: z
      .object({
        previousItemCount: count,
        itemCount: count,
        migratedItemCount: count,
        createdItemCount: count,
        orphanItemCount: count,
        requiredItemCount: count,
        previousItemsDeleted: z.literal(0),
        canonicalTextMutationCount: z.literal(0),
        canonicalTimingMutationCount: z.literal(0),
      })
      .strict(),
    semanticHash: hash,
  })
  .strict();

export const c60114TargetCoverageCheckSchema = z
  .object({
    reviewTargetId: z.string().min(1),
    mandatoryForAudio: z.boolean(),
    audioRequired: z.boolean().optional(),
    coverageRatio: ratio,
    fullyCovered: z.boolean(),
  })
  .strict();
export const c60114ReviewRegionV3Schema = z
  .object({
    regionId: z.string().min(1),
    reviewTargetIds: ids.min(1),
    reviewItemIds: ids.min(1),
    sourceIntervals: z.array(c60114IntervalSchema).min(1),
    contextIntervals: z.array(c60114IntervalSchema).min(1),
    playbackIntervals: z.array(c60114IntervalSchema).min(1),
    targetCoverageChecks: z.array(c60114TargetCoverageCheckSchema),
    requiredLevel: reviewRequiredLevelSchema,
    priorityMetadata: z
      .object({
        rankerStatus: z.literal("RANKER_NOT_RECALIBRATED_IN_C6_0_1_14"),
        rankPosition: z.number().int().positive(),
        inheritedItemScore: z.number().min(0).max(100),
        safetyClass: z.enum(["REQUIRED", "RECOMMENDED", "INFORMATIONAL"]),
        legacyItemRank: z.number().int().positive(),
        r3PolicyHash: hash,
        r3EvidenceFamiliesHash: hash,
        r3Ranker: z.literal("REGION_RISK_DENSITY_V3"),
        inputDerivation: z.literal(
          "EXISTING_R3_EVIDENCE_GRAPH_AND_ATOMIC_TARGET_REGION_PROJECTION",
        ),
        scoreMeaning: z.literal("EXPLAINABLE_RANKING_SCORE_NOT_PROBABILITY"),
        utility: z.number().nonnegative(),
        uniqueAudioCostSeconds: z.number().nonnegative(),
        reviewCostSeconds: z.number().positive(),
        rankScore: z.number().nonnegative(),
        riskCoverageKeys: ids,
        actionableCoverageKeys: ids,
        mandatoryReasons: ids,
        priorityVector: c60113PriorityVectorSchema,
      })
      .strict(),
    sourceIdentity: c60114SourceIdentitySchema,
    semanticHash: hash,
  })
  .strict();
export const c60114ReviewRegionsV3Schema = z
  .object({
    ...c60114DeliveryHeader,
    artifactType: z.literal("machine-review-regions-v3"),
    targetsHash: hash,
    itemsHash: hash,
    regions: z.array(c60114ReviewRegionV3Schema),
    summary: z
      .object({
        regionCount: count,
        targetCount: count,
        mappedTargetCount: count,
        disjointItemCount: count,
        disjointRegionSplitCount: count,
        requiredRegionCount: count,
        targetCoverageRatio: ratio,
      })
      .strict(),
    semanticHash: hash,
  })
  .strict();

const relativePath = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !/^[A-Za-z]:[\\/]/u.test(value) &&
      !value.split(/[\\/]/u).includes("..") &&
      !value.includes("\0"),
    "Unsafe relative artifact path",
  );
export const c60114PhysicalAudioSchema = z
  .object({
    audioId: z.string().min(1),
    relativePath,
    sourceMediaSha256: hash,
    sourceIdentity: c60114SourceIdentitySchema,
    sourceInterval: c60114IntervalSchema,
    requestedInterval: c60114IntervalSchema,
    actualSourceInterval: c60114IntervalSchema.optional(),
    requestedSourceInterval: c60114IntervalSchema.optional(),
    sampleRate: z.literal(16000),
    channels: z.literal(1),
    bitDepth: z.literal(16),
    codec: z.literal("pcm_s16le"),
    frameCount: z.number().int().positive(),
    actualDuration: z.number().positive(),
    sha256: hash,
    playable: z.literal(true),
    hashVerified: z.literal(true),
    physicalMetadataVerified: z.literal(true),
    coveredReviewTargetIds: ids,
    regionIds: ids.min(1),
    semanticHash: hash,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.actualSourceInterval &&
        (value.actualSourceInterval.start !== value.sourceInterval.start ||
          value.actualSourceInterval.end !== value.sourceInterval.end)) ||
      (value.requestedSourceInterval &&
        (value.requestedSourceInterval.start !==
          value.requestedInterval.start ||
          value.requestedSourceInterval.end !== value.requestedInterval.end))
    )
      context.addIssue({
        code: "custom",
        message:
          "Explicit physical source intervals disagree with legacy aliases",
      });
    if (
      Math.abs(value.actualDuration - value.frameCount / value.sampleRate) >
        1e-8 ||
      Math.abs(
        value.sourceInterval.end -
          value.sourceInterval.start -
          value.actualDuration,
      ) > 1e-8
    ) {
      context.addIssue({
        code: "custom",
        message: "Audio source mapping differs from physical frame duration",
      });
    }
    if (value.sourceMediaSha256 !== value.sourceIdentity.sourceMediaSha256) {
      context.addIssue({
        code: "custom",
        message: "Physical audio source identity mismatch",
      });
    }
  });
export const c60114ReviewAudioManifestV3Schema = z
  .object({
    ...c60114DeliveryHeader,
    artifactType: z.literal("machine-review-audio-manifest-v3"),
    regionsHash: hash,
    deliverySubsystemVersion: z.literal("C6.0.1.12_REVIEW_AUDIO"),
    extractionPolicy: z.literal(
      "existing-deterministic-pcm16k-source-extraction",
    ),
    audio: z.array(c60114PhysicalAudioSchema),
    targetCoverageChecks: z.array(c60114TargetCoverageCheckSchema),
    summary: z
      .object({
        plannedAudioCount: count,
        actualAudioCount: count,
        extractionFailureCount: count,
        playableCount: count,
        hashVerifiedCount: count,
        mandatoryTargetCount: count,
        coveredMandatoryTargetCount: count,
        allTargetCount: count,
        coveredTargetCount: count,
        targetCoveragePassed: z.boolean(),
        clipSumSeconds: z.number().nonnegative(),
        networkUsed: z.literal(false),
      })
      .strict(),
    semanticHash: hash,
  })
  .strict();
export const c60114PlaybackSegmentSchema = z
  .object({
    playbackSegmentId: z.string().min(1),
    audioId: z.string().min(1),
    sourceInterval: c60114IntervalSchema,
    audioLocalInterval: c60114IntervalSchema,
    reviewTargetIds: ids,
    reviewItemIds: ids,
    regionIds: ids.min(1),
    sourceIdentity: c60114SourceIdentitySchema,
    semanticHash: hash,
  })
  .strict();
export const c60114PlaybackPlanSchema = z
  .object({
    planId: z.enum([
      "UNIQUE_AUDIO_10_PERCENT",
      "UNIQUE_AUDIO_20_PERCENT",
      "UNIQUE_AUDIO_30_PERCENT",
      "UNIQUE_AUDIO_40_PERCENT",
      "UNIQUE_AUDIO_50_PERCENT",
      "ALL_MANDATORY",
      "FULL_QUEUE",
    ]),
    budgetSeconds: z.number().nonnegative().nullable(),
    regionIds: ids,
    reviewTargetIds: ids,
    reviewItemIds: ids,
    playbackSegmentIds: ids,
    audioIds: ids,
    physicalAudioSha256s: z.array(hash),
    sourceIntervalUnion: z.array(c60114IntervalSchema),
    uniqueAudioSeconds: z.number().nonnegative(),
    rankerStatus: z.literal("RANKER_NOT_RECALIBRATED_IN_C6_0_1_14"),
    semanticHash: hash,
  })
  .strict();
export const c60114PlaybackTimelineV2Schema = z
  .object({
    ...c60114DeliveryHeader,
    artifactType: z.literal("machine-review-playback-timeline-v2"),
    audioManifestHash: hash,
    regionsHash: hash,
    targetsHash: hash,
    segments: z.array(c60114PlaybackSegmentSchema),
    plans: z.array(c60114PlaybackPlanSchema),
    targetCoverageChecks: z.array(c60114TargetCoverageCheckSchema),
    summary: z
      .object({
        segmentCount: count,
        audioMappingCount: count,
        targetMappingCount: count,
        mandatoryTargetCount: count,
        coveredMandatoryTargetCount: count,
        targetCoveragePassed: z.boolean(),
        fullQueueUniqueAudioSeconds: z.number().nonnegative(),
      })
      .strict(),
    semanticHash: hash,
  })
  .strict();

export const c60114MachineFreezeSchema = z
  .object({
    ...c60114DeliveryHeader,
    artifactType: z.literal("c6-0-1-14-machine-localization-freeze"),
    freezeCompletedAt: z.iso.datetime(),
    stage: z.string().min(1),
    artifacts: z
      .array(
        z.object({ relativePath, byteHash: hash, semanticHash: hash }).strict(),
      )
      .min(1),
    protectedMachineFiles: z
      .array(z.object({ relativePath, byteHash: hash }).strict())
      .min(1),
    rankerRetrained: z.literal(false),
    oofTrainingRun: z.literal(false),
    goldReadCountBeforeFreeze: z.literal(0),
    sourceReadOnlyIdentity: z
      .object({ sha256: hash, size: count, mtimeMs: z.number(), inode: count })
      .strict(),
    canonicalTextMutationCount: z.literal(0),
    canonicalTimingMutationCount: z.literal(0),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    machineOnlyReleaseAuthorized: z.literal(false),
    c602Status: z.literal("HOLD"),
    semanticHash: hash,
  })
  .strict();

export type C60114ReviewItemV4 = z.infer<typeof c60114ReviewItemV4Schema>;
export type C60114ReviewItemsV4 = z.infer<typeof c60114ReviewItemsV4Schema>;
export type C60114ReviewRegionV3 = z.infer<typeof c60114ReviewRegionV3Schema>;
export type C60114ReviewRegionsV3 = z.infer<typeof c60114ReviewRegionsV3Schema>;
export type C60114PhysicalAudio = z.infer<typeof c60114PhysicalAudioSchema>;
export type C60114ReviewAudioManifestV3 = z.infer<
  typeof c60114ReviewAudioManifestV3Schema
>;
export type C60114PlaybackSegment = z.infer<typeof c60114PlaybackSegmentSchema>;
export type C60114PlaybackPlan = z.infer<typeof c60114PlaybackPlanSchema>;
export type C60114PlaybackTimelineV2 = z.infer<
  typeof c60114PlaybackTimelineV2Schema
>;
export type C60114MachineFreeze = z.infer<typeof c60114MachineFreezeSchema>;

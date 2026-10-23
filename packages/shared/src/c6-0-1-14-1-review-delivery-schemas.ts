import { z } from "zod";
import {
  c601141HeaderShape,
  c601141SampleIntervalSchema,
  c601141LexicalSchema,
  c601141MissingEvidenceSchema,
  c601141SafetySchema,
} from "./c6-0-1-14-1-speech-inventory-schemas.js";
import {
  c60114ReviewTargetSchema,
  c60114ReviewTargetsSchema,
} from "./c6-0-1-14-evidence-schemas.js";
import {
  c60114ReviewItemV4Schema,
  c60114ReviewItemsV4Schema,
  c60114ReviewRegionV3Schema,
  c60114ReviewRegionsV3Schema,
  c60114PhysicalAudioSchema,
  c60114ReviewAudioManifestV3Schema,
  c60114PlaybackPlanSchema,
  c60114PlaybackTimelineV2Schema,
} from "./c6-0-1-14-review-delivery-schemas.js";

const hash = z.string().regex(/^[a-f0-9]{64}$/u),
  id = z.string().min(1),
  ids = z.array(id),
  count = z.number().int().nonnegative();
const layer = z.enum([
  "PRESERVED_BASELINE",
  "STRONG_SPEECH_INVENTORY",
  "MISSING_SAFETY_RESERVE",
]);
export const c601141ReviewTargetSchema = z
  .object({
    ...c60114ReviewTargetSchema.shape,
    nativeInterval: c601141SampleIntervalSchema,
    targetSource: layer,
    inventoryIntervalIds: ids,
    detectorRunIds: ids,
    fingerprintEntryIds: ids,
    asrProbeIds: ids,
    suggestedReviewLevel: z.enum(["REQUIRED", "RECOMMENDED", "INFORMATIONAL"]),
    baselineSemanticHash: hash.nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.targetSource !== "PRESERVED_BASELINE" &&
      (v.mandatoryForAudio ||
        v.suggestedReviewLevel === "REQUIRED" ||
        v.finalCueIds.length > 0 ||
        !v.audioRequired)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "New inventory targets must remain non-mandatory audio-required zero-cue subjects",
      });
    if (
      Math.abs(
        v.sourceInterval.start -
          v.nativeInterval.startSample / v.sourceIdentity.sampleRate,
      ) >
        1 / v.sourceIdentity.sampleRate ||
      Math.abs(
        v.sourceInterval.end -
          v.nativeInterval.endSample / v.sourceIdentity.sampleRate,
      ) >
        1 / v.sourceIdentity.sampleRate
    )
      ctx.addIssue({
        code: "custom",
        message: "Native sample and source-second target intervals disagree",
      });
  });
export const c601141ReviewTargetsSchema = z
  .object({
    ...c601141HeaderShape,
    artifactType: z.literal("machine-review-target-intervals-v3"),
    baselineTargetsHash: hash,
    compatibilityTargetsHash: hash,
    inventoryHash: hash,
    safetyHash: hash,
    targets: z.array(c601141ReviewTargetSchema),
    unresolvedItems: c60114ReviewTargetsSchema.shape.unresolvedItems,
    summary: z
      .object({
        preservedBaselineTargetCount: count,
        newTargetCount: count,
        targetCount: count,
        newTargetUnionSeconds: z.number().min(0).max(60),
        allAudioRequired: z.boolean(),
        previousTargetsDeleted: z.literal(0),
        canonicalMutationCount: z.literal(0),
      })
      .strict(),
  })
  .strict();
export const c601141NewReviewItemTypeSchema = z.enum([
  "MULTI_DETECTOR_UNCOVERED_SPEECH",
  "LEGACY_FINGERPRINT_RECOVERED_SPEECH",
  "MISSING_SAFETY_RESERVE",
  "DETECTOR_DISAGREEMENT_REVIEW",
  "NEW_LOCAL_ASR_CANDIDATE",
  "NEW_LOCAL_ASR_DISAGREEMENT",
]);
export const c601141ReviewItemSchema = c60114ReviewItemV4Schema
  .extend({
    itemTypes: z
      .array(
        z.union([
          c60114ReviewItemV4Schema.shape.itemTypes.element,
          c601141NewReviewItemTypeSchema,
        ]),
      )
      .min(1),
    reviewLayer: layer,
    inventoryTargetIds: ids,
    baselineSemanticHash: hash.nullable(),
  })
  .strict()
  .refine(
    (v) =>
      v.reviewLayer === "PRESERVED_BASELINE" || v.requiredLevel !== "REQUIRED",
    "New item cannot become REQUIRED",
  );
export const c601141ReviewItemsSchema = z
  .object({
    ...c601141HeaderShape,
    artifactType: z.literal("machine-review-items-v5"),
    baselineItemsHash: hash,
    compatibilityItemsHash: hash,
    targetsHash: hash,
    missingEvidenceHash: hash,
    items: z.array(c601141ReviewItemSchema),
    summary: c60114ReviewItemsV4Schema.shape.summary,
    rankerRetrained: z.literal(false),
    newOofRun: z.literal(false),
    mandatoryOrderChanged: z.literal(false),
  })
  .strict();
export const c601141ReviewRegionSchema = c60114ReviewRegionV3Schema
  .extend({
    reviewLayer: layer,
    nativeSourceIntervals: z.array(c601141SampleIntervalSchema).min(1),
    baselineSemanticHash: hash.nullable(),
  })
  .strict();
export const c601141ReviewRegionsSchema = z
  .object({
    ...c601141HeaderShape,
    artifactType: z.literal("machine-review-regions-v4"),
    targetsHash: hash,
    itemsHash: hash,
    compatibilityRegionsHash: hash,
    regions: z.array(c601141ReviewRegionSchema),
    summary: c60114ReviewRegionsV3Schema.shape.summary,
    orderingPolicy: z.literal(
      "PRESERVE_BASELINE_R3_ORDER_APPEND_FROZEN_R3_SAFETY_LAYER",
    ),
    rankerRetrained: z.literal(false),
    newOofRun: z.literal(false),
  })
  .strict();
export const c601141PhysicalAudioSchema = c60114PhysicalAudioSchema
  .safeExtend({ nativeSourceInterval: c601141SampleIntervalSchema })
  .strict();
export const c601141AudioManifestSchema = z
  .object({
    ...c601141HeaderShape,
    artifactType: z.literal("machine-review-audio-manifest-v4"),
    regionsHash: hash,
    compatibilityAudioHash: hash,
    deliverySubsystemVersion: z.literal("C6.0.1.12_REVIEW_AUDIO"),
    extractionPolicy: c60114ReviewAudioManifestV3Schema.shape.extractionPolicy,
    audio: z.array(c601141PhysicalAudioSchema),
    targetCoverageChecks:
      c60114ReviewAudioManifestV3Schema.shape.targetCoverageChecks,
    summary: c60114ReviewAudioManifestV3Schema.shape.summary,
  })
  .strict();
export const c601141PlaybackPlanSchema = c60114PlaybackPlanSchema
  .extend({
    planId: z.enum([
      "UNIQUE_AUDIO_10_PERCENT",
      "UNIQUE_AUDIO_20_PERCENT",
      "UNIQUE_AUDIO_30_PERCENT",
      "UNIQUE_AUDIO_40_PERCENT",
      "UNIQUE_AUDIO_50_PERCENT",
      "ALL_MANDATORY",
      "FULL_QUEUE",
      "FULL_QUEUE_CONSERVATIVE_SPEECH",
      "FULL_QUEUE_WITH_SAFETY_RESERVE",
    ]),
  })
  .strict();
export const c601141PlaybackSchema = z
  .object({
    ...c601141HeaderShape,
    artifactType: z.literal("machine-review-playback-timeline-v3"),
    audioManifestHash: hash,
    regionsHash: hash,
    targetsHash: hash,
    compatibilityPlaybackHash: hash,
    segments: c60114PlaybackTimelineV2Schema.shape.segments,
    plans: z.array(c601141PlaybackPlanSchema).length(9),
    officialFullQueuePlan: z.literal("FULL_QUEUE_WITH_SAFETY_RESERVE"),
    targetCoverageChecks:
      c60114PlaybackTimelineV2Schema.shape.targetCoverageChecks,
    summary: c60114PlaybackTimelineV2Schema.shape.summary,
  })
  .strict();
export const c601141WorkspaceExtensionSchema = z
  .object({
    ...c601141HeaderShape,
    workspaceMode: z.literal("MULTIVIEW_SPEECH_INVENTORY_REVIEW_V1"),
    targets: c601141ReviewTargetsSchema,
    items: c601141ReviewItemsSchema,
    regions: c601141ReviewRegionsSchema,
    audio: c601141AudioManifestSchema,
    playback: c601141PlaybackSchema,
    lexical: c601141LexicalSchema,
    missing: c601141MissingEvidenceSchema,
    safety: c601141SafetySchema,
    humanTrialStarted: z.literal(false),
    canonicalMutationAllowed: z.literal(false),
  })
  .strict();
export const c601141DeliverySchemas = {
  "machine-review-target-intervals-v3": c601141ReviewTargetsSchema,
  "machine-review-items-v5": c601141ReviewItemsSchema,
  "machine-review-regions-v4": c601141ReviewRegionsSchema,
  "machine-review-audio-manifest-v4": c601141AudioManifestSchema,
  "machine-review-playback-timeline-v3": c601141PlaybackSchema,
  "c6-0-1-14-1-workspace-extension": c601141WorkspaceExtensionSchema,
};
export type C601141ReviewTarget = z.infer<typeof c601141ReviewTargetSchema>;
export type C601141ReviewTargets = z.infer<typeof c601141ReviewTargetsSchema>;
export type C601141ReviewItem = z.infer<typeof c601141ReviewItemSchema>;
export type C601141ReviewItems = z.infer<typeof c601141ReviewItemsSchema>;
export type C601141ReviewRegions = z.infer<typeof c601141ReviewRegionsSchema>;
export type C601141AudioManifest = z.infer<typeof c601141AudioManifestSchema>;
export type C601141PlaybackPlan = z.infer<typeof c601141PlaybackPlanSchema>;
export type C601141Playback = z.infer<typeof c601141PlaybackSchema>;
export type C601141WorkspaceExtension = z.infer<
  typeof c601141WorkspaceExtensionSchema
>;

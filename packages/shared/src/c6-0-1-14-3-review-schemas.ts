import { z } from "zod";
import {
  header143Shape,
  child143Schema,
  safety143Schema,
  planner143Schema,
  monotonicity143Schema,
  continuity143Schema,
  obligations143Schema,
} from "./c6-0-1-14-3-monotonic-selection-schemas.js";
import {
  hash142Schema as h,
  id142Schema as id,
  count142Schema as n,
} from "./c6-0-1-14-2-selection-detector-schemas.js";
import { c601141SampleIntervalSchema as samples } from "./c6-0-1-14-1-speech-inventory-schemas.js";
import {
  reviewTarget142Schema,
  reviewTargets142Schema,
  reviewItem142Schema,
  reviewItems142Schema,
  reviewRegion142Schema,
  reviewRegions142Schema,
  audio142Schema,
  playback142Schema,
  playbackPlan142Schema,
  lexicalCandidate142Schema,
  lexical142Schema,
  missing142Schema,
} from "./c6-0-1-14-2-review-schemas.js";
export const target143Schema = reviewTarget142Schema
  .safeExtend({
    bundleId: id.nullable(),
    childUnitIds: z.array(id),
    phaseAObligationIds: z.array(id),
    bundleReviewEnvelope: samples.nullable(),
  })
  .strict();
export const targets143Schema = reviewTargets142Schema
  .extend({
    ...header143Shape,
    artifactType: z.literal("machine-review-target-intervals-v5"),
    targets: z.array(target143Schema),
    obligationsHash: h,
    plannerCertificateHash: h,
    continuityLedgerHash: h,
  })
  .strict();
export const item143Schema = reviewItem142Schema
  .safeExtend({ bundleIds: z.array(id), childUnitIds: z.array(id) })
  .strict();
export const items143Schema = reviewItems142Schema
  .extend({
    ...header143Shape,
    artifactType: z.literal("machine-review-items-v7"),
    items: z.array(item143Schema),
  })
  .strict();
export const region143Schema = reviewRegion142Schema
  .extend({
    bundleIds: z.array(id),
    childUnitIds: z.array(id),
    childNativeCoreUnion: z.array(samples),
  })
  .strict();
export const regions143Schema = reviewRegions142Schema
  .extend({
    ...header143Shape,
    artifactType: z.literal("machine-review-regions-v6"),
    regions: z.array(region143Schema),
  })
  .strict();
export const coreDelivery143Schema = z
  .object({
    unitId: id,
    unitKind: z.enum(["CHILD", "BUNDLE"]),
    nativeCoreIntervals: z.array(samples),
    audioIds: z.array(id),
    playbackSegmentIds: z.array(id),
    physicalCoveredNativeIntervals: z.array(samples),
    playbackCoveredNativeIntervals: z.array(samples),
    uncoveredPhysicalNativeSamples: n,
    uncoveredPlaybackNativeSamples: n,
    coveragePassed: z.boolean(),
    semanticHash: h,
  })
  .strict();
export const audio143Schema = audio142Schema
  .extend({
    ...header143Shape,
    artifactType: z.literal("machine-review-audio-manifest-v6"),
    targetsHash: h,
    safetyHash: h,
    childCoreCoverage: z.array(coreDelivery143Schema),
    bundleCoreCoverage: z.array(coreDelivery143Schema),
  })
  .strict();
export const playbackPlan143Schema = playbackPlan142Schema
  .extend({
    planId: z.enum([
      ...playbackPlan142Schema.shape.planId.options,
      "C601143_FINAL_REVIEW_DELIVERY",
    ]),
    rankerStatus: z.literal("RANKER_NOT_RECALIBRATED_IN_C6_0_1_14_3"),
  })
  .strict();
export const playback143Schema = playback142Schema
  .extend({
    ...header143Shape,
    artifactType: z.literal("machine-review-playback-timeline-v5"),
    plans: z.array(playbackPlan143Schema).min(8),
    officialFullQueuePlan: z.literal("C601143_FINAL_REVIEW_DELIVERY"),
    targetsHash: h,
    safetyHash: h,
    plannerCertificateHash: h,
    nativeFullQueueSamples: n,
    predictedFullQueueSeconds: z.number().nonnegative(),
    actualMinusPredictedSeconds: z.number(),
    allChildCorePlaybackPassed: z.boolean(),
    allBundleCorePlaybackPassed: z.boolean(),
  })
  .strict();
export const lexicalBindings143Schema = z
  .object({
    ...header143Shape,
    artifactType: z.literal("machine-c601143-frozen-lexical-bindings"),
    frozenLexicalArtifactHash: h,
    safetyHash: h,
    previousLexicalArtifactHash: h,
    entries: z.array(
      z
        .object({
          candidateHash: h,
          candidate: lexicalCandidate142Schema,
          sourceTargetIds: z.array(id),
          finalBundleIds: z.array(id),
          childUnitIds: z.array(id),
          binding: z.enum([
            "CORE_CONTAINED",
            "CONTEXT_ONLY_UNPROJECTABLE",
            "OUTSIDE_FINAL_SELECTION",
          ]),
          originalIntervalsPreserved: z.literal(true),
          canonicalInsertAllowed: z.literal(false),
        })
        .strict(),
    ),
    originalCandidateCount: n,
    deduplicatedCandidateCount: n,
    coreContainedCount: n,
    contextOnlyCount: n,
    outsideSelectionCount: n,
  })
  .strict();
export const workspace143Schema = z
  .object({
    ...header143Shape,
    workspaceMode: z.literal("MONOTONIC_SAFETY_BUNDLE_REVIEW_V3"),
    targets: targets143Schema,
    items: items143Schema,
    regions: regions143Schema,
    audio: audio143Schema,
    playback: playback143Schema,
    safety: safety143Schema,
    selectedChildren: z.array(child143Schema),
    obligations: obligations143Schema,
    planner: planner143Schema,
    monotonicity: monotonicity143Schema,
    continuity: continuity143Schema,
    lexicalBindings: lexicalBindings143Schema,
    compatibilityLexical: lexical142Schema,
    compatibilityMissing: missing142Schema,
    reviewDeliverySubsystemVersion: z.literal("C6.0.1.12_REVIEW_AUDIO"),
    humanTrialStarted: z.literal(false),
    canonicalMutationAllowed: z.literal(false),
  })
  .strict();
export const c601143ReviewSchemas = {
  "machine-review-target-intervals-v5": targets143Schema,
  "machine-review-items-v7": items143Schema,
  "machine-review-regions-v6": regions143Schema,
  "machine-review-audio-manifest-v6": audio143Schema,
  "machine-review-playback-timeline-v5": playback143Schema,
  "machine-c601143-frozen-lexical-bindings": lexicalBindings143Schema,
  "machine-c601143-review-workspace": workspace143Schema,
};
export type Targets143 = z.infer<typeof targets143Schema>;
export type Items143 = z.infer<typeof items143Schema>;
export type Regions143 = z.infer<typeof regions143Schema>;
export type Audio143 = z.infer<typeof audio143Schema>;
export type Playback143 = z.infer<typeof playback143Schema>;
export type Workspace143 = z.infer<typeof workspace143Schema>;
export type LexicalBindings143 = z.infer<typeof lexicalBindings143Schema>;
export type CoreDelivery143 = z.infer<typeof coreDelivery143Schema>;

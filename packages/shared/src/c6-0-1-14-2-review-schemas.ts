import { z } from "zod";
import {
  header142Shape,
  hash142Schema as h,
  id142Schema as id,
  count142Schema as n,
  safety142Schema,
  stratum142Schema,
  family142Schema,
} from "./c6-0-1-14-2-selection-detector-schemas.js";
import {
  c601141SampleIntervalSchema as samples,
  c601141IntervalSchema as interval,
  c601141AsrRequestSchema,
  c601141AsrProbesSchema,
  c601141LexicalSchema,
  c601141LexicalRowSchema,
} from "./c6-0-1-14-1-speech-inventory-schemas.js";
import {
  c60114ProbeRequestSchema,
  c60114ProbeRuntimeSchema,
} from "./c6-0-1-14-probe-schemas.js";
import {
  c601141ReviewTargetSchema,
  c601141ReviewTargetsSchema,
  c601141ReviewItemSchema,
  c601141ReviewItemsSchema,
  c601141ReviewRegionSchema,
  c601141ReviewRegionsSchema,
  c601141AudioManifestSchema,
  c601141PlaybackSchema,
  c601141PlaybackPlanSchema,
} from "./c6-0-1-14-1-review-delivery-schemas.js";

export const asrTarget142Schema = z
  .object({
    probeTargetId: id,
    clusterTargetId: id,
    clusterId: id,
    nativeInterval: samples,
    sourceInterval: interval,
    targetCoreUnion: z.array(samples).min(1),
    evidenceStrata: z.array(stratum142Schema),
    selectionReasons: z.array(id),
    contextPreselected: z.boolean(),
    semanticHash: h,
  })
  .strict();
export const asrSelection142Schema = z
  .object({
    ...header142Shape,
    artifactType: z.literal("machine-c6-0-1-14-2-asr-probe-selection"),
    safetyHash: h,
    previousAsrEvidenceHash: h,
    targets: z.array(asrTarget142Schema).max(4),
    contextEligibleTargetIds: z.array(id).max(2),
    maximumAuthorizedRequests: n.max(12),
    selectionFrozenAt: z.iso.datetime(),
    targetBackfillAllowed: z.literal(false),
    goldBlind: z.literal(true),
    repeatedPreviousRequestCount: z.literal(0),
    rejected: z.array(z.object({ clusterTargetId: id, reason: id }).strict()),
  })
  .strict()
  .refine(
    (v) =>
      v.maximumAuthorizedRequests ===
        2 * (v.targets.length + v.contextEligibleTargetIds.length) &&
      v.contextEligibleTargetIds.every((id) =>
        v.targets.some((t) => t.probeTargetId === id),
      ),
    "Unbound context or incorrect ASR budget",
  );
export const asrPlan142Schema = z
  .object({
    ...header142Shape,
    artifactType: z.literal("machine-c601142-asr-execution-plan"),
    selectionHash: h,
    frozenAt: z.iso.datetime(),
    identities: z.array(c60114ProbeRuntimeSchema).max(2),
    identitiesHash: h,
    readingRuntimeHash: h.nullable(),
    requests: z.array(c60114ProbeRequestSchema).max(12),
    modelLoadCountBeforeFreeze: z.literal(0),
    providerProcessStartCountBeforeFreeze: z.literal(0),
    retryAllowed: z.literal(false),
    backfillAllowed: z.literal(false),
  })
  .strict();
export const asrRequest142Schema = c601141AsrRequestSchema
  .extend({ clusterTargetId: id })
  .strict();
export const asrProbes142Schema = c601141AsrProbesSchema
  .extend({
    ...header142Shape,
    artifactType: z.literal("machine-c6-0-1-14-2-local-asr-probes"),
    planHash: h,
    requests: z.array(asrRequest142Schema).max(12),
    contextDecisions: c601141AsrProbesSchema.shape.contextDecisions.max(2),
    accounting: c601141AsrProbesSchema.shape.accounting
      .extend({
        inferenceCount: n.max(12),
        exactCount: n.max(8),
        contextCount: n.max(4),
        repeatedPreviousRequestCount: z.literal(0),
        targetBackfillCount: z.literal(0),
      })
      .strict(),
  })
  .strict();
export const lexicalCandidate142Schema = z
  .object({
    requestId: id,
    provider: asrRequest142Schema.shape.provider,
    nativeInterval: samples,
    sourceInterval: interval,
    text: z.string(),
    reading: z.string().nullable(),
    readingRuntimeHash: h.nullable(),
    source: z.enum(["PREVIOUS_C601141", "CURRENT_C601142"]),
    localizationStatus: asrRequest142Schema.shape.localizationStatus,
    lexicalTruthGuaranteed: z.literal(false),
  })
  .strict();
export const lexicalTarget142Schema = z
  .object({
    targetId: id,
    targetCoreUnion: z.array(samples).min(1),
    requestIds: z.array(id),
    evidenceFamilies: z.array(id),
    evidenceClass: c601141LexicalRowSchema.shape.evidenceClass,
    localizedTextCandidates: z.array(lexicalCandidate142Schema),
    reliableLocalizedLexical: z.boolean(),
    localizedNativeIntervalUnion: z.array(samples),
    canonicalInsertAllowed: z.literal(false),
    semanticHash: h,
  })
  .strict();
export const lexical142Schema = z
  .object({
    ...header142Shape,
    artifactType: z.literal("machine-missing-lexical-evidence-v5"),
    probesEvidenceHash: h,
    safetyHash: h,
    previousLexicalHash: h,
    previousLexical: c601141LexicalSchema,
    targets: z.array(lexicalTarget142Schema).max(24),
    summary: z
      .object({
        targetCount: n,
        crossModelCount: n,
        readingAgreementCount: n,
        singleModelCount: n,
        emptyCount: n,
        disagreementCount: n,
        reliableLocalizedCount: n,
        previousLocalizedTargetCount: n,
        localizedWhisperCandidateCount: n,
        localizedReazonCandidateCount: n,
        canonicalInsertCount: z.literal(0),
      })
      .strict(),
  })
  .strict();
export const missing142Schema = z
  .object({
    ...header142Shape,
    artifactType: z.literal("machine-missing-speech-evidence-v5"),
    inventoryHash: h,
    safetyHash: h,
    lexicalHash: h,
    targets: z
      .array(
        z
          .object({
            targetId: id,
            targetCoreUnion: z.array(samples).min(1),
            evidenceIds: z.array(id),
            requestIds: z.array(id),
            evidenceStrata: z.array(stratum142Schema),
            evidenceFlags: z.array(id),
            lexicalEvidenceClass: c601141LexicalRowSchema.shape.evidenceClass,
            missingEvidenceClass: z.enum([
              "MISSING_DIALOGUE_STRONG",
              "SPEECH_INVENTORY_SAFETY_RESERVE",
              "ASR_DISAGREEMENT",
              "ASR_EMPTY",
              "SPEECH_DETECTION_UNRESOLVED",
            ]),
            requiredLevel: z.literal("RECOMMENDED"),
            canonicalInsertAllowed: z.literal(false),
            semanticHash: h,
          })
          .strict(),
      )
      .max(24),
    summary: z
      .object({
        targetCount: n,
        speechOnlySafetyCount: n,
        localizedAgreementCount: n,
        emptyAsrTargetRetainedCount: n,
        nonMandatoryCount: n,
        canonicalInsertCount: z.literal(0),
      })
      .strict(),
  })
  .strict();
export const reviewTarget142Schema = c601141ReviewTargetSchema
  .safeExtend({
    safetyClusterId: id.nullable(),
    safetyClusterTargetId: id.nullable(),
    atomicMemberCandidateIds: z.array(id),
    evidenceStrata: z.array(stratum142Schema),
    detectorFamilies: z.array(family142Schema),
  })
  .strict();
export const reviewTargets142Schema = c601141ReviewTargetsSchema
  .extend({
    ...header142Shape,
    artifactType: z.literal("machine-review-target-intervals-v4"),
    targets: z.array(reviewTarget142Schema),
    supersessionHash: h,
    activeSafetyClusterCount: n.max(24),
    envelopeAsSpeechCount: z.literal(0),
  })
  .strict();
export const reviewItem142Schema = c601141ReviewItemSchema
  .safeExtend({
    safetyClusterIds: z.array(id),
    targetCoreUnion: z.array(samples),
    evidenceStrata: z.array(stratum142Schema),
  })
  .strict();
export const reviewItems142Schema = c601141ReviewItemsSchema
  .extend({
    ...header142Shape,
    artifactType: z.literal("machine-review-items-v6"),
    items: z.array(reviewItem142Schema),
  })
  .strict();
export const reviewRegion142Schema = c601141ReviewRegionSchema
  .extend({ safetyClusterIds: z.array(id) })
  .strict();
export const reviewRegions142Schema = c601141ReviewRegionsSchema
  .extend({
    ...header142Shape,
    artifactType: z.literal("machine-review-regions-v5"),
    regions: z.array(reviewRegion142Schema),
  })
  .strict();
export const audio142Schema = c601141AudioManifestSchema
  .extend({
    ...header142Shape,
    artifactType: z.literal("machine-review-audio-manifest-v5"),
  })
  .strict();
export const playbackPlan142Schema = c601141PlaybackPlanSchema
  .extend({
    planId: z.enum([
      ...c601141PlaybackPlanSchema.shape.planId.options,
      "FULL_QUEUE_BASELINE_C6_0_1_14_1",
      "FULL_QUEUE_WITH_SELECTION_REPAIR",
      "FULL_QUEUE_WITH_DETECTOR_CEILING",
      "FULL_QUEUE_WITH_SAFETY_V2",
      "C601141_BASELINE_FULL_QUEUE",
      "C601142_SELECTION_REPAIR_ONLY",
      "C601142_DETECTOR_CEILING_ONLY",
      "C601142_FINAL_FULL_QUEUE",
    ]),
    rankerStatus: z.literal("RANKER_NOT_RECALIBRATED_IN_C6_0_1_14_2"),
  })
  .strict();
export const playback142Schema = c601141PlaybackSchema
  .extend({
    ...header142Shape,
    artifactType: z.literal("machine-review-playback-timeline-v4"),
    plans: z.array(playbackPlan142Schema).min(8),
    officialFullQueuePlan: z.literal("C601142_FINAL_FULL_QUEUE"),
    fullQueueEpisodeRatio: z.number().min(0).max(1.001),
    burdenGate: z.enum(["PASSED", "FULL_QUEUE_BURDEN_DEGENERATE"]),
  })
  .strict();
export const workspace142Schema = z
  .object({
    ...header142Shape,
    workspaceMode: z.literal("DETECTOR_CEILING_SAFETY_REVIEW_V2"),
    targets: reviewTargets142Schema,
    items: reviewItems142Schema,
    regions: reviewRegions142Schema,
    audio: audio142Schema,
    playback: playback142Schema,
    lexical: lexical142Schema,
    missing: missing142Schema,
    safety: safety142Schema,
    humanTrialStarted: z.literal(false),
    canonicalMutationAllowed: z.literal(false),
  })
  .strict();
export const c601142ReviewSchemas = {
  "machine-c6-0-1-14-2-asr-probe-selection": asrSelection142Schema,
  "machine-c601142-asr-execution-plan": asrPlan142Schema,
  "machine-c6-0-1-14-2-local-asr-probes": asrProbes142Schema,
  "machine-missing-lexical-evidence-v5": lexical142Schema,
  "machine-missing-speech-evidence-v5": missing142Schema,
  "machine-review-target-intervals-v4": reviewTargets142Schema,
  "machine-review-items-v6": reviewItems142Schema,
  "machine-review-regions-v5": reviewRegions142Schema,
  "machine-review-audio-manifest-v5": audio142Schema,
  "machine-review-playback-timeline-v4": playback142Schema,
  "c6-0-1-14-2-workspace-extension": workspace142Schema,
};
export type AsrSelection142 = z.infer<typeof asrSelection142Schema>;
export type AsrTarget142 = z.infer<typeof asrTarget142Schema>;
export type AsrPlan142 = z.infer<typeof asrPlan142Schema>;
export type AsrRequest142 = z.infer<typeof asrRequest142Schema>;
export type AsrProbes142 = z.infer<typeof asrProbes142Schema>;
export type Lexical142 = z.infer<typeof lexical142Schema>;
export type Missing142 = z.infer<typeof missing142Schema>;
export type ReviewTargets142 = z.infer<typeof reviewTargets142Schema>;
export type ReviewItems142 = z.infer<typeof reviewItems142Schema>;
export type ReviewRegions142 = z.infer<typeof reviewRegions142Schema>;
export type Audio142 = z.infer<typeof audio142Schema>;
export type Playback142 = z.infer<typeof playback142Schema>;
export type PlaybackPlan142 = z.infer<typeof playbackPlan142Schema>;
export type Workspace142 = z.infer<typeof workspace142Schema>;

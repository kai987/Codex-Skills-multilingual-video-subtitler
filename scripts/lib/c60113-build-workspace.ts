import { cp } from "node:fs/promises";
import path from "node:path";
import {
  atomicWriteJson,
  machineReviewItemsSchema,
  machineReviewPrioritySchema,
  machineReviewRegionsSchema,
  type C60113RegionReviewPriority,
  type C60113ReviewBurdenPlans,
  type C60113ReviewItemsV3,
  type C60113ReviewPlaybackTimeline,
  type C60113ReviewRegionsV2,
} from "@mvl/shared";
import {
  buildC60112ReviewAudio,
  buildC60112ReviewPackageFreeze,
  machineQualitySemanticHash,
  verifyC60112ReviewPackageFreeze,
  writeC60112ReviewWorkspace,
  type C60112ReviewWorkspaceData,
} from "@mvl/video-subtitler";
import { buildC60113WorkspaceExtension } from "../../packages/video-subtitler/src/review/c60113-review-workspace.js";
import { createC60113OutputDirectory } from "./c60113-acceptance-io.js";
import type { loadC60113ReplayInput } from "./c60113-replay-input.js";

type Replay = Awaited<ReturnType<typeof loadC60113ReplayInput>>;

/**
 * Reuse the C6.0.1.12 delivery/security contract while freezing C6.0.1.13's
 * structured metadata inside the complete workspace object. The older envelope
 * version is compatibility metadata, not the evidence-policy version.
 */
export async function buildC60113Workspace(input: {
  replay: Replay;
  itemsV3: C60113ReviewItemsV3;
  regionsV2: C60113ReviewRegionsV2;
  regionPriority: C60113RegionReviewPriority;
  playbackTimeline: C60113ReviewPlaybackTimeline;
  burdenPlans: C60113ReviewBurdenPlans;
  outputDirectory: string;
  sourcePath: string;
  generatedAt: string;
  ffmpegPath?: string;
}) {
  await createC60113OutputDirectory(input.outputDirectory);
  const { replay } = input;
  const oldItems = new Map(
    replay.items.items.map((item) => [item.reviewItemId, item]),
  );
  const oldPriority = new Map(
    replay.priority.entries.map((entry) => [entry.reviewItemId, entry]),
  );
  const stripHash = <T extends { semanticHash: string }>(value: T) => {
    const { semanticHash: _hash, ...core } = value;
    void _hash;
    return core;
  };
  const hashed = <T extends object>(core: T) => ({
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
  const items = machineReviewItemsSchema.parse(
    hashed({
      ...stripHash(replay.items),
      items: input.itemsV3.items.map((item) => {
        const old = oldItems.get(item.reviewItemId);
        if (!old)
          throw new Error("C60113_REVIEW_ITEM_HAS_NO_BASELINE_IDENTITY");
        return hashed({
          ...stripHash(old),
          priorityScore: item.priorityScore,
          priorityTier: item.priorityTier,
          requiredLevel: item.requiredLevel,
        });
      }),
      summary: {
        ...replay.items.summary,
        requiredItemCount: input.itemsV3.summary.requiredItemCount,
      },
    }),
  );
  const priority = machineReviewPrioritySchema.parse(
    hashed({
      ...stripHash(replay.priority),
      entries: input.itemsV3.items.map((item) => {
        const old = oldPriority.get(item.reviewItemId);
        if (!old)
          throw new Error("C60113_REVIEW_PRIORITY_HAS_NO_BASELINE_IDENTITY");
        return hashed({
          ...stripHash(old),
          priorityTier: item.priorityTier,
          priorityScore: item.priorityScore,
          requiredLevel: item.requiredLevel,
          scoreComponents: {
            taxonomyRisk: 0,
            multiLabelBoost: 0,
            compoundRiskBoost: 0,
            evidenceBreadthBoost: 0,
          },
          explanationCodes: [
            "C60113_STRUCTURED_VECTOR_SEE_REGION_REVIEW_V2",
            ...item.mandatoryReasons,
          ],
        });
      }),
    }),
  );
  const regions = machineReviewRegionsSchema.parse(
    hashed({
      ...stripHash(replay.regions),
      regions: input.regionsV2.regions.map((region) =>
        hashed({
          regionId: region.regionId,
          reviewItemIds: region.reviewItemIds,
          eventIds: region.eventIds,
          finalCueIds: region.finalCueIds,
          contextStart: region.contextStart,
          contextEnd: region.contextEnd,
          coreIntervals: region.coreIntervals,
          maxPriority: region.maxPriority,
          aggregateReasons: region.aggregateReasons,
          itemTypes: region.itemTypes,
          requiredLevel: region.requiredLevel,
          sceneIds: region.sceneIds,
          speakerGroupIds: region.speakerGroupIds,
        }),
      ),
      summary: {
        itemCount: items.items.length,
        regionCount: input.regionsV2.regions.length,
        mergedItemCount: items.items.length - input.regionsV2.regions.length,
        requiredRegionCount: input.regionsV2.summary.requiredRegionCount,
        totalContextAudioSeconds: input.regionsV2.summary.clipSumSeconds,
      },
    }),
  );
  const audio = await buildC60112ReviewAudio({
    sourcePath: input.sourcePath,
    expectedSourceMediaSha256: replay.sourceIdentity.sha256,
    durationSeconds: replay.subtitlePackage.source.durationSeconds,
    regions: regions.regions.map((region) => ({
      regionId: region.regionId,
      interval: {
        start: Math.min(
          ...region.coreIntervals.map((interval) => interval.start),
        ),
        end: Math.max(...region.coreIntervals.map((interval) => interval.end)),
      },
      itemIds: region.reviewItemIds,
    })),
    outputDirectory: path.join(input.outputDirectory, "audio"),
    generatedAt: input.generatedAt,
    ...(input.ffmpegPath ? { ffmpegPath: input.ffmpegPath } : {}),
  });
  const itemMap = new Map(items.items.map((item) => [item.reviewItemId, item]));
  const regionByItem = new Map(
    regions.regions.flatMap((region) =>
      region.reviewItemIds.map((id) => [id, region.regionId] as const),
    ),
  );
  const audioByRegion = new Map(
    audio.clips.map((clip) => [clip.regionId, clip]),
  );
  const extension = buildC60113WorkspaceExtension({
    policyHash: input.itemsV3.policyHash,
    regions: input.regionPriority.regions.map((region) => ({
      regionId: region.regionId,
      itemIds: region.itemIds,
      rankPosition: region.rankPosition,
      rankScore: region.rankScore,
      contextInterval: region.contextInterval,
      mandatoryReasons: region.mandatoryReasons,
      independentEvidenceFamilies: region.independentEvidenceFamilies,
      candidateActionableCount: region.candidateActionableCount,
      estimatedUniqueAudioSeconds: region.estimatedUniqueAudioSeconds,
      missingSpeechStates: region.itemRiskSummary.missingClassifications,
    })),
    plans: input.burdenPlans.plans
      .filter((plan) => plan.budgetKind !== "FIXED_SECONDS")
      .map((plan) => ({
        planId: plan.planId as
          | "UNIQUE_AUDIO_10_PERCENT"
          | "UNIQUE_AUDIO_20_PERCENT"
          | "UNIQUE_AUDIO_30_PERCENT"
          | "UNIQUE_AUDIO_40_PERCENT"
          | "UNIQUE_AUDIO_50_PERCENT"
          | "ALL_MANDATORY"
          | "FULL_QUEUE",
        budgetSeconds: plan.budgetSeconds,
        regionIds: plan.regionIds,
        uniqueUnionSeconds: plan.uniqueUnionSeconds,
      })),
    segments: input.playbackTimeline.segments.map(
      ({ segmentId, sourceInterval, regionIds, itemIds }) => ({
        segmentId,
        sourceInterval,
        regionIds,
        itemIds,
      }),
    ),
  });
  const workspaceData: C60112ReviewWorkspaceData = {
    ...replay.workspaceData,
    reviewPackageSemanticHash: machineQualitySemanticHash({
      items: items.semanticHash,
      regions: regions.semanticHash,
      candidates: replay.candidates.semanticHash,
      audio: audio.semanticHash,
      extension: extension.semanticHash,
    }),
    items: replay.workspaceData.items.map((old) => {
      const item = itemMap.get(old.reviewItemId);
      const regionId = regionByItem.get(old.reviewItemId);
      if (!item || !regionId)
        throw new Error("C60113_WORKSPACE_ITEM_REGION_MAPPING_MISSING");
      return {
        ...old,
        priorityScore: item.priorityScore,
        priorityTier: item.priorityTier,
        requiredLevel: item.requiredLevel,
        semanticHash: item.semanticHash,
        regionId,
      };
    }),
    regions: regions.regions.map((region) => {
      const clip = audioByRegion.get(region.regionId);
      if (!clip) throw new Error("C60113_WORKSPACE_AUDIO_MISSING");
      return {
        regionId: region.regionId,
        reviewItemIds: region.reviewItemIds,
        contextStart: region.contextStart,
        contextEnd: region.contextEnd,
        // The compatible extractor retains two-second padding; offsets use
        // these actual bounds, independently of the ranking context.
        audioSourceInterval: clip.extractedInterval,
        coreIntervals: region.coreIntervals.map(({ start, end }) => ({
          start,
          end,
        })),
        audioPath: clip.relativePath,
        audioSha256: clip.sha256,
      };
    }),
    regionReviewV2: extension,
  };
  await writeC60112ReviewWorkspace({
    workspaceDirectory: input.outputDirectory,
    reviewData: workspaceData,
  });
  const packageInput = {
    sourceMediaSha256: replay.sourceIdentity.sha256,
    machineDraftHash: replay.machineDraftHash,
    policy: replay.policy,
    items,
    priority,
    regions,
    candidates: replay.candidates,
    audioManifest: audio,
    workspaceData,
  };
  const freeze = buildC60112ReviewPackageFreeze({
    frozenAt: input.generatedAt,
    ...packageInput,
  });
  if (!verifyC60112ReviewPackageFreeze({ freeze, packageInput }))
    throw new Error("C60113_WORKSPACE_FREEZE_FAILED");
  const artifacts = {
    "machine-review-items.json": items,
    "machine-review-priority.json": priority,
    "machine-review-regions.json": regions,
    "machine-review-candidate-bundles.json": replay.candidates,
    "machine-review-audio-manifest.json": audio,
    "c6-0-1-12-review-assistance-policy.json": replay.policy,
    "c6-0-1-12-review-package-freeze.json": freeze,
  };
  for (const [name, artifact] of Object.entries(artifacts))
    await atomicWriteJson(path.join(input.outputDirectory, name), artifact);
  await cp(
    replay.packagePath,
    path.join(input.outputDirectory, "subtitle-package.needs-review.json"),
    { force: false, errorOnExist: true },
  );
  return { workspaceData, freeze, audio, items, regions, priority };
}

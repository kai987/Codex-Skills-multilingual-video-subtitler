import { cp, readdir } from "node:fs/promises";
import path from "node:path";
import {
  atomicWriteJson,
  machineReviewItemsSchema,
  machineReviewRegionsSchema,
  machineReviewPrioritySchema,
  machineReviewCandidateBundlesSchema,
  reviewItemTypeSchema,
  type C60114ReviewItemsV4,
  type C60114ReviewRegionsV3,
  type C60114LocalizedLexicalEvidence,
  type C60114MissingSpeechEvidenceV3,
} from "@mvl/shared";
import {
  buildC60112ReviewPackageFreeze,
  verifyC60112ReviewPackageFreeze,
  writeC60112ReviewWorkspace,
  type C60112ReviewWorkspaceData,
} from "@mvl/video-subtitler";
import { buildC60114ReviewAudio } from "../../packages/video-subtitler/src/review/review-audio-manifest-v3.js";
import { buildC60114PlaybackTimeline } from "../../packages/video-subtitler/src/review/review-playback-timeline-v2.js";
import {
  buildC60114WorkspaceExtension,
  c60114TransactionActions,
} from "../../packages/video-subtitler/src/review/c60114-review-workspace.js";
import {
  c60114ArtifactHeader,
  uniqueC60114,
  withC60114SemanticHash as hashed,
} from "../../packages/video-subtitler/src/review/c60114-policy.js";
import type { C60114Input } from "./c60114-input.js";
import type { C60114PreparedMachine } from "./c60114-prepare-machine.js";

const strip = <T extends { semanticHash: string }>(value: T) => {
  const { semanticHash: _hash, ...core } = value;
  void _hash;
  return core;
};

/** C60114 targets/audio are authoritative. C60112 files are a compatible
 * transaction projection, never the source of direct playback coverage. */
export async function buildC60114Workspace(input: {
  baseline: C60114Input;
  prepared: C60114PreparedMachine;
  itemsV4: C60114ReviewItemsV4;
  regionsV3: C60114ReviewRegionsV3;
  lexical: C60114LocalizedLexicalEvidence;
  missing: C60114MissingSpeechEvidenceV3;
  sourcePath: string;
  outputDirectory: string;
  generatedAt: string;
}) {
  if ((await readdir(input.outputDirectory)).length)
    throw new Error("C60114_WORKSPACE_OUTPUT_NOT_EMPTY");
  const { baseline, prepared } = input;
  const oldUi = new Map(
    baseline.workspace.items.map((item) => [item.reviewItemId, item]),
  );
  const items = machineReviewItemsSchema.parse(
    hashed({
      ...strip(baseline.delivery.items),
      items: input.itemsV4.items.map((item) =>
        hashed({
          reviewItemId: item.reviewItemId,
          eventIds: item.eventIds,
          finalCueIds: item.finalCueIds,
          itemTypes: uniqueC60114(
            item.itemTypes.flatMap((type) => {
              const parsed = reviewItemTypeSchema.safeParse(type);
              return parsed.success ? [parsed.data] : [];
            }),
          ),
          sourceInterval: item.sourceInterval,
          coreInterval: item.coreInterval,
          currentText: item.currentText,
          candidateIds: item.candidateIds,
          evidenceIds: item.evidenceIds,
          reviewReasons: item.reviewReasons,
          priorityTier: item.priorityTier,
          priorityScore: item.priorityScore,
          requiredLevel: item.requiredLevel,
          // Machine taxonomy retains the legacy union of signal actions. The
          // transaction UI below applies its narrower cue-count authorization.
          suggestedActions: item.suggestedActions,
          sceneIds: item.sceneIds,
          speakerGroupIds: item.speakerGroupIds,
        }),
      ),
      summary: {
        itemCount: input.itemsV4.items.length,
        signalCount: input.itemsV4.items.reduce(
          (sum, item) => sum + item.eventIds.length,
          0,
        ),
        multiLabelItemCount: input.itemsV4.items.filter(
          (item) => item.itemTypes.length > 1,
        ).length,
        orphanItemCount: input.itemsV4.items.filter(
          (item) => !item.finalCueIds.length,
        ).length,
        requiredItemCount: input.itemsV4.summary.requiredItemCount,
      },
    }),
  );
  const itemMap = new Map(items.items.map((item) => [item.reviewItemId, item]));
  const priority = machineReviewPrioritySchema.parse(
    hashed({
      ...strip(baseline.delivery.priority),
      entries: items.items.map((item) =>
        hashed({
          reviewItemId: item.reviewItemId,
          sourceStart: item.sourceInterval.start,
          itemTypes: item.itemTypes,
          reviewReasons: item.reviewReasons,
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
            "C60114_SEE_FROZEN_R3_REGION_PRIORITY",
            "TRANSACTION_COMPATIBILITY_NOT_RECALIBRATION",
          ],
        }),
      ),
    }),
  );
  const targets = prepared.reviewTargets;
  const regions = machineReviewRegionsSchema.parse(
    hashed({
      ...strip(baseline.delivery.regions),
      regions: input.regionsV3.regions.map((region) => {
        const members = region.reviewItemIds.map((id) => {
          const item = itemMap.get(id);
          if (!item) throw new Error("C60114_REGION_MEMBER_MISSING");
          return item;
        });
        const selectedTargets = targets.targets.filter((target) =>
          region.reviewTargetIds.includes(target.reviewTargetId),
        );
        return hashed({
          regionId: region.regionId,
          reviewItemIds: region.reviewItemIds,
          eventIds: uniqueC60114(members.flatMap((item) => item.eventIds)),
          finalCueIds: uniqueC60114(
            members.flatMap((item) => item.finalCueIds),
          ),
          contextStart: Math.min(
            ...region.contextIntervals.map((interval) => interval.start),
          ),
          contextEnd: Math.max(
            ...region.contextIntervals.map((interval) => interval.end),
          ),
          coreIntervals: selectedTargets.map((target) => ({
            reviewItemId: target.parentReviewItemId,
            ...target.sourceInterval,
          })),
          maxPriority: {
            tier:
              members.toSorted((a, b) => b.priorityScore - a.priorityScore)[0]
                ?.priorityTier ?? "LOW",
            score: Math.max(...members.map((item) => item.priorityScore)),
          },
          aggregateReasons: uniqueC60114(
            members.flatMap((item) => item.reviewReasons),
          ),
          itemTypes: uniqueC60114(members.flatMap((item) => item.itemTypes)),
          requiredLevel: region.requiredLevel,
          sceneIds: uniqueC60114(members.flatMap((item) => item.sceneIds)),
          speakerGroupIds: uniqueC60114(
            members.flatMap((item) => item.speakerGroupIds),
          ),
        });
      }),
      summary: {
        itemCount: items.items.length,
        regionCount: input.regionsV3.regions.length,
        mergedItemCount: Math.max(
          0,
          items.items.length - input.regionsV3.regions.length,
        ),
        requiredRegionCount: input.regionsV3.summary.requiredRegionCount,
        totalContextAudioSeconds: input.regionsV3.regions.reduce(
          (sum, region) =>
            sum +
            region.contextIntervals.reduce(
              (n, interval) => n + interval.end - interval.start,
              0,
            ),
          0,
        ),
      },
    }),
  );
  const originalBundles = new Map(
    baseline.delivery.candidates.bundles.map((bundle) => [
      bundle.reviewItemId,
      bundle,
    ]),
  );
  const bundles = items.items.map((item) => {
    const original = originalBundles.get(item.reviewItemId);
    return original
      ? hashed({ ...strip(original), availableActions: item.suggestedActions })
      : hashed({
          reviewItemId: item.reviewItemId,
          displayCandidates: [],
          missingCandidateIds: [],
          availableActions: item.suggestedActions,
          selectionAuthority: "HUMAN_ONLY" as const,
          calibratedConfidencePercentageDisplayed: false as const,
        });
  });
  const candidates = machineReviewCandidateBundlesSchema.parse(
    hashed({
      ...strip(baseline.delivery.candidates),
      bundles,
      summary: {
        ...baseline.delivery.candidates.summary,
        reviewItemCount: bundles.length,
      },
    }),
  );
  const audio = await buildC60114ReviewAudio({
    sourcePath: input.sourcePath,
    sourceIdentity: baseline.sourceIdentity,
    policy: prepared.policy,
    targets,
    regions: input.regionsV3,
    outputDirectory: input.outputDirectory,
    generatedAt: input.generatedAt,
  });
  const playback = buildC60114PlaybackTimeline({
    sourceIdentity: baseline.sourceIdentity,
    policy: prepared.policy,
    targets,
    regions: input.regionsV3,
    audio: audio.manifest,
  });
  const unresolvedItemIds = items.items
    .filter(
      (item) =>
        !targets.targets.some(
          (target) => target.parentReviewItemId === item.reviewItemId,
        ),
    )
    .map((item) => item.reviewItemId);
  const extension = buildC60114WorkspaceExtension({
    ...c60114ArtifactHeader(prepared.policy, baseline.sourceIdentity),
    workspaceMode: "SOURCE_TARGET_PLAYBACK_V3",
    targets,
    regions: input.regionsV3,
    audio: audio.manifest,
    playback,
    lexical: input.lexical,
    missing: input.missing,
    islands: prepared.speechIslands.islands.map((island) => ({
      islandId: island.islandId,
      sourceInterval: island.sourceInterval,
      speechPositive: island.speechPositive,
      sourceIdentity: baseline.sourceIdentity,
      parentGapIds: island.parentGapIds,
    })),
    orphans: prepared.orphanSweep.entries
      .filter((entry) => entry.classification.startsWith("ORPHAN_"))
      .map((entry) => ({
        orphanId: entry.orphanId,
        sourceInterval: entry.sourceInterval,
        classification: entry.classification,
        sourceIslandId: entry.sourceIslandId,
      })),
    unresolvedItemIds,
    rankerStatus: "RANKER_NOT_RECALIBRATED_IN_C6_0_1_14",
    humanTrialStarted: false,
    canonicalMutationAllowed: false,
  });
  const workspaceData: C60112ReviewWorkspaceData = {
    schemaVersion: baseline.workspace.schemaVersion,
    workspaceVersion: baseline.workspace.workspaceVersion,
    policyVersion: baseline.workspace.policyVersion,
    policyHash: baseline.workspace.policyHash,
    reviewPackageSemanticHash: hashed({
      items: items.semanticHash,
      regions: regions.semanticHash,
      candidates: candidates.semanticHash,
      audio: audio.legacy.semanticHash,
      extension: extension.semanticHash,
    }).semanticHash,
    machineDraftHash: baseline.workspace.machineDraftHash,
    sourceMediaIdentity: baseline.workspace.sourceMediaIdentity,
    machineDraftIdentity: baseline.workspace.machineDraftIdentity,
    items: input.itemsV4.items.map((item) => {
      const old = oldUi.get(item.reviewItemId),
        cue =
          item.finalCueIds.length === 1
            ? baseline.replay.subtitlePackage.cues.find(
                (c) => c.id === item.finalCueIds[0],
              )
            : undefined;
      const firstRegion = input.regionsV3.regions.find((region) =>
        region.reviewItemIds.includes(item.reviewItemId),
      );
      return {
        reviewItemId: item.reviewItemId,
        eventIds: item.eventIds,
        finalCueIds: item.finalCueIds,
        itemTypes: item.itemTypes,
        sourceInterval: item.sourceInterval,
        coreInterval: item.coreInterval,
        currentText: item.currentText ?? "",
        currentStart: old?.currentStart ?? cue?.start ?? null,
        currentEnd: old?.currentEnd ?? cue?.end ?? null,
        candidateIds: item.candidateIds,
        evidenceIds: item.evidenceIds,
        reviewReasons: item.reviewReasons,
        priorityTier: item.priorityTier,
        priorityScore: item.priorityScore,
        requiredLevel: item.requiredLevel,
        suggestedActions: c60114TransactionActions({
          finalCueIds: item.finalCueIds,
          suggestedActions: item.suggestedActions,
          previousUiActions: old?.suggestedActions,
        }),
        regionId: firstRegion?.regionId ?? "",
        previousCue: old?.previousCue ?? null,
        nextCue: old?.nextCue ?? null,
        semanticHash: item.semanticHash,
      };
    }),
    regions: regions.regions.map((region) => {
      const clip = audio.manifest.audio.find((entry) =>
        entry.regionIds.includes(region.regionId),
      );
      if (!clip) throw new Error("C60114_WORKSPACE_AUDIO_MISSING");
      return {
        regionId: region.regionId,
        reviewItemIds: region.reviewItemIds,
        contextStart: Math.max(region.contextStart, clip.sourceInterval.start),
        contextEnd: Math.min(region.contextEnd, clip.sourceInterval.end),
        audioSourceInterval: clip.sourceInterval,
        coreIntervals: region.coreIntervals.map(({ start, end }) => ({
          start,
          end,
        })),
        audioPath: clip.relativePath,
        audioSha256: clip.sha256,
      };
    }),
    candidateBundles: candidates.bundles.map((bundle) => ({
      reviewItemId: bundle.reviewItemId,
      candidates: bundle.displayCandidates.map((candidate) => ({
        candidateId: candidate.displayCandidateId,
        labels: candidate.labels,
        text: candidate.displayText,
        evidenceBadges: candidate.evidenceBadges,
        provenance: candidate.provenance.flatMap((p) => p.provenanceIds),
      })),
    })),
    sourceTargetReviewV3: extension,
  };
  await writeC60112ReviewWorkspace({
    workspaceDirectory: input.outputDirectory,
    reviewData: workspaceData,
  });
  const packageInput = {
    sourceMediaSha256: baseline.sourceIdentity.sourceMediaSha256,
    machineDraftHash: baseline.replay.machineDraftHash,
    policy: baseline.replay.policy,
    items,
    priority,
    regions,
    candidates,
    audioManifest: audio.legacy,
    workspaceData,
  };
  const freeze = buildC60112ReviewPackageFreeze({
    frozenAt: input.generatedAt,
    ...packageInput,
  });
  if (!verifyC60112ReviewPackageFreeze({ freeze, packageInput }))
    throw new Error("C60114_TRANSACTION_FREEZE_MISMATCH");
  const artifacts = {
    "machine-review-items.json": items,
    "machine-review-priority.json": priority,
    "machine-review-regions.json": regions,
    "machine-review-candidate-bundles.json": candidates,
    "machine-review-audio-manifest.json": audio.legacy,
    "c6-0-1-12-review-assistance-policy.json": baseline.replay.policy,
    "c6-0-1-12-review-package-freeze.json": freeze,
    "machine-review-items-v4.json": input.itemsV4,
    "machine-review-target-intervals-v2.json": targets,
    "machine-review-regions-v3.json": input.regionsV3,
    "machine-review-audio-manifest-v3.json": audio.manifest,
    "machine-review-playback-timeline-v2.json": playback,
  };
  for (const [name, artifact] of Object.entries(artifacts))
    await atomicWriteJson(path.join(input.outputDirectory, name), artifact);
  await cp(
    path.join(baseline.finalRootA, "subtitle-package.needs-review.json"),
    path.join(input.outputDirectory, "subtitle-package.needs-review.json"),
    { force: false, errorOnExist: true },
  );
  return {
    workspaceData,
    freeze,
    audio,
    playback,
    items,
    regions,
    priority,
    candidates,
  };
}

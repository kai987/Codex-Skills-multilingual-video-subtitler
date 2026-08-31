import path from "node:path";
import { writeFile } from "node:fs/promises";
import {
  c601141WorkspaceExtensionSchema,
  reviewItemTypeSchema,
} from "@mvl/shared";
import { fixture141 } from "./c601141-fixture.js";
import {
  wav141,
  bytesHash141,
} from "../../packages/video-subtitler/src/review/c601141-io.js";
import {
  hashed141,
  header141,
  required141,
} from "../../packages/video-subtitler/src/review/c601141-policy.js";
import { c60114ArtifactHeader } from "../../packages/video-subtitler/src/review/c60114-policy.js";
import { buildC60114ReviewAudio } from "../../packages/video-subtitler/src/review/review-audio-manifest-v3.js";
import { buildC60114PlaybackTimeline } from "../../packages/video-subtitler/src/review/review-playback-timeline-v2.js";
import {
  buildC60114WorkspaceExtension,
  c60114TransactionActions,
} from "../../packages/video-subtitler/src/review/c60114-review-workspace.js";
import {
  audioManifest141,
  playback141,
} from "../../packages/video-subtitler/src/review/c601141-review-delivery.js";
import {
  C60112_REVIEW_WORKSPACE_VERSION,
  writeC60112ReviewWorkspace,
  type C60112ReviewWorkspaceData,
} from "../../packages/video-subtitler/src/review/c60112-review-workspace.js";

export async function syntheticDelivery141(root: string) {
  const sourcePath = path.join(root, "synthetic-source.wav"),
    pcm = Buffer.alloc(40 * 48000 * 2);
  for (let i = 0; i < 40 * 48000; i++)
    pcm.writeInt16LE(
      Math.round(Math.sin((i * 2 * Math.PI * 200) / 48000) * 2048),
      i * 2,
    );
  const bytes = wav141(pcm, 48000);
  await writeFile(sourcePath, bytes);
  const f = fixture141({
    sourceMediaSha256: bytesHash141(bytes),
    durationSeconds: 40,
    sampleRate: 48000,
    audioStreamIndex: 0,
    audioTimebase: "1/48000",
    sourceTimebase: "SOURCE_GLOBAL_SECONDS",
  });
  const directory = path.join(root, "workspace"),
    graph = f.graph;
  const physical = await buildC60114ReviewAudio({
    sourcePath,
    sourceIdentity: f.source,
    policy: f.compatibilityPolicy,
    targets: graph.compatibleTargets,
    regions: graph.compatibleRegions,
    outputDirectory: directory,
    generatedAt: f.selection.selectionFrozenAt,
  });
  const legacyPlayback = buildC60114PlaybackTimeline({
    sourceIdentity: f.source,
    policy: f.compatibilityPolicy,
    targets: graph.compatibleTargets,
    regions: graph.compatibleRegions,
    audio: physical.manifest,
  });
  const audio = audioManifest141(physical.manifest, graph.regions, f.policy),
    playback = playback141({
      legacy: legacyPlayback,
      audio,
      regions: graph.regions,
      targets: graph.targets,
      policy: f.policy,
    });
  const compat = buildC60114WorkspaceExtension({
    ...c60114ArtifactHeader(f.compatibilityPolicy, f.source),
    workspaceMode: "SOURCE_TARGET_PLAYBACK_V3",
    targets: graph.compatibleTargets,
    regions: graph.compatibleRegions,
    audio: physical.manifest,
    playback: legacyPlayback,
    lexical: f.oldLexical,
    missing: f.oldMissing,
    islands: [],
    orphans: [],
    unresolvedItemIds: [],
    rankerStatus: "RANKER_NOT_RECALIBRATED_IN_C6_0_1_14",
    humanTrialStarted: false,
    canonicalMutationAllowed: false,
  });
  const extension = c601141WorkspaceExtensionSchema.parse(
    hashed141({
      ...header141(f.policy, f.source),
      workspaceMode: "MULTIVIEW_SPEECH_INVENTORY_REVIEW_V1",
      targets: graph.targets,
      items: graph.items,
      regions: graph.regions,
      audio,
      playback,
      lexical: f.lexical,
      missing: f.missing,
      safety: f.safety,
      humanTrialStarted: false,
      canonicalMutationAllowed: false,
    }),
  );
  const data: C60112ReviewWorkspaceData = {
    schemaVersion: "1.0.0",
    workspaceVersion: C60112_REVIEW_WORKSPACE_VERSION,
    policyVersion: "c6.0.1.12-multi-asr-review-assistance-v2",
    policyHash: f.policy.semanticHash,
    reviewPackageSemanticHash: extension.semanticHash,
    machineDraftHash: "c".repeat(64),
    sourceMediaIdentity: {
      sha256: f.source.sourceMediaSha256,
      sourceDurationMs: 40000,
    },
    machineDraftIdentity: { cueHash: "c".repeat(64), cueCount: 1 },
    items: graph.compatibleItems.items.map((item) => ({
      ...item,
      itemTypes: item.itemTypes.filter(
        (type) => reviewItemTypeSchema.safeParse(type).success,
      ),
      currentStart: item.finalCueIds.length ? item.coreInterval.start : null,
      currentEnd: item.finalCueIds.length ? item.coreInterval.end : null,
      regionId: required141(
        graph.regions.regions.find((v) =>
          v.reviewItemIds.includes(item.reviewItemId),
        ),
      ).regionId,
      previousCue: null,
      nextCue: null,
      suggestedActions: c60114TransactionActions(item),
    })),
    regions: graph.regions.regions.map((region) => {
      const clip = required141(
        audio.audio.find((v) => v.regionIds.includes(region.regionId)),
      );
      return {
        regionId: region.regionId,
        reviewItemIds: region.reviewItemIds,
        contextStart: required141(region.contextIntervals[0]).start,
        contextEnd: required141(region.contextIntervals.at(-1)).end,
        coreIntervals: region.sourceIntervals,
        audioPath: clip.relativePath,
        audioSha256: clip.sha256,
        audioSourceInterval: clip.sourceInterval,
      };
    }),
    candidateBundles: graph.items.items.map((item) => ({
      reviewItemId: item.reviewItemId,
      candidates: [],
    })),
    sourceTargetReviewV3: compat,
    speechInventoryReviewV1: extension,
  };
  await writeC60112ReviewWorkspace({
    workspaceDirectory: directory,
    reviewData: data,
  });
  return { ...f, directory, sourcePath, data, audio, playback };
}

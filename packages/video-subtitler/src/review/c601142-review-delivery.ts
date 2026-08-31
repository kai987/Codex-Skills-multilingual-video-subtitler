import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  audio142Schema,
  playback142Schema,
  playbackPlan142Schema,
  workspace142Schema,
  type Policy142,
  type ReviewRegions142,
  type ReviewTargets142,
  type Audio142,
  type Playback142,
  type PlaybackPlan142,
  type C60114ReviewAudioManifestV3,
  type C60114PlaybackTimelineV2,
} from "@mvl/shared";
import type { C60112ReviewWorkspaceData } from "./c60112-review-workspace.js";
import { header142 } from "./c601142-policy.js";
import { unique142, coverageSamples142 } from "./c601142-selection.js";
import {
  hashed141,
  assertHash141,
  hash141,
  union141,
} from "./c601141-policy.js";
import { bytesHash141, pcm141, safeRelative141 } from "./c601141-io.js";
import { c60114Union } from "./c60114-policy.js";
export function audioManifest142(
  legacy: C60114ReviewAudioManifestV3,
  regions: ReviewRegions142,
  policy: Policy142,
): Audio142 {
  return audio142Schema.parse(
    hashed141({
      ...header142(policy, legacy.sourceIdentity),
      artifactType: "machine-review-audio-manifest-v5",
      regionsHash: regions.semanticHash,
      compatibilityAudioHash: legacy.semanticHash,
      deliverySubsystemVersion: legacy.deliverySubsystemVersion,
      extractionPolicy: legacy.extractionPolicy,
      audio: legacy.audio.map((a) =>
        hashed141({
          ...a,
          nativeSourceInterval: {
            startSample: Math.round(
              a.sourceInterval.start * legacy.sourceIdentity.sampleRate,
            ),
            endSample: Math.round(
              a.sourceInterval.end * legacy.sourceIdentity.sampleRate,
            ),
          },
        }),
      ),
      targetCoverageChecks: legacy.targetCoverageChecks,
      summary: legacy.summary,
    }),
  );
}
export function selectedPlan142(input: {
  planId: PlaybackPlan142["planId"];
  regionIds: string[];
  segments: Playback142["segments"];
  audio: Audio142;
  budgetSeconds?: number | null;
}) {
  const selected = input.segments.filter((s) =>
      s.regionIds.some((id) => input.regionIds.includes(id)),
    ),
    audioIds = unique142(selected.map((s) => s.audioId));
  const sourceIntervalUnion = c60114Union(
    selected.map((s) => s.sourceInterval),
  );
  return playbackPlan142Schema.parse(
    hashed141({
      planId: input.planId,
      budgetSeconds: input.budgetSeconds ?? null,
      regionIds: input.regionIds,
      reviewTargetIds: unique142(selected.flatMap((s) => s.reviewTargetIds)),
      reviewItemIds: unique142(selected.flatMap((s) => s.reviewItemIds)),
      playbackSegmentIds: selected.map((s) => s.playbackSegmentId),
      audioIds,
      physicalAudioSha256s: audioIds.map((id) => {
        const audio = input.audio.audio.find((a) => a.audioId === id);
        if (!audio) throw new Error("C601142_PLAN_AUDIO_UNBOUND");
        return audio.sha256;
      }),
      sourceIntervalUnion,
      uniqueAudioSeconds: sourceIntervalUnion.reduce(
        (n, v) => n + v.end - v.start,
        0,
      ),
      rankerStatus: "RANKER_NOT_RECALIBRATED_IN_C6_0_1_14_2",
    }),
  );
}
export function playback142(input: {
  legacy: C60114PlaybackTimelineV2;
  audio: Audio142;
  regions: ReviewRegions142;
  targets: ReviewTargets142;
  policy: Policy142;
}): Playback142 {
  const { legacy, audio, regions, targets, policy } = input;
  const plans = legacy.plans.map((plan) =>
    playbackPlan142Schema.parse(
      hashed141({
        ...plan,
        rankerStatus: "RANKER_NOT_RECALIBRATED_IN_C6_0_1_14_2",
      }),
    ),
  );
  const full = selectedPlan142({
    planId: "C601142_FINAL_FULL_QUEUE",
    regionIds: regions.regions.map((r) => r.regionId),
    segments: legacy.segments,
    audio,
  });
  plans.push(full);
  const fullQueueEpisodeRatio =
    full.uniqueAudioSeconds / legacy.sourceIdentity.durationSeconds;
  return playback142Schema.parse(
    hashed141({
      ...header142(policy, legacy.sourceIdentity),
      artifactType: "machine-review-playback-timeline-v4",
      audioManifestHash: audio.semanticHash,
      regionsHash: regions.semanticHash,
      targetsHash: targets.semanticHash,
      compatibilityPlaybackHash: legacy.semanticHash,
      segments: legacy.segments,
      plans,
      officialFullQueuePlan: "C601142_FINAL_FULL_QUEUE",
      targetCoverageChecks: legacy.targetCoverageChecks,
      summary: legacy.summary,
      fullQueueEpisodeRatio,
      burdenGate:
        fullQueueEpisodeRatio <= policy.coverage.maximumEpisodeBurden
          ? "PASSED"
          : "FULL_QUEUE_BURDEN_DEGENERATE",
    }),
  );
}
export function assertWorkspace142(data: C60112ReviewWorkspaceData) {
  if (!data.detectorCeilingReviewV2) return;
  const current = workspace142Schema.parse(data.detectorCeilingReviewV2),
    compatibility = data.sourceTargetReviewV3;
  if (!compatibility)
    throw new Error("C601142_REVIEW_TRANSACTION_PROJECTION_REQUIRED");
  [
    current,
    current.targets,
    current.items,
    current.regions,
    current.audio,
    current.playback,
    current.lexical,
    current.missing,
    current.safety,
  ].forEach(assertHash141);
  for (const artifact of [
    current.targets,
    current.items,
    current.regions,
    current.audio,
    current.playback,
    current.lexical,
    current.missing,
    current.safety,
  ])
    if (
      hash141(artifact.sourceIdentity) !== hash141(current.sourceIdentity) ||
      artifact.policyHash !== current.policyHash
    )
      throw new Error("C601142_WORKSPACE_POLICY_OR_SOURCE_MISMATCH");
  if (
    current.targets.compatibilityTargetsHash !==
      compatibility.targets.semanticHash ||
    current.regions.compatibilityRegionsHash !==
      compatibility.regions.semanticHash ||
    current.audio.compatibilityAudioHash !== compatibility.audio.semanticHash ||
    current.playback.compatibilityPlaybackHash !==
      compatibility.playback.semanticHash ||
    current.items.targetsHash !== current.targets.semanticHash ||
    current.regions.targetsHash !== current.targets.semanticHash ||
    current.regions.itemsHash !== current.items.semanticHash ||
    current.audio.regionsHash !== current.regions.semanticHash ||
    current.playback.audioManifestHash !== current.audio.semanticHash ||
    current.playback.targetsHash !== current.targets.semanticHash ||
    current.playback.regionsHash !== current.regions.semanticHash ||
    current.missing.lexicalHash !== current.lexical.semanticHash ||
    current.missing.safetyHash !== current.safety.semanticHash ||
    current.targets.safetyHash !== current.safety.semanticHash ||
    current.lexical.previousLexicalHash !==
      current.lexical.previousLexical.semanticHash
  )
    throw new Error("C601142_WORKSPACE_ARTIFACT_BINDING_MISMATCH");
  const rate = current.sourceIdentity.sampleRate;
  for (const target of current.targets.targets) {
    const segments = current.playback.segments.filter((s) =>
      s.reviewTargetIds.includes(target.reviewTargetId),
    );
    if (
      target.audioRequired &&
      coverageSamples142(
        target.nativeInterval,
        segments.map((s) => ({
          startSample: Math.round(s.sourceInterval.start * rate),
          endSample: Math.round(s.sourceInterval.end * rate),
        })),
      ) <
        target.nativeInterval.endSample - target.nativeInterval.startSample - 1
    )
      throw new Error("C601142_AUDIO_REQUIRED_TARGET_WITHOUT_PLAYBACK");
    if (target.safetyClusterTargetId) {
      const cluster = current.safety.targets.find(
        (c) => c.targetId === target.safetyClusterTargetId,
      );
      if (
        !cluster ||
        coverageSamples142(target.nativeInterval, cluster.targetCoreUnion) !==
          target.nativeInterval.endSample - target.nativeInterval.startSample
      )
        throw new Error("C601142_REVIEW_ENVELOPE_MASQUERADING_AS_SPEECH");
    }
  }
  for (const segment of current.playback.segments) {
    const clip = current.audio.audio.find((a) => a.audioId === segment.audioId);
    if (
      !clip ||
      segment.sourceInterval.start < clip.sourceInterval.start - 1 / 16000 ||
      segment.sourceInterval.end > clip.sourceInterval.end + 1 / 16000 ||
      Math.abs(
        segment.sourceInterval.start -
          clip.sourceInterval.start -
          segment.audioLocalInterval.start,
      ) >
        1 / 16000 ||
      Math.abs(
        segment.sourceInterval.end -
          clip.sourceInterval.start -
          segment.audioLocalInterval.end,
      ) >
        1 / 16000
    )
      throw new Error("C601142_PLAYBACK_PHYSICAL_AUDIO_BINDING_INVALID");
  }
  const cores = union141(
    current.safety.targets.flatMap((t) => t.targetCoreUnion),
  );
  if (
    cores.reduce((n, v) => n + v.endSample - v.startSample, 0) / rate >
      60 + 1e-9 ||
    current.safety.targets.length > 24
  )
    throw new Error("C601142_SAFETY_BUDGET_EXCEEDED");
}
export async function verifyPhysicalAudio142(
  directory: string,
  manifest: Audio142,
) {
  audio142Schema.parse(manifest);
  assertHash141(manifest);
  for (const clip of manifest.audio) {
    const filename = path.resolve(directory, clip.relativePath);
    safeRelative141(directory, filename);
    const bytes = await readFile(filename),
      wave = pcm141(bytes);
    if (
      bytesHash141(bytes) !== clip.sha256 ||
      wave.frames !== clip.frameCount ||
      wave.sampleRate !== 16000 ||
      wave.channels !== 1
    )
      throw new Error("C601142_PHYSICAL_WAV_INVALID_OR_CHANGED");
  }
  return {
    actualAudioCount: manifest.audio.length,
    playableCount: manifest.audio.length,
    hashVerifiedCount: manifest.audio.length,
    allPassed: true as const,
  };
}

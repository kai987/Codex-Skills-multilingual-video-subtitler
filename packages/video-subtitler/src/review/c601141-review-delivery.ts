import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  c601141AudioManifestSchema,
  c601141PlaybackSchema,
  c601141PlaybackPlanSchema,
  c601141WorkspaceExtensionSchema,
  type C601141Policy,
  type C601141ReviewTargets,
  type C601141ReviewRegions,
  type C601141AudioManifest,
  type C601141Playback,
  type C601141PlaybackPlan,
  type C60114ReviewAudioManifestV3,
  type C60114PlaybackTimelineV2,
} from "@mvl/shared";
import type { C60112ReviewWorkspaceData } from "./c60112-review-workspace.js";
import {
  hashed141,
  hash141,
  header141,
  assertHash141,
  unique141,
  required141,
} from "./c601141-policy.js";
import { c60114Union, c60114Coverage } from "./c60114-policy.js";
import { sourceSamples141 } from "./c601141-review-graph.js";
import { bytesHash141, pcm141, safeRelative141 } from "./c601141-io.js";

export function audioManifest141(
  legacy: C60114ReviewAudioManifestV3,
  regions: C601141ReviewRegions,
  policy: C601141Policy,
) {
  return c601141AudioManifestSchema.parse(
    hashed141({
      ...header141(policy, legacy.sourceIdentity),
      artifactType: "machine-review-audio-manifest-v4",
      regionsHash: regions.semanticHash,
      compatibilityAudioHash: legacy.semanticHash,
      deliverySubsystemVersion: legacy.deliverySubsystemVersion,
      extractionPolicy: legacy.extractionPolicy,
      audio: legacy.audio.map((clip) =>
        hashed141({
          ...clip,
          nativeSourceInterval: sourceSamples141(
            clip.sourceInterval,
            legacy.sourceIdentity.sampleRate,
          ),
        }),
      ),
      targetCoverageChecks: legacy.targetCoverageChecks,
      summary: legacy.summary,
    }),
  );
}
export function selectedPlan141(input: {
  planId: C601141PlaybackPlan["planId"];
  regionIds: string[];
  segments: C601141Playback["segments"];
  audio: C601141AudioManifest;
  budgetSeconds?: number | null;
}) {
  const selected = input.segments.filter((segment) =>
    segment.regionIds.some((id) => input.regionIds.includes(id)),
  );
  const audioIds = unique141(selected.map((v) => v.audioId));
  const sourceIntervalUnion = c60114Union(
    selected.map((v) => v.sourceInterval),
  );
  return c601141PlaybackPlanSchema.parse(
    hashed141({
      planId: input.planId,
      budgetSeconds: input.budgetSeconds ?? null,
      regionIds: input.regionIds,
      reviewTargetIds: unique141(selected.flatMap((v) => v.reviewTargetIds)),
      reviewItemIds: unique141(selected.flatMap((v) => v.reviewItemIds)),
      playbackSegmentIds: selected.map((v) => v.playbackSegmentId),
      audioIds,
      physicalAudioSha256s: audioIds.map((id) => {
        const clip = input.audio.audio.find((v) => v.audioId === id);
        if (!clip) throw new Error("C601141_PLAN_AUDIO_MISSING");
        return clip.sha256;
      }),
      sourceIntervalUnion,
      uniqueAudioSeconds: sourceIntervalUnion.reduce(
        (n, v) => n + v.end - v.start,
        0,
      ),
      rankerStatus: "RANKER_NOT_RECALIBRATED_IN_C6_0_1_14",
    }),
  );
}
export function playback141(input: {
  legacy: C60114PlaybackTimelineV2;
  audio: C601141AudioManifest;
  regions: C601141ReviewRegions;
  targets: C601141ReviewTargets;
  policy: C601141Policy;
}) {
  const { legacy, audio, regions, targets, policy } = input;
  const plans: C601141PlaybackPlan[] = [
    ...legacy.plans,
    selectedPlan141({
      planId: "FULL_QUEUE_CONSERVATIVE_SPEECH",
      regionIds: regions.regions
        .filter((v) => v.reviewLayer !== "MISSING_SAFETY_RESERVE")
        .map((v) => v.regionId),
      segments: legacy.segments,
      audio,
    }),
    selectedPlan141({
      planId: "FULL_QUEUE_WITH_SAFETY_RESERVE",
      regionIds: regions.regions.map((v) => v.regionId),
      segments: legacy.segments,
      audio,
    }),
  ];
  return c601141PlaybackSchema.parse(
    hashed141({
      ...header141(policy, legacy.sourceIdentity),
      artifactType: "machine-review-playback-timeline-v3",
      audioManifestHash: audio.semanticHash,
      regionsHash: regions.semanticHash,
      targetsHash: targets.semanticHash,
      compatibilityPlaybackHash: legacy.semanticHash,
      segments: legacy.segments,
      plans,
      officialFullQueuePlan: "FULL_QUEUE_WITH_SAFETY_RESERVE",
      targetCoverageChecks: legacy.targetCoverageChecks,
      summary: legacy.summary,
    }),
  );
}
export function assertInventoryWorkspace141(data: C60112ReviewWorkspaceData) {
  if (!data.speechInventoryReviewV1) return;
  const current = c601141WorkspaceExtensionSchema.parse(
      data.speechInventoryReviewV1,
    ),
    legacy = data.sourceTargetReviewV3;
  if (!legacy) throw new Error("C601141_TRANSACTION_PROJECTION_REQUIRED");
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
      throw new Error("C601141_WORKSPACE_SOURCE_OR_POLICY_MISMATCH");
  if (
    current.targets.compatibilityTargetsHash !== legacy.targets.semanticHash ||
    current.regions.compatibilityRegionsHash !== legacy.regions.semanticHash ||
    current.audio.compatibilityAudioHash !== legacy.audio.semanticHash ||
    current.playback.compatibilityPlaybackHash !==
      legacy.playback.semanticHash ||
    current.items.targetsHash !== current.targets.semanticHash ||
    current.regions.targetsHash !== current.targets.semanticHash ||
    current.regions.itemsHash !== current.items.semanticHash ||
    current.audio.regionsHash !== current.regions.semanticHash ||
    current.playback.audioManifestHash !== current.audio.semanticHash ||
    current.playback.regionsHash !== current.regions.semanticHash ||
    current.playback.targetsHash !== current.targets.semanticHash ||
    current.missing.lexicalHash !== current.lexical.semanticHash ||
    current.missing.safetyHash !== current.safety.semanticHash ||
    current.targets.safetyHash !== current.safety.semanticHash
  )
    throw new Error("C601141_WORKSPACE_ARTIFACT_BINDING_MISMATCH");
  if (
    current.lexical.existingProbeEvidence &&
    current.lexical.existingProbeEvidenceHash !==
      current.lexical.existingProbeEvidence.semanticHash
  )
    throw new Error("C601141_LEGACY_LEXICAL_BINDING_MISMATCH");
  const allIds = new Set(current.targets.targets.map((v) => v.reviewTargetId));
  if (
    allIds.size !== current.targets.targets.length ||
    new Set(current.playback.plans.map((v) => v.planId)).size !== 9
  )
    throw new Error("C601141_DUPLICATE_DELIVERY_IDENTITIES");
  for (const target of current.targets.targets) {
    assertHash141(target);
    const original = legacy.targets.targets.find(
      (v) => v.reviewTargetId === target.reviewTargetId,
    );
    if (
      !original ||
      hash141(original.sourceInterval) !== hash141(target.sourceInterval) ||
      original.parentReviewItemId !== target.parentReviewItemId ||
      hash141(original.finalCueIds) !== hash141(target.finalCueIds) ||
      original.mandatoryForAudio !== target.mandatoryForAudio
    )
      throw new Error("C601141_TARGET_COMPATIBILITY_MUTATION");
    if (
      target.targetSource !== "PRESERVED_BASELINE" &&
      !current.safety.targets.some(
        (v) =>
          v.targetId === target.reviewTargetId &&
          hash141(v.nativeInterval) === hash141(target.nativeInterval),
      )
    )
      throw new Error("C601141_UNPLANNED_SAFETY_TARGET");
  }
  for (const clip of current.audio.audio) {
    assertHash141(clip);
    const original = legacy.audio.audio.find((v) => v.audioId === clip.audioId);
    if (
      original?.sha256 !== clip.sha256 ||
      original.relativePath !== clip.relativePath ||
      hash141(original.sourceInterval) !== hash141(clip.sourceInterval)
    )
      throw new Error("C601141_AUDIO_COMPATIBILITY_MUTATION");
  }
  if (hash141(current.playback.segments) !== hash141(legacy.playback.segments))
    throw new Error("C601141_PLAYBACK_SEGMENT_COMPATIBILITY_MUTATION");
  for (const plan of current.playback.plans) {
    const expectedRegionIds =
      plan.planId === "FULL_QUEUE_WITH_SAFETY_RESERVE"
        ? current.regions.regions.map((v) => v.regionId)
        : plan.planId === "FULL_QUEUE_CONSERVATIVE_SPEECH"
          ? current.regions.regions
              .filter((v) => v.reviewLayer !== "MISSING_SAFETY_RESERVE")
              .map((v) => v.regionId)
          : legacy.playback.plans.find((v) => v.planId === plan.planId)
              ?.regionIds;
    if (
      !expectedRegionIds ||
      hash141(expectedRegionIds) !== hash141(plan.regionIds)
    )
      throw new Error("C601141_PLAN_LAYER_MEMBERSHIP_CHANGED");
    const expected = selectedPlan141({
      planId: plan.planId,
      regionIds: plan.regionIds,
      segments: current.playback.segments,
      audio: current.audio,
      budgetSeconds: plan.budgetSeconds,
    });
    if (hash141(expected) !== hash141(plan))
      throw new Error("C601141_PLAN_PHYSICAL_MAPPING_MISMATCH");
    if (
      plan.budgetSeconds !== null &&
      plan.uniqueAudioSeconds > plan.budgetSeconds + 1e-7
    )
      throw new Error("C601141_PLAN_BUDGET_EXCEEDED");
  }
  const full = required141(
    current.playback.plans.find(
      (v) => v.planId === current.playback.officialFullQueuePlan,
    ),
  );
  for (const target of current.targets.targets)
    if (
      c60114Coverage(target.sourceInterval, full.sourceIntervalUnion) <
      1 - 1e-7
    )
      throw new Error("C601141_TARGET_PLAYBACK_OMISSION");
  const mandatory = required141(
      current.playback.plans.find((v) => v.planId === "ALL_MANDATORY"),
    ),
    oldMandatory = required141(
      legacy.playback.plans.find((v) => v.planId === "ALL_MANDATORY"),
    );
  if (hash141(mandatory) !== hash141(oldMandatory))
    throw new Error("C601141_MANDATORY_PLAN_MUTATION");
  for (const item of current.items.items) {
    assertHash141(item);
    const ui = data.items.find((v) => v.reviewItemId === item.reviewItemId);
    if (
      !ui ||
      hash141(ui.finalCueIds) !== hash141(item.finalCueIds) ||
      ui.requiredLevel !== item.requiredLevel
    )
      throw new Error("C601141_ITEM_UI_IDENTITY_MISMATCH");
  }
}
export async function verifyPhysicalAudio141(
  directory: string,
  manifest: C601141AudioManifest,
) {
  assertHash141(manifest);
  for (const clip of manifest.audio) {
    const file = path.resolve(directory, clip.relativePath);
    safeRelative141(directory, file);
    const bytes = await readFile(file),
      wave = pcm141(bytes);
    if (
      bytesHash141(bytes) !== clip.sha256 ||
      wave.frames !== clip.frameCount ||
      wave.sampleRate !== 16000 ||
      wave.channels !== 1
    )
      throw new Error("C601141_PHYSICAL_WAV_INVALID_OR_CHANGED");
  }
  return {
    actualAudioCount: manifest.audio.length,
    playableCount: manifest.audio.length,
    hashVerifiedCount: manifest.audio.length,
    allPassed: true as const,
  };
}

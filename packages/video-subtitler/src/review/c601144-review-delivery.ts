import {
  reviewAudio144Schema,
  reviewItems144Schema,
  reviewPlayback144Schema,
  reviewRegions144Schema,
  reviewTargets144Schema,
  type Items143,
  type Regions143,
  type SafetyTargets144,
  type Targets143,
  type Audio143,
  type Playback143,
  type Planner144,
  type UtilityPolicy144,
} from "@mvl/shared";
import { assertHash141, hashed141, required141 } from "./c601141-policy.js";
import { header144 } from "./c601144-policy.js";

const body144 = (value: Record<string, unknown>) => {
  const excluded = new Set([
    "schemaVersion",
    "policyVersion",
    "policyHash",
    "sourceIdentity",
    "sourceTimebase",
    "runtimeGoldInputCount",
    "visibility",
    "semanticHash",
    "artifactType",
  ]);
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !excluded.has(key)),
  );
};

export function projectReviewDelivery144(input: {
  policy: UtilityPolicy144;
  safety: SafetyTargets144;
  planner: Planner144;
  targets: Targets143;
  items: Items143;
  regions: Regions143;
  audio: Audio143;
  playback: Playback143;
}) {
  const { policy, safety, planner } = input;
  [
    policy,
    safety,
    planner,
    input.targets,
    input.items,
    input.regions,
    input.audio,
    input.playback,
  ].forEach(assertHash141);
  const utilityByBundle = new Map(
    safety.targets.map((target) => [target.bundleId, target]),
  );
  const targetRows = input.targets.targets.map((source) => {
    assertHash141(source);
    const utility = source.bundleId
      ? utilityByBundle.get(source.bundleId)
      : undefined;
    return reviewTargets144Schema.shape.targets.element.parse(
      hashed141({
        ...source,
        atomUtilityRefs: utility?.atomUtilityRefs ?? [],
        childUtilityRefs: utility?.childUtilityRefs ?? [],
        bundleUtilityRef: utility?.bundleUtilityRef ?? null,
        semanticHash: undefined,
      }),
    );
  });
  const targets = reviewTargets144Schema.parse(
    hashed141({
      ...body144(input.targets),
      ...header144(policy, input.targets.sourceIdentity),
      artifactType: "machine-review-target-intervals-v6",
      plannerCertificateHash: planner.semanticHash,
      targets: targetRows,
      sourceArtifactHash: input.targets.semanticHash,
      safetyV4Hash: safety.semanticHash,
    }),
  );
  const targetHashById = new Map(
    targets.targets.map((target) => [
      target.reviewTargetId,
      target.semanticHash,
    ]),
  );
  const itemRows = input.items.items.map((source) => {
    assertHash141(source);
    return reviewItems144Schema.shape.items.element.parse(
      hashed141({
        ...source,
        utilityTargetHashes: source.reviewTargetIds.map((targetId) =>
          required141(
            targetHashById.get(targetId),
            "C601144_ITEM_TARGET_PROJECTION_MISSING",
          ),
        ),
        semanticHash: undefined,
      }),
    );
  });
  const items = reviewItems144Schema.parse(
    hashed141({
      ...body144(input.items),
      ...header144(policy, input.items.sourceIdentity),
      artifactType: "machine-review-items-v8",
      items: itemRows,
      sourceArtifactHash: input.items.semanticHash,
      utilityTargetsHash: targets.semanticHash,
    }),
  );
  const regionRows = input.regions.regions.map((source) => {
    assertHash141(source);
    return reviewRegions144Schema.shape.regions.element.parse(
      hashed141({
        ...source,
        utilityTargetHashes: source.reviewTargetIds.map((targetId) =>
          required141(
            targetHashById.get(targetId),
            "C601144_REGION_TARGET_PROJECTION_MISSING",
          ),
        ),
        semanticHash: undefined,
      }),
    );
  });
  const regions = reviewRegions144Schema.parse(
    hashed141({
      ...body144(input.regions),
      ...header144(policy, input.regions.sourceIdentity),
      artifactType: "machine-review-regions-v7",
      regions: regionRows,
      sourceArtifactHash: input.regions.semanticHash,
      utilityItemsHash: items.semanticHash,
    }),
  );
  input.audio.audio.forEach(assertHash141);
  const audio = reviewAudio144Schema.parse(
    hashed141({
      ...body144(input.audio),
      ...header144(policy, input.audio.sourceIdentity),
      artifactType: "machine-review-audio-manifest-v7",
      targetsHash: targets.semanticHash,
      regionsHash: regions.semanticHash,
      safetyHash: safety.semanticHash,
      sourceArtifactHash: input.audio.semanticHash,
      utilityRegionsHash: regions.semanticHash,
      plannedAudioCount: input.audio.summary.plannedAudioCount,
      actualAudioCount: input.audio.summary.actualAudioCount,
      playableAudioCount: input.audio.summary.playableCount,
      hashVerifiedAudioCount: input.audio.summary.hashVerifiedCount,
      audioExtractionFailureCount: input.audio.summary.extractionFailureCount,
    }),
  );
  input.playback.segments.forEach(assertHash141);
  input.playback.plans.forEach(assertHash141);
  const audioIds = new Set(audio.audio.map((row) => row.audioId)),
    targetIds = new Set(targets.targets.map((row) => row.reviewTargetId)),
    playbackTargetIds = new Set(
      input.playback.segments.flatMap((segment) => segment.reviewTargetIds),
    );
  if (
    input.playback.segments.some(
      (segment) =>
        !audioIds.has(segment.audioId) ||
        segment.reviewTargetIds.some((targetId) => !targetIds.has(targetId)),
    )
  )
    throw new Error("C601144_PLAYBACK_SOURCE_MAPPING_INCOMPLETE");
  const requiredTargets = targets.targets.filter(
    (target) => target.audioRequired,
  );
  if (
    requiredTargets.some(
      (target) => !playbackTargetIds.has(target.reviewTargetId),
    )
  )
    throw new Error("C601144_AUDIO_REQUIRED_TARGET_PLAYBACK_MISSING");
  if (
    audio.audio.length !== audio.actualAudioCount ||
    audio.actualAudioCount !== audio.playableAudioCount ||
    audio.playableAudioCount !== audio.hashVerifiedAudioCount ||
    audio.audioExtractionFailureCount !== 0
  )
    throw new Error("C601144_PHYSICAL_AUDIO_HARD_GATE_FAILED");
  const playback = reviewPlayback144Schema.parse(
    hashed141({
      ...body144(input.playback),
      ...header144(policy, input.playback.sourceIdentity),
      artifactType: "machine-review-playback-timeline-v6",
      audioManifestHash: audio.semanticHash,
      targetsHash: targets.semanticHash,
      regionsHash: regions.semanticHash,
      safetyHash: safety.semanticHash,
      plannerCertificateHash: planner.semanticHash,
      sourceArtifactHash: input.playback.semanticHash,
      utilityAudioManifestHash: audio.semanticHash,
      playbackToAudioCoverageRatio: 1,
      playbackToTargetCoverageRatio: 1,
    }),
  );
  return { targets, items, regions, audio, playback };
}

import {
  reviewAudio145Schema,
  reviewItems145Schema,
  reviewPlayback145Schema,
  reviewRegions145Schema,
  reviewTargets145Schema,
  type Audio143,
  type Items143,
  type Playback143,
  type Planner145,
  type Policy145,
  type Regions143,
  type ReviewTargets144,
  type SafetyTargets145,
  type Targets143,
} from "@mvl/shared";
import { assertHash141, hashed141, required141 } from "./c601141-policy.js";
import { header145 } from "./c601145-policy.js";

const unique145 = (values: readonly string[]) =>
  [...new Set(values)].sort((a, b) => a.localeCompare(b));

const body145 = (value: Record<string, unknown>) => {
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

export function projectReviewDelivery145(input: {
  policy: Policy145;
  safety: SafetyTargets145;
  planner: Planner145;
  targets: Targets143;
  items: Items143;
  regions: Regions143;
  audio: Audio143;
  playback: Playback143;
  previousTargets?: ReviewTargets144;
}) {
  const hashBoundInputs: { semanticHash: string }[] = [
    input.policy,
    input.safety,
    input.planner,
    input.targets,
    input.items,
    input.regions,
    input.audio,
    input.playback,
  ];
  if (input.previousTargets) hashBoundInputs.push(input.previousTargets);
  hashBoundInputs.forEach(assertHash141);
  const safetyByBundle = new Map(
      input.safety.targets.flatMap((target) =>
        target.bundleIds.map((bundleId) => [bundleId, target] as const),
      ),
    ),
    previousTargetById = new Map(
      (input.previousTargets?.targets ?? []).map((target) => [
        target.reviewTargetId,
        target,
      ]),
    ),
    targetRows = input.targets.targets.map((source) => {
      assertHash141(source);
      const safety = source.bundleId
          ? safetyByBundle.get(source.bundleId)
          : undefined,
        previous = previousTargetById.get(source.reviewTargetId);
      return reviewTargets145Schema.shape.targets.element.parse(
        hashed141({
          ...source,
          atomUtilityRefs: previous?.atomUtilityRefs ?? [],
          childUtilityRefs: previous?.childUtilityRefs ?? [],
          bundleUtilityRef: previous?.bundleUtilityRef ?? null,
          coverageUnitIds: safety?.coverageUnitIds ?? [],
          realizationId: safety?.realizationId ?? null,
          contractType: safety?.contractType ?? null,
          atomicTargetCoreIntervals: safety?.atomicTargetCoreIntervals ?? [],
          reviewEnvelope: safety?.reviewEnvelope ?? null,
          unitUtilityRefs: safety?.unitUtilityRefs ?? [],
          semanticHash: undefined,
        }),
      );
    }),
    targets = reviewTargets145Schema.parse(
      hashed141({
        ...body145(input.targets),
        ...header145(input.policy, input.targets.sourceIdentity),
        artifactType: "machine-review-target-intervals-v7",
        plannerCertificateHash: input.planner.semanticHash,
        targets: targetRows,
        sourceArtifactHash: input.targets.semanticHash,
        safetyV4Hash:
          input.previousTargets?.safetyV4Hash ??
          input.safety.sourceSafetyTargetsHash,
        safetyV5Hash: input.safety.semanticHash,
      }),
    ),
    targetById = new Map(
      targets.targets.map((target) => [target.reviewTargetId, target]),
    ),
    itemRows = input.items.items.map((source) => {
      assertHash141(source);
      const linked = source.reviewTargetIds.map((targetId) =>
        required141(targetById.get(targetId), "C601145_ITEM_TARGET_MISSING"),
      );
      return reviewItems145Schema.shape.items.element.parse(
        hashed141({
          ...source,
          coverageUnitIds: unique145(
            linked.flatMap((target) => target.coverageUnitIds),
          ),
          contractTypes: unique145(
            linked.flatMap((target) =>
              target.contractType ? [target.contractType] : [],
            ),
          ),
          utilityTargetHashes: linked.map((target) => target.semanticHash),
          semanticHash: undefined,
        }),
      );
    }),
    items = reviewItems145Schema.parse(
      hashed141({
        ...body145(input.items),
        ...header145(input.policy, input.items.sourceIdentity),
        artifactType: "machine-review-items-v9",
        items: itemRows,
        sourceArtifactHash: input.items.semanticHash,
        utilityTargetsHash: targets.semanticHash,
        coverageTargetsHash: targets.semanticHash,
      }),
    ),
    regionRows = input.regions.regions.map((source) => {
      assertHash141(source);
      const linked = source.reviewTargetIds.map((targetId) =>
        required141(targetById.get(targetId), "C601145_REGION_TARGET_MISSING"),
      );
      return reviewRegions145Schema.shape.regions.element.parse(
        hashed141({
          ...source,
          coverageUnitIds: unique145(
            linked.flatMap((target) => target.coverageUnitIds),
          ),
          contractTypes: unique145(
            linked.flatMap((target) =>
              target.contractType ? [target.contractType] : [],
            ),
          ),
          utilityTargetHashes: linked.map((target) => target.semanticHash),
          semanticHash: undefined,
        }),
      );
    }),
    regions = reviewRegions145Schema.parse(
      hashed141({
        ...body145(input.regions),
        ...header145(input.policy, input.regions.sourceIdentity),
        artifactType: "machine-review-regions-v8",
        regions: regionRows,
        sourceArtifactHash: input.regions.semanticHash,
        utilityItemsHash: items.semanticHash,
        coverageItemsHash: items.semanticHash,
      }),
    ),
    audioRows = input.audio.audio.map((source) => {
      assertHash141(source);
      const linked = source.coveredReviewTargetIds.map((targetId) =>
        required141(targetById.get(targetId), "C601145_AUDIO_TARGET_MISSING"),
      );
      return reviewAudio145Schema.shape.audio.element.parse(
        hashed141({
          ...source,
          coveredCoverageUnitIds: unique145(
            linked.flatMap((target) => target.coverageUnitIds),
          ),
          semanticHash: undefined,
        }),
      );
    }),
    audio = reviewAudio145Schema.parse(
      hashed141({
        ...body145(input.audio),
        ...header145(input.policy, input.audio.sourceIdentity),
        artifactType: "machine-review-audio-manifest-v8",
        audio: audioRows,
        targetsHash: targets.semanticHash,
        regionsHash: regions.semanticHash,
        safetyHash: input.safety.semanticHash,
        sourceArtifactHash: input.audio.semanticHash,
        utilityRegionsHash: regions.semanticHash,
        plannedAudioCount: input.audio.summary.plannedAudioCount,
        actualAudioCount: input.audio.summary.actualAudioCount,
        playableAudioCount: input.audio.summary.playableCount,
        hashVerifiedAudioCount: input.audio.summary.hashVerifiedCount,
        audioExtractionFailureCount: input.audio.summary.extractionFailureCount,
        coverageRegionsHash: regions.semanticHash,
        coverageUnitAudioCoverageRatio: 1,
      }),
    ),
    audioById = new Map(audio.audio.map((row) => [row.audioId, row])),
    playbackRows = input.playback.segments.map((source) => {
      assertHash141(source);
      const linked = source.reviewTargetIds.map((targetId) =>
        required141(
          targetById.get(targetId),
          "C601145_PLAYBACK_TARGET_MISSING",
        ),
      );
      required141(
        audioById.get(source.audioId),
        "C601145_PLAYBACK_AUDIO_MISSING",
      );
      return reviewPlayback145Schema.shape.segments.element.parse(
        hashed141({
          ...source,
          coverageUnitIds: unique145(
            linked.flatMap((target) => target.coverageUnitIds),
          ),
          semanticHash: undefined,
        }),
      );
    }),
    playback = reviewPlayback145Schema.parse(
      hashed141({
        ...body145(input.playback),
        ...header145(input.policy, input.playback.sourceIdentity),
        artifactType: "machine-review-playback-timeline-v7",
        segments: playbackRows,
        audioManifestHash: audio.semanticHash,
        targetsHash: targets.semanticHash,
        regionsHash: regions.semanticHash,
        safetyHash: input.safety.semanticHash,
        plannerCertificateHash: input.planner.semanticHash,
        sourceArtifactHash: input.playback.semanticHash,
        utilityAudioManifestHash: audio.semanticHash,
        coverageAudioManifestHash: audio.semanticHash,
        playbackToAudioCoverageRatio: 1,
        playbackToTargetCoverageRatio: 1,
        playbackToCoverageUnitRatio: 1,
      }),
    );

  const selectedUnits = new Set(input.planner.selectedCoverageUnitIds),
    targetUnits = new Set(
      targets.targets.flatMap((row) => row.coverageUnitIds),
    ),
    audioUnits = new Set(
      audio.audio.flatMap((row) => row.coveredCoverageUnitIds),
    ),
    playbackUnits = new Set(
      playback.segments.flatMap((row) => row.coverageUnitIds),
    ),
    missing = (available: Set<string>) =>
      [...selectedUnits].filter((unitId) => !available.has(unitId));
  if (missing(targetUnits).length)
    throw new Error("C601145_SELECTED_UNIT_TARGET_PROJECTION_INCOMPLETE");
  if (missing(audioUnits).length)
    throw new Error("C601145_SELECTED_UNIT_AUDIO_PROJECTION_INCOMPLETE");
  if (missing(playbackUnits).length)
    throw new Error("C601145_SELECTED_UNIT_PLAYBACK_PROJECTION_INCOMPLETE");
  if (
    audio.audio.length !== audio.actualAudioCount ||
    audio.actualAudioCount !== audio.playableAudioCount ||
    audio.playableAudioCount !== audio.hashVerifiedAudioCount ||
    audio.audioExtractionFailureCount !== 0
  )
    throw new Error("C601145_REVIEW_AUDIO_HARD_GATE_FAILED");
  return { targets, items, regions, audio, playback };
}

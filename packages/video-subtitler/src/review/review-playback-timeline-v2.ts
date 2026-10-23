import {
  c60114PlaybackTimelineV2Schema,
  c60114PlaybackSegmentSchema,
  c60114ReviewTargetsSchema,
  c60114ReviewRegionsV3Schema,
  c60114ReviewAudioManifestV3Schema,
  type C60114PlaybackTimelineV2,
  type C60114PlaybackSegment,
  type C60114Policy,
  type C60114SourceIdentity,
  type C60114ReviewTargets,
  type C60114ReviewRegionsV3,
  type C60114ReviewAudioManifestV3,
} from "@mvl/shared";
import {
  c60114ArtifactHeader,
  c60114Union,
  c60114Intersection,
  c60114Coverage,
  c60114Id,
  uniqueC60114,
  withC60114SemanticHash,
  assertC60114SourceIdentity,
} from "./c60114-policy.js";
import { machineQualitySemanticHash } from "../machine-quality/evidence-correlation.js";

function assertHash(value: { semanticHash: string }, label: string): void {
  const { semanticHash, ...core } = value;
  if (machineQualitySemanticHash(core) !== semanticHash)
    throw new Error(`C60114_DELIVERY_HASH_MISMATCH:${label}`);
}
function same(a: unknown, b: unknown): boolean {
  return machineQualitySemanticHash(a) === machineQualitySemanticHash(b);
}
function requireUnique(ids: readonly string[], label: string): void {
  if (new Set(ids).size !== ids.length)
    throw new Error(`C60114_DUPLICATE_DELIVERY_ID:${label}`);
}

export function assertC60114ReviewDeliveryInputs(input: {
  sourceIdentity: C60114SourceIdentity;
  policyHash: string;
  targets: C60114ReviewTargets;
  regions: C60114ReviewRegionsV3;
  audio?: C60114ReviewAudioManifestV3;
}): void {
  c60114ReviewTargetsSchema.parse(input.targets);
  c60114ReviewRegionsV3Schema.parse(input.regions);
  const artifacts = [
    input.targets,
    input.regions,
    ...(input.audio ? [input.audio] : []),
  ];
  for (const artifact of artifacts) {
    assertC60114SourceIdentity(artifact.sourceIdentity, input.sourceIdentity);
    assertHash(artifact, artifact.artifactType);
    if (artifact.policyHash !== input.policyHash)
      throw new Error("C60114_DELIVERY_POLICY_MISMATCH");
  }
  if (input.regions.targetsHash !== input.targets.semanticHash)
    throw new Error("C60114_REGION_TARGET_HASH_MISMATCH");
  requireUnique(
    input.targets.targets.map((t) => t.reviewTargetId),
    "targets",
  );
  requireUnique(
    input.regions.regions.map((r) => r.regionId),
    "regions",
  );
  const targets = new Map(
    input.targets.targets.map((t) => [t.reviewTargetId, t]),
  );
  const regions = new Map(input.regions.regions.map((r) => [r.regionId, r]));
  for (const target of targets.values()) {
    assertC60114SourceIdentity(target.sourceIdentity, input.sourceIdentity);
    assertHash(target, target.reviewTargetId);
  }
  for (const region of regions.values()) {
    assertC60114SourceIdentity(region.sourceIdentity, input.sourceIdentity);
    assertHash(region, region.regionId);
    for (const id of region.reviewTargetIds) {
      const target = targets.get(id);
      if (
        !target ||
        !region.reviewItemIds.includes(target.parentReviewItemId) ||
        c60114Coverage(target.sourceInterval, region.sourceIntervals) < 1 - 1e-7
      )
        throw new Error("C60114_REGION_TARGET_MAPPING_MISMATCH");
    }
  }
  if (!input.audio) return;
  c60114ReviewAudioManifestV3Schema.parse(input.audio);
  if (input.audio.regionsHash !== input.regions.semanticHash)
    throw new Error("C60114_AUDIO_REGION_HASH_MISMATCH");
  requireUnique(
    input.audio.audio.map((a) => a.audioId),
    "audio",
  );
  for (const clip of input.audio.audio) {
    assertC60114SourceIdentity(clip.sourceIdentity, input.sourceIdentity);
    assertHash(clip, clip.audioId);
    if (
      clip.sourceMediaSha256 !== input.sourceIdentity.sourceMediaSha256 ||
      clip.sourceInterval.end >
        input.sourceIdentity.durationSeconds + 1 / clip.sampleRate ||
      clip.regionIds.some((id) => !regions.has(id))
    )
      throw new Error("C60114_PHYSICAL_AUDIO_SOURCE_OR_REGION_MISMATCH");
    for (const id of clip.coveredReviewTargetIds) {
      const target = targets.get(id);
      if (
        !target ||
        c60114Coverage(target.sourceInterval, [clip.sourceInterval]) < 1 - 1e-7
      )
        throw new Error("C60114_PHYSICAL_AUDIO_TARGET_CLAIM_MISMATCH");
    }
  }
  for (const target of targets.values()) {
    const ratio = c60114Coverage(
      target.sourceInterval,
      input.audio.audio
        .filter((a) => a.coveredReviewTargetIds.includes(target.reviewTargetId))
        .map((a) => a.sourceInterval),
    );
    const check = input.audio.targetCoverageChecks.find(
      (c) => c.reviewTargetId === target.reviewTargetId,
    );
    if (
      !check ||
      Math.abs(check.coverageRatio - ratio) > 1e-7 ||
      check.fullyCovered !== ratio >= 1 - 1e-7 ||
      check.mandatoryForAudio !== target.mandatoryForAudio ||
      (check.audioRequired ?? check.mandatoryForAudio) !==
        (target.audioRequired ?? target.mandatoryForAudio)
    )
      throw new Error("C60114_AUDIO_COVERAGE_CHECK_MISMATCH");
  }
}

export function assertC60114PlaybackTimelineIntegrity(input: {
  sourceIdentity: C60114SourceIdentity;
  policyHash: string;
  targets: C60114ReviewTargets;
  regions: C60114ReviewRegionsV3;
  audio: C60114ReviewAudioManifestV3;
  playback: C60114PlaybackTimelineV2;
}): void {
  assertC60114ReviewDeliveryInputs(input);
  const playback = c60114PlaybackTimelineV2Schema.parse(input.playback);
  assertHash(playback, "playback");
  assertC60114SourceIdentity(playback.sourceIdentity, input.sourceIdentity);
  if (
    playback.policyHash !== input.policyHash ||
    playback.audioManifestHash !== input.audio.semanticHash ||
    playback.targetsHash !== input.targets.semanticHash ||
    playback.regionsHash !== input.regions.semanticHash
  )
    throw new Error("C60114_PLAYBACK_ARTIFACT_BINDING_MISMATCH");
  requireUnique(
    playback.segments.map((s) => s.playbackSegmentId),
    "segments",
  );
  requireUnique(
    playback.plans.map((p) => p.planId),
    "plans",
  );
  const audio = new Map(input.audio.audio.map((a) => [a.audioId, a]));
  const targets = new Map(
    input.targets.targets.map((t) => [t.reviewTargetId, t]),
  );
  const regions = new Map(input.regions.regions.map((r) => [r.regionId, r]));
  for (const segment of playback.segments) {
    assertHash(segment, segment.playbackSegmentId);
    assertC60114SourceIdentity(segment.sourceIdentity, input.sourceIdentity);
    const clip = audio.get(segment.audioId);
    if (
      !clip ||
      c60114Coverage(segment.sourceInterval, [clip.sourceInterval]) <
        1 - 1e-8 ||
      Math.abs(
        segment.sourceInterval.start -
          clip.sourceInterval.start -
          segment.audioLocalInterval.start,
      ) > 1e-8 ||
      Math.abs(
        segment.sourceInterval.end -
          clip.sourceInterval.start -
          segment.audioLocalInterval.end,
      ) > 1e-8
    )
      throw new Error("C60114_PLAYBACK_PHYSICAL_OFFSET_MISMATCH");
    for (const id of segment.regionIds) {
      const region = regions.get(id);
      if (
        !region ||
        c60114Coverage(segment.sourceInterval, region.contextIntervals) <
          1 - 1e-7
      )
        throw new Error("C60114_PLAYBACK_REGION_MAPPING_MISMATCH");
    }
    const expectedTargets = input.targets.targets
      .filter((t) =>
        c60114Intersection(t.sourceInterval, segment.sourceInterval),
      )
      .map((t) => t.reviewTargetId)
      .sort();
    if (
      !same(segment.reviewTargetIds, expectedTargets) ||
      !same(
        segment.reviewItemIds,
        uniqueC60114(
          expectedTargets.map(
            (id) => targets.get(id)?.parentReviewItemId ?? "",
          ),
        ),
      )
    )
      throw new Error("C60114_PLAYBACK_TARGET_MAPPING_MISMATCH");
  }
  const segments = new Map(
    playback.segments.map((s) => [s.playbackSegmentId, s]),
  );
  for (const plan of playback.plans) {
    assertHash(plan, plan.planId);
    if (
      plan.regionIds.some((id) => !regions.has(id)) ||
      plan.playbackSegmentIds.some((id) => !segments.has(id))
    )
      throw new Error("C60114_PLAYBACK_PLAN_REFERENCE_MISMATCH");
    requireUnique(plan.playbackSegmentIds, `${plan.planId}:segments`);
    const selected = playback.segments.filter((s) =>
      s.regionIds.some((id) => plan.regionIds.includes(id)),
    );
    const audioIds = uniqueC60114(selected.map((s) => s.audioId));
    const union = c60114Union(selected.map((s) => s.sourceInterval));
    const duration = union.reduce((n, i) => n + i.end - i.start, 0);
    const hashes = audioIds.map((id) => audio.get(id)?.sha256 ?? "");
    if (
      !same(
        plan.playbackSegmentIds,
        selected.map((s) => s.playbackSegmentId),
      ) ||
      !same(plan.audioIds, audioIds) ||
      !same(plan.physicalAudioSha256s, hashes) ||
      !same(plan.sourceIntervalUnion, union) ||
      Math.abs(plan.uniqueAudioSeconds - duration) > 1e-7 ||
      !same(
        plan.reviewTargetIds,
        uniqueC60114(selected.flatMap((s) => s.reviewTargetIds)),
      ) ||
      !same(
        plan.reviewItemIds,
        uniqueC60114(selected.flatMap((s) => s.reviewItemIds)),
      )
    )
      throw new Error("C60114_PLAYBACK_PLAN_PHYSICAL_MAPPING_MISMATCH");
    if (plan.budgetSeconds !== null && duration > plan.budgetSeconds + 1e-7)
      throw new Error("C60114_PLAYBACK_PLAN_BUDGET_EXCEEDED");
    if (plan.planId === "ALL_MANDATORY" || plan.planId === "FULL_QUEUE") {
      for (const target of targets.values())
        if (
          (plan.planId === "FULL_QUEUE"
            ? (target.audioRequired ?? target.mandatoryForAudio)
            : input.regions.regions.some(
                (r) =>
                  r.requiredLevel === "REQUIRED" &&
                  r.reviewTargetIds.includes(target.reviewTargetId),
              )) &&
          c60114Coverage(
            target.sourceInterval,
            selected.map((s) => s.sourceInterval),
          ) <
            1 - 1e-7
        )
          throw new Error("C60114_MANDATORY_TARGET_PLAN_OMISSION");
    }
  }
  if (
    !playback.plans.some((p) => p.planId === "ALL_MANDATORY") ||
    !playback.plans.some((p) => p.planId === "FULL_QUEUE")
  )
    throw new Error("C60114_REQUIRED_PLAYBACK_PLAN_MISSING");
}

/** Every playback segment names one verified physical WAV and reversible offsets. */
export function buildC60114PlaybackTimeline(input: {
  sourceIdentity: C60114SourceIdentity;
  policy: C60114Policy;
  targets: C60114ReviewTargets;
  regions: C60114ReviewRegionsV3;
  audio: C60114ReviewAudioManifestV3;
}) {
  assertC60114ReviewDeliveryInputs({
    ...input,
    policyHash: input.policy.semanticHash,
  });
  const points = [
    ...new Set([
      ...input.audio.audio.flatMap((clip) => [
        clip.sourceInterval.start,
        clip.sourceInterval.end,
      ]),
      ...input.targets.targets.flatMap((target) => [
        target.sourceInterval.start,
        target.sourceInterval.end,
      ]),
      ...input.regions.regions.flatMap((region) =>
        region.contextIntervals.flatMap((interval) => [
          interval.start,
          interval.end,
        ]),
      ),
    ]),
  ].sort((a, b) => a - b);
  const rank = new Map(
    input.regions.regions.map((region) => [
      region.regionId,
      region.priorityMetadata.rankPosition,
    ]),
  );
  const segments: C60114PlaybackSegment[] = [];
  for (let index = 0; index + 1 < points.length; index++) {
    const start = points[index],
      end = points[index + 1];
    if (start === undefined || end === undefined || end - start < 1e-8)
      continue;
    const available = input.audio.audio
      .filter(
        (clip) =>
          clip.sourceInterval.start <= start + 1e-8 &&
          clip.sourceInterval.end >= end - 1e-8,
      )
      .sort(
        (a, b) =>
          Math.min(...a.regionIds.map((id) => rank.get(id) ?? Infinity)) -
            Math.min(...b.regionIds.map((id) => rank.get(id) ?? Infinity)) ||
          a.audioId.localeCompare(b.audioId),
      );
    const selected = available[0];
    if (!selected) continue;
    const sourceInterval = { start, end };
    const targets = input.targets.targets.filter((target) =>
      c60114Intersection(target.sourceInterval, sourceInterval),
    );
    const regionIds = uniqueC60114(
      available.flatMap((clip) => clip.regionIds),
    ).filter((id) => {
      const region = input.regions.regions.find((row) => row.regionId === id);
      return (
        region &&
        c60114Coverage(sourceInterval, region.contextIntervals) >= 1 - 1e-7
      );
    });
    // A WAV may include sample-rounded padding outside the requested context.
    // Those physical frames are not authorized playback for that region.
    if (!regionIds.length) continue;
    const core = {
      playbackSegmentId: c60114Id("playback-v2", {
        audio: selected.audioId,
        sourceInterval,
      }),
      audioId: selected.audioId,
      sourceInterval,
      audioLocalInterval: {
        start: start - selected.sourceInterval.start,
        end: end - selected.sourceInterval.start,
      },
      reviewTargetIds: uniqueC60114(
        targets.map((target) => target.reviewTargetId),
      ),
      reviewItemIds: uniqueC60114(
        targets.map((target) => target.parentReviewItemId),
      ),
      regionIds,
      sourceIdentity: input.sourceIdentity,
    };
    segments.push(
      c60114PlaybackSegmentSchema.parse(withC60114SemanticHash(core)),
    );
  }
  const duration = (values: readonly { start: number; end: number }[]) =>
    c60114Union(values).reduce(
      (sum, value) => sum + value.end - value.start,
      0,
    );
  const audioMap = new Map(
    input.audio.audio.map((clip) => [clip.audioId, clip]),
  );
  const definitions = [
    ...([10, 20, 30, 40, 50] as const).map((percent) => ({
      planId: `UNIQUE_AUDIO_${percent}_PERCENT` as const,
      budgetSeconds: (input.sourceIdentity.durationSeconds * percent) / 100,
    })),
    { planId: "ALL_MANDATORY" as const, budgetSeconds: null },
    { planId: "FULL_QUEUE" as const, budgetSeconds: null },
  ];
  const plans = definitions.map((definition) => {
    const regionIds: string[] = [];
    for (const region of input.regions.regions.toSorted(
      (a, b) =>
        a.priorityMetadata.rankPosition - b.priorityMetadata.rankPosition,
    )) {
      if (
        definition.planId === "ALL_MANDATORY" &&
        region.requiredLevel !== "REQUIRED"
      )
        continue;
      const proposed = [...regionIds, region.regionId];
      const selected = segments.filter((segment) =>
        segment.regionIds.some((id) => proposed.includes(id)),
      );
      if (
        definition.budgetSeconds !== null &&
        duration(selected.map((segment) => segment.sourceInterval)) >
          definition.budgetSeconds + 1e-7
      )
        continue;
      regionIds.push(region.regionId);
    }
    const selected = segments.filter((segment) =>
      segment.regionIds.some((id) => regionIds.includes(id)),
    );
    const audioIds = uniqueC60114(selected.map((segment) => segment.audioId));
    return withC60114SemanticHash({
      ...definition,
      regionIds,
      reviewTargetIds: uniqueC60114(
        selected.flatMap((segment) => segment.reviewTargetIds),
      ),
      reviewItemIds: uniqueC60114(
        selected.flatMap((segment) => segment.reviewItemIds),
      ),
      playbackSegmentIds: selected.map((segment) => segment.playbackSegmentId),
      audioIds,
      physicalAudioSha256s: audioIds.map((id) => {
        const clip = audioMap.get(id);
        if (!clip) throw new Error("C60114_PLAYBACK_AUDIO_ID_MISSING");
        return clip.sha256;
      }),
      sourceIntervalUnion: c60114Union(
        selected.map((segment) => segment.sourceInterval),
      ),
      uniqueAudioSeconds: duration(
        selected.map((segment) => segment.sourceInterval),
      ),
      rankerStatus: "RANKER_NOT_RECALIBRATED_IN_C6_0_1_14" as const,
    });
  });
  const checks = input.targets.targets.map((target) => {
    const coverageRatio = c60114Coverage(
      target.sourceInterval,
      segments
        .filter((segment) =>
          segment.reviewTargetIds.includes(target.reviewTargetId),
        )
        .map((segment) => segment.sourceInterval),
    );
    return {
      reviewTargetId: target.reviewTargetId,
      mandatoryForAudio: target.mandatoryForAudio,
      audioRequired: target.audioRequired ?? target.mandatoryForAudio,
      coverageRatio,
      fullyCovered: coverageRatio >= 1 - 1e-7,
    };
  });
  if (checks.some((check) => check.audioRequired && !check.fullyCovered))
    throw new Error("C60114_MANDATORY_TARGET_PLAYBACK_OMISSION");
  const playback = c60114PlaybackTimelineV2Schema.parse(
    withC60114SemanticHash({
      ...c60114ArtifactHeader(input.policy, input.sourceIdentity),
      artifactType: "machine-review-playback-timeline-v2",
      audioManifestHash: input.audio.semanticHash,
      regionsHash: input.regions.semanticHash,
      targetsHash: input.targets.semanticHash,
      segments,
      plans,
      targetCoverageChecks: checks,
      summary: {
        segmentCount: segments.length,
        audioMappingCount: segments.length,
        targetMappingCount: new Set(
          segments.flatMap((segment) => segment.reviewTargetIds),
        ).size,
        mandatoryTargetCount: checks.filter((check) => check.audioRequired)
          .length,
        coveredMandatoryTargetCount: checks.filter(
          (check) => check.audioRequired && check.fullyCovered,
        ).length,
        targetCoveragePassed: checks.every(
          (check) => !check.audioRequired || check.fullyCovered,
        ),
        fullQueueUniqueAudioSeconds: duration(
          segments.map((segment) => segment.sourceInterval),
        ),
      },
    }),
  );
  assertC60114PlaybackTimelineIntegrity({
    ...input,
    policyHash: input.policy.semanticHash,
    playback,
  });
  return playback;
}

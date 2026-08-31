import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  audio143Schema,
  playback143Schema,
  workspace143Schema,
  coreDelivery143Schema,
  bundle143Schema,
  type Audio142,
  type Playback142,
  type Targets143,
  type Regions143,
  type Safety143,
  type Child143,
  type Policy143,
  type Planner143,
  type Audio143,
  type Playback143,
  type Samples142,
} from "@mvl/shared";
import type { C60112ReviewWorkspaceData } from "./c60112-review-workspace.js";
import {
  hashed141,
  hash141,
  assertHash141,
  required141,
  union141,
  native141,
} from "./c601141-policy.js";
import { bytesHash141, pcm141, safeRelative141 } from "./c601141-io.js";
import {
  header143,
  intersection143,
  difference143,
  sampleCount143,
  assertSource143,
} from "./c601143-policy.js";

export function representedPlaybackNativeIntervals143(
  intervals: readonly { start: number; end: number }[],
  sampleRate: number,
) {
  return (
    intervals
      .map((interval) => native141(interval, sampleRate))
      // Frozen compatibility data can contain sub-sample segments. They carry
      // zero representable audio and contribute zero samples to the union.
      .filter((interval) => interval.endSample > interval.startSample)
  );
}
import { unique142 } from "./c601142-selection.js";
import {
  validateCrossStageCoverageMonotonicity,
  assertMonotonicity143,
} from "./c601143-monotonicity.js";
import { policy143 } from "./c601143-policy.js";

export function coreDeliveryCoverage143(input: {
  targets: Targets143;
  audio: Pick<Audio142, "audio">;
  playback: Pick<Playback143, "segments" | "plans">;
  officialPlanId: string;
  safety: Safety143;
  selectedChildren: Child143[];
}) {
  const { targets, audio, playback, safety } = input,
    rate = targets.sourceIdentity.sampleRate;
  const plan = required141(
    playback.plans.find((p) => p.planId === input.officialPlanId),
    "C601143_OFFICIAL_PLAN_MISSING",
  );
  const unit = (id: string, kind: "CHILD" | "BUNDLE", cores: Samples142[]) => {
    const targetIds = targets.targets
      .filter((t) =>
        kind === "CHILD" ? t.childUnitIds.includes(id) : t.bundleId === id,
      )
      .map((t) => t.reviewTargetId);
    const clips = audio.audio.filter((a) =>
      a.coveredReviewTargetIds.some((t) => targetIds.includes(t)),
    );
    const physical = intersection143(
      cores,
      clips.map((a) => a.nativeSourceInterval),
    );
    const segments = playback.segments.filter(
      (s) =>
        plan.playbackSegmentIds.includes(s.playbackSegmentId) &&
        s.reviewTargetIds.some((t) => targetIds.includes(t)),
    );
    const actualSegments = segments.flatMap((s) => {
      const clip = required141(
        audio.audio.find((a) => a.audioId === s.audioId),
        "C601143_SEGMENT_AUDIO_UNBOUND",
      );
      const mapped = {
        startSample: Math.round(
          (clip.sourceInterval.start + s.audioLocalInterval.start) * rate,
        ),
        endSample: Math.round(
          (clip.sourceInterval.start + s.audioLocalInterval.end) * rate,
        ),
      };
      const declared = native141(s.sourceInterval, rate);
      if (hash141(mapped) !== hash141(declared))
        throw new Error("C601143_PLAYBACK_SOURCE_NATIVE_MAPPING_CHANGED");
      return intersection143([declared], [clip.nativeSourceInterval]);
    });
    const played = intersection143(cores, actualSegments),
      physicalMissing = sampleCount143(difference143(cores, physical)),
      playbackMissing = sampleCount143(difference143(cores, played));
    return coreDelivery143Schema.parse(
      hashed141({
        unitId: id,
        unitKind: kind,
        nativeCoreIntervals: union141(cores),
        audioIds: clips.map((a) => a.audioId),
        playbackSegmentIds: segments.map((s) => s.playbackSegmentId),
        physicalCoveredNativeIntervals: physical,
        playbackCoveredNativeIntervals: played,
        uncoveredPhysicalNativeSamples: physicalMissing,
        uncoveredPlaybackNativeSamples: playbackMissing,
        coveragePassed: physicalMissing === 0 && playbackMissing === 0,
      }),
    );
  };
  return {
    childCoreCoverage: input.selectedChildren.map((c) =>
      unit(c.childUnitId, "CHILD", c.nativeIntervalUnion),
    ),
    bundleCoreCoverage: safety.targets.map((b) =>
      unit(b.bundleId, "BUNDLE", b.nativeIntervalUnion),
    ),
  };
}

export function buildReviewDelivery143(input: {
  legacyAudio: Audio142;
  legacyPlayback: Playback142;
  targets: Targets143;
  regions: Regions143;
  safety: Safety143;
  selectedChildren: Child143[];
  policy: Policy143;
  planner: Planner143;
}) {
  const {
    legacyAudio,
    legacyPlayback,
    targets,
    regions,
    safety,
    policy,
    planner,
  } = input;
  const plans = legacyPlayback.plans.map((p) =>
    hashed141({
      ...p,
      rankerStatus: "RANKER_NOT_RECALIBRATED_IN_C6_0_1_14_3" as const,
    }),
  );
  const original = required141(
    plans.find((p) => p.planId === "C601142_FINAL_FULL_QUEUE"),
  );
  const official = {
    ...original,
    planId: "C601143_FINAL_REVIEW_DELIVERY" as const,
  };
  const allPlans = [...plans, hashed141(official)];
  const checks = coreDeliveryCoverage143({
    ...input,
    targets,
    audio: legacyAudio,
    playback: { segments: legacyPlayback.segments, plans: allPlans },
    officialPlanId: official.planId,
  });
  if (
    [...checks.childCoreCoverage, ...checks.bundleCoreCoverage].some(
      (c) => !c.coveragePassed,
    )
  )
    throw new Error("C601143_PHYSICAL_AUDIO_OR_PLAYBACK_LOST_CHILD_CORE");
  const audio = audio143Schema.parse(
    hashed141({
      ...legacyAudio,
      ...header143(policy, safety.sourceIdentity),
      artifactType: "machine-review-audio-manifest-v6",
      regionsHash: regions.semanticHash,
      targetsHash: targets.semanticHash,
      safetyHash: safety.semanticHash,
      ...checks,
    }),
  );
  const nativeFullQueueSamples = sampleCount143(
    representedPlaybackNativeIntervals143(
      legacyPlayback.segments
        .filter((s) =>
          official.playbackSegmentIds.includes(s.playbackSegmentId),
        )
        .map((s) => s.sourceInterval),
      safety.sourceIdentity.sampleRate,
    ),
  );
  const seconds = nativeFullQueueSamples / safety.sourceIdentity.sampleRate,
    ratio = seconds / safety.sourceIdentity.durationSeconds;
  const playback = playback143Schema.parse(
    hashed141({
      ...legacyPlayback,
      ...header143(policy, safety.sourceIdentity),
      artifactType: "machine-review-playback-timeline-v5",
      plans: allPlans,
      officialFullQueuePlan: official.planId,
      regionsHash: regions.semanticHash,
      targetsHash: targets.semanticHash,
      audioManifestHash: audio.semanticHash,
      safetyHash: safety.semanticHash,
      plannerCertificateHash: planner.semanticHash,
      fullQueueEpisodeRatio: ratio,
      burdenGate:
        ratio <= policy.maximumFullQueueEpisodeRatio
          ? "PASSED"
          : "FULL_QUEUE_BURDEN_DEGENERATE",
      nativeFullQueueSamples,
      predictedFullQueueSeconds: planner.predictedFullQueueSeconds,
      actualMinusPredictedSeconds: seconds - planner.predictedFullQueueSeconds,
      allChildCorePlaybackPassed: checks.childCoreCoverage.every(
        (c) => c.coveragePassed,
      ),
      allBundleCorePlaybackPassed: checks.bundleCoreCoverage.every(
        (c) => c.coveragePassed,
      ),
    }),
  );
  return { audio, playback, checks };
}

export function assertWorkspace143(data: C60112ReviewWorkspaceData) {
  if (!data.monotonicSafetyReviewV3) return;
  const current = workspace143Schema.parse(data.monotonicSafetyReviewV3),
    old = required141(
      data.sourceTargetReviewV3,
      "C601143_TRANSACTION_COMPATIBILITY_REQUIRED",
    ),
    policy = policy143();
  const artifacts = [
    current,
    current.targets,
    current.items,
    current.regions,
    current.audio,
    current.playback,
    current.safety,
    current.obligations,
    current.planner,
    current.monotonicity,
    current.continuity,
    current.lexicalBindings,
  ];
  for (const a of artifacts) {
    assertHash141(a);
    assertSource143(a.sourceIdentity, current.sourceIdentity);
    if (a.policyHash !== policy.semanticHash)
      throw new Error("C601143_WORKSPACE_POLICY_CHANGED");
  }
  current.selectedChildren.forEach(assertHash141);
  if (
    current.targets.compatibilityTargetsHash !== old.targets.semanticHash ||
    current.regions.compatibilityRegionsHash !== old.regions.semanticHash ||
    current.audio.compatibilityAudioHash !== old.audio.semanticHash ||
    current.playback.compatibilityPlaybackHash !== old.playback.semanticHash ||
    current.items.targetsHash !== current.targets.semanticHash ||
    current.regions.targetsHash !== current.targets.semanticHash ||
    current.regions.itemsHash !== current.items.semanticHash ||
    current.audio.regionsHash !== current.regions.semanticHash ||
    current.audio.targetsHash !== current.targets.semanticHash ||
    current.playback.audioManifestHash !== current.audio.semanticHash ||
    current.playback.targetsHash !== current.targets.semanticHash ||
    current.playback.regionsHash !== current.regions.semanticHash ||
    current.safety.plannerCertificateHash !== current.planner.semanticHash ||
    current.safety.continuityLedgerHash !== current.continuity.semanticHash ||
    current.safety.monotonicityHash !== current.monotonicity.semanticHash
  )
    throw new Error("C601143_CROSS_ARTIFACT_BINDING_MISMATCH");
  for (const id of current.obligations.immutableTargetIds) {
    const target = required141(
        old.targets.targets.find((t) => t.reviewTargetId === id),
        "C601143_IMMUTABLE_TARGET_DELETED",
      ),
      versioned = required141(
        current.targets.targets.find((t) => t.reviewTargetId === id),
        "C601143_VERSIONED_IMMUTABLE_TARGET_DELETED",
      );
    if (versioned.baselineSemanticHash !== target.semanticHash)
      throw new Error("C601143_IMMUTABLE_TARGET_CHANGED");
  }
  const selected = current.safety.targets.map((b) =>
    hashed141(bundle143Schema.strip().parse(b)),
  );
  const proof = validateCrossStageCoverageMonotonicity({
    policy,
    obligations: current.obligations,
    selected,
  });
  assertMonotonicity143(proof.monotonicity);
  if (proof.monotonicity.semanticHash !== current.monotonicity.semanticHash)
    throw new Error("C601143_MONOTONICITY_CERTIFICATE_CHANGED");
  const ids = unique142(current.safety.targets.flatMap((b) => b.childUnitIds));
  if (
    hash141(ids) !==
    hash141(unique142(current.selectedChildren.map((c) => c.childUnitId)))
  )
    throw new Error("C601143_SELECTED_CHILD_SET_MISMATCH");
  for (const b of current.safety.targets) {
    const childCore = current.selectedChildren
      .filter((c) => b.childUnitIds.includes(c.childUnitId))
      .flatMap((c) => c.nativeIntervalUnion);
    if (hash141(union141(childCore)) !== hash141(b.nativeIntervalUnion))
      throw new Error("C601143_BUNDLE_NOT_ACTUAL_CHILD_CORE");
  }
  const checks = coreDeliveryCoverage143({
    ...current,
    officialPlanId: current.playback.officialFullQueuePlan,
  });
  if (
    hash141(checks.childCoreCoverage) !==
      hash141(current.audio.childCoreCoverage) ||
    hash141(checks.bundleCoreCoverage) !==
      hash141(current.audio.bundleCoreCoverage) ||
    [...checks.childCoreCoverage, ...checks.bundleCoreCoverage].some(
      (c) => !c.coveragePassed,
    )
  )
    throw new Error("C601143_CORE_DELIVERY_CERTIFICATE_MISMATCH");
  if (
    current.safety.targets.length > 24 ||
    sampleCount143(selected.flatMap((b) => b.nativeIntervalUnion)) /
      current.sourceIdentity.sampleRate >
      60 ||
    current.playback.fullQueueEpisodeRatio > policy.maximumFullQueueEpisodeRatio
  )
    throw new Error("C601143_FINAL_DELIVERY_BUDGET_VIOLATION");
}

export async function verifyPhysicalAudio143(
  directory: string,
  manifest: Audio143,
) {
  audio143Schema.parse(manifest);
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
      throw new Error("C601143_PHYSICAL_WAV_INVALID_OR_CHANGED");
  }
  return {
    actualAudioCount: manifest.audio.length,
    playableCount: manifest.audio.length,
    hashVerifiedCount: manifest.audio.length,
    allPassed: true as const,
  };
}

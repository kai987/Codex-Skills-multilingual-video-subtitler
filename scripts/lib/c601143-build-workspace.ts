import path from "node:path";
import { mkdir, rename } from "node:fs/promises";
import {
  workspace143Schema,
  type Policy143,
  type Safety143,
  type Hierarchy143,
  type Obligations143,
  type Planner143,
  type Continuity143,
  type Monotonicity143,
} from "@mvl/shared";
import {
  buildC60112ReviewPackageFreeze,
  verifyC60112ReviewPackageFreeze,
  writeC60112ReviewWorkspace,
} from "@mvl/video-subtitler";
import type { Baseline143 } from "./c601143-input.js";
import { buildC60114Workspace } from "./c60114-build-workspace.js";
import { buildReviewGraph143 } from "../../packages/video-subtitler/src/review/c601143-review-graph.js";
import {
  audioManifest142,
  playback142,
} from "../../packages/video-subtitler/src/review/c601142-review-delivery.js";
import {
  buildReviewDelivery143,
  assertWorkspace143,
  verifyPhysicalAudio143,
} from "../../packages/video-subtitler/src/review/c601143-review-delivery.js";
import { header143 } from "../../packages/video-subtitler/src/review/c601143-policy.js";
import {
  hashed141,
  hash141,
  required141,
} from "../../packages/video-subtitler/src/review/c601141-policy.js";
import { durableJson141 } from "../../packages/video-subtitler/src/review/c601141-io.js";

export async function buildWorkspace143(input: {
  baseline: Baseline143;
  policy: Policy143;
  safety: Safety143;
  hierarchy: Hierarchy143;
  obligations: Obligations143;
  planner: Planner143;
  continuity: Continuity143;
  monotonicity: Monotonicity143;
  outputDirectory: string;
  generatedAt: string;
}) {
  const {
      baseline,
      policy,
      safety,
      hierarchy,
      obligations,
      planner,
      continuity,
      monotonicity,
    } = input,
    b = baseline.old.baseline;
  await mkdir(input.outputDirectory, { recursive: true });
  const graph = buildReviewGraph143({
    ...input,
    compatibilityPolicy: baseline.compatibilityPolicy,
    legacyPolicy: b.previous.policy,
    inventory: baseline.inventory,
    frozenLexical: baseline.lexical,
    baselineTargets: b.previous.targets,
    baselineItems: b.previous.items,
    baselineRegions: b.previous.regions,
    frozenR3Families: b.input.previous.families,
  });
  const built = await buildC60114Workspace({
    baseline: b.input,
    prepared: {
      ...b.prepared,
      reviewTargets: graph.compatibility.compatibleTargets,
    },
    itemsV4: graph.compatibility.compatibleItems,
    regionsV3: graph.compatibility.compatibleRegions,
    lexical: b.previous.lexical,
    missing: b.previous.missing,
    sourcePath: baseline.old.config.source,
    outputDirectory: input.outputDirectory,
    generatedAt: input.generatedAt,
  });
  const oldAudio = audioManifest142(
    built.audio.manifest,
    graph.compatibility.regions,
    baseline.compatibilityPolicy,
  );
  const oldPlayback = playback142({
    legacy: built.playback,
    audio: oldAudio,
    regions: graph.compatibility.regions,
    targets: graph.compatibility.targets,
    policy: baseline.compatibilityPolicy,
  });
  const selectedChildren = hierarchy.children.filter((c) =>
    safety.targets.some((t) => t.childUnitIds.includes(c.childUnitId)),
  );
  const delivery = buildReviewDelivery143({
    legacyAudio: oldAudio,
    legacyPlayback: oldPlayback,
    targets: graph.targets,
    regions: graph.regions,
    safety,
    selectedChildren,
    policy,
    planner,
  });
  const extension = workspace143Schema.parse(
    hashed141({
      ...header143(policy, b.source),
      workspaceMode: "MONOTONIC_SAFETY_BUNDLE_REVIEW_V3",
      targets: graph.targets,
      items: graph.items,
      regions: graph.regions,
      audio: delivery.audio,
      playback: delivery.playback,
      safety,
      selectedChildren,
      obligations,
      planner,
      monotonicity,
      continuity,
      lexicalBindings: graph.bindings,
      compatibilityLexical: graph.lexical,
      compatibilityMissing: graph.missing,
      reviewDeliverySubsystemVersion: "C6.0.1.12_REVIEW_AUDIO",
      humanTrialStarted: false,
      canonicalMutationAllowed: false,
    }),
  );
  const workspaceData = {
    ...built.workspaceData,
    monotonicSafetyReviewV3: extension,
    reviewPackageSemanticHash: hash141({
      compatibility: built.workspaceData.reviewPackageSemanticHash,
      monotonicSafety: extension.semanticHash,
    }),
  };
  assertWorkspace143(workspaceData);
  const physical = await verifyPhysicalAudio143(
    input.outputDirectory,
    delivery.audio,
  );
  await writeC60112ReviewWorkspace({
    workspaceDirectory: input.outputDirectory,
    reviewData: workspaceData,
  });
  const packageInput = {
    sourceMediaSha256: b.source.sourceMediaSha256,
    machineDraftHash: b.input.replay.machineDraftHash,
    policy: b.input.replay.policy,
    items: built.items,
    priority: built.priority,
    regions: built.regions,
    candidates: built.candidates,
    audioManifest: built.audio.legacy,
    workspaceData,
  };
  const freeze = buildC60112ReviewPackageFreeze({
    frozenAt: input.generatedAt,
    ...packageInput,
  });
  if (!verifyC60112ReviewPackageFreeze({ freeze, packageInput }))
    throw new Error("C601143_TRANSACTION_FREEZE_FAILED");
  await rename(
    path.join(input.outputDirectory, "c6-0-1-12-review-package-freeze.json"),
    path.join(
      input.outputDirectory,
      "c6-0-1-14-compatibility-review-package-freeze.json",
    ),
  );
  const artifacts = {
    "machine-review-target-intervals-v5.json": graph.targets,
    "machine-review-items-v7.json": graph.items,
    "machine-review-regions-v6.json": graph.regions,
    "machine-review-audio-manifest-v6.json": delivery.audio,
    "machine-review-playback-timeline-v5.json": delivery.playback,
    "machine-c601143-frozen-lexical-bindings.json": graph.bindings,
    "machine-missing-safety-reserve-targets-v3.json": safety,
    "machine-c601143-review-workspace.json": extension,
    "c6-0-1-12-review-package-freeze.json": freeze,
    "c6-0-1-14-3-r3-safety-evidence-projection.json":
      graph.compatibility.families,
  };
  for (const [name, value] of Object.entries(artifacts))
    await durableJson141(path.join(input.outputDirectory, name), value);
  const mandatory = required141(
      delivery.playback.plans.find((p) => p.planId === "ALL_MANDATORY"),
    ),
    oldMandatory = required141(
      b.previous.playback.plans.find((p) => p.planId === "ALL_MANDATORY"),
    );
  if (
    hash141(mandatory.regionIds) !== hash141(oldMandatory.regionIds) ||
    hash141(mandatory.sourceIntervalUnion) !==
      hash141(oldMandatory.sourceIntervalUnion)
  )
    throw new Error("C601143_ORIGINAL_MANDATORY_ORDER_OR_AUDIO_CHANGED");
  return {
    graph,
    ...delivery,
    workspaceData,
    freeze,
    physical,
    artifacts,
    built,
  };
}

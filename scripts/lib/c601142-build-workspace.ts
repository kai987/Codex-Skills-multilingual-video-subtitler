import path from "node:path";
import { rename, mkdir } from "node:fs/promises";
import {
  workspace142Schema,
  type Policy142,
  type Inventory142,
  type Safety142,
  type Lexical142,
  type Missing142,
} from "@mvl/shared";
import {
  buildC60112ReviewPackageFreeze,
  verifyC60112ReviewPackageFreeze,
  writeC60112ReviewWorkspace,
} from "@mvl/video-subtitler";
import { buildC60114Workspace } from "./c60114-build-workspace.js";
import type { Baseline141 } from "./c601141-input.js";
import { buildReviewGraph142 } from "../../packages/video-subtitler/src/review/c601142-review-graph.js";
import {
  audioManifest142,
  playback142,
  verifyPhysicalAudio142,
  assertWorkspace142,
} from "../../packages/video-subtitler/src/review/c601142-review-delivery.js";
import { header142 } from "../../packages/video-subtitler/src/review/c601142-policy.js";
import {
  hashed141,
  hash141,
  required141,
} from "../../packages/video-subtitler/src/review/c601141-policy.js";
import { durableJson141 } from "../../packages/video-subtitler/src/review/c601141-io.js";
export async function buildWorkspace142(input: {
  baseline: Baseline141;
  policy: Policy142;
  inventory: Inventory142;
  safety: Safety142;
  lexical: Lexical142;
  missing: Missing142;
  supersessionHash: string;
  sourcePath: string;
  outputDirectory: string;
  generatedAt: string;
}) {
  const { baseline, policy, inventory, safety, lexical, missing } = input;
  await mkdir(input.outputDirectory, { recursive: true });
  const graph = buildReviewGraph142({
    policy,
    compatibilityPolicy: baseline.previous.policy,
    inventory,
    safety,
    lexical,
    missing,
    supersessionHash: input.supersessionHash,
    baselineTargets: baseline.previous.targets,
    baselineItems: baseline.previous.items,
    baselineRegions: baseline.previous.regions,
    frozenR3Families: baseline.input.previous.families,
  });
  const built = await buildC60114Workspace({
    baseline: baseline.input,
    prepared: { ...baseline.prepared, reviewTargets: graph.compatibleTargets },
    itemsV4: graph.compatibleItems,
    regionsV3: graph.compatibleRegions,
    lexical: baseline.previous.lexical,
    missing: baseline.previous.missing,
    sourcePath: input.sourcePath,
    outputDirectory: input.outputDirectory,
    generatedAt: input.generatedAt,
  });
  const audio = audioManifest142(built.audio.manifest, graph.regions, policy);
  const playback = playback142({
    legacy: built.playback,
    audio,
    regions: graph.regions,
    targets: graph.targets,
    policy,
  });
  const extension = workspace142Schema.parse(
    hashed141({
      ...header142(policy, safety.sourceIdentity),
      workspaceMode: "DETECTOR_CEILING_SAFETY_REVIEW_V2",
      targets: graph.targets,
      items: graph.items,
      regions: graph.regions,
      audio,
      playback,
      lexical,
      missing,
      safety,
      humanTrialStarted: false,
      canonicalMutationAllowed: false,
    }),
  );
  const workspaceData = {
    ...built.workspaceData,
    detectorCeilingReviewV2: extension,
    reviewPackageSemanticHash: hash141({
      compatibility: built.workspaceData.reviewPackageSemanticHash,
      detectorCeilingEvidence: extension.semanticHash,
    }),
  };
  assertWorkspace142(workspaceData);
  const physical = await verifyPhysicalAudio142(input.outputDirectory, audio);
  await writeC60112ReviewWorkspace({
    workspaceDirectory: input.outputDirectory,
    reviewData: workspaceData,
  });
  const packageInput = {
    sourceMediaSha256: baseline.source.sourceMediaSha256,
    machineDraftHash: baseline.input.replay.machineDraftHash,
    policy: baseline.input.replay.policy,
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
    throw new Error("C601142_TRANSACTION_FREEZE_FAILED");
  await rename(
    path.join(input.outputDirectory, "c6-0-1-12-review-package-freeze.json"),
    path.join(
      input.outputDirectory,
      "c6-0-1-14-compatibility-review-package-freeze.json",
    ),
  );
  const artifacts = {
    "machine-review-target-intervals-v4.json": graph.targets,
    "machine-review-items-v6.json": graph.items,
    "machine-review-regions-v5.json": graph.regions,
    "machine-review-audio-manifest-v5.json": audio,
    "machine-review-playback-timeline-v4.json": playback,
    "machine-missing-lexical-evidence-v5.json": lexical,
    "machine-missing-speech-evidence-v5.json": missing,
    "machine-missing-safety-reserve-targets-v2.json": safety,
    "c6-0-1-12-review-package-freeze.json": freeze,
    "c6-0-1-14-2-r3-safety-evidence-projection.json": graph.families,
  };
  for (const [name, value] of Object.entries(artifacts))
    await durableJson141(path.join(input.outputDirectory, name), value);
  const mandatory = required141(
      playback.plans.find((p) => p.planId === "ALL_MANDATORY"),
    ),
    oldMandatory = required141(
      baseline.previous.playback.plans.find(
        (p) => p.planId === "ALL_MANDATORY",
      ),
    );
  if (
    hash141(mandatory.regionIds) !== hash141(oldMandatory.regionIds) ||
    hash141(mandatory.sourceIntervalUnion) !==
      hash141(oldMandatory.sourceIntervalUnion)
  )
    throw new Error("C601142_ORIGINAL_MANDATORY_ORDER_OR_AUDIO_CHANGED");
  return { graph, audio, playback, workspaceData, freeze, physical, artifacts };
}

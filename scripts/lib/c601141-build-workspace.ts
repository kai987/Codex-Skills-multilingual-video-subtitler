import path from "node:path";
import { rename } from "node:fs/promises";
import {
  atomicWriteJson,
  c601141WorkspaceExtensionSchema,
  type C601141Policy,
  type C601141Inventory,
  type C601141Safety,
  type C601141Lexical,
  type C601141MissingEvidence,
} from "@mvl/shared";
import {
  buildC60112ReviewPackageFreeze,
  verifyC60112ReviewPackageFreeze,
  writeC60112ReviewWorkspace,
} from "@mvl/video-subtitler";
import { buildC60114Workspace } from "./c60114-build-workspace.js";
import type { Baseline141 } from "./c601141-input.js";
import { buildReviewGraph141 } from "../../packages/video-subtitler/src/review/c601141-review-graph.js";
import {
  audioManifest141,
  playback141,
  verifyPhysicalAudio141,
  assertInventoryWorkspace141,
} from "../../packages/video-subtitler/src/review/c601141-review-delivery.js";
import {
  hash141,
  hashed141,
  header141,
  required141,
} from "../../packages/video-subtitler/src/review/c601141-policy.js";

export async function buildWorkspace141(input: {
  baseline: Baseline141;
  policy: C601141Policy;
  inventory: C601141Inventory;
  safety: C601141Safety;
  lexical: C601141Lexical;
  missing: C601141MissingEvidence;
  sourcePath: string;
  outputDirectory: string;
  generatedAt: string;
}) {
  const { baseline, policy, inventory, safety, lexical, missing } = input;
  const graph = buildReviewGraph141({
    policy,
    compatibilityPolicy: baseline.previous.policy,
    inventory,
    safety,
    lexical,
    missing,
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
  const audio = audioManifest141(built.audio.manifest, graph.regions, policy);
  const playback = playback141({
    legacy: built.playback,
    audio,
    regions: graph.regions,
    targets: graph.targets,
    policy,
  });
  const extension = c601141WorkspaceExtensionSchema.parse(
    hashed141({
      ...header141(policy, safety.sourceIdentity),
      workspaceMode: "MULTIVIEW_SPEECH_INVENTORY_REVIEW_V1",
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
    speechInventoryReviewV1: extension,
    // Keep the C60112 transaction enum stable; authoritative V5 types and UI
    // badges live in the frozen extension, not in an incompatible old record.
    reviewPackageSemanticHash: hash141({
      compatibility: built.workspaceData.reviewPackageSemanticHash,
      inventoryEvidence: extension.semanticHash,
    }),
  };
  assertInventoryWorkspace141(workspaceData);
  const physical = await verifyPhysicalAudio141(input.outputDirectory, audio);
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
    throw new Error("C601141_TRANSACTION_FREEZE_FAILED");
  // This compatibility freeze was just created in this new workspace. Retain
  // it separately; the final transaction freeze must bind the additive data.
  await rename(
    path.join(input.outputDirectory, "c6-0-1-12-review-package-freeze.json"),
    path.join(
      input.outputDirectory,
      "c6-0-1-14-compatibility-review-package-freeze.json",
    ),
  );
  const artifacts = {
    "machine-review-target-intervals-v3.json": graph.targets,
    "machine-review-items-v5.json": graph.items,
    "machine-review-regions-v4.json": graph.regions,
    "machine-review-audio-manifest-v4.json": audio,
    "machine-review-playback-timeline-v3.json": playback,
    "machine-missing-lexical-evidence-v4.json": lexical,
    "machine-missing-speech-evidence-v4.json": missing,
    "c6-0-1-12-review-package-freeze.json": freeze,
    "c6-0-1-14-1-r3-safety-evidence-projection.json": graph.families,
  };
  for (const [name, value] of Object.entries(artifacts))
    await atomicWriteJson(path.join(input.outputDirectory, name), value);
  const mandatory = required141(
    playback.plans.find((v) => v.planId === "ALL_MANDATORY"),
  );
  const oldMandatory = required141(
    baseline.previous.playback.plans.find((v) => v.planId === "ALL_MANDATORY"),
  );
  if (
    hash141(mandatory.regionIds) !== hash141(oldMandatory.regionIds) ||
    hash141(mandatory.sourceIntervalUnion) !==
      hash141(oldMandatory.sourceIntervalUnion)
  )
    throw new Error("C601141_ORIGINAL_MANDATORY_ORDER_OR_COVERAGE_CHANGED");
  return { graph, audio, playback, workspaceData, freeze, physical, artifacts };
}

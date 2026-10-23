import { access, cp, mkdir, mkdtemp, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  atomicWriteJson,
  c60113AblationFreezeSchema,
  type C60113RegionFeatures,
} from "@mvl/shared";
import { machineQualitySemanticHash } from "@mvl/video-subtitler";
import {
  buildC60113MachineReview,
  type C60113AblationStage,
  type C60113MachineReview,
} from "../packages/video-subtitler/src/review/structured-review-priority.js";
import {
  buildC60113RegionFeatures,
  buildC60113RegionFeaturesFromArtifacts,
} from "../packages/video-subtitler/src/review/c60113-region-features.js";
import {
  buildC60113RankerFolds,
  createC60113RankerMachineFreeze,
} from "../packages/video-subtitler/src/review/c60113-region-ranker-folds.js";
import {
  c60113FileIdentity,
  assertC60113ReadOnlyIdentity,
  c60113ScoreDiagnostics,
  readC60113Json,
} from "./lib/c60113-acceptance-io.js";
import { loadC60113ReplayInput } from "./lib/c60113-replay-input.js";
import { buildC60113Workspace } from "./lib/c60113-build-workspace.js";

const { values } = parseArgs({
  options: {
    "artifact-root": { type: "string" },
    "output-root": { type: "string" },
    "upstream-prefix": { type: "string" },
    "upstream-date": { type: "string" },
    "evidence-prefix": { type: "string" },
    "evidence-date": { type: "string" },
    "output-prefix": { type: "string" },
    "output-date": { type: "string" },
    source: { type: "string" },
    "generated-at": { type: "string" },
    ffmpeg: { type: "string", default: "ffmpeg" },
  },
});
function required(name: keyof typeof values): string {
  const value = values[name];
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}
const generatedAt = required("generated-at");
const sourcePath = path.resolve(required("source"));
const outputRoot = path.resolve(required("output-root"));
const prefix = required("output-prefix"),
  date = required("output-date");
if (!/^[a-z0-9-]+$/u.test(prefix) || !/^\d{8}$/u.test(date))
  throw new Error("UNSAFE_OUTPUT_RUN_NAME");
const target = (suffix: string) =>
  path.join(outputRoot, `${prefix}-${suffix}-${date}`);
const suffixes = [
  "missing-evidence-v2",
  "evidence-families",
  "items-v3",
  "regions-v2",
  "region-priority",
  "playback-timeline",
  "burden-plans",
  "ranker-features",
  "workspace-v2",
  "final-a",
  "final-b",
];
for (const suffix of suffixes) {
  try {
    await access(target(suffix));
    throw new Error(`EXISTING_RUN_OUTPUT_NOT_OVERWRITTEN:${suffix}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
const replay = await loadC60113ReplayInput({
  artifactRoot: path.resolve(required("artifact-root")),
  upstreamPrefix: required("upstream-prefix"),
  upstreamDate: required("upstream-date"),
  evidencePrefix: required("evidence-prefix"),
  evidenceDate: required("evidence-date"),
  source: sourcePath,
});
const previousBaseline = await readC60113Json(
  path.join(target("baseline"), "c6-0-1-13-baseline-replay.json"),
);
if (
  machineQualitySemanticHash(previousBaseline) !==
  machineQualitySemanticHash(replay.baseline)
)
  throw new Error("BASELINE_CHANGED_SINCE_REPLAY");
const duration = replay.subtitlePackage.source.durationSeconds;
const stageRoot = await mkdtemp(path.join(tmpdir(), "c60113-machine-build-"));
process.stdout.write(`Machine-only staging directory: ${stageRoot}\n`);
const staged = (suffix: string) => path.join(stageRoot, suffix);
const machineInput = {
  items: replay.items.items,
  regions: replay.regions.regions,
  candidateBundles: replay.candidates.bundles,
  sourceDurationSeconds: duration,
  expectedSourceMediaSha256: replay.sourceIdentity.sha256,
  finalCues: replay.subtitlePackage.cues.map(({ id, start, end }) => ({
    id,
    start,
    end,
  })),
  rawArtifacts: { ...replay.evidence, ...replay.extendedEvidence },
};
const stages: C60113AblationStage[] = [
  "A1_MISSING_ONLY",
  "A2_EVIDENCE_FAMILIES",
  "A3_STRUCTURED_ITEMS",
  "A4_REGIONS_V2",
  "A5_RISK_DENSITY",
];
const variants = stages.map((ablationStage) =>
  buildC60113MachineReview({ ...machineInput, ablationStage }),
);
const machine = variants.at(-1);
const firstVariant = variants[0];
if (!machine || !firstVariant) throw new Error("MACHINE_VARIANTS_MISSING");
const machineB = buildC60113MachineReview(structuredClone(machineInput));
function machineArtifacts(value: C60113MachineReview) {
  return {
    "c6-0-1-13-review-rank-policy.json": value.policy,
    "machine-missing-speech-evidence-v2.json": value.missingEvidence,
    "machine-review-evidence-families.json": value.evidenceFamilies,
    "machine-review-items-v3.json": value.itemsV3,
    "machine-review-regions-v2.json": value.regionsV2,
    "machine-region-review-priority.json": value.regionPriority,
    "machine-review-playback-timeline.json": value.playbackTimeline,
    "machine-review-burden-plans.json": value.burdenPlans,
  };
}
const parity = Object.entries(machineArtifacts(machine))
  .map(([name, value]) => ({
    artifact: name,
    aHash: machineQualitySemanticHash(value),
    bHash: machineQualitySemanticHash(
      machineArtifacts(machineB)[
        name as keyof ReturnType<typeof machineArtifacts>
      ],
    ),
  }))
  .map((entry) => ({ ...entry, equal: entry.aHash === entry.bHash }));
if (parity.some((entry) => !entry.equal))
  throw new Error("INDEPENDENT_MACHINE_BUILD_AB_MISMATCH");
for (const suffix of suffixes.filter(
  (name) => !["workspace-v2", "final-a", "final-b"].includes(name),
))
  await mkdir(staged(suffix));
const destinations = {
  "c6-0-1-13-review-rank-policy.json": "items-v3",
  "machine-missing-speech-evidence-v2.json": "missing-evidence-v2",
  "machine-review-evidence-families.json": "evidence-families",
  "machine-review-items-v3.json": "items-v3",
  "machine-review-regions-v2.json": "regions-v2",
  "machine-region-review-priority.json": "region-priority",
  "machine-review-playback-timeline.json": "playback-timeline",
  "machine-review-burden-plans.json": "burden-plans",
};
for (const [name, artifact] of Object.entries(machineArtifacts(machine)))
  await atomicWriteJson(
    path.join(staged(destinations[name as keyof typeof destinations]), name),
    artifact,
  );
const legacyItemPriorities = new Map(
  replay.items.items.map((item) => [item.reviewItemId, item.priorityScore]),
);
const legacyRegionPrioritiesByItem = new Map(
  replay.regions.regions.flatMap((region) =>
    region.reviewItemIds.map((id) => [id, region.maxPriority.score] as const),
  ),
);
const missingCalibratedItemPriorities = new Map(
  firstVariant.itemsV3.items.map((item) => [
    item.reviewItemId,
    item.priorityScore,
  ]),
);
const featuresFor = (value: C60113MachineReview) =>
  buildC60113RegionFeaturesFromArtifacts({
    regionsV2: value.regionsV2,
    itemsV3: value.itemsV3,
    regionPriority: value.regionPriority,
    evidenceFamilies: value.evidenceFamilies,
    legacyItemPriorities,
    legacyRegionPrioritiesByItem,
    missingCalibratedItemPriorities,
    generatedAt,
  });
const features = featuresFor(machine),
  featuresB = featuresFor(machineB);
if (
  machineQualitySemanticHash(features) !== machineQualitySemanticHash(featuresB)
)
  throw new Error("MACHINE_FEATURE_AB_MISMATCH");
const folds = buildC60113RankerFolds({ features, generatedAt });
const workspace = await buildC60113Workspace({
  replay,
  ...machine,
  outputDirectory: staged("workspace-v2"),
  sourcePath,
  generatedAt,
  ffmpegPath: values.ffmpeg,
});
// Historical final directories also contain post-freeze evaluator artifacts.
// Copy only the unchanged production package and its six subtitle exports;
// never traverse those historical evaluation files in the machine phase.
async function copyMachineFinal(sourceDirectory: string, destination: string) {
  const basename = path.basename(sourceDirectory);
  const finalDirectory = path.join(destination, basename);
  await mkdir(finalDirectory, { recursive: true });
  const filenames = [
    "subtitle-package.needs-review.json",
    ...["ass", "srt", "vtt"].flatMap((extension) => [
      `${basename}.${extension}`,
      `${basename}.best-effort.${extension}`,
    ]),
  ];
  for (const filename of filenames)
    await cp(
      path.join(sourceDirectory, filename),
      path.join(finalDirectory, filename),
      {
        force: false,
        errorOnExist: true,
      },
    );
}
await copyMachineFinal(replay.subtitleRoot, staged("final-a"));
await copyMachineFinal(replay.subtitleRootB, staged("final-b"));
const workspaceB = await buildC60113Workspace({
  replay,
  ...machineB,
  outputDirectory: path.join(staged("final-b"), "review-workspace-v2"),
  sourcePath,
  generatedAt,
  ffmpegPath: values.ffmpeg,
});
if (
  machineQualitySemanticHash(workspace.workspaceData) !==
    machineQualitySemanticHash(workspaceB.workspaceData) ||
  machineQualitySemanticHash(workspace.audio) !==
    machineQualitySemanticHash(workspaceB.audio)
)
  throw new Error("WORKSPACE_AUDIO_AB_MISMATCH");
await cp(
  staged("workspace-v2"),
  path.join(staged("final-a"), "review-workspace-v2"),
  { recursive: true, force: false, errorOnExist: true },
);
const artifactHashes = {
  ...Object.fromEntries(
    Object.entries(machineArtifacts(machine)).map(([name, artifact]) => [
      name,
      artifact.semanticHash,
    ]),
  ),
  workspace: machineQualitySemanticHash(workspace.workspaceData),
  audio: workspace.audio.semanticHash,
  features: features.semanticHash,
  folds: folds.semanticHash,
};
const machineFreeze = createC60113RankerMachineFreeze({
  features,
  folds,
  artifactHashes,
  generatedAt,
});
const featureDir = staged("ranker-features");
await atomicWriteJson(
  path.join(featureDir, "machine-review-region-features.json"),
  features,
);
await atomicWriteJson(
  path.join(featureDir, "c6-0-1-13-review-ranker-folds.json"),
  folds,
);
await atomicWriteJson(
  path.join(featureDir, "c6-0-1-13-review-ranker-machine-freeze.json"),
  machineFreeze,
);

const nativeBaselineFeatures = buildC60113RegionFeatures({
  generatedAt,
  policyHash: machine.policy.semanticHash,
  regions: replay.regions.regions.map((region) => ({
    regionId: region.regionId,
    itemIds: region.reviewItemIds,
    sourceInterval: {
      start: Math.min(
        ...region.coreIntervals.map((interval) => interval.start),
      ),
      end: Math.max(...region.coreIntervals.map((interval) => interval.end)),
    },
    contextInterval: { start: region.contextStart, end: region.contextEnd },
    sceneIds: region.sceneIds,
    speakerGroupIds: region.speakerGroupIds,
    mandatory: region.requiredLevel === "REQUIRED",
    legacyItemPriority: region.maxPriority.score,
    legacyRegionPriority: region.maxPriority.score,
    missingCalibratedPriority: Math.max(
      ...region.reviewItemIds.map(
        (id) => missingCalibratedItemPriorities.get(id) ?? 0,
      ),
    ),
    deterministicRiskUtility: region.maxPriority.score,
    crossModelDisagreement: region.itemTypes.includes(
      "TEXT_CROSS_MODEL_DISAGREEMENT",
    ),
    values: {},
  })),
});
const ablationEntries: {
  stage: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6" | "A7";
  features: C60113RegionFeatures;
  machine: C60113MachineReview | null;
}[] = [
  { stage: "A0", features: nativeBaselineFeatures, machine: null },
  ...variants.map((variant, index) => ({
    stage: `A${index + 1}` as "A1" | "A2" | "A3" | "A4" | "A5",
    features: featuresFor(variant),
    machine: variant,
  })),
  { stage: "A6", features, machine },
  { stage: "A7", features, machine },
];
const ablationSummaries = [];
for (const entry of ablationEntries) {
  const directory = path.join(featureDir, "ablations", entry.stage);
  await mkdir(directory, { recursive: true });
  const fold = buildC60113RankerFolds({
    features: entry.features,
    generatedAt,
  });
  const hashes = entry.machine
    ? Object.fromEntries(
        Object.entries(machineArtifacts(entry.machine)).map(
          ([name, artifact]) => [name, artifact.semanticHash],
        ),
      )
    : {
        legacyItems: replay.items.semanticHash,
        legacyRegions: replay.regions.semanticHash,
      };
  const freeze = createC60113RankerMachineFreeze({
    features: entry.features,
    folds: fold,
    artifactHashes: hashes,
    generatedAt,
  });
  await atomicWriteJson(
    path.join(directory, "machine-review-region-features.json"),
    entry.features,
  );
  await atomicWriteJson(
    path.join(directory, "c6-0-1-13-review-ranker-folds.json"),
    fold,
  );
  await atomicWriteJson(
    path.join(directory, "c6-0-1-13-review-ranker-machine-freeze.json"),
    freeze,
  );
  if (entry.machine)
    for (const [name, artifact] of Object.entries(
      machineArtifacts(entry.machine),
    ))
      await atomicWriteJson(path.join(directory, name), artifact);
  const required = entry.machine?.burdenPlans.plans.find(
    (plan) => plan.planId === "ALL_MANDATORY",
  );
  ablationSummaries.push({
    stage: entry.stage,
    description: entry.machine?.ablationStage ?? "A0_NATIVE_C60112_QUEUE",
    artifactHashes: hashes,
    featuresHash: entry.features.semanticHash,
    foldsHash: fold.semanticHash,
    itemCount:
      entry.machine?.itemsV3.summary.itemCount ?? replay.baseline.itemCount,
    regionCount: entry.features.regions.length,
    requiredItemCount:
      entry.machine?.itemsV3.summary.requiredItemCount ??
      replay.baseline.requiredItemCount,
    requiredRegionCount:
      entry.machine?.regionsV2.summary.requiredRegionCount ??
      replay.baseline.requiredRegionCount,
    scoreDiagnostics: c60113ScoreDiagnostics(
      (entry.machine?.itemsV3.items ?? replay.items.items).map(
        (item) => item.priorityScore,
      ),
    ),
    uniqueAudioSeconds:
      entry.machine?.playbackTimeline.uniqueUnionSeconds ??
      replay.baseline.totalUniqueAudioSeconds,
    requiredUniqueAudioSeconds:
      required?.uniqueUnionSeconds ??
      replay.baseline.requiredUniqueAudioSeconds,
    stageMeaning:
      entry.stage === "A6"
        ? ("OOF_EVALUATION_OVER_FROZEN_MACHINE_FEATURES" as const)
        : entry.stage === "A7"
          ? ("FUTURE_RANKER_WORKSPACE_OVER_FROZEN_MACHINE_FEATURES" as const)
          : ("MACHINE_VARIANT" as const),
  });
}
const ablationCore = {
  schemaVersion: "1.0.0" as const,
  policyVersion: machine.policy.policyVersion,
  generatedAt,
  artifactType: "c6-0-1-13-ablation-machine-freeze" as const,
  stages: ablationSummaries,
  frozenBeforeLabels: true as const,
  runtimeGoldInputCount: 0 as const,
};
const ablationFreeze = c60113AblationFreezeSchema.parse({
  ...ablationCore,
  semanticHash: machineQualitySemanticHash(ablationCore),
});
await atomicWriteJson(
  path.join(featureDir, "c6-0-1-13-ablation-machine-freeze.json"),
  ablationFreeze,
);
for (const [suffix, value] of [
  ["final-a", machine],
  ["final-b", machineB],
] as const) {
  const directory = path.join(staged(suffix), "review-calibration-v13");
  await mkdir(directory);
  for (const [name, artifact] of Object.entries(machineArtifacts(value)))
    await atomicWriteJson(path.join(directory, name), artifact);
  await atomicWriteJson(
    path.join(directory, "machine-review-region-features.json"),
    features,
  );
  await atomicWriteJson(
    path.join(directory, "c6-0-1-13-review-ranker-folds.json"),
    folds,
  );
  await atomicWriteJson(
    path.join(directory, "c6-0-1-13-review-ranker-machine-freeze.json"),
    machineFreeze,
  );
}
const sourceAfter = await c60113FileIdentity(sourcePath);
assertC60113ReadOnlyIdentity(replay.sourceIdentity, sourceAfter);
await atomicWriteJson(
  path.join(featureDir, "c6-0-1-13-machine-build-summary.json"),
  {
    schemaVersion: "1.0.0",
    generatedAt,
    machineFreezeHash: machineFreeze.semanticHash,
    ablationFreezeHash: ablationFreeze.semanticHash,
    sourceBefore: replay.sourceIdentity,
    sourceAfter,
    sourceReadOnly: true,
    runtimeGoldInputCount: 0,
    asrInferenceCount: 0,
    networkUsed: false,
    parity,
    workspaceHash: artifactHashes.workspace,
    audioHash: workspace.audio.semanticHash,
    missing: machine.missingEvidence.summary,
    items: machine.itemsV3.summary,
    regions: machine.regionsV2.summary,
    foldCount: folds.actualFoldCount,
  },
);
await mkdir(outputRoot, { recursive: true });
for (const suffix of suffixes) await rename(staged(suffix), target(suffix));
process.stdout.write(
  `${JSON.stringify(
    {
      machineFreezeHash: machineFreeze.semanticHash,
      sourceReadOnly: true,
      runtimeGoldInputCount: 0,
      asrInferenceCount: 0,
      missing: machine.missingEvidence.summary,
      items: machine.itemsV3.summary,
      regions: machine.regionsV2.summary,
      folds: { count: folds.actualFoldCount, reason: folds.reason },
      outputs: suffixes.map(target),
    },
    null,
    2,
  )}\n`,
);

import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
} from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import * as shared from "@mvl/shared";
import {
  assertC60112MachineOnlyInput,
  assertC60112ReviewPolicy,
  assertC60112ReviewWorkspaceData,
  inspectReviewWav,
  machineQualitySemanticHash,
  verifyC60112ReviewPackageFreeze,
  type C60112ReviewPolicy,
  type C60112ReviewWorkspaceData,
} from "@mvl/video-subtitler";
import { c60StableHash } from "../packages/video-subtitler/src/finalization-risk-policy.js";
import { assertC60113MachineFreeze } from "../packages/video-subtitler/src/review/c60113-region-ranker-folds.js";
import { buildC60113RegionLabels } from "../packages/video-subtitler/src/review/c60113-region-ranker-calibration.js";
import { runC60113RankerCalibration } from "../packages/video-subtitler/src/review/c60113-region-evaluation.js";
import {
  c60113HashPayload,
  c60113Require,
} from "../packages/video-subtitler/src/review/c60113-region-features.js";
import {
  assertC60113ReadOnlyIdentity,
  c60113ContainedFile,
  c60113FileIdentity,
  type C60113FileIdentity,
} from "./lib/c60113-acceptance-io.js";
import {
  c60113FrozenPlans,
  c60113GoldErrorIntervals,
  c60113NativeLegacyPlans,
  evaluateC60113FrozenPlans,
  evaluateC60113MissingEvidence,
} from "./lib/c60113-post-freeze-evaluation.js";

const { values } = parseArgs({
  options: {
    "output-root": { type: "string" },
    "output-prefix": { type: "string" },
    "output-date": { type: "string" },
    "quality-evaluation": { type: "string" },
    "gold-evaluation": { type: "string" },
    gold: { type: "string" },
    source: { type: "string" },
    "generated-at": { type: "string" },
  },
});
function required(name: keyof typeof values): string {
  const value = values[name];
  if (!value) throw new Error("Missing --" + name);
  return value;
}
const outputRoot = path.resolve(required("output-root"));
const prefix = required("output-prefix"),
  date = required("output-date"),
  generatedAt = required("generated-at");
if (
  !/^[a-z0-9-]+$/u.test(prefix) ||
  !/^\d{8}$/u.test(date) ||
  !Number.isFinite(Date.parse(generatedAt))
)
  throw new Error("INVALID_EVALUATION_RUN_IDENTITY");
const target = (suffix: string) =>
  path.join(outputRoot, prefix + "-" + suffix + "-" + date);
const sourcePath = path.resolve(required("source"));
// Resolving an explicitly supplied path does not read the Gold file.
const qualityPath = path.resolve(required("quality-evaluation")),
  goldEvaluationPath = path.resolve(required("gold-evaluation")),
  goldPath = path.resolve(required("gold"));
for (const output of [target("ranker-oof"), target("ranker-freeze")]) {
  try {
    await access(output);
    throw new Error("EXISTING_EVALUATION_OUTPUT_NOT_OVERWRITTEN");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
const tracked = new Map<string, C60113FileIdentity>();
async function readFrozen(file: string): Promise<unknown> {
  if ((await lstat(file)).isSymbolicLink())
    throw new Error("SYMLINK_IN_FROZEN_MACHINE_INPUT");
  const before = await c60113FileIdentity(file);
  const value = JSON.parse(await readFile(file, "utf8")) as unknown;
  assertC60113ReadOnlyIdentity(before, await c60113FileIdentity(file));
  tracked.set(file, before);
  return value;
}
function withoutHash(value: { semanticHash: string }): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "semanticHash"),
  );
}
function assertSimpleHash(value: { semanticHash: string }): void {
  if (machineQualitySemanticHash(withoutHash(value)) !== value.semanticHash)
    throw new Error("FROZEN_ARTIFACT_SELF_HASH_MISMATCH");
}
const definitions = [
  [
    "c6-0-1-13-review-rank-policy.json",
    "items-v3",
    shared.c60113ReviewPolicySchema,
  ],
  [
    "machine-missing-speech-evidence-v2.json",
    "missing-evidence-v2",
    shared.c60113MissingSpeechEvidenceSchema,
  ],
  [
    "machine-review-evidence-families.json",
    "evidence-families",
    shared.c60113EvidenceFamilyGraphSchema,
  ],
  [
    "machine-review-items-v3.json",
    "items-v3",
    shared.c60113ReviewItemsV3Schema,
  ],
  [
    "machine-review-regions-v2.json",
    "regions-v2",
    shared.c60113ReviewRegionsV2Schema,
  ],
  [
    "machine-region-review-priority.json",
    "region-priority",
    shared.c60113RegionReviewPrioritySchema,
  ],
  [
    "machine-review-playback-timeline.json",
    "playback-timeline",
    shared.c60113ReviewPlaybackTimelineSchema,
  ],
  [
    "machine-review-burden-plans.json",
    "burden-plans",
    shared.c60113ReviewBurdenPlansSchema,
  ],
] as const;
const featureRoot = target("ranker-features");
async function readFeatureFreeze(directory: string) {
  const features = shared.c60113RegionFeaturesSchema.parse(
    await readFrozen(
      path.join(directory, "machine-review-region-features.json"),
    ),
  );
  const folds = shared.c60113RankerFoldsSchema.parse(
    await readFrozen(
      path.join(directory, "c6-0-1-13-review-ranker-folds.json"),
    ),
  );
  const machineFreeze = shared.c60113RankerMachineFreezeSchema.parse(
    await readFrozen(
      path.join(directory, "c6-0-1-13-review-ranker-machine-freeze.json"),
    ),
  );
  assertC60113MachineFreeze({ features, folds, machineFreeze });
  return { features, folds, machineFreeze };
}
const main = await readFeatureFreeze(featureRoot);
const baseline = shared.c60113BaselineReplaySchema.parse(
  await readFrozen(
    path.join(target("baseline"), "c6-0-1-13-baseline-replay.json"),
  ),
);
assertSimpleHash(baseline);
if (
  baseline.sourceDurationSeconds === null ||
  baseline.sourceDurationSeconds <= 0
)
  throw new Error("SOURCE_DURATION_REQUIRED_FOR_REVIEW_BUDGETS");
const duration = baseline.sourceDurationSeconds;
const ablationFreeze = shared.c60113AblationFreezeSchema.parse(
  await readFrozen(
    path.join(featureRoot, "c6-0-1-13-ablation-machine-freeze.json"),
  ),
);
assertSimpleHash(ablationFreeze);
if (
  JSON.stringify(ablationFreeze.stages.map((stage) => stage.stage).sort()) !==
  JSON.stringify(["A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7"])
)
  throw new Error("ABLATION_FREEZE_STAGE_COVERAGE_MISMATCH");
const sourceBefore = await c60113FileIdentity(sourcePath);
assertC60113ReadOnlyIdentity(baseline.sourceIdentity, sourceBefore);
for (const [name, suffix, schema] of definitions) {
  const artifact = schema.parse(
    await readFrozen(path.join(target(suffix), name)),
  );
  assertSimpleHash(artifact);
  if (main.machineFreeze.artifactHashes[name] !== artifact.semanticHash)
    throw new Error("MACHINE_FREEZE_ARTIFACT_MISMATCH:" + name);
}
const missingEvidence = shared.c60113MissingSpeechEvidenceSchema.parse(
  await readFrozen(
    path.join(
      target("missing-evidence-v2"),
      "machine-missing-speech-evidence-v2.json",
    ),
  ),
);
if (
  main.machineFreeze.artifactHashes.features !== main.features.semanticHash ||
  main.machineFreeze.artifactHashes.folds !== main.folds.semanticHash
)
  throw new Error("FEATURE_FOLD_ARTIFACT_BINDING_MISMATCH");

// Reuse the established C6.0.1.12 review delivery freeze, including every WAV.
const workspaceRoot = target("workspace-v2");
const workspaceData = (await readFrozen(
  path.join(workspaceRoot, "review-data.json"),
)) as C60112ReviewWorkspaceData;
assertC60112ReviewWorkspaceData(workspaceData);
const workspaceFreeze = shared.c60112ReviewPackageFreezeSchema.parse(
  await readFrozen(
    path.join(workspaceRoot, "c6-0-1-12-review-package-freeze.json"),
  ),
);
const policy = (await readFrozen(
  path.join(workspaceRoot, "c6-0-1-12-review-assistance-policy.json"),
)) as C60112ReviewPolicy;
assertC60112ReviewPolicy(policy);
const items = shared.machineReviewItemsSchema.parse(
  await readFrozen(path.join(workspaceRoot, "machine-review-items.json")),
);
const priority = shared.machineReviewPrioritySchema.parse(
  await readFrozen(path.join(workspaceRoot, "machine-review-priority.json")),
);
const regions = shared.machineReviewRegionsSchema.parse(
  await readFrozen(path.join(workspaceRoot, "machine-review-regions.json")),
);
const candidates = shared.machineReviewCandidateBundlesSchema.parse(
  await readFrozen(
    path.join(workspaceRoot, "machine-review-candidate-bundles.json"),
  ),
);
const audio = shared.machineReviewAudioManifestSchema.parse(
  await readFrozen(
    path.join(workspaceRoot, "machine-review-audio-manifest.json"),
  ),
);
const packageFile = path.join(
  workspaceRoot,
  "subtitle-package.needs-review.json",
);
const subtitlePackage = shared.subtitlePackageSchema.parse(
  await readFrozen(packageFile),
);
const machineDraftHash = c60113Require(tracked.get(packageFile)).sha256;
if (
  machineDraftHash !== baseline.machineDraftHash ||
  subtitlePackage.cues.length !== baseline.canonicalIdentities.cueCount
)
  throw new Error("MACHINE_DRAFT_CHANGED_BEFORE_CALIBRATION");
if (
  !verifyC60112ReviewPackageFreeze({
    freeze: workspaceFreeze,
    packageInput: {
      sourceMediaSha256: sourceBefore.sha256,
      machineDraftHash,
      policy,
      items,
      priority,
      regions,
      candidates,
      audioManifest: audio,
      workspaceData,
    },
  })
)
  throw new Error("WORKSPACE_REVIEW_DELIVERY_FREEZE_MISMATCH");
if (
  main.machineFreeze.artifactHashes.workspace !==
    machineQualitySemanticHash(workspaceData) ||
  main.machineFreeze.artifactHashes.audio !== audio.semanticHash
)
  throw new Error("WORKSPACE_AUDIO_MACHINE_FREEZE_MISMATCH");
assertC60112MachineOnlyInput(
  { items, priority, regions, candidates, audio, workspaceData },
  "c60113-post-freeze-barrier",
);
for (const clip of audio.clips) {
  const file = await c60113ContainedFile(workspaceRoot, clip.relativePath);
  const identity = await c60113FileIdentity(file);
  if (identity.sha256 !== clip.sha256)
    throw new Error("REVIEW_AUDIO_CHANGED_BEFORE_GOLD");
  inspectReviewWav(await readFile(file));
  tracked.set(file, identity);
}
const allowedRootHashes = [
  ...definitions.map(([name]) => name),
  "workspace",
  "audio",
  "features",
  "folds",
].sort();
if (
  JSON.stringify(Object.keys(main.machineFreeze.artifactHashes).sort()) !==
  JSON.stringify(allowedRootHashes)
)
  throw new Error("UNVERIFIED_ROOT_MACHINE_FREEZE_HASH_KEY");

// The baseline's native regions are deliberately not replaced by the new regions.
const upstreamMatch = /^([a-z0-9-]+)-review-quality-evaluation-(\d{8})$/u.exec(
  path.basename(path.dirname(qualityPath)),
);
if (!upstreamMatch)
  throw new Error("QUALITY_EVALUATION_RUN_LAYOUT_UNRECOGNIZED");
const upstreamRoot = path.dirname(path.dirname(qualityPath));
const upstream = (suffix: string, file: string) =>
  path.join(
    upstreamRoot,
    c60113Require(upstreamMatch[1]) +
      "-" +
      suffix +
      "-" +
      c60113Require(upstreamMatch[2]),
    file,
  );
const legacyItems = shared.machineReviewItemsSchema.parse(
  await readFrozen(upstream("review-items", "machine-review-items.json")),
);
const legacyRegions = shared.machineReviewRegionsSchema.parse(
  await readFrozen(upstream("review-regions", "machine-review-regions.json")),
);
assertSimpleHash(legacyItems);
assertSimpleHash(legacyRegions);
const legacyFreeze = shared.c60112ReviewPackageFreezeSchema.parse(
  await readFrozen(
    upstream("review-package-freeze", "c6-0-1-12-review-package-freeze.json"),
  ),
);
if (
  legacyFreeze.semanticHash !== baseline.upstreamFreezeHash ||
  legacyFreeze.machineDraftHash !== baseline.machineDraftHash ||
  legacyFreeze.sourceMediaSha256 !== sourceBefore.sha256 ||
  legacyFreeze.itemHash !== machineQualitySemanticHash(legacyItems) ||
  legacyFreeze.regionHash !== machineQualitySemanticHash(legacyRegions)
)
  throw new Error("UPSTREAM_BASELINE_FREEZE_IDENTITY_MISMATCH");
const stages = [];
for (const entry of ablationFreeze.stages) {
  const directory = path.join(featureRoot, "ablations", entry.stage);
  const stage = await readFeatureFreeze(directory);
  if (
    entry.featuresHash !== stage.features.semanticHash ||
    entry.foldsHash !== stage.folds.semanticHash ||
    machineQualitySemanticHash(entry.artifactHashes) !==
      machineQualitySemanticHash(stage.machineFreeze.artifactHashes)
  )
    throw new Error("ABLATION_FEATURE_FREEZE_MISMATCH");
  let plans: shared.C60113ReviewBurdenPlans | null = null;
  if (entry.stage === "A0") {
    if (
      entry.artifactHashes.legacyItems !== legacyItems.semanticHash ||
      entry.artifactHashes.legacyRegions !== legacyRegions.semanticHash ||
      Object.keys(entry.artifactHashes).length !== 2
    )
      throw new Error("NATIVE_BASELINE_ARTIFACT_FREEZE_MISMATCH");
  } else {
    for (const [name, , schema] of definitions) {
      const artifact = schema.parse(
        await readFrozen(path.join(directory, name)),
      );
      assertSimpleHash(artifact);
      if (entry.artifactHashes[name] !== artifact.semanticHash)
        throw new Error("ABLATION_MACHINE_ARTIFACT_FREEZE_MISMATCH");
      if (name === "machine-review-burden-plans.json")
        plans = shared.c60113ReviewBurdenPlansSchema.parse(artifact);
    }
    if (Object.keys(entry.artifactHashes).length !== definitions.length)
      throw new Error("UNVERIFIED_ABLATION_FREEZE_HASH_KEY");
  }
  if (
    (entry.stage === "A6" || entry.stage === "A7") &&
    (stage.features.semanticHash !== main.features.semanticHash ||
      stage.folds.semanticHash !== main.folds.semanticHash)
  )
    throw new Error(
      "OOF_ABLATION_MUST_USE_IDENTICAL_PREFROZEN_MACHINE_FEATURES",
    );
  stages.push({ entry, ...stage, plans });
}

// FIRST GOLD ACCESS: all machine artifacts, audio and every ablation are verified above.
process.stdout.write(
  "Verified pre-Gold machine freeze: " + main.machineFreeze.semanticHash + "\n",
);
const firstGoldReadAt = new Date().toISOString();
const goldBefore = await c60113FileIdentity(goldPath);
const qualityBefore = await c60113FileIdentity(qualityPath),
  goldEvaluationBefore = await c60113FileIdentity(goldEvaluationPath);
const quality = shared.c60112ReviewQualityEvaluationSchema.parse(
  JSON.parse(await readFile(qualityPath, "utf8")) as unknown,
);
const goldEvaluation = shared.machineVsGoldEvaluationSchema.parse(
  JSON.parse(await readFile(goldEvaluationPath, "utf8")) as unknown,
);
if (
  machineQualitySemanticHash({
    ...withoutHash(quality),
    generatedAt: undefined,
  }) !== quality.semanticHash
)
  throw new Error("UPSTREAM_REVIEW_QUALITY_SEMANTIC_HASH_MISMATCH");
if (
  c60StableHash({
    ...withoutHash(goldEvaluation),
    generatedAt: "<evaluation-time>",
    evaluationWallTimeMs: 0,
    goldIdentity: {
      ...goldEvaluation.goldIdentity,
      firstReadAt: "<gold-first-read-time>",
    },
  }) !== goldEvaluation.semanticHash
)
  throw new Error("UPSTREAM_GOLD_EVALUATION_SEMANTIC_HASH_MISMATCH");
if (
  quality.goldEvaluationArtifactSha256 !== goldEvaluationBefore.sha256 ||
  quality.reviewPackageFreezeHash !== baseline.upstreamFreezeHash ||
  quality.machineDraftHash !== baseline.machineDraftHash ||
  quality.sourceSha256Before !== sourceBefore.sha256 ||
  quality.sourceSha256After !== sourceBefore.sha256 ||
  quality.goldSha256Before !== goldBefore.sha256 ||
  quality.goldSha256After !== goldBefore.sha256 ||
  goldEvaluation.sourceIdentity.sha256 !== sourceBefore.sha256 ||
  goldEvaluation.goldIdentity.sha256 !== goldBefore.sha256 ||
  goldEvaluation.goldIdentity.size !== goldBefore.size ||
  !goldEvaluation.goldIdentity.readOnlyVerified ||
  !goldEvaluation.outputHashUnchangedAfterGold ||
  goldEvaluation.outputHashBeforeGold !== goldEvaluation.outputHashAfterGold
)
  throw new Error("POST_FREEZE_GOLD_SOURCE_OR_BASELINE_IDENTITY_MISMATCH");
const legacyItemIds = new Set(
  legacyItems.items.map((item) => item.reviewItemId),
);
if (
  quality.errorComponents.some((component) =>
    component.coveredReviewItemIds.some((id) => !legacyItemIds.has(id)),
  )
)
  throw new Error("GOLD_REVIEW_ITEM_LINEAGE_OUTSIDE_FROZEN_BASELINE");
const errorIntervals = c60113GoldErrorIntervals(goldEvaluation);
const labels = buildC60113RegionLabels({
  ...main,
  qualityEvaluation: quality,
  errorIntervals,
  generatedAt,
});
const result = runC60113RankerCalibration({
  ...main,
  labels,
  episodeDurationSeconds: duration,
  legacyRequiredUniqueAudioSeconds: baseline.requiredUniqueAudioSeconds,
  generatedAt,
});
const missingEvaluation = evaluateC60113MissingEvidence({
  missingEvidence,
  legacyItems,
  labels,
  generatedAt,
});
const labelArtifacts: { stage: string; labels: shared.C60113RegionLabels }[] =
  [];
const ablationResults: shared.C60113AblationEvaluation["stages"] = stages.map(
  (stage) => {
    const stageLabels = buildC60113RegionLabels({
      ...stage,
      qualityEvaluation: quality,
      errorIntervals,
      generatedAt,
    });
    labelArtifacts.push({ stage: stage.entry.stage, labels: stageLabels });
    const learned = stage.entry.stage === "A6" || stage.entry.stage === "A7";
    const ranking = learned
      ? c60113Require(
          result.evaluation.rankings.find(
            (ranking) =>
              ranking.ranker ===
              (stage.entry.stage === "A6"
                ? "R4_LINEAR_OOF_REGION_RANKER"
                : result.evaluation.selectedRanker),
          ),
        )
      : null;
    const plans =
      stage.entry.stage === "A0"
        ? c60113NativeLegacyPlans(stage.features, duration)
        : stage.plans === null
          ? []
          : c60113FrozenPlans(stage.plans);
    const native =
      ranking === null
        ? evaluateC60113FrozenPlans({
            ...stage,
            labels: stageLabels,
            plans,
            episodeDurationSeconds: duration,
          })
        : null;
    return {
      stage: stage.entry.stage,
      featuresHash: stage.features.semanticHash,
      foldsHash: stage.folds.semanticHash,
      machineFreezeHash: stage.machineFreeze.semanticHash,
      labelsHash: stageLabels.semanticHash,
      selectionSource:
        stage.entry.stage === "A0"
          ? "NATIVE_LEGACY_R3_STATIC_ORDER"
          : stage.entry.stage === "A6"
            ? "HELD_OUT_OOF_SCORES"
            : stage.entry.stage === "A7"
              ? "SELECTED_OOF_OR_DETERMINISTIC_NOT_FUTURE_IN_SAMPLE"
              : "FROZEN_NATIVE_MACHINE_BURDEN_PLANS",
      learnedEvaluationSourceFreezeHash: learned
        ? main.machineFreeze.semanticHash
        : null,
      itemCount: stage.entry.itemCount,
      regionCount: stage.entry.regionCount,
      requiredItemCount: stage.entry.requiredItemCount,
      requiredRegionCount: stage.entry.requiredRegionCount,
      metrics: ranking?.pooled ?? c60113Require(native ?? undefined).metrics,
      foldMetrics:
        ranking?.folds.map((fold) => ({
          foldId: fold.foldId,
          metrics: fold.metrics,
        })) ?? c60113Require(native ?? undefined).foldMetrics,
      foldMetricBasis: learned
        ? "FOLD_LOCAL_UNIQUE_AUDIO_BUDGET"
        : "GLOBAL_PLAN_PROJECTED_TO_FOLD",
      uniqueErrorComponentCount: stageLabels.errorComponents.length,
    };
  },
);
if (
  ablationResults.some(
    (stage) =>
      stage.uniqueErrorComponentCount !== quality.errorComponents.length,
  )
)
  throw new Error("ABLATION_ERROR_DENOMINATOR_CHANGED");
const ablationCore = {
  schemaVersion: "1.0.0" as const,
  policyVersion: main.features.policyVersion,
  generatedAt,
  artifactType: "c6-0-1-13-ablation-evaluation" as const,
  ablationFreezeHash: ablationFreeze.semanticHash,
  sourceQualityEvaluationHash: quality.semanticHash,
  sameUniqueErrorDenominator: true as const,
  uniqueErrorComponentCount: quality.errorComponents.length,
  stages: ablationResults,
};
const ablationEvaluation = shared.c60113AblationEvaluationSchema.parse({
  ...ablationCore,
  semanticHash: c60113HashPayload(ablationCore),
});
const sourceAfter = await c60113FileIdentity(sourcePath),
  goldAfter = await c60113FileIdentity(goldPath);
assertC60113ReadOnlyIdentity(sourceBefore, sourceAfter);
assertC60113ReadOnlyIdentity(goldBefore, goldAfter);
assertC60113ReadOnlyIdentity(
  qualityBefore,
  await c60113FileIdentity(qualityPath),
);
assertC60113ReadOnlyIdentity(
  goldEvaluationBefore,
  await c60113FileIdentity(goldEvaluationPath),
);
for (const [file, identity] of tracked)
  assertC60113ReadOnlyIdentity(identity, await c60113FileIdentity(file));
const auditCore = {
  schemaVersion: "1.0.0" as const,
  policyVersion: main.features.policyVersion,
  generatedAt,
  artifactType: "c6-0-1-13-post-freeze-evaluation-audit" as const,
  machineFreezeHash: main.machineFreeze.semanticHash,
  ablationFreezeHash: ablationFreeze.semanticHash,
  machineFeaturesHash: main.features.semanticHash,
  foldsHash: main.folds.semanticHash,
  firstGoldReadAt,
  frozenMachineFilesVerifiedBeforeGoldRead: true as const,
  frozenMachineFileCount: tracked.size,
  frozenMachineFilesUnchanged: true,
  sourceIdentityBefore: sourceBefore,
  sourceIdentityAfter: sourceAfter,
  goldIdentityBefore: goldBefore,
  goldIdentityAfter: goldAfter,
  qualityEvaluationSha256: qualityBefore.sha256,
  goldEvaluationSha256: goldEvaluationBefore.sha256,
  upstreamEvaluationFilesUnchanged: true,
  sourceReadOnly: true,
  goldReadOnly: true,
  runtimeGoldInputCount: 0 as const,
  evaluatorGoldInputCount: 1 as const,
  asrInferenceCount: 0 as const,
  networkUsed: false as const,
  candidateFixabilityReevaluated: false as const,
  evaluatedStages: ablationResults.map((stage) => stage.stage),
};
const audit = shared.c60113PostFreezeEvaluationAuditSchema.parse({
  ...auditCore,
  semanticHash: c60113HashPayload(auditCore),
});
const staging = await mkdtemp(path.join(outputRoot, ".c60113-evaluation-"));
const oofDirectory = path.join(staging, "ranker-oof"),
  freezeDirectory = path.join(staging, "ranker-freeze");
await mkdir(oofDirectory);
await mkdir(freezeDirectory);
const artifacts = {
  "gold-review-region-labels.json": labels,
  "c6-0-1-13-review-ranker-oof.json": result.oof,
  "c6-0-1-13-region-ranking-evaluation.json": result.evaluation,
  "c6-0-1-13-data-quality-audit.json": result.dataQuality,
  "c6-0-1-13-ablation-evaluation.json": ablationEvaluation,
  "c6-0-1-13-missing-evidence-evaluation.json": missingEvaluation,
  "c6-0-1-13-post-freeze-evaluation-audit.json": audit,
};
for (const [name, artifact] of Object.entries(artifacts))
  await shared.atomicWriteJson(path.join(oofDirectory, name), artifact);
for (const entry of labelArtifacts) {
  const directory = path.join(oofDirectory, "ablations", entry.stage);
  await mkdir(directory, { recursive: true });
  await shared.atomicWriteJson(
    path.join(directory, "gold-review-region-labels.json"),
    entry.labels,
  );
}
await shared.atomicWriteJson(
  path.join(freezeDirectory, "c6-0-1-13-region-ranker-freeze.json"),
  result.rankerFreeze,
);
await rename(oofDirectory, target("ranker-oof"));
await rename(freezeDirectory, target("ranker-freeze"));
process.stdout.write(
  JSON.stringify(
    {
      machineFreezeHash: main.machineFreeze.semanticHash,
      rankingResult: result.evaluation.rankingResult,
      burdenResult: result.evaluation.burdenResult,
      selectedRanker: result.evaluation.selectedRanker,
      learnedFreezeEligible: result.evaluation.learnedFreezeEligible,
      requiredSafetyRecall: result.evaluation.requiredSafetyRecall,
      dataQualityPassed: result.dataQuality.passed,
      sourceReadOnly: true,
      goldReadOnly: true,
      runtimeGoldInputCount: 0,
      asrInferenceCount: 0,
      outputs: [target("ranker-oof"), target("ranker-freeze")],
    },
    null,
    2,
  ) + "\n",
);

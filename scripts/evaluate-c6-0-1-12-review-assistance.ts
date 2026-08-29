import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readFile, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  atomicWriteJson,
  c60112IdealReviewUpperBoundSchema,
  c60112ReviewPackageFreezeSchema,
  c60112ReviewQualityEvaluationSchema,
  machineReviewAudioManifestSchema,
  machineReviewCandidateBundlesSchema,
  machineReviewItemsSchema,
  machineReviewPrioritySchema,
  machineReviewRegionsSchema,
  machineVsGoldEvaluationSchema,
  subtitlePackageSchema,
  type MachineReviewAudioManifest,
} from "@mvl/shared";
import { parseAss } from "@mvl/subtitle-core";
import {
  assertC60112MachineOnlyInput,
  assertC60112ReviewPolicy,
  assertC60112ReviewWorkspaceData,
  evaluateC60112ReviewQuality,
  inspectReviewWav,
  machineQualitySemanticHash,
  normalizeC601GoldAssTimestamps,
  verifyC60112ReviewPackageFreeze,
  type C60112EvaluableReviewItem,
  type C60112ReviewPolicy,
  type C60112ReviewWorkspaceData,
} from "@mvl/video-subtitler";

const GENERATED_AT = "2026-08-29T14:00:00.000Z";
const TRUSTED_GOLD_EVALUATION_SHA256 =
  "3cedfab22687d976952f3505c0119cb10754468837d29a26eb760845b754a7d7";
const TRUSTED_C60111_MACHINE_FREEZE_HASH =
  "63ca746578e32dd80ad0db2fe64da3ce7e96d86c95547562bb24b64cc5b8d9a8";
const TRUSTED_OUTPUT_BEFORE_GOLD_HASH =
  "a3c9f7085e034f3e66787f9456c743b3af1a341e82ea55d639531f49dce32b6a";

function required(
  values: Record<string, string | undefined>,
  name: string,
): string {
  const value = values[name];
  if (value === undefined || value.trim() === "")
    throw new Error(`Missing --${name}.`);
  return path.resolve(value);
}

function requiredRaw(
  values: Record<string, string | undefined>,
  name: string,
): string {
  const value = values[name];
  if (value === undefined || value.trim() === "")
    throw new Error(`Missing --${name}.`);
  return value.trim();
}

async function json(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

async function fileHash(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath) as AsyncIterable<Buffer>)
    hash.update(chunk);
  return hash.digest("hex");
}

function parseOldSingleAsrRiskArtifact(value: unknown): {
  events: { eventId: string }[];
} {
  if (value === null || typeof value !== "object") {
    throw new Error("Invalid old single-ASR risk artifact.");
  }
  const events = (value as { events?: unknown }).events;
  if (!Array.isArray(events)) {
    throw new Error("Old single-ASR risk artifact is missing events.");
  }
  const parsed = events.map((entry) => {
    if (
      entry === null ||
      typeof entry !== "object" ||
      typeof (entry as { eventId?: unknown }).eventId !== "string" ||
      (entry as { eventId: string }).eventId.length === 0
    ) {
      throw new Error("Old single-ASR risk event is invalid.");
    }
    return { eventId: (entry as { eventId: string }).eventId };
  });
  if (new Set(parsed.map((entry) => entry.eventId)).size !== parsed.length) {
    throw new Error("Old single-ASR risk event IDs must be unique.");
  }
  return { events: parsed };
}

async function verifyFrozenReviewAudio(input: {
  workspaceDataPath: string;
  audio: MachineReviewAudioManifest;
}): Promise<void> {
  const workspaceRoot = await realpath(path.dirname(input.workspaceDataPath));
  for (const clip of input.audio.clips) {
    const candidate = path.resolve(workspaceRoot, clip.relativePath);
    const resolved = await realpath(candidate);
    const relative = path.relative(workspaceRoot, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Review audio escaped workspace: ${clip.relativePath}`);
    }
    if ((await lstat(candidate)).isSymbolicLink()) {
      throw new Error(
        `Review audio must not be a symlink: ${clip.relativePath}`,
      );
    }
    if ((await fileHash(candidate)) !== clip.sha256) {
      throw new Error(`Review audio hash mismatch: ${clip.relativePath}`);
    }
    inspectReviewWav(await readFile(candidate));
  }
}

const { values } = parseArgs({
  options: {
    freeze: { type: "string" },
    items: { type: "string" },
    priority: { type: "string" },
    regions: { type: "string" },
    candidates: { type: "string" },
    audio: { type: "string" },
    policy: { type: "string" },
    "workspace-data": { type: "string" },
    "machine-package": { type: "string" },
    "gold-evaluation": { type: "string" },
    "gold-evaluation-sha256": { type: "string" },
    gold: { type: "string" },
    source: { type: "string" },
    output: { type: "string" },
    "ideal-output": { type: "string" },
  },
});
const options = values as Record<string, string | undefined>;
const paths = {
  freeze: required(options, "freeze"),
  items: required(options, "items"),
  priority: required(options, "priority"),
  regions: required(options, "regions"),
  candidates: required(options, "candidates"),
  audio: required(options, "audio"),
  policy: required(options, "policy"),
  workspaceData: required(options, "workspace-data"),
  machinePackage: required(options, "machine-package"),
  goldEvaluation: required(options, "gold-evaluation"),
  goldEvaluationSha256: requiredRaw(options, "gold-evaluation-sha256"),
  gold: required(options, "gold"),
  source: required(options, "source"),
  output: required(options, "output"),
  idealOutput: required(options, "ideal-output"),
};
if (
  paths.output === paths.idealOutput ||
  paths.output === path.parse(paths.output).root ||
  paths.idealOutput === path.parse(paths.idealOutput).root ||
  paths.output === process.cwd() ||
  paths.idealOutput === process.cwd()
) {
  throw new Error("Evaluation outputs must be distinct, scoped directories.");
}

// This is the explicit post-freeze barrier. Gold is not opened until the
// machine-only package has a verified freeze record on disk.
const freeze = c60112ReviewPackageFreezeSchema.parse(await json(paths.freeze));
const policy = (await json(paths.policy)) as C60112ReviewPolicy;
assertC60112ReviewPolicy(policy);
const itemsArtifact = machineReviewItemsSchema.parse(await json(paths.items));
const priorityArtifact = machineReviewPrioritySchema.parse(
  await json(paths.priority),
);
const regionsArtifact = machineReviewRegionsSchema.parse(
  await json(paths.regions),
);
const candidatesArtifact = machineReviewCandidateBundlesSchema.parse(
  await json(paths.candidates),
);
const audioArtifact = machineReviewAudioManifestSchema.parse(
  await json(paths.audio),
);
const workspaceData = (await json(
  paths.workspaceData,
)) as C60112ReviewWorkspaceData;
assertC60112ReviewWorkspaceData(workspaceData);
assertC60112MachineOnlyInput(
  {
    items: itemsArtifact,
    priority: priorityArtifact,
    regions: regionsArtifact,
    candidates: candidatesArtifact,
    audio: audioArtifact,
    workspaceData,
  },
  "gold-evaluator-pre-freeze-machine-inputs",
);
await verifyFrozenReviewAudio({
  workspaceDataPath: paths.workspaceData,
  audio: audioArtifact,
});
const oldSingleAsrRiskPath = path.join(
  path.dirname(paths.machinePackage),
  "machine-reasr-priority.json",
);
const oldSingleAsrRiskArtifact = parseOldSingleAsrRiskArtifact(
  await json(oldSingleAsrRiskPath),
);
const oldSingleAsrRiskArtifactSha256 = await fileHash(oldSingleAsrRiskPath);
const oldSingleAsrRankByEvent = new Map(
  oldSingleAsrRiskArtifact.events.map((event, index) => [
    event.eventId,
    oldSingleAsrRiskArtifact.events.length - index,
  ]),
);
const sourceSha256Before = await fileHash(paths.source);
const machinePackage = subtitlePackageSchema.parse(
  await json(paths.machinePackage),
);
const machineDraftHash = await fileHash(paths.machinePackage);
const freezeVerified = verifyC60112ReviewPackageFreeze({
  freeze,
  packageInput: {
    sourceMediaSha256: sourceSha256Before,
    machineDraftHash,
    policy,
    items: itemsArtifact,
    priority: priorityArtifact,
    regions: regionsArtifact,
    candidates: candidatesArtifact,
    audioManifest: audioArtifact,
    workspaceData,
  },
});
if (
  !freezeVerified ||
  freeze.sourceMediaSha256 !== sourceSha256Before ||
  freeze.machineDraftHash !== machineDraftHash
) {
  throw new Error("GOLD_EVALUATION_REQUIRES_VERIFIED_MACHINE_REVIEW_FREEZE");
}

// The first Gold read occurs only after every frozen machine component above
// has been strict-parsed and the complete freeze graph has been recomputed.
const goldSha256Before = await fileHash(paths.gold);
if (
  goldSha256Before !==
  "a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e"
) {
  throw new Error(`Unexpected Gold hash: ${goldSha256Before}`);
}
const expectedGoldEvaluationSha256 = path.basename(paths.goldEvaluationSha256);
if (!/^[a-f0-9]{64}$/u.test(expectedGoldEvaluationSha256)) {
  throw new Error("Invalid --gold-evaluation-sha256 value.");
}
const goldEvaluationPhysicalSha256 = await fileHash(paths.goldEvaluation);
if (goldEvaluationPhysicalSha256 !== expectedGoldEvaluationSha256) {
  throw new Error("GOLD_EVALUATION_ARTIFACT_HASH_MISMATCH");
}
if (goldEvaluationPhysicalSha256 !== TRUSTED_GOLD_EVALUATION_SHA256) {
  throw new Error("GOLD_EVALUATION_ARTIFACT_IS_NOT_THE_TRUSTED_BENCHMARK");
}
const goldEvaluation = machineVsGoldEvaluationSchema.parse(
  await json(paths.goldEvaluation),
);
if (
  goldEvaluation.sourceIdentity.sha256 !== sourceSha256Before ||
  goldEvaluation.goldIdentity.sha256 !== goldSha256Before ||
  !goldEvaluation.outputHashUnchangedAfterGold ||
  goldEvaluation.outputHashBeforeGold !== goldEvaluation.outputHashAfterGold ||
  goldEvaluation.machineFreezeHash !== TRUSTED_C60111_MACHINE_FREEZE_HASH ||
  goldEvaluation.outputHashBeforeGold !== TRUSTED_OUTPUT_BEFORE_GOLD_HASH
) {
  throw new Error("GOLD_EVALUATION_ARTIFACT_IDENTITY_MISMATCH");
}
const normalizedGoldAss = normalizeC601GoldAssTimestamps(
  await readFile(paths.gold, "utf8"),
);
const goldCues = parseAss(normalizedGoldAss.content).map((cue, index) => ({
  id: `gold-${String(index + 1).padStart(4, "0")}`,
  start: cue.start,
  end: cue.end,
  text: cue.text,
}));
const priorityByItem = new Map(
  priorityArtifact.entries.map((entry) => [
    entry.reviewItemId,
    entry.priorityScore,
  ]),
);
const regionByItem = new Map(
  regionsArtifact.regions.flatMap((region) =>
    region.reviewItemIds.map((itemId) => [itemId, region.regionId] as const),
  ),
);
const durationByRegion = new Map(
  audioArtifact.clips.map((clip) => [
    clip.regionId,
    clip.actualDurationSeconds,
  ]),
);
const bundleByItem = new Map(
  candidatesArtifact.bundles.map((bundle) => [bundle.reviewItemId, bundle]),
);
const evaluableItems: C60112EvaluableReviewItem[] = itemsArtifact.items.map(
  (item, index) => {
    const regionId = regionByItem.get(item.reviewItemId);
    if (regionId === undefined)
      throw new Error(`Region missing for ${item.reviewItemId}.`);
    return {
      itemId: item.reviewItemId,
      interval: item.sourceInterval,
      targetCueIds: item.finalCueIds,
      labels: item.itemTypes,
      priorityScore:
        priorityByItem.get(item.reviewItemId) ?? item.priorityScore,
      chronologicalIndex: index,
      regionId,
      audioDurationSeconds: durationByRegion.get(regionId) ?? 0,
      currentText: item.currentText ?? "",
      candidateTexts: (
        bundleByItem.get(item.reviewItemId)?.displayCandidates ?? []
      ).map((candidate) => ({
        candidateId: candidate.displayCandidateId,
        providers: candidate.labels,
        text: candidate.displayText,
      })),
      singleAsrRiskScore: Math.max(
        0,
        ...item.eventIds.map(
          (eventId) => oldSingleAsrRankByEvent.get(eventId) ?? 0,
        ),
      ),
      crossModelDisagreement: item.itemTypes.includes(
        "TEXT_CROSS_MODEL_DISAGREEMENT",
      ),
      required: item.requiredLevel === "REQUIRED",
    };
  },
);
const quality = evaluateC60112ReviewQuality({
  generatedAt: GENERATED_AT,
  reviewPackageFreezeHash: freeze.semanticHash,
  sourceMediaSha256: sourceSha256Before,
  goldSha256: goldSha256Before,
  oldSingleAsrRiskArtifactSha256,
  baseCues: machinePackage.cues,
  goldCues,
  items: evaluableItems,
  goldEvaluation,
  episodeDurationSeconds: machinePackage.source.durationSeconds,
});
const sourceSha256After = await fileHash(paths.source);
const goldSha256After = await fileHash(paths.gold);
const freezeVerifiedAfterGold = verifyC60112ReviewPackageFreeze({
  freeze,
  packageInput: {
    sourceMediaSha256: sourceSha256After,
    machineDraftHash: await fileHash(paths.machinePackage),
    policy,
    items: itemsArtifact,
    priority: priorityArtifact,
    regions: regionsArtifact,
    candidates: candidatesArtifact,
    audioManifest: audioArtifact,
    workspaceData,
  },
});
await verifyFrozenReviewAudio({
  workspaceDataPath: paths.workspaceData,
  audio: audioArtifact,
});
if (
  sourceSha256After !== sourceSha256Before ||
  goldSha256After !== goldSha256Before ||
  !freezeVerifiedAfterGold
) {
  throw new Error("SOURCE_OR_GOLD_MUTATED_DURING_EVALUATION");
}
const { semanticHash: qualitySemanticHash, ...qualityCore } = quality;
if (!/^[a-f0-9]{64}$/u.test(qualitySemanticHash)) {
  throw new Error(
    "Review quality evaluator returned an invalid semantic hash.",
  );
}
const qualityWithoutHash = {
  ...qualityCore,
  reviewPackageFrozenBeforeGoldRead: true,
  reviewPackageFreezeVerifiedBeforeGoldRead: true,
  machineReviewBuildGoldInputCount: 0,
  evaluatorGoldInputCount: 1,
  goldReadAfterFreeze: true,
  sourceSha256Before,
  sourceSha256After,
  goldSha256Before,
  goldSha256After,
  goldEvaluationArtifactSha256: goldEvaluationPhysicalSha256,
  machineDraftHash,
  containsFullGoldText: false,
};
const fullQuality = c60112ReviewQualityEvaluationSchema.parse({
  ...qualityWithoutHash,
  semanticHash: machineQualitySemanticHash({
    ...qualityWithoutHash,
    generatedAt: undefined,
  }),
});

const r3 = quality.rankingBaselines.find(
  (ranking) => ranking.baseline === "R3_FULL_EVIDENCE_RANK",
);
if (r3 === undefined) throw new Error("R3 ranking evaluation missing.");
const ideal = {
  schemaVersion: "1.0.0",
  policyVersion: "c6.0.1.12-multi-asr-review-assistance-v2",
  artifactType: "c6-0-1-12-ideal-review-upper-bound",
  generatedAt: GENERATED_AT,
  simulationType: "IDEAL_REVIEWER_SIMULATION",
  simulationMethod: "GLOBAL_TEXT_RECOMPUTATION_WITH_SELECTED_GOLD_ALIGNMENTS",
  reviewPackageFreezeHash: freeze.semanticHash,
  qualityEvaluationHash: fullQuality.semanticHash,
  reviewPackageFreezeVerifiedBeforeGoldRead: true,
  evaluatorGoldInputCount: 1,
  budgetResults: r3.budgetMetrics.map((budget) => ({
    budget: budget.budget,
    selectedReviewItems: budget.selectedReviewItemCount,
    selectedRegions: budget.selectedRegionCount,
    audioSeconds: budget.selectedAudioSeconds,
    residualExactCer: budget.residualExactCer,
    residualNormalizedCer: budget.residualNormalizedCer,
    residualMaterialErrors: budget.residualMaterialErrors,
    residualSevereTiming: budget.residualSevereTiming,
    residualMissing: budget.residualMissing,
    residualHallucination: budget.residualHallucination,
  })),
  humanReviewSessionCreated: false,
  humanCorrectionLogCreated: false,
  humanReviewedProductionOutputCreated: false,
  machineFinalMutated: false,
};
const idealArtifact = c60112IdealReviewUpperBoundSchema.parse({
  ...ideal,
  semanticHash: machineQualitySemanticHash({
    ...ideal,
    generatedAt: undefined,
  }),
});

// Replace published evaluation directories only after both artifacts have
// been computed and strict-validated, so stale files cannot survive a rerun.
await rm(paths.output, { recursive: true, force: true });
await rm(paths.idealOutput, { recursive: true, force: true });
await mkdir(paths.output, { recursive: true });
await mkdir(paths.idealOutput, { recursive: true });
await atomicWriteJson(
  path.join(paths.output, "c6-0-1-12-review-quality-evaluation.json"),
  fullQuality,
);
await atomicWriteJson(
  path.join(paths.idealOutput, "c6-0-1-12-ideal-review-upper-bound.json"),
  idealArtifact,
);

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      reviewPackageFreezeHash: freeze.semanticHash,
      sourceSha256Before,
      sourceSha256After,
      goldSha256Before,
      goldSha256After,
      rankings: quality.rankingBaselines.map((ranking) => ({
        id: ranking.baseline,
        top20: ranking.budgetMetrics.find(
          (budget) => budget.budget === "TOP_20_PERCENT",
        ),
        top50: ranking.budgetMetrics.find(
          (budget) => budget.budget === "TOP_50_PERCENT",
        ),
      })),
      candidateFixability: quality.candidateFixabilitySummary,
      humanReviewTimeStatus: "NOT_MEASURED_IN_C6_0_1_12",
      realHumanSessionCreated: false,
    },
    null,
    2,
  )}\n`,
);

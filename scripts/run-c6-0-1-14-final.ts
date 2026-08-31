import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  atomicWriteJson,
  c60114PolicySchema,
  c60114ProbeSelectionSchema,
  c60114PreProbeFreezeSchema,
  c60114ReviewTargetsSchema,
} from "@mvl/shared";
import { machineQualitySemanticHash } from "@mvl/video-subtitler";
import {
  loadC60114Input,
  type C60114InputOptions,
} from "./lib/c60114-input.js";
import { prepareC60114Machine } from "./lib/c60114-prepare-machine.js";
import { allocateC60114Output } from "./lib/c60114-output.js";
import { readC60113Json, c60113FileHash } from "./lib/c60113-acceptance-io.js";
import { freezeC60114Machine } from "./lib/c60114-freeze.js";
import { buildC60114Workspace } from "./lib/c60114-build-workspace.js";
import { replayC60114ExistingProbes } from "../packages/video-subtitler/src/review/c60114-existing-probe-replay.js";
import { relocalizeC60114ExistingProbes } from "../packages/video-subtitler/src/review/c60114-probe-relocalization.js";
import { buildC60114ProbeSelectionV2Shadow } from "../packages/video-subtitler/src/review/c60114-probe-selection-shadow.js";
import { buildC60114CompletionPolicy } from "../packages/video-subtitler/src/review/c60114-completion-policy.js";
import { buildLocalizedMissingLexicalEvidence } from "../packages/video-subtitler/src/review/localized-missing-lexical-evidence.js";
import { buildC60114CoverageProjections } from "./lib/c60114-coverage-projection.js";
import { buildMissingSpeechEvidenceV3 } from "../packages/video-subtitler/src/review/missing-speech-evidence-v3.js";
import {
  buildC60114ReviewItems,
  buildC60114R3EvidenceProjection,
} from "../packages/video-subtitler/src/review/review-items-v4.js";
import { clusterC60114ReviewRegions } from "../packages/video-subtitler/src/review/review-region-clustering-v3.js";

const { values } = parseArgs({
  strict: true,
  options: {
    "run-paths": { type: "string" },
    "fresh-probes": { type: "string" },
    "fresh-cache": { type: "string" },
    stage: { type: "string" },
    "probe-audio-directory": { type: "string", multiple: true },
  },
});
const required = (key: keyof typeof values): string => {
  const value = values[key];
  if (typeof value !== "string" || !value) throw new Error(`Missing --${key}`);
  return value;
};
const stage = required("stage");
if (!["final-a", "final-b", "review-package-v3"].includes(stage))
  throw new Error("C60114_INVALID_FINAL_STAGE");
const paths = (await readC60113Json(required("run-paths"))) as {
  options: C60114InputOptions;
  prefix: string;
  date: string;
  outputs: Record<string, string>;
  policyPath: string;
  selectionPath: string;
  freezePath: string;
};
const policy = c60114PolicySchema.parse(await readC60113Json(paths.policyPath));
const selection = c60114ProbeSelectionSchema.parse(
  await readC60113Json(paths.selectionPath),
);
const preFreeze = c60114PreProbeFreezeSchema.parse(
  await readC60113Json(paths.freezePath),
);
const { semanticHash: preHash, ...preCore } = preFreeze;
if (
  machineQualitySemanticHash(preCore) !== preHash ||
  (await c60113FileHash(paths.policyPath)) !== preFreeze.policyByteHash ||
  (await c60113FileHash(paths.selectionPath)) !== preFreeze.selectionByteHash ||
  policy.semanticHash !== preFreeze.policyHash ||
  selection.semanticHash !== preFreeze.selectionHash
)
  throw new Error("C60114_PRE_PROBE_FREEZE_CHANGED");
const baseline = await loadC60114Input(paths.options);
process.env.MVL_C60114_EXISTING_PROBES_ONLY = "1";
const prepared = prepareC60114Machine(baseline, policy, {
  reconcileLineage: true,
  frozenSelection: selection,
});
process.stderr.write(
  `${JSON.stringify({ checkpoint: "MACHINE_PREPARED_NO_GOLD", stage, summary: prepared.summary, lineage: prepared.lineage?.summary })}\n`,
);
if (
  prepared.selection.semanticHash !== selection.semanticHash ||
  machineQualitySemanticHash(baseline.sourceIdentity) !==
    machineQualitySemanticHash(preFreeze.sourceIdentity)
)
  throw new Error("C60114_INDEPENDENT_REBUILD_SELECTION_MISMATCH");
if (!prepared.summary.sourceAudioBindingVerified || !prepared.lineage)
  throw new Error("C60114_COMPLETION_SOURCE_BINDING_UNVERIFIED");
if (!values["probe-audio-directory"]?.length)
  throw new Error("C60114_EXISTING_PHYSICAL_PROBE_AUDIO_REQUIRED");
const {
  fresh,
  replay: probes,
  receipt,
} = await replayC60114ExistingProbes({
  freshProbePath: required("fresh-probes"),
  cacheDirectory: required("fresh-cache"),
  selection,
  sourceIdentity: baseline.sourceIdentity,
  policy,
  probeAudioDirectories: values["probe-audio-directory"],
});
const output = await allocateC60114Output(
  paths.options.artifactRoot,
  `${paths.prefix}-${stage}-${paths.date}`,
);
if (
  probes.accounting.actualFreshInferences !== 0 ||
  probes.accounting.inferenceAttemptCount !== 0 ||
  probes.accounting.modelLoadCount !== 0 ||
  probes.accounting.cacheHits !== fresh.requests.length ||
  probes.semanticHash !== fresh.semanticHash
)
  throw new Error("C60114_INDEPENDENT_PROBE_REPLAY_FAILED");
const completionPolicy = buildC60114CompletionPolicy();
const relocalization = relocalizeC60114ExistingProbes({
  probes,
  targets: selection.targets,
  policy,
});
const lexical = buildLocalizedMissingLexicalEvidence({
  targets: selection.targets,
  probes,
  relocalization,
  readingUnavailableReason:
    "COMPLETION_EXISTING_EVIDENCE_ONLY_NO_NEW_READING_RUNTIME",
});
const shadow = buildC60114ProbeSelectionV2Shadow({
  sourceIdentity: baseline.sourceIdentity,
  policy,
  speechIslands: prepared.speechIslands,
  orphanSweep: prepared.orphanSweep,
  executedSelection: selection,
  probes,
  relocalization,
  finalCues: baseline.replay.subtitlePackage.cues,
});
const missing = buildMissingSpeechEvidenceV3({
  sourceIdentity: baseline.sourceIdentity,
  policyHash: policy.semanticHash,
  targets: selection.targets,
  lexicalEvidence: lexical,
  speechIslands: prepared.speechIslands,
  orphanSweep: prepared.orphanSweep,
  migratedV2GapIds: baseline.previous.missing.gaps.map((gap) => gap.gapId),
  deprecatedEnvelopeOnlyEvidenceCount: baseline.previous.missing.gaps.length,
});
const buildItems = () =>
  buildC60114ReviewItems({
    sourceIdentity: baseline.sourceIdentity,
    policy,
    previousItems: baseline.previous.items,
    targets: prepared.reviewTargets,
    speechIslands: prepared.speechIslands,
    orphanSweep: prepared.orphanSweep,
    missingEvidenceV3: missing,
  });
const provisional = buildItems();
const requiredItems = new Set(
  provisional.items
    .filter((item) => item.requiredLevel === "REQUIRED")
    .map((item) => item.reviewItemId),
);
const { semanticHash: _targetHash, ...targetCore } = prepared.reviewTargets;
void _targetHash;
targetCore.targets = targetCore.targets.map((target) => {
  const { semanticHash: _hash, ...core } = target;
  void _hash;
  core.mandatoryForAudio = requiredItems.has(target.parentReviewItemId);
  core.audioRequired = true;
  return { ...core, semanticHash: machineQualitySemanticHash(core) };
});
prepared.reviewTargets = c60114ReviewTargetsSchema.parse({
  ...targetCore,
  semanticHash: machineQualitySemanticHash(targetCore),
});
const itemsV4 = buildItems();
const evidenceFamilies = buildC60114R3EvidenceProjection({
  previousEvidenceFamilies: baseline.previous.families,
  targets: prepared.reviewTargets,
  speechIslands: prepared.speechIslands,
  frozenR3Policy: baseline.rebuilt.policy,
});
const regionsV3 = clusterC60114ReviewRegions({
  sourceIdentity: baseline.sourceIdentity,
  policy,
  targets: prepared.reviewTargets,
  items: itemsV4,
  evidenceFamilies,
  frozenR3Policy: baseline.rebuilt.policy,
});
process.stderr.write(
  `${JSON.stringify({ checkpoint: "READ_ONLY_REPLAY_AND_REGIONS_COMPLETE", stage, cacheHits: receipt.cacheHitCount, newInferenceCount: receipt.newInferenceCount, items: itemsV4.summary, regions: regionsV3.summary, output })}\n`,
);
const workspaceRoot = path.join(output, "review-workspace-v3");
await mkdir(workspaceRoot, { recursive: false });
const workspace = await buildC60114Workspace({
  baseline,
  prepared,
  itemsV4,
  regionsV3,
  lexical,
  missing,
  sourcePath: paths.options.source,
  outputDirectory: workspaceRoot,
  generatedAt: preFreeze.frozenAt,
});
const projections = buildC60114CoverageProjections({
  baseline,
  prepared,
  probes,
  lexical,
  missingEvidenceV3: missing,
  items: itemsV4,
  regions: regionsV3,
  audio: workspace.audio.manifest,
  playback: workspace.playback,
  lineage: prepared.lineage,
  relocalization,
});
const subtitleName = path.basename(baseline.finalRootA),
  subtitleRoot = path.join(output, subtitleName);
await mkdir(subtitleRoot, { recursive: false });
const protectedPaths: string[] = [];
for (const entry of baseline.protectedFiles) {
  const relativePath = path.join(subtitleName, entry.relativePath);
  await cp(
    path.join(baseline.finalRootA, entry.relativePath),
    path.join(output, relativePath),
    { force: false, errorOnExist: true },
  );
  if ((await c60113FileHash(path.join(output, relativePath))) !== entry.sha256)
    throw new Error("C60114_CANONICAL_EXPORT_MUTATED");
  protectedPaths.push(relativePath);
}
const artifacts = {
  "c6-0-1-14-policy.json": policy,
  "c6-0-1-14-completion-policy.json": completionPolicy,
  "machine-source-global-lineage-reconciliation.json": prepared.lineage,
  "machine-probe-selection-v2-shadow.json": shadow,
  "machine-missing-dialogue-probe-selection-v2-shadow.json": shadow,
  "machine-existing-probe-relocalization.json": relocalization,
  "existing-probe-replay-receipt.json": receipt,
  "machine-coverage-projections.json": projections,
  "machine-review-target-intervals-v2.json": prepared.reviewTargets,
  "machine-source-global-speech-islands.json": prepared.speechIslands,
  "machine-orphan-speech-sweep.json": prepared.orphanSweep,
  "machine-missing-dialogue-probe-selection.json": selection,
  "machine-missing-dialogue-local-probes.json": probes,
  "machine-localized-missing-lexical-evidence.json": lexical,
  "machine-missing-speech-evidence-v3.json": missing,
  "machine-review-items-v4.json": itemsV4,
  "machine-review-regions-v3.json": regionsV3,
  "machine-review-r3-evidence-projection.json": evidenceFamilies,
  "machine-review-audio-manifest-v3.json": workspace.audio.manifest,
  "machine-review-playback-timeline-v2.json": workspace.playback,
};
for (const [name, value] of Object.entries(artifacts))
  await atomicWriteJson(path.join(output, name), value);
const workspaceArtifacts = [
  "review-data.json",
  "machine-review-items.json",
  "machine-review-priority.json",
  "machine-review-regions.json",
  "machine-review-candidate-bundles.json",
  "machine-review-audio-manifest.json",
  "c6-0-1-12-review-assistance-policy.json",
  "c6-0-1-12-review-package-freeze.json",
];
for (const clip of workspace.audio.manifest.audio)
  protectedPaths.push(path.join("review-workspace-v3", clip.relativePath));
protectedPaths.push(
  ...[
    "index.html",
    "assets/review.js",
    "assets/review.css",
    "subtitle-package.needs-review.json",
  ].map((name) => path.join("review-workspace-v3", name)),
);
await freezeC60114Machine({
  root: output,
  artifactPaths: [
    ...Object.keys(artifacts),
    ...workspaceArtifacts.map((name) => path.join("review-workspace-v3", name)),
  ],
  protectedPaths,
  sourceIdentity: baseline.sourceIdentity,
  policy,
  sourcePath: paths.options.source,
  sourceBefore: baseline.replay.sourceIdentity,
  stage,
});
process.stdout.write(
  `${JSON.stringify(
    {
      stage,
      output,
      sourceIdentity: baseline.sourceIdentity,
      lineage: prepared.lineage.summary,
      items: itemsV4.summary,
      regions: regionsV3.summary,
      audio: workspace.audio.manifest.summary,
      playback: workspace.playback.summary,
      probes: probes.accounting,
      readingMechanism: lexical.readingMechanism,
      semanticHashes: Object.fromEntries(
        Object.entries(artifacts).map(([name, value]) => [
          name,
          value.semanticHash,
        ]),
      ),
    },
    null,
    2,
  )}\n`,
);

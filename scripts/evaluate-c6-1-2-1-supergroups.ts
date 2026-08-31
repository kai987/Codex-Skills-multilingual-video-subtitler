import path from "node:path";
import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import {
  c611FixedBaselineAlignmentMapSchema,
  c6121PolicyFreezeSchema,
  c6121TimingInputSchema,
  c6121FrozenEvaluationSchema,
  c6121RetrainedEvaluationSchema,
  c6121ProfileLabelsSchema,
  c6121RankingsSchema,
  c6121DecisionsSchema,
  c6121ModelsSchema,
  c6121DiagnosticsSchema,
  c6121ReadOnlySchema,
  c6121GoldCountsSchema,
} from "@mvl/shared";
import {
  c612Arguments,
  assertJsonSemanticHash,
  writeArtifact,
} from "../packages/video-subtitler/src/consensus/top-k/c612-delivery-io.js";
import {
  c601CanonicalTextHash,
  c601CanonicalTimingHash,
} from "../packages/video-subtitler/src/blind-acceptance/gold-isolation.js";
import {
  prepareC6121Baseline,
  writeC6121Artifact,
  readC6121Artifact,
  verifyC6121Snapshot,
  fingerprintC6121,
} from "../packages/video-subtitler/src/consensus/evaluation-recovery/baseline-freeze-verification.js";
import {
  C6121_POLICY,
  C6121_POLICY_HASH,
  c6121Artifact,
  demand,
  hash,
} from "../packages/video-subtitler/src/consensus/evaluation-recovery/c6121-policy.js";
import { readC6121GoldTiming } from "../packages/video-subtitler/src/consensus/evaluation-recovery/gold-timing-barrier.js";
import { readC6121GoldText } from "../packages/video-subtitler/src/consensus/evaluation-recovery/gold-text-barrier.js";
import { buildC6121Supergroups } from "../packages/video-subtitler/src/consensus/evaluation-recovery/frozen-group-gold-bipartite-graph.js";
import { freezeC6121Evaluator } from "../packages/video-subtitler/src/consensus/evaluation-recovery/supergroup-freeze.js";
import { c6121TrainingContract } from "../packages/video-subtitler/src/consensus/evaluation-recovery/same-profile-oof-retrainer.js";
import {
  replayC6121E0,
  replayC6121E1Timing,
  diagnosticC6121Map,
} from "../packages/video-subtitler/src/consensus/evaluation-recovery/evaluator-mode-comparison.js";
import {
  rebindC6121CandidateLabels,
  auditC6121LabelStability,
} from "../packages/video-subtitler/src/consensus/evaluation-recovery/c6121-label-rebinding.js";
import { evaluateC6121Profiles } from "../packages/video-subtitler/src/consensus/evaluation-recovery/c6121-profile-evaluation.js";
import {
  c6121Coverage,
  c6121CoverageRecovery,
  compareC6121Modes,
} from "../packages/video-subtitler/src/consensus/evaluation-recovery/supergroup-coverage.js";
import { auditC6121Sensitivity } from "../packages/video-subtitler/src/consensus/evaluation-recovery/evaluator-sensitivity.js";
import {
  diagnoseC6121Completeness,
  decideC6121Route,
} from "../packages/video-subtitler/src/consensus/evaluation-recovery/c6121-route-decision.js";
import { installC6121OfflineGuard } from "../packages/video-subtitler/src/consensus/evaluation-recovery/offline-runtime-guard.js";
import { chars } from "../packages/video-subtitler/src/consensus/top-k/c612-structural.js";
import { normalize } from "../packages/video-subtitler/src/consensus/top-k/fixed-group-evaluation.js";

const keys = [
  "--task-a",
  "--task-b",
  "--output",
  "--gold",
  "--source",
  "--production-a",
  "--production-b",
  "--frozen-repository",
  "--baseline-repository",
  "--baseline-validation",
  "--historical-run",
  "--primary-evaluator",
  "--production-mutation",
  "--network",
];
const arg = c612Arguments(keys, keys),
  guard = installC6121OfflineGuard();
demand(
  arg("--primary-evaluator") === "frozen-machine-group-gold-supergroup" &&
    arg("--production-mutation") === "off",
  "C6121_ONLY_FROZEN_SHADOW_EVALUATION_ALLOWED",
);
const repository = path.resolve(import.meta.dirname, ".."),
  directory = path.resolve(arg("--output"));
for (const root of [
  repository,
  arg("--task-a"),
  arg("--task-b"),
  arg("--production-a"),
  arg("--production-b"),
  arg("--historical-run"),
]) {
  const relative = path.relative(path.resolve(root), directory);
  demand(
    relative.startsWith("..") && !path.isAbsolute(relative),
    "C6121_OUTPUT_MUST_NOT_OVERWRITE_INPUT",
  );
}
await mkdir(directory, { recursive: false });
const paths = {
  taskA: arg("--task-a"),
  taskB: arg("--task-b"),
  frozenRepository: arg("--frozen-repository"),
  baselineRepository: arg("--baseline-repository"),
  baselineValidation: arg("--baseline-validation"),
  historicalRun: arg("--historical-run"),
  productionDirectories: [arg("--production-a"), arg("--production-b")],
  source: arg("--source"),
};
process.stdout.write(
  "Stage A: verify frozen C6.1.2 machine and reranking artifacts; Gold path is not passed to this stage.\n",
);
const prepared = await prepareC6121Baseline(paths),
  frozen = prepared.frozen;
await writeC6121Artifact(directory, prepared.baseline);
await writeC6121Artifact(
  directory,
  await c6121TrainingContract(frozen, repository, paths.baselineRepository),
);
await writeC6121Artifact(
  directory,
  c6121PolicyFreezeSchema.parse(
    c6121Artifact("c6-1-2-1-policy-freeze", {
      serializedDefinition: JSON.stringify(C6121_POLICY),
      definitionHash: C6121_POLICY_HASH,
      primaryEvaluator: C6121_POLICY.primaryEvaluator,
      frozenBeforeGoldText: true,
    }),
  ),
);
process.stdout.write(
  "Stage B: ASS timing-prefix-only reader, historical E1 and frozen E2 bipartite graph.\n",
);
const timing = await readC6121GoldTiming(prepared.baseline, arg("--gold"));
demand(
  timing.barrier.goldByteHash === prepared.oldBindings.goldIdentityHash,
  "C6121_GOLD_IDENTITY_NOT_BASELINE",
);
await writeC6121Artifact(directory, timing.barrier);
await writeC6121Artifact(
  directory,
  c6121TimingInputSchema.parse(
    c6121Artifact("gold-c6-1-2-1-timing-only-input", {
      timingBarrierHash: timing.barrier.semanticHash,
      rows: timing.timing,
      rawGoldTextIncluded: false,
    }),
  ),
);
const historical = c611FixedBaselineAlignmentMapSchema.parse(
  await assertJsonSemanticHash(
    path.join(
      paths.historicalRun,
      "evaluation/c6-1-1-fixed-baseline-alignment-map.json",
    ),
  ),
);
const e1 = replayC6121E1Timing(frozen, timing.timing, historical);
await writeC6121Artifact(directory, e1);
const graph = buildC6121Supergroups({
  groups: frozen.mapping.groups,
  mappingHash: frozen.mapping.semanticHash,
  baselineCueOrder: frozen.production.cues.map((c) => c.id),
  production: frozen.production,
  universe: frozen.universe,
  folds: frozen.folds,
  goldTiming: timing.timing,
});
for (const artifact of Object.values(graph))
  await writeC6121Artifact(directory, artifact);
await writeC6121Artifact(
  directory,
  await freezeC6121Evaluator(
    directory,
    prepared.baseline,
    graph.map,
    timing.barrier.semanticHash,
  ),
);
process.stdout.write(
  JSON.stringify({
    stage: "supergroup-frozen-before-Gold-text",
    groups: graph.map.groups.length,
    shadowEligible: graph.integrity.stableShadowEvaluationCount,
    crossFold: graph.integrity.crossFoldComponentCount,
    mapHash: graph.map.semanticHash,
  }) + "\n",
);
const text = await readC6121GoldText({
  directory,
  gold: arg("--gold"),
  baseline: prepared.baseline,
  map: graph.map,
});
await writeC6121Artifact(directory, text.barrier);
process.stdout.write(
  "Stage C: exact E0 replay and E2 numeric label rebinding after the persisted map freeze.\n",
);
const e0 = await replayC6121E0(
  prepared,
  paths.taskA,
  text.legacyGoldOrder,
  text.barrier.goldByteHash,
);
await writeC6121Artifact(directory, e0.artifact);
for (const artifact of [
  ...Object.values(e0.quality),
  e0.retrieval,
  e0.labels.groupLabels,
  e0.labels.labels,
])
  await writeArtifact(path.join(directory, "replay-e0"), artifact);
const labels = rebindC6121CandidateLabels(
  frozen,
  graph.map,
  text.gold,
  text.barrier.goldByteHash,
);
await writeC6121Artifact(directory, labels);
await writeC6121Artifact(
  directory,
  auditC6121LabelStability(prepared.oldLabels.labels, labels),
);
// A new process receives machine paths and strict numeric labels, never the
// Gold path, Gold bytes, scoring callbacks, or parent process memory.
await new Promise<void>((resolve, reject) => {
  const child = spawn(
    process.execPath,
    [
      path.join(repository, "node_modules/tsx/dist/cli.mjs"),
      "--tsconfig",
      path.join(repository, "tsconfig.base.json"),
      path.join(repository, "scripts/train-c6-1-2-1-oof.ts"),
      "--run",
      directory,
      "--task-a",
      paths.taskA,
      "--frozen-repository",
      paths.frozenRepository,
      "--baseline-repository",
      paths.baselineRepository,
      "--network",
      "off",
    ],
    {
      cwd: repository,
      env: { ...process.env, HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.on("data", (b: Buffer) => process.stdout.write(b));
  child.stderr.on("data", (b: Buffer) => process.stderr.write(b));
  child.on("error", reject);
  child.on("close", (code) =>
    code === 0
      ? resolve()
      : reject(new Error("C6121_NUMERIC_ONLY_TRAINER_FAILED:" + String(code))),
  );
});
const rankings = c6121RankingsSchema.parse(
  await readC6121Artifact(
    path.join(directory, "c6-1-2-1-oof-retrain-rankings.json"),
  ),
);
const decisions = c6121DecisionsSchema.parse(
  await readC6121Artifact(
    path.join(directory, "c6-1-2-1-oof-retrain-decisions.json"),
  ),
);
const models = c6121ModelsSchema.parse(
  await readC6121Artifact(
    path.join(directory, "c6-1-2-1-oof-retrain-models.json"),
  ),
);
const frozenMetrics = evaluateC6121Profiles({
  frozen,
  map: graph.map,
  gold: text.gold,
  labels: labels.labels.map((l) => l.label),
  rankings: prepared.rankings.rows,
  decisions: prepared.decisions.rows,
  track: "FROZEN_DECISION_REEVALUATION",
});
const retrainedMetrics = evaluateC6121Profiles({
  frozen,
  map: graph.map,
  gold: text.gold,
  labels: labels.labels.map((l) => l.label),
  rankings: rankings.rows,
  decisions: decisions.rows,
  track: "SAME_FEATURE_SAME_PROFILE_OOF_RETRAIN",
});
for (const artifact of [
  c6121FrozenEvaluationSchema.parse(
    c6121Artifact("c6-1-2-1-frozen-decision-reevaluation", {
      supergroupMapHash: graph.map.semanticHash,
      profiles: frozenMetrics,
    }),
  ),
  c6121RetrainedEvaluationSchema.parse(
    c6121Artifact("c6-1-2-1-oof-retrain-profile-evaluation", {
      supergroupMapHash: graph.map.semanticHash,
      profiles: retrainedMetrics,
    }),
  ),
  c6121ProfileLabelsSchema.parse(
    c6121Artifact("gold-c6-1-2-1-supergroup-profile-labels", {
      supergroupMapHash: graph.map.semanticHash,
      profiles: [...frozenMetrics, ...retrainedMetrics],
    }),
  ),
])
  await writeC6121Artifact(directory, artifact);
const e0Map = diagnosticC6121Map(frozen, timing.timing, {
  kind: "E0",
  bindings: e0.labels.groupLabels.rows,
});
const e1Map = diagnosticC6121Map(frozen, timing.timing, {
  kind: "E1",
  map: e1.timingOnlyMap,
});
const e1Labels = rebindC6121CandidateLabels(
  frozen,
  e1Map,
  text.gold,
  text.barrier.goldByteHash,
);
const diagnosticMetrics = [
  evaluateC6121Profiles({
    frozen,
    map: e0Map,
    gold: text.gold,
    labels: prepared.oldLabels.labels,
    rankings: prepared.rankings.rows,
    decisions: prepared.decisions.rows,
    track: "FROZEN_DECISION_REEVALUATION",
  }),
  evaluateC6121Profiles({
    frozen,
    map: e1Map,
    gold: text.gold,
    labels: e1Labels.labels.map((l) => l.label),
    rankings: prepared.rankings.rows,
    decisions: prepared.decisions.rows,
    track: "FROZEN_DECISION_REEVALUATION",
  }),
] as const;
await writeC6121Artifact(
  directory,
  c6121DiagnosticsSchema.parse(
    c6121Artifact("c6-1-2-1-diagnostic-mode-metrics", {
      e0: diagnosticMetrics[0],
      e1: diagnosticMetrics[1],
      e1CandidateLabels: e1Labels.labels,
      primaryEvaluatorChanged: false,
    }),
  ),
);
const characterCounts = c6121GoldCountsSchema.parse(
  c6121Artifact("gold-c6-1-2-1-evaluation-character-counts", {
    supergroupMapHash: graph.map.semanticHash,
    goldByteHash: text.barrier.goldByteHash,
    rows: text.gold.map((c) => ({
      goldCueId: c.id,
      exactGraphemes: chars(c.text.normalize("NFC")).length,
      normalizedGraphemes: chars(normalize(c.text)).length,
    })),
    rawGoldTextIncluded: false,
    groupingInput: false,
  }),
);
await writeC6121Artifact(directory, characterCounts);
const goldCharacters = new Map(
  characterCounts.rows.map((c) => [c.goldCueId, c.normalizedGraphemes]),
);
const coverage = c6121Coverage(
  frozen,
  graph.map,
  timing.timing,
  labels.labels.map((l) => l.label),
  goldCharacters,
);
await writeC6121Artifact(
  directory,
  c6121CoverageRecovery(
    frozen,
    graph.map,
    coverage,
    e0.labels.groupLabels.rows,
  ),
);
await writeC6121Artifact(
  directory,
  compareC6121Modes({
    frozen,
    gold: timing.timing,
    goldCharacters,
    maps: [e0Map, e1Map, graph.map],
    labels: [
      prepared.oldLabels.labels,
      e1Labels.labels.map((l) => l.label),
      labels.labels.map((l) => l.label),
    ],
    metrics: [...diagnosticMetrics, frozenMetrics],
  }),
);
await writeC6121Artifact(
  directory,
  auditC6121Sensitivity(graph.map, [...diagnosticMetrics, frozenMetrics]),
);
const initialDiagnosis = diagnoseC6121Completeness(
  frozen,
  labels,
  rankings.rows,
  retrainedMetrics,
  false,
);
const preliminary = decideC6121Route({
  engineering: false,
  aBParity: false,
  productionMutation: 0,
  coverage,
  integrity: graph.integrity,
  frozen: frozenMetrics,
  retrained: retrainedMetrics,
  completeness: initialDiagnosis,
});
await writeC6121Artifact(
  directory,
  diagnoseC6121Completeness(
    frozen,
    labels,
    rankings.rows,
    retrainedMetrics,
    preliminary.evaluationCoverageGate,
  ),
);
const after = await verifyC6121Snapshot(prepared.baseline);
const goldBefore = {
  role: "gold-evaluation-only",
  path: path.resolve(arg("--gold")),
  bytes: timing.barrier.goldBytes,
  sha256: timing.barrier.goldByteHash,
  semanticHash: null,
  mtimeMs: timing.barrier.goldMtimeMs,
  inode: timing.barrier.goldInode,
};
const goldAfter = await fingerprintC6121(arg("--gold"), "gold-evaluation-only");
const sourceAfter = await fingerprintC6121(paths.source, "source-video");
demand(
  hash(goldBefore) === hash(goldAfter) &&
    hash(prepared.source) === hash(sourceAfter),
  "C6121_GOLD_OR_SOURCE_MUTATED",
);
demand(
  c601CanonicalTextHash(frozen.production.cues) ===
    frozen.freeze.productionTextHash &&
    c601CanonicalTimingHash(frozen.production.cues) ===
      frozen.freeze.productionTimingHash,
  "C6121_PRODUCTION_MUTATION",
);
demand(guard().attemptedNetworkRequests === 0, "C6121_NETWORK_ATTEMPT");
await writeC6121Artifact(
  directory,
  c6121ReadOnlySchema.parse(
    c6121Artifact("c6-1-2-1-read-only-proof", {
      baselineFreezeHash: prepared.baseline.semanticHash,
      inputAggregateHashBefore: prepared.baseline.inputAggregateHash,
      inputAggregateHashAfter: after,
      sourceBefore: prepared.source,
      sourceAfter,
      goldBefore,
      goldAfter,
      machineRuntimeRawGoldInputCount: 0,
      predictionStageRawGoldInputCount: 0,
      goldTimingEvaluatorInputCount: timing.timing.length,
      goldTextScoringInputCount: text.gold.length,
      trainingNumericLabelCount: models.trainingNumericLabelCount,
      outerTestLabelInputToPredictionCount: 0,
      modelExecutionCount: 0,
      networkDuringResearch: false,
      productionMutation: 0,
      passed: true,
    }),
  ),
);
process.stdout.write(
  JSON.stringify({
    stage: "independent-replay-complete-awaiting-A-B-and-QA-validation",
    supergroupMapHash: graph.map.semanticHash,
    coverage,
    frozenProfiles: frozenMetrics.map((p) => [
      p.profileId,
      p.normalizedJointGain,
      p.unknown,
    ]),
    retrainedProfiles: retrainedMetrics.map((p) => [
      p.profileId,
      p.normalizedJointGain,
      p.unknown,
    ]),
    acousticModelExecutionCount: 0,
  }) + "\n",
);

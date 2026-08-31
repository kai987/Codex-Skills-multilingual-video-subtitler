import path from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import * as s from "@mvl/shared";
import {
  c612Arguments,
  assertJsonSemanticHash,
} from "../packages/video-subtitler/src/consensus/top-k/c612-delivery-io.js";
import { installC6121OfflineGuard } from "../packages/video-subtitler/src/consensus/evaluation-recovery/offline-runtime-guard.js";
import { fingerprintC6121 } from "../packages/video-subtitler/src/consensus/evaluation-recovery/baseline-freeze-verification.js";
import { prepareC61211Baseline } from "../packages/video-subtitler/src/consensus/evaluation-partition/baseline-freeze.js";
import {
  readC61211,
  writeC61211,
  snapshotC61211,
} from "../packages/video-subtitler/src/consensus/evaluation-partition/artifact-io.js";
import {
  C61211_POLICY,
  C61211_POLICY_HASH,
  C61211_PARTITION_POLICY,
  C61211_COVERAGE_POLICY,
  C61211_ROUTE_POLICY,
  c61211Artifact,
  demand,
  hash,
} from "../packages/video-subtitler/src/consensus/evaluation-partition/c61211-policy.js";
import {
  timingC61211,
  freezeC61211,
  scoringC61211Gold,
} from "../packages/video-subtitler/src/consensus/evaluation-partition/gold-barriers.js";
import {
  candidateC61211Scope,
  reachableC61211Scope,
  coverageC61211,
  coverageC61211Gate,
} from "../packages/video-subtitler/src/consensus/evaluation-partition/reachable-coverage.js";
import { partitionC61211 } from "../packages/video-subtitler/src/consensus/evaluation-partition/monotonic-partition-solver.js";
import {
  auditC61211Cuts,
  auditC61211Conservation,
  auditC61211Residuals,
} from "../packages/video-subtitler/src/consensus/evaluation-partition/partition-audits.js";
import {
  rebindC61211Labels,
  stabilityC61211,
} from "../packages/video-subtitler/src/consensus/evaluation-partition/partition-label-rebinding.js";
import {
  trainingC61211Contract,
  writeC61211Shadows,
} from "../packages/video-subtitler/src/consensus/evaluation-partition/same-feature-oof-retrainer.js";
import {
  evaluateC61211Profiles,
  evidenceC61211Profiles,
} from "../packages/video-subtitler/src/consensus/evaluation-partition/partition-profile-evaluation.js";
import {
  wholeC61211,
  biasC61211,
  sensitivityC61211,
  attributionC61211,
} from "../packages/video-subtitler/src/consensus/evaluation-partition/whole-component-diagnostic.js";
import { completenessC61211 } from "../packages/video-subtitler/src/consensus/evaluation-partition/terminal-route.js";
import { chars } from "../packages/video-subtitler/src/consensus/top-k/c612-structural.js";
import { normalize } from "../packages/video-subtitler/src/consensus/top-k/fixed-group-evaluation.js";

const keys = [
  "--baseline",
  "--baseline-peer",
  "--baseline-validation",
  "--baseline-repository",
  "--frozen-repository",
  "--training-baseline-repository",
  "--output",
  "--primary-partition",
  "--network",
  "--model-inference",
  "--production-mutation",
];
const arg = c612Arguments(keys, keys),
  guard = installC6121OfflineGuard();
demand(
  arg("--primary-partition") === "conservative-monotonic" &&
    arg("--model-inference") === "off" &&
    arg("--production-mutation") === "off",
  "C61211_ONLY_OFFLINE_PRIMARY_EVALUATION_ALLOWED",
);
const repository = path.resolve(import.meta.dirname, ".."),
  directory = path.resolve(arg("--output"));
for (const root of [
  repository,
  arg("--baseline"),
  arg("--baseline-peer"),
  arg("--baseline-validation"),
]) {
  const relative = path.relative(path.resolve(root), directory);
  demand(
    relative.startsWith("..") && !path.isAbsolute(relative),
    "C61211_OUTPUT_OVERWRITES_INPUT",
  );
}
await mkdir(directory, { recursive: false });
const paths = {
  baseline: arg("--baseline"),
  baselinePeer: arg("--baseline-peer"),
  baselineValidation: arg("--baseline-validation"),
  baselineRepository: arg("--baseline-repository"),
  frozenRepository: arg("--frozen-repository"),
  trainingBaselineRepository: arg("--training-baseline-repository"),
  repository,
};
process.stdout.write(
  "MACHINE FREEZE: exact E0/E1/E2 and OOF baseline replay, no Gold dialogue read.\n",
);
const prepared = await prepareC61211Baseline(paths, (message) =>
    process.stdout.write("baseline " + message + "\n"),
  ),
  frozen = prepared.frozen;
await writeC61211(directory, prepared.baseline);
const contract = await trainingC61211Contract(
  frozen,
  repository,
  paths.trainingBaselineRepository,
);
await writeC61211(directory, contract);
await writeC61211(
  directory,
  s.c61211PolicySchema.parse(
    c61211Artifact("c6-1-2-1-1-policy-freeze", {
      serializedDefinition: JSON.stringify(C61211_POLICY),
      definitionHash: C61211_POLICY_HASH,
      partitionPolicyHash: hash(C61211_PARTITION_POLICY),
      coveragePolicyHash: hash(C61211_COVERAGE_POLICY),
      routePolicyHash: hash(C61211_ROUTE_POLICY),
      frozenBeforeGoldText: true,
      primaryEvaluator: C61211_POLICY.primaryEvaluator,
    }),
  ),
);
process.stdout.write(
  "GOLD TIMING ONLY: exact constrained monotone D0/D1/D2 partitions.\n",
);
const goldPath = prepared.readOnly.goldBefore.path,
  timing = await timingC61211(prepared.baseline, goldPath);
demand(
  timing.goldByteHash === prepared.readOnly.goldBefore.sha256,
  "C61211_GOLD_NOT_ACCEPTED_BASELINE",
);
await writeC61211(directory, timing);
const input = {
  groups: frozen.mapping.groups,
  mappingHash: frozen.mapping.semanticHash,
  baselineCueOrder: frozen.production.cues.map((c) => c.id),
  production: frozen.production,
  universe: frozen.universe,
  folds: frozen.folds,
  goldTiming: timing.rows,
  candidateReachableMachineGroupIds:
    candidateC61211Scope(frozen).candidateReachableMachineGroupIds,
};
const d0 = partitionC61211(input, "D0_NO_CUT"),
  d1 = partitionC61211(input),
  d2 = partitionC61211(input, "D2_RELAXED_DIAGNOSTIC_ONLY");
await writeC61211(directory, d1.inventory);
const scope = reachableC61211Scope(frozen, d1.graph);
await writeC61211(directory, scope);
for (const [subdirectory, result] of [
  ["d0", d0],
  ["", d1],
  ["d2", d2],
] as const) {
  const location = path.join(directory, subdirectory);
  for (const artifact of [
    result.candidates,
    result.map,
    auditC61211Cuts(result.map, result.graph),
    auditC61211Residuals(result.map, subdirectory === "d2" ? null : d2.map),
    auditC61211Conservation(input, result.map, result.graph),
  ])
    await writeC61211(location, artifact);
}
const primaryIntegrity = auditC61211Conservation(input, d1.map, d1.graph),
  cuts = auditC61211Cuts(d1.map, d1.graph);
demand(primaryIntegrity.passed, "C61211_PRIMARY_PARTITION_INTEGRITY_FAILED");
// Freeze the complete structural gate before dialogue decoding. Gold character
// coverage is still null and is added only to the post-freeze diagnostic copy.
const preTextCoverage = coverageC61211(frozen, d1.map, scope, timing.rows);
await writeC61211(path.join(directory, "pre-text"), preTextCoverage);
await writeC61211(
  path.join(directory, "pre-text"),
  coverageC61211Gate(preTextCoverage, primaryIntegrity),
);
const freeze = await freezeC61211(directory, prepared.baseline, timing, d1.map);
await writeC61211(directory, freeze);
process.stdout.write(
  JSON.stringify({
    stage: "PARTITION MAP FROZEN BEFORE TEXT",
    mapHash: d1.map.semanticHash,
    evaluationBlocks: d1.map.blocks.filter((b) => b.shadowEvaluationEligible)
      .length,
    cuts: cuts.rows.length,
  }) + "\n",
);
const text = await scoringC61211Gold({
  directory,
  gold: goldPath,
  baseline: prepared.baseline,
  map: d1.map,
});
await writeC61211(directory, text.barrier);
const labels = rebindC61211Labels(
    frozen,
    d1.map,
    text.gold,
    timing.goldByteHash,
  ),
  stability = stabilityC61211(prepared.oldLabels, labels);
await writeC61211(directory, labels);
await writeC61211(directory, stability);
// Separate process gets only machine paths, a frozen map, and numeric labels.
await new Promise<void>((resolve, reject) => {
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      path.join(repository, "scripts/train-c6-1-2-1-1-oof.ts"),
      "--run",
      directory,
      "--task",
      prepared.taskA,
      "--frozen-repository",
      paths.frozenRepository,
      "--training-baseline-repository",
      paths.trainingBaselineRepository,
      "--network",
      "off",
    ],
    {
      cwd: repository,
      env: {
        ...process.env,
        TSX_TSCONFIG_PATH: path.join(repository, "tsconfig.base.json"),
        HF_HUB_OFFLINE: "1",
        TRANSFORMERS_OFFLINE: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.on("data", (b: Buffer) => process.stdout.write(b));
  child.stderr.on("data", (b: Buffer) => process.stderr.write(b));
  child.on("error", reject);
  child.on("close", (code) =>
    code === 0
      ? resolve()
      : reject(new Error("C61211_NUMERIC_ONLY_TRAINER_FAILED:" + String(code))),
  );
});
const originalRankings = s.c612RankingsSchema.parse(
  await assertJsonSemanticHash(
    path.join(prepared.taskA, "reranking/c6-1-2-oof-candidate-rankings.json"),
  ),
);
const originalDecisions = s.c612GroupDecisionsSchema.parse(
  await assertJsonSemanticHash(
    path.join(prepared.taskA, "reranking/c6-1-2-oof-group-decisions.json"),
  ),
);
const rankings = s.c61211RankingsSchema.parse(
  await readC61211(path.join(directory, "c6-1-2-1-1-oof-rankings.json")),
);
const decisions = s.c61211DecisionsSchema.parse(
  await readC61211(path.join(directory, "c6-1-2-1-1-oof-decisions.json")),
);
const models = s.c61211ModelsSchema.parse(
  await readC61211(path.join(directory, "c6-1-2-1-1-oof-retrain-models.json")),
);
const common = {
  frozen,
  map: d1.map,
  gold: text.gold,
  labels: labels.labels.map((l) => l.label),
};
const frozenProfiles = evaluateC61211Profiles({
  ...common,
  rankings: originalRankings.rows,
  decisions: originalDecisions.rows,
  track: "FROZEN_DECISION_REEVALUATION",
});
const retrainedProfiles = evaluateC61211Profiles({
  ...common,
  rankings: rankings.rows,
  decisions: decisions.rows,
  track: "SAME_FEATURE_SAME_PROFILE_OOF_RETRAIN",
});
for (const [name, profiles] of [
  ["c6-1-2-1-1-frozen-decision-reevaluation", frozenProfiles],
  ["c6-1-2-1-1-oof-profile-evaluation", retrainedProfiles],
  [
    "gold-c6-1-2-1-1-partition-profile-labels",
    [...frozenProfiles, ...retrainedProfiles],
  ],
] as const) {
  await writeC61211(
    directory,
    c61211Artifact(name, {
      partitionMapHash: d1.map.semanticHash,
      scoringAdapterHash: labels.scoringAdapterHash,
      profiles,
    }),
  );
}
await writeC61211(
  directory,
  evidenceC61211Profiles(d1.map, [...frozenProfiles, ...retrainedProfiles]),
);
await writeC61211(
  directory,
  await writeC61211Shadows(directory, frozen, d1.map, [
    {
      track: "FROZEN_DECISION_REEVALUATION",
      decisions: originalDecisions.rows,
      frozenTask: prepared.taskA,
    },
    {
      track: "SAME_FEATURE_SAME_PROFILE_OOF_RETRAIN",
      decisions: decisions.rows,
    },
  ]),
);
const goldCharacters = new Map(
  text.gold.map((g) => [g.id, chars(normalize(g.text)).length]),
);
for (const [subdirectory, result] of [
  ["d0", d0],
  ["", d1],
  ["d2", d2],
] as const)
  await writeC61211(
    path.join(directory, subdirectory),
    coverageC61211(
      frozen,
      result.map,
      scope,
      timing.rows,
      subdirectory ? null : labels.labels.map((l) => l.label),
      goldCharacters,
    ),
  );
const coverage = s.c61211CoverageSchema.parse(
  await readC61211(
    path.join(directory, "c6-1-2-1-1-reachable-coverage-audit.json"),
  ),
);
const gate = coverageC61211Gate(coverage, primaryIntegrity);
await writeC61211(directory, gate);
const whole = wholeC61211({
  frozen,
  graph: d1.graph,
  map: d1.map,
  gold: text.gold,
  tracks: [
    { profiles: frozenProfiles, decisions: originalDecisions.rows },
    { profiles: retrainedProfiles, decisions: decisions.rows },
  ],
});
for (const artifact of [
  whole,
  biasC61211(d1.map, whole, primaryIntegrity, cuts, stability),
  sensitivityC61211(
    {
      e0: prepared.diagnostics.e0,
      e1: prepared.diagnostics.e1,
      e2: prepared.frozenMetrics,
    },
    [...frozenProfiles, ...retrainedProfiles],
    whole,
    prepared.modeComparison,
    coverage,
    scope,
    d1.map,
  ),
  attributionC61211(d1.graph, d1.map, stability, cuts),
  completenessC61211(
    frozen,
    labels,
    rankings.rows,
    retrainedProfiles,
    gate.passed,
  ),
])
  await writeC61211(directory, artifact);
const inputAfter = await snapshotC61211(prepared.baseline),
  sourceAfter = await fingerprintC6121(
    prepared.readOnly.sourceBefore.path,
    "source-video",
  ),
  goldAfter = await fingerprintC6121(goldPath, "gold-evaluation-only");
demand(
  hash(sourceAfter) === hash(prepared.readOnly.sourceBefore) &&
    hash(goldAfter) === hash(timing.goldFile),
  "C61211_SOURCE_OR_GOLD_MUTATED",
);
demand(
  guard().attemptedNetworkRequests === 0,
  "C61211_RESEARCH_NETWORK_ATTEMPT",
);
await writeC61211(
  directory,
  s.c61211ReadOnlySchema.parse(
    c61211Artifact("c6-1-2-1-1-read-only-proof", {
      baselineFreezeHash: prepared.baseline.semanticHash,
      inputAggregateHashBefore: prepared.baseline.inputAggregateHash,
      inputAggregateHashAfter: inputAfter,
      sourceBefore: prepared.readOnly.sourceBefore,
      sourceAfter,
      goldBefore: timing.goldFile,
      goldAfter,
      machineRuntimeRawGoldInputCount: 0,
      predictionStageRawGoldInputCount: 0,
      goldTimingEvaluatorInputCount: timing.rows.length,
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
// Reading this small, strict artifact ensures a complete, nonempty run before success.
await readFile(path.join(directory, "c6-1-2-1-1-read-only-proof.json"));
process.stdout.write(
  JSON.stringify({
    stage: "INDEPENDENT_RUN_COMPLETE_AWAITING_AB_AND_QA",
    output: directory,
    coverage: coverage.coverage,
    frozen: frozenProfiles.map((p) => [
      p.profileId,
      p.normalizedJointGain,
      p.unknown,
    ]),
    retrained: retrainedProfiles.map((p) => [
      p.profileId,
      p.normalizedJointGain,
      p.unknown,
    ]),
  }) + "\n",
);

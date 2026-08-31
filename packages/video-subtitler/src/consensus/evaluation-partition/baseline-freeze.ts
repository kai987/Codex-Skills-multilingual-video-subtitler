import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  c61211BaselineSchema,
  c6121ReadOnlySchema,
  c6121BaselineSchema,
  c6121FrozenEvaluationSchema,
  c6121DiagnosticsSchema,
  c6121E0Schema,
  c6121E1Schema,
  c6121ModeComparisonSchema,
  c6121ValidationSchema,
} from "@mvl/shared";
import { validateC6121Run } from "../evaluation-recovery/c6121-artifact-validator.js";
import { c6121QaSourceSnapshot } from "../evaluation-recovery/qa-source-snapshot.js";
import { readC6121Artifact } from "../evaluation-recovery/baseline-freeze-verification.js";
import { c612Defined } from "../top-k/c612-policy.js";
import { c61211Artifact, hash, demand } from "./c61211-policy.js";
import { c61211Files, fingerprintsC61211 } from "./artifact-io.js";
export interface C61211Paths {
  baseline: string;
  baselinePeer: string;
  baselineValidation: string;
  baselineRepository: string;
  frozenRepository: string;
  trainingBaselineRepository: string;
  repository: string;
}
export async function prepareC61211Baseline(
  paths: C61211Paths,
  progress?: (message: string) => void,
) {
  const baseCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: paths.baselineRepository,
    encoding: "utf8",
  }).trim();
  demand(
    baseCommit === "43e3693288a73701a3ca9a5438b6aba5b2e2f43a",
    "C61211_BASELINE_COMMIT_NOT_ACCEPTED",
  );
  const a = await validateC6121Run(
    paths.baseline,
    paths.baselineRepository,
    paths.frozenRepository,
    paths.trainingBaselineRepository,
    progress,
  );
  const b = await validateC6121Run(
    paths.baselinePeer,
    paths.baselineRepository,
    paths.frozenRepository,
    paths.trainingBaselineRepository,
    progress,
  );
  demand(
    hash([a.map, a.labels, a.frozenMetrics, a.retrainedMetrics, a.coverage]) ===
      hash([b.map, b.labels, b.frozenMetrics, b.retrainedMetrics, b.coverage]),
    "C61211_BASELINE_AB_DRIFT",
  );
  const original = c6121BaselineSchema.parse(
    await readC6121Artifact(
      path.join(paths.baseline, "c6-1-2-1-baseline-freeze-verification.json"),
    ),
  );
  const frozenEvaluation = c6121FrozenEvaluationSchema.parse(
    await readC6121Artifact(
      path.join(paths.baseline, "c6-1-2-1-frozen-decision-reevaluation.json"),
    ),
  );
  const diagnostics = c6121DiagnosticsSchema.parse(
    await readC6121Artifact(
      path.join(paths.baseline, "c6-1-2-1-diagnostic-mode-metrics.json"),
    ),
  );
  const e0 = c6121E0Schema.parse(
    await readC6121Artifact(
      path.join(paths.baseline, "c6-1-2-1-e0-legacy-replay.json"),
    ),
  );
  const e1 = c6121E1Schema.parse(
    await readC6121Artifact(
      path.join(paths.baseline, "c6-1-2-1-e1-historical-bipartite-replay.json"),
    ),
  );
  // This artifact contains fingerprints, never Gold dialogue bytes.
  const readOnly = c6121ReadOnlySchema.parse(
    await readC6121Artifact(
      path.join(paths.baseline, "c6-1-2-1-read-only-proof.json"),
    ),
  );
  const source = await c6121QaSourceSnapshot(paths.repository);
  const acceptancePaths = (await c61211Files(paths.baselineValidation)).filter(
    (p) => p.endsWith("c6-1-2-1-validation.json"),
  );
  demand(
    acceptancePaths.length > 0,
    "C61211_ACCEPTED_BASELINE_VALIDATION_MISSING",
  );
  for (const relative of acceptancePaths) {
    const acceptance = c6121ValidationSchema.parse(
      await readC6121Artifact(path.join(paths.baselineValidation, relative)),
    );
    demand(
      acceptance.passed &&
        acceptance.aBSemanticParity &&
        acceptance.aBByteParity &&
        acceptance.productionParity,
      "C61211_BASELINE_ACCEPTANCE_FAILED",
    );
  }
  const modeComparison = c6121ModeComparisonSchema.parse(
    await readC6121Artifact(
      path.join(paths.baseline, "c6-1-2-1-evaluation-mode-comparison.json"),
    ),
  );
  const fileInputs = [
    ...original.files.map((f) => ({ role: f.role, path: f.path })),
    ...source.rows.map((f) => ({
      role: "new-runtime-source/" + f.relativePath,
      path: path.join(paths.repository, f.relativePath),
    })),
  ];
  for (const [role, directory] of [
    ["baseline-a", paths.baseline],
    ["baseline-b", paths.baselinePeer],
    ["baseline-validation", paths.baselineValidation],
  ] as const) {
    for (const relative of await c61211Files(directory))
      fileInputs.push({
        role: role + "/" + relative,
        path: path.join(directory, relative),
      });
  }
  const files = await fingerprintsC61211(fileInputs);
  const productionFiles = files
    .filter((f) => f.role.startsWith("production-0/"))
    .map((f) => ({
      role: f.role.slice("production-0/".length),
      sha256: f.sha256,
    }));
  demand(
    productionFiles.some((f) => f.role.endsWith(".ass")) &&
      productionFiles.some((f) => f.role.endsWith(".srt")) &&
      productionFiles.some((f) => f.role.endsWith(".vtt")),
    "C61211_PRODUCTION_PRESENTATION_MISSING",
  );
  const checks = [
    ...a.checks.map((c) => ({ ...c, name: "baseline-a/" + c.name })),
    ...b.checks.map((c) => ({ ...c, name: "baseline-b/" + c.name })),
    {
      name: "accepted-baseline-commit",
      passed: true,
      observed: baseCommit,
      expected: "43e3693288a73701a3ca9a5438b6aba5b2e2f43a",
    },
    {
      name: "baseline-A-B-semantic-parity",
      passed: true,
      observed: a.map.semanticHash,
      expected: b.map.semanticHash,
    },
  ];
  const baseline = c61211BaselineSchema.parse(
    c61211Artifact("c6-1-2-1-1-baseline-freeze-verification", {
      machineFrozenAt: new Date().toISOString(),
      baselineCommit: baseCommit,
      baselinePolicyHash: original.policyHash,
      baselineAHash: a.baseline.semanticHash,
      baselineBHash: b.baseline.semanticHash,
      originalMachineFreezeHash: a.frozen.freeze.semanticHash,
      originalRerankingFreezeHash: c612Defined(
        original.rerankingFreezeHashes[0],
      ),
      files,
      inputAggregateHash: hash(files),
      checks,
      passed: checks.every((c) => c.passed),
      rawGoldReadCount: 0,
      productionTextHash: original.productionTextHash,
      productionTimingHash: original.productionTimingHash,
      productionPresentationHash: hash(productionFiles),
      baselineReplayHashes: [
        e0,
        e1,
        a.map,
        a.labels,
        frozenEvaluation,
        diagnostics,
      ].map((v) => ({ name: v.artifactType, semanticHash: v.semanticHash })),
    }),
  );
  const originalTask = (role: string) =>
    path.dirname(
      path.dirname(
        c612Defined(original.files.find((f) => f.role === role)).path,
      ),
    );
  return {
    baseline,
    frozen: a.frozen,
    graphMap: a.map,
    oldLabels: a.labels,
    frozenMetrics: a.frozenMetrics.profiles,
    retrainedMetrics: a.retrainedMetrics.profiles,
    diagnostics,
    modeComparison,
    e0,
    e1,
    readOnly,
    taskA: originalTask("frozen-a/machine/c6-1-2-machine-freeze-manifest.json"),
    taskB: originalTask("frozen-b/machine/c6-1-2-machine-freeze-manifest.json"),
  };
}

import { mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import {
  atomicWriteJson,
  c611ReadOnlyProofSchema,
  c611ShareableSummarySchema,
} from "@mvl/shared";
import { machineQualitySemanticHash as hash } from "../packages/video-subtitler/src/machine-quality/evidence-correlation.js";
import { loadC611FrozenInputs } from "../packages/video-subtitler/src/consensus/c611-frozen-inputs.js";
import { readC611GoldAfterFreeze } from "../packages/video-subtitler/src/consensus/c611-evaluation-barrier.js";
import {
  evaluateC611FrozenStage,
  finalizeC611Route,
} from "../packages/video-subtitler/src/consensus/c611-evaluation-stage.js";
import { buildC611ErrorAttribution } from "../packages/video-subtitler/src/consensus/selective-mbr-error-attribution.js";
import { buildC611ReviewSuggestions } from "../packages/video-subtitler/src/consensus/selective-mbr-review-suggestions.js";
import { verifyC611MachineFreeze } from "../packages/video-subtitler/src/consensus/c611-artifact-io.js";
import {
  c61Fingerprint,
  c61FileHash,
  c61TreeFiles,
} from "../packages/video-subtitler/src/consensus/c61-artifact-io.js";
import { C611_POLICY_VERSION } from "../packages/video-subtitler/src/consensus/c611-policy.js";
import { loadC61MachineArtifacts } from "../packages/video-subtitler/src/consensus/c61-artifact-adapter.js";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`),
    v = i >= 0 ? process.argv[i + 1] : undefined;
  if (!v) throw new Error(`Missing --${name}`);
  return v;
}
if (arg("network") !== "off")
  throw new Error("C611_ACCEPTANCE_NETWORK_MUST_BE_OFF");
const repository = process.cwd(),
  previous = arg("previous"),
  aRoot = arg("a"),
  bRoot = arg("b"),
  source = arg("source"),
  gold = arg("gold"),
  output = arg("output"),
  stamp = arg("stamp");
const first = await loadC611FrozenInputs({
  machine: path.join(aRoot, "machine"),
  previous,
  repository,
});
const second = await loadC611FrozenInputs({
  machine: path.join(bRoot, "machine"),
  previous,
  repository,
});
const originalMachine = await loadC61MachineArtifacts(arg("task"));
for (const [name, sha] of Object.entries(originalMachine.sourceArtifactHashes))
  if (first.freeze.inputHashes[name] !== sha)
    throw new Error("C611_ORIGINAL_MACHINE_CHANGED");
const sourceBefore = await c61Fingerprint(source);
if (hash(sourceBefore) !== hash(first.baseline.sourceBefore))
  throw new Error("C611_SOURCE_CHANGED_SINCE_BASELINE");
const barrier = await readC611GoldAfterFreeze({
  a: path.join(aRoot, "machine"),
  b: path.join(bRoot, "machine"),
  repository,
  gold,
});
console.log(
  JSON.stringify({
    phase: "gold-barrier",
    frozenAt: barrier.freeze.frozenAt,
    firstReadAt: barrier.goldFirstReadAt,
    freezeHash: barrier.freeze.semanticHash,
  }),
);
const a = await evaluateC611FrozenStage({
  frozen: first,
  barrier,
  root: aRoot,
  sourceFileName: path.basename(source),
  progress: (m) => console.log(`A ${m}`),
});
const b = await evaluateC611FrozenStage({
  frozen: second,
  barrier,
  root: bRoot,
  sourceFileName: path.basename(source),
  reverse: true,
  progress: (m) => console.log(`B ${m}`),
});
const evaluationParity =
  hash(await c61TreeFiles(path.join(aRoot, "evaluation"))) ===
  hash(await c61TreeFiles(path.join(bRoot, "evaluation")));
const shadowParity =
  hash(await c61TreeFiles(path.join(aRoot, "shadow"))) ===
  hash(await c61TreeFiles(path.join(bRoot, "shadow")));
if (!evaluationParity || !shadowParity)
  throw new Error("C611_AB_EVALUATION_OR_SHADOW_MISMATCH");
const sourceAfter = await c61Fingerprint(source),
  goldAfter = await c61Fingerprint(gold);
const productionUnchanged = (
  await Promise.all(
    first.baseline.productionFiles.map(
      async (file) =>
        (await c61FileHash(
          path.join(originalMachine.taskDirectory, file.relativePath),
        )) === file.sha256,
    ),
  )
).every(Boolean);
const sourceReadOnly = hash(sourceBefore) === hash(sourceAfter),
  goldReadOnly = hash(barrier.fingerprint) === hash(goldAfter);
if (!sourceReadOnly || !goldReadOnly || !productionUnchanged)
  throw new Error("C611_READ_ONLY_PROOF_FAILED");
for (const [root, frozen, evaluation] of [
  [aRoot, first, a],
  [bRoot, second, b],
] as const) {
  await verifyC611MachineFreeze(path.join(root, "machine"), repository);
  const finalized = finalizeC611Route({
    frozen,
    evaluation,
    aBDeterministic: evaluationParity,
    sourceReadOnly,
    goldReadOnly,
    productionFilesUnchanged: productionUnchanged,
  });
  const attribution = buildC611ErrorAttribution({
    proposals: frozen.proposals,
    features: frozen.features,
    completeness: frozen.completeness,
    labels: evaluation.labels,
    decisions: evaluation.oof.decisions.filter((d) => d.profileId !== "S1"),
    profileQuality: evaluation.profileResults.profiles.map((p) => p.quality),
    appliedEventIdsByProfile: evaluation.appliedEventIdsByProfile,
  });
  const suggestions = buildC611ReviewSuggestions({
    universe: frozen.universe,
    proposals: frozen.proposals,
    decisions: evaluation.oof.decisions,
    profileId: "S6",
    appliedEventIdsByProfile: evaluation.appliedEventIdsByProfile,
  });
  const proofBody = {
    schemaVersion: "1.0.0" as const,
    policyVersion: C611_POLICY_VERSION,
    artifactType: "c6-1-1-read-only-proof" as const,
    machineFreezeHash: frozen.freeze.semanticHash,
    frozenAt: frozen.freeze.frozenAt,
    goldFirstReadAt: barrier.goldFirstReadAt,
    sourceBefore,
    sourceAfter,
    goldBefore: barrier.fingerprint,
    goldAfter,
    sourceUnchanged: sourceReadOnly,
    goldUnchanged: goldReadOnly,
    productionUnchanged,
    productionFiles: frozen.baseline.productionFiles,
    runtimeCodeUnchanged: true,
    freshWhisperInferences: 0 as const,
    freshReazonInferences: 0 as const,
    freshCtcInferences: 0 as const,
    networkUsed: false as const,
  };
  const proof = c611ReadOnlyProofSchema.parse({
    ...proofBody,
    semanticHash: hash(proofBody),
  });
  for (const artifact of [
    finalized.route,
    finalized.future,
    attribution,
    suggestions,
    proof,
  ])
    await atomicWriteJson(
      path.join(root, "evaluation", `${artifact.artifactType}.json`),
      artifact,
    );
  const shareBody = {
    schemaVersion: "1.0.0" as const,
    policyVersion: C611_POLICY_VERSION,
    artifactType: "c6-1-1-shareable-summary" as const,
    privacy: "SANITIZED_AGGREGATES_ONLY" as const,
    machineFreezeHash: frozen.freeze.semanticHash,
    profileResultsHash: evaluation.profileResults.semanticHash,
    routeHash: finalized.route.semanticHash,
    readOnlyProofHash: proof.semanticHash,
    baseline: frozen.baseline.baselineMetrics,
    profiles: evaluation.profileResults.profiles.map((p) => ({
      profileId: p.profileId,
      selected: p.appliedMetrics.selectedCount,
      evaluableSelected: p.appliedMetrics.evaluableSelectedCount,
      correct: p.appliedMetrics.correctSwitchCount,
      wrong: p.appliedMetrics.wrongSwitchCount,
      neutral: p.appliedMetrics.neutralSwitchCount,
      unknown: p.appliedMetrics.selectedUnevaluableCount,
      precision: p.appliedMetrics.precision,
      harm: p.appliedMetrics.harmRate,
      fixedCoverage: p.fixed.summary.changedGroupCoverage,
      jointNormalizedGain: p.fixed.summary.normalizedGain,
      metrics: p.quality.shadowMetrics,
      canonicalTextHash: p.canonicalTextHash,
      canonicalTimingHash: p.canonicalTimingHash,
    })),
    route: finalized.route.outcome,
    frozenModelCreated: finalized.future.frozenModelCreated,
    sourceReadOnly,
    goldReadOnly,
    productionUnchanged,
    rawTextIncluded: false as const,
    audioIncluded: false as const,
    absolutePathsIncluded: false as const,
    freshAsrInferences: 0 as const,
    freshCtcInferences: 0 as const,
    networkUsed: false as const,
    productionStatus: "needs-review" as const,
    finalizationMethod: "none" as const,
    machineOnlyReleaseAuthorized: false as const,
    c602Status: "HOLD" as const,
  };
  const shareable = c611ShareableSummarySchema.parse({
    ...shareBody,
    semanticHash: hash(shareBody),
  });
  await mkdir(path.join(root, "shareable"));
  await atomicWriteJson(
    path.join(root, "shareable", "c6-1-1-shareable-summary.json"),
    shareable,
  );
  console.log(
    JSON.stringify({
      phase: "final-route",
      root: path.basename(root),
      outcome: finalized.route.outcome,
      profile: finalized.route.selectedProfile,
      modelCreated: finalized.future.frozenModelCreated,
      release: false,
    }),
  );
}
const files = await c61TreeFiles(aRoot);
const stages: Record<string, string[]> = {
  "fixed-alignment": [
    "evaluation/c6-1-1-fixed-baseline-alignment-map.json",
    "evaluation/gold-selective-existing-candidate-labels.json",
    "evaluation/gold-legacy-p6-labels.json",
  ],
  "correlation-audit": [
    "machine/machine-c6-1-1-candidate-correlation-audit.json",
    "machine/machine-c6-1-1-hierarchical-correlation-groups.json",
  ],
  "hierarchical-mbr": [
    "machine/machine-existing-candidate-mbr-risk-ledger.json",
  ],
  proposals: ["machine/machine-selective-existing-candidate-proposals.json"],
  "completeness-risk": [
    "machine/machine-existing-candidate-completeness-risk.json",
  ],
  "feature-table": ["machine/machine-selective-mbr-features.json"],
  folds: ["machine/c6-1-1-calibration-folds.json"],
  "oof-calibration": [
    "evaluation/c6-1-1-out-of-fold-selective-decisions.json",
    "machine/c6-1-1-calibration-policy.json",
  ],
  "oof-shadow": files
    .filter((f) => f.relativePath.startsWith("shadow/"))
    .map((f) => f.relativePath),
  "quality-evaluation": [
    "evaluation/c6-1-1-selective-profile-results.json",
    "evaluation/c6-1-1-grouped-existing-candidate-oracles.json",
  ],
  "error-attribution": [
    "evaluation/c6-1-1-selective-mbr-error-attribution.json",
  ],
  "review-suggestions": [
    "evaluation/machine-c6-1-1-selective-mbr-review-suggestions.json",
  ],
  freeze: [
    "machine/c6-1-1-machine-feature-freeze.json",
    "machine/c6-1-1-policy-freeze.json",
    "evaluation/c6-1-1-selective-mbr-freeze.json",
    "evaluation/c6-1-1-route-decision.json",
    "evaluation/c6-1-1-read-only-proof.json",
  ],
};
for (const [stage, selected] of Object.entries(stages)) {
  const root = path.join(output, `carnation-c6-1-1-${stage}-${stamp}`);
  await mkdir(root, { recursive: false });
  for (const relative of selected) {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(aRoot, relative), target);
  }
}
console.log(
  JSON.stringify({
    phase: "completed",
    evaluationParity,
    shadowParity,
    sourceReadOnly,
    goldReadOnly,
    productionUnchanged,
    stageDirectoryCount: Object.keys(stages).length,
  }),
);

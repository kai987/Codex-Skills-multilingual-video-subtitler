import path from "node:path";
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import * as shared from "@mvl/shared";
import {
  assertPreGoldIntegrity1431,
  C6011431_POLICY_VERSION,
} from "../packages/video-subtitler/src/review/c6011431-projection-integrity.js";
import {
  durableJson141,
  readJson141,
} from "../packages/video-subtitler/src/review/c601141-io.js";
import {
  hashed141,
  required141,
} from "../packages/video-subtitler/src/review/c601141-policy.js";

const keys = [
  "state",
  "code-validation",
  "browser-audit",
  "parity",
  "machine-refreeze",
  "preflight",
  "gold",
  "quality-evaluation",
  "region-labels",
  "gold-evaluation",
] as const;
const { values } = parseArgs({
  strict: true,
  options: Object.fromEntries(
    keys.map((key) => [key, { type: "string" as const }]),
  ),
});
const arg = (key: (typeof keys)[number]) =>
  path.resolve(required141(values[key], `--${key} required`));

// This entire block executes before any Gold-bearing argument is dereferenced
// or opened. Paths are forwarded as inert strings only after machine integrity
// and refreeze contracts have passed.
const state = shared.state143Schema.parse(await readJson141(arg("state")));
const refreeze = shared.machineRefreeze1431Schema.parse(
  await readJson141(arg("machine-refreeze")),
);
const preflight = shared.nestedPreflight1431Schema.parse(
  await readJson141(arg("preflight")),
);
assertPreGoldIntegrity1431(preflight);
if (!refreeze.refreezePassed || refreeze.goldReadStarted)
  throw new Error("C6011431_MACHINE_REFREEZE_REQUIRED_BEFORE_GOLD");

const forwarded = [
  "state",
  "code-validation",
  "browser-audit",
  "parity",
  "gold",
  "quality-evaluation",
  "region-labels",
  "gold-evaluation",
] as const;
const childArgs = [
  path.resolve("node_modules/tsx/dist/cli.mjs"),
  "scripts/evaluate-c6-0-1-14-3.ts",
  ...forwarded.flatMap((key) => [`--${key}`, arg(key)]),
];
const exitCode = await new Promise<number>((resolve, reject) => {
  const child = spawn(process.execPath, childArgs, {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
  });
  child.on("error", reject);
  child.on("close", (code) => resolve(code ?? -1));
});
if (exitCode !== 0)
  throw new Error(`C6011431_CLEAN_EVALUATOR_FAILED:${exitCode}`);

const evaluationRoot = required141(state.outputs.evaluation);
const evaluation = shared.evaluation143Schema.parse(
  await readJson141(
    path.join(
      evaluationRoot,
      "gold-c6-0-1-14-3-selection-continuity-evaluation.json",
    ),
  ),
);
const oldRoute = shared.route143Schema.parse(
  await readJson141(
    path.join(evaluationRoot, "c6-0-1-14-3-route-decision.json"),
  ),
);
const intent = shared.firstGoldRead143Schema.parse(
  await readJson141(
    path.join(evaluationRoot, "c6-0-1-14-3-first-gold-read-intent.json"),
  ),
);
const projections = shared.projections143Schema.parse(
  await readJson141(
    path.join(
      required141(state.outputs["final-a"]),
      "machine-coverage-projections.json",
    ),
  ),
);
const stageMetrics = evaluation.variants.map((variant, index) => {
  const planId = required141(projections.variants[index]).officialPlanId;
  const budget = required141(
    variant.evaluation.budgets.find((row) => row.planId === planId),
  );
  const missing = budget.componentCoverage.filter((row) =>
    row.labels.includes("MISSING_DIALOGUE"),
  );
  const hallucination = budget.componentCoverage.filter((row) =>
    row.labels.includes("HALLUCINATION"),
  );
  return {
    stage: variant.stage,
    integrityFailureCount: variant.evaluation.integrityFailures.length as 0,
    missingAudible: missing.filter(
      (row) => row.layers.audibleReviewCoverage.audible,
    ).length,
    missingTotal: missing.length,
    hallucinationAudible: hallucination.filter(
      (row) => row.layers.audibleReviewCoverage.audible,
    ).length,
    hallucinationTotal: hallucination.length,
  };
});
if (
  !evaluation.evaluationIntegrityPassed ||
  stageMetrics.some((row) => row.integrityFailureCount !== 0)
)
  throw new Error("C6011431_CLEAN_EVALUATION_INTEGRITY_FAILED");
const clean = shared.cleanEvaluation1431Schema.parse(
  hashed141({
    schemaVersion: "1.0.0",
    policyVersion: C6011431_POLICY_VERSION,
    visibility: "LOCAL_ONLY",
    artifactType: "gold-c6-0-1-14-3-1-clean-evaluation",
    generatedAt: evaluation.generatedAt,
    machineRefreezeHash: refreeze.semanticHash,
    nestedPreflightHash: preflight.semanticHash,
    sourceEvaluationHash: evaluation.semanticHash,
    firstGoldReadIntentHash: intent.semanticHash,
    integrityFailureCount: 0,
    evaluationIntegrityPassed: true,
    stageMetrics,
    officialStage: "A7",
    missingAudible: evaluation.missingAudibleCount,
    missingTotal: evaluation.missingTotal,
    hallucinationAudible: evaluation.hallucinationAudibleCount,
    hallucinationTotal: evaluation.hallucinationTotal,
    matchingRulesChanged: false,
    evaluatorInferenceCount: 0,
    canonicalMutationCount: 0,
  }),
);

const engineeringPassed = oldRoute.engineeringGatePassed;
const plannerPassed =
  oldRoute.phaseAObligationCoverage === 1 &&
  oldRoute.phaseARegressionCount === 0;
const finalTargetCoveragePassed = !evaluation.components.some(
  (component) =>
    component.labels.includes("MISSING_DIALOGUE") &&
    component.inventoryCoverage >= 0.8 &&
    component.targetCoverage < 0.8,
);
const reviewAudioCoveragePassed = oldRoute.audioRequiredTargetCoveragePassed;
const playbackCoveragePassed = oldRoute.playbackTargetCoveragePassed;
const blockers: string[] = [];
if (!engineeringPassed) blockers.push("ENGINEERING");
if (!preflight.integrityPassed) blockers.push("NESTED_SEMANTIC_INTEGRITY");
if (!evaluation.evaluationIntegrityPassed)
  blockers.push("EVALUATION_INTEGRITY");
if (!plannerPassed) blockers.push("PLANNER");
if (!finalTargetCoveragePassed) blockers.push("HIERARCHICAL_TARGET_SELECTION");
if (!reviewAudioCoveragePassed || !playbackCoveragePassed)
  blockers.push("REVIEW_AUDIO_COVERAGE");
if (clean.missingAudible !== clean.missingTotal)
  blockers.push("MISSING_DIALOGUE_PLAYBACK_COVERAGE");
if (clean.hallucinationAudible !== clean.hallucinationTotal)
  blockers.push("HALLUCINATION_PLAYBACK_COVERAGE");
let primaryDecision: shared.Route1431["primaryDecision"] =
  "GO_C6_0_1_15_REGION_RANKER_RECALIBRATION";
if (!engineeringPassed) primaryDecision = "HOLD_FOR_ENGINEERING_REPAIR";
else if (!preflight.integrityPassed)
  primaryDecision = "HOLD_FOR_NESTED_SEMANTIC_INTEGRITY_REPAIR";
else if (!evaluation.evaluationIntegrityPassed)
  primaryDecision = "HOLD_FOR_EVALUATION_INTEGRITY_REPAIR";
else if (
  !finalTargetCoveragePassed ||
  clean.missingAudible !== clean.missingTotal
)
  primaryDecision = "HOLD_FOR_HIERARCHICAL_TARGET_SELECTION_REPAIR";
else if (
  !reviewAudioCoveragePassed ||
  !playbackCoveragePassed ||
  clean.hallucinationAudible !== clean.hallucinationTotal
)
  primaryDecision = "HOLD_FOR_REVIEW_AUDIO_COVERAGE_REPAIR";
const route = shared.route1431Schema.parse(
  hashed141({
    schemaVersion: "1.0.0",
    policyVersion: C6011431_POLICY_VERSION,
    visibility: "LOCAL_ONLY",
    artifactType: "c6-0-1-14-3-1-route-decision",
    primaryDecision,
    blockers,
    projectionHashIntegrityPassed: true,
    nestedSemanticIntegrityPassed: preflight.integrityPassed,
    evaluationIntegrityPassed: evaluation.evaluationIntegrityPassed,
    engineeringPassed,
    plannerPassed,
    finalTargetCoveragePassed,
    reviewAudioCoveragePassed,
    playbackCoveragePassed,
    missingPlaybackAudible: {
      covered: clean.missingAudible,
      total: clean.missingTotal,
    },
    hallucinationPlaybackAudible: {
      covered: clean.hallucinationAudible,
      total: clean.hallucinationTotal,
    },
    inferenceCount: 0,
    modelLoadCount: 0,
    providerProcessStartCount: 0,
    canonicalTextMutationCount: 0,
    canonicalTimingMutationCount: 0,
    productionStatus: "needs-review",
    finalizationMethod: "none",
    c602Status: "HOLD",
  }),
);
await durableJson141(
  path.join(evaluationRoot, "gold-c6-0-1-14-3-1-clean-evaluation.json"),
  clean,
);
await durableJson141(
  path.join(evaluationRoot, "c6-0-1-14-3-1-route-decision.json"),
  route,
);
console.log(
  JSON.stringify(
    {
      route: route.primaryDecision,
      integrityFailures: clean.integrityFailureCount,
      stages: clean.stageMetrics,
      missing: route.missingPlaybackAudible,
      hallucination: route.hallucinationPlaybackAudible,
      inferenceCount: 0,
    },
    null,
    2,
  ),
);

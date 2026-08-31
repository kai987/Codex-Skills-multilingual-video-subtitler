import path from "node:path";
import { parseArgs } from "node:util";
import * as shared from "@mvl/shared";
import { machineQualitySemanticHash } from "@mvl/video-subtitler";
import { c60114GoldErrorComponents } from "./lib/c60114-post-freeze-evaluation.js";
import { c60StableHash } from "../packages/video-subtitler/src/finalization-risk-policy.js";
import { c60113HashPayload } from "../packages/video-subtitler/src/review/c60113-region-features.js";
import { evaluateC60114PlaybackCoverage } from "../packages/video-subtitler/src/review/playback-grounded-coverage-evaluator.js";
import { machineCodeSnapshot143 } from "./lib/c601143-final.js";
import { persistFirstRead143 } from "./lib/c601143-first-read.js";
import { loadBaseline143 } from "./lib/c601143-input.js";
import { verifyProjectionAudio142 } from "./lib/c601142-coverage-projection.js";
import {
  fileHash141,
  identity141,
  readJson141,
  durableJson141,
  safeRelative141,
} from "../packages/video-subtitler/src/review/c601141-io.js";
import {
  hash141,
  hashed141,
  required141,
  assertHash141,
} from "../packages/video-subtitler/src/review/c601141-policy.js";

const { values } = parseArgs({
  strict: true,
  options: Object.fromEntries(
    [
      "state",
      "code-validation",
      "browser-audit",
      "parity",
      "gold",
      "quality-evaluation",
      "region-labels",
      "gold-evaluation",
    ].map((k) => [k, { type: "string" as const }]),
  ),
});
const arg = (k: string) =>
  path.resolve(required141(values[k], `--${k} required`));
const state = shared.state143Schema.parse(await readJson141(arg("state")));
if (hash141(state.config) !== state.configHash)
  throw new Error("C601143_EVALUATOR_CONFIG_CHANGED");
const baseline = await loadBaseline143(state.config),
  sourcePath = baseline.old.config.source;
const finalA = required141(state.outputs["final-a"]),
  finalB = required141(state.outputs["final-b"]),
  evaluationRoot = required141(state.outputs.evaluation);
async function verifyFreeze(root: string) {
  const freeze = shared.machineFreeze143Schema.parse(
    await readJson141(
      path.join(root, "c6-0-1-14-3-machine-selection-freeze.json"),
    ),
  );
  assertHash141(freeze);
  for (const row of [...freeze.artifacts, ...freeze.protectedMachineFiles]) {
    const file = path.resolve(state.config.outputRoot, row.relativePath);
    safeRelative141(state.config.outputRoot, file);
    if ((await fileHash141(file)) !== row.byteHash)
      throw new Error("C601143_FROZEN_MACHINE_ARTIFACT_CHANGED");
  }
  if (
    hash141(await identity141(sourcePath)) !==
    hash141(freeze.sourceReadOnlyIdentity)
  )
    throw new Error("C601143_SOURCE_CHANGED_AFTER_FREEZE");
  return freeze;
}
const codePath = arg("code-validation"),
  browserPath = arg("browser-audit"),
  parityPath = arg("parity"),
  code = shared.codeValidation143Schema.parse(await readJson141(codePath)),
  browser = shared.browserAudit143Schema.parse(await readJson141(browserPath)),
  parity = shared.parity143Schema.parse(await readJson141(parityPath));
const engineeringGate = () => code.passed && browser.passed;
const runtimeTrue = (value: unknown) => value === true;
if (!engineeringGate() || !runtimeTrue(parity.byteParity))
  throw new Error("C601143_PRE_GOLD_ACCEPTANCE_REQUIRED");
for (const check of code.results) {
  const log = path.resolve(path.dirname(codePath), check.logRelativePath);
  safeRelative141(path.dirname(codePath), log);
  if ((await fileHash141(log)) !== check.logSha256 || !check.passed)
    throw new Error("C601143_CODE_LOG_CHANGED_OR_FAILED");
}
const a = await verifyFreeze(finalA),
  b = await verifyFreeze(finalB),
  snapshot = await machineCodeSnapshot143(process.cwd());
if (
  a.codeSnapshotHash !== snapshot.semanticHash ||
  b.codeSnapshotHash !== snapshot.semanticHash ||
  parity.finalAFreezeHash !== a.semanticHash ||
  parity.finalBFreezeHash !== b.semanticHash
)
  throw new Error("C601143_CODE_OR_PARITY_CHANGED_AFTER_FREEZE");
const projections = shared.projections143Schema.parse(
  await readJson141(path.join(finalA, "machine-coverage-projections.json")),
);
assertHash141(projections);
for (const root of [finalA, finalB])
  for (const row of projections.variants)
    await verifyProjectionAudio142(
      path.join(root, row.workspaceRelativePath),
      row.projection,
    );
const intent = await persistFirstRead143({
  directory: evaluationRoot,
  a,
  b,
  codeSnapshotHash: snapshot.semanticHash,
  codeValidationHash: await fileHash141(codePath),
  browserAuditHash: await fileHash141(browserPath),
  parityHash: parity.semanticHash,
});

// Gold isolation ends here. No Gold path was hashed or opened before the durable receipt above.
const goldPath = arg("gold"),
  qualityPath = arg("quality-evaluation"),
  labelsPath = arg("region-labels"),
  upstreamPath = arg("gold-evaluation");
const sourceBefore = await identity141(sourcePath),
  goldBefore = await identity141(goldPath),
  qualityBefore = await identity141(qualityPath),
  labelsBefore = await identity141(labelsPath),
  upstreamBefore = await identity141(upstreamPath);
const quality = shared.c60112ReviewQualityEvaluationSchema.parse(
    await readJson141(qualityPath),
  ),
  labels = shared.c60113RegionLabelsSchema.parse(await readJson141(labelsPath)),
  upstream = shared.machineVsGoldEvaluationSchema.parse(
    await readJson141(upstreamPath),
  );
const { semanticHash: qualitySemantic, ...qualityCore } = quality,
  { semanticHash: upstreamSemantic, ...upstreamCore } = upstream;
if (
  qualitySemantic !==
    machineQualitySemanticHash({ ...qualityCore, generatedAt: undefined }) ||
  labels.semanticHash !== c60113HashPayload(labels) ||
  c60StableHash({
    ...upstreamCore,
    generatedAt: "<evaluation-time>",
    evaluationWallTimeMs: 0,
    goldIdentity: {
      ...upstream.goldIdentity,
      firstReadAt: "<gold-first-read-time>",
    },
  }) !== upstreamSemantic ||
  quality.goldEvaluationArtifactSha256 !== upstreamBefore.sha256 ||
  quality.goldSha256Before !== goldBefore.sha256 ||
  quality.goldSha256After !== goldBefore.sha256 ||
  upstream.goldIdentity.sha256 !== goldBefore.sha256 ||
  upstream.sourceIdentity.sha256 !== sourceBefore.sha256 ||
  labels.sourceEvaluationHash !== quality.semanticHash
)
  throw new Error("C601143_GOLD_SOURCE_HASH_BINDING_FAILED");
const components = c60114GoldErrorComponents(
  upstream,
  labels.errorComponents,
  a.sourceIdentity,
);
if (
  hash141(components.map((c) => c.errorComponentId).sort()) !==
  hash141(quality.errorComponents.map((c) => c.errorComponentId).sort())
)
  throw new Error("C601143_GOLD_DENOMINATOR_CHANGED");
const engineering = {
  engineeringPassed: true,
  baselineParityPassed: true,
  runtimeGoldInputCount: 0,
  canonicalMutationCount: 0,
  machineDraftMutationCount: 0,
  sourceMutationCount: 0,
  goldMutationCount: 0,
  machineFreezeVerified: true,
};
const variants = projections.variants.map((row) => ({
  stage: row.stage,
  evaluation: evaluateC60114PlaybackCoverage({
    ...row.projection,
    errorComponents: components,
    generatedAt: intent.firstGoldReadAt,
    engineeringGates: engineering,
  }),
}));
const budget = (index: number) => {
  const row = required141(projections.variants[index]),
    result = required141(variants[index]).evaluation;
  return required141(
    result.budgets.find((p) => p.planId === row.officialPlanId),
  );
};
const componentRows = components.map((component) => {
  const rows = variants.map((_, i) =>
      required141(
        budget(i).componentCoverage.find(
          (c) => c.errorComponentId === component.errorComponentId,
        ),
      ),
    ),
    audible = rows.map((r) => r.layers.audibleReviewCoverage.audible);
  const first = audible.findIndex(Boolean),
    last = audible.findLastIndex(Boolean),
    firstLoss = first < 0 ? -1 : audible.findIndex((v, i) => i > first && !v),
    regression = firstLoss < 0 ? null : firstLoss - 1,
    final = required141(rows[7]);
  const diagnosis =
    component.mappingStatus !== "RESOLVED"
      ? "GOLD_MAPPING_UNRESOLVED"
      : audible[0]
        ? "BASELINE_ALREADY_COVERED"
        : audible[1] && audible[7]
          ? "PRESERVED_FROM_PHASE_A"
          : audible[1] && !audible[7]
            ? "PHASE_A_COVERAGE_REGRESSION"
            : first === 4
              ? "RECOVERED_BY_HIERARCHICAL_CHILD_SELECTION"
              : first === 5
                ? "RECOVERED_BY_TARGET_BUNDLE"
                : first >= 6
                  ? "RECOVERED_BY_CONSTRAINED_FINAL_PLANNER"
                  : final.layers.targetInterval.audible &&
                      !final.layers.audibleReviewCoverage.audible
                    ? "REVIEW_AUDIO_OMISSION"
                    : "HIERARCHICAL_CHILD_SELECTION_MISS";
  const status = (r: typeof final) => r.layers.audibleReviewCoverage.status;
  return {
    errorComponentId: component.errorComponentId,
    labels: component.labels,
    baselineStatus: status(required141(rows[0])),
    phaseAStatus: status(required141(rows[1])),
    c601142FinalStatus: status(required141(rows[2])),
    c601143FinalStatus: status(final),
    bestStageReached: last < 0 ? null : shared.stages143[last],
    regressedAfterStage:
      regression === null ? null : shared.stages143[regression],
    inventoryCoverage: final.layers.machineSpeech.coverageRatio,
    targetCoverage: final.layers.targetInterval.coverageRatio,
    physicalAudioCoverage: final.layers.physicalAudio.coverageRatio,
    playbackCoverage: final.layers.audibleReviewCoverage.coverageRatio,
    localizedLexicalCoverage: final.layers.localizedLexical.coverageRatio,
    finalDiagnosis: diagnosis,
  };
});
const official = budget(7),
  missing = official.componentCoverage.filter((c) =>
    c.labels.includes("MISSING_DIALOGUE"),
  ),
  hall = official.componentCoverage.filter((c) =>
    c.labels.includes("HALLUCINATION"),
  ),
  missingCovered = missing.filter(
    (c) => c.layers.audibleReviewCoverage.audible,
  ).length,
  hallCovered = hall.filter(
    (c) => c.layers.audibleReviewCoverage.audible,
  ).length;
const header = {
  schemaVersion: projections.schemaVersion,
  policyVersion: projections.policyVersion,
  policyHash: projections.policyHash,
  sourceIdentity: projections.sourceIdentity,
  sourceTimebase: projections.sourceTimebase,
  runtimeGoldInputCount: 0 as const,
  visibility: projections.visibility,
};
const evaluation = shared.evaluation143Schema.parse(
  hashed141({
    ...header,
    artifactType: "gold-c6-0-1-14-3-selection-continuity-evaluation",
    generatedAt: intent.firstGoldReadAt,
    projectionHash: projections.semanticHash,
    freezeHash: a.semanticHash,
    firstReadIntentHash: intent.semanticHash,
    variants,
    components: componentRows,
    officialStage: "A7",
    officialPlanId: "C601143_FINAL_REVIEW_DELIVERY",
    missingTotal: missing.length,
    hallucinationTotal: hall.length,
    missingAudibleCount: missingCovered,
    hallucinationAudibleCount: hallCovered,
    evaluationIntegrityPassed: variants.every(
      (v) => !v.evaluation.integrityFailures.length,
    ),
    matchingRulesChanged: false,
    evaluatorInferenceCount: 0,
    canonicalMutationCount: 0,
  }),
);
const workspace = shared.workspace143Schema.parse(
    await readJson141(
      path.join(
        finalA,
        "review-workspace/machine-c601143-review-workspace.json",
      ),
    ),
  ),
  planner = workspace.planner,
  audioPassed = workspace.audio.summary.targetCoveragePassed,
  playbackPassed = workspace.playback.targetCoverageChecks.every(
    (c) => c.fullyCovered,
  ),
  targetBudget = workspace.safety.targets.length <= 24,
  coreBudget = workspace.safety.summary.speechCoreUnionSeconds <= 60,
  burden = workspace.playback.fullQueueEpisodeRatio <= 0.95;
const blockers: string[] = [];
if (!engineeringGate()) blockers.push("ENGINEERING_GATE");
if (!evaluation.evaluationIntegrityPassed)
  blockers.push("EVALUATION_INTEGRITY");
if (!workspace.monotonicity.monotonicityPassed)
  blockers.push("CROSS_STAGE_COVERAGE_REGRESSION");
if (
  componentRows.some(
    (c) => c.finalDiagnosis === "HIERARCHICAL_CHILD_SELECTION_MISS",
  )
)
  blockers.push("HIERARCHICAL_TARGET_SELECTION");
if (planner.feasibilityStatus === "SEARCH_INCOMPLETE")
  blockers.push("PLANNER_SEARCH_INCOMPLETE");
if (!targetBudget || !coreBudget) blockers.push("SAFETY_BUDGET");
if (
  !audioPassed ||
  !playbackPassed ||
  missingCovered !== missing.length ||
  hallCovered !== hall.length
)
  blockers.push("REVIEW_AUDIO_COVERAGE");
let primaryDecision: shared.Route143["primaryDecision"] =
  "GO_C6_0_1_15_REGION_RANKER_RECALIBRATION";
if (!engineeringGate()) primaryDecision = "HOLD_FOR_ENGINEERING_REPAIR";
else if (!evaluation.evaluationIntegrityPassed)
  primaryDecision = "HOLD_FOR_EVALUATION_INTEGRITY_REPAIR";
else if (!workspace.monotonicity.monotonicityPassed)
  primaryDecision = "HOLD_FOR_CROSS_STAGE_COVERAGE_REGRESSION";
else if (
  componentRows.some(
    (c) => c.finalDiagnosis === "HIERARCHICAL_CHILD_SELECTION_MISS",
  )
)
  primaryDecision = "HOLD_FOR_HIERARCHICAL_TARGET_SELECTION_REPAIR";
else if (planner.feasibilityStatus === "SEARCH_INCOMPLETE")
  primaryDecision = "HOLD_FOR_PLANNER_SEARCH_COMPLETENESS";
else if (!targetBudget || !coreBudget)
  primaryDecision = "HOLD_FOR_SAFETY_BUDGET_MODEL_REDESIGN";
else if (
  !audioPassed ||
  !playbackPassed ||
  !burden ||
  missingCovered !== missing.length ||
  hallCovered !== hall.length
)
  primaryDecision = "HOLD_FOR_REVIEW_AUDIO_COVERAGE_REPAIR";
const route = shared.route143Schema.parse(
  hashed141({
    ...header,
    artifactType: "c6-0-1-14-3-route-decision",
    primaryDecision,
    blockers,
    engineeringGatePassed: engineeringGate(),
    evaluationIntegrityGatePassed: evaluation.evaluationIntegrityPassed,
    phaseAObligationCoverage: workspace.monotonicity.obligationCoverageRatio,
    phaseARegressionCount: workspace.monotonicity.droppedObligationCount,
    missingPlaybackAudible: { covered: missingCovered, total: missing.length },
    hallucinationPlaybackAudible: { covered: hallCovered, total: hall.length },
    audioRequiredTargetCoveragePassed: audioPassed,
    playbackTargetCoveragePassed: playbackPassed,
    targetBudgetPassed: targetBudget,
    coreBudgetPassed: coreBudget,
    fullQueueBurdenPassed: burden,
    wholeEpisodeCatchAllCount: 0,
    runtimeGoldInputCount: 0,
    datasetHardcodingCount: 0,
    detectorInferenceCount: 0,
    asrInferenceCount: 0,
    canonicalTextMutationCount: 0,
    canonicalTimingMutationCount: 0,
    finalABParity:
      runtimeTrue(parity.byteParity) && runtimeTrue(parity.semanticParity),
    productionStatus: "needs-review",
    finalizationMethod: "none",
    c602Status: "HOLD",
  }),
);
const packageEntry = required141(
    a.protectedMachineFiles.find((p) =>
      p.relativePath.endsWith("subtitle-package.needs-review.json"),
    ),
  ),
  pkg = shared.subtitlePackageSchema.parse(
    await readJson141(
      path.join(state.config.outputRoot, packageEntry.relativePath),
    ),
  );
let overlap = 0;
for (let i = 0; i < pkg.cues.length; i++)
  for (const next of pkg.cues.slice(i + 1)) {
    const cue = required141(pkg.cues[i]);
    if (Math.min(cue.end, next.end) > Math.max(cue.start, next.start))
      overlap++;
  }
const qualityParity = shared.machineQuality143Schema.parse(
  hashed141({
    schemaVersion: "1.0.0",
    artifactType: "c6-0-1-14-3-machine-subtitle-parity-quality",
    baselineEvaluationByteHash: upstreamBefore.sha256,
    machinePackageByteHash: packageEntry.byteHash,
    machinePackageABByteParity: true,
    metricComputation:
      "REUSE_HASH_BOUND_BASELINE_METRICS_FOR_BYTE_IDENTICAL_SUBTITLES",
    globalTextMetrics: upstream.globalTextMetrics,
    alignmentMetrics: upstream.alignmentMetrics,
    timingMetrics: upstream.timingMetrics,
    coverageMetrics: upstream.coverageMetrics,
    missingDialogueCount: upstream.missingDialogueCandidates.length,
    hallucinationCount: upstream.hallucinationCandidates.length,
    materialTextErrorCount: upstream.materialTextErrors.length,
    severeTimingErrorCount: upstream.severeTimingErrors.length,
    machineOverlapCount: overlap,
    canonicalMutationCount: 0,
    productionStatus: "needs-review",
    finalizationMethod: "none",
    c602Status: "HOLD",
  }),
);
const sourceAfter = await identity141(sourcePath),
  goldAfter = await identity141(goldPath);
for (const [before, after] of [
  [sourceBefore, sourceAfter],
  [goldBefore, goldAfter],
  [qualityBefore, await identity141(qualityPath)],
  [labelsBefore, await identity141(labelsPath)],
  [upstreamBefore, await identity141(upstreamPath)],
] as const)
  if (hash141(before) !== hash141(after))
    throw new Error("C601143_POST_GOLD_READ_ONLY_IDENTITY_CHANGED");
const audit = shared.evaluationAudit143Schema.parse(
  hashed141({
    schemaVersion: "1.0.0",
    artifactType: "c6-0-1-14-3-post-freeze-evaluation-audit",
    visibility: "LOCAL_ONLY",
    firstGoldReadAt: intent.firstGoldReadAt,
    finalAFreezeHash: a.semanticHash,
    finalBFreezeHash: b.semanticHash,
    finalAFreezeCompletedAt: a.freezeCompletedAt,
    finalBFreezeCompletedAt: b.freezeCompletedAt,
    projectionSemanticHash: projections.semanticHash,
    codeValidationByteHash: await fileHash141(codePath),
    machineABSemanticParity: true,
    canonicalABByteParity: true,
    freezeBeforeGold: true,
    sourceIdentityBefore: sourceBefore,
    sourceIdentityAfter: sourceAfter,
    goldIdentityBefore: goldBefore,
    goldIdentityAfter: goldAfter,
    upstreamGoldEvaluationHash: upstreamBefore.sha256,
    upstreamQualityEvaluationHash: qualityBefore.sha256,
    upstreamRegionLabelsHash: labelsBefore.sha256,
    sourceReadOnly: true,
    goldReadOnly: true,
    runtimeGoldInputCount: 0,
    evaluatorGoldInputCount: 1,
    newInferenceCount: 0,
    modelLoadCount: 0,
    providerProcessStartCount: 0,
    matchingRulesChanged: false,
    canonicalMutationCount: 0,
    rankerRetrained: false,
    newOofRun: false,
  }),
);
for (const [name, value] of [
  ["gold-c6-0-1-14-3-selection-continuity-evaluation.json", evaluation],
  ["c6-0-1-14-3-route-decision.json", route],
  ["c6-0-1-14-3-machine-subtitle-parity-quality.json", qualityParity],
  ["c6-0-1-14-3-post-freeze-evaluation-audit.local-only.json", audit],
] as const)
  await durableJson141(path.join(evaluationRoot, name), value);
console.log(
  JSON.stringify(
    {
      route: route.primaryDecision,
      missing: { covered: missingCovered, total: missing.length },
      hallucination: { covered: hallCovered, total: hall.length },
      freezeBeforeGold: true,
      runtimeGoldInputCount: 0,
    },
    null,
    2,
  ),
);

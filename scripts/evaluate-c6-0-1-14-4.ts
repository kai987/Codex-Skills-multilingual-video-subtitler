import path from "node:path";
import { parseArgs } from "node:util";
import * as shared from "@mvl/shared";
import { machineQualitySemanticHash } from "@mvl/video-subtitler";
import { c60StableHash } from "../packages/video-subtitler/src/finalization-risk-policy.js";
import { c60113HashPayload } from "../packages/video-subtitler/src/review/c60113-region-features.js";
import {
  assertHash141,
  hash141,
  hashed141,
  required141,
} from "../packages/video-subtitler/src/review/c601141-policy.js";
import {
  durableJson141,
  fileHash141,
  identity141,
  readJson141,
  safeRelative141,
} from "../packages/video-subtitler/src/review/c601141-io.js";
import { assertPreGoldIntegrity1431 } from "../packages/video-subtitler/src/review/c6011431-projection-integrity.js";
import { verifyProjectionAudio142 } from "./lib/c601142-coverage-projection.js";
import { machineCodeSnapshot143 } from "./lib/c601143-final.js";
import { loadInputs144 } from "./lib/c601144-input.js";
import { c60114GoldErrorComponents } from "./lib/c60114-post-freeze-evaluation.js";
import {
  buildEvaluationProjections144,
  componentDiagnoses144,
  decideRoute144,
  evaluateProjectionStages144,
  utilityTierCoverage144,
} from "./lib/c601144-post-freeze-evaluation.js";

const keys = [
  "state",
  "previous-state",
  "engineering-validation",
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

// Machine-only verification. Gold-bearing arguments are intentionally not
// resolved or opened until after the durable first-read audit below.
const statePath = arg("state"),
  previousStatePath = arg("previous-state"),
  engineeringPath = arg("engineering-validation"),
  state = shared.state143Schema.parse(await readJson141(statePath)),
  inputs = await loadInputs144(previousStatePath);
if (hash141(state.config) !== state.configHash)
  throw new Error("C601144_STATE_CONFIG_CHANGED");
const output = (role: string) =>
    required141(state.outputs[role], `C601144_OUTPUT_MISSING:${role}`),
  finalA = output("final-a"),
  finalB = output("final-b"),
  evaluationRoot = output("evaluation"),
  sourcePath = inputs.baseline.old.config.source,
  codeSnapshot = await machineCodeSnapshot143(process.cwd()),
  engineering = shared.preGoldEngineering144Schema.parse(
    await readJson141(engineeringPath),
  );
assertHash141(engineering);
if (engineering.codeSnapshotHash !== codeSnapshot.semanticHash)
  throw new Error("C601144_ENGINEERING_RECEIPT_CODE_SNAPSHOT_CHANGED");
for (const check of engineering.checks) {
  const log = path.resolve(
    path.dirname(engineeringPath),
    check.logRelativePath,
  );
  safeRelative141(path.dirname(engineeringPath), log);
  if (!check.passed || (await fileHash141(log)) !== check.logSha256)
    throw new Error(`C601144_ENGINEERING_LOG_CHANGED_OR_FAILED:${check.name}`);
}

async function verifyCompatibilityFreeze(root: string) {
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
      throw new Error(`C601144_FROZEN_FILE_CHANGED:${row.relativePath}`);
  }
  if (
    hash141(await identity141(sourcePath)) !==
    hash141(freeze.sourceReadOnlyIdentity)
  )
    throw new Error("C601144_SOURCE_CHANGED_AFTER_COMPATIBILITY_FREEZE");
  if (freeze.codeSnapshotHash !== codeSnapshot.semanticHash)
    throw new Error("C601144_CODE_CHANGED_AFTER_COMPATIBILITY_FREEZE");
  return freeze;
}

async function verifyUtilityFreeze(root: string, role: "A" | "B") {
  const compatibility = await verifyCompatibilityFreeze(root);
  const freeze = shared.freeze144Schema.parse(
    await readJson141(
      path.join(root, "c6-0-1-14-4-machine-utility-selection-freeze.json"),
    ),
  );
  assertHash141(freeze);
  if (freeze.finalRole !== role)
    throw new Error(`C601144_FREEZE_ROLE_OR_GOLD_COUNT_INVALID:${role}`);
  const preflight = shared.nestedPreflight144Schema.parse(
    await readJson141(
      path.join(root, "c6-0-1-14-4-nested-semantic-integrity-preflight.json"),
    ),
  );
  assertHash141(preflight);
  if (preflight.semanticHash !== freeze.nestedPreflightHash)
    throw new Error(`C601144_PREFLIGHT_FREEZE_BINDING_FAILED:${role}`);
  const projections = shared.projections143Schema.parse(
    await readJson141(path.join(root, "machine-coverage-projections.json")),
  );
  assertHash141(projections);
  if (projections.semanticHash !== freeze.projectionHashes.projections)
    throw new Error(`C601144_PROJECTION_FREEZE_BINDING_FAILED:${role}`);
  for (const [name, expected] of Object.entries(freeze.utilityArtifactHashes)) {
    const value = (await readJson141(
      path.join(root, "machine-artifacts", name),
    )) as { semanticHash?: string };
    if (!value.semanticHash) throw new Error(`C601144_HASH_MISSING:${name}`);
    assertHash141(value as { semanticHash: string });
    if (value.semanticHash !== expected)
      throw new Error(`C601144_UTILITY_FREEZE_BINDING_FAILED:${name}`);
  }
  const deliveryFiles = {
    targets: "machine-review-target-intervals-v6.json",
    items: "machine-review-items-v8.json",
    regions: "machine-review-regions-v7.json",
    audio: "machine-review-audio-manifest-v7.json",
    playback: "machine-review-playback-timeline-v6.json",
  } as const;
  for (const [key, name] of Object.entries(deliveryFiles)) {
    const value = (await readJson141(
      path.join(root, "review-workspace", name),
    )) as { semanticHash?: string };
    if (!value.semanticHash) throw new Error(`C601144_HASH_MISSING:${name}`);
    assertHash141(value as { semanticHash: string });
    if (value.semanticHash !== freeze.reviewDeliveryHashes[key])
      throw new Error(`C601144_DELIVERY_FREEZE_BINDING_FAILED:${name}`);
  }
  const official = required141(
    projections.variants.find(
      (variant) => variant.stage === projections.officialStage,
    ),
  );
  await verifyProjectionAudio142(
    path.join(root, official.workspaceRelativePath),
    official.projection,
  );
  return { compatibility, freeze, preflight, projections, official };
}

const a = await verifyUtilityFreeze(finalA, "A"),
  b = await verifyUtilityFreeze(finalB, "B"),
  parityPath = path.join(evaluationRoot, "c6-0-1-14-4-final-ab-parity.json"),
  parity = shared.parity144Schema.parse(await readJson141(parityPath));
assertHash141(parity);
if (
  parity.finalAFreezeHash !== a.freeze.semanticHash ||
  parity.finalBFreezeHash !== b.freeze.semanticHash
)
  throw new Error("C601144_FINAL_AB_PARITY_INVALID");

const previousFinalA = required141(inputs.previousState.outputs["final-a"]),
  previousProjections = shared.projections143Schema.parse(
    await readJson141(
      path.join(previousFinalA, "machine-coverage-projections.json"),
    ),
  ),
  previousOfficial = required141(
    previousProjections.variants.find(
      (variant) => variant.stage === previousProjections.officialStage,
    ),
  );
assertHash141(previousProjections);
await verifyProjectionAudio142(
  path.join(previousFinalA, previousOfficial.workspaceRelativePath),
  previousOfficial.projection,
);

const currentWorkspace = shared.workspace143Schema.parse(
    await readJson141(
      path.join(
        finalA,
        "review-workspace",
        "machine-c601143-review-workspace.json",
      ),
    ),
  ),
  previousWorkspace = shared.workspace143Schema.parse(
    await readJson141(
      path.join(
        previousFinalA,
        "review-workspace",
        "machine-c601143-review-workspace.json",
      ),
    ),
  ),
  hierarchy = shared.hierarchy143Schema.parse(
    await readJson141(
      path.join(
        finalA,
        "machine-artifacts",
        "machine-selectable-speech-child-units-v1.json",
      ),
    ),
  ),
  childUtility = shared.childUtility144Schema.parse(
    await readJson141(
      path.join(
        finalA,
        "machine-artifacts",
        "machine-selectable-child-utility-v1.json",
      ),
    ),
  ),
  propagation = shared.propagation144Schema.parse(
    await readJson141(
      path.join(
        finalA,
        "machine-artifacts",
        "machine-evidence-utility-propagation-ledger.json",
      ),
    ),
  ),
  forced = shared.forcedInclusion144Schema.parse(
    await readJson141(
      path.join(
        finalA,
        "machine-artifacts",
        "machine-forced-inclusion-planner-results.json",
      ),
    ),
  ),
  optional = shared.optionalChildLedger144Schema.parse(
    await readJson141(
      path.join(
        finalA,
        "machine-artifacts",
        "machine-optional-speech-child-coverage-ledger.json",
      ),
    ),
  ),
  planner = shared.planner144Schema.parse(
    await readJson141(
      path.join(
        finalA,
        "machine-artifacts",
        "machine-utility-aware-final-planner-certificate.json",
      ),
    ),
  ),
  comparison = shared.planComparison144Schema.parse(
    await readJson141(
      path.join(
        finalA,
        "machine-artifacts",
        "machine-utility-plan-comparison.json",
      ),
    ),
  ),
  safety = shared.safetyTargets144Schema.parse(
    await readJson141(
      path.join(
        finalA,
        "machine-artifacts",
        "machine-missing-safety-reserve-targets-v4.json",
      ),
    ),
  ),
  audio = shared.reviewAudio144Schema.parse(
    await readJson141(
      path.join(
        finalA,
        "review-workspace",
        "machine-review-audio-manifest-v7.json",
      ),
    ),
  ),
  playback = shared.reviewPlayback144Schema.parse(
    await readJson141(
      path.join(
        finalA,
        "review-workspace",
        "machine-review-playback-timeline-v6.json",
      ),
    ),
  );
for (const artifact of [
  currentWorkspace,
  previousWorkspace,
  hierarchy,
  childUtility,
  propagation,
  forced,
  optional,
  planner,
  comparison,
  safety,
  audio,
  playback,
])
  assertHash141(artifact);
assertPreGoldIntegrity1431(
  shared.nestedPreflight1431Schema.parse(
    await readJson141(
      path.join(
        finalA,
        "c6-0-1-14-3-1-nested-semantic-integrity-preflight.json",
      ),
    ),
  ),
);

const goldFirstReadAt = new Date().toISOString();
if (Date.parse(goldFirstReadAt) < Date.parse(a.freeze.freezeCompletedAt))
  throw new Error("C601144_FREEZE_NOT_COMPLETED_BEFORE_GOLD_READ");
const firstRead = shared.firstGoldRead144Schema.parse(
  hashed141({
    schemaVersion: "1.0.0",
    policyVersion: shared.version144Schema.value,
    visibility: "LOCAL_ONLY_GOLD_EVALUATION",
    artifactType: "c6-0-1-14-4-first-gold-read-audit",
    machineFreezeHash: a.freeze.semanticHash,
    machineFreezeCompletedAt: a.freeze.freezeCompletedAt,
    goldFirstReadAt,
    freezeBeforeGold: true,
    machineStageGoldPathReadCount: 0,
    machineStageGoldDerivedArtifactReadCount: 0,
  }),
);
await durableJson141(
  path.join(evaluationRoot, "c6-0-1-14-4-first-gold-read-audit.json"),
  firstRead,
);

// Gold isolation ends here. The first durable read receipt already exists.
const goldPath = arg("gold"),
  qualityPath = arg("quality-evaluation"),
  labelsPath = arg("region-labels"),
  upstreamPath = arg("gold-evaluation"),
  sourceBefore = await identity141(sourcePath),
  goldBefore = await identity141(goldPath),
  qualityBefore = await identity141(qualityPath),
  labelsBefore = await identity141(labelsPath),
  upstreamBefore = await identity141(upstreamPath),
  quality = shared.c60112ReviewQualityEvaluationSchema.parse(
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
  throw new Error("C601144_GOLD_SOURCE_HASH_BINDING_FAILED");

const errorComponents = c60114GoldErrorComponents(
  upstream,
  labels.errorComponents,
  a.freeze.sourceIdentity,
);
if (
  hash141(
    errorComponents.map((component) => component.errorComponentId).sort(),
  ) !==
  hash141(
    quality.errorComponents
      .map((component) => component.errorComponentId)
      .sort(),
  )
)
  throw new Error("C601144_GOLD_DENOMINATOR_CHANGED");

const projections = buildEvaluationProjections144({
    previousOfficial: previousOfficial.projection,
    utilityOfficial: a.official.projection,
  }),
  previousTierCoverage = utilityTierCoverage144(
    previousWorkspace.planner.selectedChildIds,
    childUtility,
  ),
  currentTierCoverage = utilityTierCoverage144(
    planner.selectedChildIds,
    childUtility,
  ),
  previousSafety = previousWorkspace.safety.summary,
  stageMetadata = {
    U0: {
      safetyBundleCount: previousSafety.activeTargetCount,
      safetyCoreUnionSeconds: previousSafety.speechCoreUnionSeconds,
      phaseAObligationCoverage:
        previousWorkspace.monotonicity.obligationCoverageRatio,
      phaseARegressionCount:
        previousWorkspace.monotonicity.droppedObligationCount,
      utilityTierCoverage: previousTierCoverage,
    },
    U1: {
      safetyBundleCount: previousSafety.activeTargetCount,
      safetyCoreUnionSeconds: previousSafety.speechCoreUnionSeconds,
      phaseAObligationCoverage:
        previousWorkspace.monotonicity.obligationCoverageRatio,
      phaseARegressionCount:
        previousWorkspace.monotonicity.droppedObligationCount,
      utilityTierCoverage: previousTierCoverage,
    },
    U2: {
      safetyBundleCount: safety.activeTargetCount,
      safetyCoreUnionSeconds: safety.speechCoreUnionSeconds,
      phaseAObligationCoverage: planner.obligationCoverageRatio,
      phaseARegressionCount: planner.droppedObligationCount,
      utilityTierCoverage: currentTierCoverage,
    },
    U3: {
      safetyBundleCount: safety.activeTargetCount,
      safetyCoreUnionSeconds: safety.speechCoreUnionSeconds,
      phaseAObligationCoverage: planner.obligationCoverageRatio,
      phaseARegressionCount: planner.droppedObligationCount,
      utilityTierCoverage: currentTierCoverage,
    },
    U4: {
      safetyBundleCount: safety.activeTargetCount,
      safetyCoreUnionSeconds: safety.speechCoreUnionSeconds,
      phaseAObligationCoverage: planner.obligationCoverageRatio,
      phaseARegressionCount: planner.droppedObligationCount,
      utilityTierCoverage: currentTierCoverage,
    },
  },
  stages = evaluateProjectionStages144({
    projections,
    planIds: {
      U0: previousOfficial.officialPlanId,
      U1: previousOfficial.officialPlanId,
      U2: a.official.officialPlanId,
      U3: a.official.officialPlanId,
      U4: a.official.officialPlanId,
    },
    errorComponents,
    generatedAt: firstRead.goldFirstReadAt,
    stageMetadata,
  }),
  components = componentDiagnoses144({
    stages,
    hierarchy,
    childUtility,
    optional,
    forced,
    planner,
  }),
  finalMetric = required141(stages[4]).metric,
  integrityPassed = stages.every(
    (stage) => stage.metric.integrityStatus === "PASSED",
  ),
  routeResult = decideRoute144({
    engineeringPassed: engineering.passed,
    integrityPassed,
    propagation,
    childUtility,
    optional,
    forced,
    planner,
    comparison,
    safety,
    audio,
    playback,
    finalMetric,
  }),
  utilityRecoveredMissingCount = components.filter(
    (component) =>
      component.baselineTargetStatus !== "AUDIBLE" &&
      component.baselineTargetStatus !== "FULL" &&
      ["AUDIBLE", "FULL"].includes(component.playbackStatus),
  ).length,
  evaluation = shared.goldEvaluation144Schema.parse(
    hashed141({
      schemaVersion: "1.0.0",
      policyVersion: shared.version144Schema.value,
      visibility: "LOCAL_ONLY_GOLD_EVALUATION",
      artifactType: "gold-c6-0-1-14-4-utility-selection-evaluation",
      machineFreezeHash: a.freeze.semanticHash,
      goldFirstReadAt: firstRead.goldFirstReadAt,
      machineFreezeCompletedAt: a.freeze.freezeCompletedAt,
      freezeBeforeGold: true,
      machineStageGoldPathReadCount: 0,
      machineStageGoldDerivedArtifactReadCount: 0,
      stages: stages.map((stage) => stage.metric),
      components,
      finalMissingInventory: finalMetric.missingInventory,
      finalMissingTarget: finalMetric.missingTarget,
      finalMissingPhysicalAudio: finalMetric.missingPhysicalAudio,
      finalMissingPlaybackAny: finalMetric.missingPlaybackAny,
      finalMissingPlaybackAudible: finalMetric.missingPlaybackAudible,
      finalMissingPlaybackFull: finalMetric.missingPlaybackFull,
      finalMissingLocalizedLexical: finalMetric.missingLocalizedLexical,
      finalHallucinationTarget: finalMetric.hallucinationTarget,
      finalHallucinationPhysicalAudio: finalMetric.hallucinationPhysicalAudio,
      finalHallucinationPlaybackAudible:
        finalMetric.hallucinationPlaybackAudible,
      utilityRecoveredMissingCount,
      remainingHighUtilityUnselectedCount:
        optional.remainingHighUtilityUnselectedCount,
      finalSafetySelectionMissCount: routeResult.forcedFeasibleUnselectedCount,
      finalReviewAudioOmissionCount: components.filter(
        (component) => component.finalDiagnosis === "REVIEW_AUDIO_OMISSION",
      ).length,
      evaluationIntegrityPassed: integrityPassed,
      evaluatorInferenceCount: 0,
      canonicalMutationCount: 0,
    }),
  ),
  route = shared.route144Schema.parse(
    hashed141({
      schemaVersion: "1.0.0",
      policyVersion: shared.version144Schema.value,
      visibility: "LOCAL_ONLY",
      artifactType: "c6-0-1-14-4-route-decision",
      evaluationHash: evaluation.semanticHash,
      plannerHash: planner.semanticHash,
      freezeHash: a.freeze.semanticHash,
      route: routeResult.route,
      engineeringGate: engineering.passed,
      integrityGate: integrityPassed,
      utilityPropagationGate: routeResult.utilityPropagationGate,
      monotonicityGate: routeResult.monotonicityGate,
      plannerGate: routeResult.plannerGate,
      safetyBudgetGate: routeResult.safetyBudgetGate,
      finalTargetSelectionGate: routeResult.finalTargetSelectionGate,
      reviewDeliveryGate: routeResult.reviewDeliveryGate,
      playbackGate: routeResult.playbackGate,
      fullQueueCoverageGate: routeResult.fullQueueCoverageGate,
      fullQueueQualityGate: routeResult.fullQueueQualityGate,
      reasons: routeResult.reasons,
      productionStatus: "needs-review",
      finalizationMethod: "none",
      machineOnlyReleaseAuthorized: false,
      c602Status: "HOLD",
    }),
  );

const sourceAfter = await identity141(sourcePath),
  goldAfter = await identity141(goldPath),
  qualityAfter = await identity141(qualityPath),
  labelsAfter = await identity141(labelsPath),
  upstreamAfter = await identity141(upstreamPath);
for (const [before, after] of [
  [sourceBefore, sourceAfter],
  [goldBefore, goldAfter],
  [qualityBefore, qualityAfter],
  [labelsBefore, labelsAfter],
  [upstreamBefore, upstreamAfter],
] as const)
  if (hash141(before) !== hash141(after))
    throw new Error("C601144_POST_GOLD_READ_ONLY_IDENTITY_CHANGED");
const audit = shared.postFreezeAudit144Schema.parse(
  hashed141({
    schemaVersion: "1.0.0",
    policyVersion: shared.version144Schema.value,
    visibility: "LOCAL_ONLY_GOLD_EVALUATION",
    artifactType: "c6-0-1-14-4-post-freeze-evaluation-audit",
    firstGoldReadAuditHash: firstRead.semanticHash,
    finalAFreezeHash: a.freeze.semanticHash,
    finalBFreezeHash: b.freeze.semanticHash,
    finalABParityHash: parity.semanticHash,
    sourceIdentityBefore: sourceBefore,
    sourceIdentityAfter: sourceAfter,
    goldIdentityBefore: goldBefore,
    goldIdentityAfter: goldAfter,
    qualityEvaluationIdentityBefore: qualityBefore,
    qualityEvaluationIdentityAfter: qualityAfter,
    regionLabelsIdentityBefore: labelsBefore,
    regionLabelsIdentityAfter: labelsAfter,
    upstreamEvaluationIdentityBefore: upstreamBefore,
    upstreamEvaluationIdentityAfter: upstreamAfter,
    sourceReadOnly: true,
    goldReadOnly: true,
    freezeBeforeGold: true,
    machineStageGoldPathReadCount: 0,
    machineStageGoldDerivedArtifactReadCount: 0,
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
  ["gold-c6-0-1-14-4-utility-selection-evaluation.json", evaluation],
  ["c6-0-1-14-4-route-decision.json", route],
  ["c6-0-1-14-4-post-freeze-evaluation-audit.local-only.json", audit],
] as const)
  await durableJson141(path.join(evaluationRoot, name), value);

console.log(
  JSON.stringify(
    {
      route: route.route,
      stages: evaluation.stages.map((stage) => ({
        stage: stage.stage,
        missingTarget: stage.missingTarget,
        missingPhysicalAudio: stage.missingPhysicalAudio,
        missingPlaybackAudible: stage.missingPlaybackAudible,
      })),
      finalHallucinationPlaybackAudible:
        evaluation.finalHallucinationPlaybackAudible,
      remainingHighUtilityUnselectedCount:
        evaluation.remainingHighUtilityUnselectedCount,
      finalSafetySelectionMissCount: evaluation.finalSafetySelectionMissCount,
      freezeBeforeGold: evaluation.freezeBeforeGold,
      evaluatorInferenceCount: evaluation.evaluatorInferenceCount,
    },
    null,
    2,
  ),
);

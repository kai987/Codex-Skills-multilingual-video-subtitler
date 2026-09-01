/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Runtime acceptance rechecks literal schema invariants against independently bound artifacts. */
/* eslint-disable no-control-regex -- ANSI stripping is limited to immutable local test logs. */
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs, promisify } from "node:util";
import type { z } from "zod";
import * as shared from "@mvl/shared";
import { verifyPhysicalAudio143 } from "../packages/video-subtitler/src/review/c601143-review-delivery.js";
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
import { files141 } from "./lib/c601141-freeze.js";
import { verifyProjectionAudio142 } from "./lib/c601142-coverage-projection.js";
import { machineCodeSnapshot143 } from "./lib/c601143-final.js";
import { loadInputs144 } from "./lib/c601144-input.js";
import { auditShareable144 } from "./lib/c601144-shareable-audit.js";

const keys = [
  "state",
  "previous-state",
  "engineering-validation",
  "browser-audit",
  "skill-validation-log",
  "output",
] as const;
const { values } = parseArgs({
  strict: true,
  options: Object.fromEntries(
    keys.map((key) => [key, { type: "string" as const }]),
  ),
});
const arg = (key: (typeof keys)[number]) =>
  path.resolve(required141(values[key], `--${key} required`));
const state = shared.state143Schema.parse(await readJson141(arg("state")));
if (hash141(state.config) !== state.configHash)
  throw new Error("C601144_VALIDATOR_STATE_CONFIG_CHANGED");
const inputs = await loadInputs144(arg("previous-state")),
  root = path.resolve(state.config.outputRoot),
  dir = (role: string) =>
    path.resolve(required141(state.outputs[role], `missing output ${role}`)),
  finalA = dir("final-a"),
  finalB = dir("final-b"),
  evaluationRoot = dir("evaluation"),
  output = arg("output");
await mkdir(output, { recursive: true });

const checks: { name: string; passed: boolean; evidence: string }[] = [],
  check = (name: string, passed: boolean, evidence: unknown) =>
    checks.push({ name, passed, evidence: hash141(evidence) });

const engineering = shared.preGoldEngineering144Schema.parse(
  await readJson141(arg("engineering-validation")),
);
assertHash141(engineering);
const engineeringLogs = new Map<string, string>();
let engineeringLogHashesPassed = true;
for (const row of engineering.checks) {
  const file = path.resolve(
    path.dirname(arg("engineering-validation")),
    row.logRelativePath,
  );
  safeRelative141(path.dirname(arg("engineering-validation")), file);
  const content = await readFile(file, "utf8");
  engineeringLogs.set(row.name, content);
  if (!row.passed || (await fileHash141(file)) !== row.logSha256)
    engineeringLogHashesPassed = false;
}
check("PRE_GOLD_ENGINEERING_RECEIPT", engineering.passed, engineering);
check(
  "PRE_GOLD_ENGINEERING_LOG_BINDINGS",
  engineeringLogHashesPassed,
  engineering.checks,
);

const skillLog = await readFile(arg("skill-validation-log"), "utf8"),
  skillValidationPassed = skillLog.includes("Skill is valid!"),
  browser = shared.browserAudit144Schema.parse(
    await readJson141(arg("browser-audit")),
  );
assertHash141(browser);
check(
  "SKILL_VALIDATION",
  skillValidationPassed,
  await fileHash141(arg("skill-validation-log")),
);
check(
  "REAL_BROWSER_READ_ONLY_ACCEPTANCE",
  browser.passed &&
    browser.checks.length === 12 &&
    browser.checks.every((row) => row.passed) &&
    browser.consoleErrorCount === 0,
  browser,
);

async function verifyFreeze(directory: string, role: "A" | "B") {
  const compatibility = shared.machineFreeze143Schema.parse(
      await readJson141(
        path.join(directory, "c6-0-1-14-3-machine-selection-freeze.json"),
      ),
    ),
    utility = shared.freeze144Schema.parse(
      await readJson141(
        path.join(
          directory,
          "c6-0-1-14-4-machine-utility-selection-freeze.json",
        ),
      ),
    );
  assertHash141(compatibility);
  assertHash141(utility);
  let bindingsPassed = true;
  for (const row of [
    ...compatibility.artifacts,
    ...compatibility.protectedMachineFiles,
  ]) {
    const file = path.resolve(root, row.relativePath);
    safeRelative141(root, file);
    if ((await fileHash141(file)) !== row.byteHash) bindingsPassed = false;
  }
  check(`FINAL_${role}_COMPATIBILITY_FREEZE_BINDINGS`, bindingsPassed, {
    artifactCount: compatibility.artifacts.length,
    protectedCount: compatibility.protectedMachineFiles.length,
  });
  check(
    `FINAL_${role}_UTILITY_FREEZE_ROLE_AND_ZERO_WORK`,
    utility.finalRole === role &&
      utility.runtimeGoldInputBeforeFreeze === 0 &&
      utility.inferenceCount === 0 &&
      utility.modelLoadCount === 0 &&
      utility.providerProcessStartCount === 0,
    utility,
  );
  return { compatibility, utility };
}

const freezeA = await verifyFreeze(finalA, "A"),
  freezeB = await verifyFreeze(finalB, "B"),
  codeSnapshot = await machineCodeSnapshot143(process.cwd());
check(
  "FROZEN_MACHINE_CODE",
  codeSnapshot.semanticHash === engineering.codeSnapshotHash &&
    codeSnapshot.semanticHash === freezeA.compatibility.codeSnapshotHash &&
    codeSnapshot.semanticHash === freezeB.compatibility.codeSnapshotHash,
  codeSnapshot.semanticHash,
);
check(
  "SOURCE_READ_ONLY_AT_FREEZE",
  hash141(await identity141(inputs.baseline.old.config.source)) ===
    hash141(freezeA.compatibility.sourceReadOnlyIdentity) &&
    hash141(freezeA.compatibility.sourceReadOnlyIdentity) ===
      hash141(freezeB.compatibility.sourceReadOnlyIdentity),
  freezeA.compatibility.sourceReadOnlyIdentity,
);

const snapshot = async (directory: string) => {
    const rows: { relativePath: string; byteHash: string }[] = [];
    for (const file of await files141(directory)) {
      const relativePath = safeRelative141(directory, file);
      if (
        [
          "c6-0-1-14-3-machine-selection-freeze.json",
          "c6-0-1-14-4-machine-utility-selection-freeze.json",
        ].includes(relativePath)
      )
        continue;
      rows.push({ relativePath, byteHash: await fileHash141(file) });
    }
    return rows;
  },
  aSnapshot = await snapshot(finalA),
  bSnapshot = await snapshot(finalB),
  parity = shared.parity144Schema.parse(
    await readJson141(
      path.join(evaluationRoot, "c6-0-1-14-4-final-ab-parity.json"),
    ),
  );
assertHash141(parity);
check(
  "FINAL_AB_INDEPENDENT_BYTE_SEMANTIC_WAV_SUBTITLE_PARITY",
  hash141(aSnapshot) === hash141(bSnapshot) &&
    parity.finalAFreezeHash === freezeA.utility.semanticHash &&
    parity.finalBFreezeHash === freezeB.utility.semanticHash &&
    parity.byteParity &&
    parity.semanticParity &&
    parity.wavHashParity &&
    parity.subtitleParity &&
    parity.mismatches.length === 0,
  { a: hash141(aSnapshot), b: hash141(bSnapshot), parity },
);

const replay = async (directory: string) => {
    const value = shared.replay143Schema.parse(
      await readJson141(
        path.join(
          directory,
          "exact-cache-replay/c6-0-1-14-3-exact-cache-replay-accounting.json",
        ),
      ),
    );
    assertHash141(value);
    return value;
  },
  replayA = await replay(finalA),
  replayB = await replay(finalB),
  noNewWork = (value: typeof replayA) =>
    value.detectorCacheHitCount === value.expectedDetectorRequestCount &&
    value.asrCacheHitCount === value.expectedAsrRequestCount &&
    value.cacheMissCount === 0 &&
    value.inferenceCount === 0 &&
    value.modelLoadCount === 0 &&
    value.providerProcessStartCount === 0 &&
    value.networkRequestCount === 0;
check(
  "EXACT_CACHE_REPLAY_ONLY_FINAL_AB",
  noNewWork(replayA) &&
    noNewWork(replayB) &&
    replayA.semanticHash === replayB.semanticHash,
  { replayA, replayB },
);

const readA = (name: string) =>
    readJson141(path.join(finalA, "machine-artifacts", name)),
  policy = shared.utilityPolicy144Schema.parse(
    await readA("c6-0-1-14-4-machine-evidence-utility-policy.json"),
  ),
  geometry = shared.geometryFreeze144Schema.parse(
    await readA("c6-0-1-14-4-geometry-freeze.json"),
  ),
  pathology = shared.pathologyAudit144Schema.parse(
    await readA("machine-evidence-utility-pathology-audit.json"),
  ),
  atoms = shared.atomUtility144Schema.parse(
    await readA("machine-evidence-atom-utility-v1.json"),
  ),
  children = shared.childUtility144Schema.parse(
    await readA("machine-selectable-child-utility-v1.json"),
  ),
  bundles = shared.bundleUtility144Schema.parse(
    await readA("machine-target-bundle-utility-v1.json"),
  ),
  propagation = shared.propagation144Schema.parse(
    await readA("machine-evidence-utility-propagation-ledger.json"),
  ),
  forced = shared.forcedInclusion144Schema.parse(
    await readA("machine-forced-inclusion-planner-results.json"),
  ),
  optional = shared.optionalChildLedger144Schema.parse(
    await readA("machine-optional-speech-child-coverage-ledger.json"),
  ),
  planner = shared.planner144Schema.parse(
    await readA("machine-utility-aware-final-planner-certificate.json"),
  ),
  comparison = shared.planComparison144Schema.parse(
    await readA("machine-utility-plan-comparison.json"),
  ),
  safety = shared.safetyTargets144Schema.parse(
    await readA("machine-missing-safety-reserve-targets-v4.json"),
  );
for (const artifact of [
  policy,
  geometry,
  pathology,
  atoms,
  children,
  bundles,
  propagation,
  forced,
  optional,
  planner,
  comparison,
  safety,
])
  assertHash141(artifact);
check(
  "GEOMETRY_FROZEN_AND_GOLD_FREE",
  geometry.geometryMutationCount === 0 &&
    !geometry.goldReadAttempted &&
    geometry.hierarchyHash === inputs.hierarchy.semanticHash &&
    geometry.bundlesHash === inputs.bundles.semanticHash &&
    geometry.obligationsHash === inputs.obligations.semanticHash,
  geometry,
);
check(
  "PRIORITY_PATHOLOGY_REPRODUCED",
  pathology.positiveEvidenceAtomCount > 0 &&
    pathology.atomMachinePriorityNonzeroCount === 0 &&
    pathology.eligibleChildMachinePriorityNonzeroCount === 0 &&
    pathology.eligibleBundleMachinePriorityNonzeroCount === 0 &&
    pathology.selectedBundleMachinePrioritySum === 0,
  pathology,
);
check(
  "UTILITY_NONZERO_HARD_GATES",
  atoms.positiveEvidenceAtomCount > 0 &&
    atoms.positiveEvidenceZeroUtilityCount === 0 &&
    children.eligibleChildCount > 0 &&
    children.eligibleChildZeroUtilityCount === 0 &&
    bundles.eligibleBundleCount > 0 &&
    bundles.eligibleOptionalBundleZeroUtilityCount === 0,
  { atoms, children, bundles },
);
check(
  "UTILITY_PROPAGATION_NO_SILENT_LOSS",
  propagation.silentUtilityLossCount === 0 &&
    propagation.droppedBetweenEvidenceAndAtom === 0 &&
    propagation.droppedBetweenAtomAndChild === 0 &&
    propagation.droppedBetweenChildAndBundle === 0 &&
    propagation.droppedBetweenBundleAndPlanner === 0,
  propagation,
);
check(
  "FORCED_INCLUSION_SEARCH_ACCOUNTING",
  forced.evaluatedCount ===
    forced.feasibleCount +
      forced.infeasibleCount +
      forced.searchIncompleteCount &&
    forced.evaluatedCount <= policy.forcedInclusionMaximumChildren &&
    forced.evaluatedChildren.every(
      (row) => row.feasibility === "SEARCH_INCOMPLETE" || row.searchComplete,
    ),
  forced,
);
check(
  "UTILITY_AWARE_EXACT_PLANNER",
  planner.plannerVersion === "DETERMINISTIC_UTILITY_NATIVE_SET_COVER_BNB_V2" &&
    planner.searchComplete &&
    planner.feasibilityStatus === "FEASIBLE" &&
    planner.oldPlanFeasible &&
    planner.objectiveNonDegradation &&
    planner.feasibilityWitnessVerified &&
    planner.hardConstraintResults.every((row) => row.passed),
  planner,
);
check(
  "FIXED_24_60_95_AND_MONOTONICITY_BUDGETS",
  planner.activeBundleCount <= 24 &&
    planner.coreUnionSeconds <= 60 &&
    planner.predictedFullQueueEpisodeRatio <= 0.95 &&
    planner.obligationCoverageRatio === 1 &&
    planner.droppedObligationCount === 0 &&
    safety.wholeEpisodeCatchAllCount === 0 &&
    safety.obligationCoverageRatio === 1,
  { planner, safety },
);

const deliveryRoot = path.join(finalA, "review-workspace"),
  targets = shared.reviewTargets144Schema.parse(
    await readJson141(
      path.join(deliveryRoot, "machine-review-target-intervals-v6.json"),
    ),
  ),
  items = shared.reviewItems144Schema.parse(
    await readJson141(path.join(deliveryRoot, "machine-review-items-v8.json")),
  ),
  regions = shared.reviewRegions144Schema.parse(
    await readJson141(
      path.join(deliveryRoot, "machine-review-regions-v7.json"),
    ),
  ),
  audio = shared.reviewAudio144Schema.parse(
    await readJson141(
      path.join(deliveryRoot, "machine-review-audio-manifest-v7.json"),
    ),
  ),
  playback = shared.reviewPlayback144Schema.parse(
    await readJson141(
      path.join(deliveryRoot, "machine-review-playback-timeline-v6.json"),
    ),
  );
for (const artifact of [targets, items, regions, audio, playback])
  assertHash141(artifact);
check(
  "REVIEW_DELIVERY_BINDINGS_AND_COUNTS",
  regions.summary.targetCoverageRatio === 1 &&
    audio.plannedAudioCount === audio.actualAudioCount &&
    audio.actualAudioCount === audio.playableAudioCount &&
    audio.playableAudioCount === audio.hashVerifiedAudioCount &&
    audio.audioExtractionFailureCount === 0 &&
    audio.summary.targetCoveragePassed &&
    playback.playbackToAudioCoverageRatio === 1 &&
    playback.playbackToTargetCoverageRatio === 1,
  {
    targets: targets.targets.length,
    items: items.items.length,
    regions: regions.regions.length,
    audio,
    playback,
  },
);
check(
  "UTILITY_FREEZE_HASH_BINDINGS",
  freezeA.utility.policyHash === policy.semanticHash &&
    freezeA.utility.plannerCertificateHash === planner.semanticHash &&
    freezeA.utility.planComparisonHash === comparison.semanticHash &&
    freezeA.utility.nestedPreflightHash ===
      freezeB.utility.nestedPreflightHash &&
    Object.entries(freezeA.utility.reviewDeliveryHashes).every(
      ([key, value]) =>
        value ===
        (
          { targets, items, regions, audio, playback } as Record<
            string,
            { semanticHash: string }
          >
        )[key]?.semanticHash,
    ),
  freezeA.utility,
);

const workspaceA = shared.workspace143Schema.parse(
    await readJson141(
      path.join(deliveryRoot, "machine-c601143-review-workspace.json"),
    ),
  ),
  workspaceB = shared.workspace143Schema.parse(
    await readJson141(
      path.join(
        finalB,
        "review-workspace/machine-c601143-review-workspace.json",
      ),
    ),
  );
assertHash141(workspaceA);
assertHash141(workspaceB);
const physicalA = await verifyPhysicalAudio143(deliveryRoot, workspaceA.audio),
  physicalB = await verifyPhysicalAudio143(
    path.join(finalB, "review-workspace"),
    workspaceB.audio,
  );
check(
  "PHYSICAL_WAV_PLAYABLE_HASH_VERIFIED_FINAL_AB",
  physicalA.allPassed && physicalB.allPassed,
  { physicalA, physicalB },
);
check(
  "BROWSER_BYTES_BIND_FINAL_A",
  browser.workspaceDataByteHash ===
    (await fileHash141(path.join(deliveryRoot, "review-data.json"))) &&
    browser.workspaceJavascriptByteHash ===
      (await fileHash141(path.join(deliveryRoot, "assets/review.js"))),
  browser,
);

const projectionA = shared.projections143Schema.parse(
    await readJson141(path.join(finalA, "machine-coverage-projections.json")),
  ),
  projectionB = shared.projections143Schema.parse(
    await readJson141(path.join(finalB, "machine-coverage-projections.json")),
  ),
  preflightA = shared.nestedPreflight144Schema.parse(
    await readJson141(
      path.join(finalA, "c6-0-1-14-4-nested-semantic-integrity-preflight.json"),
    ),
  ),
  preflightB = shared.nestedPreflight144Schema.parse(
    await readJson141(
      path.join(finalB, "c6-0-1-14-4-nested-semantic-integrity-preflight.json"),
    ),
  );
for (const artifact of [projectionA, projectionB, preflightA, preflightB])
  assertHash141(artifact);
for (const [directory, projections] of [
  [finalA, projectionA],
  [finalB, projectionB],
] as const)
  for (const variant of projections.variants)
    await verifyProjectionAudio142(
      path.join(directory, variant.workspaceRelativePath),
      variant.projection,
    );
check(
  "PROJECTION_REBINDING_AND_NESTED_PREFLIGHT",
  projectionA.semanticHash === projectionB.semanticHash &&
    preflightA.passed &&
    preflightB.passed &&
    preflightA.nestedIntegrityFailures === 0 &&
    preflightA.staleProjectionHashCount === 0,
  { projectionA, projectionB, preflightA, preflightB },
);

const firstGoldRead = shared.firstGoldRead144Schema.parse(
    await readJson141(
      path.join(evaluationRoot, "c6-0-1-14-4-first-gold-read-audit.json"),
    ),
  ),
  evaluation = shared.goldEvaluation144Schema.parse(
    await readJson141(
      path.join(
        evaluationRoot,
        "gold-c6-0-1-14-4-utility-selection-evaluation.json",
      ),
    ),
  ),
  route = shared.route144Schema.parse(
    await readJson141(
      path.join(evaluationRoot, "c6-0-1-14-4-route-decision.json"),
    ),
  ),
  postFreeze = shared.postFreezeAudit144Schema.parse(
    await readJson141(
      path.join(
        evaluationRoot,
        "c6-0-1-14-4-post-freeze-evaluation-audit.local-only.json",
      ),
    ),
  );
for (const artifact of [firstGoldRead, evaluation, route, postFreeze])
  assertHash141(artifact);
check(
  "DURABLE_GOLD_BARRIER",
  firstGoldRead.freezeBeforeGold &&
    firstGoldRead.machineFreezeHash === freezeA.utility.semanticHash &&
    Date.parse(firstGoldRead.goldFirstReadAt) >=
      Date.parse(freezeA.utility.freezeCompletedAt) &&
    evaluation.freezeBeforeGold &&
    evaluation.machineStageGoldPathReadCount === 0 &&
    evaluation.machineStageGoldDerivedArtifactReadCount === 0,
  firstGoldRead,
);
check(
  "SOURCE_GOLD_AND_EVALUATION_INPUTS_READ_ONLY",
  postFreeze.sourceReadOnly &&
    postFreeze.goldReadOnly &&
    hash141(postFreeze.sourceIdentityBefore) ===
      hash141(postFreeze.sourceIdentityAfter) &&
    hash141(postFreeze.goldIdentityBefore) ===
      hash141(postFreeze.goldIdentityAfter) &&
    hash141(postFreeze.qualityEvaluationIdentityBefore) ===
      hash141(postFreeze.qualityEvaluationIdentityAfter) &&
    hash141(postFreeze.regionLabelsIdentityBefore) ===
      hash141(postFreeze.regionLabelsIdentityAfter) &&
    hash141(postFreeze.upstreamEvaluationIdentityBefore) ===
      hash141(postFreeze.upstreamEvaluationIdentityAfter),
  postFreeze,
);
check(
  "GOLD_EVALUATION_INTEGRITY",
  evaluation.evaluationIntegrityPassed &&
    evaluation.stages.length === 5 &&
    evaluation.stages.every((stage) => stage.integrityStatus === "PASSED") &&
    evaluation.evaluatorInferenceCount === 0,
  evaluation,
);
check(
  "PRODUCTION_C602_AND_HUMAN_TRIAL_REMAIN_HELD",
  route.productionStatus === "needs-review" &&
    route.finalizationMethod === "none" &&
    !route.machineOnlyReleaseAuthorized &&
    route.c602Status === "HOLD" &&
    browser.savedHumanDecisionCount === 0 &&
    !browser.humanTrialStarted,
  route,
);

const baselineHashes = inputs.baseline.old.baseline;
let protectedParity = true;
for (const file of baselineHashes.protectedFiles) {
  if (
    (await fileHash141(path.join(finalA, file.relativePath))) !==
      file.byteHash ||
    (await fileHash141(path.join(finalB, file.relativePath))) !== file.byteHash
  )
    protectedParity = false;
}
check(
  "CANONICAL_TEXT_TIMING_PRESENTATION_AND_ASS_SRT_VTT_PARITY",
  freezeA.utility.canonicalTextHash === baselineHashes.canonicalTextHash &&
    freezeA.utility.canonicalTimingHash ===
      baselineHashes.canonicalTimingHash &&
    freezeA.utility.presentationHash === baselineHashes.presentationHash &&
    freezeA.compatibility.canonicalTextMutationCount === 0 &&
    freezeA.compatibility.canonicalTimingMutationCount === 0 &&
    freezeA.compatibility.presentationMutationCount === 0 &&
    protectedParity,
  {
    canonicalTextHash: freezeA.utility.canonicalTextHash,
    canonicalTimingHash: freezeA.utility.canonicalTimingHash,
    presentationHash: freezeA.utility.presentationHash,
    protectedParity,
  },
);

const productionFiles = [
    "packages/video-subtitler/src/review/c601144-policy.ts",
    "packages/video-subtitler/src/review/c601144-utility.ts",
    "packages/video-subtitler/src/review/c601144-planner.ts",
    "packages/video-subtitler/src/review/c601144-review-delivery.ts",
    "scripts/lib/c601144-input.ts",
    "scripts/lib/c601144-machine.ts",
    "scripts/lib/c601144-integrity.ts",
    "scripts/run-c6-0-1-14-4-machine.ts",
    "scripts/audit-c6-0-1-14-4-utility.ts",
  ],
  forbiddenProductionPattern =
    /(?:カーネーション|5\.9544|a758[0-9a-f]{20,}|expected\s*6\/6)/iu,
  hardcodedFiles: string[] = [];
for (const file of productionFiles)
  if (forbiddenProductionPattern.test(await readFile(file, "utf8")))
    hardcodedFiles.push(file);
check(
  "NO_DATASET_OR_GOLD_HARDCODING",
  hardcodedFiles.length === 0,
  hardcodedFiles,
);
check(
  "NO_NETWORK_OR_NEW_MODEL_WORK",
  !engineering.networkUsed &&
    engineering.modelInferenceCount === 0 &&
    noNewWork(replayA) &&
    postFreeze.newInferenceCount === 0 &&
    postFreeze.modelLoadCount === 0 &&
    postFreeze.providerProcessStartCount === 0,
  { engineering, replayA, postFreeze },
);

const shareable = shared.shareableSummary144Schema.parse(
    hashed141({
      schemaVersion: "1.0.0",
      policyVersion: shared.version144Schema.value,
      visibility: "SHAREABLE_AGGREGATE_ONLY",
      artifactType: "c6-0-1-14-4-shareable-acceptance-summary",
      policyHash: policy.semanticHash,
      atomUtilityHash: atoms.semanticHash,
      childUtilityHash: children.semanticHash,
      bundleUtilityHash: bundles.semanticHash,
      plannerHash: planner.semanticHash,
      finalAFreezeHash: freezeA.utility.semanticHash,
      finalBFreezeHash: freezeB.utility.semanticHash,
      evaluationHash: evaluation.semanticHash,
      routeDecisionHash: route.semanticHash,
      atomCount: atoms.rowCount,
      positiveEvidenceAtomCount: atoms.positiveEvidenceAtomCount,
      positiveEvidenceZeroUtilityCount: atoms.positiveEvidenceZeroUtilityCount,
      eligibleChildCount: children.eligibleChildCount,
      eligibleChildZeroUtilityCount: children.eligibleChildZeroUtilityCount,
      eligibleBundleCount: bundles.eligibleBundleCount,
      eligibleOptionalBundleZeroUtilityCount:
        bundles.eligibleOptionalBundleZeroUtilityCount,
      tierCounts: atoms.tierCounts,
      oldPlanObjectiveVector: planner.oldPlanObjectiveVector,
      newPlanObjectiveVector: planner.finalObjectiveVector,
      forcedInclusionEvaluatedCount: forced.evaluatedCount,
      forcedInclusionFeasibleCount: forced.feasibleCount,
      forcedInclusionInfeasibleCount: forced.infeasibleCount,
      forcedInclusionSearchIncompleteCount: forced.searchIncompleteCount,
      selectedBundleCount: planner.activeBundleCount,
      selectedChildCount: planner.selectedChildIds.length,
      selectedOptionalChildCount: planner.selectedOptionalChildIds.length,
      safetyCoreUnionSeconds: planner.coreUnionSeconds,
      fullQueueEpisodeRatio: playback.fullQueueEpisodeRatio,
      finalMissingInventoryRatio: evaluation.finalMissingInventory.ratio,
      finalMissingTargetRatio: evaluation.finalMissingTarget.ratio,
      finalMissingPhysicalAudioRatio:
        evaluation.finalMissingPhysicalAudio.ratio,
      finalMissingPlaybackAudibleRatio:
        evaluation.finalMissingPlaybackAudible.ratio,
      finalHallucinationPlaybackAudibleRatio:
        evaluation.finalHallucinationPlaybackAudible.ratio,
      route: route.route,
      productionStatus: "needs-review",
      finalizationMethod: "none",
      c602Status: "HOLD",
      canonicalMutationCount: 0,
      audioPayloadIncluded: false,
      dialoguePayloadIncluded: false,
      goldIntervalsIncluded: false,
      localPathsIncluded: false,
    }),
  ),
  shareableAudit = auditShareable144(shareable),
  shareableRoot = path.join(output, "shareable"),
  shareablePath = path.join(
    shareableRoot,
    "c6-0-1-14-4-shareable-acceptance-summary.json",
  ),
  shareableAuditPath = path.join(
    shareableRoot,
    "c6-0-1-14-4-shareable-audit.json",
  );
await mkdir(shareableRoot, { recursive: true });
await durableJson141(shareablePath, shareable);
await durableJson141(shareableAuditPath, shareableAudit);
check("SHAREABLE_AGGREGATE_BOUNDARY", shareableAudit.passed, shareableAudit);

const schemaMap: Record<string, z.ZodType> = {
    ...shared.c601144UtilitySchemas,
  },
  instances: { schemaId: string; file: string; value?: unknown }[] = [
    {
      schemaId: "c6-0-1-14-4-pre-gold-engineering-validation",
      file: arg("engineering-validation"),
      value: engineering,
    },
    {
      schemaId: "c6-0-1-14-4-browser-read-only-acceptance",
      file: arg("browser-audit"),
      value: browser,
    },
    {
      schemaId: "c6-0-1-14-4-first-gold-read-audit",
      file: path.join(evaluationRoot, "c6-0-1-14-4-first-gold-read-audit.json"),
      value: firstGoldRead,
    },
    {
      schemaId: "gold-c6-0-1-14-4-utility-selection-evaluation",
      file: path.join(
        evaluationRoot,
        "gold-c6-0-1-14-4-utility-selection-evaluation.json",
      ),
      value: evaluation,
    },
    {
      schemaId: "c6-0-1-14-4-route-decision",
      file: path.join(evaluationRoot, "c6-0-1-14-4-route-decision.json"),
      value: route,
    },
    {
      schemaId: "c6-0-1-14-4-post-freeze-evaluation-audit",
      file: path.join(
        evaluationRoot,
        "c6-0-1-14-4-post-freeze-evaluation-audit.local-only.json",
      ),
      value: postFreeze,
    },
    {
      schemaId: "c6-0-1-14-4-final-ab-parity",
      file: path.join(evaluationRoot, "c6-0-1-14-4-final-ab-parity.json"),
      value: parity,
    },
    {
      schemaId: "c6-0-1-14-4-shareable-acceptance-summary",
      file: shareablePath,
      value: shareable,
    },
    {
      schemaId: "c6-0-1-14-4-shareable-audit",
      file: shareableAuditPath,
      value: shareableAudit,
    },
  ];
const utilityFiles = {
  "c6-0-1-14-4-machine-evidence-utility-policy":
    "machine-artifacts/c6-0-1-14-4-machine-evidence-utility-policy.json",
  "machine-evidence-utility-pathology-audit":
    "machine-artifacts/machine-evidence-utility-pathology-audit.json",
  "c6-0-1-14-4-geometry-freeze":
    "machine-artifacts/c6-0-1-14-4-geometry-freeze.json",
  "machine-evidence-atom-utility-v1":
    "machine-artifacts/machine-evidence-atom-utility-v1.json",
  "machine-selectable-child-utility-v1":
    "machine-artifacts/machine-selectable-child-utility-v1.json",
  "machine-target-bundle-utility-v1":
    "machine-artifacts/machine-target-bundle-utility-v1.json",
  "machine-evidence-utility-propagation-ledger":
    "machine-artifacts/machine-evidence-utility-propagation-ledger.json",
  "machine-forced-inclusion-planner-results":
    "machine-artifacts/machine-forced-inclusion-planner-results.json",
  "machine-optional-speech-child-coverage-ledger":
    "machine-artifacts/machine-optional-speech-child-coverage-ledger.json",
  "machine-utility-aware-final-planner-certificate":
    "machine-artifacts/machine-utility-aware-final-planner-certificate.json",
  "machine-utility-plan-comparison":
    "machine-artifacts/machine-utility-plan-comparison.json",
  "machine-missing-safety-reserve-targets-v4":
    "machine-artifacts/machine-missing-safety-reserve-targets-v4.json",
} as const;
const deliveryFiles = {
  "machine-review-target-intervals-v6":
    "review-workspace/machine-review-target-intervals-v6.json",
  "machine-review-items-v8": "review-workspace/machine-review-items-v8.json",
  "machine-review-regions-v7":
    "review-workspace/machine-review-regions-v7.json",
  "machine-review-audio-manifest-v7":
    "review-workspace/machine-review-audio-manifest-v7.json",
  "machine-review-playback-timeline-v6":
    "review-workspace/machine-review-playback-timeline-v6.json",
} as const;
for (const directory of [finalA, finalB]) {
  for (const [schemaId, relative] of Object.entries(utilityFiles))
    instances.push({ schemaId, file: path.join(directory, relative) });
  for (const [schemaId, relative] of Object.entries(deliveryFiles))
    instances.push({ schemaId, file: path.join(directory, relative) });
  instances.push(
    {
      schemaId: "c6-0-1-14-4-nested-semantic-integrity-preflight",
      file: path.join(
        directory,
        "c6-0-1-14-4-nested-semantic-integrity-preflight.json",
      ),
    },
    {
      schemaId: "c6-0-1-14-4-machine-utility-selection-freeze",
      file: path.join(
        directory,
        "c6-0-1-14-4-machine-utility-selection-freeze.json",
      ),
    },
  );
}

const schemaResults: {
  schemaId: string;
  relativePath: string;
  valid: boolean;
  errorCount: number;
}[] = [];
for (const row of instances) {
  const value = row.value ?? (await readJson141(row.file)),
    zodSchema = required141(
      schemaMap[row.schemaId],
      `missing schema ${row.schemaId}`,
    ),
    zod = zodSchema.safeParse(value),
    generated = (await readJson141(
      path.join(process.cwd(), "schemas", `${row.schemaId}.schema.json`),
    )) as object,
    jsonSchema = shared.compileJsonSchema(generated),
    jsonPassed = jsonSchema(value);
  schemaResults.push({
    schemaId: row.schemaId,
    relativePath: safeRelative141(root, row.file),
    valid: zod.success && jsonPassed,
    errorCount:
      (zod.success ? 0 : zod.error.issues.length) +
      (jsonPassed ? 0 : (jsonSchema.errors?.length ?? 1)),
  });
}
check(
  "STRICT_ZOD_AND_GENERATED_JSON_SCHEMA",
  schemaResults.length >= 45 && schemaResults.every((row) => row.valid),
  schemaResults,
);

const stripAnsi = (value: string) => value.replace(/\u001b\[[0-9;]*m/gu, ""),
  vitestCount = (name: string) => {
    const content = stripAnsi(required141(engineeringLogs.get(name))),
      line = content.split(/\r?\n/u).find((row) => /^\s*Tests\s+/u.test(row));
    if (!line) throw new Error(`C601144_TEST_COUNT_MISSING:${name}`);
    const passed = /([0-9]+)\s+passed/u.exec(line),
      skipped = /([0-9]+)\s+skipped/u.exec(line);
    return {
      passed: passed ? Number(passed[1]) : 0,
      skipped: skipped ? Number(skipped[1]) : 0,
    };
  },
  unit = vitestCount("unit"),
  e2e = vitestCount("e2e"),
  targeted144 = vitestCount("c601144-targeted"),
  targeted1431 = vitestCount("c6011431-targeted-regression"),
  crossVersion = vitestCount("cross-version"),
  ui = vitestCount("review-ui"),
  generatedSchemaCount = (
    await readdir(path.join(process.cwd(), "schemas"))
  ).filter((name) => name.endsWith(".schema.json")).length;
const gitStatus = (
    await promisify(execFile)("git", ["status", "--porcelain"], {
      cwd: process.cwd(),
    })
  ).stdout.trim(),
  worktreeCleanAtValidation = gitStatus.length === 0;
check(
  "WORKTREE_STATUS_RECORDED",
  true,
  worktreeCleanAtValidation ? "CLEAN" : "DIRTY_DURING_PRECOMMIT_VALIDATION",
);

const passedCount = checks.filter((row) => row.passed).length,
  failedCount = checks.length - passedCount,
  validation = shared.validation144Schema.parse(
    hashed141({
      schemaVersion: "1.0.0",
      policyVersion: shared.version144Schema.value,
      visibility: "LOCAL_ONLY",
      artifactType: "c6-0-1-14-4-validation",
      routeDecisionHash: route.semanticHash,
      checks,
      passedCount,
      failedCount,
      schemaValidatedArtifactCount: schemaResults.length + 1,
      generatedSchemaCount,
      unitPassed: unit.passed,
      unitSkipped: unit.skipped,
      e2ePassed: e2e.passed,
      e2eSkipped: e2e.skipped,
      uiPassed: ui.passed,
      browserPassed: browser.checks.filter((row) => row.passed).length,
      targetedPassed: targeted144.passed + targeted1431.passed,
      crossVersionPassed: crossVersion.passed,
      skillValidationPassed,
      networkUsedForAcceptance: false,
      sourceReadOnlyVerified: postFreeze.sourceReadOnly,
      goldReadOnlyVerified: postFreeze.goldReadOnly,
      worktreeCleanAtValidation,
      engineeringPassed: failedCount === 0,
    }),
  );
const selfZod = shared.validation144Schema.safeParse(validation),
  selfJsonSchema = shared.compileJsonSchema(
    (await readJson141(
      path.join(process.cwd(), "schemas/c6-0-1-14-4-validation.schema.json"),
    )) as object,
  ),
  selfJsonPassed = selfJsonSchema(validation);
if (!selfZod.success || !selfJsonPassed)
  throw new Error("C601144_VALIDATION_SELF_SCHEMA_FAILED");
schemaResults.push({
  schemaId: "c6-0-1-14-4-validation",
  relativePath: safeRelative141(
    root,
    path.join(output, "c6-0-1-14-4-validation.json"),
  ),
  valid: true,
  errorCount: 0,
});
await durableJson141(
  path.join(output, "c6-0-1-14-4-schema-validation-results.local-only.json"),
  {
    schemaVersion: "1.0.0",
    artifactType: "c6-0-1-14-4-schema-validation-results.local-only",
    visibility: "LOCAL_ONLY",
    results: schemaResults,
  },
);
await durableJson141(
  path.join(output, "c6-0-1-14-4-validation.json"),
  validation,
);
console.log(
  JSON.stringify(
    {
      passed: validation.engineeringPassed,
      passedCount: validation.passedCount,
      failedCount: validation.failedCount,
      schemaValidatedArtifactCount: validation.schemaValidatedArtifactCount,
      generatedSchemaCount: validation.generatedSchemaCount,
      tests: { unit, e2e, ui, targeted144, targeted1431, crossVersion },
      browserPassed: validation.browserPassed,
      shareableAudit,
      route: route.route,
      worktreeCleanAtValidation,
    },
    null,
    2,
  ),
);
if (!validation.engineeringPassed) process.exitCode = 1;

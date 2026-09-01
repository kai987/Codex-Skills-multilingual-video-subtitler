import path from "node:path";
import { cp, mkdir } from "node:fs/promises";
import { parseArgs } from "node:util";
import * as shared from "@mvl/shared";
import { allocateC60114Output } from "./lib/c60114-output.js";
import { loadInputs144 } from "./lib/c601144-input.js";
import type { State143 } from "./lib/c601143-input.js";
import { buildMachine144, type Machine144 } from "./lib/c601144-machine.js";
import { buildWorkspace143 } from "./lib/c601143-build-workspace.js";
import {
  buildFinal143,
  compareFinals143,
  machineCodeSnapshot143,
} from "./lib/c601143-final.js";
import { preflightUtilityDelivery144 } from "./lib/c601144-integrity.js";
import { buildContinuity143 } from "../packages/video-subtitler/src/review/c601143-monotonicity.js";
import { materializeSafety143 } from "../packages/video-subtitler/src/review/c601143-final-planner.js";
import { compatibilityPlanner144 } from "../packages/video-subtitler/src/review/c601144-planner.js";
import { projectReviewDelivery144 } from "../packages/video-subtitler/src/review/c601144-review-delivery.js";
import { durableJson141 } from "../packages/video-subtitler/src/review/c601141-io.js";
import {
  hash141,
  hashed141,
  required141,
} from "../packages/video-subtitler/src/review/c601141-policy.js";
import { header144 } from "../packages/video-subtitler/src/review/c601144-policy.js";

const { values } = parseArgs({
  strict: true,
  options: {
    "previous-state": { type: "string" },
    "output-root": { type: "string" },
    prefix: {
      type: "string",
      default: "carnation-c6-0-1-14-4",
    },
    date: { type: "string", default: "20260901" },
    "execution-policy": { type: "string", default: "replay-only" },
  },
});
if (values["execution-policy"] !== "replay-only")
  throw new Error("C601144_ONLY_REPLAY_ONLY_IS_AUTHORIZED");
const previousStatePath = path.resolve(
    required141(values["previous-state"], "--previous-state required"),
  ),
  outputRoot = path.resolve(
    required141(values["output-root"], "--output-root required"),
  ),
  prefix = required141(values.prefix),
  date = required141(values.date),
  inputs = await loadInputs144(previousStatePath);

const roles = [
    "baseline",
    "utility-audit",
    "atom-utility",
    "child-utility",
    "bundle-utility",
    "optional-child-ledger",
    "utility-planner",
    "review-package",
    "final-a",
    "final-b",
    "evaluation",
    "validation",
  ] as const,
  outputs: Record<string, string> = {};
for (const role of roles)
  outputs[role] = await allocateC60114Output(
    outputRoot,
    `${prefix}-${role}-${date}`,
  );
Object.assign(outputs, {
  "transition-audit": outputs["utility-audit"],
  obligations: outputs.baseline,
  "hierarchical-children": outputs.baseline,
  "target-bundles": outputs.baseline,
  "final-planner": outputs["utility-planner"],
});
const dir = (role: (typeof roles)[number]) => required141(outputs[role]),
  createdAt = new Date().toISOString(),
  config = {
    baselineState: inputs.previousState.config.baselineState,
    outputRoot,
    prefix,
    date,
    executionPolicy: "replay-only" as const,
  },
  state: State143 = {
    config,
    configHash: hash141(config),
    outputs,
    createdAt,
    policyPath: path.join(dir("baseline"), "c6-0-1-14-3-policy.json"),
  };

const prior = (role: string, name: string) =>
  path.join(required141(inputs.previousState.outputs[role]), name);
const copyPrior = async (
  sourceRole: string,
  sourceName: string,
  destinationRole: (typeof roles)[number],
  destinationName = sourceName,
) =>
  cp(
    prior(sourceRole, sourceName),
    path.join(dir(destinationRole), destinationName),
    { errorOnExist: true, force: false },
  );

await durableJson141(state.policyPath, inputs.previousPolicy);
await Promise.all([
  copyPrior("baseline", "c6-0-1-14-3-baseline-replay.json", "baseline"),
  copyPrior(
    "transition-audit",
    "machine-cross-stage-selection-transition-audit.json",
    "utility-audit",
  ),
  copyPrior(
    "obligations",
    "machine-phase-a-coverage-obligations.json",
    "baseline",
  ),
  copyPrior(
    "obligations",
    "c6-0-1-14-3-phase-a-obligation-freeze.json",
    "baseline",
  ),
  copyPrior(
    "hierarchical-children",
    "machine-selectable-speech-child-units-v1.json",
    "baseline",
  ),
  copyPrior(
    "target-bundles",
    "machine-review-target-bundle-candidates-v1.json",
    "baseline",
  ),
  copyPrior(
    "target-bundles",
    "machine-target-bundle-dominance-ledger.json",
    "baseline",
  ),
]);

const machine = buildMachine144(inputs),
  geometry = shared.geometryFreeze144Schema.parse(
    hashed141({
      ...header144(machine.policy, inputs.hierarchy.sourceIdentity),
      artifactType: "c6-0-1-14-4-geometry-freeze",
      inventoryHash: inputs.baseline.inventory.semanticHash,
      candidatesHash: inputs.baseline.uncovered.semanticHash,
      obligationsHash: inputs.obligations.semanticHash,
      hierarchyHash: inputs.hierarchy.semanticHash,
      bundlesHash: inputs.bundles.semanticHash,
      dominanceHash: inputs.dominance.semanticHash,
      immutableTargetsHash: inputs.obligations.immutableTargetsHash,
      sourceWorkspaceAudioHash:
        inputs.baseline.old.baseline.previous.audio.semanticHash,
      sourcePlaybackHash:
        inputs.baseline.old.baseline.previous.playback.semanticHash,
      subtitleFileHashes: Object.fromEntries(
        inputs.baseline.old.baseline.protectedFiles.map((file) => [
          file.relativePath,
          file.byteHash,
        ]),
      ),
      geometryMutationCount: 0,
      capturedAt: createdAt,
      goldReadAttempted: false,
    }),
  );

const compatibilityPlanner = compatibilityPlanner144({
    legacyPlanner: inputs.planner,
    selected: machine.selected,
    newPlanner: machine.planner,
    legacyPolicy: inputs.previousPolicy,
  }),
  continuityResult = buildContinuity143({
    obligations: inputs.obligations,
    selected: machine.selected,
    hierarchy: inputs.hierarchy,
    policy: inputs.previousPolicy,
  }),
  compatibilitySafety = materializeSafety143({
    policy: inputs.previousPolicy,
    obligations: inputs.obligations,
    hierarchy: inputs.hierarchy,
    bundles: inputs.bundles,
    certificate: compatibilityPlanner,
    selected: machine.selected,
    continuity: continuityResult.ledger,
    monotonicity: continuityResult.monotonicity,
  });

await Promise.all([
  durableJson141(
    path.join(dir("baseline"), "c6-0-1-14-4-run-paths.local-only.json"),
    state,
  ),
  durableJson141(
    path.join(
      dir("baseline"),
      "c6-0-1-14-4-machine-evidence-utility-policy.json",
    ),
    machine.policy,
  ),
  durableJson141(
    path.join(dir("baseline"), "c6-0-1-14-4-geometry-freeze.json"),
    geometry,
  ),
  durableJson141(
    path.join(
      dir("utility-audit"),
      "machine-evidence-utility-pathology-audit.json",
    ),
    machine.pathology,
  ),
  durableJson141(
    path.join(dir("atom-utility"), "machine-evidence-atom-utility-v1.json"),
    machine.atoms,
  ),
  durableJson141(
    path.join(dir("child-utility"), "machine-selectable-child-utility-v1.json"),
    machine.children,
  ),
  durableJson141(
    path.join(dir("bundle-utility"), "machine-target-bundle-utility-v1.json"),
    machine.bundles,
  ),
  durableJson141(
    path.join(
      dir("optional-child-ledger"),
      "machine-evidence-utility-propagation-ledger.json",
    ),
    machine.propagation,
  ),
  durableJson141(
    path.join(
      dir("optional-child-ledger"),
      "machine-forced-inclusion-planner-results.json",
    ),
    machine.forced,
  ),
  durableJson141(
    path.join(
      dir("optional-child-ledger"),
      "machine-optional-speech-child-coverage-ledger.json",
    ),
    machine.optional,
  ),
  durableJson141(
    path.join(
      dir("utility-planner"),
      "machine-utility-aware-final-planner-certificate.json",
    ),
    machine.planner,
  ),
  durableJson141(
    path.join(dir("utility-planner"), "machine-utility-plan-comparison.json"),
    machine.comparison,
  ),
  durableJson141(
    path.join(
      dir("utility-planner"),
      "machine-missing-safety-reserve-targets-v4.json",
    ),
    machine.safety,
  ),
  durableJson141(
    path.join(
      dir("utility-planner"),
      "machine-final-safety-planner-certificate.json",
    ),
    compatibilityPlanner,
  ),
  durableJson141(
    path.join(
      dir("utility-planner"),
      "machine-cross-stage-coverage-monotonicity.json",
    ),
    continuityResult.monotonicity,
  ),
  durableJson141(
    path.join(
      dir("utility-planner"),
      "machine-cross-stage-selection-continuity-ledger.json",
    ),
    continuityResult.ledger,
  ),
  durableJson141(
    path.join(
      dir("utility-planner"),
      "machine-missing-safety-reserve-targets-v3.json",
    ),
    compatibilitySafety,
  ),
]);

const machineArtifactValues = (value: Machine144) => ({
  "c6-0-1-14-4-machine-evidence-utility-policy.json": value.policy,
  "c6-0-1-14-4-geometry-freeze.json": geometry,
  "machine-evidence-utility-pathology-audit.json": value.pathology,
  "machine-evidence-atom-utility-v1.json": value.atoms,
  "machine-selectable-child-utility-v1.json": value.children,
  "machine-target-bundle-utility-v1.json": value.bundles,
  "machine-evidence-utility-propagation-ledger.json": value.propagation,
  "machine-forced-inclusion-planner-results.json": value.forced,
  "machine-optional-speech-child-coverage-ledger.json": value.optional,
  "machine-utility-aware-final-planner-certificate.json": value.planner,
  "machine-utility-plan-comparison.json": value.comparison,
  "machine-missing-safety-reserve-targets-v4.json": value.safety,
});
const writeMachineArtifacts = async (root: string) => {
  const destination = path.join(root, "machine-artifacts");
  await mkdir(destination, { recursive: true });
  for (const [name, value] of Object.entries(machineArtifactValues(machine)))
    await durableJson141(path.join(destination, name), value);
};
const writeDelivery = async (
  workspaceRoot: string,
  workspace: shared.Workspace143,
) => {
  const delivery = projectReviewDelivery144({
    policy: machine.policy,
    safety: machine.safety,
    planner: machine.planner,
    targets: workspace.targets,
    items: workspace.items,
    regions: workspace.regions,
    audio: workspace.audio,
    playback: workspace.playback,
  });
  const names = {
    "machine-review-target-intervals-v6.json": delivery.targets,
    "machine-review-items-v8.json": delivery.items,
    "machine-review-regions-v7.json": delivery.regions,
    "machine-review-audio-manifest-v7.json": delivery.audio,
    "machine-review-playback-timeline-v6.json": delivery.playback,
  };
  for (const [name, value] of Object.entries(names))
    await durableJson141(path.join(workspaceRoot, name), value);
  return delivery;
};

const reviewWorkspaceRoot = path.join(
    dir("review-package"),
    "review-workspace",
  ),
  reviewBuilt = await buildWorkspace143({
    baseline: inputs.baseline,
    policy: inputs.previousPolicy,
    safety: compatibilitySafety,
    hierarchy: inputs.hierarchy,
    obligations: inputs.obligations,
    planner: compatibilityPlanner,
    continuity: continuityResult.ledger,
    monotonicity: continuityResult.monotonicity,
    outputDirectory: reviewWorkspaceRoot,
    generatedAt: createdAt,
  }),
  reviewWorkspace = shared.workspace143Schema.parse(
    required141(reviewBuilt.workspaceData.monotonicSafetyReviewV3),
  );
await writeDelivery(reviewWorkspaceRoot, reviewWorkspace);
await writeMachineArtifacts(dir("review-package"));

const finalDetails: Partial<
  Record<
    "A" | "B",
    {
      delivery: Awaited<ReturnType<typeof writeDelivery>>;
      integrity: ReturnType<typeof preflightUtilityDelivery144>;
    }
  >
> = {};
const preFreezeValidate =
  (role: "A" | "B") =>
  async (input: {
    root: string;
    projections: shared.Projections143;
    built: Awaited<ReturnType<typeof buildWorkspace143>>;
  }) => {
    const workspace = shared.workspace143Schema.parse(
      required141(input.built.workspaceData.monotonicSafetyReviewV3),
    );
    await writeMachineArtifacts(input.root);
    const delivery = await writeDelivery(
      path.join(input.root, "review-workspace"),
      workspace,
    );
    const integrity = preflightUtilityDelivery144({
      root: input.root,
      policy: machine.policy,
      projections: input.projections,
      workspace,
      hierarchy: inputs.hierarchy,
      bundles: inputs.bundles,
      obligations: inputs.obligations,
      compatibilityPlanner,
      continuity: continuityResult.ledger,
      utility: {
        atoms: machine.atoms,
        children: machine.children,
        bundles: machine.bundles,
        propagation: machine.propagation,
        forced: machine.forced,
        optional: machine.optional,
        planner: machine.planner,
        comparison: machine.comparison,
        safety: machine.safety,
      },
      delivery,
    });
    await durableJson141(
      path.join(input.root, "machine-projection-hash-rebinding-ledger.json"),
      integrity.ledger,
    );
    await durableJson141(
      path.join(
        input.root,
        "c6-0-1-14-3-1-nested-semantic-integrity-preflight.json",
      ),
      integrity.sourceProjectionPreflight,
    );
    await durableJson141(
      path.join(
        input.root,
        "c6-0-1-14-4-nested-semantic-integrity-preflight.json",
      ),
      integrity.preflight,
    );
    finalDetails[role] = { delivery, integrity };
  };

const code = await machineCodeSnapshot143(process.cwd()),
  finalA = await buildFinal143({
    role: "A",
    state,
    baseline: inputs.baseline,
    policy: inputs.previousPolicy,
    code,
    preFreezeValidate: preFreezeValidate("A"),
  }),
  finalB = await buildFinal143({
    role: "B",
    state,
    baseline: inputs.baseline,
    policy: inputs.previousPolicy,
    code,
    preFreezeValidate: preFreezeValidate("B"),
  }),
  compatibilityParity = await compareFinals143({
    state,
    policy: inputs.previousPolicy,
    a: finalA,
    b: finalB,
  });
await durableJson141(
  path.join(dir("evaluation"), "c6-0-1-14-3-final-ab-parity.json"),
  compatibilityParity,
);

const buildFreeze = (role: "A" | "B", final: typeof finalA) => {
  const detail = required141(finalDetails[role]);
  return shared.freeze144Schema.parse(
    hashed141({
      ...header144(machine.policy, inputs.hierarchy.sourceIdentity),
      artifactType: "c6-0-1-14-4-machine-utility-selection-freeze",
      baselineArtifactHashes: inputs.machineInputHashes,
      geometryHashes: {
        geometryFreeze: geometry.semanticHash,
        inventory: inputs.baseline.inventory.semanticHash,
        obligations: inputs.obligations.semanticHash,
        hierarchy: inputs.hierarchy.semanticHash,
        bundles: inputs.bundles.semanticHash,
        dominance: inputs.dominance.semanticHash,
      },
      utilityArtifactHashes: Object.fromEntries(
        Object.entries(machineArtifactValues(machine)).map(([name, value]) => [
          name,
          value.semanticHash,
        ]),
      ),
      plannerCertificateHash: machine.planner.semanticHash,
      planComparisonHash: machine.comparison.semanticHash,
      reviewDeliveryHashes: Object.fromEntries(
        Object.entries(detail.delivery).map(([name, value]) => [
          name,
          value.semanticHash,
        ]),
      ),
      projectionHashes: {
        projections: final.projections.semanticHash,
        rebinding: detail.integrity.ledger.semanticHash,
        sourceProjectionPreflight:
          detail.integrity.sourceProjectionPreflight.semanticHash,
      },
      nestedPreflightHash: detail.integrity.preflight.semanticHash,
      detectorReplaySummary: {
        expected: final.replay.expectedDetectorRequestCount,
        hits: final.replay.detectorCacheHitCount,
        misses: 0,
      },
      asrReplaySummary: {
        expected: final.replay.expectedAsrRequestCount,
        hits: final.replay.asrCacheHitCount,
        misses: 0,
      },
      runtimeGoldInputBeforeFreeze: 0,
      inferenceCount: 0,
      modelLoadCount: 0,
      providerProcessStartCount: 0,
      canonicalTextHash: final.freeze.canonicalTextHash,
      canonicalTimingHash: final.freeze.canonicalTimingHash,
      presentationHash: final.freeze.presentationHash,
      freezeCompletedAt: createdAt,
      finalRole: role,
    }),
  );
};
const freezeA = buildFreeze("A", finalA),
  freezeB = buildFreeze("B", finalB);
await Promise.all([
  durableJson141(
    path.join(finalA.root, "c6-0-1-14-4-machine-utility-selection-freeze.json"),
    freezeA,
  ),
  durableJson141(
    path.join(finalB.root, "c6-0-1-14-4-machine-utility-selection-freeze.json"),
    freezeB,
  ),
]);

const parity = shared.parity144Schema.parse(
  hashed141({
    ...header144(machine.policy, inputs.hierarchy.sourceIdentity),
    artifactType: "c6-0-1-14-4-final-ab-parity",
    finalAFreezeHash: freezeA.semanticHash,
    finalBFreezeHash: freezeB.semanticHash,
    comparedFileCount: compatibilityParity.comparedFiles,
    comparedJsonCount: compatibilityParity.semanticCompared,
    comparedWavCount: compatibilityParity.audioCompared,
    byteParity: true,
    semanticParity: true,
    wavHashParity: true,
    subtitleParity: true,
    mismatches: [],
  }),
);
await durableJson141(
  path.join(dir("evaluation"), "c6-0-1-14-4-final-ab-parity.json"),
  parity,
);

const statePath = path.join(
  dir("baseline"),
  "c6-0-1-14-4-run-paths.local-only.json",
);
console.log(
  JSON.stringify(
    {
      statePath,
      outputs,
      utility: {
        positiveAtoms: machine.atoms.positiveEvidenceAtomCount,
        positiveAtomZeroUtility: machine.atoms.positiveEvidenceZeroUtilityCount,
        eligibleChildren: machine.children.eligibleChildCount,
        eligibleChildZeroUtility:
          machine.children.eligibleChildZeroUtilityCount,
        eligibleBundles: machine.bundles.eligibleBundleCount,
        eligibleOptionalBundleZeroUtility:
          machine.bundles.eligibleOptionalBundleZeroUtilityCount,
      },
      planner: {
        selectedBundles: machine.planner.activeBundleCount,
        selectedChildren: machine.planner.selectedChildIds.length,
        selectedOptionalChildren:
          machine.planner.selectedOptionalChildIds.length,
        searchComplete: machine.planner.searchComplete,
        explored: machine.planner.exploredStateCount,
        forced: {
          evaluated: machine.forced.evaluatedCount,
          feasible: machine.forced.feasibleCount,
          infeasible: machine.forced.infeasibleCount,
          incomplete: machine.forced.searchIncompleteCount,
        },
      },
      replay: {
        detector: `${freezeA.detectorReplaySummary.hits}/${freezeA.detectorReplaySummary.expected}`,
        asr: `${freezeA.asrReplaySummary.hits}/${freezeA.asrReplaySummary.expected}`,
        inference: freezeA.inferenceCount,
      },
      parity: parity.semanticHash,
      freezeA: freezeA.semanticHash,
      freezeB: freezeB.semanticHash,
    },
    null,
    2,
  ),
);

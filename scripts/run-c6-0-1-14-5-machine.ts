import path from "node:path";
import { appendFile, cp, mkdir } from "node:fs/promises";
import { parseArgs } from "node:util";
import * as shared from "@mvl/shared";
import { allocateC60114Output } from "./lib/c60114-output.js";
import { loadInputs145 } from "./lib/c601145-input.js";
import { buildMachine145, type Machine145 } from "./lib/c601145-machine.js";
import type { State143 } from "./lib/c601143-input.js";
import { buildWorkspace143 } from "./lib/c601143-build-workspace.js";
import {
  buildFinal143,
  compareFinals143,
  machineCodeSnapshot143,
} from "./lib/c601143-final.js";
import { preflightCoverageDelivery145 } from "./lib/c601145-integrity.js";
import { buildContinuity143 } from "../packages/video-subtitler/src/review/c601143-monotonicity.js";
import { materializeSafety143 } from "../packages/video-subtitler/src/review/c601143-final-planner.js";
import { compatibilityPlanner145 } from "../packages/video-subtitler/src/review/c601145-unit-aware-planner.js";
import { projectReviewDelivery145 } from "../packages/video-subtitler/src/review/c601145-review-delivery.js";
import { durableJson141 } from "../packages/video-subtitler/src/review/c601141-io.js";
import {
  hash141,
  hashed141,
  required141,
} from "../packages/video-subtitler/src/review/c601141-policy.js";
import { header145 } from "../packages/video-subtitler/src/review/c601145-policy.js";
import { c601145WorkspaceJavascript } from "../packages/video-subtitler/src/review/c601145-review-workspace-ui.js";

const { values } = parseArgs({
  strict: true,
  options: {
    "previous-state": { type: "string" },
    "output-root": { type: "string" },
    prefix: { type: "string", default: "carnation-c6-0-1-14-5" },
    date: { type: "string", default: "20260902" },
    "execution-policy": { type: "string", default: "replay-only" },
  },
});
if (values["execution-policy"] !== "replay-only")
  throw new Error("C601145_ONLY_REPLAY_ONLY_IS_AUTHORIZED");
const previousStatePath = path.resolve(
    required141(values["previous-state"], "--previous-state required"),
  ),
  outputRoot = path.resolve(
    required141(values["output-root"], "--output-root required"),
  ),
  prefix = required141(values.prefix),
  date = required141(values.date),
  inputs = await loadInputs145(previousStatePath),
  roles = [
    "baseline",
    "segmentation-audit",
    "coverage-units",
    "unit-utility",
    "contract-policy",
    "realizations",
    "joint-feasibility",
    "unit-planner",
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
  "transition-audit": outputs["segmentation-audit"],
  obligations: outputs.baseline,
  "hierarchical-children": outputs.baseline,
  "target-bundles": outputs.baseline,
  "final-planner": outputs["unit-planner"],
});
const dir = (role: (typeof roles)[number]) => required141(outputs[role]),
  createdAt = new Date().toISOString(),
  config = {
    baselineState: previousStatePath,
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
    path.join(required141(inputs.previousState.outputs[role]), name),
  copyPrior = async (
    sourceRole: string,
    sourceName: string,
    destinationRole: (typeof roles)[number],
    destinationName = sourceName,
  ) =>
    cp(
      prior(sourceRole, sourceName),
      path.join(dir(destinationRole), destinationName),
      {
        errorOnExist: true,
        force: false,
      },
    );
await durableJson141(state.policyPath, inputs.previousPolicy);
await Promise.all([
  copyPrior("baseline", "c6-0-1-14-3-baseline-replay.json", "baseline"),
  copyPrior(
    "transition-audit",
    "machine-cross-stage-selection-transition-audit.json",
    "segmentation-audit",
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

const machine = buildMachine145(inputs),
  compatibilityPlanner = compatibilityPlanner145({
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
  }),
  machineArtifactValues = (value: Machine145) => ({
    "c6-0-1-14-5-safety-coverage-unit-policy.json": value.policy,
    "machine-segmentation-sensitivity-audit.json": value.segmentation,
    "machine-speech-safety-coverage-units-v1.json": value.units,
    "machine-speech-safety-coverage-unit-utility-v1.json": value.unitUtility,
    "machine-review-safety-contract-policy-v1.json": value.contractPolicy,
    "machine-coverage-unit-realization-candidates-v1.json": value.realizations,
    "machine-coverage-unit-realization-dominance-ledger.json":
      value.realizationDominance,
    "machine-coverage-unit-joint-feasibility-results.json":
      value.jointFeasibility,
    "machine-coverage-unit-aware-final-planner-certificate.json": value.planner,
    "machine-review-safety-contract-coverage-ledger.json": value.contractLedger,
    "machine-missing-safety-reserve-targets-v5.json": value.safety,
  }),
  writeMachineArtifacts = async (root: string) => {
    const destination = path.join(root, "machine-artifacts");
    await mkdir(destination, { recursive: true });
    for (const [name, value] of Object.entries(machineArtifactValues(machine)))
      await durableJson141(path.join(destination, name), value);
  };

await Promise.all([
  durableJson141(
    path.join(dir("baseline"), "c6-0-1-14-5-run-paths.local-only.json"),
    state,
  ),
  durableJson141(
    path.join(dir("baseline"), "c6-0-1-14-5-safety-coverage-unit-policy.json"),
    machine.policy,
  ),
  durableJson141(
    path.join(
      dir("segmentation-audit"),
      "machine-segmentation-sensitivity-audit.json",
    ),
    machine.segmentation,
  ),
  durableJson141(
    path.join(
      dir("coverage-units"),
      "machine-speech-safety-coverage-units-v1.json",
    ),
    machine.units,
  ),
  durableJson141(
    path.join(
      dir("unit-utility"),
      "machine-speech-safety-coverage-unit-utility-v1.json",
    ),
    machine.unitUtility,
  ),
  durableJson141(
    path.join(
      dir("contract-policy"),
      "machine-review-safety-contract-policy-v1.json",
    ),
    machine.contractPolicy,
  ),
  durableJson141(
    path.join(
      dir("realizations"),
      "machine-coverage-unit-realization-candidates-v1.json",
    ),
    machine.realizations,
  ),
  durableJson141(
    path.join(
      dir("realizations"),
      "machine-coverage-unit-realization-dominance-ledger.json",
    ),
    machine.realizationDominance,
  ),
  durableJson141(
    path.join(
      dir("joint-feasibility"),
      "machine-coverage-unit-joint-feasibility-results.json",
    ),
    machine.jointFeasibility,
  ),
  durableJson141(
    path.join(
      dir("unit-planner"),
      "machine-coverage-unit-aware-final-planner-certificate.json",
    ),
    machine.planner,
  ),
  durableJson141(
    path.join(
      dir("unit-planner"),
      "machine-review-safety-contract-coverage-ledger.json",
    ),
    machine.contractLedger,
  ),
  durableJson141(
    path.join(
      dir("unit-planner"),
      "machine-missing-safety-reserve-targets-v5.json",
    ),
    machine.safety,
  ),
  durableJson141(
    path.join(
      dir("unit-planner"),
      "machine-final-safety-planner-certificate.json",
    ),
    compatibilityPlanner,
  ),
  durableJson141(
    path.join(
      dir("unit-planner"),
      "machine-cross-stage-coverage-monotonicity.json",
    ),
    continuityResult.monotonicity,
  ),
  durableJson141(
    path.join(
      dir("unit-planner"),
      "machine-cross-stage-selection-continuity-ledger.json",
    ),
    continuityResult.ledger,
  ),
  durableJson141(
    path.join(
      dir("unit-planner"),
      "machine-missing-safety-reserve-targets-v3.json",
    ),
    compatibilitySafety,
  ),
]);

const writeDelivery = async (root: string, workspace: shared.Workspace143) => {
  const delivery = projectReviewDelivery145({
    policy: machine.policy,
    safety: machine.safety,
    planner: machine.planner,
    targets: workspace.targets,
    items: workspace.items,
    regions: workspace.regions,
    audio: workspace.audio,
    playback: workspace.playback,
    previousTargets: inputs.reviewTargetsV6,
  });
  const values = {
    "machine-review-target-intervals-v7.json": delivery.targets,
    "machine-review-items-v9.json": delivery.items,
    "machine-review-regions-v8.json": delivery.regions,
    "machine-review-audio-manifest-v8.json": delivery.audio,
    "machine-review-playback-timeline-v7.json": delivery.playback,
    "machine-missing-safety-reserve-targets-v5.json": machine.safety,
    "machine-speech-safety-coverage-units-v1.json": machine.units,
  };
  for (const [name, value] of Object.entries(values))
    await durableJson141(path.join(root, name), value);
  for (const name of [
    "machine-review-items-v9.json",
    "machine-review-target-intervals-v7.json",
    "machine-missing-safety-reserve-targets-v5.json",
    "machine-speech-safety-coverage-units-v1.json",
  ] as const)
    await durableJson141(
      path.join(root, "assets", "c601145", name),
      values[name],
    );
  await appendFile(
    path.join(root, "assets", "review.js"),
    c601145WorkspaceJavascript(),
    "utf8",
  );
  return delivery;
};

const reviewRoot = path.join(dir("review-package"), "review-workspace"),
  reviewBuilt = await buildWorkspace143({
    baseline: inputs.baseline,
    policy: inputs.previousPolicy,
    safety: compatibilitySafety,
    hierarchy: inputs.hierarchy,
    obligations: inputs.obligations,
    planner: compatibilityPlanner,
    continuity: continuityResult.ledger,
    monotonicity: continuityResult.monotonicity,
    outputDirectory: reviewRoot,
    generatedAt: createdAt,
  }),
  reviewWorkspace = shared.workspace143Schema.parse(
    required141(reviewBuilt.workspaceData.monotonicSafetyReviewV3),
  );
await writeDelivery(reviewRoot, reviewWorkspace);
await writeMachineArtifacts(dir("review-package"));

interface Detail {
  delivery: Awaited<ReturnType<typeof writeDelivery>>;
  integrity: ReturnType<typeof preflightCoverageDelivery145>;
}
const finalDetails: Partial<Record<"A" | "B", Detail>> = {},
  preFreezeValidate =
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
        ),
        integrity = preflightCoverageDelivery145({
          root: input.root,
          policy: machine.policy,
          projections: input.projections,
          workspace,
          hierarchy: inputs.hierarchy,
          bundles: inputs.bundles,
          obligations: inputs.obligations,
          compatibilityPlanner,
          compatibilitySafety,
          continuity: continuityResult.ledger,
          machine,
          delivery,
        });
      await Promise.all([
        durableJson141(
          path.join(
            input.root,
            "machine-projection-hash-rebinding-ledger-v145.json",
          ),
          integrity.projectionLedger,
        ),
        durableJson141(
          path.join(
            input.root,
            "c6-0-1-14-3-1-nested-semantic-integrity-preflight.json",
          ),
          integrity.sourcePreflight,
        ),
        durableJson141(
          path.join(
            input.root,
            "c6-0-1-14-5-nested-semantic-integrity-preflight.json",
          ),
          integrity.preflight,
        ),
      ]);
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

const subtitleFileHashes = Object.fromEntries(
    inputs.baseline.old.baseline.protectedFiles.map((file) => [
      file.relativePath,
      file.byteHash,
    ]),
  ),
  buildFreeze = (role: "A" | "B", final: typeof finalA) => {
    const detail = required141(finalDetails[role]);
    return shared.freeze145Schema.parse(
      hashed141({
        ...header145(machine.policy, inputs.hierarchy.sourceIdentity),
        artifactType: "c6-0-1-14-5-machine-safety-coverage-freeze",
        productGoContract: machine.policy.productGoContract,
        contractPolicyHash: machine.contractPolicy.semanticHash,
        baselineArtifactHashes: inputs.machineInputHashes,
        geometryHashes: {
          inventory: inputs.baseline.inventory.semanticHash,
          obligations: inputs.obligations.semanticHash,
          hierarchy: inputs.hierarchy.semanticHash,
          bundles: inputs.bundles.semanticHash,
          dominance: inputs.dominance.semanticHash,
        },
        coverageUnitHash: machine.units.semanticHash,
        unitUtilityHash: machine.unitUtility.semanticHash,
        realizationHash: machine.realizations.semanticHash,
        realizationDominanceHash: machine.realizationDominance.semanticHash,
        jointFeasibilityHash: machine.jointFeasibility.semanticHash,
        plannerCertificateHash: machine.planner.semanticHash,
        contractLedgerHash: machine.contractLedger.semanticHash,
        reviewDeliveryHashes: Object.fromEntries(
          Object.entries(detail.delivery).map(([name, value]) => [
            name,
            value.semanticHash,
          ]),
        ),
        projectionHashes: {
          projections: final.projections.semanticHash,
          rebinding: detail.integrity.projectionLedger.semanticHash,
          sourceProjectionPreflight:
            detail.integrity.sourcePreflight.semanticHash,
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
        subtitleFileHashes,
        freezeCompletedAt: createdAt,
        finalRole: role,
      }),
    );
  },
  freezeA = buildFreeze("A", finalA),
  freezeB = buildFreeze("B", finalB);
await Promise.all([
  durableJson141(
    path.join(finalA.root, "c6-0-1-14-5-machine-safety-coverage-freeze.json"),
    freezeA,
  ),
  durableJson141(
    path.join(finalB.root, "c6-0-1-14-5-machine-safety-coverage-freeze.json"),
    freezeB,
  ),
]);
const parity = shared.parity145Schema.parse(
  hashed141({
    ...header145(machine.policy, inputs.hierarchy.sourceIdentity),
    artifactType: "c6-0-1-14-5-final-ab-parity",
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
  path.join(dir("evaluation"), "c6-0-1-14-5-final-ab-parity.json"),
  parity,
);
console.log(
  JSON.stringify(
    {
      statePath: path.join(
        dir("baseline"),
        "c6-0-1-14-5-run-paths.local-only.json",
      ),
      outputs,
      machine: {
        coverageUnits: machine.units.coverageUnitCount,
        realizations: machine.realizations.candidateCount,
        selectedCoverageUnits: machine.planner.selectedCoverageUnitIds.length,
        selectedBundles: machine.planner.activeBundleCount,
        speechCoreUnionSeconds: machine.planner.speechCoreUnionSeconds,
        fullQueueEpisodeRatio: machine.planner.predictedFullQueueEpisodeRatio,
        jointRows: machine.jointFeasibility.rows.length,
        jointSearchIncomplete: machine.jointFeasibility.searchIncompleteCount,
      },
      replay: {
        detector: freezeA.detectorReplaySummary,
        asr: freezeA.asrReplaySummary,
        inference: 0,
      },
      freezeA: freezeA.semanticHash,
      freezeB: freezeB.semanticHash,
      parity: parity.semanticHash,
    },
    null,
    2,
  ),
);

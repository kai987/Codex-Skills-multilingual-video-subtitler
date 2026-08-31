import path from "node:path";
import {
  obligations143Schema,
  obligationFreeze143Schema,
  baseline143Schema,
  hierarchy143Schema,
  bundles143Schema,
  dominance143Schema,
  planner143Schema,
  continuity143Schema,
  monotonicity143Schema,
  safety143Schema,
  type Policy143,
} from "@mvl/shared";
import { allocateC60114Output } from "./c60114-output.js";
import {
  loadBaseline143,
  type Config143,
  type State143,
  type Baseline143,
} from "./c601143-input.js";
import {
  policy143,
  header143,
} from "../../packages/video-subtitler/src/review/c601143-policy.js";
import {
  buildCoverageObligations143,
  auditSelectionTransition143,
} from "../../packages/video-subtitler/src/review/c601143-coverage-obligations.js";
import { buildHierarchy143 } from "../../packages/video-subtitler/src/review/c601143-hierarchical-clusters.js";
import {
  buildTargetBundles143,
  pruneDominatedBundles143,
} from "../../packages/video-subtitler/src/review/c601143-target-bundles.js";
import {
  planFinalSafety143,
  materializeSafety143,
} from "../../packages/video-subtitler/src/review/c601143-final-planner.js";
import { buildContinuity143 } from "../../packages/video-subtitler/src/review/c601143-monotonicity.js";
import {
  durableJson141,
  fileHash141,
  readJson141,
} from "../../packages/video-subtitler/src/review/c601141-io.js";
import {
  hash141,
  hashed141,
  required141,
  assertHash141,
} from "../../packages/video-subtitler/src/review/c601141-policy.js";

export async function prepare143(config: Config143) {
  const baseline = await loadBaseline143(config),
    policy = policy143();
  const outputs: Record<string, string> = {};
  for (const role of [
    "baseline",
    "transition-audit",
    "obligations",
    "hierarchical-children",
    "target-bundles",
    "final-planner",
    "review-package",
    "evaluation",
    "final-a",
    "final-b",
    "validation",
  ])
    outputs[role] = await allocateC60114Output(
      config.outputRoot,
      `${config.prefix}-${role}-${config.date}`,
    );
  const dir = (role: string) => required141(outputs[role]);
  const state: State143 = {
    config,
    configHash: hash141(config),
    outputs,
    createdAt: new Date().toISOString(),
    policyPath: path.join(dir("baseline"), "c6-0-1-14-3-policy.json"),
  };
  await durableJson141(state.policyPath, policy);
  const obligations = buildCoverageObligations143({
    phaseA: baseline.phaseA,
    immutableTargets: baseline.old.baseline.previous.targets,
    policy,
  });
  const obligationPath = path.join(
    dir("obligations"),
    "machine-phase-a-coverage-obligations.json",
  );
  await durableJson141(obligationPath, obligations);
  const freeze = obligationFreeze143Schema.parse(
    hashed141({
      ...header143(policy, baseline.old.baseline.source),
      artifactType: "c6-0-1-14-3-phase-a-obligation-freeze",
      frozenAt: state.createdAt,
      obligationArtifactHash: obligations.semanticHash,
      obligationArtifactByteHash: await fileHash141(obligationPath),
      policyByteHash: await fileHash141(state.policyPath),
      phaseASelectionHash: baseline.phaseA.semanticHash,
      immutableTargetsHash: obligations.immutableTargetsHash,
      sourceReadOnlyIdentity: baseline.old.baseline.sourceBefore,
      goldReadStarted: false,
      inputBindings: baseline.inputBindings.sort((a, b) =>
        a.relativePath.localeCompare(b.relativePath),
      ),
    }),
  );
  await durableJson141(
    path.join(dir("obligations"), "c6-0-1-14-3-phase-a-obligation-freeze.json"),
    freeze,
  );
  const b = baseline.old.baseline;
  const baselineArtifact = baseline143Schema.parse(
    hashed141({
      ...header143(policy, b.source),
      artifactType: "c6-0-1-14-3-baseline-replay",
      baselineCommit: "c471182ff1f975e7399dbcc5d173d2b1b981dfa8",
      sourceReadOnlyIdentity: b.sourceBefore,
      previousFinalAHash: baseline.finalA.semanticHash,
      previousFinalBHash: baseline.finalB.semanticHash,
      phaseAHash: baseline.phaseA.semanticHash,
      combinedInventoryHash: baseline.inventory.semanticHash,
      canonicalTextHash: b.canonicalTextHash,
      canonicalTimingHash: b.canonicalTimingHash,
      presentationHash: b.presentationHash,
      machineCueCount: b.subtitlePackage.cues.length,
      phaseASafetyCount: baseline.phaseA.targets.length,
      phaseASafetyCoreSeconds: baseline.phaseA.summary.targetUnionSeconds,
      oldFinalSafetyCount: baseline.oldFinal.targets.length,
      oldFinalSafetyCoreSeconds: baseline.oldFinal.summary.targetUnionSeconds,
      immutableTargetCount: b.previous.targets.targets.length,
      immutableItemCount: b.previous.items.items.length,
      immutableRegionCount: b.previous.regions.regions.length,
      sourceAudioStreamIndex: b.source.audioStreamIndex,
      sourceNativeSampleRate: b.source.sampleRate,
      sourceDurationSeconds: b.source.durationSeconds,
      inferenceCount: 0,
      modelLoadCount: 0,
      providerProcessStartCount: 0,
      canonicalTextMutationCount: 0,
      canonicalTimingMutationCount: 0,
      presentationMutationCount: 0,
      productionStatus: "needs-review",
      finalizationMethod: "none",
      baselineGoldMetricsDeferredUntilPostFreezeEvaluator: true,
    }),
  );
  await durableJson141(
    path.join(dir("baseline"), "c6-0-1-14-3-baseline-replay.json"),
    baselineArtifact,
  );
  const audit = auditSelectionTransition143({
    baselineSafety: baseline.old.safety,
    phaseA: baseline.phaseA,
    inventory: baseline.inventory,
    oldFinal: baseline.oldFinal,
    policy,
  });
  await durableJson141(
    path.join(
      dir("transition-audit"),
      "machine-cross-stage-selection-transition-audit.json",
    ),
    audit,
  );
  const statePath = path.join(
    dir("baseline"),
    "c6-0-1-14-3-run-paths.local-only.json",
  );
  await durableJson141(statePath, state);
  return { state, statePath, baseline, policy, obligations, freeze, audit };
}

export async function select143(input: {
  state: State143;
  baseline: Baseline143;
  policy: Policy143;
}) {
  const { state, baseline, policy } = input,
    dir = (r: string) => required141(state.outputs[r]);
  const obligationPath = path.join(
    dir("obligations"),
    "machine-phase-a-coverage-obligations.json",
  );
  const obligations = obligations143Schema.parse(
    await readJson141(obligationPath),
  );
  const freeze = obligationFreeze143Schema.parse(
    await readJson141(
      path.join(
        dir("obligations"),
        "c6-0-1-14-3-phase-a-obligation-freeze.json",
      ),
    ),
  );
  [freeze, obligations].forEach(assertHash141);
  if (
    freeze.obligationArtifactHash !== obligations.semanticHash ||
    freeze.obligationArtifactByteHash !== (await fileHash141(obligationPath)) ||
    freeze.policyByteHash !== (await fileHash141(state.policyPath))
  )
    throw new Error("C601143_OBLIGATION_OR_POLICY_FREEZE_CHANGED");
  const hierarchy = buildHierarchy143({
    inventory: baseline.inventory,
    parents: baseline.parents,
    phaseA: baseline.phaseA,
    candidates: baseline.uncovered.candidates,
    obligations,
    policy,
    boundaries: baseline.boundaries,
    scores: baseline.scores,
    scoreTracksHash: baseline.scoreTracks.semanticHash,
  });
  await durableJson141(
    path.join(
      dir("hierarchical-children"),
      "machine-selectable-speech-child-units-v1.json",
    ),
    hierarchy,
  );
  const bundles = buildTargetBundles143({
    hierarchy,
    obligations,
    immutableAudioIntervals: baseline.immutableAudioIntervals,
    cueMasks: baseline.boundaries.finalCueMasks,
    policy,
  });
  const dominance = pruneDominatedBundles143({ bundles, policy });
  await durableJson141(
    path.join(
      dir("target-bundles"),
      "machine-review-target-bundle-candidates-v1.json",
    ),
    bundles,
  );
  await durableJson141(
    path.join(
      dir("target-bundles"),
      "machine-target-bundle-dominance-ledger.json",
    ),
    dominance,
  );
  const planned = planFinalSafety143({
    hierarchy,
    obligations,
    bundles,
    dominance,
    policy,
  });
  await durableJson141(
    path.join(
      dir("final-planner"),
      "machine-final-safety-planner-certificate.json",
    ),
    planned.certificate,
  );
  const { monotonicity, ledger } = buildContinuity143({
    obligations,
    selected: planned.selected,
    hierarchy,
    policy,
  });
  await durableJson141(
    path.join(
      dir("final-planner"),
      "machine-cross-stage-coverage-monotonicity.json",
    ),
    monotonicity,
  );
  await durableJson141(
    path.join(
      dir("final-planner"),
      "machine-cross-stage-selection-continuity-ledger.json",
    ),
    ledger,
  );
  if (!planned.certificate.feasibilityWitnessVerified)
    throw new Error(`C601143_HOLD_${planned.certificate.feasibilityStatus}`);
  const safety = materializeSafety143({
    policy,
    obligations,
    hierarchy,
    bundles,
    certificate: planned.certificate,
    selected: planned.selected,
    continuity: ledger,
    monotonicity,
  });
  await durableJson141(
    path.join(
      dir("final-planner"),
      "machine-missing-safety-reserve-targets-v3.json",
    ),
    safety,
  );
  return {
    hierarchy,
    bundles,
    dominance,
    ...planned,
    monotonicity,
    ledger,
    safety,
  };
}

export async function loadSelection143(state: State143) {
  const read = (role: string, name: string) =>
    readJson141(path.join(required141(state.outputs[role]), name));
  const result = {
    obligations: obligations143Schema.parse(
      await read("obligations", "machine-phase-a-coverage-obligations.json"),
    ),
    hierarchy: hierarchy143Schema.parse(
      await read(
        "hierarchical-children",
        "machine-selectable-speech-child-units-v1.json",
      ),
    ),
    bundles: bundles143Schema.parse(
      await read(
        "target-bundles",
        "machine-review-target-bundle-candidates-v1.json",
      ),
    ),
    dominance: dominance143Schema.parse(
      await read(
        "target-bundles",
        "machine-target-bundle-dominance-ledger.json",
      ),
    ),
    planner: planner143Schema.parse(
      await read(
        "final-planner",
        "machine-final-safety-planner-certificate.json",
      ),
    ),
    continuity: continuity143Schema.parse(
      await read(
        "final-planner",
        "machine-cross-stage-selection-continuity-ledger.json",
      ),
    ),
    monotonicity: monotonicity143Schema.parse(
      await read(
        "final-planner",
        "machine-cross-stage-coverage-monotonicity.json",
      ),
    ),
    safety: safety143Schema.parse(
      await read(
        "final-planner",
        "machine-missing-safety-reserve-targets-v3.json",
      ),
    ),
  };
  Object.values(result).forEach(assertHash141);
  return result;
}

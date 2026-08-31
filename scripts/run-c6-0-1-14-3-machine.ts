import { parseArgs } from "node:util";
import { state143Schema, policy143Schema } from "@mvl/shared";
import { config143Schema, loadBaseline143 } from "./lib/c601143-input.js";
import path from "node:path";
import {
  prepare143,
  select143,
  loadSelection143,
} from "./lib/c601143-selection.js";
import { buildWorkspace143 } from "./lib/c601143-build-workspace.js";
import { exactReplay143 } from "./lib/c601143-replay.js";
import {
  machineCodeSnapshot143,
  buildFinal143,
  compareFinals143,
} from "./lib/c601143-final.js";
import { durableJson141 } from "../packages/video-subtitler/src/review/c601141-io.js";
import { readJson141 } from "../packages/video-subtitler/src/review/c601141-io.js";
import {
  hash141,
  required141,
} from "../packages/video-subtitler/src/review/c601141-policy.js";

const { values } = parseArgs({
  strict: true,
  options: {
    config: { type: "string" },
    state: { type: "string" },
    phase: { type: "string" },
    "execution-policy": { type: "string", default: "replay-only" },
  },
});
if (values["execution-policy"] !== "replay-only")
  throw new Error("C601143_ONLY_REPLAY_ONLY_IS_AUTHORIZED");
if (values.phase === "prepare") {
  const config = config143Schema.parse(
    await readJson141(required141(values.config, "--config required")),
  );
  const prepared = await prepare143(config);
  console.log(
    JSON.stringify({
      phase: "prepare",
      statePath: prepared.statePath,
      phaseATargets: prepared.obligations.phaseATargetCount,
      obligations: prepared.obligations.obligations.length,
      phaseACoreSeconds: prepared.obligations.totalCoreUnionSeconds,
      oldFinalDroppedSeconds:
        prepared.audit.phaseARegressedNativeSamples /
        prepared.obligations.sourceIdentity.sampleRate,
      inferenceCount: 0,
      goldInputCount: 0,
    }),
  );
} else if (values.phase === "select" || values.phase === "select-review") {
  const state = state143Schema.parse(
    await readJson141(required141(values.state, "--state required")),
  );
  if (hash141(state.config) !== state.configHash)
    throw new Error("C601143_CONFIG_CHANGED");
  const policy = policy143Schema.parse(await readJson141(state.policyPath));
  const baseline = await loadBaseline143(state.config);
  const result = await select143({ state, policy, baseline });
  console.log(
    JSON.stringify({
      phase: "select",
      hierarchy: result.hierarchy.summary,
      bundles: result.bundles.summary,
      certificate: {
        status: result.certificate.feasibilityStatus,
        states: result.certificate.exploredStateCount,
        pruned: result.certificate.prunedStateCount,
        objective: result.certificate.objectiveVector,
        hash: result.certificate.semanticHash,
      },
      monotonicity: {
        passed: result.monotonicity.monotonicityPassed,
        coverageRatio: result.monotonicity.obligationCoverageRatio,
        uncoveredSamples: result.monotonicity.uncoveredNativeSamples,
      },
      safety: result.safety.summary,
    }),
  );
  if (values.phase === "select-review") {
    const selected = await loadSelection143(state);
    const built = await buildWorkspace143({
      ...selected,
      policy,
      baseline,
      outputDirectory: path.join(
        required141(state.outputs["review-package"]),
        "review-workspace",
      ),
      generatedAt: state.createdAt,
    });
    console.log(
      JSON.stringify({
        phase: "review",
        physical: built.physical,
        fullQueueSeconds:
          built.playback.nativeFullQueueSamples /
          built.playback.sourceIdentity.sampleRate,
        childCoverage: built.audio.childCoreCoverage.every(
          (c) => c.coveragePassed,
        ),
        bundleCoverage: built.audio.bundleCoreCoverage.every(
          (c) => c.coveragePassed,
        ),
      }),
    );
  }
} else if (values.phase === "replay") {
  const state = state143Schema.parse(
    await readJson141(required141(values.state, "--state required")),
  );
  if (hash141(state.config) !== state.configHash)
    throw new Error("C601143_CONFIG_CHANGED");
  const policy = policy143Schema.parse(await readJson141(state.policyPath));
  const result = await exactReplay143({
    baseline: await loadBaseline143(state.config),
    policy,
    executionPolicy: state.config.executionPolicy,
    outputDirectory: path.join(
      required141(state.outputs.baseline),
      "exact-cache-replay",
    ),
  });
  console.log(JSON.stringify(result));
} else if (values.phase === "final-dual") {
  const state = state143Schema.parse(
    await readJson141(required141(values.state, "--state required")),
  );
  if (hash141(state.config) !== state.configHash)
    throw new Error("C601143_CONFIG_CHANGED");
  const policy = policy143Schema.parse(await readJson141(state.policyPath)),
    baseline = await loadBaseline143(state.config),
    code = await machineCodeSnapshot143(process.cwd());
  const a = await buildFinal143({ role: "A", state, baseline, policy, code }),
    b = await buildFinal143({ role: "B", state, baseline, policy, code }),
    parity = await compareFinals143({ state, policy, a, b });
  const parityPath = path.join(
    required141(state.outputs.evaluation),
    "c6-0-1-14-3-final-ab-parity.json",
  );
  await durableJson141(parityPath, parity);
  console.log(
    JSON.stringify({
      phase: "final-dual",
      finalA: a.freeze.semanticHash,
      finalB: b.freeze.semanticHash,
      code: code.semanticHash,
      parity: parity.semanticHash,
      comparedFiles: parity.comparedFiles,
      audioCompared: parity.audioCompared,
      parityPath,
    }),
  );
} else if (values.phase === "review") {
  const state = state143Schema.parse(
    await readJson141(required141(values.state, "--state required")),
  );
  if (hash141(state.config) !== state.configHash)
    throw new Error("C601143_CONFIG_CHANGED");
  const policy = policy143Schema.parse(await readJson141(state.policyPath)),
    selection = await loadSelection143(state);
  const built = await buildWorkspace143({
    ...selection,
    policy,
    baseline: await loadBaseline143(state.config),
    outputDirectory: path.join(
      required141(state.outputs["review-package"]),
      "review-workspace",
    ),
    generatedAt: state.createdAt,
  });
  console.log(
    JSON.stringify({
      phase: "review",
      targets: built.graph.targets.summary,
      items: built.graph.items.summary,
      regions: built.graph.regions.summary,
      physical: built.physical,
      fullQueueSeconds:
        built.playback.nativeFullQueueSamples /
        built.playback.sourceIdentity.sampleRate,
      fullQueueRatio: built.playback.fullQueueEpisodeRatio,
      childCoverage: built.audio.childCoreCoverage.every(
        (c) => c.coveragePassed,
      ),
      bundleCoverage: built.audio.bundleCoreCoverage.every(
        (c) => c.coveragePassed,
      ),
    }),
  );
} else throw new Error("C601143_EXPECTED_PHASE_PREPARE_SELECT_OR_REVIEW");

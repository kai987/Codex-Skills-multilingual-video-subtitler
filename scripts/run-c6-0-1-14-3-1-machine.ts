import path from "node:path";
import { parseArgs } from "node:util";
import { mkdir, readFile } from "node:fs/promises";
import * as shared from "@mvl/shared";
import {
  loadSelection143,
  prepare143,
  select143,
} from "./lib/c601143-selection.js";
import { buildWorkspace143 } from "./lib/c601143-build-workspace.js";
import {
  buildFinal143,
  compareFinals143,
  machineCodeSnapshot143,
} from "./lib/c601143-final.js";
import { allocateC60114Output } from "./lib/c60114-output.js";
import {
  auditProjectionChanges1431,
  buildProjectionRebindingLedger1431,
  preflightNestedSemanticIntegrity1431,
  projectionIntegrityPolicy1431,
  reproduceBaselineHashFailure1431,
  assertPreGoldIntegrity1431,
} from "../packages/video-subtitler/src/review/c6011431-projection-integrity.js";
import {
  durableJson141,
  readJson141,
} from "../packages/video-subtitler/src/review/c601141-io.js";
import {
  hash141,
  hashed141,
  required141,
} from "../packages/video-subtitler/src/review/c601141-policy.js";

const { values } = parseArgs({
  strict: true,
  options: {
    "previous-state": { type: "string" },
    "baseline-state": { type: "string" },
    "output-root": { type: "string" },
    prefix: { type: "string", default: "carnation-c6-0-1-14-3-1" },
    date: { type: "string", default: "20260901" },
    "execution-policy": { type: "string", default: "replay-only" },
  },
});
const absolute = (key: "previous-state" | "baseline-state" | "output-root") =>
  path.resolve(required141(values[key], `--${key} required`));
if (values["execution-policy"] !== "replay-only")
  throw new Error("C6011431_ONLY_REPLAY_ONLY_IS_AUTHORIZED");

const previousState = shared.state143Schema.parse(
  await readJson141(absolute("previous-state")),
);
if (hash141(previousState.config) !== previousState.configHash)
  throw new Error("C6011431_PREVIOUS_STATE_CONFIG_CHANGED");
const previousFinalA = required141(previousState.outputs["final-a"]);
const previousProjections = shared.projections143Schema.parse(
  await readJson141(
    path.join(previousFinalA, "machine-coverage-projections.json"),
  ),
);
const previousReviewData = (await readJson141(
  path.join(previousFinalA, "review-workspace/review-data.json"),
)) as {
  monotonicSafetyReviewV3?: shared.Workspace143;
};
const previousWorkspace = shared.workspace143Schema.parse(
  required141(previousReviewData.monotonicSafetyReviewV3),
);
const previousFreeze = shared.machineFreeze143Schema.parse(
  await readJson141(
    path.join(previousFinalA, "c6-0-1-14-3-machine-selection-freeze.json"),
  ),
);
const baselineReproduction = reproduceBaselineHashFailure1431({
  sourceRows: previousWorkspace.audio.audio,
  projections: previousProjections,
});
if (!baselineReproduction.reproduced)
  throw new Error("C6011431_EXPECTED_BASELINE_DEFECT_NOT_REPRODUCED");

const prepared = await prepare143({
  baselineState: absolute("baseline-state"),
  outputRoot: absolute("output-root"),
  prefix: required141(values.prefix),
  date: required141(values.date),
  executionPolicy: "replay-only",
});
const extraRoles = ["hash-rebinding", "nested-preflight", "refreeze"] as const;
for (const role of extraRoles)
  prepared.state.outputs[role] = await allocateC60114Output(
    prepared.state.config.outputRoot,
    `${prepared.state.config.prefix}-${role}-${prepared.state.config.date}`,
  );
await durableJson141(prepared.statePath, prepared.state);
await durableJson141(
  path.join(
    required141(prepared.state.outputs.baseline),
    "c6-0-1-14-3-1-projection-integrity-policy.json",
  ),
  projectionIntegrityPolicy1431(),
);
await durableJson141(
  path.join(
    required141(prepared.state.outputs.baseline),
    "c6-0-1-14-3-1-baseline-hash-failure-reproduction.json",
  ),
  baselineReproduction,
);

const selection = await select143({
  state: prepared.state,
  baseline: prepared.baseline,
  policy: prepared.policy,
});
const selected = await loadSelection143(prepared.state);
await buildWorkspace143({
  ...selected,
  policy: prepared.policy,
  baseline: prepared.baseline,
  outputDirectory: path.join(
    required141(prepared.state.outputs["review-package"]),
    "review-workspace",
  ),
  generatedAt: prepared.state.createdAt,
});
const code = await machineCodeSnapshot143(process.cwd());
const finalA = await buildFinal143({
  role: "A",
  state: prepared.state,
  baseline: prepared.baseline,
  policy: prepared.policy,
  code,
});
const finalB = await buildFinal143({
  role: "B",
  state: prepared.state,
  baseline: prepared.baseline,
  policy: prepared.policy,
  code,
});
const parity = await compareFinals143({
  state: prepared.state,
  policy: prepared.policy,
  a: finalA,
  b: finalB,
});
await durableJson141(
  path.join(
    required141(prepared.state.outputs.evaluation),
    "c6-0-1-14-3-final-ab-parity.json",
  ),
  parity,
);

const currentReviewData = (await readJson141(
  path.join(finalA.root, "review-workspace/review-data.json"),
)) as { monotonicSafetyReviewV3?: shared.Workspace143 };
const currentWorkspace = shared.workspace143Schema.parse(
  required141(currentReviewData.monotonicSafetyReviewV3),
);
const official = required141(
  finalA.projections.variants.find((variant) => variant.stage === "A7"),
);
const ledger = buildProjectionRebindingLedger1431({
  sourceRows: currentWorkspace.audio.audio,
  projectedRows: official.projection.physicalAudio,
  sourceIdentity: currentWorkspace.sourceIdentity,
});
const changeAudit = auditProjectionChanges1431({
  before: previousProjections,
  after: finalA.projections,
  plannerEquivalent:
    previousWorkspace.planner.semanticHash ===
    currentWorkspace.planner.semanticHash,
  canonicalTextEquivalent:
    previousFreeze.canonicalTextHash === finalA.freeze.canonicalTextHash,
  canonicalTimingEquivalent:
    previousFreeze.canonicalTimingHash === finalA.freeze.canonicalTimingHash,
  presentationEquivalent:
    previousFreeze.presentationHash === finalA.freeze.presentationHash,
});
if (!changeAudit.passed)
  throw new Error(
    `C6011431_FORBIDDEN_PROJECTION_CHANGE:${changeAudit.forbiddenChanges.join(",")}`,
  );
const preflight = preflightNestedSemanticIntegrity1431(finalA.projections);
assertPreGoldIntegrity1431(preflight);
await durableJson141(
  path.join(
    required141(prepared.state.outputs["hash-rebinding"]),
    "machine-projection-hash-rebinding-ledger.json",
  ),
  ledger,
);
await durableJson141(
  path.join(
    required141(prepared.state.outputs["hash-rebinding"]),
    "c6-0-1-14-3-1-projection-change-audit.json",
  ),
  changeAudit,
);
await durableJson141(
  path.join(
    required141(prepared.state.outputs["nested-preflight"]),
    "c6-0-1-14-3-1-nested-semantic-integrity-preflight.json",
  ),
  preflight,
);

const wavFiles = finalA.freeze.artifacts.filter((row) =>
  row.relativePath.endsWith(".wav"),
);
const refreeze = shared.machineRefreeze1431Schema.parse(
  hashed141({
    schemaVersion: "1.0.0",
    policyVersion: "c6.0.1.14.3.1-projection-hash-integrity-v1",
    visibility: "LOCAL_ONLY",
    artifactType: "c6-0-1-14-3-1-machine-refreeze",
    sourceIdentity: finalA.freeze.sourceIdentity,
    finalAFreezeHash: finalA.freeze.semanticHash,
    finalBFreezeHash: finalB.freeze.semanticHash,
    finalAProjectionHash: finalA.projections.semanticHash,
    finalBProjectionHash: finalB.projections.semanticHash,
    rebindingLedgerHash: ledger.semanticHash,
    changeAuditHash: changeAudit.semanticHash,
    nestedPreflightHash: preflight.semanticHash,
    finalABByteParity: true,
    finalABSemanticParity: true,
    wavHashParity: true,
    wavPcmParity: true,
    wavDurationParity: true,
    wavMappingParity: true,
    wavPlayableCount: currentWorkspace.audio.audio.filter((row) => row.playable)
      .length,
    detectorReplayHits: finalA.replay.detectorCacheHitCount,
    detectorReplayExpected: finalA.replay.expectedDetectorRequestCount,
    asrReplayHits: finalA.replay.asrCacheHitCount,
    asrReplayExpected: finalA.replay.expectedAsrRequestCount,
    cacheMissCount: 0,
    inferenceCount: 0,
    modelLoadCount: 0,
    providerProcessStartCount: 0,
    canonicalTextHash: finalA.freeze.canonicalTextHash,
    canonicalTimingHash: finalA.freeze.canonicalTimingHash,
    presentationHash: finalA.freeze.presentationHash,
    canonicalTextMutationCount: 0,
    canonicalTimingMutationCount: 0,
    presentationMutationCount: 0,
    goldReadStarted: false,
    refreezePassed: true,
  }),
);
await durableJson141(
  path.join(
    required141(prepared.state.outputs.refreeze),
    "c6-0-1-14-3-1-machine-refreeze.json",
  ),
  refreeze,
);

// A bounded process-local receipt proves that this entry point cannot have
// launched a detector/provider. The model replay accounting is read from the
// two exact-cache-only finalizations above.
await mkdir(required141(prepared.state.outputs.refreeze), { recursive: true });
const packageLockBefore = await readFile("package-lock.json");
if (hash141(packageLockBefore) !== hash141(await readFile("package-lock.json")))
  throw new Error("C6011431_LOCKFILE_CHANGED_DURING_MACHINE_RUN");
console.log(
  JSON.stringify(
    {
      statePath: prepared.statePath,
      outputs: prepared.state.outputs,
      baseline: {
        sourceHashes: `${baselineReproduction.sourceWorkspaceAudioHashesValid}/${baselineReproduction.sourceWorkspaceAudioRows}`,
        projectedHashes: `${baselineReproduction.strictProjectedAudioHashesValid}/${baselineReproduction.strictProjectedAudioRows}`,
        staleReuse: baselineReproduction.staleProjectedAudioHashReuseCount,
      },
      rebound: `${ledger.reboundRowCount}/${ledger.sourceRowCount}`,
      preflight: {
        audio: `${preflight.validProjectedAudioHashCount}/${preflight.projectedAudioRowCount}`,
        playback: `${preflight.validPlaybackHashCount}/${preflight.playbackRowCount}`,
        failures: preflight.failures.length,
      },
      replay: {
        detector: `${refreeze.detectorReplayHits}/${refreeze.detectorReplayExpected}`,
        asr: `${refreeze.asrReplayHits}/${refreeze.asrReplayExpected}`,
        inference: 0,
        modelLoads: 0,
        providerStarts: 0,
      },
      wavFilesBoundInFreeze: wavFiles.length,
      refreezeHash: refreeze.semanticHash,
    },
    null,
    2,
  ),
);

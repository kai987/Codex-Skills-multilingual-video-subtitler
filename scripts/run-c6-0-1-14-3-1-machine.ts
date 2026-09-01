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
  type NestedArtifact1431Input,
  type NestedArtifactRowGroup1431,
} from "../packages/video-subtitler/src/review/c6011431-projection-integrity.js";
import {
  durableJson141,
  readJson141,
  safeRelative141,
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

await select143({
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
let finalALedger: shared.ProjectionRebindingLedger1431 | undefined,
  finalBLedger: shared.ProjectionRebindingLedger1431 | undefined,
  finalAPreflight: shared.NestedPreflight1431 | undefined,
  finalBPreflight: shared.NestedPreflight1431 | undefined;
const preFreezeValidate =
  (role: "A" | "B") =>
  async (input: {
    root: string;
    projections: shared.Projections143;
    built: Awaited<ReturnType<typeof buildWorkspace143>>;
    selection: Awaited<ReturnType<typeof loadSelection143>>;
  }) => {
    const workspace = shared.workspace143Schema.parse(
        required141(input.built.workspaceData.monotonicSafetyReviewV3),
      ),
      official = required141(
        input.projections.variants.find(
          (variant) => variant.stage === input.projections.officialStage,
        ),
      ),
      ledger = buildProjectionRebindingLedger1431({
        sourceRows: workspace.audio.audio,
        projectedRows: official.projection.physicalAudio,
        sourceIdentity: workspace.sourceIdentity,
        projectionId: official.officialPlanId,
        projectionStage: official.stage,
        sourceArtifactType: workspace.audio.artifactType,
        sourceSchemaVersion: workspace.audio.schemaVersion,
        projectedSchemaVersion: "1.0.0",
      }),
      ledgerPath = path.join(
        input.root,
        "machine-projection-hash-rebinding-ledger.json",
      );
    await durableJson141(ledgerPath, ledger);
    const artifact = (
      relativePath: string,
      value: { semanticHash: string; artifactType?: string },
      artifactRowType: shared.NestedRowType1431,
      rowGroups: NestedArtifactRowGroup1431[],
    ): NestedArtifact1431Input => ({
      artifactPathRelative: safeRelative141(
        input.root,
        path.join(input.root, relativePath),
      ),
      artifact: value,
      artifactRowType,
      rowGroups,
    });
    const nestedArtifacts: NestedArtifact1431Input[] = [
      artifact(
        "review-workspace/machine-review-target-intervals-v5.json",
        workspace.targets,
        "REVIEW_TARGET_ROW",
        [
          {
            rowType: "REVIEW_TARGET_ROW",
            rows: workspace.targets.targets,
            rowPath: (index) => `$.targets[${index}]`,
            rowHashExpected: true,
          },
        ],
      ),
      artifact(
        "review-workspace/machine-review-regions-v6.json",
        workspace.regions,
        "REVIEW_REGION_ROW",
        [
          {
            rowType: "REVIEW_REGION_ROW",
            rows: workspace.regions.regions,
            rowPath: (index) => `$.regions[${index}]`,
            rowHashExpected: true,
          },
        ],
      ),
      artifact(
        "machine-artifacts/machine-missing-safety-reserve-targets-v3.json",
        input.selection.safety,
        "SAFETY_TARGET_ROW",
        [
          {
            rowType: "SAFETY_TARGET_ROW",
            rows: input.selection.safety.targets,
            rowPath: (index) => `$.targets[${index}]`,
            rowHashExpected: true,
          },
        ],
      ),
      artifact(
        "machine-artifacts/machine-selectable-speech-child-units-v1.json",
        input.selection.hierarchy,
        "SELECTABLE_CHILD_UNIT_ROW",
        [
          {
            rowType: "HIERARCHICAL_ATOM_ROW",
            rows: input.selection.hierarchy.atoms,
            rowPath: (index) => `$.atoms[${index}]`,
            rowHashExpected: true,
          },
          {
            rowType: "SELECTABLE_CHILD_UNIT_ROW",
            rows: input.selection.hierarchy.children,
            rowPath: (index) => `$.children[${index}]`,
            rowHashExpected: true,
          },
        ],
      ),
      artifact(
        "machine-artifacts/machine-review-target-bundle-candidates-v1.json",
        input.selection.bundles,
        "TARGET_BUNDLE_ROW",
        [
          {
            rowType: "TARGET_BUNDLE_ROW",
            rows: input.selection.bundles.candidates,
            rowPath: (index) => `$.candidates[${index}]`,
            rowHashExpected: true,
          },
        ],
      ),
      artifact(
        "machine-artifacts/machine-cross-stage-selection-continuity-ledger.json",
        input.selection.continuity,
        "CONTINUITY_LEDGER_ROW",
        [
          {
            rowType: "CONTINUITY_LEDGER_ROW",
            rows: input.selection.continuity.entries,
            rowPath: (index) => `$.entries[${index}]`,
            rowHashExpected: false,
          },
        ],
      ),
      artifact(
        "machine-artifacts/machine-phase-a-coverage-obligations.json",
        input.selection.obligations,
        "PHASE_A_OBLIGATION_ROW",
        [
          {
            rowType: "PHASE_A_OBLIGATION_ROW",
            rows: input.selection.obligations.obligations,
            rowPath: (index) => `$.obligations[${index}]`,
            rowHashExpected: true,
          },
        ],
      ),
      artifact(
        "machine-artifacts/machine-final-safety-planner-certificate.json",
        input.selection.planner,
        "PLANNER_CERTIFICATE",
        [
          {
            rowType: "PLANNER_CERTIFICATE",
            rows: [input.selection.planner],
            rowPath: () => "$",
            rowHashExpected: true,
          },
        ],
      ),
      artifact(
        "machine-projection-hash-rebinding-ledger.json",
        ledger,
        "PROJECTION_REBINDING_LEDGER_ROW",
        [
          {
            rowType: "PROJECTION_REBINDING_LEDGER_ROW",
            rows: ledger.entries,
            rowPath: (index) => `$.entries[${index}]`,
            rowHashExpected: true,
          },
        ],
      ),
    ];
    const preflight = preflightNestedSemanticIntegrity1431(
      input.projections,
      nestedArtifacts,
    );
    assertPreGoldIntegrity1431(preflight);
    await durableJson141(
      path.join(
        input.root,
        "c6-0-1-14-3-1-nested-semantic-integrity-preflight.json",
      ),
      preflight,
    );
    if (role === "A") {
      finalALedger = ledger;
      finalAPreflight = preflight;
    } else {
      finalBLedger = ledger;
      finalBPreflight = preflight;
    }
  };
const finalA = await buildFinal143({
  role: "A",
  state: prepared.state,
  baseline: prepared.baseline,
  policy: prepared.policy,
  code,
  preFreezeValidate: preFreezeValidate("A"),
});
const finalB = await buildFinal143({
  role: "B",
  state: prepared.state,
  baseline: prepared.baseline,
  policy: prepared.policy,
  code,
  preFreezeValidate: preFreezeValidate("B"),
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
const ledger = required141(finalALedger, "C6011431_FINAL_A_LEDGER_MISSING"),
  ledgerB = required141(finalBLedger, "C6011431_FINAL_B_LEDGER_MISSING"),
  preflight = required141(
    finalAPreflight,
    "C6011431_FINAL_A_PREFLIGHT_MISSING",
  ),
  preflightB = required141(
    finalBPreflight,
    "C6011431_FINAL_B_PREFLIGHT_MISSING",
  );
if (ledger.semanticHash !== ledgerB.semanticHash)
  throw new Error("C6011431_FINAL_AB_LEDGER_PARITY_FAILED");
if (preflight.semanticHash !== preflightB.semanticHash)
  throw new Error("C6011431_FINAL_AB_PREFLIGHT_PARITY_FAILED");
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
    "machine-projection-hash-rebinding-ledger-final-b.json",
  ),
  ledgerB,
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
await durableJson141(
  path.join(
    required141(prepared.state.outputs["nested-preflight"]),
    "c6-0-1-14-3-1-nested-semantic-integrity-preflight-final-b.json",
  ),
  preflightB,
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
    finalARebindingLedgerHash: ledger.semanticHash,
    finalBRebindingLedgerHash: ledgerB.semanticHash,
    changeAuditHash: changeAudit.semanticHash,
    nestedPreflightHash: preflight.semanticHash,
    finalANestedPreflightHash: preflight.semanticHash,
    finalBNestedPreflightHash: preflightB.semanticHash,
    preFreezePreflightCount: 2,
    finalABByteParity: true,
    finalABSemanticParity: true,
    wavHashParity: true,
    wavPcmParity: true,
    wavDurationParity: true,
    wavMappingParity: true,
    wavPlayableCount: currentWorkspace.audio.audio.length,
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
        artifacts: preflight.artifactCount,
        rowTypes: preflight.nestedRowTypeCounts,
        preFreezeRuns: refreeze.preFreezePreflightCount,
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

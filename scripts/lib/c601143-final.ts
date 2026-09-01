import path from "node:path";
import { cp, mkdir, stat } from "node:fs/promises";
import {
  machineCode143Schema,
  machineFreeze143Schema,
  parity143Schema,
  type Policy143,
} from "@mvl/shared";
import type { Baseline143, State143 } from "./c601143-input.js";
import { loadSelection143 } from "./c601143-selection.js";
import { buildWorkspace143 } from "./c601143-build-workspace.js";
import {
  workspaceProjection143,
  materializeProjections143,
} from "./c601143-projections.js";
import { exactReplay143 } from "./c601143-replay.js";
import {
  machineCodeSnapshot142,
  assertMachineFreezePath142,
} from "./c601142-final.js";
import { files141 } from "./c601141-freeze.js";
import {
  header143,
  sampleCount143,
  intersection143,
} from "../../packages/video-subtitler/src/review/c601143-policy.js";
import {
  hashed141,
  hash141,
  required141,
  assertHash141,
} from "../../packages/video-subtitler/src/review/c601141-policy.js";
import {
  durableJson141,
  fileHash141,
  readJson141,
  identity141,
  safeRelative141,
} from "../../packages/video-subtitler/src/review/c601141-io.js";

export async function machineCodeSnapshot143(root: string) {
  const old = await machineCodeSnapshot142(root);
  return machineCode143Schema.parse(
    hashed141({
      schemaVersion: "1.0.0",
      artifactType: "c6-0-1-14-3-machine-code-snapshot",
      files: old.files,
    }),
  );
}
async function copyMachineArtifacts143(state: State143, destination: string) {
  const names: { role: string; file: string }[] = [
    { role: "baseline", file: "c6-0-1-14-3-baseline-replay.json" },
    { role: "baseline", file: "c6-0-1-14-3-policy.json" },
    {
      role: "transition-audit",
      file: "machine-cross-stage-selection-transition-audit.json",
    },
    { role: "obligations", file: "machine-phase-a-coverage-obligations.json" },
    { role: "obligations", file: "c6-0-1-14-3-phase-a-obligation-freeze.json" },
    {
      role: "hierarchical-children",
      file: "machine-selectable-speech-child-units-v1.json",
    },
    {
      role: "target-bundles",
      file: "machine-review-target-bundle-candidates-v1.json",
    },
    {
      role: "target-bundles",
      file: "machine-target-bundle-dominance-ledger.json",
    },
    {
      role: "final-planner",
      file: "machine-final-safety-planner-certificate.json",
    },
    {
      role: "final-planner",
      file: "machine-cross-stage-coverage-monotonicity.json",
    },
    {
      role: "final-planner",
      file: "machine-cross-stage-selection-continuity-ledger.json",
    },
    {
      role: "final-planner",
      file: "machine-missing-safety-reserve-targets-v3.json",
    },
  ];
  const root = path.join(destination, "machine-artifacts");
  await mkdir(root, { recursive: true });
  for (const { role, file } of names)
    await cp(
      path.join(required141(state.outputs[role]), file),
      path.join(root, file),
      { errorOnExist: true, force: false },
    );
}
async function freezeFinal143(input: {
  root: string;
  role: "A" | "B";
  outputRoot: string;
  baseline: Baseline143;
  policy: Policy143;
  state: State143;
  codeHash: string;
  projectionHash: string;
  replayHash: string;
  selection: Awaited<ReturnType<typeof loadSelection143>>;
}) {
  const { root, baseline: b, policy, selection } = input,
    sourceIdentity = await identity141(b.old.config.source);
  if (hash141(sourceIdentity) !== hash141(b.old.baseline.sourceBefore))
    throw new Error("C601143_SOURCE_CHANGED_BEFORE_FREEZE");
  const artifacts: {
    relativePath: string;
    byteHash: string;
    semanticHash: string | null;
  }[] = [];
  for (const file of await files141(input.root)) {
    const rel = safeRelative141(input.outputRoot, file),
      size = (await stat(file)).size;
    assertMachineFreezePath142(rel, size);
    const byteHash = await fileHash141(file);
    let semanticHash: string | null = null;
    if (file.endsWith(".json")) {
      const value = await readJson141(file);
      semanticHash =
        value &&
        typeof value === "object" &&
        "semanticHash" in value &&
        typeof value.semanticHash === "string"
          ? value.semanticHash
          : hash141(value);
    }
    artifacts.push({ relativePath: rel, byteHash, semanticHash });
  }
  const protectedMachineFiles = [];
  for (const f of b.old.baseline.protectedFiles)
    protectedMachineFiles.push({
      relativePath: safeRelative141(
        input.outputRoot,
        path.join(root, f.relativePath),
      ),
      byteHash: await fileHash141(path.join(root, f.relativePath)),
    });
  const by = (name: string) =>
    required141(
      required141(
        artifacts.find((a) =>
          a.relativePath.endsWith(`/machine-artifacts/${name}`),
        ),
      ).semanticHash,
    );
  const review = path.join(root, "review-workspace"),
    reviewHash = async (name: string) => {
      const v = await readJson141(path.join(review, name));
      assertHash141(v as { semanticHash: string });
      return (v as { semanticHash: string }).semanticHash;
    };
  const freeze = machineFreeze143Schema.parse(
    hashed141({
      ...header143(policy, b.old.baseline.source),
      artifactType: "c6-0-1-14-3-machine-selection-freeze",
      stage: "FINAL_MACHINE_DELIVERY",
      freezeCompletedAt: new Date().toISOString(),
      artifacts,
      protectedMachineFiles,
      sourceReadOnlyIdentity: sourceIdentity,
      canonicalTextHash: b.old.baseline.canonicalTextHash,
      canonicalTimingHash: b.old.baseline.canonicalTimingHash,
      presentationHash: b.old.baseline.presentationHash,
      canonicalTextMutationCount: 0,
      canonicalTimingMutationCount: 0,
      presentationMutationCount: 0,
      goldReadCountBeforeFreeze: 0,
      rankerRetrained: false,
      oofTrainingRun: false,
      productionStatus: "needs-review",
      finalizationMethod: "none",
      machineOnlyReleaseAuthorized: false,
      c602Status: "HOLD",
      baselineReplayHash: by("c6-0-1-14-3-baseline-replay.json"),
      transitionAuditHash: by(
        "machine-cross-stage-selection-transition-audit.json",
      ),
      phaseAObligationsHash: selection.obligations.semanticHash,
      obligationFreezeHash: by("c6-0-1-14-3-phase-a-obligation-freeze.json"),
      hierarchyHash: selection.hierarchy.semanticHash,
      bundleCandidatesHash: selection.bundles.semanticHash,
      dominanceLedgerHash: selection.dominance.semanticHash,
      plannerCertificateHash: selection.planner.semanticHash,
      continuityLedgerHash: selection.continuity.semanticHash,
      safetyTargetsHash: selection.safety.semanticHash,
      reviewTargetsHash: await reviewHash(
        "machine-review-target-intervals-v5.json",
      ),
      reviewItemsHash: await reviewHash("machine-review-items-v7.json"),
      reviewRegionsHash: await reviewHash("machine-review-regions-v6.json"),
      audioManifestHash: await reviewHash(
        "machine-review-audio-manifest-v6.json",
      ),
      playbackTimelineHash: await reviewHash(
        "machine-review-playback-timeline-v5.json",
      ),
      projectionHash: input.projectionHash,
      replayAccountingHash: input.replayHash,
      codeSnapshotHash: input.codeHash,
      artifactBindings: artifacts,
      detectorInferenceCount: 0,
      asrInferenceCount: 0,
      detectorCacheMissCount: 0,
      asrCacheMissCount: 0,
      runtimeGoldInputBeforeFreeze: 0,
      finalRole: input.role,
    }),
  );
  await durableJson141(
    path.join(root, "c6-0-1-14-3-machine-selection-freeze.json"),
    freeze,
  );
  return freeze;
}

export async function buildFinal143(input: {
  role: "A" | "B";
  state: State143;
  baseline: Baseline143;
  policy: Policy143;
  code: Awaited<ReturnType<typeof machineCodeSnapshot143>>;
  preFreezeValidate?: (value: {
    root: string;
    projections: Awaited<ReturnType<typeof materializeProjections143>>;
    built: Awaited<ReturnType<typeof buildWorkspace143>>;
    replay: Awaited<ReturnType<typeof exactReplay143>>;
    selection: Awaited<ReturnType<typeof loadSelection143>>;
  }) => Promise<void>;
}) {
  const root = required141(
    input.state.outputs[`final-${input.role.toLowerCase()}`],
  );
  await mkdir(root, { recursive: true });
  if ((await files141(root)).length)
    throw new Error("C601143_FINAL_OUTPUT_MUST_BE_EMPTY");
  const selection = await loadSelection143(input.state);
  const built = await buildWorkspace143({
    ...selection,
    policy: input.policy,
    baseline: input.baseline,
    outputDirectory: path.join(root, "review-workspace"),
    generatedAt: input.state.createdAt,
  });
  const replay = await exactReplay143({
    baseline: input.baseline,
    policy: input.policy,
    executionPolicy: input.state.config.executionPolicy,
    outputDirectory: path.join(root, "exact-cache-replay"),
  });
  await copyMachineArtifacts143(input.state, root);
  const b = input.baseline.old.baseline,
    baseProjection = required141(
      input.baseline.projections.variants[0],
    ).projection,
    finalOld = required141(
      input.baseline.projections.comparisonPlans.find(
        (p) => p.planId === "C601142_FINAL_FULL_QUEUE",
      ),
    ).projection,
    phaseA = required141(
      input.baseline.comparisons.entries.find((e) => e.role === "A3"),
    ).projection,
    finalProjection = workspaceProjection143({
      baseline: finalOld,
      workspace: built.workspaceData,
      inventory: input.baseline.inventory,
    });
  const oldA = input.baseline.dir("final-a"),
    oldReview = input.baseline.dir("review-package-v5"),
    oldFinalRow = required141(input.baseline.projections.variants.at(-1));
  const oldFinalCoverage =
    sampleCount143(
      intersection143(
        input.baseline.oldFinal.targets.flatMap((t) => t.targetCoreUnion),
        selection.obligations.nativeIntervalUnion,
      ),
    ) / selection.obligations.totalNativeSamples;
  const baselineCoverage =
    sampleCount143(
      intersection143(
        input.baseline.old.safety.targets.map((t) => t.nativeInterval),
        selection.obligations.nativeIntervalUnion,
      ),
    ) / selection.obligations.totalNativeSamples;
  const regress = (intervals: { startSample: number; endSample: number }[]) =>
    selection.obligations.obligations.filter(
      (o) =>
        sampleCount143(intersection143(o.nativeIntervalUnion, intervals)) <
        sampleCount143(o.nativeIntervalUnion),
    ).length;
  const projections = await materializeProjections143({
    policy: input.policy,
    inventory: input.baseline.inventory,
    baseline: baseProjection,
    oldFinal: finalOld,
    phaseA,
    final: finalProjection,
    oldBaselineDirectory: path.join(
      oldA,
      required141(input.baseline.projections.variants[0]).workspaceRelativePath,
    ),
    oldFinalDirectory: path.join(oldA, oldFinalRow.workspaceRelativePath),
    oldPhaseADirectory: path.join(oldReview, "comparison-workspaces/A3"),
    finalWorkspaceDirectory: path.join(root, "review-workspace"),
    destination: root,
    baselineCount: input.baseline.old.safety.targets.length,
    baselineSeconds: input.baseline.old.safety.summary.targetUnionSeconds,
    phaseACount: input.baseline.phaseA.targets.length,
    phaseASeconds: input.baseline.phaseA.summary.targetUnionSeconds,
    selectedChildCount: selection.planner.selectedChildIds.length,
    finalTargetCount: selection.safety.targets.length,
    oldFinalCount: input.baseline.oldFinal.targets.length,
    oldFinalSeconds: input.baseline.oldFinal.summary.targetUnionSeconds,
    finalCoreSeconds: selection.safety.summary.speechCoreUnionSeconds,
    baselineObligationCoverage: baselineCoverage,
    baselineRegressionCount: regress(
      input.baseline.old.safety.targets.map((t) => t.nativeInterval),
    ),
    oldFinalObligationCoverage: oldFinalCoverage,
    oldFinalRegressionCount: regress(
      input.baseline.oldFinal.targets.flatMap((t) => t.targetCoreUnion),
    ),
  });
  for (const f of b.protectedFiles) {
    const destination = path.join(root, f.relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(
      path.join(input.baseline.old.config.baselineFinalA, f.relativePath),
      destination,
      { errorOnExist: true, force: false },
    );
    if ((await fileHash141(destination)) !== f.byteHash)
      throw new Error("C601143_PROTECTED_CANONICAL_COPY_MISMATCH");
  }
  await durableJson141(
    path.join(root, "machine-code-snapshot.json"),
    input.code,
  );
  await durableJson141(
    path.join(root, "machine-coverage-projections.json"),
    projections,
  );
  await input.preFreezeValidate?.({
    root,
    projections,
    built,
    replay,
    selection,
  });
  const freeze = await freezeFinal143({
    root,
    role: input.role,
    outputRoot: input.state.config.outputRoot,
    baseline: input.baseline,
    policy: input.policy,
    state: input.state,
    codeHash: input.code.semanticHash,
    projectionHash: projections.semanticHash,
    replayHash: replay.semanticHash,
    selection,
  });
  return { root, freeze, projections, built, replay };
}

export async function compareFinals143(input: {
  state: State143;
  policy: Policy143;
  a: Awaited<ReturnType<typeof buildFinal143>>;
  b: Awaited<ReturnType<typeof buildFinal143>>;
}) {
  const snapshot = async (root: string) => {
    const rows = [];
    for (const f of await files141(root)) {
      const rel = safeRelative141(root, f);
      if (rel === "c6-0-1-14-3-machine-selection-freeze.json") continue;
      rows.push({ relativePath: rel, byteHash: await fileHash141(f) });
    }
    return rows;
  };
  const a = await snapshot(input.a.root),
    b = await snapshot(input.b.root);
  if (hash141(a) !== hash141(b))
    throw new Error("C601143_FINAL_AB_BYTE_PARITY_FAILED");
  const semantic = a.filter((r) => r.relativePath.endsWith(".json")),
    audio = a.filter((r) => r.relativePath.endsWith(".wav")),
    protectedRows = input.a.freeze.protectedMachineFiles;
  const strip = (v: typeof input.a.freeze) => ({
    baselineReplayHash: v.baselineReplayHash,
    transitionAuditHash: v.transitionAuditHash,
    phaseAObligationsHash: v.phaseAObligationsHash,
    hierarchyHash: v.hierarchyHash,
    bundleCandidatesHash: v.bundleCandidatesHash,
    plannerCertificateHash: v.plannerCertificateHash,
    continuityLedgerHash: v.continuityLedgerHash,
    safetyTargetsHash: v.safetyTargetsHash,
    reviewTargetsHash: v.reviewTargetsHash,
    reviewItemsHash: v.reviewItemsHash,
    reviewRegionsHash: v.reviewRegionsHash,
    audioManifestHash: v.audioManifestHash,
    playbackTimelineHash: v.playbackTimelineHash,
    projectionHash: v.projectionHash,
    replayAccountingHash: v.replayAccountingHash,
    codeSnapshotHash: v.codeSnapshotHash,
  });
  if (hash141(strip(input.a.freeze)) !== hash141(strip(input.b.freeze)))
    throw new Error("C601143_FINAL_AB_SEMANTIC_PARITY_FAILED");
  return parity143Schema.parse(
    hashed141({
      ...header143(input.policy, input.a.freeze.sourceIdentity),
      artifactType: "c6-0-1-14-3-final-ab-parity",
      finalAFreezeHash: input.a.freeze.semanticHash,
      finalBFreezeHash: input.b.freeze.semanticHash,
      comparedFiles: a.length,
      semanticCompared: semantic.length,
      audioCompared: audio.length,
      protectedFilesCompared: protectedRows.length,
      byteParity: true,
      semanticParity: true,
      audioShaParity: true,
      canonicalByteParity: true,
      normalizedFreezeParity: true,
      mismatches: [],
    }),
  );
}

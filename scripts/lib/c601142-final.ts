import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, cp, stat } from "node:fs/promises";
import {
  machineCode142Schema,
  finalReplay142Schema,
  machineFreeze142Schema,
  detectorPlan142Schema,
  detectorFreeze142Schema,
  comparisonInputs142Schema,
  asrSelection142Schema,
  asrPlan142Schema,
  asrProbes142Schema,
  lexical142Schema,
  missing142Schema,
  phaseA142Schema,
  policyBinding142Schema,
  type Policy142,
} from "@mvl/shared";
import {
  replayBaseline142,
  type Baseline142,
  type State142,
} from "./c601142-input.js";
import { runDetectors142 } from "../../packages/video-subtitler/src/review/c601142-detectors.js";
import { buildMasked142 } from "../../packages/video-subtitler/src/review/c601142-inventory.js";
import { materializeInventory142 } from "./c601142-evidence.js";
import { runAsr142 } from "../../packages/video-subtitler/src/review/c601142-asr.js";
import {
  buildLexical142,
  buildMissing142,
} from "../../packages/video-subtitler/src/review/c601142-lexical.js";
import { buildWorkspace142 } from "./c601142-build-workspace.js";
import {
  workspaceProjection142,
  assembleProjections142,
  copyProjectionAudio142,
  verifyProjectionAudio142,
} from "./c601142-coverage-projection.js";
import { header142 } from "../../packages/video-subtitler/src/review/c601142-policy.js";
import { files141 } from "./c601141-freeze.js";
import {
  readJson141,
  durableJson141,
  fileHash141,
  identity141,
  safeRelative141,
} from "../../packages/video-subtitler/src/review/c601141-io.js";
import {
  hash141,
  hashed141,
  required141,
  assertHash141,
} from "../../packages/video-subtitler/src/review/c601141-policy.js";

/** The existing browser server creates a zero-byte OS mutex even for GETs.
 * It never stores review data. No journal, nonempty mutex or Gold path is an
 * allowed machine input; the empty mutex is bound only as inert provenance. */
export function assertMachineFreezePath142(relativePath: string, size: number) {
  const forbidden =
    /(?:^|\/)(?:gold|evaluation|human-correction|session)(?:[./-]|$)/iu;
  const mutexSuffix = "/review-workspace/session/workspace-mutation.sqlite";
  const emptyMutex =
    relativePath.endsWith(mutexSuffix) &&
    size === 0 &&
    !forbidden.test(relativePath.slice(0, -mutexSuffix.length));
  if (forbidden.test(relativePath) && !emptyMutex)
    throw new Error("C601142_MACHINE_FREEZE_GOLD_OR_HUMAN_INPUT");
  return emptyMutex;
}

export async function machineCodeSnapshot142(root: string) {
  const { stdout } = await promisify(execFile)(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: root, maxBuffer: 16 * 1024 * 1024 },
  );
  const allowed = (file: string) =>
    /^(?:(?:packages|apps|scripts|tests|schemas|\.github)\/|\.agents\/skills\/multilingual-video-subtitler\/|(?:package(?:-lock)?\.json|tsconfig[^/]*\.json|eslint\.config\.js|vitest\.config\.ts)$)/u.test(
      file,
    ) &&
    /\.(?:ts|tsx|js|mjs|py|json|lock|yaml|yml)$/u.test(file) &&
    !/(?:^|\/)__pycache__(?:\/|$)/u.test(file);
  const paths = [
    ...new Set(stdout.split("\0").filter(Boolean).filter(allowed)),
  ].sort();
  const files = await Promise.all(
    paths.map(async (relativePath) => ({
      relativePath,
      sha256: await fileHash141(path.join(root, relativePath)),
    })),
  );
  return machineCode142Schema.parse(
    hashed141({
      schemaVersion: "1.0.0",
      artifactType: "c6-0-1-14-2-machine-code-snapshot",
      files,
    }),
  );
}
async function freezeFinal142(input: {
  old: Baseline142;
  state: State142;
  policy: Policy142;
  root: string;
  workspaceHash: string;
  projectionsHash: string;
  replayHash: string;
  codeSnapshotHash: string;
  reviewWorkspace: string;
}) {
  const { old, state, policy, root } = input,
    dir = (role: string) => required141(state.outputs[role]);
  const sourceIdentity = await identity141(old.config.source);
  if (hash141(sourceIdentity) !== hash141(old.baseline.sourceBefore))
    throw new Error("C601142_SOURCE_CHANGED_BEFORE_FINAL_FREEZE");
  const roots = [
    "baseline",
    "selection-audit",
    "target-clusters",
    "selection-v2",
    "audio-view-audit",
    "dialogue-views",
    "detectors-fresh",
    "detectors-replay",
    "masked-speech",
    "inventory-v5",
    "local-asr-fresh",
    "local-asr-replay",
    "missing-evidence-v5",
    "review-package-v5",
  ];
  const artifactFiles = [
    ...(await files141(root)),
    ...(await Promise.all(roots.map((role) => files141(dir(role))))).flat(),
  ];
  const artifacts = [];
  for (const file of [...new Set(artifactFiles)].sort()) {
    const relativePath = safeRelative141(old.config.outputRoot, file);
    const emptyMutex = assertMachineFreezePath142(
      relativePath,
      (await stat(file)).size,
    );
    const byteHash = await fileHash141(file);
    if (
      emptyMutex &&
      byteHash !==
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    )
      throw new Error("C601142_BROWSER_MUTEX_CHANGED_DURING_FREEZE");
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
    artifacts.push({
      relativePath,
      byteHash,
      semanticHash,
    });
  }
  const protectedMachineFiles = [];
  for (const file of old.baseline.protectedFiles) {
    const absolute = path.join(root, file.relativePath);
    protectedMachineFiles.push({
      relativePath: safeRelative141(old.config.outputRoot, absolute),
      byteHash: await fileHash141(absolute),
    });
  }
  const detectorPlan = detectorPlan142Schema.parse(
    await readJson141(
      path.join(dir("baseline"), "machine-c6-0-1-14-2-detector-plan.json"),
    ),
  );
  const preDetector = detectorFreeze142Schema.parse(
    await readJson141(
      path.join(dir("baseline"), "machine-c601142-pre-detector-freeze.json"),
    ),
  );
  const freshDetector = (await import("@mvl/shared")).sweeps142Schema.parse(
    await readJson141(
      path.join(
        dir("detectors-fresh"),
        "machine-independent-speech-presence-sweeps.json",
      ),
    ),
  );
  const replayDetector = (await import("@mvl/shared")).sweeps142Schema.parse(
    await readJson141(
      path.join(
        dir("detectors-replay"),
        "machine-independent-speech-presence-sweeps.json",
      ),
    ),
  );
  const asrPlan = asrPlan142Schema.parse(
    await readJson141(
      path.join(
        dir("local-asr-fresh"),
        "machine-c601142-asr-execution-plan.json",
      ),
    ),
  );
  const asrFresh = asrProbes142Schema.parse(
    await readJson141(
      path.join(
        dir("local-asr-fresh"),
        "machine-c6-0-1-14-2-local-asr-probes.json",
      ),
    ),
  );
  const asrReplay = asrProbes142Schema.parse(
    await readJson141(
      path.join(
        dir("local-asr-replay"),
        "machine-c6-0-1-14-2-local-asr-probes.json",
      ),
    ),
  );
  const phaseA = phaseA142Schema.parse(
    await readJson141(
      path.join(
        dir("selection-v2"),
        "c6-0-1-14-2-phase-a-selection-projection.json",
      ),
    ),
  );
  const freeze = machineFreeze142Schema.parse(
    hashed141({
      ...header142(policy, old.baseline.source),
      artifactType: "c6-0-1-14-2-machine-selection-detector-freeze",
      stage: "FINAL_MACHINE_DELIVERY",
      freezeCompletedAt: new Date().toISOString(),
      artifacts,
      protectedMachineFiles,
      sourceReadOnlyIdentity: sourceIdentity,
      canonicalTextHash: old.baseline.canonicalTextHash,
      canonicalTimingHash: old.baseline.canonicalTimingHash,
      presentationHash: old.baseline.presentationHash,
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
      codeSnapshotHash: input.codeSnapshotHash,
      projectionHash: input.projectionsHash,
      reviewWorkspaceHash: input.workspaceHash,
      replayAccountingHash: input.replayHash,
      acquisitionSummary: {
        detectorPlanHash: detectorPlan.semanticHash,
        detectorFresh: freshDetector.accounting,
        detectorReplay: replayDetector.accounting,
        asrPlanHash: asrPlan.semanticHash,
        asrFresh: asrFresh.accounting,
        asrReplay: asrReplay.accounting,
        detectorRuntimeIdentityHashes: [
          ...new Set(
            detectorPlan.jobs.map((j) => j.runtime.runtimeIdentityHash),
          ),
        ],
        detectorSnapshotHashes: [
          ...new Set(detectorPlan.jobs.map((j) => j.runtime.modelSnapshotHash)),
        ],
        asrRuntimeIdentityHashes: [
          ...new Set(asrFresh.requests.map((r) => r.runtimeIdentityHash)),
        ],
        asrSnapshotHashes: [
          ...new Set(asrFresh.requests.map((r) => r.modelSnapshotHash)),
        ],
        preDetectorFreezeHash: preDetector.semanticHash,
        phaseAHash: phaseA.semanticHash,
        goldInputCount: 0,
      },
    }),
  );
  await durableJson141(
    path.join(root, "c6-0-1-14-2-machine-selection-detector-freeze.json"),
    freeze,
  );
  return freeze;
}
export async function verifyFinalFreeze142(
  outputRoot: string,
  root: string,
  sourcePath?: string,
) {
  const freeze = machineFreeze142Schema.parse(
    await readJson141(
      path.join(root, "c6-0-1-14-2-machine-selection-detector-freeze.json"),
    ),
  );
  assertHash141(freeze);
  for (const entry of [...freeze.artifacts, ...freeze.protectedMachineFiles]) {
    const file = path.join(outputRoot, entry.relativePath);
    safeRelative141(outputRoot, file);
    if ((await fileHash141(file)) !== entry.byteHash)
      throw new Error(
        `C601142_FINAL_FROZEN_FILE_CHANGED:${entry.relativePath}`,
      );
  }
  if (
    sourcePath &&
    hash141(await identity141(sourcePath)) !==
      hash141(freeze.sourceReadOnlyIdentity)
  )
    throw new Error("C601142_FINAL_SOURCE_CHANGED");
  return freeze;
}
export async function finalPhase142(input: {
  old: Baseline142;
  state: State142;
  policy: Policy142;
  role: "final-a" | "final-b";
}) {
  const { old, state, policy } = input,
    dir = (role: string) => required141(state.outputs[role]),
    root = dir(input.role);
  const detectorPlan = detectorPlan142Schema.parse(
    await readJson141(
      path.join(dir("baseline"), "machine-c6-0-1-14-2-detector-plan.json"),
    ),
  );
  const detector = await runDetectors142({
    mode: "EXACT_CACHE_ONLY",
    plan: detectorPlan,
    policy,
    cacheDirectory: path.join(dir("baseline"), "cache"),
    outputDirectory: path.join(root, "cache-replay/detector"),
    authorized: false,
  });
  const native = required141(
    old.views.views.find((v) => v.role === "NATIVE_MONO"),
  );
  const masked = await buildMasked142({
    scores: detector.scores,
    sweeps: detector.sweeps,
    policy,
    python: old.config.speechRuntime.python,
    worker: path.resolve("scripts/runtime/c601142_audio_views.py"),
    audioPath: path.join(old.dir("audio-views"), native.relativePath),
    expectedPcmSha256: native.pcmSha256,
    outputDirectory: root,
  });
  const derivedState: State142 = {
    ...state,
    outputs: { ...state.outputs, "inventory-v5": root },
  };
  const evidence = await materializeInventory142(
    old,
    derivedState,
    policy,
    detector.sweeps,
    masked,
  );
  const selection = asrSelection142Schema.parse(
    await readJson141(
      path.join(
        dir("inventory-v5"),
        "machine-c6-0-1-14-2-asr-probe-selection.json",
      ),
    ),
  );
  if (selection.semanticHash !== evidence.asrSelection.semanticHash)
    throw new Error("C601142_FINAL_ASR_SELECTION_MISMATCH");
  const asrPlan = asrPlan142Schema.parse(
    await readJson141(
      path.join(
        dir("local-asr-fresh"),
        "machine-c601142-asr-execution-plan.json",
      ),
    ),
  );
  const runtimeInput = {
    ...old.config.asrRuntime,
    sourcePath: old.config.source,
    sourceIdentity: old.baseline.source,
    outputDirectory: dir("local-asr-fresh"),
  };
  const reading = {
    manifest: old.config.sudachiRuntimeManifestPath,
    python: path.join(
      path.dirname(old.config.sudachiRuntimeManifestPath),
      "venv/bin/python",
    ),
    helper: path.resolve("scripts/sudachi-readings.py"),
    requirements: path.resolve("scripts/requirements-sudachi.txt"),
  };
  const asr = await runAsr142({
    selection,
    policy,
    plan: asrPlan,
    runtimeInput,
    reading,
    mode: "EXACT_CACHE_ONLY",
    authorized: false,
    cacheDirectory: path.join(dir("baseline"), "cache"),
    outputDirectory: path.join(root, "cache-replay/asr"),
    freshDirectory: dir("local-asr-fresh"),
  });
  const lexical = buildLexical142({
    policy,
    safety: evidence.safety,
    probes: asr,
    previousProbes: old.asr,
    previousLexical: old.lexical,
  });
  const missing = buildMissing142(
    evidence.inventory,
    evidence.safety,
    lexical,
    policy,
  );
  const expectedLexical = lexical142Schema.parse(
    await readJson141(
      path.join(
        dir("missing-evidence-v5"),
        "machine-missing-lexical-evidence-v5.json",
      ),
    ),
  );
  const expectedMissing = missing142Schema.parse(
    await readJson141(
      path.join(
        dir("missing-evidence-v5"),
        "machine-missing-speech-evidence-v5.json",
      ),
    ),
  );
  if (
    lexical.semanticHash !== expectedLexical.semanticHash ||
    missing.semanticHash !== expectedMissing.semanticHash
  )
    throw new Error("C601142_FINAL_LEXICAL_OR_MISSING_REPLAY_MISMATCH");
  const workspace = path.join(root, "review-workspace");
  const built = await buildWorkspace142({
    baseline: old.baseline,
    policy,
    inventory: evidence.inventory,
    safety: evidence.safety,
    lexical,
    missing,
    supersessionHash: evidence.supersession.semanticHash,
    sourcePath: old.config.source,
    outputDirectory: workspace,
    generatedAt: state.createdAt,
  });
  const delivery = (await readJson141(
    path.join(
      dir("review-package-v5"),
      "c601142-review-delivery-selection.json",
    ),
  )) as { semanticHash: string };
  if (
    delivery.semanticHash !==
    built.workspaceData.detectorCeilingReviewV2.semanticHash
  )
    throw new Error("C601142_FINAL_REVIEW_WORKSPACE_REPLAY_MISMATCH");
  const baseProjection = required141(
    old.projections.variants.at(-1),
  ).projection;
  const finalProjection = workspaceProjection142({
    baseline: baseProjection,
    workspace: built.workspaceData,
    inventory: evidence.inventory,
    includeNewLexical: true,
  });
  const comparisons = comparisonInputs142Schema.parse(
    await readJson141(
      path.join(
        dir("review-package-v5"),
        "machine-comparison-input-projections.json",
      ),
    ),
  );
  const by = (role: "A1" | "A2" | "A3" | "detector-only") =>
    required141(comparisons.entries.find((e) => e.role === role)).projection;
  const baseSource = path.join(old.dir("final-a"), "review-workspace"),
    baseDestination = path.join(root, "comparison-workspaces/baseline");
  await copyProjectionAudio142(baseSource, baseDestination, baseProjection);
  for (const role of ["A1", "A2", "A3", "detector-only"] as const)
    await copyProjectionAudio142(
      path.join(dir("review-package-v5"), `comparison-workspaces/${role}`),
      path.join(root, `comparison-workspaces/${role}`),
      by(role),
    );
  const projections = assembleProjections142({
    policy,
    inventory: evidence.inventory,
    baseline: baseProjection,
    phaseA: [by("A1"), by("A2"), by("A3")],
    detectorOnly: by("detector-only"),
    final: finalProjection,
  });
  for (const row of projections.variants)
    await verifyProjectionAudio142(
      path.join(root, row.workspaceRelativePath),
      row.projection,
    );
  const code = await machineCodeSnapshot142(process.cwd());
  const baselineReplay = await replayBaseline142(
    old,
    path.join(root, "baseline-cache-replay"),
  );
  const replay = finalReplay142Schema.parse(
    hashed141({
      schemaVersion: "1.0.0",
      artifactType: "c6-0-1-14-2-final-replay-accounting",
      mode: "EXACT_CACHE_ONLY",
      baselineDetector: baselineReplay.detector,
      baselineAsr: baselineReplay.asr,
      detector: detector.sweeps.accounting,
      asr: asr.accounting,
      inferenceCount: 0,
      modelLoadCount: 0,
      providerProcessStartCount: 0,
      machineEvidenceSemanticHash: hash141({
        inventory: evidence.inventory.semanticHash,
        safety: evidence.safety.semanticHash,
        lexical: lexical.semanticHash,
        missing: missing.semanticHash,
      }),
    }),
  );
  const policyBinding = policyBinding142Schema.parse(
    hashed141({
      schemaVersion: "1.0.0",
      artifactType: "c6-0-1-14-2-policy-name-binding",
      requestedPolicyVersion:
        "c6.0.1.14.2-detector-exclusive-selection-masked-speech-ceiling-v1",
      frozenExecutionPolicyVersion: policy.policyVersion,
      executionPolicyHash: policy.semanticHash,
      aliasOnly: true,
      thresholdsChanged: false,
      cacheKeysChanged: false,
      inferenceCount: 0,
    }),
  );
  for (const [name, value] of Object.entries({
    "machine-code-snapshot.json": code,
    "machine-coverage-projections.json": projections,
    "c6-0-1-14-2-policy-name-binding.json": policyBinding,
    "c6-0-1-14-2-final-replay-accounting.json": replay,
    ...built.artifacts,
  })) {
    if (
      name === "c6-0-1-12-review-package-freeze.json" ||
      name === "machine-missing-safety-reserve-targets-v2.json"
    )
      continue;
    await durableJson141(path.join(root, name), value);
  }
  for (const file of old.baseline.protectedFiles) {
    const destination = path.join(root, file.relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(
      path.join(old.config.baselineFinalA, file.relativePath),
      destination,
      { errorOnExist: true, force: false },
    );
    if ((await fileHash141(destination)) !== file.byteHash)
      throw new Error("C601142_PROTECTED_CANONICAL_BYTE_COPY_MISMATCH");
  }
  const freeze = await freezeFinal142({
    old,
    state,
    policy,
    root,
    workspaceHash: built.workspaceData.detectorCeilingReviewV2.semanticHash,
    projectionsHash: projections.semanticHash,
    replayHash: replay.semanticHash,
    codeSnapshotHash: code.semanticHash,
    reviewWorkspace: workspace,
  });
  return {
    role: input.role,
    freezeHash: freeze.semanticHash,
    codeSnapshotHash: code.semanticHash,
    projectionHash: projections.semanticHash,
    detector: detector.sweeps.accounting,
    asr: asr.accounting,
    targets: evidence.safety.summary,
    audio: built.physical,
    finalQueueSeconds: required141(
      built.playback.plans.find((p) => p.planId === "C601142_FINAL_FULL_QUEUE"),
    ).uniqueAudioSeconds,
    canonicalTextHash: old.baseline.canonicalTextHash,
    canonicalTimingHash: old.baseline.canonicalTimingHash,
    presentationHash: old.baseline.presentationHash,
  };
}

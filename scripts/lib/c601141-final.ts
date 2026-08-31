import path from "node:path";
import { mkdir, cp } from "node:fs/promises";
import {
  c601141PolicySchema,
  c601141AudioViewsSchema,
  c601141FingerprintSchema,
  c601141InventorySchema,
  c601141SafetySchema,
  c601141AsrSelectionSchema,
  c601141AsrProbesSchema,
  c601141LexicalSchema,
  c601141MissingEvidenceSchema,
  c60114CoverageProjectionsSchema,
  c601141SweepsSchema,
} from "@mvl/shared";
import { loadBaseline141, type Config141 } from "./c601141-input.js";
import { buildWorkspace141 } from "./c601141-build-workspace.js";
import { files141, freeze141, verifyFreeze141 } from "./c601141-freeze.js";
import { hash141 } from "../../packages/video-subtitler/src/review/c601141-policy.js";
import {
  readJson141,
  durableJson141,
  fileHash141,
} from "../../packages/video-subtitler/src/review/c601141-io.js";
import {
  runSweeps141,
  type C601141SweepJob,
} from "../../packages/video-subtitler/src/review/c601141-detectors.js";
import { runAsr141 } from "../../packages/video-subtitler/src/review/c601141-local-asr.js";
import {
  buildInventory141,
  uncoveredSpeech141,
  selectSafety141,
  selectAsr141,
} from "../../packages/video-subtitler/src/review/c601141-inventory.js";
import {
  buildLexical141,
  buildMissing141,
} from "../../packages/video-subtitler/src/review/c601141-lexical.js";
import { coverageProjections141 } from "./c601141-coverage-projection.js";
import { allocateC60114Output } from "./c60114-output.js";
import { machineCodeSnapshot141 } from "./c601141-code-freeze.js";

export async function deliveryPhase141(input: {
  config: Config141;
  outputs: Record<string, string>;
  policyPath: string;
  preflightFreezePath: string;
  final: "final-a" | "final-b" | null;
  onProgress?: (message: string) => void;
}) {
  const dir = (key: string) => {
    const found = input.outputs[key];
    if (!found) throw new Error("C601141_OUTPUT_DIRECTORY_MISSING");
    return found;
  };
  const config = input.config,
    baseline = await loadBaseline141(config),
    policy = c601141PolicySchema.parse(await readJson141(input.policyPath));
  await verifyFreeze141(
    config.outputRoot,
    input.preflightFreezePath,
    config.source,
  );
  const selectionFreeze = path.join(
    dir("safety-targets"),
    "pre-asr-selection-freeze.json",
  );
  await verifyFreeze141(config.outputRoot, selectionFreeze, config.source);
  const views = c601141AudioViewsSchema.parse(
    await readJson141(
      path.join(dir("audio-views"), "machine-source-audio-views-v1.json"),
    ),
  );
  const fingerprint = c601141FingerprintSchema.parse(
    await readJson141(
      path.join(
        dir("legacy-fingerprint"),
        "machine-legacy-audio-fingerprint-reconciliation.json",
      ),
    ),
  );
  let inventory = c601141InventorySchema.parse(
    await readJson141(
      path.join(
        dir("speech-inventory-v4"),
        "machine-source-global-speech-inventory-v4.json",
      ),
    ),
  );
  let safety = c601141SafetySchema.parse(
    await readJson141(
      path.join(
        dir("safety-targets"),
        "machine-missing-safety-reserve-targets-v1.json",
      ),
    ),
  );
  const selection = c601141AsrSelectionSchema.parse(
    await readJson141(
      path.join(
        dir("safety-targets"),
        "machine-c6-0-1-14-1-asr-probe-selection.json",
      ),
    ),
  );
  let lexical = c601141LexicalSchema.parse(
    await readJson141(
      path.join(
        dir("missing-evidence-v4"),
        "machine-missing-lexical-evidence-v4.json",
      ),
    ),
  );
  let missing = c601141MissingEvidenceSchema.parse(
    await readJson141(
      path.join(
        dir("missing-evidence-v4"),
        "machine-missing-speech-evidence-v4.json",
      ),
    ),
  );
  const root = input.final ? dir(input.final) : dir("review-package-v4"),
    workspace = input.final
      ? path.join(root, "review-workspace")
      : await allocateC60114Output(root, "review-workspace");
  let replayAccounting: Record<string, unknown> | null = null;
  if (input.final) {
    input.onProgress?.(
      `${input.final}: independent exact-cache detector and ASR replay; provider construction forbidden.`,
    );
    const plan = (await readJson141(
      path.join(dir("baseline"), "speech-sweep-plan.local-only.json"),
    )) as { jobs: C601141SweepJob[]; planHash: string };
    if (hash141(plan.jobs) !== plan.planHash)
      throw new Error("C601141_FINAL_SWEEP_PLAN_CHANGED");
    const sweeps = await runSweeps141({
      mode: "EXACT_CACHE_ONLY",
      authorized: false,
      views,
      policy,
      jobs: plan.jobs,
      viewsDirectory: dir("audio-views"),
      cacheDirectory: path.join(dir("baseline"), "cache"),
      outputDirectory: path.join(root, "cache-replay/speech"),
    });
    const asr = await runAsr141({
      mode: "EXACT_CACHE_ONLY",
      authorized: false,
      selection,
      policy,
      runtimeInput: {
        ...config.asrRuntime,
        sourcePath: config.source,
        sourceIdentity: baseline.source,
        outputDirectory: dir("local-asr-fresh"),
      },
      cacheDirectory: path.join(dir("baseline"), "cache"),
      outputDirectory: path.join(root, "cache-replay/asr"),
      freshDirectory: dir("local-asr-fresh"),
      runtimeFactory: () =>
        Promise.reject(
          new Error("C601141_FINAL_PROVIDER_CONSTRUCTION_FORBIDDEN"),
        ),
    });
    const rebuilt = buildInventory141({
      policy,
      source: baseline.source,
      viewsHash: views.semanticHash,
      fingerprint,
      sweeps,
      previous: baseline.previous.islands,
      cueIntervals: baseline.subtitlePackage.cues,
      sceneBoundaries: baseline.previous.islands.boundaries
        .filter((v) => v.kind === "SCENE")
        .map((v) => v.at),
    });
    const uncovered = uncoveredSpeech141({
      inventory: rebuilt,
      policy,
      cues: baseline.subtitlePackage.cues,
      previousTargets: baseline.previous.targets.targets,
      finalCueHash: hash141(baseline.subtitlePackage.cues),
      previousTargetsHash: baseline.previous.targets.semanticHash,
    });
    const rebuiltSafety = selectSafety141(uncovered, policy),
      rebuiltSelection = selectAsr141(
        rebuiltSafety,
        policy,
        selection.selectionFrozenAt,
      );
    const rebuiltLexical = buildLexical141(asr, rebuiltSafety, policy, {
      existing: baseline.previous.lexical,
      fingerprint,
      tokens:
        baseline.input.machineArtifacts[
          "machine-global-token-timeline-v2.json"
        ],
    });
    const rebuiltMissing = buildMissing141(
      rebuilt,
      rebuiltSafety,
      rebuiltLexical,
      policy,
    );
    for (const [a, b] of [
      [inventory, rebuilt],
      [safety, rebuiltSafety],
      [selection, rebuiltSelection],
      [lexical, rebuiltLexical],
      [missing, rebuiltMissing],
    ] as const)
      if (a.semanticHash !== b.semanticHash)
        throw new Error(
          `C601141_FINAL_MACHINE_REPLAY_MISMATCH:${a.artifactType}`,
        );
    inventory = rebuilt;
    safety = rebuiltSafety;
    lexical = rebuiltLexical;
    missing = rebuiltMissing;
    replayAccounting = {
      mode: "EXACT_CACHE_ONLY",
      detector: sweeps.accounting,
      asr: asr.accounting,
      inferenceCount: 0,
      modelLoadCount: 0,
      providerProcessStartCount: 0,
      machineEvidenceSemanticHash: hash141({
        inventory: inventory.semanticHash,
        safety: safety.semanticHash,
        lexical: lexical.semanticHash,
        missing: missing.semanticHash,
      }),
    };
    await durableJson141(
      path.join(root, "machine-uncovered-speech-candidates-v1.json"),
      uncovered,
    );
  }
  await mkdir(workspace, { recursive: true });
  input.onProgress?.(
    `Building physical review audio and nine frozen playback plans for ${input.final ?? "review-package-v4"}.`,
  );
  const built = await buildWorkspace141({
    baseline,
    policy,
    inventory,
    safety,
    lexical,
    missing,
    sourcePath: config.source,
    outputDirectory: workspace,
    generatedAt: selection.selectionFrozenAt,
  });
  if (!input.final) {
    await durableJson141(
      path.join(root, "c601141-review-delivery-selection.json"),
      {
        directoryName: path.basename(workspace),
        semanticHash: built.workspaceData.speechInventoryReviewV1.semanticHash,
      },
    );
    return {
      phase: "delivery",
      workspace,
      targets: built.graph.targets.summary,
      items: built.graph.items.summary,
      audio: built.physical,
      playback: built.playback.summary,
    };
  }
  const selected = (await readJson141(
    path.join(
      dir("review-package-v4"),
      "c601141-review-delivery-selection.json",
    ),
  )) as { directoryName: string; semanticHash: string };
  if (!/^review-workspace(?:-\d+)?$/u.test(selected.directoryName))
    throw new Error("C601141_UNSAFE_DELIVERY_SELECTION");
  const expected = (await readJson141(
    path.join(
      dir("review-package-v4"),
      selected.directoryName,
      "review-data.json",
    ),
  )) as { speechInventoryReviewV1: { semanticHash: string } };
  if (selected.semanticHash !== expected.speechInventoryReviewV1.semanticHash)
    throw new Error("C601141_DELIVERY_SELECTION_HASH_CHANGED");
  if (
    expected.speechInventoryReviewV1.semanticHash !==
    built.workspaceData.speechInventoryReviewV1.semanticHash
  )
    throw new Error("C601141_FINAL_REVIEW_DELIVERY_REPLAY_MISMATCH");
  const priorProjections = c60114CoverageProjectionsSchema.parse(
    await readJson141(
      path.join(config.baselineFinalA, "machine-coverage-projections.json"),
    ),
  );
  const priorFinal = priorProjections.variants.find((v) => v.stage === "A8");
  if (!priorFinal)
    throw new Error("C601141_BASELINE_COVERAGE_PROJECTION_MISSING");
  const probes = c601141AsrProbesSchema.parse(
    await readJson141(
      path.join(
        dir("local-asr-replay"),
        "machine-c6-0-1-14-1-local-asr-probes.json",
      ),
    ),
  );
  const projections = coverageProjections141({
    baseline: priorFinal.projection,
    workspace: built.workspaceData,
    inventory,
    views,
    probes,
    policy,
  });
  const codeSnapshot = await machineCodeSnapshot141(process.cwd());
  const artifacts = {
    "c6-0-1-14-1-policy.json": policy,
    "machine-source-audio-views-v1.json": views,
    "machine-legacy-audio-fingerprint-reconciliation.json": fingerprint,
    "machine-source-global-speech-inventory-v4.json": inventory,
    "machine-missing-safety-reserve-targets-v1.json": safety,
    "machine-c6-0-1-14-1-asr-probe-selection.json": selection,
    "c6-0-1-14-1-final-replay-accounting.json": replayAccounting,
    "machine-coverage-projections.json": projections,
    "machine-code-snapshot.json": codeSnapshot,
    ...Object.fromEntries(
      Object.entries(built.artifacts).filter(
        ([name]) => name !== "c6-0-1-12-review-package-freeze.json",
      ),
    ),
  };
  for (const [name, value] of Object.entries(artifacts))
    await durableJson141(path.join(root, name), value);
  const protectedFiles = [];
  for (const file of baseline.protectedFiles) {
    const destination = path.join(root, file.relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(config.baselineFinalA, file.relativePath), destination, {
      errorOnExist: true,
      force: false,
    });
    if ((await fileHash141(destination)) !== file.byteHash)
      throw new Error("C601141_CANONICAL_BYTE_COPY_MISMATCH");
    protectedFiles.push(destination);
  }
  const frozenEvidenceRoots = [
    "audio-views",
    "legacy-fingerprint",
    "speech-sweeps-fresh",
    "speech-sweeps-replay",
    "speech-inventory-v4",
    "safety-targets",
    "local-asr-fresh",
    "local-asr-replay",
    "missing-evidence-v4",
  ];
  const evidenceFiles = (
    await Promise.all(frozenEvidenceRoots.map((key) => files141(dir(key))))
  ).flat();
  const cacheFiles = await files141(path.join(dir("baseline"), "cache"));
  const freezeFile = path.join(
    root,
    "c6-0-1-14-1-machine-speech-inventory-freeze.json",
  );
  const speechFresh = c601141SweepsSchema.parse(
    await readJson141(
      path.join(
        dir("speech-sweeps-fresh"),
        "machine-whole-media-speech-activity-sweeps.json",
      ),
    ),
  );
  const speechReplay = c601141SweepsSchema.parse(
    await readJson141(
      path.join(
        dir("speech-sweeps-replay"),
        "machine-whole-media-speech-activity-sweeps.json",
      ),
    ),
  );
  const asrFresh = c601141AsrProbesSchema.parse(
    await readJson141(
      path.join(
        dir("local-asr-fresh"),
        "machine-c6-0-1-14-1-local-asr-probes.json",
      ),
    ),
  );
  // Acquisition artifacts remain immutable. The initial loader failure and the
  // synthetic 100ms transport warmup (9 mel frames -> early return) are accounted
  // separately; neither consumed a source-audio encoder/decoder request.
  let startupFailureProviderStarts = 0;
  try {
    const failure = (await readJson141(
      path.join(
        dir("speech-sweeps-fresh"),
        "initial-loader-failure.local-only.json",
      ),
    )) as {
      providerProcessStartCount: number;
      modelLoadCount: number;
      inferenceCount: number;
      dispatchTicketCount: number;
    };
    if (
      failure.modelLoadCount !== 0 ||
      failure.inferenceCount !== 0 ||
      failure.dispatchTicketCount !== 0
    )
      throw new Error("C601141_STARTUP_FAILURE_NOT_PRE_INFERENCE");
    startupFailureProviderStarts = failure.providerProcessStartCount;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const acquisitionSummary = {
    detectorRuntimes: [
      ...new Map(
        speechFresh.runs.map((v) => [v.runtime.runtimeIdentityHash, v.runtime]),
      ).values(),
    ],
    speechFresh: speechFresh.accounting,
    speechReplay: speechReplay.accounting,
    asrFresh: asrFresh.accounting,
    asrReplay: probes.accounting,
    startupFailureProviderStarts,
    startupFailureModelLoads: 0 as const,
    startupFailureConsumedInference: 0 as const,
    nonSourceWarmupTransportCount: asrFresh.requests
      .filter((v) => v.provider === "whisper-large-v3")
      .reduce((n, v) => n + v.modelLoadDelta, 0),
    nonSourceWarmupEncoderDecoderCount: 0 as const,
    warmupAccountingBasis:
      "OBSERVED_EARLY_RETURN_STDERR_AND_PINNED_90MS_SPECTROGRAM_GUARD" as const,
    asrRuntimeIdentityHashes: [
      ...new Set(asrFresh.requests.map((v) => v.runtimeIdentityHash)),
    ],
    asrModelIdentityHashes: [
      ...new Set(asrFresh.requests.map((v) => v.modelSnapshotHash)),
    ],
    codeSnapshotHash: codeSnapshot.semanticHash,
    projectionsHash: projections.semanticHash,
  };
  const freeze = await freeze141({
    root: config.outputRoot,
    file: freezeFile,
    policy,
    source: baseline.source,
    sourcePath: config.source,
    sourceBefore: baseline.sourceBefore,
    artifactFiles: [
      ...(await files141(root)),
      ...evidenceFiles,
      ...cacheFiles,
      input.preflightFreezePath,
      input.policyPath,
      path.join(
        dir("review-package-v4"),
        "c601141-review-delivery-selection.json",
      ),
    ],
    protectedFiles,
    canonicalTextHash: baseline.canonicalTextHash,
    canonicalTimingHash: baseline.canonicalTimingHash,
    presentationHash: baseline.presentationHash,
    stage: "FINAL_MACHINE_DELIVERY",
    acquisitionSummary,
  });
  await verifyFreeze141(config.outputRoot, freezeFile, config.source);
  return {
    phase: input.final,
    freezeFile,
    freezeCompletedAt: freeze.freezeCompletedAt,
    freezeHash: freeze.semanticHash,
    canonicalTextHash: baseline.canonicalTextHash,
    canonicalTimingHash: baseline.canonicalTimingHash,
    presentationHash: baseline.presentationHash,
    ...replayAccounting,
  };
}

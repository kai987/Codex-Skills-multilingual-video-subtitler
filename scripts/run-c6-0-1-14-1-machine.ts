import path from "node:path";
import { parseArgs } from "node:util";
import { mkdir, cp } from "node:fs/promises";
import {
  c601141PolicySchema,
  c601141AudioViewsSchema,
  c601141FingerprintSchema,
  c601141SweepsSchema,
  c601141AsrSelectionSchema,
  c601141AsrProbesSchema,
  c601141SafetySchema,
  c601141InventorySchema,
} from "@mvl/shared";
import {
  config141Schema,
  loadBaseline141,
  type Config141,
} from "./lib/c601141-input.js";
import { allocateC60114Output } from "./lib/c60114-output.js";
import { freeze141, verifyFreeze141 } from "./lib/c601141-freeze.js";
import {
  policy141,
  hash141,
  authorize141,
} from "../packages/video-subtitler/src/review/c601141-policy.js";
import {
  durableJson141,
  readJson141,
} from "../packages/video-subtitler/src/review/c601141-io.js";
import {
  validateAudioViews141,
  buildAudioViews141,
} from "../packages/video-subtitler/src/review/c601141-audio-views.js";
import {
  detectorPreflight141,
  planSweeps141,
  runSweeps141,
  type C601141SweepJob,
} from "../packages/video-subtitler/src/review/c601141-detectors.js";
import { reconcileFingerprint141 } from "../packages/video-subtitler/src/review/c601141-fingerprint.js";
import {
  buildInventory141,
  uncoveredSpeech141,
  selectSafety141,
  selectAsr141,
} from "../packages/video-subtitler/src/review/c601141-inventory.js";
import { runAsr141 } from "../packages/video-subtitler/src/review/c601141-local-asr.js";
import {
  buildLexical141,
  buildMissing141,
} from "../packages/video-subtitler/src/review/c601141-lexical.js";
import { deliveryPhase141 } from "./lib/c601141-final.js";

const { values } = parseArgs({
  strict: true,
  options: {
    config: { type: "string" },
    state: { type: "string" },
    phase: { type: "string" },
    "authorize-whole-media-speech-detection": {
      type: "boolean",
      default: false,
    },
    "authorize-bounded-local-asr": { type: "boolean", default: false },
  },
});
const phase = values.phase ?? "prepare";
interface State {
  config: Config141;
  configHash: string;
  outputs: Record<string, string>;
  policyPath: string;
  preflightFreezePath: string;
}
const phases = [
  "baseline",
  "audio-views",
  "legacy-fingerprint",
  "speech-sweeps-fresh",
  "speech-sweeps-replay",
  "speech-inventory-v4",
  "safety-targets",
  "local-asr-fresh",
  "local-asr-replay",
  "missing-evidence-v4",
  "review-package-v4",
  "speech-evaluation",
  "final-a",
  "final-b",
  "validation",
];
const progress = (message: string) => process.stderr.write(`${message}\n`);
if (phase === "prepare") {
  if (!values.config) throw new Error("C601141_CONFIG_REQUIRED");
  const config = config141Schema.parse(
    await readJson141(path.resolve(values.config)),
  );
  const baseline = await loadBaseline141(config),
    policy = policy141();
  const outputs: Record<string, string> = {};
  for (const name of phases)
    outputs[name] = await allocateC60114Output(
      config.outputRoot,
      `${config.prefix}-${name}-${config.date}`,
    );
  const directory = (name: string) => {
    const value = outputs[name];
    if (!value) throw new Error(`C601141_OUTPUT_PHASE_MISSING:${name}`);
    return value;
  };
  await durableJson141(
    path.join(directory("baseline"), "baseline-replay.local-only.json"),
    baseline.baseline,
  );
  const policyPath = path.join(
    directory("baseline"),
    "c6-0-1-14-1-policy.json",
  );
  await durableJson141(policyPath, policy);
  for (const file of baseline.protectedFiles) {
    const destination = path.join(directory("baseline"), file.relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(config.baselineFinalA, file.relativePath), destination, {
      errorOnExist: true,
      force: false,
    });
  }
  const controls = await validateAudioViews141({
    directory: path.join(directory("audio-views"), "synthetic-controls"),
    nativeSampleRate: baseline.source.sampleRate,
  });
  progress(
    "Audio view synthetic controls passed; decoding source-preserving views.",
  );
  const views = await buildAudioViews141({
    sourcePath: config.source,
    source: baseline.source,
    policy,
    outputDirectory: directory("audio-views"),
    syntheticValidationHash: controls.semanticHash,
  });
  const viewsPath = path.join(
    directory("audio-views"),
    "machine-source-audio-views-v1.json",
  );
  await durableJson141(viewsPath, views);
  const backends = await detectorPreflight141(config.speechRuntime);
  const jobs = planSweeps141(views, policy, backends),
    planPath = path.join(
      directory("baseline"),
      "speech-sweep-plan.local-only.json",
    );
  await durableJson141(planPath, {
    schemaVersion: "1.0.0",
    jobs,
    planHash: hash141(jobs),
    authorized: authorize141(
      "SPEECH",
      values["authorize-whole-media-speech-detection"],
    ),
    inferenceCount: 0,
  });
  const preflightFreezePath = path.join(
    directory("baseline"),
    "pre-inference-policy-freeze.json",
  );
  const state: State = {
    config,
    configHash: hash141(config),
    outputs,
    policyPath,
    preflightFreezePath,
  };
  const stateFile = path.join(
    directory("baseline"),
    "c6-0-1-14-1-run-paths.local-only.json",
  );
  await durableJson141(stateFile, state);
  await freeze141({
    root: config.outputRoot,
    file: preflightFreezePath,
    policy,
    source: baseline.source,
    sourcePath: config.source,
    sourceBefore: baseline.sourceBefore,
    artifactFiles: [
      policyPath,
      viewsPath,
      planPath,
      stateFile,
      ...views.views.map((v) =>
        path.join(directory("audio-views"), v.relativePath),
      ),
    ],
    protectedFiles: baseline.protectedFiles.map((f) =>
      path.join(directory("baseline"), f.relativePath),
    ),
    canonicalTextHash: baseline.canonicalTextHash,
    canonicalTimingHash: baseline.canonicalTimingHash,
    presentationHash: baseline.presentationHash,
    stage: "PRE_INFERENCE_POLICY",
  });
  console.log(
    JSON.stringify(
      {
        stateFile,
        outputs,
        views: views.summary,
        plannedSpeechRuns: jobs.length,
        inferenceCount: 0,
      },
      null,
      2,
    ),
  );
} else {
  if (!values.state) throw new Error("C601141_STATE_REQUIRED");
  const state = (await readJson141(path.resolve(values.state))) as State;
  const config = config141Schema.parse(state.config);
  if (hash141(config) !== state.configHash)
    throw new Error("C601141_CONFIG_IDENTITY_CHANGED");
  await verifyFreeze141(
    config.outputRoot,
    state.preflightFreezePath,
    config.source,
  );
  const directory = (name: string) => {
    const result = state.outputs[name];
    if (!result) throw new Error(`C601141_PHASE_DIRECTORY_MISSING:${name}`);
    return result;
  };
  const policy = c601141PolicySchema.parse(await readJson141(state.policyPath));
  const views = c601141AudioViewsSchema.parse(
    await readJson141(
      path.join(directory("audio-views"), "machine-source-audio-views-v1.json"),
    ),
  );
  if (phase === "speech-fresh" || phase === "speech-replay") {
    const plan = (await readJson141(
      path.join(directory("baseline"), "speech-sweep-plan.local-only.json"),
    )) as { jobs: C601141SweepJob[]; planHash: string };
    if (hash141(plan.jobs) !== plan.planHash)
      throw new Error("C601141_FROZEN_PLAN_MISMATCH");
    if (
      phase === "speech-fresh" &&
      !authorize141("SPEECH", values["authorize-whole-media-speech-detection"])
    ) {
      console.log(
        JSON.stringify({
          phase,
          status: "PLAN_ONLY_AUTHORIZATION_REQUIRED",
          plannedRuns: plan.jobs.length,
          planHash: plan.planHash,
          inferenceCount: 0,
        }),
      );
      process.exit(0);
    }
    const artifact = await runSweeps141({
      mode: phase === "speech-fresh" ? "FRESH" : "EXACT_CACHE_ONLY",
      authorized: authorize141(
        "SPEECH",
        values["authorize-whole-media-speech-detection"],
      ),
      views,
      policy,
      jobs: plan.jobs,
      viewsDirectory: directory("audio-views"),
      cacheDirectory: path.join(directory("baseline"), "cache"),
      outputDirectory: directory(
        phase === "speech-fresh"
          ? "speech-sweeps-fresh"
          : "speech-sweeps-replay",
      ),
      onProgress: progress,
    });
    console.log(JSON.stringify(artifact.accounting, null, 2));
  } else if (phase === "fingerprint") {
    const baseline = await loadBaseline141(config);
    const fingerprint = await reconcileFingerprint141({
      policy,
      views,
      viewsDirectory: directory("audio-views"),
      lineage: baseline.previous.lineage,
      requests:
        baseline.input.machineArtifacts[
          "asr-request-timeline-contract-v2.json"
        ],
      tokens:
        baseline.input.machineArtifacts[
          "machine-global-token-timeline-v2.json"
        ],
      vad: baseline.input.machineArtifacts.vadTimebase,
      audioRoots: config.legacyAudioRoots,
      python: config.speechRuntime.python,
      worker: path.resolve("scripts/runtime/c601141_audio_fingerprint.py"),
      outputDirectory: directory("legacy-fingerprint"),
    });
    await durableJson141(
      path.join(
        directory("legacy-fingerprint"),
        "machine-legacy-audio-fingerprint-reconciliation.json",
      ),
      fingerprint,
    );
    console.log(JSON.stringify(fingerprint.summary, null, 2));
  } else if (phase === "inventory") {
    const baseline = await loadBaseline141(config);
    const fingerprint = c601141FingerprintSchema.parse(
      await readJson141(
        path.join(
          directory("legacy-fingerprint"),
          "machine-legacy-audio-fingerprint-reconciliation.json",
        ),
      ),
    );
    const fresh = c601141SweepsSchema.parse(
      await readJson141(
        path.join(
          directory("speech-sweeps-fresh"),
          "machine-whole-media-speech-activity-sweeps.json",
        ),
      ),
    );
    const replay = c601141SweepsSchema.parse(
      await readJson141(
        path.join(
          directory("speech-sweeps-replay"),
          "machine-whole-media-speech-activity-sweeps.json",
        ),
      ),
    );
    if (
      fresh.evidenceSemanticHash !== replay.evidenceSemanticHash ||
      replay.accounting.inferenceCount !== 0 ||
      replay.accounting.modelLoadCount !== 0 ||
      replay.accounting.providerProcessStartCount !== 0 ||
      replay.accounting.cacheHits !== fresh.runs.length
    )
      throw new Error("C601141_SWEEP_REPLAY_PARITY_FAILED");
    const inventory = buildInventory141({
      policy,
      source: baseline.source,
      viewsHash: views.semanticHash,
      fingerprint,
      sweeps: replay,
      previous: baseline.previous.islands,
      cueIntervals: baseline.subtitlePackage.cues,
      sceneBoundaries: baseline.previous.islands.boundaries
        .filter((v) => v.kind === "SCENE")
        .map((v) => v.at),
    });
    const uncovered = uncoveredSpeech141({
      inventory,
      policy,
      cues: baseline.subtitlePackage.cues,
      previousTargets: baseline.previous.targets.targets,
      finalCueHash: hash141(baseline.subtitlePackage.cues),
      previousTargetsHash: baseline.previous.targets.semanticHash,
    });
    const safety = selectSafety141(uncovered, policy),
      selection = selectAsr141(safety, policy, new Date().toISOString());
    const artifacts = [
      [
        directory("speech-inventory-v4"),
        "machine-source-global-speech-inventory-v4.json",
        inventory,
      ],
      [
        directory("speech-inventory-v4"),
        "machine-uncovered-speech-candidates-v1.json",
        uncovered,
      ],
      [
        directory("safety-targets"),
        "machine-missing-safety-reserve-targets-v1.json",
        safety,
      ],
      [
        directory("safety-targets"),
        "machine-c6-0-1-14-1-asr-probe-selection.json",
        selection,
      ],
    ] as const;
    for (const [dir, name, artifact] of artifacts)
      await durableJson141(path.join(dir, name), artifact);
    await freeze141({
      root: config.outputRoot,
      file: path.join(
        directory("safety-targets"),
        "pre-asr-selection-freeze.json",
      ),
      policy,
      source: baseline.source,
      sourcePath: config.source,
      sourceBefore: baseline.sourceBefore,
      artifactFiles: artifacts.map(([dir, name]) => path.join(dir, name)),
      protectedFiles: baseline.protectedFiles.map((f) =>
        path.join(directory("baseline"), f.relativePath),
      ),
      canonicalTextHash: baseline.canonicalTextHash,
      canonicalTimingHash: baseline.canonicalTimingHash,
      presentationHash: baseline.presentationHash,
      stage: "PRE_ASR_SELECTION",
    });
    console.log(
      JSON.stringify(
        {
          inventory: inventory.summary,
          uncovered: uncovered.summary,
          safety: safety.summary,
          asrTargets: selection.targets.length,
          maximumRequests: selection.maximumAuthorizedRequests,
        },
        null,
        2,
      ),
    );
  } else if (phase === "asr-fresh" || phase === "asr-replay") {
    await verifyFreeze141(
      config.outputRoot,
      path.join(directory("safety-targets"), "pre-asr-selection-freeze.json"),
      config.source,
    );
    const selection = c601141AsrSelectionSchema.parse(
      await readJson141(
        path.join(
          directory("safety-targets"),
          "machine-c6-0-1-14-1-asr-probe-selection.json",
        ),
      ),
    );
    if (
      phase === "asr-fresh" &&
      !authorize141("ASR", values["authorize-bounded-local-asr"])
    ) {
      console.log(
        JSON.stringify({
          phase,
          status: "PLAN_ONLY_AUTHORIZATION_REQUIRED",
          targetCount: selection.targets.length,
          maximumAuthorizedRequests: selection.maximumAuthorizedRequests,
          selectionHash: selection.semanticHash,
          inferenceCount: 0,
        }),
      );
      process.exit(0);
    }
    const artifact = await runAsr141({
      mode: phase === "asr-fresh" ? "FRESH" : "EXACT_CACHE_ONLY",
      authorized: authorize141("ASR", values["authorize-bounded-local-asr"]),
      selection,
      policy,
      runtimeInput: {
        ...config.asrRuntime,
        sourcePath: config.source,
        sourceIdentity: selection.sourceIdentity,
        outputDirectory: directory("local-asr-fresh"),
      },
      cacheDirectory: path.join(directory("baseline"), "cache"),
      outputDirectory: directory(
        phase === "asr-fresh" ? "local-asr-fresh" : "local-asr-replay",
      ),
      freshDirectory: directory("local-asr-fresh"),
      sudachi: {
        manifest: config.sudachiRuntimeManifestPath,
        python: path.join(
          path.dirname(config.sudachiRuntimeManifestPath),
          "venv/bin/python",
        ),
        helper: path.resolve("scripts/sudachi-readings.py"),
        requirements: path.resolve("scripts/requirements-sudachi.txt"),
      },
      onProgress: progress,
    });
    console.log(JSON.stringify(artifact.accounting, null, 2));
  } else if (phase === "lexical") {
    const baseline = await loadBaseline141(config);
    const safety = c601141SafetySchema.parse(
      await readJson141(
        path.join(
          directory("safety-targets"),
          "machine-missing-safety-reserve-targets-v1.json",
        ),
      ),
    );
    const inventory = c601141InventorySchema.parse(
      await readJson141(
        path.join(
          directory("speech-inventory-v4"),
          "machine-source-global-speech-inventory-v4.json",
        ),
      ),
    );
    const fresh = c601141AsrProbesSchema.parse(
      await readJson141(
        path.join(
          directory("local-asr-fresh"),
          "machine-c6-0-1-14-1-local-asr-probes.json",
        ),
      ),
    );
    const replay = c601141AsrProbesSchema.parse(
      await readJson141(
        path.join(
          directory("local-asr-replay"),
          "machine-c6-0-1-14-1-local-asr-probes.json",
        ),
      ),
    );
    if (
      fresh.evidenceSemanticHash !== replay.evidenceSemanticHash ||
      replay.accounting.inferenceCount !== 0 ||
      replay.accounting.modelLoadCount !== 0 ||
      replay.accounting.providerProcessStartCount !== 0
    )
      throw new Error("C601141_ASR_REPLAY_PARITY_FAILED");
    const fingerprint = c601141FingerprintSchema.parse(
      await readJson141(
        path.join(
          directory("legacy-fingerprint"),
          "machine-legacy-audio-fingerprint-reconciliation.json",
        ),
      ),
    );
    const lexical = buildLexical141(replay, safety, policy, {
      existing: baseline.previous.lexical,
      fingerprint,
      tokens:
        baseline.input.machineArtifacts[
          "machine-global-token-timeline-v2.json"
        ],
    });
    const missing = buildMissing141(inventory, safety, lexical, policy);
    await durableJson141(
      path.join(
        directory("missing-evidence-v4"),
        "machine-missing-lexical-evidence-v4.json",
      ),
      lexical,
    );
    await durableJson141(
      path.join(
        directory("missing-evidence-v4"),
        "machine-missing-speech-evidence-v4.json",
      ),
      missing,
    );
    console.log(
      JSON.stringify(
        { lexical: lexical.summary, missing: missing.summary },
        null,
        2,
      ),
    );
  } else if (
    phase === "delivery" ||
    phase === "final-a" ||
    phase === "final-b"
  ) {
    console.log(
      JSON.stringify(
        await deliveryPhase141({
          ...state,
          final: phase === "delivery" ? null : phase,
          onProgress: progress,
        }),
        null,
        2,
      ),
    );
  } else throw new Error(`C601141_UNKNOWN_PHASE:${phase}`);
}

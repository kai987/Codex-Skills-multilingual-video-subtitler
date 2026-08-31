import path from "node:path";
import { access } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  policy142Schema,
  dialogueViews142Schema,
  viewAudit142Schema,
  phaseA142Schema,
  detectorPlan142Schema,
  detectorFreeze142Schema,
  asrSelection142Schema,
  asrPlan142Schema,
  asrProbes142Schema,
  lexical142Schema,
  missing142Schema,
  supersession142Schema,
} from "@mvl/shared";
import { allocateC60114Output } from "./lib/c60114-output.js";
import {
  config142Schema,
  loadBaseline142,
  replayBaseline142,
  type State142,
} from "./lib/c601142-input.js";
import {
  readJson141,
  durableJson141,
  fileHash141,
} from "../packages/video-subtitler/src/review/c601141-io.js";
import {
  hash141,
  hashed141,
  required141,
  assertHash141,
} from "../packages/video-subtitler/src/review/c601141-policy.js";
import {
  policy142,
  header142,
  authorized142,
} from "../packages/video-subtitler/src/review/c601142-policy.js";
import {
  oldCandidates142,
  phaseA142,
} from "../packages/video-subtitler/src/review/c601142-selection.js";
import { buildViews142 } from "../packages/video-subtitler/src/review/c601142-audio-views.js";
import {
  detectorPreflight142,
  planDetectors142,
  runDetectors142,
  type DetectorExecution142,
} from "../packages/video-subtitler/src/review/c601142-detectors.js";
import { buildEvidence142, loadEvidence142 } from "./lib/c601142-evidence.js";
import {
  planAsr142,
  runAsr142,
} from "../packages/video-subtitler/src/review/c601142-asr.js";
import {
  buildLexical142,
  buildMissing142,
} from "../packages/video-subtitler/src/review/c601142-lexical.js";
import { buildWorkspace142 } from "./lib/c601142-build-workspace.js";
import { buildComparisons142 } from "./lib/c601142-comparisons.js";
import { finalPhase142 } from "./lib/c601142-final.js";
const { values } = parseArgs({
  strict: true,
  options: {
    config: { type: "string" },
    state: { type: "string" },
    phase: { type: "string" },
    "new-selection-attempt": { type: "boolean", default: false },
    "new-view-attempt": { type: "boolean", default: false },
    "authorize-c6-0-1-14-2-detector-ceiling": {
      type: "boolean",
      default: false,
    },
    "authorize-c6-0-1-14-2-local-asr": { type: "boolean", default: false },
  },
});
const phase = values.phase ?? "baseline";
if (phase === "baseline") {
  const config = config142Schema.parse(
      await readJson141(required141(values.config)),
    ),
    old = await loadBaseline142(config);
  const outputs: Record<string, string> = {};
  for (const role of [
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
    "evaluation",
    "final-a",
    "final-b",
    "validation",
  ])
    outputs[role] = await allocateC60114Output(
      config.outputRoot,
      `${config.prefix}-${role}-${config.date}`,
    );
  const baselineDirectory = required141(outputs.baseline),
    policyPath = path.join(baselineDirectory, "c6-0-1-14-2-policy.json");
  const state: State142 = {
    config,
    configHash: hash141(config),
    outputs,
    policyPath,
    baselineSourceIdentityHash: hash141(old.baseline.source),
    createdAt: new Date().toISOString(),
  };
  await durableJson141(policyPath, policy142());
  const statePath = path.join(
    baselineDirectory,
    "c6-0-1-14-2-run-paths.local-only.json",
  );
  await durableJson141(statePath, state);
  const replay = await replayBaseline142(old, baselineDirectory);
  console.log(
    JSON.stringify(
      {
        statePath,
        detector: replay.detector,
        asr: replay.asr,
        targets: replay.targetCount,
        regions: replay.regionCount,
        fullQueueSeconds: replay.fullQueueSeconds,
      },
      null,
      2,
    ),
  );
} else {
  const state = (await readJson141(required141(values.state))) as State142;
  const config = config142Schema.parse(state.config);
  if (state.configHash !== hash141(config))
    throw new Error("C601142_CONFIG_CHANGED");
  const dir = (role: string) => required141(state.outputs[role]);
  try {
    await access(
      path.join(dir("evaluation"), "c6-0-1-14-2-first-gold-read-intent.json"),
    );
    throw new Error("C601142_MACHINE_PHASE_AFTER_GOLD_FORBIDDEN");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const policy = policy142Schema.parse(await readJson141(state.policyPath));
  const old = await loadBaseline142(config);
  if (hash141(old.baseline.source) !== state.baselineSourceIdentityHash)
    throw new Error("C601142_SOURCE_CHANGED");
  if (phase === "allocate-finals") {
    for (const role of ["final-a", "final-b", "validation"])
      state.outputs[role] = await allocateC60114Output(
        config.outputRoot,
        `${config.prefix}-${role}-${config.date}`,
      );
    const revisedState = path.join(
      dir("validation"),
      "c6-0-1-14-2-run-paths.local-only.json",
    );
    await durableJson141(revisedState, state);
    console.log(
      JSON.stringify({
        revisedState,
        previousFinalAttemptsPreserved: true,
        inferenceCount: 0,
        goldReadCount: 0,
      }),
    );
  } else if (phase === "selection") {
    if (values["new-selection-attempt"]) {
      for (const role of ["selection-audit", "target-clusters", "selection-v2"])
        state.outputs[role] = await allocateC60114Output(
          config.outputRoot,
          `${config.prefix}-${role}-${config.date}`,
        );
      const revisedState = path.join(
        dir("selection-v2"),
        "c6-0-1-14-2-run-paths.local-only.json",
      );
      await durableJson141(revisedState, state);
      console.log(
        JSON.stringify({ revisedState, previousPhaseAAttemptPreserved: true }),
      );
    }
    const uncovered = oldCandidates142(old.uncovered, old.inventory, policy),
      rate = old.baseline.source.sampleRate;
    const native = (v: { start: number; end: number }) => ({
      startSample: Math.round(v.start * rate),
      endSample: Math.round(v.end * rate),
    });
    const result = phaseA142(
      {
        uncovered,
        oldSafety: old.safety,
        policy,
        boundaries: {
          cueMasks: old.baseline.subtitlePackage.cues.map(native),
          existingTargetMasks: old.baseline.previous.targets.targets.map((t) =>
            native(t.sourceInterval),
          ),
          sceneSamples: old.baseline.previous.islands.boundaries
            .filter((b) => b.kind === "SCENE")
            .map((b) => Math.round(b.at * rate)),
          speakerSamples: old.baseline.previous.islands.boundaries
            .filter((b) => b.kind === "SPEAKER")
            .map((b) => Math.round(b.at * rate)),
        },
        speechIntervals: old.inventory.observations
          .filter(
            (o) =>
              o.verifiedTimebase && o.speechPositive && !o.strongContradiction,
          )
          .map((o) => o.nativeInterval),
      },
      state.createdAt,
    );
    for (const [role, name, artifact] of [
      [
        "selection-audit",
        "machine-safety-target-selection-pathology-audit.json",
        result.pathology,
      ],
      [
        "selection-audit",
        "machine-uncovered-speech-candidates-v2.json",
        uncovered,
      ],
      [
        "target-clusters",
        "machine-safety-target-clusters-v2.json",
        result.clusters,
      ],
      [
        "selection-v2",
        "machine-missing-safety-reserve-targets-v2.json",
        result.safety,
      ],
      [
        "selection-v2",
        "machine-safety-target-supersession-ledger.json",
        result.supersession,
      ],
      [
        "selection-v2",
        "c6-0-1-14-2-phase-a-selection-projection.json",
        result.projection,
      ],
    ] as const)
      await durableJson141(path.join(dir(role), name), artifact);
    console.log(
      JSON.stringify(
        {
          pathology: result.pathology.counts,
          clusters: result.clusters.summary,
          selection: result.safety.summary,
          supersession: result.supersession.summary,
          inferenceCount: 0,
        },
        null,
        2,
      ),
    );
  } else if (phase === "views") {
    if (values["new-view-attempt"]) {
      for (const role of ["audio-view-audit", "dialogue-views"])
        state.outputs[role] = await allocateC60114Output(
          config.outputRoot,
          `${config.prefix}-${role}-${config.date}`,
        );
      const revisedState = path.join(
        dir("dialogue-views"),
        "c6-0-1-14-2-run-paths.local-only.json",
      );
      await durableJson141(revisedState, state);
      console.log(
        JSON.stringify({ revisedState, previousViewAttemptPreserved: true }),
      );
    }
    const result = await buildViews142({
      policy,
      oldViews: old.views,
      oldDirectory: old.dir("audio-views"),
      outputDirectory: dir("dialogue-views"),
      auditDirectory: dir("audio-view-audit"),
      python: old.config.speechRuntime.python,
      worker: path.resolve("scripts/runtime/c601142_audio_views.py"),
    });
    console.log(
      JSON.stringify(
        {
          views: result.manifest.summary,
          auditHash: result.audit.semanticHash,
          inferenceCount: 0,
        },
        null,
        2,
      ),
    );
  } else if (phase === "detector-plan") {
    const views = dialogueViews142Schema.parse(
      await readJson141(
        path.join(
          dir("dialogue-views"),
          "machine-dialogue-emphasis-audio-views-v2.json",
        ),
      ),
    );
    const audit = viewAudit142Schema.parse(
      await readJson141(
        path.join(
          dir("audio-view-audit"),
          "machine-audio-view-effectiveness-audit.json",
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
    const runtimes = await detectorPreflight142(
      {
        ...old.config.speechRuntime,
        worker: path.resolve("scripts/runtime/c601142_speech_detector.py"),
      },
      config.webrtcRuntimeDirectory,
    );
    const { plan, execution } = planDetectors142({
      policy,
      oldViews: old.views,
      views,
      audit,
      phaseAHash: phaseA.semanticHash,
      ...runtimes,
      oldDirectory: old.dir("audio-views"),
      viewDirectory: dir("dialogue-views"),
      frozenAt: new Date().toISOString(),
    });
    const planPath = path.join(
        dir("baseline"),
        "machine-c6-0-1-14-2-detector-plan.json",
      ),
      executionPath = path.join(
        dir("baseline"),
        "detector-execution.local-only.json",
      );
    await durableJson141(planPath, plan);
    await durableJson141(executionPath, execution);
    await durableJson141(
      path.join(
        dir("baseline"),
        "machine-independent-speech-presence-runtime.json",
      ),
      runtimes.independent,
    );
    const code = [
      "scripts/runtime/c601142_speech_detector.py",
      "scripts/runtime/c601141_speech_activity_worker.py",
      "scripts/runtime/c601142_audio_views.py",
      "packages/video-subtitler/src/review/c601142-policy.ts",
      "packages/video-subtitler/src/review/c601142-selection.ts",
      "packages/video-subtitler/src/review/c601142-detectors.ts",
      "packages/video-subtitler/src/review/c601142-scores.ts",
    ];
    const outputs = [
      state.policyPath,
      planPath,
      executionPath,
      path.join(
        dir("selection-audit"),
        "machine-safety-target-selection-pathology-audit.json",
      ),
      path.join(
        dir("target-clusters"),
        "machine-safety-target-clusters-v2.json",
      ),
      path.join(
        dir("selection-v2"),
        "c6-0-1-14-2-phase-a-selection-projection.json",
      ),
      path.join(
        dir("selection-v2"),
        "machine-missing-safety-reserve-targets-v2.json",
      ),
      path.join(
        dir("selection-v2"),
        "machine-safety-target-supersession-ledger.json",
      ),
      path.join(
        dir("audio-view-audit"),
        "machine-audio-view-effectiveness-audit.json",
      ),
      path.join(
        dir("dialogue-views"),
        "machine-dialogue-emphasis-audio-views-v2.json",
      ),
      ...views.views.map((v) =>
        path.join(dir("dialogue-views"), v.relativePath),
      ),
    ];
    const files = [
      ...(await Promise.all(
        code.map(async (relativePath) => ({
          domain: "SOURCE_CODE" as const,
          relativePath,
          sha256: await fileHash141(path.resolve(relativePath)),
        })),
      )),
      ...(await Promise.all(
        outputs.map(async (file) => ({
          domain: "OUTPUT" as const,
          relativePath: path.relative(config.outputRoot, file),
          sha256: await fileHash141(file),
        })),
      )),
      {
        domain: "WEBRTC_RUNTIME" as const,
        relativePath: "runtime-manifest.json",
        sha256: await fileHash141(
          path.join(config.webrtcRuntimeDirectory, "runtime-manifest.json"),
        ),
      },
    ];
    const freeze = detectorFreeze142Schema.parse(
      hashed141({
        ...header142(policy, views.sourceIdentity),
        artifactType: "machine-c601142-pre-detector-freeze",
        frozenAt: new Date().toISOString(),
        planHash: plan.semanticHash,
        phaseAHash: phaseA.semanticHash,
        runtimeManifestHash: runtimes.independent.semanticHash,
        files,
        detectorInferenceBeforeFreeze: 0,
        asrInferenceBeforeFreeze: 0,
        goldReadBeforeFreeze: false,
      }),
    );
    await durableJson141(
      path.join(dir("baseline"), "machine-c601142-pre-detector-freeze.json"),
      freeze,
    );
    console.log(
      JSON.stringify(
        {
          planHash: plan.semanticHash,
          freezeHash: freeze.semanticHash,
          planned: plan.jobs.map((j) => ({
            family: j.family,
            view: j.viewRole,
          })),
          modelInferenceCount: 0,
        },
        null,
        2,
      ),
    );
  } else if (phase === "detectors-fresh" || phase === "detectors-replay") {
    const plan = detectorPlan142Schema.parse(
      await readJson141(
        path.join(dir("baseline"), "machine-c6-0-1-14-2-detector-plan.json"),
      ),
    );
    const freeze = detectorFreeze142Schema.parse(
      await readJson141(
        path.join(dir("baseline"), "machine-c601142-pre-detector-freeze.json"),
      ),
    );
    assertHash141(freeze);
    if (freeze.planHash !== plan.semanticHash)
      throw new Error("C601142_PRE_DETECTOR_FREEZE_MISMATCH");
    for (const entry of freeze.files) {
      const root =
        entry.domain === "SOURCE_CODE"
          ? process.cwd()
          : entry.domain === "OUTPUT"
            ? config.outputRoot
            : config.webrtcRuntimeDirectory;
      if (
        (await fileHash141(path.join(root, entry.relativePath))) !==
        entry.sha256
      )
        throw new Error(
          `C601142_PRE_DETECTOR_FROZEN_FILE_CHANGED:${entry.relativePath}`,
        );
    }
    const fresh = phase === "detectors-fresh";
    const result = await runDetectors142({
      mode: fresh ? "FRESH" : "EXACT_CACHE_ONLY",
      plan,
      policy,
      ...(fresh
        ? {
            execution: (await readJson141(
              path.join(dir("baseline"), "detector-execution.local-only.json"),
            )) as DetectorExecution142[],
          }
        : {}),
      cacheDirectory: path.join(dir("baseline"), "cache"),
      outputDirectory: dir(phase),
      authorized: authorized142(
        "DETECTOR",
        values["authorize-c6-0-1-14-2-detector-ceiling"],
      ),
      onProgress: (event) => console.log(JSON.stringify(event)),
    });
    console.log(
      JSON.stringify(
        {
          accounting: result.sweeps.accounting,
          evidenceHash: result.sweeps.evidenceSemanticHash,
          scoreTrackCount: result.scores.tracks.length,
        },
        null,
        2,
      ),
    );
  } else if (phase === "evidence") {
    const result = await buildEvidence142(old, state, policy);
    console.log(
      JSON.stringify(
        {
          inventory: result.inventory.summary,
          masked: result.masked.summary,
          candidates: result.uncovered.summary,
          selection: result.safety.summary,
          newAsrTargets: result.asrSelection.targets.length,
          asrMaximumRequests: result.asrSelection.maximumAuthorizedRequests,
        },
        null,
        2,
      ),
    );
  } else if (["asr-plan", "asr-fresh", "asr-replay"].includes(phase)) {
    const selection = asrSelection142Schema.parse(
      await readJson141(
        path.join(
          dir("inventory-v5"),
          "machine-c6-0-1-14-2-asr-probe-selection.json",
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
    if (phase === "asr-plan") {
      const plan = await planAsr142({
        selection,
        policy,
        runtimeInput,
        reading,
        outputDirectory: dir("local-asr-fresh"),
      });
      console.log(
        JSON.stringify(
          {
            planHash: plan.semanticHash,
            requests: plan.requests.length,
            identities: plan.identities.map((i) => i.provider),
            inferenceCount: 0,
          },
          null,
          2,
        ),
      );
    } else {
      const plan = asrPlan142Schema.parse(
        await readJson141(
          path.join(
            dir("local-asr-fresh"),
            "machine-c601142-asr-execution-plan.json",
          ),
        ),
      );
      const artifact = await runAsr142({
        selection,
        policy,
        plan,
        runtimeInput,
        reading,
        mode: phase === "asr-fresh" ? "FRESH" : "EXACT_CACHE_ONLY",
        authorized: authorized142(
          "ASR",
          values["authorize-c6-0-1-14-2-local-asr"],
        ),
        cacheDirectory: path.join(dir("baseline"), "cache"),
        outputDirectory: dir(
          phase === "asr-fresh" ? "local-asr-fresh" : "local-asr-replay",
        ),
        freshDirectory: dir("local-asr-fresh"),
        onProgress: (message) => console.log(message),
      });
      console.log(
        JSON.stringify(
          {
            accounting: artifact.accounting,
            evidenceSemanticHash: artifact.evidenceSemanticHash,
          },
          null,
          2,
        ),
      );
    }
  } else if (phase === "lexical") {
    const evidence = await loadEvidence142(state),
      probes = asrProbes142Schema.parse(
        await readJson141(
          path.join(
            dir("local-asr-fresh"),
            "machine-c6-0-1-14-2-local-asr-probes.json",
          ),
        ),
      );
    const replay = asrProbes142Schema.parse(
      await readJson141(
        path.join(
          dir("local-asr-replay"),
          "machine-c6-0-1-14-2-local-asr-probes.json",
        ),
      ),
    );
    if (
      probes.evidenceSemanticHash !== replay.evidenceSemanticHash ||
      replay.accounting.inferenceCount ||
      replay.accounting.modelLoadCount ||
      replay.accounting.providerProcessStartCount
    )
      throw new Error("C601142_ASR_REPLAY_PARITY_FAILED");
    const lexical = buildLexical142({
      policy,
      safety: evidence.safety,
      probes,
      previousProbes: old.asr,
      previousLexical: old.lexical,
    });
    const missing = buildMissing142(
      evidence.inventory,
      evidence.safety,
      lexical,
      policy,
    );
    await durableJson141(
      path.join(
        dir("missing-evidence-v5"),
        "machine-missing-lexical-evidence-v5.json",
      ),
      lexical,
    );
    await durableJson141(
      path.join(
        dir("missing-evidence-v5"),
        "machine-missing-speech-evidence-v5.json",
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
  } else if (phase === "delivery") {
    const evidence = await loadEvidence142(state);
    const lexical = lexical142Schema.parse(
      await readJson141(
        path.join(
          dir("missing-evidence-v5"),
          "machine-missing-lexical-evidence-v5.json",
        ),
      ),
    );
    const missing = missing142Schema.parse(
      await readJson141(
        path.join(
          dir("missing-evidence-v5"),
          "machine-missing-speech-evidence-v5.json",
        ),
      ),
    );
    const supersession = supersession142Schema.parse(
      await readJson141(
        path.join(
          dir("inventory-v5"),
          "machine-safety-target-supersession-ledger.json",
        ),
      ),
    );
    const workspace = await allocateC60114Output(
      dir("review-package-v5"),
      "review-workspace",
    );
    const built = await buildWorkspace142({
      baseline: old.baseline,
      policy,
      inventory: evidence.inventory,
      safety: evidence.safety,
      lexical,
      missing,
      supersessionHash: supersession.semanticHash,
      sourcePath: old.config.source,
      outputDirectory: workspace,
      generatedAt: state.createdAt,
    });
    await durableJson141(
      path.join(
        dir("review-package-v5"),
        "c601142-review-delivery-selection.json",
      ),
      {
        directoryName: path.basename(workspace),
        semanticHash: built.workspaceData.detectorCeilingReviewV2.semanticHash,
        physical: built.physical,
      },
    );
    console.log(
      JSON.stringify(
        {
          workspace,
          targets: built.graph.targets.summary,
          items: built.graph.items.summary,
          audio: built.physical,
          fullQueueSeconds: built.playback.plans.find(
            (p) => p.planId === "C601142_FINAL_FULL_QUEUE",
          )?.uniqueAudioSeconds,
          burden: built.playback.burdenGate,
        },
        null,
        2,
      ),
    );
  } else if (phase === "comparisons") {
    const evidence = await loadEvidence142(state),
      result = await buildComparisons142({
        old,
        state,
        policy,
        inventory: evidence.inventory,
      });
    console.log(
      JSON.stringify(
        {
          comparisons: result.entries.map((e) => ({
            role: e.role,
            targets: e.projection.targets.length,
            physicalWavCount: e.projection.physicalAudio.length,
            workspaceRelativePath: e.workspaceRelativePath,
          })),
          inferenceCount: 0,
          goldReadCount: 0,
        },
        null,
        2,
      ),
    );
  } else if (phase === "final-a" || phase === "final-b") {
    const result = await finalPhase142({ old, state, policy, role: phase });
    console.log(JSON.stringify(result, null, 2));
  } else throw new Error(`C601142_UNKNOWN_PHASE:${phase}`);
}

import path from "node:path";
import {
  clusters142Schema,
  inventory142Schema,
  masked142Schema,
  safety142Schema,
  scoreTracks142Schema,
  sweeps142Schema,
  type Policy142,
} from "@mvl/shared";
import {
  buildMasked142,
  buildInventory142,
  nativeMasks142,
  uncoveredSpeech142,
} from "../../packages/video-subtitler/src/review/c601142-inventory.js";
import {
  clusterCandidates142,
  selectSafety142,
  supersession142,
} from "../../packages/video-subtitler/src/review/c601142-selection.js";
import { selectAsr142 } from "../../packages/video-subtitler/src/review/c601142-asr.js";
import {
  readJson141,
  durableJson141,
} from "../../packages/video-subtitler/src/review/c601141-io.js";
import {
  hash141,
  hashed141,
  required141,
  duration141,
} from "../../packages/video-subtitler/src/review/c601141-policy.js";
import { header142 } from "../../packages/video-subtitler/src/review/c601142-policy.js";
import type { Baseline142, State142 } from "./c601142-input.js";
export async function buildEvidence142(
  old: Baseline142,
  state: State142,
  policy: Policy142,
) {
  const dir = (role: string) => required141(state.outputs[role]);
  const sweeps = sweeps142Schema.parse(
    await readJson141(
      path.join(
        dir("detectors-fresh"),
        "machine-independent-speech-presence-sweeps.json",
      ),
    ),
  );
  const replay = sweeps142Schema.parse(
    await readJson141(
      path.join(
        dir("detectors-replay"),
        "machine-independent-speech-presence-sweeps.json",
      ),
    ),
  );
  const scores = scoreTracks142Schema.parse(
    await readJson141(
      path.join(
        dir("detectors-fresh"),
        "machine-speech-detector-score-tracks-v1.json",
      ),
    ),
  );
  if (
    sweeps.evidenceSemanticHash !== replay.evidenceSemanticHash ||
    replay.accounting.inferenceCount ||
    replay.accounting.modelLoadCount ||
    replay.accounting.providerProcessStartCount
  )
    throw new Error("C601142_DETECTOR_REPLAY_PARITY_FAILED");
  const native = required141(
    old.views.views.find((v) => v.role === "NATIVE_MONO"),
  );
  const masked = await buildMasked142({
    scores,
    sweeps,
    policy,
    python: old.config.speechRuntime.python,
    worker: path.resolve("scripts/runtime/c601142_audio_views.py"),
    audioPath: path.join(old.dir("audio-views"), native.relativePath),
    expectedPcmSha256: native.pcmSha256,
    outputDirectory: dir("masked-speech"),
  });
  return await materializeInventory142(old, state, policy, sweeps, masked);
}
export async function materializeInventory142(
  old: Baseline142,
  state: State142,
  policy: Policy142,
  sweeps: ReturnType<typeof sweeps142Schema.parse>,
  masked: ReturnType<typeof masked142Schema.parse>,
) {
  const dir = (role: string) => required141(state.outputs[role]),
    source = old.baseline.source,
    rate = source.sampleRate;
  const cueMasks = nativeMasks142(source, old.baseline.subtitlePackage.cues);
  const previousTargetMasks = nativeMasks142(
    source,
    old.baseline.previous.targets.targets.map((t) => t.sourceInterval),
  );
  const sceneSamples = old.baseline.previous.islands.boundaries
    .filter((b) => b.kind === "SCENE")
    .map((b) => Math.round(b.at * rate));
  const speakerSamples = old.baseline.previous.islands.boundaries
    .filter((b) => b.kind === "SPEAKER")
    .map((b) => Math.round(b.at * rate));
  const splitPoints = [...cueMasks, ...previousTargetMasks]
    .flatMap((v) => [v.startSample, v.endSample])
    .concat(sceneSamples, speakerSamples);
  const inventory = buildInventory142({
    old: old.inventory,
    sweeps,
    masked,
    policy,
    splitPoints,
  });
  const uncovered = uncoveredSpeech142({
    inventory,
    policy,
    cueMasks,
    previousTargetMasks,
    activeSafetyMasks: old.safety.targets.map((t) => t.nativeInterval),
    activeSafetyHash: old.safety.semanticHash,
    finalCueHash: old.uncovered.finalCueHash,
    previousTargetsHash: old.uncovered.previousTargetsHash,
    sceneSamples,
  });
  const novelClusters = clusterCandidates142({
    uncovered,
    oldSafety: old.safety,
    policy,
    boundaries: {
      cueMasks,
      existingTargetMasks: [
        ...previousTargetMasks,
        ...old.safety.targets.map((t) => t.nativeInterval),
      ],
      sceneSamples,
      speakerSamples,
    },
    speechIntervals: inventory.observations
      .filter(
        (o) => o.verifiedTimebase && o.speechPositive && !o.strongContradiction,
      )
      .map((o) => o.nativeInterval),
  });
  const originalClusters = clusters142Schema.parse(
    await readJson141(
      path.join(
        dir("target-clusters"),
        "machine-safety-target-clusters-v2.json",
      ),
    ),
  );
  // Already-active coverage is preserved with its exact frozen cluster cores.
  // Do not let a new detector's long positive span inflate preservation costs.
  const preservedClusters = originalClusters.clusters.filter(
    (c) => c.oldTargetIds.length > 0,
  );
  const allClusters = [...preservedClusters, ...novelClusters.clusters];
  const clusters = clusters142Schema.parse(
    hashed141({
      ...header142(policy, source),
      artifactType: "machine-safety-target-clusters-v2",
      uncoveredHash: uncovered.semanticHash,
      oldSafetyHash: old.safety.semanticHash,
      boundaryHash: hash141({
        original: originalClusters.boundaryHash,
        new: novelClusters.boundaryHash,
      }),
      speechUnionHash: novelClusters.speechUnionHash,
      clusters: allClusters,
      summary: {
        atomicCandidateCount: allClusters.reduce(
          (n, c) => n + c.memberCandidateIds.length,
          0,
        ),
        clusterCount: allClusters.length,
        eligibleClusterCount: allClusters.filter((c) => c.eligible).length,
        mergedCandidateCount: allClusters.reduce(
          (n, c) => n + c.memberCandidateIds.length - 1,
          0,
        ),
        largestClusterMemberCount: Math.max(
          0,
          ...allClusters.map((c) => c.memberCandidateIds.length),
        ),
        speechCoreUnionSeconds: duration141(
          allClusters.flatMap((c) => c.targetCoreUnion),
          rate,
        ),
        envelopeAsSpeechCount: 0,
      },
    }),
  );
  const safety = selectSafety142({
    clusters,
    oldSafety: old.safety,
    policy,
    variant: "DETECTOR_CEILING_COMBINED",
  });
  const detectorOnly = selectSafety142({
    clusters,
    oldSafety: old.safety,
    policy,
    variant: "DETECTOR_CEILING_ONLY",
  });
  const supersession = supersession142(old.safety, safety, policy),
    asrSelection = selectAsr142(safety, old.asr, policy, state.createdAt);
  for (const [filename, value] of [
    ["machine-source-global-speech-inventory-v5.json", inventory],
    ["machine-uncovered-speech-candidates-v2.json", uncovered],
    ["machine-safety-target-clusters-v2.json", clusters],
    ["machine-missing-safety-reserve-targets-v2.json", safety],
    ["machine-safety-target-supersession-ledger.json", supersession],
    ["machine-detector-ceiling-only-selection.json", detectorOnly],
    ["machine-c6-0-1-14-2-asr-probe-selection.json", asrSelection],
  ] as const)
    await durableJson141(path.join(dir("inventory-v5"), filename), value);
  return {
    inventory,
    masked,
    uncovered,
    clusters,
    safety,
    supersession,
    asrSelection,
  };
}
export async function loadEvidence142(state: State142) {
  const base = required141(state.outputs["inventory-v5"]);
  return {
    inventory: inventory142Schema.parse(
      await readJson141(
        path.join(base, "machine-source-global-speech-inventory-v5.json"),
      ),
    ),
    safety: safety142Schema.parse(
      await readJson141(
        path.join(base, "machine-missing-safety-reserve-targets-v2.json"),
      ),
    ),
    masked: masked142Schema.parse(
      await readJson141(
        path.join(
          required141(state.outputs["masked-speech"]),
          "machine-masked-speech-candidates-v1.json",
        ),
      ),
    ),
  };
}

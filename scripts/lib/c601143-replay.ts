import path from "node:path";
import {
  replay143Schema,
  detectorPlan142Schema,
  asrPlan142Schema,
  asrSelection142Schema,
  asrProbes142Schema,
  sweeps142Schema,
  type Policy143,
  type ProcessRunner,
} from "@mvl/shared";
import type { Baseline143 } from "./c601143-input.js";
import {
  runSweeps141,
  type C601141SweepJob,
} from "../../packages/video-subtitler/src/review/c601141-detectors.js";
import { runAsr141 } from "../../packages/video-subtitler/src/review/c601141-local-asr.js";
import { runDetectors142 } from "../../packages/video-subtitler/src/review/c601142-detectors.js";
import { runAsr142 } from "../../packages/video-subtitler/src/review/c601142-asr.js";
import {
  assertReplayOnly143,
  header143,
} from "../../packages/video-subtitler/src/review/c601143-policy.js";
import {
  readJson141,
  durableJson141,
  identity141,
} from "../../packages/video-subtitler/src/review/c601141-io.js";
import {
  hash141,
  hashed141,
  assertHash141,
} from "../../packages/video-subtitler/src/review/c601141-policy.js";
import { unique142 } from "../../packages/video-subtitler/src/review/c601142-selection.js";

export const forbiddenProvider143 = (): Promise<never> =>
  Promise.reject(new Error("C601143_PROVIDER_CONSTRUCTION_FORBIDDEN"));
export const forbiddenRunner143: ProcessRunner = { run: forbiddenProvider143 };

export async function exactReplay143(input: {
  baseline: Baseline143;
  policy: Policy143;
  executionPolicy: string;
  outputDirectory: string;
}) {
  assertReplayOnly143(input.executionPolicy);
  const { baseline: b, policy, outputDirectory } = input,
    old = b.old,
    source = old.baseline.source;
  const plan141 = (await readJson141(
    path.join(old.dir("baseline"), "speech-sweep-plan.local-only.json"),
  )) as { jobs: C601141SweepJob[]; planHash: string };
  if (hash141(plan141.jobs) !== plan141.planHash)
    throw new Error("C601143_LEGACY_DETECTOR_PLAN_CHANGED");
  const previousDetector = await runSweeps141({
    mode: "EXACT_CACHE_ONLY",
    authorized: false,
    views: old.views,
    policy: old.policy,
    jobs: plan141.jobs,
    viewsDirectory: old.dir("audio-views"),
    cacheDirectory: path.join(old.dir("baseline"), "cache"),
    outputDirectory: path.join(outputDirectory, "previous-detector"),
  });
  const previousAsr = await runAsr141({
    mode: "EXACT_CACHE_ONLY",
    authorized: false,
    selection: old.selection,
    policy: old.policy,
    runtimeInput: {
      ...old.config.asrRuntime,
      sourcePath: old.config.source,
      sourceIdentity: source,
      outputDirectory: old.dir("local-asr-fresh"),
    },
    cacheDirectory: path.join(old.dir("baseline"), "cache"),
    outputDirectory: path.join(outputDirectory, "previous-asr"),
    freshDirectory: old.dir("local-asr-fresh"),
    runtimeFactory: forbiddenProvider143,
  });
  const detectorPlan = detectorPlan142Schema.parse(
    await readJson141(
      path.join(b.dir("baseline"), "machine-c6-0-1-14-2-detector-plan.json"),
    ),
  );
  const detector = await runDetectors142({
    mode: "EXACT_CACHE_ONLY",
    authorized: false,
    plan: detectorPlan,
    policy: b.compatibilityPolicy,
    cacheDirectory: path.join(b.dir("baseline"), "cache"),
    outputDirectory: path.join(outputDirectory, "current-detector"),
    runner: forbiddenRunner143,
  });
  const selection = asrSelection142Schema.parse(
    await readJson141(
      path.join(
        b.dir("inventory-v5"),
        "machine-c6-0-1-14-2-asr-probe-selection.json",
      ),
    ),
  );
  const asrPlan = asrPlan142Schema.parse(
    await readJson141(
      path.join(
        b.dir("local-asr-fresh"),
        "machine-c601142-asr-execution-plan.json",
      ),
    ),
  );
  const asr = await runAsr142({
    selection,
    policy: b.compatibilityPolicy,
    plan: asrPlan,
    mode: "EXACT_CACHE_ONLY",
    authorized: false,
    runtimeInput: {
      ...old.config.asrRuntime,
      sourcePath: old.config.source,
      sourceIdentity: source,
      outputDirectory: b.dir("local-asr-fresh"),
    },
    cacheDirectory: path.join(b.dir("baseline"), "cache"),
    outputDirectory: path.join(outputDirectory, "current-asr"),
    freshDirectory: b.dir("local-asr-fresh"),
    runtimeFactory: forbiddenProvider143,
  });
  const frozenDetector = sweeps142Schema.parse(
    await readJson141(
      path.join(
        b.dir("detectors-fresh"),
        "machine-independent-speech-presence-sweeps.json",
      ),
    ),
  );
  const frozenAsr = asrProbes142Schema.parse(
    await readJson141(
      path.join(
        b.dir("local-asr-fresh"),
        "machine-c6-0-1-14-2-local-asr-probes.json",
      ),
    ),
  );
  [detectorPlan, asrPlan, frozenDetector, frozenAsr].forEach(assertHash141);
  if (
    previousDetector.evidenceSemanticHash !== old.sweeps.evidenceSemanticHash ||
    previousAsr.evidenceSemanticHash !== old.asr.evidenceSemanticHash ||
    detector.sweeps.evidenceSemanticHash !==
      frozenDetector.evidenceSemanticHash ||
    asr.evidenceSemanticHash !== frozenAsr.evidenceSemanticHash ||
    detector.scores.semanticHash !== b.scoreTracks.semanticHash
  )
    throw new Error("C601143_EXACT_CACHE_EVIDENCE_PARITY_FAILED");
  const counts = [
    previousDetector.accounting,
    previousAsr.accounting,
    detector.sweeps.accounting,
    asr.accounting,
  ];
  for (const count of counts)
    assertReplayOnly143(input.executionPolicy, {
      inferenceCount: count.inferenceCount,
      modelLoadCount: count.modelLoadCount,
      providerProcessStartCount: count.providerProcessStartCount,
      cacheMissCount: count.cacheMisses,
    });
  const sourceReadOnlyIdentity = await identity141(old.config.source);
  if (hash141(sourceReadOnlyIdentity) !== hash141(old.baseline.sourceBefore))
    throw new Error("C601143_SOURCE_CHANGED_DURING_CACHE_REPLAY");
  const result = replay143Schema.parse(
    hashed141({
      ...header143(policy, source),
      artifactType: "c6-0-1-14-3-exact-cache-replay-accounting",
      executionPolicy: "replay-only",
      mode: "EXACT_CACHE_ONLY",
      previousDetector: previousDetector.accounting,
      currentDetector: detector.sweeps.accounting,
      previousAsr: previousAsr.accounting,
      currentAsr: asr.accounting,
      expectedDetectorRequestCount:
        old.sweeps.runs.length + frozenDetector.runs.length,
      detectorCacheHitCount:
        previousDetector.accounting.cacheHits +
        detector.sweeps.accounting.cacheHits,
      expectedAsrRequestCount:
        old.asr.requests.length + frozenAsr.requests.length,
      asrCacheHitCount:
        previousAsr.accounting.cacheHits + asr.accounting.cacheHits,
      detectorEvidenceSemanticHashes: [
        previousDetector.evidenceSemanticHash,
        detector.sweeps.evidenceSemanticHash,
      ],
      asrEvidenceSemanticHashes: [
        previousAsr.evidenceSemanticHash,
        asr.evidenceSemanticHash,
      ],
      scoreTracksHash: detector.scores.semanticHash,
      detectorRuntimeIdentityHashes: unique142([
        ...plan141.jobs.map((j) => j.backend.identity.runtimeIdentityHash),
        ...detectorPlan.jobs.map((j) => j.runtime.runtimeIdentityHash),
      ]),
      detectorModelSnapshotHashes: unique142([
        ...plan141.jobs.map((j) => j.backend.identity.modelSnapshotHash),
        ...detectorPlan.jobs.map((j) => j.runtime.modelSnapshotHash),
      ]),
      asrRuntimeIdentityHashes: unique142(
        asrPlan.identities.map((i) => i.runtimeIdentityHash),
      ),
      asrModelIdentityHashes: unique142(
        asrPlan.identities.map((i) => i.modelIdentityHash),
      ),
      asrModelFileManifestHashes: unique142(
        asrPlan.identities.map((i) => hash141(i.modelFileHashes)),
      ),
      sourceReadOnlyIdentity,
      previousEvidenceParity: true,
      currentEvidenceParity: true,
      inferenceCount: 0,
      modelLoadCount: 0,
      providerProcessStartCount: 0,
      cacheMissCount: 0,
      retryCount: 0,
      backfillCount: 0,
      networkRequestCount: 0,
    }),
  );
  await durableJson141(
    path.join(
      outputDirectory,
      "c6-0-1-14-3-exact-cache-replay-accounting.json",
    ),
    result,
  );
  return result;
}

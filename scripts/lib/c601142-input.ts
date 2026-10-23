import path from "node:path";
import { stat } from "node:fs/promises";
import { z } from "zod";
import {
  c601141PolicySchema,
  c601141AudioViewsSchema,
  c601141InventorySchema,
  c601141SafetySchema,
  c601141UncoveredSchema,
  c601141AsrSelectionSchema,
  c601141LexicalSchema,
  c601141FingerprintSchema,
  c601141CoverageProjectionsSchema,
  c601141AsrProbesSchema,
  c601141SweepsSchema,
} from "@mvl/shared";
import {
  config141Schema,
  loadBaseline141,
  type Config141,
} from "./c601141-input.js";
import { files141, verifyFreeze141 } from "./c601141-freeze.js";
import {
  runSweeps141,
  type C601141SweepJob,
} from "../../packages/video-subtitler/src/review/c601141-detectors.js";
import { runAsr141 } from "../../packages/video-subtitler/src/review/c601141-local-asr.js";
import {
  readJson141,
  durableJson141,
  identity141,
} from "../../packages/video-subtitler/src/review/c601141-io.js";
import {
  hash141,
  hashed141,
  required141,
  assertHash141,
} from "../../packages/video-subtitler/src/review/c601141-policy.js";

const file = z.string().min(1);
export const config142Schema = z
  .object({
    baselineState: file,
    outputRoot: file,
    prefix: z.string().regex(/^[a-zA-Z0-9-]+$/u),
    date: z.string().regex(/^\d{8}$/u),
    webrtcRuntimeDirectory: file,
  })
  .strict()
  .refine(
    (v) =>
      Object.values(v).every(
        (s) => !/(?:^|[/_-])(?:gold|human-correction)(?:[/_.-]|$)/iu.test(s),
      ),
    "Gold forbidden in machine config",
  );
export type Config142 = z.infer<typeof config142Schema>;
export interface State142 {
  config: Config142;
  configHash: string;
  outputs: Record<string, string>;
  policyPath: string;
  baselineSourceIdentityHash: string;
  createdAt: string;
}
export async function loadBaseline142(config: Config142) {
  const state = (await readJson141(config.baselineState)) as {
    config: Config141;
    configHash: string;
    outputs: Record<string, string>;
    policyPath: string;
  };
  const oldConfig = config141Schema.parse(state.config);
  if (hash141(oldConfig) !== state.configHash)
    throw new Error("C601142_BASELINE_CONFIG_CHANGED");
  const dir = (name: string) => required141(state.outputs[name]);
  const baseline = await loadBaseline141(oldConfig);
  const finalA = await verifyFreeze141(
    oldConfig.outputRoot,
    path.join(
      dir("final-a"),
      "c6-0-1-14-1-machine-speech-inventory-freeze.json",
    ),
    oldConfig.source,
  );
  const finalB = await verifyFreeze141(
    oldConfig.outputRoot,
    path.join(
      dir("final-b"),
      "c6-0-1-14-1-machine-speech-inventory-freeze.json",
    ),
  );
  const read = (name: string) => readJson141(path.join(dir("final-a"), name));
  const policy = c601141PolicySchema.parse(await readJson141(state.policyPath));
  const views = c601141AudioViewsSchema.parse(
    await read("machine-source-audio-views-v1.json"),
  );
  const inventory = c601141InventorySchema.parse(
    await read("machine-source-global-speech-inventory-v4.json"),
  );
  const uncovered = c601141UncoveredSchema.parse(
    await read("machine-uncovered-speech-candidates-v1.json"),
  );
  const safety = c601141SafetySchema.parse(
    await read("machine-missing-safety-reserve-targets-v1.json"),
  );
  const lexical = c601141LexicalSchema.parse(
    await read("machine-missing-lexical-evidence-v4.json"),
  );
  const fingerprint = c601141FingerprintSchema.parse(
    await read("machine-legacy-audio-fingerprint-reconciliation.json"),
  );
  const projections = c601141CoverageProjectionsSchema.parse(
    await read("machine-coverage-projections.json"),
  );
  const selection = c601141AsrSelectionSchema.parse(
    await read("machine-c6-0-1-14-1-asr-probe-selection.json"),
  );
  const asr = c601141AsrProbesSchema.parse(
    await readJson141(
      path.join(
        dir("local-asr-fresh"),
        "machine-c6-0-1-14-1-local-asr-probes.json",
      ),
    ),
  );
  const sweeps = c601141SweepsSchema.parse(
    await readJson141(
      path.join(
        dir("speech-sweeps-fresh"),
        "machine-whole-media-speech-activity-sweeps.json",
      ),
    ),
  );
  [
    policy,
    views,
    inventory,
    uncovered,
    safety,
    lexical,
    fingerprint,
    projections,
    selection,
    asr,
    sweeps,
  ].forEach(assertHash141);
  return {
    state,
    config: oldConfig,
    dir,
    baseline,
    finalA,
    finalB,
    policy,
    views,
    inventory,
    uncovered,
    safety,
    lexical,
    fingerprint,
    projections,
    selection,
    asr,
    sweeps,
  };
}
export type Baseline142 = Awaited<ReturnType<typeof loadBaseline142>>;
export async function replayBaseline142(
  old: Baseline142,
  outputDirectory: string,
) {
  const plan = (await readJson141(
    path.join(old.dir("baseline"), "speech-sweep-plan.local-only.json"),
  )) as { jobs: C601141SweepJob[]; planHash: string };
  if (hash141(plan.jobs) !== plan.planHash)
    throw new Error("C601142_BASELINE_DETECTOR_PLAN_CHANGED");
  const detector = await runSweeps141({
    mode: "EXACT_CACHE_ONLY",
    authorized: false,
    views: old.views,
    policy: old.policy,
    jobs: plan.jobs,
    viewsDirectory: old.dir("audio-views"),
    cacheDirectory: path.join(old.dir("baseline"), "cache"),
    outputDirectory: path.join(outputDirectory, "baseline-detector-replay"),
  });
  const asr = await runAsr141({
    mode: "EXACT_CACHE_ONLY",
    authorized: false,
    selection: old.selection,
    policy: old.policy,
    runtimeInput: {
      ...old.config.asrRuntime,
      sourcePath: old.config.source,
      sourceIdentity: old.baseline.source,
      outputDirectory: old.dir("local-asr-fresh"),
    },
    cacheDirectory: path.join(old.dir("baseline"), "cache"),
    outputDirectory: path.join(outputDirectory, "baseline-asr-replay"),
    freshDirectory: old.dir("local-asr-fresh"),
    runtimeFactory: () =>
      Promise.reject(
        new Error("C601142_BASELINE_PROVIDER_CONSTRUCTION_FORBIDDEN"),
      ),
  });
  if (
    detector.evidenceSemanticHash !== old.sweeps.evidenceSemanticHash ||
    asr.evidenceSemanticHash !== old.asr.evidenceSemanticHash
  )
    throw new Error("C601142_BASELINE_CACHE_PARITY_FAILED");
  const projection = required141(old.projections.variants.at(-1)).projection;
  const full = required141(
    projection.plans.find((p) => p.planId === "FULL_QUEUE_WITH_SAFETY_RESERVE"),
  );
  const segments = projection.playbackSegments.filter((s) =>
    full.playbackSegmentIds.includes(s.playbackSegmentId),
  );
  const { c60114Union } =
    await import("../../packages/video-subtitler/src/review/c60114-policy.js");
  const fullQueueSeconds = c60114Union(
    segments.map((s) => s.sourceInterval),
  ).reduce((n, v) => n + v.end - v.start, 0);
  const nativeStats = [];
  // Metadata-only traversal includes old Gold outputs without opening them.
  // Machine content is independently verified by the historical freeze above.
  for (const root of Object.values(old.state.outputs))
    for (const file of await files141(root)) {
      const s = await stat(file);
      nativeStats.push({
        file,
        size: s.size,
        mtimeMs: s.mtimeMs,
        inode: s.ino,
      });
    }
  const value = hashed141({
    schemaVersion: "1.0.0",
    artifactType: "c6-0-1-14-2-baseline-replay",
    visibility: "LOCAL_ONLY",
    baselineCommit: "57462c587d1cbffc02dc242e1f3e24c5b1d1616a",
    sourceIdentity: old.baseline.source,
    sourceReadOnlyIdentity: await identity141(old.config.source),
    previousFinalAHash: old.finalA.semanticHash,
    previousFinalBHash: old.finalB.semanticHash,
    canonicalTextHash: old.baseline.canonicalTextHash,
    canonicalTimingHash: old.baseline.canonicalTimingHash,
    presentationHash: old.baseline.presentationHash,
    machineCueCount: old.baseline.subtitlePackage.cues.length,
    detector: detector.accounting,
    asr: asr.accounting,
    viewCount: old.views.views.length,
    uniquePcmViewCount: old.views.summary.uniquePcmViewCount,
    inventory: old.inventory.summary,
    safety: old.safety.summary,
    uncovered: old.uncovered.summary,
    targetCount: projection.targets.length,
    itemCount: projection.items.length,
    requiredItemCount: old.baseline.previous.items.summary.requiredItemCount,
    regionCount: projection.regions.length,
    physicalWavCount: projection.physicalAudio.length,
    playableWavCount: projection.physicalAudio.filter((a) => a.playable).length,
    playbackSegmentCount: projection.playbackSegments.length,
    fullQueueSeconds,
    baseline14FullQueueSeconds:
      old.baseline.baseline.fullQueueUniqueAudioSeconds,
    priorOutputMetadata: nativeStats,
    runtimeGoldInputCount: 0,
    baselineGoldMetricsDeferredUntilPostFreezeEvaluator: true,
    canonicalTextMutationCount: 0,
    canonicalTimingMutationCount: 0,
    productionStatus: "needs-review",
    finalizationMethod: "none",
  });
  await durableJson141(
    path.join(outputDirectory, "c6-0-1-14-2-baseline-replay.local-only.json"),
    value,
  );
  return value;
}

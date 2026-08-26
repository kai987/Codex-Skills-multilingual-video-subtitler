import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  InputError,
  atomicWriteJson,
  c518FreshCacheObserveValidationSchema,
  c518SpeakerEvidenceReplaySummarySchema,
  speakerEvidenceCacheManifestSchema,
  subtitleLocalSpeakerEvidenceSchema,
} from "@mvl/shared";
import {
  appendC518ValidationToShareable,
  locateSubtitlePackage,
  sha256Value,
  speakerEvidenceSemanticHash,
} from "@mvl/video-subtitler";

const { values } = parseArgs({
  options: {
    fresh: { type: "string" },
    observe: { type: "string" },
    "cache-replay": { type: "string" },
    output: { type: "string" },
  },
  strict: true,
});

if (
  values.fresh === undefined ||
  values.observe === undefined ||
  values["cache-replay"] === undefined
) {
  throw new InputError(
    "Usage: npm run validate:c5-18-runs -- --fresh <task> --observe <task> --cache-replay <task> [--output <json>]",
  );
}

async function load(task: string) {
  const taskRoot = path.resolve(task);
  const located = await locateSubtitlePackage(taskRoot);
  const summary = c518SpeakerEvidenceReplaySummarySchema.parse(
    JSON.parse(
      await readFile(
        path.join(taskRoot, "c5-18-speaker-evidence-replay-summary.json"),
        "utf8",
      ),
    ) as unknown,
  );
  const evidence = subtitleLocalSpeakerEvidenceSchema.parse(
    JSON.parse(
      await readFile(
        path.join(
          located.subtitleDirectory,
          "subtitle-local-speaker-evidence.json",
        ),
        "utf8",
      ),
    ) as unknown,
  );
  const cache = speakerEvidenceCacheManifestSchema.parse(
    JSON.parse(
      await readFile(
        path.join(
          located.subtitleDirectory,
          "speaker-evidence-cache-manifest.json",
        ),
        "utf8",
      ),
    ) as unknown,
  );
  return { taskRoot, summary, evidence, cache };
}

const [fresh, observe, cache] = await Promise.all([
  load(values.fresh),
  load(values.observe),
  load(values["cache-replay"]),
]);
const freshEvidenceHash = speakerEvidenceSemanticHash(fresh.evidence);
const observeEvidenceHash = speakerEvidenceSemanticHash(observe.evidence);
const cacheEvidenceHash = speakerEvidenceSemanticHash(cache.evidence);
const evidenceParity =
  freshEvidenceHash === observeEvidenceHash &&
  observeEvidenceHash === cacheEvidenceHash;
const componentDecisionParity =
  fresh.evidence.componentDecisionHash ===
    observe.evidence.componentDecisionHash &&
  observe.evidence.componentDecisionHash ===
    cache.evidence.componentDecisionHash;
const mutationParity =
  fresh.evidence.mutationHash === cache.evidence.mutationHash;
const outputCueParity =
  fresh.summary.canonicalCueHashAfter === cache.summary.canonicalCueHashAfter;
const hardChecks = [
  fresh.summary.speakerEvidenceMode === "enforce",
  observe.summary.speakerEvidenceMode === "observe",
  cache.summary.speakerEvidenceMode === "enforce",
  fresh.evidence.summary.targetComponentCount === 7,
  fresh.evidence.summary.targetCueCount === 16,
  observe.evidence.summary.timingMutationCount === 0,
  cache.cache.summary.requestCount === 14,
  cache.cache.summary.hitCount === 14,
  cache.cache.summary.inferenceCount === 0,
  cache.cache.summary.modelLoadCount === 0,
  cache.summary.execution.speakerInferenceCount === 0,
  cache.summary.execution.speakerModelLoadCount === 0,
  evidenceParity,
  componentDecisionParity,
  mutationParity,
  outputCueParity,
];
const generatedAt = new Date().toISOString();
const base = {
  schemaVersion: "1.0.0" as const,
  artifactType: "c5-18-fresh-cache-observe-validation" as const,
  validationVersion: "C5.18" as const,
  generatedAt,
  freshRunId: fresh.summary.runId,
  observeRunId: observe.summary.runId,
  cacheReplayRunId: cache.summary.runId,
  freshSpeakerEvidenceSemanticHash: freshEvidenceHash,
  observeSpeakerEvidenceSemanticHash: observeEvidenceHash,
  cacheSpeakerEvidenceSemanticHash: cacheEvidenceHash,
  freshComponentDecisionHash: fresh.evidence.componentDecisionHash,
  observeComponentDecisionHash: observe.evidence.componentDecisionHash,
  cacheComponentDecisionHash: cache.evidence.componentDecisionHash,
  freshMutationHash: fresh.evidence.mutationHash,
  observeMutationHash: observe.evidence.mutationHash,
  cacheMutationHash: cache.evidence.mutationHash,
  freshOutputCueHash: fresh.summary.canonicalCueHashAfter,
  observeOutputCueHash: observe.summary.canonicalCueHashAfter,
  cacheOutputCueHash: cache.summary.canonicalCueHashAfter,
  freshInferenceCount: fresh.summary.execution.speakerInferenceCount,
  observeInferenceCount: observe.summary.execution.speakerInferenceCount,
  cacheHitCount: cache.cache.summary.hitCount,
  cacheInferenceCount: cache.cache.summary.inferenceCount,
  cacheModelLoadCount: cache.cache.summary.modelLoadCount,
  observeTimingMutationCount: observe.evidence.summary.timingMutationCount,
  speakerEvidenceSemanticParity: evidenceParity,
  componentDecisionParity,
  mutationParity,
  outputCueParity,
  validationPassed: hardChecks.every(Boolean),
};
const artifact = c518FreshCacheObserveValidationSchema.parse({
  ...base,
  semanticHash: sha256Value({ ...base, generatedAt: null }),
});
const output = path.resolve(
  values.output ??
    path.join(fresh.taskRoot, "c5-18-fresh-cache-observe-validation.json"),
);
await atomicWriteJson(output, artifact, { overwrite: true });
if (!artifact.validationPassed) {
  throw new InputError(
    "C5.18 fresh/observe/cache validation failed one or more hard checks.",
  );
}
const shareableAudits = [];
for (const run of [fresh, observe, cache]) {
  const localValidationPath = path.join(
    run.taskRoot,
    "c5-18-fresh-cache-observe-validation.json",
  );
  if (localValidationPath !== output) {
    await atomicWriteJson(localValidationPath, artifact, { overwrite: true });
  }
  const audit = await appendC518ValidationToShareable({
    taskRoot: run.taskRoot,
    validationPath: localValidationPath,
  });
  if (!audit.validationPassed) {
    throw new InputError(
      `C5.18 shareable validation failed for ${run.taskRoot}.`,
    );
  }
  shareableAudits.push({
    taskRoot: run.taskRoot,
    artifactCount: audit.manifest.summary.artifactCount,
    validationPassed: audit.validationPassed,
  });
}
process.stdout.write(
  `${JSON.stringify({ ok: true, output, shareableAudits, ...artifact }, null, 2)}\n`,
);

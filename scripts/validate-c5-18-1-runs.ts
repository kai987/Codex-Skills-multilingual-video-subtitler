import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  InputError,
  atomicWriteJson,
  c5181CtcBoundaryReplaySummarySchema,
  c5181FreshCacheObserveValidationSchema,
  ctcAlignmentCacheManifestSchema,
  subtitleCtcAlignmentInputSchema,
  subtitleLocalCtcBoundaryEvidenceSchema,
  subtitleLocalSeparatedStreamEvidenceSchema,
} from "@mvl/shared";
import {
  appendC5181ValidationToShareable,
  locateSubtitlePackage,
  sha256Value,
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
    "Usage: npm run validate:c5-18-1-runs -- --fresh <task> --observe <task> --cache-replay <task> [--output <json>]",
  );
}

async function load(task: string) {
  const taskRoot = path.resolve(task);
  const located = await locateSubtitlePackage(taskRoot);
  const read = async (name: string) =>
    JSON.parse(
      await readFile(path.join(located.subtitleDirectory, name), "utf8"),
    ) as unknown;
  return {
    taskRoot,
    summary: c5181CtcBoundaryReplaySummarySchema.parse(
      JSON.parse(
        await readFile(
          path.join(taskRoot, "c5-18-1-ctc-boundary-replay-summary.json"),
          "utf8",
        ),
      ) as unknown,
    ),
    alignment: subtitleCtcAlignmentInputSchema.parse(
      await read("subtitle-ctc-alignment-input.json"),
    ),
    evidence: subtitleLocalCtcBoundaryEvidenceSchema.parse(
      await read("subtitle-local-ctc-boundary-evidence.json"),
    ),
    separation: subtitleLocalSeparatedStreamEvidenceSchema.parse(
      await read("subtitle-local-separated-stream-evidence.json"),
    ),
    cache: ctcAlignmentCacheManifestSchema.parse(
      await read("ctc-alignment-cache-manifest.json"),
    ),
  };
}

const [fresh, observe, cacheReplay] = await Promise.all([
  load(values.fresh),
  load(values.observe),
  load(values["cache-replay"]),
]);
const same = (field: keyof typeof fresh.summary.hashes) =>
  fresh.summary.hashes[field] === observe.summary.hashes[field] &&
  observe.summary.hashes[field] === cacheReplay.summary.hashes[field];
const parity = {
  ctcAlignmentInputSemanticHash: same("ctcAlignmentInputSemanticHash"),
  ctcEvidenceSemanticHash: same("ctcEvidenceSemanticHash"),
  jointAssignmentHash: same("jointAssignmentHash"),
  sourceSeparationEvidenceHash: same("sourceSeparationEvidenceHash"),
  componentDecisionHash: same("componentDecisionHash"),
  mutationHash: same("mutationHash"),
  outputCueHash: same("outputCueHash"),
  allPassed: false,
};
parity.allPassed = Object.entries(parity)
  .filter(([key]) => key !== "allPassed")
  .every(([, value]) => value);
const hardChecks = [
  fresh.summary.mode === "enforce",
  fresh.summary.cacheMode === "read-write",
  observe.summary.mode === "observe",
  observe.summary.cacheMode === "read",
  cacheReplay.summary.mode === "enforce",
  cacheReplay.summary.cacheMode === "read",
  fresh.summary.counts.directCtcInferenceCount === 32,
  fresh.summary.counts.directCtcCacheHitCount === 0,
  fresh.summary.counts.ctcModelLoadCount === 1,
  observe.summary.counts.directCtcInferenceCount === 0,
  observe.summary.counts.directCtcCacheHitCount === 32,
  observe.summary.counts.ctcModelLoadCount === 0,
  observe.summary.counts.canonicalTimingMutationCount === 0,
  cacheReplay.summary.counts.directCtcInferenceCount === 0,
  cacheReplay.summary.counts.directCtcCacheHitCount === 32,
  cacheReplay.summary.counts.ctcModelLoadCount === 0,
  fresh.summary.counts.separationInferenceCount <= 4,
  fresh.summary.counts.separationCacheHitCount === 0,
  fresh.summary.counts.separationModelLoadCount <= 1,
  fresh.summary.counts.separatedStreamCtcAttemptCount <= 20,
  fresh.summary.counts.separatedStreamCtcInferenceCount ===
    fresh.summary.counts.separatedStreamCtcAttemptCount,
  fresh.summary.counts.separatedStreamCtcCacheHitCount === 0,
  observe.summary.counts.separationInferenceCount === 0,
  observe.summary.counts.separationCacheHitCount ===
    fresh.summary.counts.separationInferenceCount,
  observe.summary.counts.separationModelLoadCount === 0,
  observe.summary.counts.separatedStreamCtcInferenceCount === 0,
  observe.summary.counts.separatedStreamCtcCacheHitCount ===
    fresh.summary.counts.separatedStreamCtcAttemptCount,
  cacheReplay.summary.counts.separationInferenceCount === 0,
  cacheReplay.summary.counts.separationCacheHitCount ===
    fresh.summary.counts.separationInferenceCount,
  cacheReplay.summary.counts.separationModelLoadCount === 0,
  cacheReplay.summary.counts.separatedStreamCtcInferenceCount === 0,
  cacheReplay.summary.counts.separatedStreamCtcCacheHitCount ===
    fresh.summary.counts.separatedStreamCtcAttemptCount,
  cacheReplay.cache.summary.hitCount ===
    32 + fresh.summary.counts.separatedStreamCtcAttemptCount,
  cacheReplay.cache.summary.inferenceCount === 0,
  cacheReplay.cache.summary.modelLoadCount === 0,
  fresh.summary.reviewDeliveryIntegrityPassed,
  observe.summary.reviewDeliveryIntegrityPassed,
  cacheReplay.summary.reviewDeliveryIntegrityPassed,
  parity.allPassed,
];
const generatedAt = new Date().toISOString();
const base = {
  schemaVersion: "1.0.0" as const,
  artifactType: "c5-18-1-fresh-cache-observe-validation" as const,
  validationVersion: "C5.18.1" as const,
  generatedAt,
  freshTaskName: path.basename(fresh.taskRoot),
  observeTaskName: path.basename(observe.taskRoot),
  cacheReplayTaskName: path.basename(cacheReplay.taskRoot),
  fresh: fresh.summary,
  observe: observe.summary,
  cacheReplay: cacheReplay.summary,
  parity,
  observeMutationCount: 0 as const,
  cacheReplayInferenceCount: 0 as const,
  cacheReplayModelLoadCount: 0 as const,
  validationPassed: hardChecks.every(Boolean),
};
const validation = c5181FreshCacheObserveValidationSchema.parse({
  ...base,
  semanticHash: sha256Value({ ...base, generatedAt: null }),
});
const output = path.resolve(
  values.output ??
    path.join(fresh.taskRoot, "c5-18-1-fresh-cache-observe-validation.json"),
);
await atomicWriteJson(output, validation, { overwrite: true });
if (!validation.validationPassed) {
  throw new InputError(
    "C5.18.1 Fresh/Observe/Cache validation failed a hard acceptance check.",
  );
}

const shareableAudits = [];
for (const run of [fresh, observe, cacheReplay]) {
  const localPath = path.join(
    run.taskRoot,
    "c5-18-1-fresh-cache-observe-validation.json",
  );
  if (localPath !== output) {
    await atomicWriteJson(localPath, validation, { overwrite: true });
  }
  const audit = await appendC5181ValidationToShareable({
    taskRoot: run.taskRoot,
    validationPath: localPath,
  });
  if (!audit.validationPassed) {
    throw new InputError(`C5.18.1 shareable audit failed: ${run.taskRoot}`);
  }
  shareableAudits.push({
    taskRoot: run.taskRoot,
    artifactCount: audit.manifest.summary.artifactCount,
    absolutePathLeakCount: audit.absolutePathLeakCount,
    prohibitedSecretCount: audit.prohibitedSecretCount,
    brokenRelativeReferenceCount: audit.brokenRelativeReferenceCount,
  });
}
process.stdout.write(
  `${JSON.stringify({ ok: true, output, parity, shareableAudits }, null, 2)}\n`,
);

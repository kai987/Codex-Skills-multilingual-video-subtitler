import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  InputError,
  asrCacheManifestArtifactSchema,
  atomicWriteJson,
  grammarReportSchema,
  subtitleFinalizationReportSchema,
  subtitleOverlapAcousticResolutionSchema,
  subtitlePackageSchema,
  subtitlePresentationResolutionSchema,
  subtitleTimestampEvidenceIntegritySchema,
  whisperExecutionMetricsSchema,
} from "@mvl/shared";
import { auditC5161ShareableArtifacts } from "@mvl/video-subtitler";

const { values } = parseArgs({
  options: {
    standard: { type: "string" },
    adversarial: { type: "string" },
    "cache-replay": { type: "string" },
    output: { type: "string" },
  },
  strict: true,
});

if (
  values.standard === undefined ||
  values.adversarial === undefined ||
  values["cache-replay"] === undefined
) {
  throw new InputError(
    "Usage: npm run validate:c5-16-1-runs -- --standard <task> --adversarial <task> --cache-replay <task> [--output <validation.json>]",
  );
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new InputError(message);
}

function isZero(value: number): boolean {
  return value === 0;
}

async function json(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

async function findSubtitleDirectory(taskRoot: string): Promise<string> {
  const entries = await readdir(taskRoot, { withFileTypes: true });
  const matches = entries.filter(
    (entry) => entry.isDirectory() && entry.name.startsWith("subtitle-"),
  );
  invariant(
    matches.length === 1 && matches[0] !== undefined,
    `Expected one subtitle-* directory in ${taskRoot}.`,
  );
  return path.join(taskRoot, matches[0].name);
}

async function load(taskInput: string) {
  const taskRoot = path.resolve(taskInput);
  const subtitleDirectory = await findSubtitleDirectory(taskRoot);
  const report = subtitleFinalizationReportSchema.parse(
    await json(
      path.join(subtitleDirectory, "subtitle-finalization-report.json"),
    ),
  );
  const presentation = subtitlePresentationResolutionSchema.parse(
    await json(
      path.join(subtitleDirectory, "subtitle-presentation-resolution.json"),
    ),
  );
  const overlap = subtitleOverlapAcousticResolutionSchema.parse(
    await json(
      path.join(subtitleDirectory, "subtitle-overlap-acoustic-resolution.json"),
    ),
  );
  const integrity = subtitleTimestampEvidenceIntegritySchema.parse(
    await json(
      path.join(
        subtitleDirectory,
        "subtitle-timestamp-evidence-integrity.json",
      ),
    ),
  );
  const execution = whisperExecutionMetricsSchema.parse(
    await json(
      path.join(subtitleDirectory, "overlap-whisper-execution-metrics.json"),
    ),
  );
  const cache = asrCacheManifestArtifactSchema.parse(
    await json(path.join(subtitleDirectory, "overlap-asr-cache-manifest.json")),
  );
  const subtitlePackage = subtitlePackageSchema.parse(
    await json(
      path.join(subtitleDirectory, report.outputPaths.subtitlePackage),
    ),
  );
  const grammar = grammarReportSchema.parse(
    await json(
      path.join(taskRoot, "skill2-compatibility", "grammar-report.json"),
    ),
  );
  const shareable = await auditC5161ShareableArtifacts(
    path.join(taskRoot, "shareable"),
  );
  return {
    taskRoot,
    report,
    presentation,
    overlap,
    integrity,
    execution,
    cache,
    subtitlePackage,
    grammar,
    shareable,
  };
}

const [standard, adversarial, cacheReplay] = await Promise.all([
  load(values.standard),
  load(values.adversarial),
  load(values["cache-replay"]),
]);

for (const [label, run] of [
  ["standard", standard],
  ["adversarial", adversarial],
  ["cache-replay", cacheReplay],
] as const) {
  invariant(
    run.subtitlePackage.cues.length === 192,
    `${label}: cue count != 192.`,
  );
  invariant(
    isZero(run.overlap.summary.canonicalTextMutationCount),
    `${label}: canonical text mutation detected.`,
  );
  invariant(
    run.overlap.summary.timingMutationCount === 0,
    `${label}: canonical timing mutation detected.`,
  );
  invariant(
    isZero(run.overlap.summary.wholeMediaAsrRequestCount),
    `${label}: whole-media ASR detected.`,
  );
  invariant(
    isZero(run.overlap.summary.midpointRepairCount) &&
      isZero(run.overlap.summary.characterRatioRepairCount),
    `${label}: heuristic timing repair detected.`,
  );
  invariant(
    run.integrity.summary.untrustedTokenUsedForTimingCount === 0,
    `${label}: untrusted token timing was used.`,
  );
  invariant(
    run.integrity.summary.decodedSegmentMislabelledAsRawVadCount === 0,
    `${label}: decoded segment was mislabeled as Raw VAD.`,
  );
  invariant(
    run.integrity.summary.rawVadInvalidIntervalCount === 0,
    `${label}: invalid Raw VAD interval remains.`,
  );
  invariant(
    (run.integrity.summary.rawVadMaximumNormalizationDeltaSeconds ?? 0) <= 0.05,
    `${label}: Raw VAD normalization exceeded 50ms.`,
  );
  invariant(
    run.shareable.validationPassed,
    `${label}: shareable audit failed.`,
  );
  invariant(
    run.grammar.summary.sentenceCount === 106 &&
      run.grammar.summary.grammarPointCount === 106,
    `${label}: Skill 2 compatibility is not 106/106.`,
  );
}

invariant(
  standard.execution.asrRequestCount === 21 &&
    standard.execution.cacheHitCount === 0,
  "standard: expected 21 fresh requests and zero cache hits.",
);
invariant(
  standard.execution.workerStartCount === 1 &&
    standard.execution.modelLoadCount === 1,
  "standard: expected one worker/model load.",
);
invariant(
  adversarial.execution.asrRequestCount === 21 &&
    adversarial.execution.cacheHitCount === 0,
  "adversarial: expected 21 fresh requests and zero cache hits.",
);
invariant(
  (adversarial.execution.preventedUnsafeTransitionCount ?? 0) > 0 &&
    (adversarial.execution.unsafeWorkerTransitionCount ?? 0) === 0,
  "adversarial: VAD-to-no-VAD transition was not safely prevented.",
);
invariant(
  adversarial.execution.requestOrderIndependencePassed === true &&
    adversarial.execution.cleanProcessParityPassed === true,
  "adversarial: order/clean-context parity was not proven.",
);
invariant(
  cacheReplay.execution.asrRequestCount === 0 &&
    cacheReplay.execution.cacheHitCount === 21 &&
    cacheReplay.execution.workerStartCount === 0 &&
    cacheReplay.execution.modelLoadCount === 0,
  "cache replay: expected 21/21 hits and zero worker/model loads.",
);

const hashes = [standard, adversarial, cacheReplay].map((run) => ({
  canonicalCueHash: run.report.outputCueHash,
  outputHash: run.report.outputHash,
  presentationCueHash: run.presentation.presentationCueHash,
}));
const baselineHashes = hashes[0];
invariant(baselineHashes !== undefined, "No validation hashes were produced.");
invariant(
  hashes.every(
    (item) =>
      item.canonicalCueHash === baselineHashes.canonicalCueHash &&
      item.outputHash === baselineHashes.outputHash &&
      item.presentationCueHash === baselineHashes.presentationCueHash,
  ),
  "Cross-run canonical/output/presentation hashes differ.",
);

const result = {
  schemaVersion: "1.0.0",
  artifactType: "c5-16-1-cross-run-validation",
  generatedAt: new Date().toISOString(),
  standardTaskName: path.basename(standard.taskRoot),
  adversarialTaskName: path.basename(adversarial.taskRoot),
  cacheReplayTaskName: path.basename(cacheReplay.taskRoot),
  hashes: hashes[0],
  rawVad: {
    total: standard.integrity.summary.rawVadIntervalCount,
    fullyTrusted: standard.integrity.summary.rawVadFullyTrustedCount ?? 0,
    boundaryNormalized:
      standard.integrity.summary.rawVadBoundaryNormalizedCount ?? 0,
    invalid: standard.integrity.summary.rawVadInvalidIntervalCount ?? 0,
    maximumNormalizationDeltaSeconds:
      standard.integrity.summary.rawVadMaximumNormalizationDeltaSeconds ?? 0,
  },
  worker: {
    standard: {
      workerStartCount: standard.execution.workerStartCount,
      modelLoadCount: standard.execution.modelLoadCount,
    },
    adversarial: {
      workerStartCount: adversarial.execution.workerStartCount,
      modelLoadCount: adversarial.execution.modelLoadCount,
      preventedUnsafeTransitionCount:
        adversarial.execution.preventedUnsafeTransitionCount ?? 0,
      workerRestartCount: adversarial.execution.workerRestartCount ?? 0,
    },
    cacheReplay: {
      cacheHitCount: cacheReplay.execution.cacheHitCount,
      workerStartCount: cacheReplay.execution.workerStartCount,
      modelLoadCount: cacheReplay.execution.modelLoadCount,
    },
  },
  shareableAuditPassed: true,
  skill2Compatibility: { sentenceCount: 106, grammarPointCount: 106 },
  accepted: true,
};
const outputPath = path.resolve(
  values.output ??
    path.join(standard.taskRoot, "c5-16-1-cross-run-validation.json"),
);
await atomicWriteJson(outputPath, result, { overwrite: true });
process.stdout.write(
  `${JSON.stringify({ ok: true, outputPath, result }, null, 2)}\n`,
);

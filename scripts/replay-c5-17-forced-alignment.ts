import { cp, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";

import {
  ConsoleLogger,
  InputError,
  atomicWriteJson,
  c517ForcedAlignmentReplaySummarySchema,
  mfaSampleProbeSchema,
  subtitleCanonicalAlignmentInputSchema,
  subtitleCanonicalForcedAlignmentSchema,
  subtitleReviewPackageSchema,
  type ForcedAlignmentBackend,
  type ForcedAlignmentMode,
} from "@mvl/shared";
import { forcedAlignmentSha256 } from "@mvl/transcription-core";
import {
  canonicalForcedAlignmentEvidenceForHash,
  finalizeSubtitleTask,
  generateC5161ShareableArtifacts,
  sha256LocalFile,
} from "@mvl/video-subtitler";

const { values } = parseArgs({
  options: {
    task: { type: "string" },
    "human-reviewed-subtitle": { type: "string" },
    "source-video": { type: "string" },
    output: { type: "string" },
    "run-kind": { type: "string" },
    "forced-alignment": { type: "string", default: "enforce" },
    "forced-alignment-backend": { type: "string", default: "hybrid" },
    "mfa-executable": { type: "string" },
    "mfa-python-executable": { type: "string" },
    "mfa-runtime-manifest": { type: "string" },
    "mfa-acoustic-model": { type: "string" },
    "mfa-dictionary-model": { type: "string" },
    "mfa-g2p-model": { type: "string" },
    "mfa-temporary-directory": { type: "string" },
    "sudachi-runtime-manifest": { type: "string" },
    "sudachi-python-executable": { type: "string" },
    "sudachi-requirements": { type: "string" },
    "forced-alignment-narrow-context": { type: "string", default: "0.50" },
    "forced-alignment-expanded-context": { type: "string", default: "1.00" },
    "max-forced-alignment-attempts": { type: "string", default: "32" },
    "forced-alignment-concurrency": { type: "string", default: "1" },
    "target-component": { type: "string", multiple: true },
    "write-sample-probe": { type: "string" },
    "forced-alignment-cache-dir": { type: "string" },
    "forced-alignment-cache-import": { type: "string", multiple: true },
    "forced-alignment-cache-mode": { type: "string" },
    // Kept as a CLI compatibility alias for the command specified by C5.17.
    "asr-cache-mode": { type: "string", default: "read-write" },
    "sudachi-helper": {
      type: "string",
      default: path.resolve("scripts/sudachi-readings.py"),
    },
    "mfa-parser-helper": {
      type: "string",
      default: path.resolve("scripts/parse-mfa-output.py"),
    },
    "audio-track": { type: "string" },
    "no-review-audio": { type: "boolean", default: false },
    "emit-shareable-artifacts": { type: "boolean", default: false },
    "shareable-output": { type: "string" },
    "stock-patched-ab": { type: "string" },
    "mfa-sample-probe": { type: "string" },
    "runtime-preparation-summary": { type: "string" },
    "fresh-cache-observe-validation": { type: "string" },
    offline: { type: "boolean", default: false },
  },
  strict: true,
});

if (
  values.task === undefined ||
  values["human-reviewed-subtitle"] === undefined ||
  values["source-video"] === undefined
) {
  throw new InputError(
    "Usage: npm run replay:c5-17-1-forced-alignment -- --task <C5.16.1 task> --human-reviewed-subtitle <reviewed.ass> --source-video <video> --mfa-runtime-manifest <manifest> --sudachi-runtime-manifest <manifest> [runtime/model options]",
  );
}

function choice<T extends string>(
  value: string,
  allowed: readonly T[],
  option: string,
): T {
  if (!allowed.includes(value as T)) {
    throw new InputError(`Invalid ${option} value: ${value}`);
  }
  return value as T;
}

function numberValue(input: {
  value: string;
  option: string;
  minimum: number;
  maximum: number;
  integer?: boolean;
}): number {
  const parsed = Number(input.value);
  if (
    !Number.isFinite(parsed) ||
    parsed < input.minimum ||
    parsed > input.maximum ||
    (input.integer === true && !Number.isSafeInteger(parsed))
  ) {
    throw new InputError(`Invalid ${input.option} value: ${input.value}`);
  }
  return parsed;
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function collisionSafeTarget(sourceTask: string): Promise<string> {
  if (values.output !== undefined) {
    const explicit = path.resolve(values.output);
    if (await exists(explicit)) {
      throw new InputError(`Replay output already exists: ${explicit}`);
    }
    return explicit;
  }
  const sourceName = path.basename(sourceTask);
  const preferredName = /c5-16-1[^/]*/u.test(sourceName)
    ? sourceName.replace(
        /c5-16-1[^/]*/u,
        "c5-17-1-mfa-runtime-alignment-semantics-fresh-20260826",
      )
    : `${sourceName}-c5-17-1-mfa-runtime-alignment-semantics`;
  const parent = path.dirname(sourceTask);
  for (let suffix = 0; suffix < 1_000; suffix += 1) {
    const target = path.join(
      parent,
      suffix === 0
        ? preferredName
        : `${preferredName}-${String(suffix).padStart(2, "0")}`,
    );
    if (!(await exists(target))) return target;
  }
  throw new InputError(
    "Unable to allocate a collision-safe C5.17.1 output path.",
  );
}

async function fingerprint(filePath: string) {
  const info = await stat(filePath);
  if (!info.isFile()) throw new InputError(`Input is not a file: ${filePath}`);
  return {
    sha256: await sha256LocalFile(filePath),
    size: info.size,
    mtimeMs: info.mtimeMs,
  };
}

function readOnlyFingerprint(
  before: Awaited<ReturnType<typeof fingerprint>>,
  after: Awaited<ReturnType<typeof fingerprint>>,
) {
  return {
    sizeBefore: before.size,
    sizeAfter: after.size,
    mtimeMsBefore: before.mtimeMs,
    mtimeMsAfter: after.mtimeMs,
    verified:
      before.sha256 === after.sha256 &&
      before.size === after.size &&
      before.mtimeMs === after.mtimeMs,
  };
}

const sourceTask = path.resolve(values.task);
const humanReviewedSubtitle = path.resolve(values["human-reviewed-subtitle"]);
const sourceVideo = path.resolve(values["source-video"]);
const mode = choice(
  values["forced-alignment"],
  ["off", "observe", "enforce"] as const,
  "--forced-alignment",
) satisfies ForcedAlignmentMode;
if (mode === "off") {
  throw new InputError(
    "The C5.17 replay command requires observe or enforce mode.",
  );
}
const backend = choice(
  values["forced-alignment-backend"],
  ["evidence-dp", "mfa-japanese", "hybrid"] as const,
  "--forced-alignment-backend",
) satisfies ForcedAlignmentBackend;
const cacheMode = choice(
  values["forced-alignment-cache-mode"] ?? values["asr-cache-mode"],
  ["off", "read", "read-write"] as const,
  "--forced-alignment-cache-mode/--asr-cache-mode",
);
const runKind = choice(
  values["run-kind"] ??
    (mode === "observe"
      ? "observe"
      : cacheMode === "read"
        ? "cache-replay"
        : "fresh"),
  ["fresh", "cache-replay", "observe"] as const,
  "--run-kind",
);
if ((runKind === "observe") !== (mode === "observe")) {
  throw new InputError(
    "Observe run-kind and --forced-alignment observe must agree.",
  );
}
const narrowContextSeconds = numberValue({
  value: values["forced-alignment-narrow-context"],
  option: "--forced-alignment-narrow-context",
  minimum: 0,
  maximum: 1,
});
const expandedContextSeconds = numberValue({
  value: values["forced-alignment-expanded-context"],
  option: "--forced-alignment-expanded-context",
  minimum: narrowContextSeconds,
  maximum: 2,
});
const maximumTotalAlignmentAttempts = numberValue({
  value: values["max-forced-alignment-attempts"],
  option: "--max-forced-alignment-attempts",
  minimum: 1,
  maximum: 40,
  integer: true,
});
const concurrency = numberValue({
  value: values["forced-alignment-concurrency"],
  option: "--forced-alignment-concurrency",
  minimum: 1,
  maximum: 2,
  integer: true,
});
const audioTrack =
  values["audio-track"] === undefined
    ? undefined
    : numberValue({
        value: values["audio-track"],
        option: "--audio-track",
        minimum: 0,
        maximum: 64,
        integer: true,
      });
const mfaRuntimeManifest =
  values["mfa-runtime-manifest"] === undefined
    ? undefined
    : path.resolve(values["mfa-runtime-manifest"]);
const inferredMfaBinDirectory =
  mfaRuntimeManifest === undefined
    ? undefined
    : path.join(
        path.dirname(mfaRuntimeManifest),
        "env",
        process.platform === "win32" ? "Scripts" : "bin",
      );
const mfaExecutable =
  values["mfa-executable"] === undefined
    ? inferredMfaBinDirectory === undefined
      ? undefined
      : path.join(
          inferredMfaBinDirectory,
          process.platform === "win32" ? "mfa.exe" : "mfa",
        )
    : path.resolve(values["mfa-executable"]);
const mfaPythonExecutable =
  values["mfa-python-executable"] === undefined
    ? inferredMfaBinDirectory === undefined
      ? undefined
      : path.join(
          inferredMfaBinDirectory,
          process.platform === "win32" ? "python.exe" : "python",
        )
    : path.resolve(values["mfa-python-executable"]);
const sudachiRuntimeManifest =
  values["sudachi-runtime-manifest"] === undefined
    ? undefined
    : path.resolve(values["sudachi-runtime-manifest"]);
const inferredSudachiPythonExecutable =
  sudachiRuntimeManifest === undefined
    ? undefined
    : path.join(
        path.dirname(sudachiRuntimeManifest),
        "venv",
        "bin",
        process.platform === "win32" ? "python.exe" : "python",
      );
const sudachiPythonExecutable =
  values["sudachi-python-executable"] === undefined
    ? inferredSudachiPythonExecutable
    : path.resolve(values["sudachi-python-executable"]);
const sudachiRequirements =
  values["sudachi-requirements"] === undefined
    ? undefined
    : path.resolve(values["sudachi-requirements"]);
if (
  backend !== "evidence-dp" &&
  [
    mfaExecutable,
    mfaPythonExecutable,
    mfaRuntimeManifest,
    values["mfa-acoustic-model"],
    values["mfa-dictionary-model"],
    values["mfa-g2p-model"],
    sudachiRuntimeManifest,
    sudachiPythonExecutable,
  ].some((value) => value === undefined)
) {
  throw new InputError(
    "MFA/hybrid C5.17.1 replay requires MFA executable/Python/runtime/models and an independent Sudachi runtime manifest/Python.",
  );
}

const beforeVideo = await fingerprint(sourceVideo);
const beforeHuman = await fingerprint(humanReviewedSubtitle);
const outputTask = await collisionSafeTarget(sourceTask);
await cp(sourceTask, outputTask, {
  recursive: true,
  errorOnExist: true,
  force: false,
  preserveTimestamps: true,
});
// The copied C5.16.1 shareable folder describes the parent run. Regenerate it
// only after the C5.17 sidecars have been written.
await rm(path.join(outputTask, "shareable"), { recursive: true, force: true });
const started = performance.now();
const result = await finalizeSubtitleTask({
  taskDirectory: outputTask,
  mode: "review-fallback",
  humanReviewedSubtitlePath: humanReviewedSubtitle,
  sourceVideoPath: sourceVideo,
  prepareReview: true,
  generateReviewAudio: !values["no-review-audio"],
  presentationResolution: "enforce",
  overlapResolution: "conservative",
  // Reuse the existing C5.16.1 mapped-token/raw-VAD artifact. No Whisper run.
  overlapAcousticResolution: "off",
  forcedAlignment: mode,
  forcedAlignmentBackend: backend,
  forcedAlignmentConfiguration: {
    narrowContextSeconds,
    expandedContextSeconds,
    maximumAttemptsPerCue: 2,
    maximumTotalAlignmentAttempts,
    concurrency,
  },
  ...(values["target-component"] === undefined
    ? {}
    : { forcedAlignmentTargetComponentIds: values["target-component"] }),
  ...(mfaExecutable === undefined ? {} : { mfaExecutable }),
  ...(mfaPythonExecutable === undefined ? {} : { mfaPythonExecutable }),
  ...(mfaRuntimeManifest === undefined
    ? {}
    : { mfaRuntimeManifestPath: mfaRuntimeManifest }),
  ...(values["mfa-acoustic-model"] === undefined
    ? {}
    : { mfaAcousticModel: values["mfa-acoustic-model"] }),
  ...(values["mfa-dictionary-model"] === undefined
    ? {}
    : { mfaDictionaryModel: values["mfa-dictionary-model"] }),
  ...(values["mfa-g2p-model"] === undefined
    ? {}
    : { mfaG2pModel: values["mfa-g2p-model"] }),
  ...(values["mfa-temporary-directory"] === undefined
    ? {}
    : {
        mfaTemporaryDirectory: path.resolve(values["mfa-temporary-directory"]),
      }),
  ...(sudachiRuntimeManifest === undefined
    ? {}
    : { sudachiRuntimeManifestPath: sudachiRuntimeManifest }),
  ...(sudachiPythonExecutable === undefined ? {} : { sudachiPythonExecutable }),
  ...(sudachiRequirements === undefined
    ? {}
    : { sudachiRequirementsPath: sudachiRequirements }),
  sudachiHelperPath: path.resolve(values["sudachi-helper"]),
  mfaParserHelperPath: path.resolve(values["mfa-parser-helper"]),
  ...(values["forced-alignment-cache-dir"] === undefined
    ? {}
    : {
        forcedAlignmentCacheDirectory: path.resolve(
          values["forced-alignment-cache-dir"],
        ),
      }),
  forcedAlignmentCacheImportPaths: (
    values["forced-alignment-cache-import"] ?? []
  ).map((value) => path.resolve(value)),
  forcedAlignmentCacheMode: cacheMode,
  ...(audioTrack === undefined ? {} : { audioTrack }),
  logger: new ConsoleLogger(false, "info"),
});
const wallClockSeconds = (performance.now() - started) / 1_000;

if (
  result.outputPaths.canonicalAlignmentInput === null ||
  result.outputPaths.canonicalForcedAlignment === null ||
  result.outputPaths.forcedAlignmentCacheManifest === null
) {
  throw new InputError("C5.17.1 finalization did not emit required sidecars.");
}
const canonicalInput = subtitleCanonicalAlignmentInputSchema.parse(
  JSON.parse(
    await readFile(result.outputPaths.canonicalAlignmentInput, "utf8"),
  ) as unknown,
);
const alignment = subtitleCanonicalForcedAlignmentSchema.parse(
  JSON.parse(
    await readFile(result.outputPaths.canonicalForcedAlignment, "utf8"),
  ) as unknown,
);
const reviewPackage =
  result.outputPaths.reviewPackage === null
    ? null
    : subtitleReviewPackageSchema.parse(
        JSON.parse(
          await readFile(result.outputPaths.reviewPackage, "utf8"),
        ) as unknown,
      );
const afterVideo = await fingerprint(sourceVideo);
const afterHuman = await fingerprint(humanReviewedSubtitle);
const sourceReadOnly = readOnlyFingerprint(beforeVideo, afterVideo);
const humanSubtitleReadOnly = readOnlyFingerprint(beforeHuman, afterHuman);
if (!sourceReadOnly.verified || !humanSubtitleReadOnly.verified) {
  throw new InputError("A read-only C5.17.1 input changed during replay.");
}
const summary = c517ForcedAlignmentReplaySummarySchema.parse({
  schemaVersion: "1.0.0",
  artifactType: "c5-17-forced-alignment-replay-summary",
  replayVersion: "C5.17.1",
  generatedAt: new Date().toISOString(),
  runKind,
  inputTaskName: path.basename(sourceTask),
  outputTaskName: path.basename(outputTask),
  forcedAlignmentMode: mode,
  backend,
  runtimeIdentityHash:
    alignment.summary.attemptCount === 0
      ? null
      : (alignment.attempts[0]?.runtimeIdentityHash ?? null),
  canonicalInputHash: forcedAlignmentSha256({
    ...canonicalInput,
    generatedAt: null,
  }),
  alignmentHash: forcedAlignmentSha256(
    canonicalForcedAlignmentEvidenceForHash(alignment),
  ),
  componentDecisionHash: forcedAlignmentSha256(alignment.components),
  mutationHash: forcedAlignmentSha256(alignment.mutations),
  outputCueHash: result.report.outputCueHash,
  sourceSha256Before: beforeVideo.sha256,
  sourceSha256After: afterVideo.sha256,
  humanSubtitleSha256Before: beforeHuman.sha256,
  humanSubtitleSha256After: afterHuman.sha256,
  sourceReadOnly,
  humanSubtitleReadOnly,
  metrics: {
    componentCount: alignment.summary.componentCount,
    cueCount: alignment.summary.cueCount,
    attemptCount: alignment.summary.attemptCount,
    successCount: alignment.summary.successfulAttemptCount,
    failureCount: alignment.summary.failedAttemptCount,
    cacheHitCount: alignment.summary.cacheHitCount,
    mfaProcessCount: alignment.summary.mfaProcessCount,
    wallClockSeconds,
    timingMutationCount: alignment.summary.timingMutationCount,
    reviewItemCount:
      reviewPackage?.summary.itemCount ?? result.report.metrics.reviewItemCount,
    wholeMediaAsrRequestCount: 0,
    whisperAsrRequestCount: 0,
    openAiRequestCount: 0,
    onlineSubtitleLookupCount: 0,
  },
  canonicalTimingUnchanged: alignment.summary.timingMutationCount === 0,
  blockersClosed: alignment.summary.autoResolvedComponentCount,
  finalStatus: result.report.status,
  finalizationMethod: result.report.finalizationMethod,
});
const summaryPath = path.join(
  outputTask,
  "c5-17-forced-alignment-replay-summary.json",
);
await atomicWriteJson(summaryPath, summary, { overwrite: false });

let sampleProbePath: string | null = null;
if (values["write-sample-probe"] !== undefined) {
  const sampleAttempt = alignment.attempts.find(
    (attempt) => attempt.alignmentSucceeded && !attempt.cacheHit,
  );
  if (sampleAttempt === undefined) {
    throw new InputError(
      "C5.17.1 sample probe requested, but no successful non-cache MFA attempt was produced.",
    );
  }
  const interval = (
    value: { start: number; end: number } | null | undefined,
  ) =>
    value === null || value === undefined
      ? null
      : { start: value.start, end: value.end };
  const probe = mfaSampleProbeSchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "mfa-sample-probe",
    probeVersion: "C5.17.1",
    generatedAt: new Date().toISOString(),
    componentId: sampleAttempt.componentId,
    cueId: sampleAttempt.cueId,
    runtimeIdentityHash: sampleAttempt.runtimeIdentityHash,
    acousticModelIdentityHash: sampleAttempt.acousticModelHash,
    dictionaryModelIdentityHash: sampleAttempt.dictionaryModelHash,
    g2pModelIdentityHash: sampleAttempt.g2pModelHash,
    command: sampleAttempt.commandMode,
    g2pCommand: "g2p",
    outputFormat: sampleAttempt.outputFormat,
    wordTierObserved: sampleAttempt.wordAlignments.length > 0,
    phoneTierObserved: sampleAttempt.phoneAlignments.length > 0,
    fileInterval: interval(sampleAttempt.fileInterval),
    lexicalUtteranceInterval: interval(sampleAttempt.lexicalUtteranceInterval),
    phoneUtteranceInterval: interval(sampleAttempt.phoneUtteranceInterval),
    selectedUtteranceInterval: interval(
      sampleAttempt.selectedUtteranceInterval,
    ),
    selectedBoundarySource: sampleAttempt.selectedBoundarySource ?? "none",
    wordCount: sampleAttempt.wordAlignments.length,
    phoneCount: sampleAttempt.phoneAlignments.length,
    oovCount: sampleAttempt.oovCount,
    timeUnit: "seconds",
    parserVersion: sampleAttempt.parserVersion,
    alignmentSucceeded: sampleAttempt.alignmentSucceeded,
    failure: sampleAttempt.failure,
  });
  sampleProbePath = path.resolve(values["write-sample-probe"]);
  await atomicWriteJson(sampleProbePath, probe, { overwrite: false });
}

let shareableDirectory: string | null = null;
if (values["emit-shareable-artifacts"]) {
  if (result.outputPaths.forcedAlignmentRuntimeCapability === null) {
    throw new InputError(
      "C5.17.1 shareable generation requires a verified MFA runtime capability artifact.",
    );
  }
  const stockPatchedRuntimeAbPath = path.resolve(
    values["stock-patched-ab"] ??
      path.join(sourceTask, "shareable", "c5-16-stock-patched-runtime-ab.json"),
  );
  if (!(await exists(stockPatchedRuntimeAbPath))) {
    throw new InputError(
      "C5.17 shareable generation requires the C5.16 stock/patched runtime A/B artifact.",
    );
  }
  const modelExternalFiles = (
    await Promise.all(
      [
        ["mfa-acoustic-model", values["mfa-acoustic-model"]],
        ["mfa-dictionary-model", values["mfa-dictionary-model"]],
        ["mfa-g2p-model", values["mfa-g2p-model"]],
      ].map(async ([role, value]) => {
        if (value === undefined) return null;
        const filePath = path.resolve(value);
        try {
          return (await stat(filePath)).isFile() ? { role, filePath } : null;
        } catch {
          // MFA also accepts verified model aliases. Their archive fingerprints
          // already live in the runtime capability artifact.
          return null;
        }
      }),
    )
  ).filter(
    (value): value is { role: string; filePath: string } => value !== null,
  );
  const requestedSampleProbePath = values["mfa-sample-probe"];
  const resolvedSampleProbePath =
    sampleProbePath ??
    (requestedSampleProbePath === undefined
      ? null
      : path.resolve(requestedSampleProbePath));
  const generated = await generateC5161ShareableArtifacts({
    taskRoot: outputTask,
    subtitleDirectory: result.subtitleDirectory,
    localExecutionSummaryPath: summaryPath,
    stockPatchedRuntimeAbPath,
    outputDirectory:
      values["shareable-output"] === undefined
        ? path.join(outputTask, "shareable")
        : path.resolve(values["shareable-output"]),
    externalFiles: [
      { role: "source-video", filePath: sourceVideo },
      { role: "human-reviewed-subtitle", filePath: humanReviewedSubtitle },
      ...(mfaRuntimeManifest === undefined
        ? []
        : [
            {
              role: "mfa-runtime-capability-manifest",
              filePath: mfaRuntimeManifest,
            },
          ]),
      ...modelExternalFiles,
    ],
    c517Artifacts: {
      runtimeCapabilityPath:
        result.outputPaths.forcedAlignmentRuntimeCapability,
      canonicalInputPath: result.outputPaths.canonicalAlignmentInput,
      forcedAlignmentPath: result.outputPaths.canonicalForcedAlignment,
      replaySummaryPath: summaryPath,
      ...(result.outputPaths.canonicalPronunciation === null
        ? {}
        : { pronunciationPath: result.outputPaths.canonicalPronunciation }),
      ...(result.outputPaths.sudachiRuntimeCapability === null
        ? {}
        : {
            sudachiRuntimeCapabilityPath:
              result.outputPaths.sudachiRuntimeCapability,
          }),
      cacheManifestPath: result.outputPaths.forcedAlignmentCacheManifest,
      ...(resolvedSampleProbePath === null
        ? {}
        : { sampleProbePath: resolvedSampleProbePath }),
      ...(values["runtime-preparation-summary"] === undefined
        ? {}
        : {
            runtimePreparationSummaryPath: path.resolve(
              values["runtime-preparation-summary"],
            ),
          }),
      ...(values["fresh-cache-observe-validation"] === undefined
        ? {}
        : {
            freshCacheObserveValidationPath: path.resolve(
              values["fresh-cache-observe-validation"],
            ),
          }),
    },
  });
  shareableDirectory = generated.outputDirectory;
}

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      outputTask,
      subtitleDirectory: result.subtitleDirectory,
      summaryPath,
      sampleProbePath,
      shareableDirectory,
      summary,
    },
    null,
    2,
  )}\n`,
);

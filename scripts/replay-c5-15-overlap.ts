import { cp, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  ConsoleLogger,
  InputError,
  atomicWriteJson,
  subtitleOverlapAcousticResolutionSchema,
} from "@mvl/shared";
import {
  finalizeSubtitleTask,
  locateSubtitlePackage,
  sha256LocalFile,
} from "@mvl/video-subtitler";

const { values } = parseArgs({
  options: {
    task: { type: "string" },
    "human-reviewed-subtitle": { type: "string" },
    "source-video": { type: "string" },
    output: { type: "string" },
    "audio-track": { type: "string" },
    "overlap-acoustic-resolution": { type: "string", default: "enforce" },
    "timestamp-evidence-integrity": { type: "string", default: "enforce" },
    "token-timestamp-policy": { type: "string", default: "auto" },
    "legacy-overlap-cache-policy": { type: "string", default: "reject" },
    "presentation-resolution": { type: "string", default: "enforce" },
    "overlap-resolution": { type: "string", default: "conservative" },
    "overlap-context-seconds": { type: "string", default: "1.5" },
    "overlap-max-window-seconds": { type: "string", default: "20" },
    "max-overlap-asr-requests": { type: "string", default: "21" },
    "whisper-cpp-path": { type: "string" },
    "local-transcription-model": { type: "string" },
    "local-transcription-model-directory": { type: "string" },
    "whisper-vad-model": { type: "string" },
    coreml: { type: "string", default: "auto" },
    "whisper-execution-mode": { type: "string", default: "persistent" },
    "asr-cache-dir": { type: "string" },
    "asr-cache-import": { type: "string", multiple: true },
    "asr-cache-mode": { type: "string", default: "read-write" },
    "no-review-audio": { type: "boolean", default: false },
  },
  strict: true,
});

if (
  values.task === undefined ||
  values["human-reviewed-subtitle"] === undefined ||
  values["source-video"] === undefined
) {
  throw new InputError(
    "Usage: npm run replay:c5-15-overlap -- --task <C5.14 task> --human-reviewed-subtitle <reviewed.ass> --source-video <video> [local Whisper options]",
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

function numberValue(value: string, option: string, minimum: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum) {
    throw new InputError(`Invalid ${option} value: ${value}`);
  }
  return parsed;
}

const sourceTask = path.resolve(values.task);
const humanReviewedSubtitle = path.resolve(values["human-reviewed-subtitle"]);
const sourceVideo = path.resolve(values["source-video"]);
const overlapAcousticResolution = choice(
  values["overlap-acoustic-resolution"],
  ["off", "observe", "enforce"] as const,
  "--overlap-acoustic-resolution",
);
const presentationResolution = choice(
  values["presentation-resolution"],
  ["off", "observe", "enforce"] as const,
  "--presentation-resolution",
);
const timestampEvidenceIntegrity = choice(
  values["timestamp-evidence-integrity"],
  ["off", "observe", "enforce"] as const,
  "--timestamp-evidence-integrity",
);
const tokenTimestampPolicy = choice(
  values["token-timestamp-policy"],
  ["auto", "mapped-only", "validated-legacy", "off"] as const,
  "--token-timestamp-policy",
);
const legacyOverlapCachePolicy = choice(
  values["legacy-overlap-cache-policy"],
  ["reject", "text-only"] as const,
  "--legacy-overlap-cache-policy",
);
const overlapResolution = choice(
  values["overlap-resolution"],
  ["conservative", "balanced"] as const,
  "--overlap-resolution",
);
const coreML = choice(
  values.coreml,
  ["auto", "on", "off"] as const,
  "--coreml",
);
const whisperExecutionMode = choice(
  values["whisper-execution-mode"],
  ["auto", "persistent", "batch", "process"] as const,
  "--whisper-execution-mode",
);
const asrCacheMode = choice(
  values["asr-cache-mode"],
  ["off", "read", "read-write"] as const,
  "--asr-cache-mode",
);
const audioTrack =
  values["audio-track"] === undefined
    ? undefined
    : numberValue(values["audio-track"], "--audio-track", 0);
if (audioTrack !== undefined && !Number.isSafeInteger(audioTrack)) {
  throw new InputError("--audio-track must be a non-negative integer.");
}
const maximumAsrRequests = numberValue(
  values["max-overlap-asr-requests"],
  "--max-overlap-asr-requests",
  1,
);
if (!Number.isSafeInteger(maximumAsrRequests) || maximumAsrRequests > 28) {
  throw new InputError(
    "--max-overlap-asr-requests must be an integer from 1 to 28.",
  );
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function collisionSafeTarget(): Promise<string> {
  if (values.output !== undefined) {
    const explicit = path.resolve(values.output);
    if (await exists(explicit)) {
      throw new InputError(
        `Replay output already exists and will not be overwritten: ${explicit}`,
      );
    }
    return explicit;
  }
  const sourceName = path.basename(sourceTask);
  const stage =
    timestampEvidenceIntegrity === "enforce"
      ? "c5-15-1-timestamp-integrity"
      : "c5-15-targeted-acoustic-overlap-resolution";
  const preferredName = /c5-1[45][^/]*/u.test(sourceName)
    ? sourceName.replace(/c5-1[45][^/]*/u, stage)
    : `${sourceName}-${stage}`;
  const parent = path.dirname(sourceTask);
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const target = path.join(
      parent,
      suffix === 0
        ? preferredName
        : `${preferredName}-${String(suffix).padStart(2, "0")}`,
    );
    if (!(await exists(target))) return target;
  }
  throw new InputError(
    "Unable to allocate a collision-safe C5.15 output path.",
  );
}

async function fingerprint(filePath: string) {
  const info = await stat(filePath);
  return {
    sha256: await sha256LocalFile(filePath),
    size: info.size,
    mtimeMs: info.mtimeMs,
  };
}

const beforeVideo = await fingerprint(sourceVideo);
const beforeHuman = await fingerprint(humanReviewedSubtitle);
const outputTask = await collisionSafeTarget();
await cp(sourceTask, outputTask, {
  recursive: true,
  errorOnExist: true,
  force: false,
  preserveTimestamps: true,
});
const copied = await locateSubtitlePackage(outputTask);
await Promise.all(
  [
    path.join(copied.subtitleDirectory, "audio", "review"),
    path.join(copied.subtitleDirectory, "audio", "overlap"),
    path.join(copied.subtitleDirectory, "audio", "overlap-cache"),
    path.join(copied.subtitleDirectory, "review"),
    path.join(copied.subtitleDirectory, "subtitle-review-package.json"),
    path.join(
      copied.subtitleDirectory,
      "human-review-resolutions.template.json",
    ),
    path.join(
      copied.subtitleDirectory,
      "subtitle-overlap-acoustic-resolution.json",
    ),
    path.join(
      copied.subtitleDirectory,
      "overlap-whisper-execution-metrics.json",
    ),
    path.join(copied.subtitleDirectory, "overlap-asr-cache-manifest.json"),
    path.join(
      copied.subtitleDirectory,
      "subtitle-timestamp-evidence-integrity.json",
    ),
  ].map(async (derivedPath) => {
    await rm(derivedPath, { recursive: true, force: true });
  }),
);

const result = await finalizeSubtitleTask({
  taskDirectory: outputTask,
  mode: "review-fallback",
  humanReviewedSubtitlePath: humanReviewedSubtitle,
  sourceVideoPath: sourceVideo,
  prepareReview: true,
  generateReviewAudio: !values["no-review-audio"],
  presentationResolution,
  overlapResolution,
  overlapAcousticResolution,
  timestampEvidenceIntegrity,
  tokenTimestampPolicy,
  legacyOverlapCachePolicy,
  ...(audioTrack === undefined ? {} : { audioTrack }),
  overlapAcousticConfiguration: {
    contextSeconds: numberValue(
      values["overlap-context-seconds"],
      "--overlap-context-seconds",
      0,
    ),
    maximumWindowSeconds: numberValue(
      values["overlap-max-window-seconds"],
      "--overlap-max-window-seconds",
      0.001,
    ),
    maximumAsrRequests,
  },
  ...(values["whisper-cpp-path"] === undefined
    ? {}
    : { whisperCppPath: values["whisper-cpp-path"] }),
  ...(values["local-transcription-model"] === undefined
    ? {}
    : { localTranscriptionModelPath: values["local-transcription-model"] }),
  ...(values["local-transcription-model-directory"] === undefined
    ? {}
    : {
        localTranscriptionModelDirectory:
          values["local-transcription-model-directory"],
      }),
  ...(values["whisper-vad-model"] === undefined
    ? {}
    : { localVadModelPath: values["whisper-vad-model"] }),
  coreML,
  whisperExecutionMode,
  ...(values["asr-cache-dir"] === undefined
    ? {}
    : { asrCacheDirectory: values["asr-cache-dir"] }),
  asrCacheImportPaths: values["asr-cache-import"] ?? [],
  asrCacheMode,
  logger: new ConsoleLogger(false, "info"),
});

const resolutionPath = path.join(
  result.subtitleDirectory,
  "subtitle-overlap-acoustic-resolution.json",
);
const acoustic = subtitleOverlapAcousticResolutionSchema.parse(
  JSON.parse(await readFile(resolutionPath, "utf8")) as unknown,
);
const executionMetrics = JSON.parse(
  await readFile(
    path.join(
      result.subtitleDirectory,
      "overlap-whisper-execution-metrics.json",
    ),
    "utf8",
  ),
) as Record<string, unknown>;
const afterVideo = await fingerprint(sourceVideo);
const afterHuman = await fingerprint(humanReviewedSubtitle);
const readonlyEqual = (
  before: Awaited<ReturnType<typeof fingerprint>>,
  after: Awaited<ReturnType<typeof fingerprint>>,
) =>
  before.sha256 === after.sha256 &&
  before.size === after.size &&
  before.mtimeMs === after.mtimeMs;
const summaryPath = path.join(
  outputTask,
  timestampEvidenceIntegrity === "enforce"
    ? "c5-15-1-timestamp-integrity-replay-summary.json"
    : "c5-15-overlap-replay-summary.json",
);
await atomicWriteJson(
  summaryPath,
  {
    schemaVersion: "1.0.0",
    runType:
      timestampEvidenceIntegrity === "enforce"
        ? "C5.15.1 timestamp evidence integrity replay"
        : "C5.15 targeted acoustic overlap replay",
    generatedAt: new Date().toISOString(),
    inputTaskName: path.basename(sourceTask),
    outputTaskName: path.basename(outputTask),
    configuration: {
      overlapAcousticResolution,
      timestampEvidenceIntegrity,
      tokenTimestampPolicy,
      legacyOverlapCachePolicy,
      presentationResolution,
      overlapResolution,
      audioTrack: acoustic.configuration.audioStreamIndex,
      coreML,
      whisperExecutionMode,
      asrCacheMode,
      maximumAsrRequests,
    },
    execution: {
      targetComponentCount: acoustic.summary.componentCount,
      targetCueCount: acoustic.summary.cueCount,
      extractedAudioCount: acoustic.summary.audioExtractedCount,
      audioFullyCoveredCount: acoustic.summary.audioFullyCoveredCount,
      profileAttemptCount: acoustic.summary.profileAttemptCount,
      overlapAsrRequestCount: acoustic.summary.asrRequestCount,
      cacheHitCount: acoustic.summary.cacheHitCount,
      wholeMediaAsrRequestCount: acoustic.summary.wholeMediaAsrRequestCount,
      networkAccessed: false,
      openAIApiCalled: false,
      onlineSubtitleSearchCount: 0,
      executionMetrics,
    },
    outcome: {
      status: result.report.status,
      finalizationMethod: result.report.finalizationMethod,
      canonicalCueHash: result.report.outputCueHash,
      presentationCueHash: (
        JSON.parse(
          await readFile(result.outputPaths.presentationResolution, "utf8"),
        ) as { presentationCueHash: string }
      ).presentationCueHash,
      outputHash: result.report.outputHash,
      metrics: result.report.metrics,
      qualityGate: result.report.qualityGate,
      acousticSummary: acoustic.summary,
    },
    sourceReadOnly: {
      video: {
        before: beforeVideo,
        after: afterVideo,
        verified: readonlyEqual(beforeVideo, afterVideo),
      },
      humanReviewedSubtitle: {
        before: beforeHuman,
        after: afterHuman,
        verified: readonlyEqual(beforeHuman, afterHuman),
      },
    },
    outputPaths: {
      task: outputTask,
      subtitleDirectory: result.subtitleDirectory,
      report: result.outputPaths.report,
      presentationResolution: result.outputPaths.presentationResolution,
      overlapAcousticResolution: resolutionPath,
      overlapWhisperExecutionMetrics: path.join(
        result.subtitleDirectory,
        "overlap-whisper-execution-metrics.json",
      ),
      timestampEvidenceIntegrity: path.join(
        result.subtitleDirectory,
        "subtitle-timestamp-evidence-integrity.json",
      ),
      reviewPackage: result.outputPaths.reviewPackage,
    },
  },
  { overwrite: false },
);

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      outputTask,
      summaryPath,
      status: result.report.status,
      finalizationMethod: result.report.finalizationMethod,
      metrics: result.report.metrics,
      acousticSummary: acoustic.summary,
    },
    null,
    2,
  )}\n`,
);

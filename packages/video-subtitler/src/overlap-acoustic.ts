import { createHash } from "node:crypto";
import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import {
  AppError,
  InputError,
  atomicWriteJson,
  type Logger,
  type OverlapAcousticAttempt,
  type OverlapAcousticProfile,
  type OverlapAcousticResolutionMode,
  type ProcessRunner,
  type SourceFingerprint,
  type SubtitleCue,
  type SubtitleOverlapAcousticResolution,
  type WhisperExecutionMetrics,
  type WhisperExecutionMode,
  type WhisperModelCapability,
} from "@mvl/shared";
import {
  DEFAULT_OVERLAP_ACOUSTIC_CONFIGURATION,
  PortableAsrCache,
  WhisperCppWorkerPool,
  buildPortableAsrCacheIdentityV2,
  buildSubtitleOverlapAcousticResolution,
  classifyOverlapAcousticComponent,
  createWhisperCppAdapterForCapability,
  hashAsrPrompt,
  planOverlapAcousticComponents,
  presentationResolutionHash,
  resolveExecutablePath,
  type AsrCacheMode,
  type OverlapAcousticComponentPlan,
  type OverlapAcousticConfiguration,
  type SubtitlePresentationResolutionResult,
  type TranscriptionAdapter,
  type TranscriptionChunkResult,
  type WhisperVadProfile,
} from "@mvl/transcription-core";

import { probeMedia } from "./probe.js";
import { sha256LocalFile } from "./finalization-support.js";

export type OverlapCoreMLMode = "auto" | "on" | "off";

export interface TargetedOverlapAcousticOptions {
  mode: OverlapAcousticResolutionMode;
  sourceVideoPath: string;
  subtitleDirectory: string;
  sourceFingerprint: SourceFingerprint;
  cues: readonly SubtitleCue[];
  presentation: SubtitlePresentationResolutionResult;
  baseCueHash: string;
  audioStreamIndex?: number;
  configuration?: Partial<OverlapAcousticConfiguration>;
  runner: ProcessRunner;
  logger?: Logger;
  ffmpegPath?: string;
  ffprobePath?: string;
  whisperCppPath?: string;
  localModelPath?: string;
  localModelDirectory?: string;
  vadModelPath?: string;
  coreML?: OverlapCoreMLMode;
  whisperExecutionMode?: WhisperExecutionMode;
  asrCacheDirectory?: string;
  asrCacheImportPaths?: readonly string[];
  asrCacheMode?: AsrCacheMode;
}

export interface TargetedOverlapAcousticResult {
  artifact: SubtitleOverlapAcousticResolution;
  executionMetrics: WhisperExecutionMetrics;
  audioStreamIndex: number;
  dependencyFailure: string | null;
  wallClockSeconds: number;
  outputPaths: {
    resolution: string;
    executionMetrics: string;
    cacheManifest: string;
  };
}

interface RuntimeResolution {
  capability: WhisperModelCapability;
  executablePath: string;
  whisperCppVersion: string;
  vadModelPath: string | null;
  tokenTimestampsAvailable: boolean;
  fullJsonAvailable: boolean;
  logicalCores: number;
}

interface ExtractedComponentAudio {
  plan: OverlapAcousticComponentPlan;
  absolutePath: string;
  relativePath: string;
  sha256: string;
  durationSeconds: number;
  fullyCoversComponent: boolean;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function deterministicId(prefix: string, value: unknown): string {
  return `${prefix}-${createHash("sha256").update(stable(value)).digest("hex").slice(0, 20)}`;
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isDirectory();
  } catch {
    return false;
  }
}

async function selectAudioStream(input: {
  sourceVideoPath: string;
  explicit?: number;
  runner: ProcessRunner;
  ffprobePath: string;
}): Promise<{ index: number; mediaDurationSeconds: number }> {
  const source = await probeMedia(
    input.sourceVideoPath,
    input.runner,
    input.ffprobePath,
  );
  const audio = source.streams.filter((stream) => stream.type === "audio");
  if (input.explicit !== undefined) {
    if (!audio.some((stream) => stream.index === input.explicit)) {
      throw new InputError(
        `Audio stream ${String(input.explicit)} does not exist in the selected source video.`,
      );
    }
    return {
      index: input.explicit,
      mediaDurationSeconds: source.format.durationSeconds,
    };
  }
  if (audio.length !== 1 || audio[0] === undefined) {
    throw new InputError(
      "Targeted overlap analysis requires --audio-track when the source has multiple reasonable audio streams.",
      { audioStreams: audio.map((stream) => stream.index) },
    );
  }
  return {
    index: audio[0].index,
    mediaDurationSeconds: source.format.durationSeconds,
  };
}

async function resolveModelPath(input: {
  explicitPath?: string;
  directory?: string;
}): Promise<string | null> {
  if (input.explicitPath !== undefined) {
    const explicit = path.resolve(input.explicitPath);
    if (!(await isFile(explicit))) {
      throw new InputError(
        `Configured local Whisper model is missing: ${explicit}`,
      );
    }
    return explicit;
  }
  const directories = [
    input.directory,
    process.env.WHISPER_MODEL_DIR,
    process.env.WHISPER_MODEL_DIRECTORY,
    path.join(process.env.HOME ?? "", ".cache", "whisper.cpp"),
  ].filter((value): value is string => value !== undefined && value !== "");
  const preferred = ["ggml-large-v3.bin", "ggml-large-v3-q5_0.bin"];
  for (const directory of directories) {
    let names: string[];
    try {
      names = await readdir(path.resolve(directory));
    } catch {
      continue;
    }
    for (const name of preferred) {
      const candidate = path.join(path.resolve(directory), name);
      if (names.includes(name) && (await isFile(candidate))) return candidate;
    }
  }
  return null;
}

function modelFamily(filePath: string): string {
  return path
    .basename(filePath)
    .replace(/^ggml-/u, "")
    .replace(/-(?:q[0-9]+(?:_[0-9]+)?|f16|f32)\.bin$/iu, "")
    .replace(/\.bin$/u, "");
}

async function resolveRuntime(input: {
  runner: ProcessRunner;
  whisperCppPath?: string;
  localModelPath?: string;
  localModelDirectory?: string;
  vadModelPath?: string;
  coreML: OverlapCoreMLMode;
}): Promise<RuntimeResolution | null> {
  const executablePath = await resolveExecutablePath(
    input.whisperCppPath ?? process.env.WHISPER_CPP_PATH ?? "whisper-cli",
  );
  const modelPath = await resolveModelPath({
    ...(input.localModelPath === undefined
      ? {}
      : { explicitPath: input.localModelPath }),
    ...(input.localModelDirectory === undefined
      ? {}
      : { directory: input.localModelDirectory }),
  });
  if (executablePath === null || modelPath === null) return null;
  const diagnostic = await input.runner.run(executablePath, ["--help"], {
    allowNonZero: true,
    timeoutMs: 30_000,
  });
  const help = `${diagnostic.stdout}\n${diagnostic.stderr}`;
  const versionResult = await input.runner.run(executablePath, ["--version"], {
    allowNonZero: true,
    timeoutMs: 30_000,
  });
  const versionDiagnostic = `${versionResult.stdout}\n${versionResult.stderr}`;
  const whisperCppVersion =
    /whisper\.cpp version:\s*([^\r\n]+)/iu
      .exec(versionDiagnostic)?.[1]
      ?.trim() ??
    versionDiagnostic.trim().split(/\r?\n/u).at(-1) ??
    "unknown";
  const family = modelFamily(modelPath);
  if (family !== "large-v3") {
    throw new InputError(
      `C5.15 requires the local large-v3 model; received ${family}.`,
    );
  }
  const encoderPath = path.join(
    path.dirname(modelPath),
    `ggml-${family}-encoder.mlmodelc`,
  );
  const encoderAvailable = await isDirectory(encoderPath);
  const coreMLCompiled = /COREML\s*=\s*1/iu.test(versionDiagnostic + help);
  if (input.coreML === "on" && (!encoderAvailable || !coreMLCompiled)) {
    throw new AppError(
      "--coreml on was requested, but the matching encoder or a Core ML-enabled whisper.cpp executable is unavailable.",
      { code: "COREML_NOT_COMPILED", exitCode: 4 },
    );
  }
  const useCoreML =
    input.coreML !== "off" && encoderAvailable && coreMLCompiled;
  const modelInfo = await stat(modelPath);
  const modelHash = await sha256LocalFile(modelPath);
  const requestedVadPath =
    input.vadModelPath ??
    process.env.WHISPER_VAD_MODEL_PATH ??
    path.join(path.dirname(modelPath), "ggml-silero-v6.2.0.bin");
  const vadModelPath = (await isFile(path.resolve(requestedVadPath)))
    ? path.resolve(requestedVadPath)
    : null;
  return {
    capability: {
      id: `${family}:full:${useCoreML ? "coreml" : "cpu"}`,
      modelPath,
      modelHash,
      modelFamily: family,
      runtime: useCoreML ? "coreml" : "cpu",
      qualityTier: "maximum",
      quantization:
        /-(q[0-9]+(?:_[0-9]+)?)\.bin$/iu.exec(path.basename(modelPath))?.[1] ??
        null,
      coreML: {
        supported: useCoreML,
        status: useCoreML
          ? "available"
          : input.coreML === "off"
            ? "disabled-by-user"
            : coreMLCompiled
              ? "encoder-missing"
              : "not-compiled",
        deviceCapable:
          process.platform === "darwin" && process.arch === "arm64",
        whisperCppCompiledWithCoreML: coreMLCompiled,
        encoderAvailable,
        encoderPath: encoderAvailable ? encoderPath : null,
        runtimeValidated: useCoreML,
        reason: useCoreML
          ? null
          : "C5.15 uses the supported local CPU/Metal backend because Core ML was disabled or unavailable.",
      },
      estimatedMemoryBytes: Math.round(modelInfo.size * 1.35),
      roles: ["refinement", "fallback"],
    },
    executablePath,
    whisperCppVersion,
    vadModelPath,
    tokenTimestampsAvailable:
      /--output-json-full\b/u.test(help) && /--max-len\b/u.test(help),
    fullJsonAvailable: /--output-json-full\b/u.test(help),
    logicalCores: Math.max(1, Number(process.env.MVL_LOGICAL_CORES ?? 0) || 8),
  };
}

async function extractComponentAudio(input: {
  plan: OverlapAcousticComponentPlan;
  sourceVideoPath: string;
  subtitleDirectory: string;
  audioStreamIndex: number;
  runner: ProcessRunner;
  ffmpegPath: string;
}): Promise<ExtractedComponentAudio> {
  const relativePath = path.posix.join(
    "audio",
    "overlap",
    `${input.plan.componentId}.wav`,
  );
  const absolutePath = path.join(input.subtitleDirectory, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  const duration =
    input.plan.extractionInterval.end - input.plan.extractionInterval.start;
  await input.runner.run(input.ffmpegPath, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    input.plan.extractionInterval.start.toFixed(3),
    "-i",
    input.sourceVideoPath,
    "-map",
    `0:${input.audioStreamIndex}`,
    "-t",
    duration.toFixed(3),
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "pcm_s16le",
    absolutePath,
  ]);
  return {
    plan: input.plan,
    absolutePath,
    relativePath,
    sha256: await sha256LocalFile(absolutePath),
    durationSeconds: duration,
    fullyCoversComponent:
      input.plan.extractionInterval.start <= input.plan.unionInterval.start &&
      input.plan.extractionInterval.end >= input.plan.unionInterval.end,
  };
}

function adapterProfile(profile: OverlapAcousticProfile): {
  useVad: boolean;
  vadProfile: WhisperVadProfile;
} {
  switch (profile) {
    case "extra-sensitive-vad":
      return { useVad: true, vadProfile: "extra-sensitive-v1" };
    case "no-vad":
      return { useVad: false, vadProfile: "sensitive-v2" };
    case "current-sensitive-vad":
      return { useVad: true, vadProfile: "sensitive-v2" };
  }
}

export function mapOverlapLocalTimestampToGlobal(
  value: number,
  extraction: { start: number; end: number },
): number {
  return Math.min(extraction.end, Math.max(extraction.start, value));
}

function mapAttempt(input: {
  result: TranscriptionChunkResult;
  plan: OverlapAcousticComponentPlan;
  profile: OverlapAcousticProfile;
  runtime: RuntimeResolution;
  requestId: string;
  cacheHit: boolean;
  prompt: string | undefined;
  durationSeconds: number;
  failure?: string | null;
}): OverlapAcousticAttempt {
  const offset = input.plan.extractionInterval.start;
  const tokens: OverlapAcousticAttempt["tokens"] = [];
  const segments = input.result.segments.flatMap((segment, segmentIndex) => {
    const start = mapOverlapLocalTimestampToGlobal(
      offset + segment.start,
      input.plan.extractionInterval,
    );
    const end = mapOverlapLocalTimestampToGlobal(
      offset + segment.end,
      input.plan.extractionInterval,
    );
    if (end <= start) return [];
    const segmentId = deterministicId("overlap-segment", {
      requestId: input.requestId,
      segmentIndex,
      start,
      end,
      text: segment.text,
    });
    const tokenIds = (segment.tokens ?? []).flatMap((token, tokenIndex) => {
      const tokenStart = mapOverlapLocalTimestampToGlobal(
        offset + token.start,
        input.plan.extractionInterval,
      );
      const tokenEnd = mapOverlapLocalTimestampToGlobal(
        offset + token.end,
        input.plan.extractionInterval,
      );
      if (tokenEnd < tokenStart) return [];
      const tokenId = deterministicId("overlap-token", {
        requestId: input.requestId,
        segmentIndex,
        tokenIndex,
        start: tokenStart,
        end: tokenEnd,
        text: token.text,
      });
      tokens.push({
        tokenId,
        text: token.text,
        start: tokenStart,
        end: tokenEnd,
        probability: token.probability ?? null,
      });
      return [tokenId];
    });
    return [
      {
        segmentId,
        text: segment.text,
        start,
        end,
        confidence: segment.confidence,
        tokenIds,
      },
    ];
  });
  const speechIntervals = segments.map((segment) => ({
    start: segment.start,
    end: segment.end,
  }));
  const profile = adapterProfile(input.profile);
  return {
    attemptId: deterministicId("overlap-attempt", {
      componentId: input.plan.componentId,
      profile: input.profile,
      requestId: input.requestId,
    }),
    componentId: input.plan.componentId,
    profile: input.profile,
    requestId: input.requestId,
    requestType: "overlap-evidence",
    useVad: profile.useVad,
    vadProfile: profile.useVad ? profile.vadProfile : "no-vad",
    model: path.basename(input.runtime.capability.modelPath),
    modelHash: input.runtime.capability.modelHash,
    modelFamily: input.runtime.capability.modelFamily,
    coreML: input.runtime.capability.runtime === "coreml",
    whisperCppVersion: input.runtime.whisperCppVersion,
    cacheHit: input.cacheHit,
    promptSha256: hashAsrPrompt(input.prompt),
    targetCueTextUsedAsPrompt: false,
    referenceTranslationUsedAsPrompt: false,
    humanReviewedSentenceUsedAsPrompt: false,
    rawText: input.result.text,
    segments,
    tokens,
    speechIntervals,
    metrics: {
      durationSeconds: input.durationSeconds,
      segmentCount: segments.length,
      tokenCount: tokens.length,
      speechIntervalCount: speechIntervals.length,
      tokenTimestampsRequested: true,
      tokenTimestampsUsed: tokens.length > 0,
    },
    language: "ja",
    failure: input.failure ?? null,
  };
}

function emptyExecutionMetrics(
  requestedMode: WhisperExecutionMode,
): WhisperExecutionMetrics {
  return {
    schemaVersion: "1.0.0",
    requestedMode,
    executionMode: "process",
    backend: "cpu",
    asrRequestCount: 0,
    cacheHitCount: 0,
    workerStartCount: 0,
    modelLoadCount: 0,
    initializationSeconds: 0,
    modelLoadSeconds: 0,
    coreMLWarmupSeconds: 0,
    transcriptionSeconds: 0,
    totalWorkerSeconds: 0,
    fallbackProcessCount: 0,
    requests: [],
    workers: [],
    fallbackReason: null,
  };
}

export async function runTargetedOverlapAcousticResolution(
  options: TargetedOverlapAcousticOptions,
): Promise<TargetedOverlapAcousticResult> {
  const started = performance.now();
  const ffmpegPath = options.ffmpegPath ?? "ffmpeg";
  const ffprobePath = options.ffprobePath ?? "ffprobe";
  const configuration: OverlapAcousticConfiguration = {
    ...DEFAULT_OVERLAP_ACOUSTIC_CONFIGURATION,
    ...options.configuration,
    scoringWeights: {
      ...DEFAULT_OVERLAP_ACOUSTIC_CONFIGURATION.scoringWeights,
      ...options.configuration?.scoringWeights,
    },
  };
  const selectedAudio = await selectAudioStream({
    sourceVideoPath: options.sourceVideoPath,
    ...(options.audioStreamIndex === undefined
      ? {}
      : { explicit: options.audioStreamIndex }),
    runner: options.runner,
    ffprobePath,
  });
  const plans = planOverlapAcousticComponents({
    cues: options.cues,
    presentation: options.presentation.artifact,
    mediaDurationSeconds: selectedAudio.mediaDurationSeconds,
    configuration,
  });
  const extracted: ExtractedComponentAudio[] = [];
  for (const plan of plans) {
    extracted.push(
      await extractComponentAudio({
        plan,
        sourceVideoPath: options.sourceVideoPath,
        subtitleDirectory: options.subtitleDirectory,
        audioStreamIndex: selectedAudio.index,
        runner: options.runner,
        ffmpegPath,
      }),
    );
  }
  const requestedExecutionMode = options.whisperExecutionMode ?? "auto";
  let runtime: RuntimeResolution | null = null;
  let dependencyFailure: string | null = null;
  try {
    runtime = await resolveRuntime({
      runner: options.runner,
      ...(options.whisperCppPath === undefined
        ? {}
        : { whisperCppPath: options.whisperCppPath }),
      ...(options.localModelPath === undefined
        ? {}
        : { localModelPath: options.localModelPath }),
      ...(options.localModelDirectory === undefined
        ? {}
        : { localModelDirectory: options.localModelDirectory }),
      ...(options.vadModelPath === undefined
        ? {}
        : { vadModelPath: options.vadModelPath }),
      coreML: options.coreML ?? "auto",
    });
    if (runtime === null) {
      dependencyFailure = "LOCAL_WHISPER_LARGE_V3_UNAVAILABLE";
    }
  } catch (error) {
    if ((options.coreML ?? "auto") === "on") throw error;
    dependencyFailure = error instanceof Error ? error.message : String(error);
  }
  const cache = new PortableAsrCache({
    ...(options.asrCacheDirectory === undefined
      ? {}
      : { portableRoot: options.asrCacheDirectory }),
    taskLocalRoot: path.join(
      options.subtitleDirectory,
      "audio",
      "overlap-cache",
    ),
    importRoots: options.asrCacheImportPaths ?? [],
    mode: options.asrCacheMode ?? "read-write",
    sourceOutputDirectory: options.subtitleDirectory,
  });
  const workerPool = new WhisperCppWorkerPool({ mode: requestedExecutionMode });
  const adapters = new Map<OverlapAcousticProfile, TranscriptionAdapter>();
  const attempts: OverlapAcousticAttempt[] = [];
  if (runtime !== null) {
    for (const audio of extracted) {
      for (const profileId of audio.plan.profiles) {
        const profile = adapterProfile(profileId);
        const requestId = deterministicId("overlap-request", {
          audioSha256: audio.sha256,
          extractionInterval: audio.plan.extractionInterval,
          unionInterval: audio.plan.unionInterval,
          profile: profileId,
          modelHash: runtime.capability.modelHash,
        });
        const prompt = undefined;
        const identity = buildPortableAsrCacheIdentityV2({
          audioContentSha256: audio.sha256,
          interval: audio.plan.extractionInterval,
          sampleRate: 16_000,
          channels: 1,
          codec: "pcm_s16le",
          adapterId: "whisper-cpp",
          model: path.basename(runtime.capability.modelPath),
          modelHash: runtime.capability.modelHash,
          modelFamily: runtime.capability.modelFamily,
          coreML: runtime.capability.runtime === "coreml",
          whisperCppVersion: runtime.whisperCppVersion,
          language: "ja",
          vadMode: profile.useVad ? profile.vadProfile : "no-vad",
          timestampStrategy: "segment+token",
          tokenTimestamps: true,
          decodeConfiguration: {
            requestType: "overlap-evidence",
            targetUnionInterval: audio.plan.unionInterval,
            profile: profileId,
            useVad: profile.useVad,
            vadProfile: profile.vadProfile,
            language: "ja",
            tokenTimestamps: true,
            suppressNonSpeechTokens: true,
          },
        });
        const lookup = await cache.lookup({
          requestId,
          requestType: "overlap-evidence",
          identity,
        });
        let result = lookup.result;
        let failure: string | null = null;
        if (lookup.hit) {
          workerPool.recordCacheHits(1);
        } else {
          let adapter = adapters.get(profileId);
          if (adapter === undefined) {
            adapter = await createWhisperCppAdapterForCapability({
              capability: runtime.capability,
              executablePath: runtime.executablePath,
              runner: options.runner,
              whisperCppVersion: runtime.whisperCppVersion,
              ...(runtime.vadModelPath === null
                ? {}
                : { vadModelPath: runtime.vadModelPath }),
              useVad: profile.useVad,
              vadProfile: profile.vadProfile,
              logicalCores: runtime.logicalCores,
              tokenTimestampsAvailable: runtime.tokenTimestampsAvailable,
              fullJsonAvailable: runtime.fullJsonAvailable,
              workerPool,
            });
            adapters.set(profileId, adapter);
          }
          try {
            result = await adapter.transcribe({
              audioPath: audio.absolutePath,
              chunk: {
                id: requestId,
                relativePath: audio.relativePath,
                start: audio.plan.extractionInterval.start,
                end: audio.plan.extractionInterval.end,
                duration: audio.durationSeconds,
                sha256: audio.sha256,
              },
              language: "ja",
              timestampStrategy: "segment",
              tokenTimestamps: true,
            });
            await cache.store({
              requestId,
              requestType: "overlap-evidence",
              identity,
              result,
            });
          } catch (error) {
            failure = error instanceof Error ? error.message : String(error);
            result = { text: "", segments: [], raw: null };
          }
        }
        attempts.push(
          mapAttempt({
            result: result ?? { text: "", segments: [], raw: null },
            plan: audio.plan,
            profile: profileId,
            runtime,
            requestId,
            cacheHit: lookup.hit,
            prompt,
            durationSeconds: audio.durationSeconds,
            failure,
          }),
        );
      }
    }
  }
  await workerPool.close();
  const executionMetrics =
    runtime === null
      ? emptyExecutionMetrics(requestedExecutionMode)
      : workerPool.metrics();
  const decisionById = new Map(
    options.presentation.artifact.overlapDecisions.map((decision) => [
      decision.decisionId,
      decision,
    ]),
  );
  const components = extracted.map((audio) => {
    const sourceDecision = decisionById.get(audio.plan.sourceOverlapDecisionId);
    if (sourceDecision === undefined) {
      throw new Error(
        `Missing source overlap decision ${audio.plan.sourceOverlapDecisionId}.`,
      );
    }
    return classifyOverlapAcousticComponent({
      plan: audio.plan,
      allCues: options.cues,
      sourceDecision,
      attempts,
      mode: options.mode,
      configuration,
      audioPath: audio.relativePath,
      audioSha256: audio.sha256,
      audioDurationSeconds: audio.durationSeconds,
      audioFullyCoversComponent: audio.fullyCoversComponent,
    });
  });
  const artifact = buildSubtitleOverlapAcousticResolution({
    sourceFingerprint: options.sourceFingerprint,
    baseCueHash: options.baseCueHash,
    basePresentationResolutionHash: presentationResolutionHash({
      ...options.presentation.artifact,
      generatedAt: null,
    }),
    mode: options.mode,
    audioStreamIndex: selectedAudio.index,
    configuration,
    attempts,
    components,
  });
  const outputPaths = {
    resolution: path.join(
      options.subtitleDirectory,
      "subtitle-overlap-acoustic-resolution.json",
    ),
    executionMetrics: path.join(
      options.subtitleDirectory,
      "overlap-whisper-execution-metrics.json",
    ),
    cacheManifest: path.join(
      options.subtitleDirectory,
      "overlap-asr-cache-manifest.json",
    ),
  };
  await Promise.all([
    atomicWriteJson(outputPaths.resolution, artifact, { overwrite: true }),
    atomicWriteJson(outputPaths.executionMetrics, executionMetrics, {
      overwrite: true,
    }),
    atomicWriteJson(outputPaths.cacheManifest, cache.manifest(), {
      overwrite: true,
    }),
  ]);
  const wallClockSeconds = (performance.now() - started) / 1000;
  options.logger?.log("info", "Targeted overlap acoustic analysis completed.", {
    componentCount: artifact.summary.componentCount,
    resolvedCount: artifact.summary.resolvedCount,
    asrRequestCount: artifact.summary.asrRequestCount,
    cacheHitCount: artifact.summary.cacheHitCount,
    workerStartCount: executionMetrics.workerStartCount,
    dependencyFailure,
    wallClockSeconds,
  });
  return {
    artifact,
    executionMetrics,
    audioStreamIndex: selectedAudio.index,
    dependencyFailure,
    wallClockSeconds,
    outputPaths,
  };
}

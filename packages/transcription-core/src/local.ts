import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import { homedir } from "node:os";
import os from "node:os";
import path from "node:path";

import {
  AppError,
  InputError,
  type LanguageTag,
  type ProcessRunner,
  type WhisperModelCapability,
  type RawVadPolicy,
  type TimestampRuntimePolicy,
} from "@mvl/shared";
import { parseSrt } from "@mvl/subtitle-core";

import { OpenAITranscriptionAdapter } from "./adapters.js";
import type {
  TimestampStrategy,
  TranscriptionAdapter,
  TranscriptionChunkResult,
  TranscriptionProvider,
  TranscriptionRequest,
  WhisperVadProfile,
} from "./types.js";
import type { WhisperCppWorkerPool } from "./worker.js";

const GIBIBYTE = 1024 ** 3;

export interface HardwareProfile {
  platform: NodeJS.Platform;
  architecture: string;
  totalMemoryBytes: number;
  logicalCores: number;
  cpuModel: string;
}

export interface TranscriptionAdapterResolution {
  adapter: TranscriptionAdapter;
  timestampStrategy: TimestampStrategy;
  rationale: string;
}

export interface ResolveTranscriptionAdapterOptions {
  provider?: TranscriptionProvider;
  runner: ProcessRunner;
  durationSeconds: number;
  language?: LanguageTag;
  timestampStrategy?: TimestampStrategy;
  openAIModel?: string;
  whisperCppPath?: string;
  localModelPath?: string;
  localModelDirectory?: string;
  vadModelPath?: string;
  useVad?: boolean;
  environment?: NodeJS.ProcessEnv;
  hardware?: HardwareProfile;
}

export function detectHardwareProfile(): HardwareProfile {
  const cpus = os.cpus();
  return {
    platform: process.platform,
    architecture: process.arch,
    totalMemoryBytes: os.totalmem(),
    logicalCores: Math.max(1, cpus.length),
    cpuModel: cpus[0]?.model ?? "unknown",
  };
}

export function recommendWhisperCppModels(input: {
  hardware: HardwareProfile;
  durationSeconds: number;
  language?: LanguageTag;
}): string[] {
  const memoryGiB = input.hardware.totalMemoryBytes / GIBIBYTE;
  const isJapanese = input.language === "ja";
  const isShortProgram = input.durationSeconds <= 30 * 60;
  if (memoryGiB >= 24 && isJapanese && isShortProgram) {
    return [
      "ggml-large-v3.bin",
      "ggml-large-v3-q5_0.bin",
      "ggml-large-v3-turbo.bin",
      "ggml-large-v3-turbo-q5_0.bin",
      "ggml-medium.bin",
      "ggml-medium-q5_0.bin",
      "ggml-small.bin",
      "ggml-small-q5_0.bin",
    ];
  }
  if (memoryGiB >= 12) {
    return isJapanese && isShortProgram
      ? [
          "ggml-large-v3-q5_0.bin",
          "ggml-large-v3-turbo-q5_0.bin",
          "ggml-medium-q5_0.bin",
          "ggml-large-v3-turbo.bin",
          "ggml-large-v3.bin",
          "ggml-medium.bin",
          "ggml-small-q5_0.bin",
          "ggml-small.bin",
        ]
      : [
          "ggml-large-v3-turbo-q5_0.bin",
          "ggml-large-v3-q5_0.bin",
          "ggml-medium-q5_0.bin",
          "ggml-large-v3-turbo.bin",
          "ggml-large-v3.bin",
          "ggml-medium.bin",
          "ggml-small-q5_0.bin",
          "ggml-small.bin",
        ];
  }
  if (memoryGiB >= 6) {
    return [
      "ggml-small-q5_0.bin",
      "ggml-small.bin",
      "ggml-base-q5_0.bin",
      "ggml-base.bin",
    ];
  }
  return ["ggml-base-q5_0.bin", "ggml-base.bin", "ggml-tiny.bin"];
}

async function isRegularFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function resolveExecutable(
  requested: string,
  environment: NodeJS.ProcessEnv,
): Promise<string | null> {
  const containsSeparator = requested.includes(path.sep);
  if (path.isAbsolute(requested) || containsSeparator) {
    const absolute = path.resolve(requested);
    try {
      await access(absolute, constants.X_OK);
      return absolute;
    } catch {
      return null;
    }
  }
  for (const directory of (environment.PATH ?? "").split(path.delimiter)) {
    if (directory === "") continue;
    const candidate = path.join(directory, requested);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue through PATH without invoking a shell.
    }
  }
  return null;
}

async function resolveModelPath(input: {
  explicitPath?: string;
  explicitDirectory?: string;
  environment: NodeJS.ProcessEnv;
  recommendations: readonly string[];
}): Promise<string | null> {
  const configuredPath =
    input.explicitPath ?? input.environment.WHISPER_MODEL_PATH;
  if (configuredPath !== undefined && configuredPath.trim() !== "") {
    const absolute = path.resolve(configuredPath);
    if (!(await isRegularFile(absolute))) {
      throw new AppError("Configured Whisper model file does not exist.", {
        code: "MISSING_DEPENDENCY",
        exitCode: 4,
        details: { modelPath: absolute },
      });
    }
    return absolute;
  }
  const directories = [
    input.explicitDirectory,
    input.environment.WHISPER_MODEL_DIR,
    input.environment.WHISPER_MODEL_DIRECTORY,
    path.resolve("models/whisper"),
    path.join(homedir(), ".cache/whisper.cpp"),
  ].filter(
    (value, index, values): value is string =>
      value !== undefined &&
      value.trim() !== "" &&
      values.indexOf(value) === index,
  );
  for (const directory of directories) {
    let names: string[];
    try {
      names = await readdir(path.resolve(directory));
    } catch {
      continue;
    }
    for (const recommendation of input.recommendations) {
      if (!names.includes(recommendation)) continue;
      const candidate = path.join(path.resolve(directory), recommendation);
      if (await isRegularFile(candidate)) return candidate;
    }
  }
  return null;
}

function whisperLanguage(language: LanguageTag | undefined): string {
  if (language === undefined || language === "mixed" || language === "und") {
    return "auto";
  }
  return language.startsWith("zh") ? "zh" : language;
}

function whisperInitialPrompt(prompt: string | undefined): string | null {
  if (prompt === undefined) return null;
  const allowed = [
    /Confirmed names and terms:\s*([^.]*)/u.exec(prompt)?.[1],
    /Previous confirmed speech:\s*(.*?)(?=\s+Next confirmed speech:|$)/u.exec(
      prompt,
    )?.[1],
    /Next confirmed speech:\s*(.*?)$/u.exec(prompt)?.[1],
  ]
    .filter((value): value is string => value !== undefined)
    .map((value) => value.trim())
    .filter(Boolean);
  return allowed.length === 0 ? null : allowed.join(" ");
}

interface WhisperJsonToken {
  text: string;
  start: number;
  end: number;
  probability: number | null;
}

function jsonOffsetSeconds(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value / 1000
    : null;
}

function parseWhisperFullJson(value: unknown): {
  tokensBySegment: WhisperJsonToken[][];
} {
  if (typeof value !== "object" || value === null) {
    return { tokensBySegment: [] };
  }
  const transcription = (value as { transcription?: unknown }).transcription;
  if (!Array.isArray(transcription)) return { tokensBySegment: [] };
  return {
    tokensBySegment: transcription.map((segment) => {
      if (typeof segment !== "object" || segment === null) return [];
      const tokens = (segment as { tokens?: unknown }).tokens;
      if (!Array.isArray(tokens)) return [];
      return tokens.flatMap((token) => {
        if (typeof token !== "object" || token === null) return [];
        const item = token as {
          text?: unknown;
          p?: unknown;
          offsets?: { from?: unknown; to?: unknown };
          timestamps?: { offsets?: { from?: unknown; to?: unknown } };
        };
        const offsets = item.offsets ?? item.timestamps?.offsets;
        const start = jsonOffsetSeconds(offsets?.from);
        const end = jsonOffsetSeconds(offsets?.to);
        if (start === null || end === null || end < start) return [];
        return [
          {
            text: typeof item.text === "string" ? item.text : "",
            start,
            end,
            probability:
              typeof item.p === "number" &&
              Number.isFinite(item.p) &&
              item.p >= 0 &&
              item.p <= 1
                ? item.p
                : null,
          },
        ];
      });
    }),
  };
}

async function resolveVadModelPath(input: {
  explicitPath?: string;
  environment: NodeJS.ProcessEnv;
  transcriptionModelPath: string;
}): Promise<string | null> {
  const configuredPath =
    input.explicitPath ?? input.environment.WHISPER_VAD_MODEL_PATH;
  if (configuredPath !== undefined && configuredPath.trim() !== "") {
    const absolute = path.resolve(configuredPath);
    if (!(await isRegularFile(absolute))) {
      throw new InputError(
        "Configured Whisper VAD model file does not exist.",
        {
          modelPath: absolute,
        },
      );
    }
    return absolute;
  }
  const candidates = [
    path.join(
      path.dirname(input.transcriptionModelPath),
      "ggml-silero-v6.2.0.bin",
    ),
    path.join(homedir(), ".cache/whisper.cpp/ggml-silero-v6.2.0.bin"),
  ];
  for (const candidate of candidates) {
    if (await isRegularFile(candidate)) return candidate;
  }
  return null;
}

export class WhisperCppTranscriptionAdapter implements TranscriptionAdapter {
  readonly id = "whisper-cpp";
  readonly model: string;
  readonly #executablePath: string;
  readonly #modelPath: string;
  readonly #vadModelPath: string | null;
  readonly #useVad: boolean;
  readonly #vadProfile: WhisperVadProfile;
  readonly #runner: ProcessRunner;
  readonly #workerPool: WhisperCppWorkerPool | null;
  readonly #threads: number;
  readonly #coreML: boolean;
  readonly #tokenTimestampsAvailable: boolean;
  readonly #fullJsonAvailable: boolean;
  readonly #serverPath: string | undefined;
  readonly #timestampRuntimePolicy: TimestampRuntimePolicy;
  readonly #rawVadPolicy: RawVadPolicy;
  readonly #mvlResponseSchemaVersion: string | undefined;
  readonly #expectedMvlRuntime:
    | {
        upstreamCommit: string;
        patchId: string;
        patchSha256: string;
        binarySha256: string;
        buildFlagsHash: string;
      }
    | undefined;
  readonly runtime:
    | {
        modelPath: string;
        modelFamily: string;
        modelHash: string;
        coreML: boolean;
        whisperCppVersion: string;
        tokenTimestampsAvailable?: boolean;
        fullJsonAvailable?: boolean;
      }
    | undefined;

  constructor(options: {
    executablePath: string;
    modelPath: string;
    vadModelPath?: string;
    runner: ProcessRunner;
    threads?: number;
    coreML?: boolean;
    modelFamily?: string;
    modelHash?: string;
    whisperCppVersion?: string;
    tokenTimestampsAvailable?: boolean;
    fullJsonAvailable?: boolean;
    useVad?: boolean;
    vadProfile?: WhisperVadProfile;
    workerPool?: WhisperCppWorkerPool;
    serverPath?: string;
    timestampRuntimePolicy?: TimestampRuntimePolicy;
    rawVadPolicy?: RawVadPolicy;
    mvlResponseSchemaVersion?: string;
    expectedMvlRuntime?: {
      upstreamCommit: string;
      patchId: string;
      patchSha256: string;
      binarySha256: string;
      buildFlagsHash: string;
    };
  }) {
    this.#executablePath = options.executablePath;
    this.#modelPath = options.modelPath;
    this.#vadModelPath = options.vadModelPath ?? null;
    this.#useVad = (options.useVad ?? true) && this.#vadModelPath !== null;
    this.#vadProfile = options.vadProfile ?? "sensitive-v2";
    this.#runner = options.runner;
    this.#workerPool = options.workerPool ?? null;
    this.#coreML = options.coreML ?? false;
    this.#tokenTimestampsAvailable = options.tokenTimestampsAvailable ?? false;
    this.#fullJsonAvailable = options.fullJsonAvailable ?? false;
    this.#serverPath = options.serverPath;
    this.#timestampRuntimePolicy = options.timestampRuntimePolicy ?? "auto";
    this.#rawVadPolicy = options.rawVadPolicy ?? "auto";
    this.#mvlResponseSchemaVersion = options.mvlResponseSchemaVersion;
    this.#expectedMvlRuntime = options.expectedMvlRuntime;
    this.#threads = Math.max(
      1,
      options.threads ?? Math.min(8, Math.max(1, os.cpus().length - 2)),
    );
    this.model = [
      path.basename(options.modelPath),
      this.#coreML ? "coreml" : "cpu",
      !this.#useVad
        ? "suppress-nst-v1"
        : `vad-${this.#vadProfile}-${path.basename(options.vadModelPath ?? "vad")}`,
    ].join("+");
    this.runtime =
      options.modelFamily === undefined ||
      options.modelHash === undefined ||
      options.whisperCppVersion === undefined
        ? undefined
        : {
            modelPath: options.modelPath,
            modelFamily: options.modelFamily,
            modelHash: options.modelHash,
            coreML: this.#coreML,
            whisperCppVersion: options.whisperCppVersion,
            tokenTimestampsAvailable: this.#tokenTimestampsAvailable,
            fullJsonAvailable: this.#fullJsonAvailable,
          };
  }

  async #executionModelPath(audioPath: string): Promise<string> {
    if (this.#coreML) return this.#modelPath;
    const modelIdentity =
      this.runtime?.modelHash.slice(0, 16) ??
      createHash("sha256").update(this.#modelPath).digest("hex").slice(0, 16);
    const directory = path.join(
      path.dirname(audioPath),
      ".models-no-coreml",
      modelIdentity,
    );
    await mkdir(directory, { recursive: true });
    const linkedModel = path.join(directory, path.basename(this.#modelPath));
    try {
      await symlink(this.#modelPath, linkedModel);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "EEXIST"
      ) {
        throw error;
      }
    }
    return linkedModel;
  }

  async transcribe(
    request: TranscriptionRequest,
  ): Promise<TranscriptionChunkResult> {
    const executionModelPath = await this.#executionModelPath(
      request.audioPath,
    );
    if (this.#workerPool === null) {
      return await this.#transcribeProcess(request, executionModelPath);
    }
    const initialPrompt = whisperInitialPrompt(request.prompt);
    return await this.#workerPool.transcribe({
      request,
      capability: {
        executablePath: this.#executablePath,
        modelPath: executionModelPath,
        modelHash:
          this.runtime?.modelHash ??
          createHash("sha256").update(this.#modelPath).digest("hex"),
        whisperCppVersion: this.runtime?.whisperCppVersion ?? "unknown",
        coreML: this.#coreML,
        threads: this.#threads,
        language: request.language,
        ...(this.#vadModelPath === null
          ? {}
          : { vadModelPath: this.#vadModelPath }),
        useVad: this.#useVad,
        vadProfile: this.#vadProfile,
        tokenTimestamps:
          this.#tokenTimestampsAvailable && this.#fullJsonAvailable,
        promptConstraint: "confirmed-names-v1",
        ...(this.#serverPath === undefined
          ? {}
          : { serverPath: this.#serverPath }),
        timestampRuntimePolicy: this.#timestampRuntimePolicy,
        rawVadPolicy: this.#rawVadPolicy,
        ...(this.#mvlResponseSchemaVersion === undefined
          ? {}
          : { mvlResponseSchemaVersion: this.#mvlResponseSchemaVersion }),
        ...(this.#expectedMvlRuntime === undefined
          ? {}
          : { expectedMvlRuntime: this.#expectedMvlRuntime }),
      },
      initialPrompt,
      processFallback: async () =>
        await this.#transcribeProcess(request, executionModelPath),
    });
  }

  async #transcribeProcess(
    request: TranscriptionRequest,
    executionModelPath: string,
  ): Promise<TranscriptionChunkResult> {
    const outputPrefix = path.join(
      path.dirname(request.audioPath),
      `.whisper-cpp-${randomUUID()}`,
    );
    const srtPath = `${outputPrefix}.srt`;
    const jsonPath = `${outputPrefix}.json`;
    const requestTokenTimestamps =
      request.tokenTimestamps === true &&
      this.#tokenTimestampsAvailable &&
      this.#fullJsonAvailable;
    const initialPrompt = whisperInitialPrompt(request.prompt);
    const vad =
      this.#vadProfile === "extra-sensitive-v1"
        ? {
            threshold: "0.25",
            minimumSpeechMs: "50",
            minimumSilenceMs: "100",
            speechPadMs: "400",
            samplesOverlap: "0.35",
          }
        : {
            threshold: "0.35",
            minimumSpeechMs: "100",
            minimumSilenceMs: "150",
            speechPadMs: "250",
            samplesOverlap: "0.25",
          };
    const args = [
      "--model",
      executionModelPath,
      "--file",
      request.audioPath,
      "--language",
      whisperLanguage(request.language),
      "--threads",
      String(this.#threads),
      "--output-srt",
      "--output-file",
      outputPrefix,
      ...(requestTokenTimestamps
        ? ["--output-json-full", "--max-len", "64", "--split-on-word"]
        : []),
      "--suppress-nst",
      "--no-prints",
      ...(!this.#useVad || this.#vadModelPath === null
        ? []
        : [
            "--vad",
            "--vad-model",
            this.#vadModelPath,
            "--vad-threshold",
            vad.threshold,
            "--vad-min-speech-duration-ms",
            vad.minimumSpeechMs,
            "--vad-min-silence-duration-ms",
            vad.minimumSilenceMs,
            "--vad-max-speech-duration-s",
            "30",
            "--vad-speech-pad-ms",
            vad.speechPadMs,
            "--vad-samples-overlap",
            vad.samplesOverlap,
          ]),
      ...(initialPrompt === null ? [] : ["--prompt", initialPrompt]),
    ];
    try {
      await this.#runner.run(this.#executablePath, args, {
        timeoutMs: Math.max(
          5 * 60_000,
          Math.min(60 * 60_000, request.chunk.duration * 4_000),
        ),
      });
      const srt = await readFile(srtPath, "utf8");
      if (srt.trim() === "") {
        return {
          text: "",
          segments: [],
          raw: { provider: this.id, model: this.model, segmentCount: 0 },
        };
      }
      const cues = parseSrt(srt);
      let tokensBySegment: WhisperJsonToken[][] = [];
      let fullJson: unknown = null;
      if (requestTokenTimestamps) {
        try {
          fullJson = JSON.parse(await readFile(jsonPath, "utf8")) as unknown;
          tokensBySegment = parseWhisperFullJson(fullJson).tokensBySegment;
        } catch {
          tokensBySegment = [];
        }
      }
      const text = cues
        .map((cue) => cue.text.trim())
        .filter(Boolean)
        .join(" ");
      if (text === "")
        return { text: "", segments: [], raw: { provider: this.id } };
      const segments =
        request.timestampStrategy === "chunk"
          ? [
              {
                start: 0,
                end: request.chunk.duration,
                text,
                speaker: null,
                confidence: null,
              },
            ]
          : cues
              .map((cue, index) => ({
                start: Math.max(0, cue.start),
                end: Math.min(request.chunk.duration, cue.end),
                text: cue.text.trim(),
                speaker: cue.speaker,
                confidence: null,
                ...(tokensBySegment[index] === undefined ||
                tokensBySegment[index].length === 0
                  ? {}
                  : { tokens: tokensBySegment[index] }),
              }))
              .filter(
                (segment) => segment.text !== "" && segment.end > segment.start,
              );
      return {
        text,
        segments,
        raw: {
          provider: this.id,
          model: this.model,
          segmentCount: segments.length,
          tokenTimestampsRequested: request.tokenTimestamps === true,
          tokenTimestampsAvailable: this.#tokenTimestampsAvailable,
          tokenTimestampsUsed: segments.some(
            (segment) => (segment.tokens?.length ?? 0) > 0,
          ),
          ...(fullJson === null ? {} : { fullJson }),
        },
      };
    } finally {
      await Promise.all([
        rm(srtPath, { force: true }),
        rm(jsonPath, { force: true }),
      ]);
    }
  }
}

export async function createWhisperCppAdapterForCapability(input: {
  capability: WhisperModelCapability;
  executablePath: string;
  runner: ProcessRunner;
  whisperCppVersion: string;
  vadModelPath?: string;
  useVad?: boolean;
  vadProfile?: WhisperVadProfile;
  environment?: NodeJS.ProcessEnv;
  logicalCores?: number;
  tokenTimestampsAvailable?: boolean;
  fullJsonAvailable?: boolean;
  workerPool?: WhisperCppWorkerPool;
  serverPath?: string;
  timestampRuntimePolicy?: TimestampRuntimePolicy;
  rawVadPolicy?: RawVadPolicy;
  mvlResponseSchemaVersion?: string;
  expectedMvlRuntime?: {
    upstreamCommit: string;
    patchId: string;
    patchSha256: string;
    binarySha256: string;
    buildFlagsHash: string;
  };
}): Promise<WhisperCppTranscriptionAdapter> {
  if (
    input.capability.runtime === "coreml" &&
    !input.capability.coreML.supported
  ) {
    if (input.capability.coreML.status === "not-compiled") {
      throw new AppError(
        "Core ML is available on this device, but the configured whisper.cpp binary was not compiled with Core ML support. Rebuild whisper.cpp with Core ML support, rerun with --coreml auto, or rerun with --coreml off.",
        {
          code: "COREML_NOT_COMPILED",
          exitCode: 4,
          details: {
            capabilityId: input.capability.id,
            coreMLStatus: input.capability.coreML.status,
          },
        },
      );
    }
    throw new AppError(
      `Core ML capability ${input.capability.id} is not runtime-validated.`,
      {
        code: "MISSING_DEPENDENCY",
        exitCode: 4,
        details: {
          capabilityId: input.capability.id,
          coreMLStatus: input.capability.coreML.status,
        },
      },
    );
  }
  const environment = input.environment ?? process.env;
  const vadModel = await resolveVadModelPath({
    environment,
    transcriptionModelPath: input.capability.modelPath,
    ...(input.vadModelPath === undefined
      ? {}
      : { explicitPath: input.vadModelPath }),
  });
  return new WhisperCppTranscriptionAdapter({
    executablePath: input.executablePath,
    modelPath: input.capability.modelPath,
    ...(vadModel === null ? {} : { vadModelPath: vadModel }),
    runner: input.runner,
    threads: Math.min(
      8,
      Math.max(1, (input.logicalCores ?? os.cpus().length) - 2),
    ),
    coreML: input.capability.runtime === "coreml",
    modelFamily: input.capability.modelFamily,
    modelHash: input.capability.modelHash,
    whisperCppVersion: input.whisperCppVersion,
    tokenTimestampsAvailable: input.tokenTimestampsAvailable ?? false,
    fullJsonAvailable: input.fullJsonAvailable ?? false,
    useVad: input.useVad ?? true,
    vadProfile: input.vadProfile ?? "sensitive-v2",
    ...(input.workerPool === undefined ? {} : { workerPool: input.workerPool }),
    ...(input.serverPath === undefined ? {} : { serverPath: input.serverPath }),
    timestampRuntimePolicy: input.timestampRuntimePolicy ?? "auto",
    rawVadPolicy: input.rawVadPolicy ?? "auto",
    ...(input.mvlResponseSchemaVersion === undefined
      ? {}
      : { mvlResponseSchemaVersion: input.mvlResponseSchemaVersion }),
    ...(input.expectedMvlRuntime === undefined
      ? {}
      : { expectedMvlRuntime: input.expectedMvlRuntime }),
  });
}

async function resolveLocalAdapter(
  options: ResolveTranscriptionAdapterOptions,
): Promise<TranscriptionAdapterResolution | null> {
  const environment = options.environment ?? process.env;
  const hardware = options.hardware ?? detectHardwareProfile();
  const recommendations = recommendWhisperCppModels({
    hardware,
    durationSeconds: options.durationSeconds,
    ...(options.language === undefined ? {} : { language: options.language }),
  });
  const executable = await resolveExecutable(
    options.whisperCppPath ?? environment.WHISPER_CPP_PATH ?? "whisper-cli",
    environment,
  );
  const model = await resolveModelPath({
    environment,
    recommendations,
    ...(options.localModelPath === undefined
      ? {}
      : { explicitPath: options.localModelPath }),
    ...(options.localModelDirectory === undefined
      ? {}
      : { explicitDirectory: options.localModelDirectory }),
  });
  if (executable === null || model === null) return null;
  const vadModel =
    options.useVad === false
      ? null
      : await resolveVadModelPath({
          environment,
          transcriptionModelPath: model,
          ...(options.vadModelPath === undefined
            ? {}
            : { explicitPath: options.vadModelPath }),
        });
  const memoryGiB = Math.round(hardware.totalMemoryBytes / GIBIBYTE);
  return {
    adapter: new WhisperCppTranscriptionAdapter({
      executablePath: executable,
      modelPath: model,
      ...(vadModel === null ? {} : { vadModelPath: vadModel }),
      runner: options.runner,
      threads: Math.min(8, Math.max(1, hardware.logicalCores - 2)),
      coreML: false,
    }),
    timestampStrategy: options.timestampStrategy ?? "segment",
    rationale: `Selected local whisper.cpp on ${hardware.cpuModel} (${memoryGiB} GiB) with ${path.basename(model)}${vadModel === null ? (options.useVad === false ? " with VAD disabled" : "") : ` and ${path.basename(vadModel)} VAD`} for a ${Math.round(options.durationSeconds / 60)} minute ${options.language ?? "auto-language"} video.`,
  };
}

export async function resolveTranscriptionAdapter(
  options: ResolveTranscriptionAdapterOptions,
): Promise<TranscriptionAdapterResolution> {
  const provider = options.provider ?? "auto";
  const environment = options.environment ?? process.env;
  if (provider !== "openai") {
    const local = await resolveLocalAdapter(options);
    if (local !== null) return local;
    if (provider === "whisper-cpp") {
      throw new AppError(
        "The requested whisper.cpp adapter is not configured.",
        {
          code: "MISSING_DEPENDENCY",
          exitCode: 4,
          details: {
            requiredExecutable: "whisper-cli",
            requiredEnvironment: [
              "WHISPER_CPP_PATH",
              "WHISPER_MODEL_PATH or WHISPER_MODEL_DIRECTORY",
            ],
          },
        },
      );
    }
  }
  if (
    provider === "openai" ||
    (environment.OPENAI_API_KEY !== undefined &&
      environment.OPENAI_API_KEY.trim() !== "")
  ) {
    return {
      adapter: new OpenAITranscriptionAdapter({
        ...(environment.OPENAI_API_KEY === undefined
          ? {}
          : { apiKey: environment.OPENAI_API_KEY }),
        ...(options.openAIModel === undefined
          ? {}
          : { model: options.openAIModel }),
      }),
      timestampStrategy: options.timestampStrategy ?? "chunk",
      rationale:
        provider === "openai"
          ? "Used the OpenAI adapter explicitly selected by the user."
          : "No configured local adapter was available; used the configured OpenAI fallback.",
    };
  }
  throw new AppError(
    "No usable transcription adapter is configured. Install whisper.cpp and a model, or explicitly configure OpenAI.",
    {
      code: "MISSING_DEPENDENCY",
      exitCode: 4,
      details: {
        local: {
          executable: "WHISPER_CPP_PATH",
          model: "WHISPER_MODEL_PATH or WHISPER_MODEL_DIRECTORY",
        },
        cloudFallback: "OPENAI_API_KEY",
      },
    },
  );
}

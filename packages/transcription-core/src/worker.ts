import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { performance } from "node:perf_hooks";

import {
  AppError,
  whisperExecutionMetricsSchema,
  type LanguageTag,
  type WhisperExecutionMetrics,
  type WhisperExecutionMode,
} from "@mvl/shared";

import type {
  TranscriptionChunkResult,
  TranscriptionRequest,
  WhisperVadProfile,
} from "./types.js";

export interface WhisperWorkerCapability {
  executablePath: string;
  modelPath: string;
  modelHash: string;
  whisperCppVersion: string;
  coreML: boolean;
  threads: number;
  language?: LanguageTag | undefined;
  vadModelPath?: string | undefined;
  useVad: boolean;
  vadProfile: WhisperVadProfile;
  tokenTimestamps: boolean;
  promptConstraint: string;
}

export interface WhisperWorkerRequest {
  requestId: string;
  request: TranscriptionRequest;
  capability: WhisperWorkerCapability;
  initialPrompt: string | null;
}

export interface WhisperWorker {
  readonly batchKey: string;
  readonly mode: "persistent" | "batch";
  readonly backend: "coreml" | "cpu";
  initialize(): Promise<void>;
  transcribe(request: WhisperWorkerRequest): Promise<TranscriptionChunkResult>;
  healthCheck(): Promise<boolean>;
  close(): Promise<void>;
  metrics(): {
    requestCount: number;
    warmupCount: number;
    initializationSeconds: number;
    modelLoadSeconds: number;
    coreMLWarmupSeconds: number;
    transcriptionSeconds: number;
    exitReason: string | null;
  };
}

export interface WhisperWorkerFactory {
  serverPathFor(executablePath: string): Promise<string | null>;
  create(input: {
    batchKey: string;
    mode: "persistent" | "batch";
    capability: WhisperWorkerCapability;
    serverPath: string;
  }): WhisperWorker;
}

interface VerboseJsonWord {
  word?: unknown;
  start?: unknown;
  end?: unknown;
  probability?: unknown;
}

interface VerboseJsonSegment {
  text?: unknown;
  start?: unknown;
  end?: unknown;
  avg_logprob?: unknown;
  no_speech_prob?: unknown;
  words?: unknown;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function clampWhisperSegmentInterval(input: {
  start: number;
  end: number;
  duration: number;
}): { start: number; end: number } | null {
  const start = Math.max(0, Math.min(input.duration, input.start));
  const end = Math.max(0, Math.min(input.duration, input.end));
  return end > start ? { start, end } : null;
}

function languageForWhisper(language: LanguageTag | undefined): string {
  if (language === undefined || language === "mixed" || language === "und") {
    return "auto";
  }
  return language.startsWith("zh") ? "zh" : language;
}

function vadParameters(profile: WhisperVadProfile): {
  threshold: string;
  minimumSpeechMs: string;
  minimumSilenceMs: string;
  maximumSpeechSeconds: string;
  speechPadMs: string;
  samplesOverlap: string;
} {
  return profile === "extra-sensitive-v1"
    ? {
        threshold: "0.25",
        minimumSpeechMs: "50",
        minimumSilenceMs: "100",
        maximumSpeechSeconds: "30",
        speechPadMs: "400",
        samplesOverlap: "0.35",
      }
    : {
        threshold: "0.35",
        minimumSpeechMs: "100",
        minimumSilenceMs: "150",
        maximumSpeechSeconds: "30",
        speechPadMs: "250",
        samplesOverlap: "0.25",
      };
}

function parseVerboseJson(
  value: unknown,
  request: WhisperWorkerRequest,
): TranscriptionChunkResult {
  if (typeof value !== "object" || value === null) {
    throw new Error("whisper-server returned a non-object JSON response.");
  }
  const response = value as { text?: unknown; segments?: unknown };
  const rawSegments = Array.isArray(response.segments) ? response.segments : [];
  const segments = rawSegments.flatMap((raw) => {
    if (typeof raw !== "object" || raw === null) return [];
    const segment = raw as VerboseJsonSegment;
    const text = typeof segment.text === "string" ? segment.text.trim() : "";
    const start = numberOrNull(segment.start);
    const end = numberOrNull(segment.end);
    if (text === "" || start === null || end === null || end <= start)
      return [];
    const interval = clampWhisperSegmentInterval({
      start,
      end,
      duration: request.request.chunk.duration,
    });
    if (interval === null) return [];
    const words = Array.isArray(segment.words) ? segment.words : [];
    const tokens = words.flatMap((rawWord) => {
      if (typeof rawWord !== "object" || rawWord === null) return [];
      const word = rawWord as VerboseJsonWord;
      const tokenStart = numberOrNull(word.start);
      const tokenEnd = numberOrNull(word.end);
      if (
        typeof word.word !== "string" ||
        tokenStart === null ||
        tokenEnd === null ||
        tokenEnd < tokenStart
      ) {
        return [];
      }
      const probability = numberOrNull(word.probability);
      return [
        {
          text: word.word,
          start: tokenStart,
          end: tokenEnd,
          probability:
            probability !== null && probability >= 0 && probability <= 1
              ? probability
              : null,
        },
      ];
    });
    return [
      {
        start: interval.start,
        end: interval.end,
        text,
        speaker: null,
        confidence: null,
        ...(tokens.length === 0 ? {} : { tokens }),
        metrics: {
          averageLogProbability: numberOrNull(segment.avg_logprob),
          noSpeechProbability: numberOrNull(segment.no_speech_prob),
          tokenProbability:
            tokens.length === 0 ||
            tokens.every((token) => token.probability === null)
              ? null
              : tokens.reduce(
                  (sum, token) => sum + (token.probability ?? 0),
                  0,
                ) / tokens.filter((token) => token.probability !== null).length,
          entropy: null,
          decoderFallback: null,
          detectedLanguage: null,
        },
      },
    ];
  });
  const text =
    typeof response.text === "string"
      ? response.text.trim()
      : segments.map((segment) => segment.text).join(" ");
  const chunkSegments =
    request.request.timestampStrategy === "chunk" && text !== ""
      ? [
          {
            start: 0,
            end: request.request.chunk.duration,
            text,
            speaker: null,
            confidence: null,
          },
        ]
      : segments;
  return {
    text,
    segments: chunkSegments,
    raw: {
      provider: "whisper-cpp",
      executionMode: "persistent",
      globalStartSeconds: request.request.chunk.start,
      tokenTimestampsRequested: request.request.tokenTimestamps === true,
      tokenTimestampsUsed: segments.some(
        (segment) => (segment.tokens?.length ?? 0) > 0,
      ),
      verboseJson: value,
    },
  };
}

function silentWarmupWav(): Buffer {
  const sampleRate = 16_000;
  const sampleCount = 1_600;
  const dataBytes = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}

async function availablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("Unable to allocate a local whisper-server port."));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error === undefined) resolve(port);
        else reject(error);
      });
    });
  });
}

async function waitForExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    child.once("exit", finish);
  });
}

function childIsRunning(
  child: ChildProcessWithoutNullStreams | null,
): child is ChildProcessWithoutNullStreams {
  return child?.exitCode === null && child.signalCode === null;
}

class WhisperCppServerWorker implements WhisperWorker {
  readonly batchKey: string;
  readonly mode: "persistent" | "batch";
  readonly backend: "coreml" | "cpu";
  readonly #capability: WhisperWorkerCapability;
  readonly #serverPath: string;
  #child: ChildProcessWithoutNullStreams | null = null;
  #baseUrl: string | null = null;
  #initializing: Promise<void> | null = null;
  #logs = "";
  #requestCount = 0;
  #warmupCount = 0;
  #initializationSeconds = 0;
  #modelLoadSeconds = 0;
  #coreMLWarmupSeconds = 0;
  #transcriptionSeconds = 0;
  #exitReason: string | null = null;

  constructor(input: {
    batchKey: string;
    mode: "persistent" | "batch";
    capability: WhisperWorkerCapability;
    serverPath: string;
  }) {
    this.batchKey = input.batchKey;
    this.mode = input.mode;
    this.#capability = input.capability;
    this.#serverPath = input.serverPath;
    this.backend = input.capability.coreML ? "coreml" : "cpu";
  }

  async initialize(): Promise<void> {
    if (this.#child !== null && (await this.healthCheck())) return;
    this.#initializing ??= this.#initializeOnce();
    try {
      await this.#initializing;
    } finally {
      this.#initializing = null;
    }
  }

  async #initializeOnce(): Promise<void> {
    const started = performance.now();
    const port = await availablePort();
    this.#baseUrl = `http://127.0.0.1:${port}`;
    const vad = vadParameters(this.#capability.vadProfile);
    const args = [
      "--model",
      this.#capability.modelPath,
      "--threads",
      String(this.#capability.threads),
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--language",
      "auto",
      "--suppress-nst",
      ...(this.#capability.vadModelPath === undefined
        ? []
        : [
            "--vad",
            "--vad-model",
            this.#capability.vadModelPath,
            "--vad-threshold",
            vad.threshold,
            "--vad-min-speech-duration-ms",
            vad.minimumSpeechMs,
            "--vad-min-silence-duration-ms",
            vad.minimumSilenceMs,
            "--vad-max-speech-duration-s",
            vad.maximumSpeechSeconds,
            "--vad-speech-pad-ms",
            vad.speechPadMs,
            "--vad-samples-overlap",
            vad.samplesOverlap,
          ]),
    ];
    const child = spawn(this.#serverPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.#child = child;
    const appendLogs = (chunk: Buffer): void => {
      const text = chunk.toString("utf8");
      this.#logs = `${this.#logs}${text}`.slice(-256_000);
      process.stderr.write(text);
    };
    child.stdout.on("data", appendLogs);
    child.stderr.on("data", appendLogs);
    child.once("exit", (code, signal) => {
      this.#exitReason = `exit=${String(code)} signal=${String(signal)}`;
    });
    const initializationTimeoutMs = this.#capability.coreML
      ? 30 * 60_000
      : 2 * 60_000;
    const deadline = Date.now() + initializationTimeoutMs;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(
          `whisper-server exited before becoming healthy (${this.#exitReason ?? "unknown"}).\n${this.#logs.slice(-4_000)}`,
        );
      }
      if (await this.healthCheck()) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!(await this.healthCheck())) {
      await this.close();
      throw new Error(
        `whisper-server did not become healthy within ${String(initializationTimeoutMs / 1000)}s.`,
      );
    }
    this.#modelLoadSeconds = (performance.now() - started) / 1000;
    if (this.#capability.coreML && !/Core ML model loaded/i.test(this.#logs)) {
      await this.close();
      throw new AppError(
        "The persistent whisper.cpp worker became healthy but did not emit Core ML model-load evidence.",
        {
          code: "COREML_RUNTIME_EVIDENCE_MISSING",
          exitCode: 4,
          details: { batchKey: this.batchKey },
        },
      );
    }
    const warmupStarted = performance.now();
    await this.#postInference({
      audio: silentWarmupWav(),
      filename: "coreml-warmup.wav",
      language: languageForWhisper(this.#capability.language),
      prompt: null,
      useVad: false,
      vadProfile: this.#capability.vadProfile,
      tokenTimestamps: false,
      timeoutMs: 120_000,
    });
    this.#warmupCount = 1;
    this.#coreMLWarmupSeconds = (performance.now() - warmupStarted) / 1000;
    if (this.#capability.coreML && !/COREML\s*=\s*1/iu.test(this.#logs)) {
      await this.close();
      throw new AppError(
        "The persistent worker loaded the Core ML encoder but warm-up did not report COREML = 1.",
        {
          code: "COREML_RUNTIME_EVIDENCE_MISSING",
          exitCode: 4,
          details: { batchKey: this.batchKey },
        },
      );
    }
    this.#initializationSeconds = (performance.now() - started) / 1000;
  }

  async #postInference(input: {
    audio: Buffer;
    filename: string;
    language: string;
    prompt: string | null;
    useVad: boolean;
    vadProfile: WhisperVadProfile;
    tokenTimestamps: boolean;
    timeoutMs: number;
  }): Promise<unknown> {
    if (this.#baseUrl === null) {
      throw new Error("whisper-server worker is not initialized.");
    }
    const form = new FormData();
    form.append(
      "file",
      new Blob([input.audio], { type: "audio/wav" }),
      input.filename,
    );
    form.append("response_format", "verbose_json");
    form.append("language", input.language);
    form.append("no_language_probabilities", "true");
    form.append("suppress_nst", "true");
    form.append("vad", input.useVad ? "true" : "false");
    form.append("token_timestamps", input.tokenTimestamps ? "true" : "false");
    if (input.tokenTimestamps) {
      form.append("max_len", "64");
      form.append("split_on_word", "true");
    }
    if (input.useVad) {
      const vad = vadParameters(input.vadProfile);
      form.append("vad_threshold", vad.threshold);
      form.append("vad_min_speech_duration_ms", vad.minimumSpeechMs);
      form.append("vad_min_silence_duration_ms", vad.minimumSilenceMs);
      form.append("vad_max_speech_duration_s", vad.maximumSpeechSeconds);
      form.append("vad_speech_pad_ms", vad.speechPadMs);
      form.append("vad_samples_overlap", vad.samplesOverlap);
    }
    if (input.prompt !== null) form.append("prompt", input.prompt);
    const response = await fetch(`${this.#baseUrl}/inference`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(input.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(
        `whisper-server inference failed (${response.status}): ${await response.text()}`,
      );
    }
    return (await response.json()) as unknown;
  }

  async transcribe(
    request: WhisperWorkerRequest,
  ): Promise<TranscriptionChunkResult> {
    await this.initialize();
    const started = performance.now();
    const audio = await readFile(request.request.audioPath);
    const response = await this.#postInference({
      audio,
      filename: path.basename(request.request.audioPath),
      language: languageForWhisper(request.request.language),
      prompt: request.initialPrompt,
      useVad: request.capability.useVad,
      vadProfile: request.capability.vadProfile,
      tokenTimestamps:
        request.request.tokenTimestamps === true &&
        request.capability.tokenTimestamps,
      timeoutMs: Math.max(
        5 * 60_000,
        Math.min(60 * 60_000, request.request.chunk.duration * 4_000),
      ),
    });
    this.#requestCount += 1;
    this.#transcriptionSeconds += (performance.now() - started) / 1000;
    return parseVerboseJson(response, request);
  }

  async healthCheck(): Promise<boolean> {
    if (this.#baseUrl === null) return false;
    try {
      const response = await fetch(`${this.#baseUrl}/health`, {
        signal: AbortSignal.timeout(500),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    const child = this.#child;
    this.#child = null;
    this.#baseUrl = null;
    if (!childIsRunning(child)) return;
    child.kill("SIGTERM");
    await waitForExit(child, 3_000);
    if (childIsRunning(child)) {
      child.kill("SIGKILL");
      await waitForExit(child, 1_000);
    }
  }

  metrics(): ReturnType<WhisperWorker["metrics"]> {
    return {
      requestCount: this.#requestCount,
      warmupCount: this.#warmupCount,
      initializationSeconds: this.#initializationSeconds,
      modelLoadSeconds: this.#modelLoadSeconds,
      coreMLWarmupSeconds: this.#coreMLWarmupSeconds,
      transcriptionSeconds: this.#transcriptionSeconds,
      exitReason: this.#exitReason,
    };
  }
}

export const defaultWhisperWorkerFactory: WhisperWorkerFactory = {
  async serverPathFor(executablePath) {
    const candidate = path.join(
      path.dirname(executablePath),
      process.platform === "win32" ? "whisper-server.exe" : "whisper-server",
    );
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      return null;
    }
  },
  create(input) {
    return new WhisperCppServerWorker(input);
  },
};

export function buildWorkerBatchKey(
  capability: WhisperWorkerCapability,
): string {
  const payload = JSON.stringify({
    modelHash: capability.modelHash,
    coreML: capability.coreML,
    executableVersion: capability.whisperCppVersion,
    language: languageForWhisper(capability.language),
    vadProfile:
      capability.vadModelPath === undefined
        ? "unavailable"
        : `dynamic:${path.basename(capability.vadModelPath)}:sensitive-v2`,
    timestampMode: "dynamic:segment+token",
    promptConstraints: capability.promptConstraint,
    threads: capability.threads,
  });
  return createHash("sha256").update(payload).digest("hex");
}

interface RequestMetric {
  requestId: string;
  batchKey: string;
  cacheHit: boolean;
  mode: "persistent" | "batch" | "process";
  status: "succeeded" | "failed" | "fallback-succeeded";
  retryCount: number;
  fallbackMode: "process" | null;
  durationSeconds: number;
  error: string | null;
}

export class WhisperCppWorkerPool {
  readonly requestedMode: WhisperExecutionMode;
  readonly #factory: WhisperWorkerFactory;
  readonly #workers = new Map<string, WhisperWorker>();
  readonly #allWorkers: WhisperWorker[] = [];
  readonly #requests: RequestMetric[] = [];
  readonly #backends = new Set<"coreml" | "cpu">();
  #fallbackProcessCount = 0;
  #fallbackReason: string | null = null;
  #cacheHitCount = 0;

  constructor(
    options: {
      mode?: WhisperExecutionMode | undefined;
      factory?: WhisperWorkerFactory | undefined;
    } = {},
  ) {
    this.requestedMode = options.mode ?? "auto";
    this.#factory = options.factory ?? defaultWhisperWorkerFactory;
  }

  recordCacheHits(count: number): void {
    this.#cacheHitCount += Math.max(0, Math.floor(count));
  }

  async transcribe(input: {
    request: TranscriptionRequest;
    capability: WhisperWorkerCapability;
    initialPrompt: string | null;
    processFallback: () => Promise<TranscriptionChunkResult>;
  }): Promise<TranscriptionChunkResult> {
    const requestId = `${input.request.chunk.id}-${randomUUID()}`;
    const batchKey = buildWorkerBatchKey(input.capability);
    this.#backends.add(input.capability.coreML ? "coreml" : "cpu");
    if (this.requestedMode === "process") {
      return await this.#runProcess({
        requestId,
        batchKey,
        processFallback: input.processFallback,
        fallback: false,
      });
    }
    const serverPath = await this.#factory.serverPathFor(
      input.capability.executablePath,
    );
    if (serverPath === null) {
      const message =
        "whisper-server is unavailable beside the configured whisper.cpp executable.";
      if (this.requestedMode === "persistent") {
        throw new AppError(message, {
          code: "MISSING_DEPENDENCY",
          exitCode: 4,
          details: {
            executablePath: input.capability.executablePath,
            requestedMode: this.requestedMode,
          },
        });
      }
      this.#fallbackReason ??= message;
      return await this.#runProcess({
        requestId,
        batchKey,
        processFallback: input.processFallback,
        fallback: true,
      });
    }
    const mode =
      this.requestedMode === "batch"
        ? ("batch" as const)
        : ("persistent" as const);
    let worker = this.#workers.get(batchKey);
    if (worker === undefined) {
      worker = this.#factory.create({
        batchKey,
        mode,
        capability: input.capability,
        serverPath,
      });
      this.#workers.set(batchKey, worker);
      this.#allWorkers.push(worker);
    }
    const started = performance.now();
    try {
      const result = await worker.transcribe({
        requestId,
        request: input.request,
        capability: input.capability,
        initialPrompt: input.initialPrompt,
      });
      this.#requests.push({
        requestId,
        batchKey,
        cacheHit: false,
        mode,
        status: "succeeded",
        retryCount: 0,
        fallbackMode: null,
        durationSeconds: (performance.now() - started) / 1000,
        error: null,
      });
      return result;
    } catch (firstError) {
      await worker.close();
      this.#workers.delete(batchKey);
      const retryWorker = this.#factory.create({
        batchKey,
        mode,
        capability: input.capability,
        serverPath,
      });
      this.#workers.set(batchKey, retryWorker);
      this.#allWorkers.push(retryWorker);
      try {
        const result = await retryWorker.transcribe({
          requestId,
          request: input.request,
          capability: input.capability,
          initialPrompt: input.initialPrompt,
        });
        this.#requests.push({
          requestId,
          batchKey,
          cacheHit: false,
          mode,
          status: "succeeded",
          retryCount: 1,
          fallbackMode: null,
          durationSeconds: (performance.now() - started) / 1000,
          error: null,
        });
        return result;
      } catch (retryError) {
        await retryWorker.close();
        this.#workers.delete(batchKey);
        const message = [
          firstError instanceof Error ? firstError.message : String(firstError),
          retryError instanceof Error ? retryError.message : String(retryError),
        ].join(" | retry: ");
        if (this.requestedMode === "persistent") {
          this.#requests.push({
            requestId,
            batchKey,
            cacheHit: false,
            mode,
            status: "failed",
            retryCount: 1,
            fallbackMode: null,
            durationSeconds: (performance.now() - started) / 1000,
            error: message,
          });
          throw new AppError(
            "The explicitly requested persistent whisper.cpp worker failed.",
            {
              code: "TRANSCRIPTION_FAILED",
              exitCode: 4,
              details: { requestId, batchKey, reason: message },
            },
          );
        }
        this.#fallbackReason ??= message;
        return await this.#runProcess({
          requestId,
          batchKey,
          processFallback: input.processFallback,
          fallback: true,
          retryCount: 1,
          priorError: message,
        });
      }
    }
  }

  async #runProcess(input: {
    requestId: string;
    batchKey: string;
    processFallback: () => Promise<TranscriptionChunkResult>;
    fallback: boolean;
    retryCount?: number | undefined;
    priorError?: string | undefined;
  }): Promise<TranscriptionChunkResult> {
    const started = performance.now();
    if (input.fallback) this.#fallbackProcessCount += 1;
    try {
      const result = await input.processFallback();
      this.#requests.push({
        requestId: input.requestId,
        batchKey: input.batchKey,
        cacheHit: false,
        mode: "process",
        status: input.fallback ? "fallback-succeeded" : "succeeded",
        retryCount: input.retryCount ?? 0,
        fallbackMode: input.fallback ? "process" : null,
        durationSeconds: (performance.now() - started) / 1000,
        error: input.priorError ?? null,
      });
      return result;
    } catch (error) {
      this.#requests.push({
        requestId: input.requestId,
        batchKey: input.batchKey,
        cacheHit: false,
        mode: "process",
        status: "failed",
        retryCount: input.retryCount ?? 0,
        fallbackMode: input.fallback ? "process" : null,
        durationSeconds: (performance.now() - started) / 1000,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  metrics(): WhisperExecutionMetrics {
    const workers = this.#allWorkers;
    const workerMetrics = workers.map((worker) => ({
      batchKey: worker.batchKey,
      mode: worker.mode,
      backend: worker.backend,
      ...worker.metrics(),
    }));
    const executionMode = this.#requests.some(
      (request) => request.mode === "persistent",
    )
      ? ("persistent" as const)
      : this.#requests.some((request) => request.mode === "batch")
        ? ("batch" as const)
        : ("process" as const);
    const backend =
      this.#backends.size > 1
        ? ("mixed" as const)
        : (this.#backends.values().next().value ?? "cpu");
    const processRequestCount = this.#requests.filter(
      (request) => request.mode === "process",
    ).length;
    return whisperExecutionMetricsSchema.parse({
      schemaVersion: "1.0.0",
      requestedMode: this.requestedMode,
      executionMode,
      backend,
      asrRequestCount: this.#requests.length,
      cacheHitCount: this.#cacheHitCount,
      workerStartCount: workerMetrics.length + processRequestCount,
      modelLoadCount: workerMetrics.length + processRequestCount,
      initializationSeconds: workerMetrics.reduce(
        (sum, worker) => sum + worker.initializationSeconds,
        0,
      ),
      modelLoadSeconds: workerMetrics.reduce(
        (sum, worker) => sum + worker.modelLoadSeconds,
        0,
      ),
      coreMLWarmupSeconds: workerMetrics.reduce(
        (sum, worker) => sum + worker.coreMLWarmupSeconds,
        0,
      ),
      transcriptionSeconds:
        workerMetrics.reduce(
          (sum, worker) => sum + worker.transcriptionSeconds,
          0,
        ) +
        this.#requests
          .filter((request) => request.mode === "process")
          .reduce((sum, request) => sum + request.durationSeconds, 0),
      totalWorkerSeconds: workerMetrics.reduce(
        (sum, worker) =>
          sum + worker.initializationSeconds + worker.transcriptionSeconds,
        0,
      ),
      fallbackProcessCount: this.#fallbackProcessCount,
      requests: this.#requests,
      workers: workerMetrics,
      fallbackReason: this.#fallbackReason,
    });
  }

  async close(): Promise<void> {
    await Promise.all(this.#allWorkers.map((worker) => worker.close()));
  }
}

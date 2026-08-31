import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { performance } from "node:perf_hooks";

import {
  AppError,
  mvlRequestStateIsolation,
  mvlWhisperPatchId,
  mvlWhisperServerCapabilitiesSchema,
  mvlWhisperServerResponseSchema,
  mvlWhisperResponseSchemaVersion,
  whisperExecutionMetricsSchema,
  type LanguageTag,
  type MvlWhisperServerCapabilities,
  type RawVadPolicy,
  type TimestampRuntimePolicy,
  type WhisperExecutionMetrics,
  type WhisperExecutionMode,
  type WorkerStateIsolationMode,
  type WorkerStateIsolationStrategy,
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
  serverPath?: string | undefined;
  timestampRuntimePolicy?: TimestampRuntimePolicy | undefined;
  rawVadPolicy?: RawVadPolicy | undefined;
  mvlResponseSchemaVersion?: string | undefined;
  expectedMvlRuntime?:
    | {
        upstreamCommit: string;
        patchId: string;
        patchSha256: string;
        binarySha256: string;
        buildFlagsHash: string;
      }
    | undefined;
}

export interface MvlCapabilityHandshakeEvaluation {
  verified: boolean;
  capability: MvlWhisperServerCapabilities | null;
  failures: string[];
}

export interface MvlRuntimeSelection {
  responseFormat: "verbose_json" | "mvl_verbose_json_v1";
  capability: MvlWhisperServerCapabilities | null;
  fallbackReason: string | null;
}

export function selectMvlRuntimeResponseFormat(input: {
  timestampRuntimePolicy: TimestampRuntimePolicy;
  rawVadPolicy: RawVadPolicy;
  evaluation: MvlCapabilityHandshakeEvaluation;
}): MvlRuntimeSelection {
  if (input.timestampRuntimePolicy === "legacy-safe") {
    if (input.rawVadPolicy === "required") {
      throw new AppError(
        "--raw-vad-policy required is incompatible with legacy-safe runtime selection.",
        { code: "TRANSCRIPTION_FAILED", exitCode: 4 },
      );
    }
    return {
      responseFormat: "verbose_json",
      capability: null,
      fallbackReason: "LEGACY_SAFE_POLICY",
    };
  }
  if (input.evaluation.verified) {
    if (input.evaluation.capability === null) {
      throw new Error(
        "Verified MVL capability evaluation returned no capability.",
      );
    }
    return {
      responseFormat: "mvl_verbose_json_v1",
      capability: input.evaluation.capability,
      fallbackReason: null,
    };
  }
  if (
    input.timestampRuntimePolicy === "require-mapped" ||
    input.rawVadPolicy === "required"
  ) {
    throw new AppError(
      "The explicitly required mapped-token whisper runtime failed its capability handshake.",
      {
        code: "TRANSCRIPTION_FAILED",
        exitCode: 4,
        details: { failures: input.evaluation.failures },
      },
    );
  }
  return {
    responseFormat: "verbose_json",
    capability: null,
    fallbackReason: input.evaluation.failures.join(","),
  };
}

export function evaluateMvlCapabilityHandshake(input: {
  rawCapabilities: unknown;
  expectedRuntime: WhisperWorkerCapability["expectedMvlRuntime"];
  actualBinarySha256: string | null;
  expectedResponseSchema?: string;
}): MvlCapabilityHandshakeEvaluation {
  const parsed = mvlWhisperServerCapabilitiesSchema.safeParse(
    input.rawCapabilities,
  );
  const expectedSchema =
    input.expectedResponseSchema ?? mvlWhisperResponseSchemaVersion;
  const failures: string[] = [];
  if (!parsed.success) failures.push("CAPABILITY_ENDPOINT_SCHEMA_INVALID");
  if (input.expectedRuntime === undefined) {
    failures.push("RUNTIME_MANIFEST_IDENTITY_MISSING");
  }
  if (parsed.success && input.expectedRuntime !== undefined) {
    if (parsed.data.upstream_commit !== input.expectedRuntime.upstreamCommit) {
      failures.push("UPSTREAM_COMMIT_MISMATCH");
    }
    if (parsed.data.patch_id !== input.expectedRuntime.patchId) {
      failures.push("PATCH_ID_MISMATCH");
    }
    if (parsed.data.patch_sha256 !== input.expectedRuntime.patchSha256) {
      failures.push("PATCH_SHA256_MISMATCH");
    }
    if (
      input.actualBinarySha256 === null ||
      input.actualBinarySha256 !== input.expectedRuntime.binarySha256
    ) {
      failures.push("BINARY_SHA256_MISMATCH");
    }
    if (!parsed.data.mapped_token_getter_available) {
      failures.push("MAPPED_TOKEN_GETTER_UNAVAILABLE");
    }
    if (!parsed.data.raw_vad_getter_available) {
      failures.push("RAW_VAD_GETTER_UNAVAILABLE");
    }
    if (
      input.expectedRuntime.patchId === mvlWhisperPatchId &&
      parsed.data.request_state_isolation !== mvlRequestStateIsolation
    ) {
      failures.push("REQUEST_STATE_ISOLATION_UNVERIFIED");
    }
    if (
      !parsed.data.supported_response_formats.includes("mvl_verbose_json_v1") ||
      expectedSchema !== mvlWhisperResponseSchemaVersion
    ) {
      failures.push("MVL_RESPONSE_SCHEMA_UNSUPPORTED");
    }
  }
  return {
    verified: failures.length === 0,
    capability: parsed.success ? parsed.data : null,
    failures: [...new Set(failures)].toSorted(),
  };
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
  /** Returns true only after request-local VAD/token state is proven cleared. */
  resetState?(): Promise<boolean>;
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
  readonly supportsVerifiedStateReset?: boolean;
  serverPathFor(
    executablePath: string,
    explicitServerPath?: string,
  ): Promise<string | null>;
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

function parseMvlVerboseJson(
  value: unknown,
  request: WhisperWorkerRequest,
  capabilityHandshake: MvlWhisperServerCapabilities,
): TranscriptionChunkResult {
  const response = mvlWhisperServerResponseSchema.parse(value);
  const expected = request.capability.expectedMvlRuntime;
  if (
    response.runtime.upstream_commit !== expected?.upstreamCommit ||
    response.runtime.patch_id !== expected.patchId ||
    response.runtime.patch_sha256 !== expected.patchSha256 ||
    response.runtime.response_schema !==
      (request.capability.mvlResponseSchemaVersion ??
        mvlWhisperResponseSchemaVersion)
  ) {
    throw new AppError(
      "Patched whisper-server inference identity did not match the verified runtime manifest.",
      {
        code: "TRANSCRIPTION_FAILED",
        exitCode: 4,
        details: {
          requestId: request.requestId,
          upstreamCommit: response.runtime.upstream_commit,
          patchId: response.runtime.patch_id,
          patchSha256: response.runtime.patch_sha256,
          responseSchema: response.runtime.response_schema,
        },
      },
    );
  }
  if (
    expected.patchId === mvlWhisperPatchId &&
    (capabilityHandshake.request_state_isolation !== mvlRequestStateIsolation ||
      response.runtime.capabilities.request_state_isolation !==
        mvlRequestStateIsolation)
  ) {
    throw new AppError(
      "The patched whisper-server response did not prove fresh per-request state isolation.",
      {
        code: "TRANSCRIPTION_FAILED",
        exitCode: 4,
        details: { requestId: request.requestId },
      },
    );
  }
  const lexicalTokenCount = response.transcription.reduce(
    (count, segment) =>
      count + segment.tokens.filter((token) => !token.special).length,
    0,
  );
  const mappedTokenCount = response.transcription.reduce(
    (count, segment) =>
      count +
      segment.tokens.filter((token) => !token.special && token.mapped !== null)
        .length,
    0,
  );
  if (
    request.capability.timestampRuntimePolicy === "require-mapped" &&
    request.request.tokenTimestamps === true &&
    lexicalTokenCount > 0 &&
    !response.runtime.capabilities.mapped_token_getter_used
  ) {
    throw new AppError(
      "The patched runtime declared mapped-token support but did not prove getter use for this inference.",
      {
        code: "TRANSCRIPTION_FAILED",
        exitCode: 4,
        details: {
          requestId: request.requestId,
          lexicalTokenCount,
          mappedTokenCount,
          mappedTokenGetterUsed:
            response.runtime.capabilities.mapped_token_getter_used,
          requestTokenTimestamps: request.request.tokenTimestamps,
          runtimeTokenTimestamps: response.request.token_timestamps,
          capabilityTokenTimestamps: request.capability.tokenTimestamps,
        },
      },
    );
  }
  if (
    request.capability.rawVadPolicy === "required" &&
    request.capability.useVad &&
    (!response.runtime.capabilities.raw_vad_getter_used ||
      (response.transcription.length > 0 && response.vad_segments.length === 0))
  ) {
    throw new AppError(
      "The patched runtime did not provide required raw VAD boundary evidence.",
      { code: "TRANSCRIPTION_FAILED", exitCode: 4 },
    );
  }
  const segments = response.transcription.flatMap((segment) => {
    const interval = clampWhisperSegmentInterval({
      start: segment.startSeconds,
      end: segment.endSeconds,
      duration: request.request.chunk.duration,
    });
    if (interval === null || segment.text.trim() === "") return [];
    const tokens = segment.tokens.flatMap((token) => {
      if (token.special || token.raw === null || token.mapped === null)
        return [];
      return [
        {
          text: token.text,
          start: token.mapped.startCentiseconds * 0.01,
          end: token.mapped.endCentiseconds * 0.01,
          probability: token.probability,
        },
      ];
    });
    return [
      {
        start: interval.start,
        end: interval.end,
        text: segment.text.trim(),
        speaker: null,
        confidence: null,
        ...(tokens.length === 0 ? {} : { tokens }),
        metrics: {
          averageLogProbability: segment.avgLogProbability,
          noSpeechProbability: segment.noSpeechProbability,
          tokenProbability:
            tokens.length === 0
              ? null
              : tokens.reduce((sum, token) => sum + token.probability, 0) /
                tokens.length,
          entropy: null,
          decoderFallback: null,
          detectedLanguage: null,
        },
      },
    ];
  });
  const text = response.text.trim();
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
      capabilityHandshake,
      runtimeBinarySha256: expected.binarySha256,
      buildFlagsHash: expected.buildFlagsHash,
      mvlResponse: response,
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
  #mvlCapabilities: MvlWhisperServerCapabilities | null = null;
  #responseFormat: "verbose_json" | "mvl_verbose_json_v1" = "verbose_json";

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
    await this.#negotiateRuntimeCapability();
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

  async #negotiateRuntimeCapability(): Promise<void> {
    if (this.#baseUrl === null) {
      throw new Error("whisper-server worker is not initialized.");
    }
    const policy = this.#capability.timestampRuntimePolicy ?? "auto";
    if (policy === "legacy-safe") {
      const selection = selectMvlRuntimeResponseFormat({
        timestampRuntimePolicy: policy,
        rawVadPolicy: this.#capability.rawVadPolicy ?? "auto",
        evaluation: {
          verified: false,
          capability: null,
          failures: ["CAPABILITY_PROBE_SKIPPED_BY_LEGACY_SAFE_POLICY"],
        },
      });
      this.#responseFormat = selection.responseFormat;
      return;
    }
    let rawCapabilities: unknown = null;
    try {
      const response = await fetch(`${this.#baseUrl}/mvl/capabilities`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) rawCapabilities = (await response.json()) as unknown;
    } catch {
      rawCapabilities = null;
    }
    const actualBinarySha256 = await readFile(this.#serverPath)
      .then((binary) => createHash("sha256").update(binary).digest("hex"))
      .catch(() => null);
    const evaluation = evaluateMvlCapabilityHandshake({
      rawCapabilities,
      expectedRuntime: this.#capability.expectedMvlRuntime,
      actualBinarySha256,
      ...(this.#capability.mvlResponseSchemaVersion === undefined
        ? {}
        : {
            expectedResponseSchema: this.#capability.mvlResponseSchemaVersion,
          }),
    });
    const selection = selectMvlRuntimeResponseFormat({
      timestampRuntimePolicy: policy,
      rawVadPolicy: this.#capability.rawVadPolicy ?? "auto",
      evaluation,
    });
    this.#mvlCapabilities = selection.capability;
    this.#responseFormat = selection.responseFormat;
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
    form.append("response_format", this.#responseFormat);
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
    if (this.#responseFormat === "mvl_verbose_json_v1") {
      if (this.#mvlCapabilities === null) {
        throw new Error(
          "MVL response selected without a verified capability handshake.",
        );
      }
      return parseMvlVerboseJson(response, request, this.#mvlCapabilities);
    }
    return parseVerboseJson(response, request);
  }

  async resetState(): Promise<boolean> {
    await this.initialize();
    return (
      this.#mvlCapabilities?.request_state_isolation ===
      mvlRequestStateIsolation
    );
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
  supportsVerifiedStateReset: true,
  async serverPathFor(executablePath, explicitServerPath) {
    if (explicitServerPath !== undefined) {
      const explicit = path.resolve(explicitServerPath);
      try {
        await access(explicit, constants.X_OK);
        return explicit;
      } catch {
        return null;
      }
    }
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
    serverBinarySha256: capability.expectedMvlRuntime?.binarySha256 ?? null,
    upstreamCommit: capability.expectedMvlRuntime?.upstreamCommit ?? null,
    patchSha256: capability.expectedMvlRuntime?.patchSha256 ?? null,
    responseSchema:
      capability.mvlResponseSchemaVersion ?? "legacy-verbose-json",
    timestampRuntimePolicy: capability.timestampRuntimePolicy ?? "auto",
    rawVadPolicy: capability.rawVadPolicy ?? "auto",
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
  vadMode: "vad" | "no-vad";
  profile: string;
  workerId: string | null;
  contextGeneration: number | null;
  stateIsolationAction:
    "none" | "reset" | "restart" | "segregated-route" | "process";
}

interface ManagedWorkerState {
  workerId: string;
  contextGeneration: number;
  runtimeIdentityHash: string;
  currentStateClass: "pristine" | "no-vad" | "vad" | "vad-after-no-vad";
  hasProcessedVadRequest: boolean;
  hasProcessedNoVadRequest: boolean;
  lastRequestVadMode: "vad" | "no-vad" | null;
  lastProfile: string | null;
  requestCount: number;
  stateIsolationStrategy: WorkerStateIsolationStrategy;
  stateResetCount: number;
  unsafeTransitionCount: number;
  restartCount: number;
}

interface RequestOrderMetric {
  sequence: number;
  requestKey: string;
  vadMode: "vad" | "no-vad";
  profile: string;
  cacheHit: boolean;
  workerId: string | null;
  contextGeneration: number | null;
  isolationAction:
    "none" | "reset" | "restart" | "segregated-route" | "process" | "cache-hit";
}

function requestVadMode(capability: WhisperWorkerCapability): "vad" | "no-vad" {
  return capability.useVad ? "vad" : "no-vad";
}

function requestProfile(capability: WhisperWorkerCapability): string {
  if (!capability.useVad) return "no-vad";
  return capability.vadProfile === "extra-sensitive-v1"
    ? "extra-sensitive-vad"
    : "current-sensitive-vad";
}

export class WhisperCppWorkerPool {
  readonly requestedMode: WhisperExecutionMode;
  readonly requestedStateIsolation: WorkerStateIsolationMode;
  readonly stateIsolationStrategy: WorkerStateIsolationStrategy;
  readonly #factory: WhisperWorkerFactory;
  readonly #retryOnFailure: boolean;
  readonly #workers = new Map<string, WhisperWorker>();
  readonly #allWorkers: WhisperWorker[] = [];
  readonly #workerStates = new Map<WhisperWorker, ManagedWorkerState>();
  readonly #generationByRuntime = new Map<string, number>();
  readonly #requests: RequestMetric[] = [];
  readonly #requestOrderPlan: RequestOrderMetric[] = [];
  readonly #backends = new Set<"coreml" | "cpu">();
  #fallbackProcessCount = 0;
  #fallbackReason: string | null = null;
  #cacheHitCount = 0;
  #unsafeTransitionCount = 0;
  #preventedUnsafeTransitionCount = 0;
  #workerRestartCount = 0;
  #workerStateResetCount = 0;

  constructor(
    options: {
      mode?: WhisperExecutionMode | undefined;
      factory?: WhisperWorkerFactory | undefined;
      stateIsolation?: WorkerStateIsolationMode | undefined;
      /** Bounded-evidence jobs account for every dispatch; other callers keep
       * the established retry behavior unless they explicitly opt out. */
      retryOnFailure?: boolean | undefined;
    } = {},
  ) {
    this.#factory = options.factory ?? defaultWhisperWorkerFactory;
    this.#retryOnFailure = options.retryOnFailure ?? true;
    this.requestedMode = options.mode ?? "auto";
    this.requestedStateIsolation = options.stateIsolation ?? "require-safe";
    this.stateIsolationStrategy =
      this.requestedStateIsolation === "segregated"
        ? "mode-segregated-workers"
        : this.requestedStateIsolation !== "restart-on-transition" &&
            this.#factory.supportsVerifiedStateReset === true
          ? "verified-per-request-reset"
          : "restart-on-vad-to-no-vad";
  }

  recordCacheHits(count: number): void {
    this.#cacheHitCount += Math.max(0, Math.floor(count));
  }

  recordCacheHit(input: {
    requestKey: string;
    useVad: boolean;
    profile: string;
  }): void {
    this.#cacheHitCount += 1;
    this.#requestOrderPlan.push({
      sequence: this.#requestOrderPlan.length,
      requestKey: input.requestKey,
      vadMode: input.useVad ? "vad" : "no-vad",
      profile: input.profile,
      cacheHit: true,
      workerId: null,
      contextGeneration: null,
      isolationAction: "cache-hit",
    });
  }

  #createWorker(input: {
    routeKey: string;
    runtimeIdentityHash: string;
    mode: "persistent" | "batch";
    capability: WhisperWorkerCapability;
    serverPath: string;
  }): WhisperWorker {
    const generation =
      (this.#generationByRuntime.get(input.runtimeIdentityHash) ?? 0) + 1;
    this.#generationByRuntime.set(input.runtimeIdentityHash, generation);
    const worker = this.#factory.create({
      batchKey: input.routeKey,
      mode: input.mode,
      capability: input.capability,
      serverPath: input.serverPath,
    });
    this.#workers.set(input.routeKey, worker);
    this.#allWorkers.push(worker);
    this.#workerStates.set(worker, {
      workerId: `whisper-worker-${randomUUID()}`,
      contextGeneration: generation,
      runtimeIdentityHash: input.runtimeIdentityHash,
      currentStateClass: "pristine",
      hasProcessedVadRequest: false,
      hasProcessedNoVadRequest: false,
      lastRequestVadMode: null,
      lastProfile: null,
      requestCount: 0,
      stateIsolationStrategy: this.stateIsolationStrategy,
      stateResetCount: 0,
      unsafeTransitionCount: 0,
      restartCount: 0,
    });
    return worker;
  }

  #recordSuccessfulState(
    state: ManagedWorkerState,
    vadMode: "vad" | "no-vad",
    profile: string,
  ): void {
    state.requestCount += 1;
    state.lastRequestVadMode = vadMode;
    state.lastProfile = profile;
    if (vadMode === "vad") {
      state.hasProcessedVadRequest = true;
      state.currentStateClass = state.hasProcessedNoVadRequest
        ? "vad-after-no-vad"
        : "vad";
    } else {
      state.hasProcessedNoVadRequest = true;
      state.currentStateClass = "no-vad";
    }
  }

  async transcribe(input: {
    request: TranscriptionRequest;
    capability: WhisperWorkerCapability;
    initialPrompt: string | null;
    processFallback: () => Promise<TranscriptionChunkResult>;
  }): Promise<TranscriptionChunkResult> {
    const requestId = `${input.request.chunk.id}-${randomUUID()}`;
    const batchKey = buildWorkerBatchKey(input.capability);
    const vadMode = requestVadMode(input.capability);
    const profile = requestProfile(input.capability);
    const requestKey = `${input.request.chunk.id}:${profile}`;
    this.#backends.add(input.capability.coreML ? "coreml" : "cpu");
    if (this.requestedMode === "process") {
      return await this.#runProcess({
        requestId,
        batchKey,
        requestKey,
        vadMode,
        profile,
        processFallback: input.processFallback,
        fallback: false,
      });
    }
    const serverPath = await this.#factory.serverPathFor(
      input.capability.executablePath,
      input.capability.serverPath,
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
        requestKey,
        vadMode,
        profile,
        processFallback: input.processFallback,
        fallback: true,
      });
    }
    const mode =
      this.requestedMode === "batch"
        ? ("batch" as const)
        : ("persistent" as const);
    const routeKey =
      this.stateIsolationStrategy === "mode-segregated-workers"
        ? `${batchKey}:${vadMode}`
        : batchKey;
    let isolationAction: RequestMetric["stateIsolationAction"] =
      this.stateIsolationStrategy === "mode-segregated-workers"
        ? "segregated-route"
        : "none";
    let worker = this.#workers.get(routeKey);
    worker ??= this.#createWorker({
      routeKey,
      runtimeIdentityHash: batchKey,
      mode,
      capability: input.capability,
      serverPath,
    });
    let state = this.#workerStates.get(worker);
    if (state === undefined) {
      throw new Error("Managed whisper worker state is unavailable.");
    }
    if (this.stateIsolationStrategy === "verified-per-request-reset") {
      const preventsUnsafeTransition =
        vadMode === "no-vad" && state.hasProcessedVadRequest;
      if (preventsUnsafeTransition) {
        this.#unsafeTransitionCount += 1;
        this.#preventedUnsafeTransitionCount += 1;
        state.unsafeTransitionCount += 1;
      }
      let resetSucceeded = false;
      let resetFailure: string | null = null;
      try {
        resetSucceeded =
          worker.resetState === undefined ? false : await worker.resetState();
      } catch (error) {
        resetFailure = error instanceof Error ? error.message : String(error);
      }
      if (!resetSucceeded) {
        await worker.close();
        this.#workers.delete(routeKey);
        throw new AppError(
          "The whisper worker did not prove fresh request-local state; the request was not executed.",
          {
            code: "TRANSCRIPTION_FAILED",
            exitCode: 4,
            details: {
              workerId: state.workerId,
              contextGeneration: state.contextGeneration,
              transition: preventsUnsafeTransition
                ? "vad-to-no-vad"
                : "per-request-isolation",
              resetFailure,
            },
          },
        );
      }
      this.#workerStateResetCount += 1;
      state.stateResetCount += 1;
      state.currentStateClass = "pristine";
      state.hasProcessedVadRequest = false;
      state.hasProcessedNoVadRequest = false;
      state.lastRequestVadMode = null;
      state.lastProfile = null;
      isolationAction = "reset";
    }
    if (
      this.stateIsolationStrategy === "restart-on-vad-to-no-vad" &&
      vadMode === "no-vad" &&
      state.hasProcessedVadRequest
    ) {
      this.#unsafeTransitionCount += 1;
      this.#preventedUnsafeTransitionCount += 1;
      this.#workerRestartCount += 1;
      state.unsafeTransitionCount += 1;
      state.restartCount += 1;
      await worker.close();
      this.#workers.delete(routeKey);
      worker = this.#createWorker({
        routeKey,
        runtimeIdentityHash: batchKey,
        mode,
        capability: input.capability,
        serverPath,
      });
      state = this.#workerStates.get(worker);
      if (state === undefined) {
        throw new Error("Restarted whisper worker state is unavailable.");
      }
      isolationAction = "restart";
    }
    const orderMetric: RequestOrderMetric = {
      sequence: this.#requestOrderPlan.length,
      requestKey,
      vadMode,
      profile,
      cacheHit: false,
      workerId: state.workerId,
      contextGeneration: state.contextGeneration,
      isolationAction,
    };
    this.#requestOrderPlan.push(orderMetric);
    const started = performance.now();
    try {
      const result = await worker.transcribe({
        requestId,
        request: input.request,
        capability: input.capability,
        initialPrompt: input.initialPrompt,
      });
      this.#recordSuccessfulState(state, vadMode, profile);
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
        vadMode,
        profile,
        workerId: state.workerId,
        contextGeneration: state.contextGeneration,
        stateIsolationAction: isolationAction,
      });
      return result;
    } catch (firstError) {
      if (!this.#retryOnFailure) {
        await worker.close();
        this.#workers.delete(routeKey);
        this.#requests.push({
          requestId,
          batchKey,
          cacheHit: false,
          mode,
          status: "failed",
          retryCount: 0,
          fallbackMode: null,
          durationSeconds: (performance.now() - started) / 1000,
          error:
            firstError instanceof Error
              ? firstError.message
              : String(firstError),
          vadMode,
          profile,
          workerId: state.workerId,
          contextGeneration: state.contextGeneration,
          stateIsolationAction: isolationAction,
        });
        throw new AppError(
          "Whisper request failed; retry explicitly disabled.",
          {
            code: "TRANSCRIPTION_FAILED",
            exitCode: 4,
            details: { requestId, retryCount: 0, reason: String(firstError) },
          },
        );
      }
      state.restartCount += 1;
      this.#workerRestartCount += 1;
      await worker.close();
      this.#workers.delete(routeKey);
      const retryWorker = this.#createWorker({
        routeKey,
        runtimeIdentityHash: batchKey,
        mode,
        capability: input.capability,
        serverPath,
      });
      const retryState = this.#workerStates.get(retryWorker);
      if (retryState === undefined) {
        throw new Error("Retry whisper worker state is unavailable.", {
          cause: firstError,
        });
      }
      orderMetric.workerId = retryState.workerId;
      orderMetric.contextGeneration = retryState.contextGeneration;
      orderMetric.isolationAction = "restart";
      try {
        const result = await retryWorker.transcribe({
          requestId,
          request: input.request,
          capability: input.capability,
          initialPrompt: input.initialPrompt,
        });
        this.#recordSuccessfulState(retryState, vadMode, profile);
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
          vadMode,
          profile,
          workerId: retryState.workerId,
          contextGeneration: retryState.contextGeneration,
          stateIsolationAction: "restart",
        });
        return result;
      } catch (retryError) {
        await retryWorker.close();
        this.#workers.delete(routeKey);
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
            vadMode,
            profile,
            workerId: retryState.workerId,
            contextGeneration: retryState.contextGeneration,
            stateIsolationAction: "restart",
          });
          throw new AppError(
            "The explicitly requested persistent whisper.cpp worker failed.",
            {
              code: "TRANSCRIPTION_FAILED",
              exitCode: 4,
              details: {
                requestId,
                batchKey,
                reason: message,
                firstFailure:
                  firstError instanceof AppError
                    ? {
                        code: firstError.code,
                        details: firstError.details,
                      }
                    : null,
                retryFailure:
                  retryError instanceof AppError
                    ? {
                        code: retryError.code,
                        details: retryError.details,
                      }
                    : null,
              },
              cause: retryError,
            },
          );
        }
        this.#fallbackReason ??= message;
        return await this.#runProcess({
          requestId,
          batchKey,
          requestKey,
          vadMode,
          profile,
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
    requestKey: string;
    vadMode: "vad" | "no-vad";
    profile: string;
    processFallback: () => Promise<TranscriptionChunkResult>;
    fallback: boolean;
    retryCount?: number | undefined;
    priorError?: string | undefined;
  }): Promise<TranscriptionChunkResult> {
    const started = performance.now();
    if (input.fallback) this.#fallbackProcessCount += 1;
    if (
      !this.#requestOrderPlan.some(
        (request) => request.requestKey === input.requestKey,
      )
    ) {
      this.#requestOrderPlan.push({
        sequence: this.#requestOrderPlan.length,
        requestKey: input.requestKey,
        vadMode: input.vadMode,
        profile: input.profile,
        cacheHit: false,
        workerId: null,
        contextGeneration: null,
        isolationAction: "process",
      });
    }
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
        vadMode: input.vadMode,
        profile: input.profile,
        workerId: null,
        contextGeneration: null,
        stateIsolationAction: "process",
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
        vadMode: input.vadMode,
        profile: input.profile,
        workerId: null,
        contextGeneration: null,
        stateIsolationAction: "process",
      });
      throw error;
    }
  }

  metrics(): WhisperExecutionMetrics {
    const workers = this.#allWorkers;
    const workerMetrics = workers.map((worker) => {
      const state = this.#workerStates.get(worker);
      if (state === undefined) {
        throw new Error("Managed whisper worker metrics state is unavailable.");
      }
      return {
        batchKey: worker.batchKey,
        mode: worker.mode,
        backend: worker.backend,
        ...worker.metrics(),
        workerId: state.workerId,
        contextGeneration: state.contextGeneration,
        runtimeIdentityHash: state.runtimeIdentityHash,
        currentStateClass: state.currentStateClass,
        hasProcessedVadRequest: state.hasProcessedVadRequest,
        hasProcessedNoVadRequest: state.hasProcessedNoVadRequest,
        lastRequestVadMode: state.lastRequestVadMode,
        lastProfile: state.lastProfile,
        stateIsolationStrategy: state.stateIsolationStrategy,
        stateResetCount: state.stateResetCount,
        unsafeTransitionCount: state.unsafeTransitionCount,
        restartCount: state.restartCount,
      };
    });
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
      requestStateIsolationStrategy: this.stateIsolationStrategy,
      requestOrderPlan: this.#requestOrderPlan,
      requestOrderHash: createHash("sha256")
        .update(
          JSON.stringify(
            this.#requestOrderPlan.map((request) => ({
              requestKey: request.requestKey,
              vadMode: request.vadMode,
              profile: request.profile,
            })),
          ),
        )
        .digest("hex"),
      unsafeTransitionCount: this.#unsafeTransitionCount,
      unsafeWorkerTransitionCount: 0,
      preventedUnsafeTransitionCount: this.#preventedUnsafeTransitionCount,
      preventedUnsafeWorkerTransitionCount:
        this.#preventedUnsafeTransitionCount,
      workerRestartCount: this.#workerRestartCount,
      workerStateResetCount: this.#workerStateResetCount,
      modeSegregatedWorkerCount:
        this.stateIsolationStrategy === "mode-segregated-workers"
          ? workerMetrics.length
          : 0,
      requestOrderIndependencePassed: null,
      cleanProcessParityPassed: null,
      requests: this.#requests,
      workers: workerMetrics,
      fallbackReason: this.#fallbackReason,
    });
  }

  async close(): Promise<void> {
    await Promise.all(this.#allWorkers.map((worker) => worker.close()));
  }
}

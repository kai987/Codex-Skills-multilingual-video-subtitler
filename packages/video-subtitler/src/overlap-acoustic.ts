import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import {
  AppError,
  InputError,
  atomicWriteJson,
  overlapAcousticComponentSchema,
  mvlWhisperCapabilitySchemaVersion,
  mvlWhisperPatchId,
  mvlWhisperResponseSchemaVersion,
  mvlWhisperServerCapabilitiesSchema,
  mvlWhisperServerResponseSchema,
  whisperRuntimeBuildManifestSchema,
  whisperRuntimeCapabilityArtifactSchema,
  type Logger,
  type OverlapAcousticAttempt,
  type OverlapAcousticProfile,
  type OverlapAcousticResolutionMode,
  type ProcessRunner,
  type SourceFingerprint,
  type SubtitleCue,
  type SubtitleOverlapAcousticResolution,
  type SubtitleTimestampEvidenceIntegrity,
  type TimestampAttemptIntegrity,
  type TimestampEvidenceIntegrityMode,
  type TimestampRuntimeCapability,
  type TokenTimestampPolicy,
  type LegacyOverlapCachePolicy,
  type MvlWhisperServerCapabilities,
  type RawVadPolicy,
  type TimestampRuntimePolicy,
  type WhisperRuntimeBuildManifest,
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
  buildTimestampEvidenceIntegrityArtifact,
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
  auditTimestampEvidenceAttempt,
  TIMESTAMP_MAPPING_VERSION,
  TOKEN_HEALTH_POLICY_VERSION,
  RAW_VAD_POLICY_VERSION,
  timestampIntegrityHash,
  evaluateTimestampEvidenceIntegrityGate,
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
  whisperServerPath?: string;
  timestampRuntimePolicy?: TimestampRuntimePolicy;
  rawVadPolicy?: RawVadPolicy;
  runtimeCapabilityManifestPath?: string;
  mvlResponseSchemaVersion?: string;
  localModelPath?: string;
  localModelDirectory?: string;
  vadModelPath?: string;
  coreML?: OverlapCoreMLMode;
  whisperExecutionMode?: WhisperExecutionMode;
  asrCacheDirectory?: string;
  asrCacheImportPaths?: readonly string[];
  asrCacheMode?: AsrCacheMode;
  timestampEvidenceIntegrity?: TimestampEvidenceIntegrityMode;
  tokenTimestampPolicy?: TokenTimestampPolicy;
  legacyOverlapCachePolicy?: LegacyOverlapCachePolicy;
}

export interface TargetedOverlapAcousticResult {
  artifact: SubtitleOverlapAcousticResolution;
  timestampIntegrity: SubtitleTimestampEvidenceIntegrity | null;
  executionMetrics: WhisperExecutionMetrics;
  audioStreamIndex: number;
  dependencyFailure: string | null;
  wallClockSeconds: number;
  outputPaths: {
    resolution: string;
    executionMetrics: string;
    cacheManifest: string;
    timestampIntegrity: string;
    runtimeCapability: string;
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
  timestampCapability: TimestampRuntimeCapability;
  serverPath: string;
  runtimeType: "stock" | "mvl-patched" | "legacy-system";
  buildManifest: WhisperRuntimeBuildManifest | null;
  expectedMvlRuntime: {
    upstreamCommit: string;
    patchId: string;
    patchSha256: string;
    binarySha256: string;
    buildFlagsHash: string;
  } | null;
  responseSchemaVersion: string;
  capabilityEndpointResponse: MvlWhisperServerCapabilities | null;
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
  whisperServerPath?: string;
  timestampRuntimePolicy: TimestampRuntimePolicy;
  rawVadPolicy: RawVadPolicy;
  runtimeCapabilityManifestPath?: string;
  mvlResponseSchemaVersion: string;
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
  const explicitServerPath =
    input.whisperServerPath === undefined
      ? null
      : await resolveExecutablePath(input.whisperServerPath);
  if (input.whisperServerPath !== undefined && explicitServerPath === null) {
    throw new InputError(
      `Configured whisper-server is unavailable or not executable: ${path.resolve(input.whisperServerPath)}`,
    );
  }
  if (input.mvlResponseSchemaVersion !== mvlWhisperResponseSchemaVersion) {
    throw new InputError(
      `Unsupported MVL whisper response schema: ${input.mvlResponseSchemaVersion}`,
    );
  }
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
  const derivedServerPath = path.join(
    path.dirname(executablePath),
    process.platform === "win32" ? "whisper-server.exe" : "whisper-server",
  );
  const serverPath =
    explicitServerPath ??
    ((await isFile(derivedServerPath)) ? derivedServerPath : executablePath);
  const runtimeBinaryPath = serverPath;
  const runtimeBinarySha256 = await sha256LocalFile(runtimeBinaryPath);
  const buildManifest =
    input.runtimeCapabilityManifestPath === undefined
      ? null
      : whisperRuntimeBuildManifestSchema.parse(
          JSON.parse(
            await readFile(
              path.resolve(input.runtimeCapabilityManifestPath),
              "utf8",
            ),
          ) as unknown,
        );
  const runtimeType =
    buildManifest === null
      ? "legacy-system"
      : runtimeBinarySha256 === buildManifest.patched.binarySha256
        ? "mvl-patched"
        : runtimeBinarySha256 === buildManifest.stock.binarySha256
          ? "stock"
          : null;
  if (runtimeType === null) {
    throw new InputError(
      "Configured whisper-server binary SHA-256 does not match the runtime build manifest.",
    );
  }
  if (
    input.timestampRuntimePolicy === "require-mapped" &&
    runtimeType !== "mvl-patched"
  ) {
    throw new AppError(
      "--timestamp-runtime-policy require-mapped requires a patched server and matching build manifest.",
      { code: "MISSING_DEPENDENCY", exitCode: 4 },
    );
  }
  if (input.rawVadPolicy === "required" && runtimeType !== "mvl-patched") {
    throw new AppError(
      "--raw-vad-policy required requires the verified patched whisper runtime.",
      { code: "MISSING_DEPENDENCY", exitCode: 4 },
    );
  }
  const expectedMvlRuntime =
    runtimeType === "mvl-patched" && buildManifest !== null
      ? {
          upstreamCommit: buildManifest.upstream.commit,
          patchId: buildManifest.patch.patchId,
          patchSha256: buildManifest.patch.patchSha256,
          binarySha256: buildManifest.patched.binarySha256,
          buildFlagsHash: buildManifest.build.flagsHash,
        }
      : null;
  const tokenTimestampControlAvailable =
    /--output-json-full\b/u.test(help) && /--max-len\b/u.test(help);
  const capabilityEvidence = [
    `whisper.cpp:${runtimeType === "mvl-patched" ? "1.9.3" : whisperCppVersion}`,
    `server-response:${runtimeType === "mvl-patched" ? input.mvlResponseSchemaVersion : "verbose_json"}`,
    tokenTimestampControlAvailable
      ? "token-timestamp-control:available"
      : "token-timestamp-control:unavailable",
    runtimeType === "mvl-patched"
      ? "mapped-token-getter:declared-by-pinned-runtime-manifest"
      : "mapped-token-getter:not-exposed-by-server-json",
    runtimeType === "mvl-patched"
      ? "raw-vad-intervals:declared-by-pinned-runtime-manifest"
      : "raw-vad-intervals:not-exposed-by-server-json",
  ];
  const capabilityPayload = {
    whisperCppVersion:
      runtimeType === "mvl-patched" ? "1.9.3" : whisperCppVersion,
    runtimeBinaryPathRecordedAsBasenameOnly: path.basename(runtimeBinaryPath),
    runtimeBinarySha256,
    runtimeSourceCommit: buildManifest?.upstream.commit ?? null,
    serverResponseFormat:
      runtimeType === "mvl-patched"
        ? input.mvlResponseSchemaVersion
        : "verbose_json",
    mappedTokenGetterAvailable: runtimeType === "mvl-patched",
    mappedTokenGetterActuallyUsed: false,
    rawVadGetterAvailable: runtimeType === "mvl-patched",
    rawVadGetterActuallyUsed: false,
    tokenTimestampControlAvailable,
    timestampCapabilityProbeMethod:
      runtimeType === "mvl-patched"
        ? "pinned-build-manifest-plus-required-live-handshake-v1"
        : "local-binary-help-version-and-observed-server-json-v1",
    timestampCapabilityStatus:
      runtimeType === "mvl-patched"
        ? ("unverified" as const)
        : tokenTimestampControlAvailable
          ? ("legacy-vad-unmapped" as const)
          : ("token-timestamps-unavailable" as const),
    evidence: capabilityEvidence,
  };
  const expectedCapabilityEndpoint =
    runtimeType === "mvl-patched" && buildManifest !== null
      ? mvlWhisperServerCapabilitiesSchema.parse({
          schema_version: mvlWhisperCapabilitySchemaVersion,
          whisper_cpp_version: "1.9.3",
          upstream_commit: buildManifest.upstream.commit,
          patch_id: mvlWhisperPatchId,
          patch_sha256: buildManifest.patch.patchSha256,
          mapped_token_getter_available: true,
          raw_vad_getter_available: true,
          supported_response_formats: [
            "json",
            "text",
            "srt",
            "verbose_json",
            "vtt",
            "mvl_verbose_json_v1",
          ],
          time_units: ["centiseconds", "seconds"],
          coordinate_system_contract: {
            segment: "original-audio-local",
            token_raw_with_vad: "vad-processed-local",
            token_raw_without_vad: "original-audio-local",
            token_mapped: "original-audio-local",
            raw_vad: "original-audio-local",
          },
        })
      : null;
  const timestampCapability: TimestampRuntimeCapability = {
    ...capabilityPayload,
    runtimeTimestampCapabilityHash: timestampIntegrityHash(
      expectedCapabilityEndpoint ?? capabilityPayload,
    ),
  };
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
    whisperCppVersion:
      runtimeType === "mvl-patched" ? "1.9.3" : whisperCppVersion,
    vadModelPath,
    tokenTimestampsAvailable: tokenTimestampControlAvailable,
    fullJsonAvailable: /--output-json-full\b/u.test(help),
    logicalCores: Math.max(1, Number(process.env.MVL_LOGICAL_CORES ?? 0) || 8),
    timestampCapability,
    serverPath,
    runtimeType,
    buildManifest,
    expectedMvlRuntime,
    responseSchemaVersion:
      runtimeType === "mvl-patched"
        ? input.mvlResponseSchemaVersion
        : "verbose_json",
    capabilityEndpointResponse: null,
  };
}

function parsedMvlEnvelope(result: TranscriptionChunkResult): {
  response: ReturnType<typeof mvlWhisperServerResponseSchema.parse>;
  capability: MvlWhisperServerCapabilities;
} | null {
  if (typeof result.raw !== "object" || result.raw === null) return null;
  const raw = result.raw as {
    mvlResponse?: unknown;
    capabilityHandshake?: unknown;
  };
  if (raw.mvlResponse === undefined) return null;
  return {
    response: mvlWhisperServerResponseSchema.parse(raw.mvlResponse),
    capability: mvlWhisperServerCapabilitiesSchema.parse(
      raw.capabilityHandshake,
    ),
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

export function timestampAttemptViewsForMode(input: {
  mode: TimestampEvidenceIntegrityMode;
  auditedAttempt: OverlapAcousticAttempt;
  legacyAttempt: OverlapAcousticAttempt;
}): {
  artifactAttempt: OverlapAcousticAttempt;
  classificationAttempt: OverlapAcousticAttempt;
} {
  return {
    artifactAttempt:
      input.mode === "off" ? input.legacyAttempt : input.auditedAttempt,
    classificationAttempt:
      input.mode === "enforce" ? input.auditedAttempt : input.legacyAttempt,
  };
}

export function timestampObserveMutationProhibited(
  mode: TimestampEvidenceIntegrityMode,
  timingMutationCount: number,
): boolean {
  return mode === "observe" && timingMutationCount > 0;
}

export function orderOverlapAcousticProfiles(
  plans: readonly { profiles: readonly OverlapAcousticProfile[] }[],
): OverlapAcousticProfile[] {
  const requested = new Set(plans.flatMap((plan) => plan.profiles));
  // whisper.cpp v1.9.3 retains its latest VAD time map in a reused context.
  // Running every no-VAD request before any VAD request keeps the official
  // no-VAD mapped getter on the identity timeline while retaining one model
  // load and one persistent worker for all 21 requests.
  return (
    ["no-vad", "current-sensitive-vad", "extra-sensitive-vad"] as const
  ).filter((profile) => requested.has(profile));
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
  sourceCues: readonly SubtitleCue[];
  tokenTimestampPolicy: TokenTimestampPolicy;
  rawVadPolicy: RawVadPolicy;
}): {
  attempt: OverlapAcousticAttempt;
  legacyAttempt: OverlapAcousticAttempt;
  integrity: TimestampAttemptIntegrity;
} {
  const mvl = parsedMvlEnvelope(input.result);
  if (mvl !== null) {
    input.runtime.capabilityEndpointResponse = mvl.capability;
    input.runtime.timestampCapability.mappedTokenGetterActuallyUsed ||=
      mvl.response.runtime.capabilities.mapped_token_getter_used;
    input.runtime.timestampCapability.rawVadGetterActuallyUsed ||=
      mvl.response.runtime.capabilities.raw_vad_getter_used;
    if (input.runtime.timestampCapability.mappedTokenGetterActuallyUsed) {
      input.runtime.timestampCapability.timestampCapabilityStatus =
        "mapped-original-timeline";
    }
    input.runtime.timestampCapability.evidence = [
      ...new Set([
        ...input.runtime.timestampCapability.evidence,
        "capability-endpoint:strict-schema-verified",
        ...(mvl.response.runtime.capabilities.mapped_token_getter_used
          ? ["mapped-token-getter:inference-use-proven"]
          : []),
        ...(mvl.response.runtime.capabilities.raw_vad_getter_used
          ? ["raw-vad-getter:inference-use-proven"]
          : []),
      ]),
    ].toSorted();
  }
  const sourceSegments =
    mvl === null
      ? input.result.segments.map((segment) => ({
          text: segment.text,
          start: segment.start,
          end: segment.end,
          confidence: segment.confidence,
          tokens: (segment.tokens ?? []).map((token) => ({
            text: token.text,
            rawStart: token.start,
            rawEnd: token.end,
            probability: token.probability ?? null,
            rawCoordinateSystem: undefined,
            officialMappedStart: undefined,
            officialMappedEnd: undefined,
            special: false,
          })),
        }))
      : mvl.response.transcription.map((segment) => ({
          text: segment.text,
          start: segment.startSeconds,
          end: segment.endSeconds,
          confidence: null,
          // Individual Whisper tokens can split one UTF-8 code point. The
          // strict response proves each grouped word's byte membership and
          // derives its bounds from the first/last official getter result, so
          // the grouped word is the smallest safe lexical timing unit.
          tokens: segment.words.flatMap((word) =>
            word.rawStartCentiseconds === null ||
            word.rawEndCentiseconds === null ||
            word.mappedStartCentiseconds === null ||
            word.mappedEndCentiseconds === null
              ? []
              : [
                  {
                    text: word.word,
                    rawStart: word.rawStartCentiseconds * 0.01,
                    rawEnd: word.rawEndCentiseconds * 0.01,
                    probability: word.probability,
                    rawCoordinateSystem: mvl.response.request.vad
                      ? ("vad-processed-local" as const)
                      : ("original-audio-local" as const),
                    officialMappedStart: word.mappedStartCentiseconds * 0.01,
                    officialMappedEnd: word.mappedEndCentiseconds * 0.01,
                    special: false,
                  },
                ],
          ),
        }));
  const rawSegments = sourceSegments.flatMap((segment, segmentIndex) => {
    if (segment.end <= segment.start) return [];
    const segmentId = deterministicId("overlap-segment", {
      requestId: input.requestId,
      segmentIndex,
      start: segment.start,
      end: segment.end,
      text: segment.text,
    });
    const tokens = segment.tokens.flatMap((token, tokenIndex) => {
      if (token.rawEnd < token.rawStart) return [];
      const tokenId = deterministicId("overlap-token", {
        requestId: input.requestId,
        segmentIndex,
        tokenIndex,
        start: token.rawStart,
        end: token.rawEnd,
        text: token.text,
      });
      return [
        {
          tokenId,
          text: token.text,
          rawStart: token.rawStart,
          rawEnd: token.rawEnd,
          probability: token.probability,
          ...(token.rawCoordinateSystem === undefined
            ? {}
            : { rawCoordinateSystem: token.rawCoordinateSystem }),
          ...(token.officialMappedStart === undefined
            ? {}
            : { officialMappedStart: token.officialMappedStart }),
          ...(token.officialMappedEnd === undefined
            ? {}
            : { officialMappedEnd: token.officialMappedEnd }),
        },
      ];
    });
    return [
      {
        segmentId,
        text: segment.text,
        rawStart: segment.start,
        rawEnd: segment.end,
        confidence: segment.confidence,
        tokens,
      },
    ];
  });
  const profile = adapterProfile(input.profile);
  const attemptId = deterministicId("overlap-attempt", {
    componentId: input.plan.componentId,
    profile: input.profile,
    requestId: input.requestId,
  });
  const audit = auditTimestampEvidenceAttempt({
    attemptId,
    profile: input.profile,
    useVad: profile.useVad,
    extractionInterval: input.plan.extractionInterval,
    segments: rawSegments,
    sourceCueIntervals: input.sourceCues.map((cue) => ({
      intervalId: cue.id,
      start: cue.start,
      end: cue.end,
    })),
    rawVadIntervals:
      input.rawVadPolicy === "off" || mvl === null
        ? []
        : mvl.response.vad_segments.map((interval) => ({
            intervalId: deterministicId("raw-vad", {
              requestId: input.requestId,
              index: interval.index,
              start: interval.startSeconds,
              end: interval.endSeconds,
            }),
            start: interval.startSeconds,
            end: interval.endSeconds,
            coordinateSystem: "original-audio-local" as const,
          })),
    tokenTimestampsRequested: true,
    tokenTimestampPolicy: input.tokenTimestampPolicy,
    mappedTokenGetterActuallyUsed:
      mvl?.response.runtime.capabilities.mapped_token_getter_used ??
      input.runtime.timestampCapability.mappedTokenGetterActuallyUsed,
  });
  const trustedAvailable = audit.tokens.some(
    (token) => token.timingUsable === true,
  );
  const auditedTokenById = new Map(
    audit.tokens.map((token) => [token.tokenId, token] as const),
  );
  const attempt: OverlapAcousticAttempt = {
    attemptId,
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
    runtimeCapabilityRef: "whisper-runtime-capability.json",
    responseSchemaVersion:
      mvl?.response.schema_version ?? input.runtime.responseSchemaVersion,
    rawText: input.result.text,
    segments: audit.segments,
    tokens: audit.tokens,
    rawTokens: audit.tokens.flatMap((token) =>
      token.parentSegmentId === undefined ||
      token.rawStart === undefined ||
      token.rawEnd === undefined
        ? []
        : [
            {
              tokenId: token.tokenId,
              parentSegmentId: token.parentSegmentId,
              text: token.text,
              special: token.specialToken ?? false,
              start: token.rawStart,
              end: token.rawEnd,
              coordinateSystem: token.rawCoordinateSystem ?? "unknown",
            },
          ],
    ),
    mappedTokens: rawSegments.flatMap((segment) =>
      segment.tokens.flatMap((token) => {
        if (
          token.officialMappedStart === undefined ||
          token.officialMappedEnd === undefined
        ) {
          return [];
        }
        const start =
          input.plan.extractionInterval.start + token.officialMappedStart;
        const end =
          input.plan.extractionInterval.start + token.officialMappedEnd;
        if (
          !Number.isFinite(start) ||
          !Number.isFinite(end) ||
          start < 0 ||
          end < start
        ) {
          return [];
        }
        return [
          {
            tokenId: token.tokenId,
            parentSegmentId: segment.segmentId,
            text: token.text,
            start,
            end,
            coordinateSystem: "original-media-global" as const,
            mappingMethod: "official-mapped-token-getter" as const,
            timingUsable:
              auditedTokenById.get(token.tokenId)?.timingUsable ?? false,
          },
        ];
      }),
    ),
    // Deprecated compatibility alias. New evidence selection never treats it
    // as raw VAD or an independent speech detector.
    speechIntervals: audit.decodedSegmentIntervals.map(({ start, end }) => ({
      start,
      end,
    })),
    timestampIntegrityRef: `subtitle-timestamp-evidence-integrity.json#attempt:${attemptId}`,
    decodedSegmentIntervals: audit.decodedSegmentIntervals,
    mappedTrustedTokenIntervals: audit.mappedTrustedTokenIntervals,
    rawVadIntervals: audit.rawVadIntervals,
    sourceCueIntervals: audit.sourceCueIntervals,
    metrics: {
      durationSeconds: input.durationSeconds,
      segmentCount: audit.segments.length,
      tokenCount: audit.tokens.length,
      speechIntervalCount: audit.decodedSegmentIntervals.length,
      tokenTimestampsRequested: true,
      tokenTimestampsReturned: audit.tokens.length > 0,
      trustedTokenTimestampsAvailable: trustedAvailable,
      trustedTokenTimestampsUsed: false,
      tokenTimestampsUsed: false,
    },
    language: "ja",
    failure: input.failure ?? null,
  };
  const legacyTokens: OverlapAcousticAttempt["tokens"] = rawSegments.flatMap(
    (segment) =>
      segment.tokens.map((token) => ({
        tokenId: token.tokenId,
        text: token.text,
        start: mapOverlapLocalTimestampToGlobal(
          input.plan.extractionInterval.start + token.rawStart,
          input.plan.extractionInterval,
        ),
        end: mapOverlapLocalTimestampToGlobal(
          input.plan.extractionInterval.start + token.rawEnd,
          input.plan.extractionInterval,
        ),
        probability: token.probability,
      })),
  );
  const legacyAttempt: OverlapAcousticAttempt = {
    attemptId,
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
    segments: audit.segments.map((segment) => ({
      segmentId: segment.segmentId,
      text: segment.text,
      start: segment.start,
      end: segment.end,
      confidence: segment.confidence,
      tokenIds: segment.tokenIds,
    })),
    tokens: legacyTokens,
    speechIntervals: audit.segments.map((segment) => ({
      start: segment.start,
      end: segment.end,
    })),
    metrics: {
      durationSeconds: input.durationSeconds,
      segmentCount: audit.segments.length,
      tokenCount: legacyTokens.length,
      speechIntervalCount: audit.segments.length,
      tokenTimestampsRequested: true,
      tokenTimestampsUsed: legacyTokens.length > 0,
    },
    language: "ja",
    failure: input.failure ?? null,
  };
  return { attempt, legacyAttempt, integrity: audit.integrity };
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
  const timestampEvidenceIntegrity =
    options.timestampEvidenceIntegrity ?? "observe";
  const tokenTimestampPolicy = options.tokenTimestampPolicy ?? "auto";
  const legacyOverlapCachePolicy = options.legacyOverlapCachePolicy ?? "reject";
  const timestampRuntimePolicy = options.timestampRuntimePolicy ?? "auto";
  const rawVadPolicy = options.rawVadPolicy ?? "auto";
  const mvlResponseSchemaVersion =
    options.mvlResponseSchemaVersion ?? mvlWhisperResponseSchemaVersion;
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
      ...(options.whisperServerPath === undefined
        ? {}
        : { whisperServerPath: options.whisperServerPath }),
      timestampRuntimePolicy,
      rawVadPolicy,
      ...(options.runtimeCapabilityManifestPath === undefined
        ? {}
        : {
            runtimeCapabilityManifestPath:
              options.runtimeCapabilityManifestPath,
          }),
      mvlResponseSchemaVersion,
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
    if (
      (options.coreML ?? "auto") === "on" ||
      timestampRuntimePolicy === "require-mapped" ||
      rawVadPolicy === "required"
    ) {
      throw error;
    }
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
  const classificationAttempts: OverlapAcousticAttempt[] = [];
  const integrityAttempts: TimestampAttemptIntegrity[] = [];
  if (runtime !== null) {
    const profileExecutionOrder = orderOverlapAcousticProfiles(
      extracted.map((audio) => audio.plan),
    );
    for (const profileId of profileExecutionOrder) {
      for (const audio of extracted) {
        if (!audio.plan.profiles.includes(profileId)) continue;
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
          timestampMappingVersion: TIMESTAMP_MAPPING_VERSION,
          timestampCoordinateSystem: profile.useVad
            ? "vad-processed-local"
            : "original-audio-local",
          tokenHealthPolicyVersion: TOKEN_HEALTH_POLICY_VERSION,
          runtimeTimestampCapabilityHash:
            runtime.timestampCapability.runtimeTimestampCapabilityHash,
          runtimeType: runtime.runtimeType,
          runtimeBinarySha256: runtime.timestampCapability.runtimeBinarySha256,
          runtimeSourceCommit: runtime.timestampCapability.runtimeSourceCommit,
          runtimePatchSha256: runtime.buildManifest?.patch.patchSha256 ?? null,
          runtimeResponseSchemaVersion: runtime.responseSchemaVersion,
          rawVadPolicyVersion: RAW_VAD_POLICY_VERSION,
          decodeConfiguration: {
            requestType: "overlap-evidence",
            targetUnionInterval: audio.plan.unionInterval,
            profile: profileId,
            useVad: profile.useVad,
            vadProfile: profile.vadProfile,
            language: "ja",
            tokenTimestamps: true,
            suppressNonSpeechTokens: true,
            timestampEvidenceIntegrity,
            tokenTimestampPolicy,
            legacyOverlapCachePolicy,
          },
        });
        const legacyIdentity = buildPortableAsrCacheIdentityV2({
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
        const activeIdentity =
          timestampEvidenceIntegrity === "off" ? legacyIdentity : identity;
        const lookup = await cache.lookup({
          requestId,
          requestType: "overlap-evidence",
          identity: activeIdentity,
          ...(timestampEvidenceIntegrity === "off"
            ? {}
            : {
                legacyV2Identity: legacyIdentity,
                legacyV2Policy: legacyOverlapCachePolicy,
              }),
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
              serverPath: runtime.serverPath,
              timestampRuntimePolicy,
              rawVadPolicy,
              mvlResponseSchemaVersion,
              ...(runtime.expectedMvlRuntime === null
                ? {}
                : { expectedMvlRuntime: runtime.expectedMvlRuntime }),
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
              identity: activeIdentity,
              result,
            });
          } catch (error) {
            if (
              timestampRuntimePolicy === "require-mapped" ||
              rawVadPolicy === "required"
            ) {
              await workerPool.close();
              throw error;
            }
            failure = error instanceof Error ? error.message : String(error);
            result = { text: "", segments: [], raw: null };
          }
        }
        const mappedAttempt = mapAttempt({
          result: result ?? { text: "", segments: [], raw: null },
          plan: audio.plan,
          profile: profileId,
          runtime,
          requestId,
          cacheHit: lookup.hit,
          prompt,
          durationSeconds: audio.durationSeconds,
          failure,
          sourceCues: options.cues.filter((cue) =>
            audio.plan.cueIds.includes(cue.id),
          ),
          tokenTimestampPolicy:
            lookup.tokenTimingTrust === "legacy-untrusted"
              ? "off"
              : tokenTimestampPolicy,
          rawVadPolicy,
        });
        const attemptViews = timestampAttemptViewsForMode({
          mode: timestampEvidenceIntegrity,
          auditedAttempt: mappedAttempt.attempt,
          legacyAttempt: mappedAttempt.legacyAttempt,
        });
        attempts.push(attemptViews.artifactAttempt);
        classificationAttempts.push(attemptViews.classificationAttempt);
        integrityAttempts.push(mappedAttempt.integrity);
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
    const component = classifyOverlapAcousticComponent({
      plan: audio.plan,
      allCues: options.cues,
      sourceDecision,
      attempts: classificationAttempts,
      mode: options.mode,
      configuration,
      audioPath: audio.relativePath,
      audioSha256: audio.sha256,
      audioDurationSeconds: audio.durationSeconds,
      audioFullyCoversComponent: audio.fullyCoversComponent,
    });
    if (timestampEvidenceIntegrity === "off") return component;
    const gateFailures = evaluateTimestampEvidenceIntegrityGate({
      attempts: classificationAttempts.filter(
        (attempt) => attempt.componentId === audio.plan.componentId,
      ),
      alignments: component.cueAlignments,
      ...(runtime === null
        ? {}
        : { runtimeCapability: runtime.timestampCapability }),
    });
    const observationWouldMutate = timestampObserveMutationProhibited(
      timestampEvidenceIntegrity,
      component.timingMutations.length,
    );
    return gateFailures.length === 0 && !observationWouldMutate
      ? component
      : overlapAcousticComponentSchema.parse({
          ...component,
          finalRelationship: "unresolved",
          recommendedAction: "review",
          safeAutomaticAction: "none",
          timingMutations: [],
          assEventOverrides: [],
          vttCueSettings: [],
          blocking: true,
          timestampIntegrityGateFailures: gateFailures,
          reasons: [
            ...new Set([
              ...component.reasons,
              ...gateFailures,
              ...(observationWouldMutate
                ? ["TIMESTAMP_INTEGRITY_OBSERVE_MUTATION_PROHIBITED"]
                : []),
            ]),
          ],
        });
  });
  const integrityGateFailures = [
    ...new Set(
      components.flatMap(
        (component) => component.timestampIntegrityGateFailures ?? [],
      ),
    ),
  ].toSorted();
  const timingTokenIdsUsed = new Set(
    components.flatMap((component) =>
      component.cueAlignments.flatMap(
        (alignment) => alignment.trustedMatchedTokenIds ?? [],
      ),
    ),
  );
  const admittedTokenIds = new Set(
    integrityAttempts.flatMap((attempt) => attempt.trustedTokenIds),
  );
  const trustedTokenIdsUsed = new Set(
    [...timingTokenIdsUsed].filter((tokenId) => admittedTokenIds.has(tokenId)),
  );
  const untrustedTokenIdsUsed = new Set(
    [...timingTokenIdsUsed].filter((tokenId) => !admittedTokenIds.has(tokenId)),
  );
  const finalizedAttempts = attempts.map((attempt) => {
    if (timestampEvidenceIntegrity === "off") return attempt;
    const used = attempt.tokens.some((token) =>
      trustedTokenIdsUsed.has(token.tokenId),
    );
    return {
      ...attempt,
      metrics: {
        ...attempt.metrics,
        trustedTokenTimestampsUsed: used,
        tokenTimestampsUsed: used,
      },
    };
  });
  const finalizedIntegrityAttempts = integrityAttempts.map((attempt) => ({
    ...attempt,
    attemptMetrics: {
      ...attempt.attemptMetrics,
      trustedTokenTimestampsUsed: attempt.trustedTokenIds.some((tokenId) =>
        trustedTokenIdsUsed.has(tokenId),
      ),
    },
  }));
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
    attempts: finalizedAttempts,
    components,
  });
  const timestampIntegrityArtifact =
    runtime === null || timestampEvidenceIntegrity === "off"
      ? null
      : buildTimestampEvidenceIntegrityArtifact({
          sourceOverlapArtifactHash: timestampIntegrityHash(artifact),
          runtimeCapability: runtime.timestampCapability,
          mode: timestampEvidenceIntegrity,
          tokenTimestampPolicy,
          legacyOverlapCachePolicy,
          attempts: finalizedIntegrityAttempts,
          trustedTokenUsedForTimingIds: trustedTokenIdsUsed,
          untrustedTokenUsedForTimingIds: untrustedTokenIdsUsed,
          rawVadIntervalCount: finalizedAttempts.reduce(
            (sum, attempt) => sum + (attempt.rawVadIntervals?.length ?? 0),
            0,
          ),
          integrityGateFailures,
        });
  const runtimeCapabilityArtifact =
    runtime === null
      ? null
      : whisperRuntimeCapabilityArtifactSchema.parse({
          schemaVersion: "1.0.0",
          artifactType: "whisper-runtime-capability",
          runtimeType: runtime.runtimeType,
          upstreamRepository: "ggml-org/whisper.cpp",
          upstreamTag: runtime.buildManifest?.upstream.tag ?? null,
          upstreamCommit: runtime.buildManifest?.upstream.commit ?? null,
          patchId:
            runtime.runtimeType === "mvl-patched"
              ? (runtime.buildManifest?.patch.patchId ?? null)
              : null,
          patchSha256:
            runtime.runtimeType === "mvl-patched"
              ? (runtime.buildManifest?.patch.patchSha256 ?? null)
              : null,
          binaryBasename: path.basename(runtime.serverPath),
          binarySha256: runtime.timestampCapability.runtimeBinarySha256,
          buildFlagsHash: runtime.buildManifest?.build.flagsHash ?? null,
          capabilityEndpointResponse: runtime.capabilityEndpointResponse,
          capabilityHash:
            runtime.timestampCapability.runtimeTimestampCapabilityHash,
          behaviorProbeResults: {
            inferenceResponseCount: finalizedAttempts.length,
            mappedTokenResponseCount: finalizedAttempts.filter((attempt) =>
              attempt.tokens.some(
                (token) =>
                  token.mappingMethod === "official-mapped-token-getter",
              ),
            ).length,
            rawVadResponseCount: finalizedAttempts.filter(
              (attempt) => (attempt.rawVadIntervals?.length ?? 0) > 0,
            ).length,
          },
          mappedGetterDeclared:
            runtime.timestampCapability.mappedTokenGetterAvailable,
          mappedGetterActuallyUsed:
            runtime.timestampCapability.mappedTokenGetterActuallyUsed,
          rawVadGetterDeclared:
            runtime.timestampCapability.rawVadGetterAvailable,
          rawVadGetterActuallyUsed:
            runtime.timestampCapability.rawVadGetterActuallyUsed,
          responseSchema: runtime.responseSchemaVersion,
          verified:
            runtime.runtimeType === "mvl-patched" &&
            runtime.capabilityEndpointResponse !== null &&
            runtime.timestampCapability.mappedTokenGetterActuallyUsed &&
            (rawVadPolicy !== "required" ||
              runtime.timestampCapability.rawVadGetterActuallyUsed),
          failures: [
            ...(runtime.runtimeType === "mvl-patched" &&
            runtime.capabilityEndpointResponse === null
              ? ["CAPABILITY_ENDPOINT_NOT_OBSERVED"]
              : []),
            ...(timestampRuntimePolicy === "require-mapped" &&
            !runtime.timestampCapability.mappedTokenGetterActuallyUsed
              ? ["MAPPED_GETTER_USE_NOT_OBSERVED"]
              : []),
            ...(rawVadPolicy === "required" &&
            !runtime.timestampCapability.rawVadGetterActuallyUsed
              ? ["RAW_VAD_GETTER_USE_NOT_OBSERVED"]
              : []),
          ],
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
    timestampIntegrity: path.join(
      options.subtitleDirectory,
      "subtitle-timestamp-evidence-integrity.json",
    ),
    runtimeCapability: path.join(
      options.subtitleDirectory,
      "whisper-runtime-capability.json",
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
    ...(timestampIntegrityArtifact === null
      ? []
      : [
          atomicWriteJson(
            outputPaths.timestampIntegrity,
            timestampIntegrityArtifact,
            { overwrite: true },
          ),
        ]),
    ...(runtimeCapabilityArtifact === null
      ? []
      : [
          atomicWriteJson(
            outputPaths.runtimeCapability,
            runtimeCapabilityArtifact,
            { overwrite: true },
          ),
        ]),
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
    timestampIntegrity: timestampIntegrityArtifact,
    executionMetrics,
    audioStreamIndex: selectedAudio.index,
    dependencyFailure,
    wallClockSeconds,
    outputPaths,
  };
}

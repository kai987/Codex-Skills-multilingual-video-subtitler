import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, cp, mkdir, readFile, readdir, stat } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { promisify } from "node:util";

import { formatAss, formatSrt, formatVtt } from "@mvl/subtitle-core";
import {
  atomicWriteFile,
  atomicWriteJson,
  blindGenerationInputManifestSchema,
  c6016PolicyVersion,
  c6016ShareableSummarySchema,
  ctcAlignmentAttemptSchema,
  ctcRuntimeCapabilitySchema,
  InputError,
  machineAcousticRiskVectorSchema,
  machineCandidatePoolC6015Schema,
  machineEventFinalTextSpanLineageSchema,
  machineVariantEvidenceBundleSchema,
  mvlWhisperServerResponseSchema,
  subtitlePackageSchema,
  type BlindGenerationInputManifest,
  type C6017CeilingMode,
  type C6017Mode,
  type CtcAlignmentAttempt,
  type FreshReAsrCandidate,
  type MachineEventFinalTextSpanLineage,
  type MachineFreshCandidateComparison,
  type MvlWhisperServerResponse,
  type SubtitlePackage,
} from "@mvl/shared";
import { WhisperCppWorkerPool } from "@mvl/transcription-core";
import {
  auditBlindRunProvenance,
  buildAndApplySpanTextRepair,
  buildC6017QualityPolicy,
  buildFreshCandidateComparison,
  buildFreshCandidateDrafts,
  buildMachineBaselineEvidenceCoverage,
  buildMachineFreshTargetedReAsr,
  buildMachineReAsrRiskV2,
  c60SemanticHash,
  c60StableHash,
  createBlindOutputFreeze,
  createMachineShadowPolicy,
  evaluateMachineShadowFinalization,
  finalizeC6016ShareableArtifacts,
  freshCandidateInputs,
  inspectReviewWav,
  loadAndVerifyCtcRuntime,
  LocalCtcWorker,
  machineQualitySemanticHash,
  normalizeCandidateText,
  planFreshTargetedReAsr,
  projectJapanesePronunciationBatch,
  type ExecutedFreshReAsrRequest,
  type FreshCandidateCtcEvidence,
  type FreshComparisonCandidateInput,
  type SpanRepairSelectionInput,
} from "@mvl/video-subtitler";

const execFileAsync = promisify(execFile);
const GENERATED_AT = "2026-08-29T12:00:00.000Z";
const POLICY_FROZEN_AT = "2026-08-29T11:30:00.000Z";
const SOURCE_SAMPLE_RATE = 16_000;
const FRESH_CACHE_NAMESPACE = "c6-0-1-7-fresh-targeted-reasr-v1";
const FRESH_WHISPER_FAMILY = "whisper-fresh-targeted-reasr";
const FRESH_CTC_FAMILY = "ctc-fresh-targeted-reasr";

interface WhisperRuntimeManifest {
  upstream: { tag: string; commit: string };
  patch: { patchId: string; patchSha256: string; responseSchema: string };
  build: { flagsHash: string };
  patched: { binarySha256: string };
}

interface FreshWhisperCacheRecord {
  schemaVersion: "1.0.0";
  cacheNamespace: typeof FRESH_CACHE_NAMESPACE;
  generationId: string;
  requestIdentity: string;
  response: unknown;
  responseSemanticHash: string;
}

interface ExtractionResult {
  audioPath: string;
  audioSha256: string;
  sampleCount: number;
  sampleRate: number;
  cacheHit: boolean;
  commandIdentity: string;
}

interface ParsedArguments {
  baseline: string;
  output: string;
  source: string;
  freshCache: string;
  repositoryCommit: string;
  stage: string;
  generationId: string;
  generationKind: "fresh" | "replay";
  riskMode: C6017Mode;
  freshMode: C6017Mode;
  textApplicationMode: C6017Mode;
  ceilingMode: C6017CeilingMode;
  ffmpeg: string;
  whisperServer: string | null;
  whisperModel: string | null;
  whisperModelSha256: string | null;
  vadModel: string | null;
  whisperRuntimeManifest: string | null;
  whisperDevice: "metal" | "cpu";
  ctcRuntimeManifest: string | null;
  ctcModelManifest: string | null;
  ctcRuntimeCapability: string | null;
  sudachiPython: string | null;
  sudachiHelper: string | null;
}

interface CanonicalEventsArtifact {
  events: {
    eventId: string;
    acousticInterval: { start: number; end: number };
  }[];
}

interface CandidatePoolCandidate {
  variantId: string;
  eventId: string;
  candidateId: string;
  text: string;
  interval: { start: number; end: number };
  eventInterval: { start: number; end: number };
  requestIds: string[];
  sourceWindowIds: string[];
  independentSupportGroups: string[];
  correlatedSupportGroups: string[];
  origin: string;
  sourceGlobalVerified: boolean;
  promptIsolated: boolean;
  evidenceCompleteness: "COMPLETE" | "PARTIAL" | "UNAVAILABLE";
  selected: boolean;
}

interface CandidatePoolEvent {
  eventId: string;
  currentVariantId: string;
  selectedVariantId: string;
  candidateIds: string[];
}

interface CtcExecutionAudit {
  evidenceByCandidateId: Map<string, FreshCandidateCtcEvidence>;
  requestCount: number;
  cacheHitCount: number;
  inferenceCount: number;
  modelLoadCount: number;
  workerStartCount: number;
  runtimeIdentityHash: string | null;
  modelSnapshotHash: string | null;
  deviceUsed: string | null;
}

function argumentValue(argumentsList: readonly string[], flag: string): string {
  const index = argumentsList.indexOf(flag);
  const value = index < 0 ? undefined : argumentsList[index + 1];
  if (value === undefined || value === "")
    throw new Error(`Missing required argument ${flag}.`);
  return value;
}

function optionalArgument(
  argumentsList: readonly string[],
  flag: string,
  fallback: string,
): string {
  const index = argumentsList.indexOf(flag);
  return index < 0 ? fallback : (argumentsList[index + 1] ?? fallback);
}

function optionalPath(
  argumentsList: readonly string[],
  flag: string,
): string | null {
  const index = argumentsList.indexOf(flag);
  const value = index < 0 ? undefined : argumentsList[index + 1];
  return value === undefined || value === "" ? null : path.resolve(value);
}

function mode(value: string, flag: string): C6017Mode {
  if (value === "off" || value === "observe" || value === "enforce")
    return value;
  throw new Error(`${flag} must be off, observe, or enforce.`);
}

function ceilingMode(value: string): C6017CeilingMode {
  if (value === "off" || value === "observe") return value;
  throw new Error("--asr-ceiling-validation must be off or observe.");
}

function parseArguments(argumentsList: readonly string[]): ParsedArguments {
  const generationKind = optionalArgument(
    argumentsList,
    "--generation-kind",
    "replay",
  );
  if (generationKind !== "fresh" && generationKind !== "replay") {
    throw new Error("--generation-kind must be fresh or replay.");
  }
  const whisperDevice = optionalArgument(
    argumentsList,
    "--whisper-device",
    "metal",
  );
  if (whisperDevice !== "metal" && whisperDevice !== "cpu") {
    throw new Error("--whisper-device must be metal or cpu.");
  }
  const modelHash = optionalArgument(
    argumentsList,
    "--whisper-model-sha256",
    "",
  );
  if (modelHash !== "" && !/^[a-f0-9]{64}$/u.test(modelHash)) {
    throw new Error("--whisper-model-sha256 must be a SHA-256 value.");
  }
  return {
    baseline: path.resolve(argumentValue(argumentsList, "--baseline")),
    output: path.resolve(argumentValue(argumentsList, "--output")),
    source: path.resolve(argumentValue(argumentsList, "--source")),
    freshCache: path.resolve(argumentValue(argumentsList, "--fresh-cache")),
    repositoryCommit: argumentValue(argumentsList, "--repository-commit"),
    stage: optionalArgument(argumentsList, "--stage", "full-candidate"),
    generationId: argumentValue(argumentsList, "--generation-id"),
    generationKind,
    riskMode: mode(
      optionalArgument(argumentsList, "--reasr-risk-v2", "observe"),
      "--reasr-risk-v2",
    ),
    freshMode: mode(
      optionalArgument(argumentsList, "--fresh-targeted-reasr", "off"),
      "--fresh-targeted-reasr",
    ),
    textApplicationMode: mode(
      optionalArgument(argumentsList, "--text-application", "off"),
      "--text-application",
    ),
    ceilingMode: ceilingMode(
      optionalArgument(argumentsList, "--asr-ceiling-validation", "off"),
    ),
    ffmpeg: optionalArgument(argumentsList, "--ffmpeg", "ffmpeg"),
    whisperServer: optionalPath(argumentsList, "--whisper-server"),
    whisperModel: optionalPath(argumentsList, "--whisper-model"),
    whisperModelSha256: modelHash === "" ? null : modelHash,
    vadModel: optionalPath(argumentsList, "--vad-model"),
    whisperRuntimeManifest: optionalPath(
      argumentsList,
      "--whisper-runtime-manifest",
    ),
    whisperDevice,
    ctcRuntimeManifest: optionalPath(argumentsList, "--ctc-runtime-manifest"),
    ctcModelManifest: optionalPath(argumentsList, "--ctc-model-manifest"),
    ctcRuntimeCapability: optionalPath(
      argumentsList,
      "--ctc-runtime-capability",
    ),
    sudachiPython: optionalPath(argumentsList, "--sudachi-python"),
    sudachiHelper: optionalPath(argumentsList, "--sudachi-helper"),
  };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function json<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function sha256File(filePath: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function onlySubtitleDirectory(taskDirectory: string): Promise<string> {
  const entries = (await readdir(taskDirectory, { withFileTypes: true }))
    .filter(
      (entry) => entry.isDirectory() && entry.name.startsWith("subtitle-"),
    )
    .map((entry) => entry.name);
  if (entries.length !== 1 || entries[0] === undefined) {
    throw new Error("Expected exactly one subtitle artifact directory.");
  }
  return path.join(taskDirectory, entries[0]);
}

async function cloneBaseline(input: {
  baseline: string;
  output: string;
}): Promise<string> {
  if (await exists(input.output)) {
    throw new Error(`Output already exists: ${input.output}`);
  }
  await cp(input.baseline, input.output, {
    recursive: true,
    errorOnExist: true,
    force: false,
    filter: (source) => {
      const relative = path.relative(input.baseline, source);
      if (relative === "") return true;
      if (relative === "blind-output-freeze.json") return false;
      if (relative.startsWith("shareable")) return false;
      if (relative.includes(`${path.sep}audio${path.sep}review`)) return false;
      if (relative.includes(`${path.sep}review${path.sep}`)) return false;
      return true;
    },
  });
  return onlySubtitleDirectory(input.output);
}

function cachePath(root: string, family: string, key: string): string {
  return path.join(
    root,
    FRESH_CACHE_NAMESPACE,
    family,
    key.slice(0, 2),
    `${key}.json`,
  );
}

async function ensureExtractedAudio(input: {
  source: string;
  sourceSha256: string;
  startSample: number;
  endSample: number;
  ffmpeg: string;
  cacheRoot: string;
}): Promise<ExtractionResult> {
  const sampleCount = input.endSample - input.startSample;
  if (sampleCount <= 0) throw new InputError("Audio extraction span is empty.");
  const commandCore = {
    provider: "ffmpeg",
    cacheNamespace: FRESH_CACHE_NAMESPACE,
    sourceSha256: input.sourceSha256,
    sampleRate: SOURCE_SAMPLE_RATE,
    startSample: input.startSample,
    endSample: input.endSample,
    filter:
      "aresample=16000,atrim=start_sample=0:end_sample=<count>,asetpts=N/SR/TB",
    codec: "pcm_s16le",
    channels: 1,
    inputSeekPlacement: "before-input",
  };
  const commandIdentity = machineQualitySemanticHash(commandCore);
  const directory = path.join(input.cacheRoot, FRESH_CACHE_NAMESPACE, "audio");
  await mkdir(directory, { recursive: true });
  const audioPath = path.join(directory, `${commandIdentity}.wav`);
  const cacheHit = await exists(audioPath);
  if (!cacheHit) {
    await execFileAsync(input.ffmpeg, [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      (input.startSample / SOURCE_SAMPLE_RATE).toFixed(6),
      "-i",
      input.source,
      "-map",
      "0:a:0",
      "-vn",
      "-af",
      `aresample=${SOURCE_SAMPLE_RATE},atrim=start_sample=0:end_sample=${sampleCount},asetpts=N/SR/TB`,
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      "-y",
      audioPath,
    ]);
  }
  const wav = inspectReviewWav(await readFile(audioPath));
  if (wav.sampleRate !== SOURCE_SAMPLE_RATE || wav.frameCount !== sampleCount) {
    throw new InputError(
      "Fresh extracted WAV does not match its source-global sample lineage.",
      {
        expectedSampleCount: sampleCount,
        actualSampleCount: wav.frameCount,
        expectedSampleRate: SOURCE_SAMPLE_RATE,
        actualSampleRate: wav.sampleRate,
      },
    );
  }
  return {
    audioPath,
    audioSha256: await sha256File(audioPath),
    sampleCount,
    sampleRate: SOURCE_SAMPLE_RATE,
    cacheHit,
    commandIdentity,
  };
}

async function runJsonProcess(input: {
  executable: string;
  args: readonly string[];
  request: unknown;
}): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const environment = { ...process.env };
    delete environment.HF_TOKEN;
    delete environment.HUGGING_FACE_HUB_TOKEN;
    environment.HF_HUB_OFFLINE = "1";
    environment.TRANSFORMERS_OFFLINE = "1";
    environment.HF_HUB_DISABLE_TELEMETRY = "1";
    environment.NO_PROXY = "*";
    environment.no_proxy = "*";
    const child = spawn(input.executable, [...input.args], {
      env: environment,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new InputError("Offline helper failed.", { code, stderr }));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as unknown);
      } catch (error) {
        reject(
          new InputError("Offline helper emitted invalid JSON.", { error }),
        );
      }
    });
    child.stdin.end(JSON.stringify(input.request));
  });
}

function requireFreshRuntimeArguments(
  value: ParsedArguments,
): asserts value is ParsedArguments & {
  whisperServer: string;
  whisperModel: string;
  vadModel: string;
  whisperRuntimeManifest: string;
  ctcRuntimeManifest: string;
  ctcModelManifest: string;
  ctcRuntimeCapability: string;
  sudachiPython: string;
  sudachiHelper: string;
} {
  const missing = [
    ["--whisper-server", value.whisperServer],
    ["--whisper-model", value.whisperModel],
    ["--vad-model", value.vadModel],
    ["--whisper-runtime-manifest", value.whisperRuntimeManifest],
    ["--ctc-runtime-manifest", value.ctcRuntimeManifest],
    ["--ctc-model-manifest", value.ctcModelManifest],
    ["--ctc-runtime-capability", value.ctcRuntimeCapability],
    ["--sudachi-python", value.sudachiPython],
    ["--sudachi-helper", value.sudachiHelper],
  ].filter((entry) => entry[1] === null);
  if (missing.length > 0) {
    throw new Error(
      `Fresh Re-ASR requires ${missing.map((entry) => entry[0]).join(", ")}.`,
    );
  }
}

async function readFreshWhisperCache(input: {
  filePath: string;
  requestIdentity: string;
  generationId: string;
}): Promise<MvlWhisperServerResponse> {
  const record = await json<FreshWhisperCacheRecord>(input.filePath);
  if (
    record.generationId !== input.generationId ||
    record.requestIdentity !== input.requestIdentity ||
    record.responseSemanticHash !== machineQualitySemanticHash(record.response)
  ) {
    throw new InputError("Fresh Whisper cache identity mismatch.", {
      cacheFileName: path.basename(input.filePath),
    });
  }
  return mvlWhisperServerResponseSchema.parse(record.response);
}

async function writeFreshWhisperCache(input: {
  filePath: string;
  requestIdentity: string;
  generationId: string;
  response: MvlWhisperServerResponse;
}): Promise<void> {
  await mkdir(path.dirname(input.filePath), { recursive: true });
  await atomicWriteJson(input.filePath, {
    schemaVersion: "1.0.0",
    cacheNamespace: FRESH_CACHE_NAMESPACE,
    generationId: input.generationId,
    requestIdentity: input.requestIdentity,
    response: input.response,
    responseSemanticHash: machineQualitySemanticHash(input.response),
  } satisfies FreshWhisperCacheRecord);
}

async function executeFreshWhisper(input: {
  arguments: ParsedArguments & {
    whisperServer: string;
    whisperModel: string;
    vadModel: string;
    whisperRuntimeManifest: string;
  };
  sourceSha256: string;
  modelSha256: string;
  runtime: WhisperRuntimeManifest;
  plan: ReturnType<typeof planFreshTargetedReAsr>;
}): Promise<{
  executions: ExecutedFreshReAsrRequest[];
  wallTimeSeconds: number;
  extractionCacheHitCount: number;
}> {
  let pool: WhisperCppWorkerPool | null = null;
  const executions: ExecutedFreshReAsrRequest[] = [];
  let extractionCacheHitCount = 0;
  const startedAt = performance.now();
  try {
    const requests = input.plan.flatMap((event) => event.requests);
    let completed = 0;
    for (const request of requests) {
      const audio = await ensureExtractedAudio({
        source: input.arguments.source,
        sourceSha256: input.sourceSha256,
        startSample: request.sourceGlobalSampleInterval.startSample,
        endSample: request.sourceGlobalSampleInterval.endSample,
        ffmpeg: input.arguments.ffmpeg,
        cacheRoot: input.arguments.freshCache,
      });
      if (audio.cacheHit) extractionCacheHitCount += 1;
      const requestIdentity = machineQualitySemanticHash({
        cacheNamespace: FRESH_CACHE_NAMESPACE,
        policy: "source-global-null-prompt-no-vad-token-timestamps-v1",
        generationId: input.arguments.generationId,
        eventId: request.eventId,
        windowType: request.windowType,
        sourceMediaSha256: input.sourceSha256,
        sourceGlobalSampleInterval: request.sourceGlobalSampleInterval,
        extractionIdentity: audio.commandIdentity,
        audioSha256: audio.audioSha256,
        runtimeBinarySha256: input.runtime.patched.binarySha256,
        runtimePatchSha256: input.runtime.patch.patchSha256,
        modelSha256: input.modelSha256,
        prompt: null,
        useVad: false,
      });
      const filePath = cachePath(
        input.arguments.freshCache,
        FRESH_WHISPER_FAMILY,
        requestIdentity,
      );
      const cacheExists = await exists(filePath);
      if (input.arguments.generationKind === "fresh" && cacheExists) {
        throw new InputError(
          "Official Fresh generation refuses an existing transcript cache entry.",
          { requestId: request.requestId, requestIdentity },
        );
      }
      if (input.arguments.generationKind === "replay" && !cacheExists) {
        throw new InputError(
          "Frozen Fresh replay is missing an exact transcript cache entry.",
          { requestId: request.requestId, requestIdentity },
        );
      }
      let response: MvlWhisperServerResponse;
      let inferenceExecuted = false;
      let modelLoadCount = 0;
      let processStartCount = 0;
      let transcriptionSeconds = 0;
      if (cacheExists) {
        response = await readFreshWhisperCache({
          filePath,
          requestIdentity,
          generationId: input.arguments.generationId,
        });
      } else {
        pool ??= new WhisperCppWorkerPool({
          mode: "persistent",
          stateIsolation: "require-safe",
        });
        const before = pool.metrics();
        const inferenceStartedAt = performance.now();
        const result = await pool.transcribe({
          request: {
            audioPath: audio.audioPath,
            chunk: {
              id: request.requestId,
              relativePath: path.basename(audio.audioPath),
              start: request.sourceGlobalInterval.start,
              end: request.sourceGlobalInterval.end,
              duration: audio.sampleCount / SOURCE_SAMPLE_RATE,
              sha256: audio.audioSha256,
            },
            language: "ja",
            timestampStrategy: "segment",
            tokenTimestamps: true,
          },
          capability: {
            executablePath: input.arguments.whisperServer,
            modelPath: input.arguments.whisperModel,
            modelHash: input.modelSha256,
            whisperCppVersion: input.runtime.upstream.tag,
            coreML: false,
            threads: 8,
            language: "ja",
            vadModelPath: input.arguments.vadModel,
            useVad: false,
            vadProfile: "sensitive-v2",
            tokenTimestamps: true,
            promptConstraint: "clean-prompt-null",
            serverPath: input.arguments.whisperServer,
            timestampRuntimePolicy: "require-mapped",
            rawVadPolicy: "auto",
            mvlResponseSchemaVersion: input.runtime.patch.responseSchema,
            expectedMvlRuntime: {
              upstreamCommit: input.runtime.upstream.commit,
              patchId: input.runtime.patch.patchId,
              patchSha256: input.runtime.patch.patchSha256,
              binarySha256: input.runtime.patched.binarySha256,
              buildFlagsHash: input.runtime.build.flagsHash,
            },
          },
          initialPrompt: null,
          processFallback: () =>
            Promise.reject(
              new InputError("Persistent Whisper fallback is forbidden."),
            ),
        });
        transcriptionSeconds = (performance.now() - inferenceStartedAt) / 1000;
        response = mvlWhisperServerResponseSchema.parse(
          (result.raw as { mvlResponse?: unknown }).mvlResponse,
        );
        const after = pool.metrics();
        inferenceExecuted = true;
        modelLoadCount = Math.max(
          0,
          after.modelLoadCount - before.modelLoadCount,
        );
        processStartCount = Math.max(
          0,
          after.workerStartCount - before.workerStartCount,
        );
        await writeFreshWhisperCache({
          filePath,
          requestIdentity,
          generationId: input.arguments.generationId,
          response,
        });
      }
      executions.push({
        plan: request,
        extractionIdentity: audio.commandIdentity,
        requestIdentity,
        audioSha256: audio.audioSha256,
        sampleCount: audio.sampleCount,
        cacheHit: cacheExists,
        inferenceExecuted,
        modelLoadCount,
        processStartCount,
        transcriptionSeconds,
        response,
      });
      completed += 1;
      console.error(
        JSON.stringify({
          stage: "c6-0-1-7-fresh-whisper",
          generationKind: input.arguments.generationKind,
          completed,
          total: requests.length,
          eventId: request.eventId,
          windowType: request.windowType,
          cacheHit: cacheExists,
          inferenceExecuted,
          transcriptionSeconds,
        }),
      );
    }
  } finally {
    if (pool !== null) await pool.close();
  }
  return {
    executions,
    wallTimeSeconds: (performance.now() - startedAt) / 1000,
    extractionCacheHitCount,
  };
}

function ctcScoreFromAttempt(attempt: CtcAlignmentAttempt): number | null {
  if (!attempt.pathExists) return null;
  const spanFit =
    attempt.targetSpanToWindowRatio === null
      ? 0
      : Math.max(
          0,
          1 - Math.abs(1 - Math.min(1, attempt.targetSpanToWindowRatio)),
        );
  return Math.max(
    0,
    Math.min(
      1,
      0.35 +
        (attempt.meanTokenPosterior ?? 0) * 0.3 +
        attempt.greedyNormalizedSimilarity * 0.25 +
        spanFit * 0.1,
    ),
  );
}

async function runFreshCtc(input: {
  arguments: ParsedArguments & {
    ctcRuntimeManifest: string;
    ctcModelManifest: string;
    ctcRuntimeCapability: string;
    sudachiPython: string;
    sudachiHelper: string;
  };
  sourceSha256: string;
  sourceTotalSamples: number;
  drafts: ReturnType<typeof buildFreshCandidateDrafts>;
}): Promise<CtcExecutionAudit> {
  if (input.drafts.length === 0) {
    return {
      evidenceByCandidateId: new Map(),
      requestCount: 0,
      cacheHitCount: 0,
      inferenceCount: 0,
      modelLoadCount: 0,
      workerStartCount: 0,
      runtimeIdentityHash: null,
      modelSnapshotHash: null,
      deviceUsed: null,
    };
  }
  const verified = await loadAndVerifyCtcRuntime({
    runtimeManifestPath: input.arguments.ctcRuntimeManifest,
    modelManifestPath: input.arguments.ctcModelManifest,
  });
  const capability = ctcRuntimeCapabilitySchema.parse(
    await json<unknown>(input.arguments.ctcRuntimeCapability),
  );
  if (
    capability.runtimeIdentityHash !== verified.runtime.runtimeIdentityHash ||
    capability.modelSnapshotHash !== verified.model.modelSnapshotHash
  ) {
    throw new InputError("CTC runtime capability identity mismatch.");
  }
  const rawReadings = (await runJsonProcess({
    executable: input.arguments.sudachiPython,
    args: [input.arguments.sudachiHelper],
    request: {
      items: input.drafts.map((candidate) => ({
        id: candidate.candidateId,
        text: candidate.text,
      })),
    },
  })) as {
    items: {
      id: string;
      reading: string | null;
      unresolvedOov: string[];
    }[];
  };
  const readings = new Map(
    rawReadings.items.map((item) => [
      item.id,
      { reading: item.reading, unresolvedUnits: item.unresolvedOov },
    ]),
  );
  const projections = projectJapanesePronunciationBatch({
    variants: input.drafts.map((candidate) => ({
      variantId: candidate.candidateId,
      displayText: candidate.text,
    })),
    machineReadings: readings,
  });
  const projectionByCandidateId = new Map(
    projections.map((projection) => [
      projection.projectionId.replace(/^acoustic-projection:/u, ""),
      projection,
    ]),
  );
  const evidenceByCandidateId = new Map<string, FreshCandidateCtcEvidence>();
  let worker: LocalCtcWorker | null = null;
  let cacheHitCount = 0;
  let inferenceCount = 0;
  let modelLoadCount = 0;
  let workerStartCount = 0;
  try {
    let completed = 0;
    for (const candidate of input.drafts) {
      const projection = projectionByCandidateId.get(candidate.candidateId);
      if (
        projection === undefined ||
        projection.method === "unscorable" ||
        projection.projectionText === ""
      ) {
        evidenceByCandidateId.set(candidate.candidateId, {
          status: "UNSCORABLE",
          score: null,
          evidenceId: null,
          runtimeIdentityHash: capability.runtimeIdentityHash,
          modelSnapshotHash: capability.modelSnapshotHash,
          edgePinned: null,
          pronunciationStatus: "UNSCORABLE",
          projectionTextHash: null,
          unresolvedUnits:
            projection?.unresolvedUnits ??
            readings.get(candidate.candidateId)?.unresolvedUnits ??
            [],
        });
        continue;
      }
      const startSample = Math.max(
        0,
        Math.floor(candidate.sourceGlobalInterval.start * SOURCE_SAMPLE_RATE),
      );
      const endSample = Math.min(
        input.sourceTotalSamples,
        Math.max(
          startSample + 1,
          Math.ceil(candidate.sourceGlobalInterval.end * SOURCE_SAMPLE_RATE),
        ),
      );
      const audio = await ensureExtractedAudio({
        source: input.arguments.source,
        sourceSha256: input.sourceSha256,
        startSample,
        endSample,
        ffmpeg: input.arguments.ffmpeg,
        cacheRoot: input.arguments.freshCache,
      });
      const cacheIdentity = machineQualitySemanticHash({
        family: FRESH_CTC_FAMILY,
        cacheNamespace: FRESH_CACHE_NAMESPACE,
        generationId: input.arguments.generationId,
        candidateId: candidate.candidateId,
        audioSha256: audio.audioSha256,
        projectionTextHash: projection.projectionTextHash,
        runtimeIdentityHash: capability.runtimeIdentityHash,
        modelSnapshotHash: capability.modelSnapshotHash,
        viterbiPolicy: "mvl-ctc-viterbi-v1",
      });
      const filePath = cachePath(
        input.arguments.freshCache,
        FRESH_CTC_FAMILY,
        cacheIdentity,
      );
      const cacheExists = await exists(filePath);
      if (input.arguments.generationKind === "fresh" && cacheExists) {
        throw new InputError(
          "Official Fresh generation refuses an existing CTC cache entry.",
          { candidateId: candidate.candidateId },
        );
      }
      if (input.arguments.generationKind === "replay" && !cacheExists) {
        throw new InputError(
          "Frozen Fresh replay is missing exact CTC evidence.",
          {
            candidateId: candidate.candidateId,
          },
        );
      }
      let attempt: CtcAlignmentAttempt;
      if (cacheExists) {
        attempt = ctcAlignmentAttemptSchema.parse(
          await json<unknown>(filePath),
        );
        cacheHitCount += 1;
      } else {
        worker ??= new LocalCtcWorker({
          ...verified,
          device: capability.deviceUsed,
          workerScriptPath: path.resolve("scripts/runtime/ctc_worker.py"),
        });
        if (workerStartCount === 0) workerStartCount = 1;
        attempt = await worker.align({
          attemptId: `ctc-c6017:${cacheIdentity.slice(0, 24)}`,
          cueId: candidate.candidateId,
          componentId: candidate.eventId,
          windowType: "narrow",
          audioPath: audio.audioPath,
          audioSha256: audio.audioSha256,
          audioLocalInterval: {
            start: 0,
            end: audio.sampleCount / SOURCE_SAMPLE_RATE,
          },
          mediaGlobalInterval: {
            start: startSample / SOURCE_SAMPLE_RATE,
            end: endSample / SOURCE_SAMPLE_RATE,
          },
          targetText: projection.projectionText,
        });
        inferenceCount += 1;
        modelLoadCount += attempt.modelLoadCount;
        await mkdir(path.dirname(filePath), { recursive: true });
        await atomicWriteJson(filePath, attempt);
      }
      const score = ctcScoreFromAttempt(attempt);
      evidenceByCandidateId.set(candidate.candidateId, {
        status: score === null ? "UNSCORABLE" : "SCORABLE",
        score,
        evidenceId: attempt.attemptId,
        runtimeIdentityHash: capability.runtimeIdentityHash,
        modelSnapshotHash: capability.modelSnapshotHash,
        edgePinned:
          attempt.startPinnedToWindowEdge || attempt.endPinnedToWindowEdge,
        pronunciationStatus: "PROJECTED",
        projectionTextHash: projection.projectionTextHash,
        unresolvedUnits: projection.unresolvedUnits,
      });
      completed += 1;
      console.error(
        JSON.stringify({
          stage: "c6-0-1-7-fresh-ctc",
          generationKind: input.arguments.generationKind,
          completed,
          total: input.drafts.length,
          candidateId: candidate.candidateId,
          cacheHit: cacheExists,
          inferenceExecuted: !cacheExists,
        }),
      );
    }
  } finally {
    if (worker !== null) await worker.close();
  }
  return {
    evidenceByCandidateId,
    requestCount: evidenceByCandidateId.size,
    cacheHitCount,
    inferenceCount,
    modelLoadCount,
    workerStartCount,
    runtimeIdentityHash: capability.runtimeIdentityHash,
    modelSnapshotHash: capability.modelSnapshotHash,
    deviceUsed: capability.deviceUsed,
  };
}

function repetitionRatio(text: string): number {
  const normalized = Array.from(normalizeCandidateText(text));
  if (normalized.length < 2) return 0;
  const pairs = normalized
    .slice(0, -1)
    .map((value, index) => `${value}${normalized[index + 1] ?? ""}`);
  return 1 - new Set(pairs).size / pairs.length;
}

function oldCandidateInput(input: {
  candidate: CandidatePoolCandidate;
  originalVariantId: string;
  variant:
    | ReturnType<
        typeof machineVariantEvidenceBundleSchema.parse
      >["variants"][number]
    | undefined;
}): FreshComparisonCandidateInput {
  const decoder = input.variant?.decoderEvidence;
  const noSpeech = decoder?.noSpeechProbability ?? null;
  const repetition =
    decoder?.repetitionRatio ?? repetitionRatio(input.candidate.text);
  const edgeCount = [
    input.variant?.edgeEvidence.leftEdgeRisk ?? false,
    input.variant?.edgeEvidence.rightEdgeRisk ?? false,
  ].filter(Boolean).length;
  const origin =
    input.candidate.variantId === input.originalVariantId
      ? ("ORIGINAL" as const)
      : input.candidate.origin.includes("c6.0.1.4") ||
          input.candidate.origin.includes("c6.0.1.5") ||
          input.candidate.variantId.includes("reasr")
        ? ("HISTORICAL_REASR" as const)
        : ("RECOVERY" as const);
  return {
    candidateId: input.candidate.variantId,
    eventId: input.candidate.eventId,
    origin,
    text: input.candidate.text,
    ctcSupport: input.variant?.ctcScore ?? null,
    averageLogProbability: decoder?.averageLogProbability ?? null,
    noSpeechProbability: noSpeech,
    independentWindowSupport: input.candidate.independentSupportGroups.length,
    trustedTokenCoverage: input.variant?.tokenCoverage.coverageRatio ?? 0,
    speechCompleteness: input.variant?.speechCoverage ?? 0,
    requestEdgeRisk:
      edgeCount >= 2 ? "STRONG" : edgeCount === 1 ? "WEAK" : "NONE",
    pronunciationSupport: input.variant?.ctcScore ?? null,
    repetitionRisk: repetition,
    hallucinationRisk: Math.max(
      0,
      Math.min(1, (noSpeech ?? 0.5) * 0.7 + repetition * 0.3),
    ),
    evidenceComplete:
      input.candidate.evidenceCompleteness === "COMPLETE" &&
      input.variant?.evidenceCompleteness === "COMPLETE",
  };
}

function comparisonEvents(input: {
  riskEventIds: readonly string[];
  poolEvents: readonly CandidatePoolEvent[];
  candidates: readonly CandidatePoolCandidate[];
  variants: ReturnType<
    typeof machineVariantEvidenceBundleSchema.parse
  >["variants"];
  freshCandidates: readonly FreshReAsrCandidate[];
  lineage: MachineEventFinalTextSpanLineage;
  applyReplacement: boolean;
  applicationResults?: ReadonlyMap<
    string,
    {
      applied: boolean;
      blocker:
        "NONE" | "SELECTOR" | "SPAN_LINEAGE" | "SAFETY_GATE" | "ASSOCIATION";
    }
  >;
}) {
  const poolEventById = new Map(
    input.poolEvents.map((event) => [event.eventId, event] as const),
  );
  const candidatesByEvent = new Map<string, CandidatePoolCandidate[]>();
  for (const candidate of input.candidates) {
    const values = candidatesByEvent.get(candidate.eventId) ?? [];
    values.push(candidate);
    candidatesByEvent.set(candidate.eventId, values);
  }
  const variantById = new Map(
    input.variants.map((variant) => [variant.variantId, variant] as const),
  );
  const freshByEvent = new Map<string, FreshComparisonCandidateInput[]>();
  for (const candidate of freshCandidateInputs(input.freshCandidates)) {
    const values = freshByEvent.get(candidate.eventId) ?? [];
    values.push(candidate);
    freshByEvent.set(candidate.eventId, values);
  }
  const lineageByEvent = new Map(
    input.lineage.events.map((event) => [event.eventId, event] as const),
  );
  return input.riskEventIds.flatMap((eventId) => {
    const poolEvent = poolEventById.get(eventId);
    if (poolEvent === undefined) return [];
    const lineage = lineageByEvent.get(eventId);
    const oldCandidates = (candidatesByEvent.get(eventId) ?? []).map(
      (candidate) =>
        oldCandidateInput({
          candidate,
          originalVariantId: poolEvent.currentVariantId,
          variant: variantById.get(candidate.variantId),
        }),
    );
    const freshCandidates = freshByEvent.get(eventId) ?? [];
    const spanLineageSafe =
      lineage?.modifiable === true &&
      lineage.finalCueId !== null &&
      lineage.spanStart !== null &&
      lineage.spanEnd !== null &&
      lineage.spanText !== null &&
      lineage.confidenceClass === "STRONG";
    const associationSafe =
      lineage?.finalCueId !== null &&
      lineage?.alignmentMethod !== "UNRESOLVED" &&
      !(lineage?.blockers ?? []).some((blocker) =>
        blocker.toLowerCase().includes("association"),
      );
    const applicationResult = input.applicationResults?.get(eventId);
    return [
      {
        eventId,
        originalCandidateId: poolEvent.currentVariantId,
        candidates: [...oldCandidates, ...freshCandidates],
        spanLineageSafe,
        associationSafe,
        safetyGatePass:
          spanLineageSafe &&
          associationSafe &&
          freshCandidates.some((candidate) => candidate.evidenceComplete),
        applyReplacement: input.applyReplacement,
        ...(applicationResult === undefined ? {} : { applicationResult }),
      },
    ];
  });
}

function replacementBlocker(
  proposal:
    | ReturnType<
        typeof buildAndApplySpanTextRepair
      >["artifact"]["proposals"][number]
    | undefined,
  textApplicationMode: C6017Mode,
): "NONE" | "SELECTOR" | "SPAN_LINEAGE" | "SAFETY_GATE" | "ASSOCIATION" {
  if (proposal?.applied === true) return "NONE";
  if (textApplicationMode !== "enforce") return "SELECTOR";
  if (
    proposal?.rejectReasons.some((reason) =>
      [
        "final-cue-unavailable",
        "span-lineage-not-verified",
        "neighboring-event-span-overlap",
      ].includes(reason),
    ) === true
  ) {
    return "SPAN_LINEAGE";
  }
  if (proposal?.rejectReasons.includes("cross-speaker-join-risk") === true) {
    return "ASSOCIATION";
  }
  return "SAFETY_GATE";
}

function packageHashes(value: SubtitlePackage) {
  const ass = formatAss(value.cues);
  const srt = formatSrt(value.cues);
  const vtt = formatVtt(value.cues);
  return {
    canonicalTextHash: machineQualitySemanticHash(
      value.cues.map((cue) => [cue.id, cue.text]),
    ),
    canonicalTimingHash: machineQualitySemanticHash(
      value.cues.map((cue) => [cue.id, cue.start, cue.end]),
    ),
    presentationHash: machineQualitySemanticHash({ ass, srt, vtt }),
    assHash: machineQualitySemanticHash(ass),
    srtHash: machineQualitySemanticHash(srt),
    vttHash: machineQualitySemanticHash(vtt),
  };
}

function updateManifest(input: {
  baseline: BlindGenerationInputManifest;
  arguments: ParsedArguments;
}): BlindGenerationInputManifest {
  const memoryBase = {
    storeId: `c6-0-1-7-empty-memory-${input.arguments.stage}-${input.arguments.repositoryCommit.slice(0, 12)}`,
    entryCount: 0 as const,
    humanDerived: false as const,
  };
  const { inputSemanticHash: _oldHash, ...oldBase } = input.baseline;
  void _oldHash;
  const base = {
    ...oldBase,
    generatedAt: GENERATED_AT,
    generationRunId: `c6-0-1-7-${input.arguments.stage}-${input.arguments.repositoryCommit.slice(0, 12)}`,
    repositoryCommit: input.arguments.repositoryCommit,
    machineMemoryInitialState: {
      ...memoryBase,
      storeHash: c60StableHash(memoryBase),
    },
    generationArguments: [
      "run:c6-0-1-7-machine",
      "--stage",
      input.arguments.stage,
      "--reasr-risk-v2",
      input.arguments.riskMode,
      "--fresh-targeted-reasr",
      input.arguments.freshMode,
      "--text-application",
      input.arguments.textApplicationMode,
      "--asr-ceiling-validation",
      input.arguments.ceilingMode,
      "--generation-kind",
      input.arguments.generationKind,
      "--generation-id",
      input.arguments.generationId,
      "--fresh-cache-dir",
      `isolated-${FRESH_CACHE_NAMESPACE}`,
      "--prompt",
      "null",
      "--network",
      "off",
    ],
  };
  return blindGenerationInputManifestSchema.parse({
    ...base,
    inputSemanticHash: c60SemanticHash(base),
  });
}

const argumentsValue = parseArguments(process.argv.slice(2));
if (!/^[a-f0-9]{40}$/u.test(argumentsValue.repositoryCommit)) {
  throw new Error("--repository-commit must be a full Git SHA.");
}
if (argumentsValue.freshMode !== "off") {
  requireFreshRuntimeArguments(argumentsValue);
}

const baselineSubtitle = await onlySubtitleDirectory(argumentsValue.baseline);
const outputSubtitle = await cloneBaseline({
  baseline: argumentsValue.baseline,
  output: argumentsValue.output,
});
const sourceHashBefore = await sha256File(argumentsValue.source);
const sourceStatBefore = await stat(argumentsValue.source);
const baselineManifest = blindGenerationInputManifestSchema.parse(
  await json<unknown>(
    path.join(argumentsValue.baseline, "blind-generation-input-manifest.json"),
  ),
);
if (
  sourceHashBefore !== baselineManifest.sourceVideo.sha256 ||
  sourceStatBefore.size !== baselineManifest.sourceVideo.size
) {
  throw new InputError(
    "Source media identity differs from the frozen baseline.",
  );
}

const [
  packageValue,
  riskVector,
  candidatePool,
  variantEvidence,
  spanLineage,
  canonical,
] = await Promise.all([
  json<unknown>(path.join(baselineSubtitle, "subtitle-package.json")).then(
    (value) => subtitlePackageSchema.parse(value),
  ),
  json<unknown>(
    path.join(baselineSubtitle, "machine-acoustic-risk-vector.json"),
  ).then((value) => machineAcousticRiskVectorSchema.parse(value)),
  json<unknown>(
    path.join(baselineSubtitle, "machine-candidate-pool-c6-0-1-5.json"),
  ).then((value) => machineCandidatePoolC6015Schema.parse(value)),
  json<unknown>(
    path.join(baselineSubtitle, "machine-variant-evidence-bundle.json"),
  ).then((value) => machineVariantEvidenceBundleSchema.parse(value)),
  json<unknown>(
    path.join(baselineSubtitle, "machine-event-final-text-span-lineage.json"),
  ).then((value) => machineEventFinalTextSpanLineageSchema.parse(value)),
  json<CanonicalEventsArtifact>(
    path.join(baselineSubtitle, "machine-canonical-events.json"),
  ),
]);

const policy = buildC6017QualityPolicy({
  policyFrozenAt: POLICY_FROZEN_AT,
  generatedAt: GENERATED_AT,
});
const riskV2 = buildMachineReAsrRiskV2({
  mode: argumentsValue.riskMode,
  riskVector: riskVector.events,
  generatedAt: GENERATED_AT,
});
const eventIntervals = new Map(
  canonical.events.map((event) => [event.eventId, event.acousticInterval]),
);
const sourceTotalSamples = Math.max(
  1,
  Math.ceil(packageValue.source.durationSeconds * SOURCE_SAMPLE_RATE),
);
const freshPlan = planFreshTargetedReAsr({
  risk: riskV2,
  eventIntervals,
  sourceTotalSamples,
  generationId: argumentsValue.generationId,
});
const selectionCore = {
  mode: argumentsValue.freshMode,
  generationId: argumentsValue.generationId,
  selectionPolicy:
    "positive-error-first-budgeted-machine-only-no-gold-v1" as const,
  selectedEvents: freshPlan.map((event) => ({
    eventId: event.eventId,
    candidateId: event.candidateId,
    sourceGlobalInterval: event.sourceGlobalInterval,
    requestIds: event.requests.map((request) => request.requestId),
    selectionEvidenceIds: event.selectionEvidenceIds,
  })),
  selectedEvidenceAbsenceOnlyCount: riskV2.events.filter(
    (event) => event.budgetSelected && event.absenceOnly,
  ).length,
  plannedRequestCount: freshPlan.reduce(
    (sum, event) => sum + event.requests.length,
    0,
  ),
  runtimeGoldInputCount: 0,
};
const selectionPlan = {
  schemaVersion: "1.0.0",
  policyVersion: policy.policyVersion,
  generatedAt: GENERATED_AT,
  artifactType: "machine-fresh-reasr-selection-plan",
  ...selectionCore,
  semanticHash: machineQualitySemanticHash(selectionCore),
};

let freshArtifact: ReturnType<typeof buildMachineFreshTargetedReAsr> | null =
  null;
let comparison: MachineFreshCandidateComparison | null = null;
let finalPackage = packageValue;
let freshSpanRepair: ReturnType<typeof buildAndApplySpanTextRepair> | null =
  null;
let whisperWallTimeSeconds = 0;
let extractionCacheHitCount = 0;
let ctcAudit: CtcExecutionAudit = {
  evidenceByCandidateId: new Map(),
  requestCount: 0,
  cacheHitCount: 0,
  inferenceCount: 0,
  modelLoadCount: 0,
  workerStartCount: 0,
  runtimeIdentityHash: null,
  modelSnapshotHash: null,
  deviceUsed: null,
};
let whisperRuntime: WhisperRuntimeManifest | null = null;
let whisperModelSha256: string | null = null;

if (argumentsValue.freshMode !== "off") {
  requireFreshRuntimeArguments(argumentsValue);
  whisperRuntime = await json<WhisperRuntimeManifest>(
    argumentsValue.whisperRuntimeManifest,
  );
  if (
    (await sha256File(argumentsValue.whisperServer)) !==
    whisperRuntime.patched.binarySha256
  ) {
    throw new InputError("Whisper binary hash differs from runtime manifest.");
  }
  whisperModelSha256 =
    argumentsValue.whisperModelSha256 ??
    (await sha256File(argumentsValue.whisperModel));
  const whisperExecution = await executeFreshWhisper({
    arguments: argumentsValue,
    sourceSha256: sourceHashBefore,
    modelSha256: whisperModelSha256,
    runtime: whisperRuntime,
    plan: freshPlan,
  });
  whisperWallTimeSeconds = whisperExecution.wallTimeSeconds;
  extractionCacheHitCount = whisperExecution.extractionCacheHitCount;
  const drafts = buildFreshCandidateDrafts(whisperExecution.executions);
  ctcAudit = await runFreshCtc({
    arguments: argumentsValue,
    sourceSha256: sourceHashBefore,
    sourceTotalSamples,
    drafts,
  });
  freshArtifact = buildMachineFreshTargetedReAsr({
    mode: argumentsValue.freshMode,
    generationKind:
      argumentsValue.generationKind === "fresh"
        ? "FRESH_INFERENCE"
        : "FROZEN_EXACT_CACHE_REPLAY",
    sourceMediaSha256: sourceHashBefore,
    sourceTotalSamples,
    plannedEvents: freshPlan,
    executedRequests: whisperExecution.executions,
    ctcEvidenceByCandidateId: ctcAudit.evidenceByCandidateId,
    runtime: {
      whisperCppVersion: whisperRuntime.upstream.tag,
      runtimeBinarySha256: whisperRuntime.patched.binarySha256,
      runtimePatchSha256: whisperRuntime.patch.patchSha256,
      modelSha256: whisperModelSha256,
      modelBasename: path.basename(argumentsValue.whisperModel),
      device: argumentsValue.whisperDevice,
    },
    generatedAt: GENERATED_AT,
  });
  const candidateValues = candidatePool.candidates as CandidatePoolCandidate[];
  const poolEvents = candidatePool.events as CandidatePoolEvent[];
  const selectedEventIds = freshPlan.map((event) => event.eventId);
  const preComparison = buildFreshCandidateComparison({
    events: comparisonEvents({
      riskEventIds: selectedEventIds,
      poolEvents,
      candidates: candidateValues,
      variants: variantEvidence.variants,
      freshCandidates: freshArtifact.candidates,
      lineage: spanLineage,
      applyReplacement:
        argumentsValue.freshMode === "enforce" &&
        argumentsValue.textApplicationMode === "enforce",
    }),
    generatedAt: GENERATED_AT,
  });
  const freshCandidateById = new Map(
    freshArtifact.candidates.map((candidate) => [
      candidate.candidateId,
      candidate,
    ]),
  );
  const selections: SpanRepairSelectionInput[] = preComparison.events.flatMap(
    (event) => {
      if (!event.replacementProposed || event.freshTopCandidateId === null) {
        return [];
      }
      const candidate = freshCandidateById.get(event.freshTopCandidateId);
      if (candidate === undefined) return [];
      return [
        {
          eventId: event.eventId,
          replacementCandidateId: candidate.candidateId,
          replacementText: candidate.text,
          replacementEventId: candidate.eventId,
          evidenceIds: [
            candidate.semanticHash,
            ...candidate.requestIds,
            ...(candidate.ctcEvidence.evidenceId === null
              ? []
              : [candidate.ctcEvidence.evidenceId]),
          ],
          evidenceStronger: true,
          hallucinationNonIncreasePassed: true,
          timingCompatible: candidate.globalTokenMappingVerified,
          crossSpeakerJoinSafe: true,
        },
      ];
    },
  );
  freshSpanRepair = buildAndApplySpanTextRepair({
    mode:
      argumentsValue.freshMode === "enforce"
        ? argumentsValue.textApplicationMode
        : "off",
    package: packageValue,
    lineage: spanLineage,
    selections,
    generatedAt: GENERATED_AT,
  });
  const proposalByEvent = new Map(
    freshSpanRepair.artifact.proposals.map((proposal) => [
      proposal.eventId,
      proposal,
    ]),
  );
  const applicationResults = new Map(
    preComparison.events
      .filter((event) => event.replacementProposed)
      .map((event) => {
        const proposal = proposalByEvent.get(event.eventId);
        return [
          event.eventId,
          {
            applied: proposal?.applied ?? false,
            blocker: replacementBlocker(
              proposal,
              argumentsValue.textApplicationMode,
            ),
          },
        ] as const;
      }),
  );
  comparison = buildFreshCandidateComparison({
    events: comparisonEvents({
      riskEventIds: selectedEventIds,
      poolEvents,
      candidates: candidateValues,
      variants: variantEvidence.variants,
      freshCandidates: freshArtifact.candidates,
      lineage: spanLineage,
      applyReplacement:
        argumentsValue.freshMode === "enforce" &&
        argumentsValue.textApplicationMode === "enforce",
      applicationResults,
    }),
    generatedAt: GENERATED_AT,
  });
  finalPackage = subtitlePackageSchema.parse(freshSpanRepair.package);
}

await Promise.all([
  atomicWriteJson(
    path.join(outputSubtitle, "machine-reasr-risk-v2.json"),
    riskV2,
  ),
  atomicWriteJson(
    path.join(outputSubtitle, "machine-fresh-reasr-selection-plan.json"),
    selectionPlan,
  ),
  atomicWriteJson(
    path.join(outputSubtitle, "c6-0-1-7-quality-policy.json"),
    policy,
  ),
  atomicWriteJson(
    path.join(outputSubtitle, "subtitle-package.json"),
    finalPackage,
    {
      overwrite: true,
    },
  ),
  atomicWriteJson(
    path.join(outputSubtitle, "subtitle-package.needs-review.json"),
    finalPackage,
    { overwrite: true },
  ),
  ...(freshArtifact === null
    ? []
    : [
        atomicWriteJson(
          path.join(outputSubtitle, "machine-fresh-targeted-reasr.json"),
          freshArtifact,
        ),
      ]),
  ...(comparison === null
    ? []
    : [
        atomicWriteJson(
          path.join(outputSubtitle, "machine-fresh-candidate-comparison.json"),
          comparison,
        ),
      ]),
  ...(freshSpanRepair === null
    ? []
    : [
        atomicWriteJson(
          path.join(outputSubtitle, "machine-fresh-span-text-repair.json"),
          freshSpanRepair.artifact,
        ),
      ]),
]);

const assPath = finalPackage.subtitleFiles.ass;
const srtPath = finalPackage.subtitleFiles.srt;
const vttPath = finalPackage.subtitleFiles.vtt;
if (assPath === null || srtPath === null || vttPath === null) {
  throw new InputError("Strict subtitle package is missing ASS/SRT/VTT paths.");
}
await Promise.all([
  atomicWriteFile(
    path.join(outputSubtitle, assPath),
    formatAss(finalPackage.cues),
    {
      overwrite: true,
    },
  ),
  atomicWriteFile(
    path.join(outputSubtitle, srtPath),
    formatSrt(finalPackage.cues),
    {
      overwrite: true,
    },
  ),
  atomicWriteFile(
    path.join(outputSubtitle, vttPath),
    formatVtt(finalPackage.cues),
    {
      overwrite: true,
    },
  ),
]);

const sourceHashAfter = await sha256File(argumentsValue.source);
const sourceStatAfter = await stat(argumentsValue.source);
if (
  sourceHashAfter !== sourceHashBefore ||
  sourceStatAfter.size !== sourceStatBefore.size
) {
  throw new InputError("Source media changed during Fresh Re-ASR execution.");
}
const baselineHashes = packageHashes(packageValue);
const finalHashes = packageHashes(finalPackage);
const manifest = updateManifest({
  baseline: baselineManifest,
  arguments: argumentsValue,
});
const memoryBase = {
  schemaVersion: "1.0.0",
  artifactType: "machine-only-series-memory",
  storeId: manifest.machineMemoryInitialState.storeId,
  createdAt: GENERATED_AT,
  entryCount: 0,
  humanDerived: false,
  entries: [],
};
const modelExecution = {
  generationKind:
    argumentsValue.freshMode === "off"
      ? "NO_MODEL"
      : argumentsValue.generationKind === "fresh"
        ? "FRESH_INFERENCE"
        : "FROZEN_EXACT_CACHE_REPLAY",
  selectedEventCount: freshPlan.length,
  plannedRequestCount: selectionCore.plannedRequestCount,
  actualRequestCount: freshArtifact?.summary.actualRequestCount ?? 0,
  cacheHitCount: freshArtifact?.summary.cacheHitCount ?? 0,
  freshInferenceCount: freshArtifact?.summary.freshInferenceCount ?? 0,
  modelLoadCount: freshArtifact?.summary.modelLoadCount ?? 0,
  processStartCount: freshArtifact?.summary.processStartCount ?? 0,
  extractionCount: freshArtifact?.summary.extractionCount ?? 0,
  extractionCacheHitCount,
  uniqueAudioShaCount: freshArtifact?.summary.uniqueAudioShaCount ?? 0,
  whisperWallTimeSeconds,
  whisperTranscriptionSeconds: freshArtifact?.summary.transcriptionSeconds ?? 0,
  ctcRequestCount: ctcAudit.requestCount,
  ctcCacheHitCount: ctcAudit.cacheHitCount,
  ctcInferenceCount: ctcAudit.inferenceCount,
  ctcModelLoadCount: ctcAudit.modelLoadCount,
  ctcWorkerStartCount: ctcAudit.workerStartCount,
};
const runAuditCore = {
  stage: argumentsValue.stage,
  generationId: argumentsValue.generationId,
  repositoryCommit: argumentsValue.repositoryCommit,
  sourceMediaSha256: sourceHashBefore,
  sourceReadOnlyVerified: sourceHashAfter === sourceHashBefore,
  policyVersion: policy.policyVersion,
  policyHash: policy.policyHash,
  modes: {
    reAsrRiskV2: argumentsValue.riskMode,
    freshTargetedReAsr: argumentsValue.freshMode,
    textApplication: argumentsValue.textApplicationMode,
    asrCeilingValidation: argumentsValue.ceilingMode,
  },
  modelIdentity: {
    whisperCppVersion: whisperRuntime?.upstream.tag ?? null,
    whisperUpstreamCommit: whisperRuntime?.upstream.commit ?? null,
    whisperRuntimeBinarySha256: whisperRuntime?.patched.binarySha256 ?? null,
    whisperRuntimePatchSha256: whisperRuntime?.patch.patchSha256 ?? null,
    whisperModelSha256,
    whisperDevice:
      argumentsValue.freshMode === "off" ? null : argumentsValue.whisperDevice,
    ctcRuntimeIdentityHash: ctcAudit.runtimeIdentityHash,
    ctcModelSnapshotHash: ctcAudit.modelSnapshotHash,
    ctcDevice: ctcAudit.deviceUsed,
  },
  modelExecution,
  artifactSemanticHashes: {
    riskV2: riskV2.semanticHash,
    selection: selectionPlan.semanticHash,
    fresh: freshArtifact?.semanticHash ?? null,
    freshCandidates: machineQualitySemanticHash(
      freshArtifact?.candidates.map((candidate) => candidate.semanticHash) ??
        [],
    ),
    comparison: comparison?.semanticHash ?? null,
    spanRepair: freshSpanRepair?.artifact.semanticHash ?? null,
  },
  baselineHashes,
  finalHashes,
  canonicalTextMutationCount:
    freshSpanRepair?.artifact.summary.appliedCount ?? 0,
  canonicalTimingMutationCount: 0,
  runtimeGoldInputCount: 0,
  candidateTextPromptLeakCount: 0,
  humanMemoryLeakCount: 0,
  networkUsed: false,
  productionStatus: "needs-review",
  finalizationMethod: "none",
  machineReleaseAuthorized: false,
};
const runAudit = {
  schemaVersion: "1.0.0",
  artifactType: "c6-0-1-7-machine-run-audit",
  generatedAt: GENERATED_AT,
  ...runAuditCore,
  semanticHash: machineQualitySemanticHash(runAuditCore),
};

await Promise.all([
  atomicWriteJson(
    path.join(argumentsValue.output, "blind-generation-input-manifest.json"),
    manifest,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(argumentsValue.output, "machine-memory.json"),
    {
      ...memoryBase,
      semanticHash: manifest.machineMemoryInitialState.storeHash,
    },
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(argumentsValue.output, "c6-0-1-7-machine-run-audit.json"),
    runAudit,
  ),
  atomicWriteJson(
    path.join(argumentsValue.output, "blind-generation-execution.json"),
    {
      schemaVersion: "1.0.0",
      artifactType: "blind-generation-execution",
      generationRunId: manifest.generationRunId,
      generationStartedAt: GENERATED_AT,
      generationCompletedAt: GENERATED_AT,
      wallTimeMs: Math.round(whisperWallTimeSeconds * 1000),
      exitCode: 0,
      sourceReadOnlyVerified: sourceHashAfter === sourceHashBefore,
      sourceHashBefore,
      sourceHashAfter,
      networkUsed: false,
      onlineSubtitleSearchUsed: false,
      cloudModelInferenceCount: 0,
    },
    { overwrite: true },
  ),
]);

const provenance = await auditBlindRunProvenance({
  taskDirectory: argumentsValue.output,
  generatedAt: GENERATED_AT,
  manifest,
});
if (!provenance.passed) {
  throw new Error(
    `Blind provenance failed: ${provenance.isolationViolations.join(",")}`,
  );
}
const evidence = await buildMachineBaselineEvidenceCoverage({
  taskDirectory: argumentsValue.output,
  generatedAt: GENERATED_AT,
  manifest,
});
const shadowPolicy = createMachineShadowPolicy();
const shadow = evaluateMachineShadowFinalization({
  generatedAt: GENERATED_AT,
  manifest,
  provenance,
  evidence,
  policy: shadowPolicy,
});
await Promise.all([
  atomicWriteJson(
    path.join(argumentsValue.output, "blind-provenance-audit.json"),
    provenance,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(argumentsValue.output, "machine-baseline-evidence-coverage.json"),
    evidence,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(argumentsValue.output, "machine-shadow-finalization-policy.json"),
    shadowPolicy,
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(argumentsValue.output, "machine-shadow-finalization.json"),
    shadow,
    { overwrite: true },
  ),
]);

const legacyHashes = await Promise.all(
  [
    "machine-request-edge-risk.json",
    "machine-decoder-evidence.json",
    "machine-acoustic-risk-vector.json",
    "machine-reasr-priority.json",
    "machine-event-final-text-span-lineage.json",
    "machine-span-text-repair.json",
    "machine-partial-boundary-proposals.json",
    "machine-joint-boundary-refinement.json",
  ].map(async (fileName) => {
    const value = await json<{ semanticHash: string }>(
      path.join(outputSubtitle, fileName),
    );
    return value.semanticHash;
  }),
);
await mkdir(path.join(argumentsValue.output, "shareable"), {
  recursive: true,
});
const shareableCore = {
  policyVersion: c6016PolicyVersion,
  stage: `c6-0-1-7-${argumentsValue.stage}`,
  runtimeGoldInputCount: 0 as const,
  networkUsed: false as const,
  productionStatus: "needs-review" as const,
  finalizationMethod: "none" as const,
  artifactRelativePaths: [
    `${path.basename(outputSubtitle)}/machine-reasr-risk-v2.json`,
    `${path.basename(outputSubtitle)}/machine-fresh-reasr-selection-plan.json`,
    ...(freshArtifact === null
      ? []
      : [
          `${path.basename(outputSubtitle)}/machine-fresh-targeted-reasr.json`,
          `${path.basename(outputSubtitle)}/machine-fresh-candidate-comparison.json`,
        ]),
  ],
  artifactSemanticHashes: {
    requestEdge: legacyHashes[0] ?? machineQualitySemanticHash("missing"),
    decoderEvidence: legacyHashes[1] ?? machineQualitySemanticHash("missing"),
    riskVector: legacyHashes[2] ?? machineQualitySemanticHash("missing"),
    reAsrPriority: legacyHashes[3] ?? machineQualitySemanticHash("missing"),
    spanLineage: legacyHashes[4] ?? machineQualitySemanticHash("missing"),
    spanRepair: legacyHashes[5] ?? machineQualitySemanticHash("missing"),
    partialBoundary: legacyHashes[6] ?? machineQualitySemanticHash("missing"),
    jointBoundary: legacyHashes[7] ?? machineQualitySemanticHash("missing"),
  },
  finalHashes,
};
const shareableSummary = c6016ShareableSummarySchema.parse({
  schemaVersion: "1.0.0",
  generatedAt: GENERATED_AT,
  artifactType: "c6-0-1-6-shareable-summary",
  ...shareableCore,
  semanticHash: machineQualitySemanticHash(shareableCore),
});
await atomicWriteJson(
  path.join(argumentsValue.output, "shareable", "c6-0-1-6-summary.json"),
  shareableSummary,
);
const shareable = await finalizeC6016ShareableArtifacts({
  taskRoot: argumentsValue.output,
});
if (!shareable.audit.validationPassed) {
  throw new Error("C6.0.1.7 shareable audit failed before output freeze.");
}
const freeze = await createBlindOutputFreeze({
  taskDirectory: argumentsValue.output,
  freezeTimestamp: GENERATED_AT,
});
await atomicWriteJson(
  path.join(argumentsValue.output, "blind-output-freeze.json"),
  freeze,
);

console.log(
  JSON.stringify(
    {
      output: argumentsValue.output,
      stage: argumentsValue.stage,
      policyVersion: policy.policyVersion,
      policyHash: policy.policyHash,
      riskV2: riskV2.summary,
      selection: {
        selectedEventCount: freshPlan.length,
        plannedRequestCount: selectionCore.plannedRequestCount,
      },
      fresh: freshArtifact?.summary ?? null,
      comparison: comparison?.summary ?? null,
      textApplication: freshSpanRepair?.artifact.summary ?? null,
      ctc: {
        requestCount: ctcAudit.requestCount,
        cacheHitCount: ctcAudit.cacheHitCount,
        inferenceCount: ctcAudit.inferenceCount,
        modelLoadCount: ctcAudit.modelLoadCount,
        workerStartCount: ctcAudit.workerStartCount,
      },
      modelExecution,
      baselineHashes,
      finalHashes,
      shadowOutcome: shadow.shadowMachineOutcome,
      productionStatus: shadow.productionStatus,
      finalizationMethod: shadow.productionFinalizationMethod,
      shareableAudit: shareable.audit,
      freezeHash: freeze.freezeSemanticHash,
    },
    null,
    2,
  ),
);

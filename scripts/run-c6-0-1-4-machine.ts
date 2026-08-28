import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, cp, mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  atomicWriteJson,
  ctcAlignmentAttemptSchema,
  ctcRuntimeCapabilitySchema,
  InputError,
  mvlWhisperServerResponseSchema,
  pathExists,
  type C6014Mode,
  type CtcAlignmentAttempt,
  type MachineTargetedEventReasr,
  type MvlWhisperServerResponse,
  type SampleTransform,
} from "@mvl/shared";
import { WhisperCppWorkerPool } from "@mvl/transcription-core";
import {
  LocalCtcWorker,
  auditBlindRunProvenance,
  assessCandidatePoolSufficiency,
  assertTargetedReasrPromptIsolation,
  buildAcousticTextVariantVerification,
  buildGlobalTokenTimelineV2,
  buildRequestTimelineV2,
  buildTargetedEventReasrArtifact,
  buildVadGlobalTimebase,
  buildTextReplacementContract,
  createBlindGenerationInputManifest,
  createBlindOutputFreeze,
  createC6014QualityPolicy,
  createRequestTimelineV2Entry,
  createSampleTransform,
  loadAndVerifyCtcRuntime,
  machineQualitySemanticHash,
  normalizeCandidateText,
  planTargetedEventReasr,
  projectJapanesePronunciationBatch,
  resolveTextVariants,
  sha256BlindFile,
  verifyBlindOutputFreeze,
  type AcousticEventVerificationInput,
  type EventVariantDecisionInput,
  type ExecutedTargetedReasrRequest,
  type PoolSufficiencyEventInput,
  inspectReviewWav,
} from "@mvl/video-subtitler";

const execFileAsync = promisify(execFile);
const POLICY_VERSION = "c6.0.1.4-vad-timebase-acoustic-text-variant-reasr-v1";
const SOURCE_SAMPLE_RATE = 16_000;

interface LegacyRequest {
  requestId: string;
  sourceMediaSha256: string;
  sourceMediaStartSeconds: number;
  sourceMediaEndSeconds: number;
  sampleRate: number;
  sampleCount: number;
  tokenTimeBase: "original-audio-local" | "vad-processed-local" | "unknown";
  cacheIdentity: string;
  vadEnabled: boolean;
  contractStatus: "verified" | "quarantined" | "unavailable";
}

interface LegacyRequestArtifact {
  requests: LegacyRequest[];
  summary: Record<string, number>;
}

interface LegacyToken {
  tokenId: string;
  cueId: string | null;
  requestId: string;
  text: string;
  localInterval: { start: number; end: number } | null;
  coordinateSystem: "original-audio-local" | "vad-processed-local" | "unknown";
  trusted: boolean;
}

interface LegacyTokenArtifact {
  tokens: LegacyToken[];
  summary: Record<string, number>;
}

interface CandidateEvidence {
  cueId: string;
  interval: { start: number; end: number };
  text: string;
  sourceRequestIds: string[];
  independentSupportCount: number;
  selectionScore: number;
  tokenTimingQuality: number;
  hardBlockReasons: string[];
  hallucinationRisk: number;
}

interface CandidateEvidenceArtifact {
  candidates: CandidateEvidence[];
}

interface AssociationRecord {
  candidateId: string;
  assignedEventId: string | null;
  disposition: string;
  hardIncompatibilities: string[];
}

interface AssociationLedger {
  records: AssociationRecord[];
  semanticHash: string;
  summary: Record<string, number | boolean>;
}

interface CanonicalEvent {
  eventId: string;
  acousticInterval: { start: number; end: number };
  candidateIds: string[];
  representativeCandidateId: string | null;
  ambiguity: { status: string; reasons: string[]; validCandidateCount: number };
  semanticHash: string;
}

interface CanonicalEventsArtifact {
  events: CanonicalEvent[];
  semanticHash: string;
  summary: Record<string, number>;
}

interface CanonicalAssemblyOperation {
  eventId: string;
  selectedCandidateId: string;
  outputCueId: string;
}

interface CanonicalAssemblyArtifact {
  operations: CanonicalAssemblyOperation[];
  semanticHash: string;
  outputCueSemanticHash: string;
}

interface CacheEntryV2 {
  identity: {
    audioContentSha256: string;
    modelHash: string;
  };
  resultSha256: string;
}

interface WhisperRuntimeManifest {
  upstream: { commit: string };
  patch: {
    patchId: string;
    patchSha256: string;
    responseSchema: string;
  };
  build: { flagsHash: string };
  patched: { binarySha256: string };
}

interface WhisperCacheRecord {
  schemaVersion: "1.0.0";
  cacheIdentity: string;
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

interface MachineVariant {
  variantId: string;
  displayText: string;
  interval: { start: number; end: number };
  sourceRequestIds: string[];
  independentSupportCount: number;
  selectionScore: number;
  tokenTimingQuality: number;
  hardRejectReasons: string[];
  hallucinationRisk: number;
}

interface MachineEvent {
  eventId: string;
  interval: { start: number; end: number };
  currentSelectedVariantId: string;
  variants: MachineVariant[];
  representativeCueId: string;
}

function parseArguments(argv: readonly string[]): Map<string, string> {
  const allowed = new Set([
    "--baseline",
    "--output",
    "--source",
    "--shared-cache",
    "--run-label",
    "--vad-mode",
    "--variant-mode",
    "--reasr-mode",
    "--ffmpeg",
    "--whisper-server",
    "--whisper-model",
    "--vad-model",
    "--whisper-runtime-manifest",
    "--ctc-runtime-manifest",
    "--ctc-model-manifest",
    "--ctc-runtime-capability",
    "--sudachi-python",
    "--sudachi-helper",
  ]);
  const parsed = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === undefined || value === undefined || !allowed.has(flag)) {
      throw new InputError("Invalid C6.0.1.4 machine-run arguments.", {
        flag,
        allowed: [...allowed],
      });
    }
    parsed.set(flag, value);
  }
  return parsed;
}

function required(args: Map<string, string>, flag: string): string {
  const value = args.get(flag);
  if (value === undefined || value === "") {
    throw new InputError(`Missing required argument ${flag}.`);
  }
  return value;
}

function parseMode(args: Map<string, string>, flag: string): C6014Mode {
  const value = required(args, flag);
  if (!(["off", "observe", "enforce"] as const).includes(value as C6014Mode)) {
    throw new InputError(`${flag} must be off, observe, or enforce.`);
  }
  return value as C6014Mode;
}

async function json<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function sha256File(filePath: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    digest.update(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return digest.digest("hex");
}

async function directoryArtifactHash(root: string): Promise<{
  artifactHash: string;
  fileCount: number;
}> {
  const files: { relativePath: string; size: number; sha256: string }[] = [];
  const visit = async (current: string): Promise<void> => {
    for (const entry of (
      await readdir(current, { withFileTypes: true })
    ).toSorted((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === ".DS_Store") continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (!entry.isFile()) {
        throw new InputError(
          "C6.0.1.4 cache inventory contains a non-regular entry.",
          { path: absolute },
        );
      }
      const info = await stat(absolute);
      files.push({
        relativePath: path.relative(root, absolute).split(path.sep).join("/"),
        size: info.size,
        sha256: await sha256File(absolute),
      });
    }
  };
  await visit(root);
  return {
    artifactHash: machineQualitySemanticHash(files),
    fileCount: files.length,
  };
}

async function onlySubtitleDirectory(task: string): Promise<string> {
  const entries = (await readdir(task, { withFileTypes: true }))
    .filter(
      (entry) => entry.isDirectory() && entry.name.startsWith("subtitle-"),
    )
    .map((entry) => entry.name)
    .toSorted();
  if (entries.length !== 1 || entries[0] === undefined) {
    throw new InputError("Expected exactly one subtitle artifact directory.", {
      task,
      entries,
    });
  }
  return path.join(task, entries[0]);
}

async function cloneFrozenMachinePackage(input: {
  baseline: string;
  output: string;
}): Promise<string> {
  if (await pathExists(input.output)) {
    throw new InputError(
      "C6.0.1.4 output already exists; overwrite is forbidden.",
      {
        output: input.output,
      },
    );
  }
  await verifyBlindOutputFreeze({ taskDirectory: input.baseline });
  await mkdir(input.output, { recursive: false });
  const rootFiles = [
    "blind-generation-input-manifest.json",
    "blind-evaluation-policy.json",
    "machine-memory.json",
    "blind-generation-execution.json",
    "blind-provenance-audit.json",
    "machine-baseline-evidence-coverage.json",
    "machine-shadow-finalization-policy.json",
    "machine-shadow-finalization.json",
  ];
  for (const fileName of rootFiles) {
    await copyFile(
      path.join(input.baseline, fileName),
      path.join(input.output, fileName),
    );
  }
  const baselineSubtitle = await onlySubtitleDirectory(input.baseline);
  const outputSubtitle = path.join(
    input.output,
    path.basename(baselineSubtitle),
  );
  await cp(baselineSubtitle, outputSubtitle, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  return outputSubtitle;
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

async function ensureExtractedAudio(input: {
  source: string;
  sourceSha256: string;
  startSample: number;
  endSample: number;
  ffmpeg: string;
  sharedCache: string;
  outputDirectory: string;
  fileStem: string;
}): Promise<ExtractionResult> {
  const sampleCount = input.endSample - input.startSample;
  if (sampleCount <= 0) throw new InputError("Audio extraction span is empty.");
  const commandCore = {
    provider: "ffmpeg",
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
  const cacheDirectory = path.join(input.sharedCache, "audio");
  await mkdir(cacheDirectory, { recursive: true });
  const cachePath = path.join(cacheDirectory, `${commandIdentity}.wav`);
  const cacheHit = await pathExists(cachePath);
  if (!cacheHit) {
    const startSeconds = input.startSample / SOURCE_SAMPLE_RATE;
    await execFileAsync(input.ffmpeg, [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      startSeconds.toFixed(6),
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
      cachePath,
    ]);
  }
  const wav = inspectReviewWav(await readFile(cachePath));
  if (wav.sampleRate !== SOURCE_SAMPLE_RATE || wav.frameCount !== sampleCount) {
    throw new InputError(
      "Extracted WAV sample count does not match its lineage.",
      {
        cachePath,
        expectedSampleRate: SOURCE_SAMPLE_RATE,
        actualSampleRate: wav.sampleRate,
        expectedSampleCount: sampleCount,
        actualSampleCount: wav.frameCount,
      },
    );
  }
  await mkdir(input.outputDirectory, { recursive: true });
  const outputPath = path.join(input.outputDirectory, `${input.fileStem}.wav`);
  await copyFile(cachePath, outputPath);
  return {
    audioPath: outputPath,
    audioSha256: await sha256File(cachePath),
    sampleCount: wav.frameCount,
    sampleRate: wav.sampleRate,
    cacheHit,
    commandIdentity,
  };
}

function cachePath(root: string, family: string, key: string): string {
  return path.join(root, family, key.slice(0, 2), `${key}.json`);
}

async function readWhisperCache(input: {
  root: string;
  family: string;
  key: string;
}): Promise<MvlWhisperServerResponse | null> {
  const filePath = cachePath(input.root, input.family, input.key);
  if (!(await pathExists(filePath))) return null;
  const record = await json<WhisperCacheRecord>(filePath);
  if (
    record.cacheIdentity !== input.key ||
    record.responseSemanticHash !== machineQualitySemanticHash(record.response)
  ) {
    throw new InputError("C6.0.1.4 Whisper cache identity mismatch.", {
      filePath,
    });
  }
  return mvlWhisperServerResponseSchema.parse(record.response);
}

async function writeWhisperCache(input: {
  root: string;
  family: string;
  key: string;
  response: MvlWhisperServerResponse;
}): Promise<string> {
  const filePath = cachePath(input.root, input.family, input.key);
  await mkdir(path.dirname(filePath), { recursive: true });
  await atomicWriteJson(filePath, {
    schemaVersion: "1.0.0",
    cacheIdentity: input.key,
    response: input.response,
    responseSemanticHash: machineQualitySemanticHash(input.response),
  } satisfies WhisperCacheRecord);
  return filePath;
}

async function findBaselineCacheEntry(input: {
  baseline: string;
  cacheIdentity: string;
}): Promise<{ entry: CacheEntryV2; fileSha256: string }> {
  const candidates = [
    path.join(
      input.baseline,
      "asr-cache-v2",
      input.cacheIdentity.slice(0, 2),
      `${input.cacheIdentity}.json`,
    ),
    path.join(
      input.baseline,
      "isolated-asr-cache",
      input.cacheIdentity.slice(0, 2),
      `${input.cacheIdentity}.json`,
    ),
  ];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return {
        entry: await json<CacheEntryV2>(candidate),
        fileSha256: await sha256File(candidate),
      };
    }
  }
  throw new InputError("Baseline portable ASR cache entry is missing.", {
    cacheIdentity: input.cacheIdentity,
    attempted: candidates,
  });
}

function sourceTransform(input: {
  id: string;
  sourceSha256: string;
  sourceTotalSamples: number;
  audioSha256: string;
  sampleCount: number;
  startSample: number;
  commandIdentity: string;
}): SampleTransform {
  return createSampleTransform({
    transformId: `transform:${input.id}:source-to-request`,
    parentArtifactId: "source-media-canonical-pcm-16khz",
    parentArtifactSha256: input.sourceSha256,
    childArtifactId: input.id,
    childArtifactSha256: input.audioSha256,
    parentSampleRate: SOURCE_SAMPLE_RATE,
    childSampleRate: SOURCE_SAMPLE_RATE,
    parentTotalSamples: input.sourceTotalSamples,
    childTotalSamples: input.sampleCount,
    childStartSampleInParent: input.startSample,
    childEndSampleInParent: input.startSample + input.sampleCount,
    extractionMethod: "direct-source-ffmpeg-sample-trim",
    ffmpeg: {
      inputSeekPlacement: "before-input",
      inputSeekSample: input.startSample,
      outputTrimStartSample: 0,
      outputDurationSamples: input.sampleCount,
      atrimUsed: true,
      asetptsReset: true,
      resampleUsed: true,
      paddingSamples: 0,
      commandIdentity: input.commandIdentity,
    },
    resamplingIdentity: machineQualitySemanticHash({
      source: "media-audio-stream-0",
      targetSampleRate: SOURCE_SAMPLE_RATE,
      resampler: "ffmpeg-aresample",
    }),
    verificationReasons: [
      "direct-read-only-source-extraction",
      "wav-sample-count-verified",
      "input-seek-before-i-audited",
      "atrim-and-asetpts-explicit",
    ],
  });
}

function associateTokenToEvent(input: {
  start: number;
  end: number;
  events: readonly MachineEvent[];
}): { cueId: string | null; status: "assigned" | "pending" | "unassigned" } {
  const duration = Math.max(0.01, input.end - input.start);
  const ranked = input.events
    .map((event) => ({
      event,
      overlap: Math.max(
        0,
        Math.min(input.end, event.interval.end) -
          Math.max(input.start, event.interval.start),
      ),
    }))
    .filter((entry) => entry.overlap / duration >= 0.8)
    .toSorted(
      (left, right) =>
        right.overlap - left.overlap ||
        left.event.interval.end -
          left.event.interval.start -
          (right.event.interval.end - right.event.interval.start) ||
        left.event.eventId.localeCompare(right.event.eventId),
    );
  const first = ranked[0];
  if (first === undefined) return { cueId: null, status: "unassigned" };
  const second = ranked[1];
  const unique =
    second === undefined ||
    first.overlap - second.overlap >= Math.min(0.05, duration * 0.25);
  return unique
    ? { cueId: first.event.representativeCueId, status: "assigned" }
    : { cueId: null, status: "pending" };
}

function distinctMachineEvents(input: {
  canonical: CanonicalEventsArtifact;
  assembly: CanonicalAssemblyArtifact;
  association: AssociationLedger;
  candidates: CandidateEvidenceArtifact;
}): MachineEvent[] {
  const evidence = new Map(
    input.candidates.candidates.map((candidate) => [
      candidate.cueId,
      candidate,
    ]),
  );
  const selected = new Map(
    input.assembly.operations.map((operation) => [
      operation.eventId,
      operation.selectedCandidateId,
    ]),
  );
  const recordsByEvent = new Map<string, AssociationRecord[]>();
  for (const record of input.association.records) {
    if (record.assignedEventId === null || record.disposition === "REJECTED")
      continue;
    const current = recordsByEvent.get(record.assignedEventId) ?? [];
    current.push(record);
    recordsByEvent.set(record.assignedEventId, current);
  }
  return input.canonical.events.flatMap((event) => {
    const currentSelected =
      selected.get(event.eventId) ?? event.representativeCandidateId;
    if (currentSelected === null) return [];
    const records = recordsByEvent.get(event.eventId) ?? [];
    const groups = new Map<
      string,
      { evidence: CandidateEvidence; record: AssociationRecord }[]
    >();
    for (const record of records) {
      const candidate = evidence.get(record.candidateId);
      if (
        candidate === undefined ||
        normalizeCandidateText(candidate.text) === ""
      )
        continue;
      const key = normalizeCandidateText(candidate.text);
      const group = groups.get(key) ?? [];
      group.push({ evidence: candidate, record });
      groups.set(key, group);
    }
    const variants = [...groups.values()].map((group) => {
      const chosen =
        group.find((entry) => entry.evidence.cueId === currentSelected) ??
        group.toSorted(
          (left, right) =>
            right.evidence.selectionScore - left.evidence.selectionScore ||
            left.evidence.cueId.localeCompare(right.evidence.cueId),
        )[0];
      if (chosen === undefined) throw new InputError("Empty variant group.");
      return {
        variantId: chosen.evidence.cueId,
        displayText: chosen.evidence.text,
        interval: chosen.evidence.interval,
        sourceRequestIds: [
          ...new Set(group.flatMap((entry) => entry.evidence.sourceRequestIds)),
        ].toSorted(),
        independentSupportCount: Math.max(
          ...group.map((entry) => entry.evidence.independentSupportCount),
        ),
        selectionScore: chosen.evidence.selectionScore,
        tokenTimingQuality: chosen.evidence.tokenTimingQuality,
        hardRejectReasons: [
          ...new Set([
            ...chosen.evidence.hardBlockReasons,
            ...chosen.record.hardIncompatibilities,
            ...(chosen.evidence.hallucinationRisk >= 0.85
              ? ["severe-machine-hallucination-risk"]
              : []),
          ]),
        ],
        hallucinationRisk: chosen.evidence.hallucinationRisk,
      };
    });
    if (variants.length === 0) return [];
    const selectedVariant =
      variants.find((variant) => variant.variantId === currentSelected) ??
      variants[0];
    if (selectedVariant === undefined) return [];
    return [
      {
        eventId: event.eventId,
        interval: event.acousticInterval,
        currentSelectedVariantId: selectedVariant.variantId,
        variants: variants.toSorted((left, right) =>
          left.variantId.localeCompare(right.variantId),
        ),
        representativeCueId: selectedVariant.variantId,
      },
    ];
  });
}

async function sudachiReadings(input: {
  events: readonly MachineEvent[];
  python: string;
  helper: string;
}): Promise<{
  runtimeIdentityHash: string;
  readings: Map<string, { reading: string | null; unresolvedUnits: string[] }>;
}> {
  const variants = input.events.flatMap((event) => event.variants);
  const raw = (await runJsonProcess({
    executable: input.python,
    args: [input.helper],
    request: {
      items: variants.map((variant) => ({
        id: variant.variantId,
        text: variant.displayText,
      })),
    },
  })) as {
    engine: unknown;
    items: { id: string; reading: string | null; unresolvedOov: string[] }[];
  };
  const runtimeIdentityHash = machineQualitySemanticHash({
    engine: raw.engine,
    helperSha256: await sha256File(input.helper),
    pythonSha256: await sha256File(input.python),
  });
  return {
    runtimeIdentityHash,
    readings: new Map(
      raw.items.map((item) => [
        item.id,
        { reading: item.reading, unresolvedUnits: item.unresolvedOov },
      ]),
    ),
  };
}

async function runWhisperRequest(input: {
  pool: WhisperCppWorkerPool;
  responseCacheRoot: string;
  cacheFamily: string;
  cacheIdentity: string;
  audio: ExtractionResult;
  requestId: string;
  requestStartSeconds: number;
  useVad: boolean;
  serverPath: string;
  modelPath: string;
  modelHash: string;
  vadModelPath: string;
  runtime: WhisperRuntimeManifest;
}): Promise<{
  response: MvlWhisperServerResponse;
  cacheHit: boolean;
  inferenceExecuted: boolean;
  modelLoadCount: number;
  workerStartCount: number;
  cacheEntryPath: string;
}> {
  const cached = await readWhisperCache({
    root: input.responseCacheRoot,
    family: input.cacheFamily,
    key: input.cacheIdentity,
  });
  if (cached !== null) {
    input.pool.recordCacheHit({
      requestKey: input.requestId,
      useVad: input.useVad,
      profile: input.useVad ? "current-sensitive-vad" : "no-vad",
    });
    return {
      response: cached,
      cacheHit: true,
      inferenceExecuted: false,
      modelLoadCount: 0,
      workerStartCount: 0,
      cacheEntryPath: cachePath(
        input.responseCacheRoot,
        input.cacheFamily,
        input.cacheIdentity,
      ),
    };
  }
  const beforeMetrics = input.pool.metrics();
  const result = await input.pool.transcribe({
    request: {
      audioPath: input.audio.audioPath,
      chunk: {
        id: input.requestId,
        relativePath: path.basename(input.audio.audioPath),
        start: input.requestStartSeconds,
        end:
          input.requestStartSeconds +
          input.audio.sampleCount / SOURCE_SAMPLE_RATE,
        duration: input.audio.sampleCount / SOURCE_SAMPLE_RATE,
        sha256: input.audio.audioSha256,
      },
      language: "ja",
      timestampStrategy: "segment",
      tokenTimestamps: true,
    },
    capability: {
      executablePath: input.serverPath,
      modelPath: input.modelPath,
      modelHash: input.modelHash,
      whisperCppVersion: "1.9.3",
      coreML: false,
      threads: 8,
      language: "ja",
      vadModelPath: input.vadModelPath,
      useVad: input.useVad,
      vadProfile: "sensitive-v2",
      tokenTimestamps: true,
      promptConstraint: "clean-prompt-null",
      serverPath: input.serverPath,
      timestampRuntimePolicy: "require-mapped",
      rawVadPolicy: input.useVad ? "required" : "auto",
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
  const response = mvlWhisperServerResponseSchema.parse(
    (result.raw as { mvlResponse?: unknown }).mvlResponse,
  );
  const cacheEntryPath = await writeWhisperCache({
    root: input.responseCacheRoot,
    family: input.cacheFamily,
    key: input.cacheIdentity,
    response,
  });
  const afterMetrics = input.pool.metrics();
  return {
    response,
    cacheHit: false,
    inferenceExecuted: true,
    modelLoadCount: Math.max(
      0,
      afterMetrics.modelLoadCount - beforeMetrics.modelLoadCount,
    ),
    workerStartCount: Math.max(
      0,
      afterMetrics.workerStartCount - beforeMetrics.workerStartCount,
    ),
    cacheEntryPath,
  };
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  const baseline = path.resolve(required(args, "--baseline"));
  const output = path.resolve(required(args, "--output"));
  const source = path.resolve(required(args, "--source"));
  const sharedCache = path.resolve(required(args, "--shared-cache"));
  const runLabel = required(args, "--run-label");
  const vadMode = parseMode(args, "--vad-mode");
  const variantMode = parseMode(args, "--variant-mode");
  const reasrMode = parseMode(args, "--reasr-mode");
  const ffmpeg = required(args, "--ffmpeg");
  const whisperServer = path.resolve(required(args, "--whisper-server"));
  const whisperModel = path.resolve(required(args, "--whisper-model"));
  const vadModel = path.resolve(required(args, "--vad-model"));
  const whisperRuntimeManifest = path.resolve(
    required(args, "--whisper-runtime-manifest"),
  );
  const ctcRuntimeManifest = path.resolve(
    required(args, "--ctc-runtime-manifest"),
  );
  const ctcModelManifest = path.resolve(required(args, "--ctc-model-manifest"));
  const ctcCapabilityPath = path.resolve(
    required(args, "--ctc-runtime-capability"),
  );
  const sudachiPython = path.resolve(required(args, "--sudachi-python"));
  const sudachiHelper = path.resolve(required(args, "--sudachi-helper"));
  const startedAt = new Date().toISOString();
  const repositoryCommit = (
    await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: process.cwd() })
  ).stdout.trim();
  const sourceInfoBefore = await stat(source);
  const sourceSha256 = await sha256BlindFile(source);
  const baselineManifest = await json<{
    sourceVideo: { sha256: string; size: number };
  }>(path.join(baseline, "blind-generation-input-manifest.json"));
  if (
    baselineManifest.sourceVideo.sha256 !== sourceSha256 ||
    baselineManifest.sourceVideo.size !== sourceInfoBefore.size
  ) {
    throw new InputError("Source identity differs from the frozen baseline.");
  }
  const outputSubtitle = await cloneFrozenMachinePackage({ baseline, output });
  const baselineSubtitle = await onlySubtitleDirectory(baseline);
  const evidenceRoot = path.join(output, "c6-0-1-4-evidence");
  await mkdir(evidenceRoot, { recursive: true });
  await mkdir(sharedCache, { recursive: true });
  const initialCacheInventory = await directoryArtifactHash(sharedCache);

  const [
    legacyRequests,
    legacyTokens,
    candidates,
    association,
    canonical,
    assembly,
    sourceMediaInfo,
  ] = await Promise.all([
    json<LegacyRequestArtifact>(
      path.join(baselineSubtitle, "asr-request-timeline-contract.json"),
    ),
    json<LegacyTokenArtifact>(
      path.join(baselineSubtitle, "machine-global-token-timeline.json"),
    ),
    json<CandidateEvidenceArtifact>(
      path.join(baselineSubtitle, "cue-candidate-evidence.json"),
    ),
    json<AssociationLedger>(
      path.join(baselineSubtitle, "machine-candidate-association-ledger.json"),
    ),
    json<CanonicalEventsArtifact>(
      path.join(baselineSubtitle, "machine-canonical-events.json"),
    ),
    json<CanonicalAssemblyArtifact>(
      path.join(baselineSubtitle, "machine-canonical-assembly.json"),
    ),
    json<{ format: { durationSeconds: number } }>(
      path.join(baselineSubtitle, "source-info.json"),
    ),
  ]);
  const machineEvents = distinctMachineEvents({
    canonical,
    assembly,
    association,
    candidates,
  });
  const sourceDuration = sourceMediaInfo.format.durationSeconds;
  const sourceTotalSamples = Math.round(sourceDuration * SOURCE_SAMPLE_RATE);
  if (
    !Number.isFinite(sourceDuration) ||
    sourceDuration <= 0 ||
    sourceTotalSamples <= 0 ||
    legacyRequests.requests.some(
      (request) =>
        Math.round(request.sourceMediaEndSeconds * SOURCE_SAMPLE_RATE) >
        sourceTotalSamples,
    ) ||
    machineEvents.some(
      (event) =>
        Math.ceil(event.interval.end * SOURCE_SAMPLE_RATE) > sourceTotalSamples,
    )
  ) {
    throw new InputError(
      "Frozen source duration cannot bound machine evidence.",
      {
        sourceDuration,
        sourceTotalSamples,
      },
    );
  }
  const modelHash = await sha256File(whisperModel);
  const vadModelHash = await sha256File(vadModel);
  const whisperBinaryHash = await sha256File(whisperServer);
  const ffmpegExecutable = path.isAbsolute(ffmpeg)
    ? ffmpeg
    : (
        await execFileAsync("which", [ffmpeg], {
          cwd: process.cwd(),
        })
      ).stdout.trim();
  const ffmpegVersion =
    (
      await execFileAsync(ffmpeg, ["-version"], { cwd: process.cwd() })
    ).stdout.split("\n")[0] ?? "ffmpeg-unknown";
  const ffmpegRuntimeHash = machineQualitySemanticHash({
    binarySha256: await sha256File(ffmpegExecutable),
    version: ffmpegVersion,
  });
  const whisperRuntime = await json<WhisperRuntimeManifest>(
    whisperRuntimeManifest,
  );
  if (whisperBinaryHash !== whisperRuntime.patched.binarySha256) {
    throw new InputError("Patched Whisper binary identity mismatch.");
  }
  const whisperCapabilityHash = machineQualitySemanticHash(whisperRuntime);
  const legacyQuarantined = legacyRequests.requests.filter(
    (request) => request.contractStatus === "quarantined" && request.vadEnabled,
  );
  if (legacyQuarantined.length === 0) {
    throw new InputError(
      "Baseline contains no quarantined VAD requests to recover.",
    );
  }

  const vadPool = new WhisperCppWorkerPool({
    mode: "persistent",
    stateIsolation: "require-safe",
  });
  const freshVadEvidence: Parameters<
    typeof buildVadGlobalTimebase
  >[0]["requests"][number][] = [];
  const freshRequestEntries: ReturnType<typeof createRequestTimelineV2Entry>[] =
    [];
  const freshTokenObservations: Parameters<
    typeof buildGlobalTokenTimelineV2
  >[0]["observations"][number][] = [];
  const extractionAudit: unknown[] = [];
  let vadInferenceCount = 0;
  let vadCacheHitCount = 0;
  let vadModelLoadCount = 0;
  let vadWorkerStartCount = 0;
  try {
    for (const [index, legacy] of legacyQuarantined.entries()) {
      const startSample = Math.round(
        legacy.sourceMediaStartSeconds * SOURCE_SAMPLE_RATE,
      );
      const sampleCount = legacy.sampleCount;
      const endSample = startSample + sampleCount;
      const freshRequestId = `c6014-fresh-vad:${legacy.requestId}`;
      const extraction = await ensureExtractedAudio({
        source,
        sourceSha256,
        startSample,
        endSample,
        ffmpeg,
        sharedCache,
        outputDirectory: path.join(evidenceRoot, "vad-audio"),
        fileStem: `vad-${String(index + 1).padStart(3, "0")}`,
      });
      const transform = sourceTransform({
        id: freshRequestId,
        sourceSha256,
        sourceTotalSamples,
        audioSha256: extraction.audioSha256,
        sampleCount: extraction.sampleCount,
        startSample,
        commandIdentity: extraction.commandIdentity,
      });
      const cacheIdentity = machineQualitySemanticHash({
        policyVersion: POLICY_VERSION,
        family: "fresh-vad-global-timebase",
        sourceSha256,
        transformSemanticHash: transform.semanticHash,
        whisperBinaryHash,
        modelHash,
        vadModelHash,
        vadProfile: "sensitive-v2",
        tokenTimestamps: true,
        prompt: null,
      });
      const executed = await runWhisperRequest({
        pool: vadPool,
        responseCacheRoot: sharedCache,
        cacheFamily: "whisper-vad",
        cacheIdentity,
        audio: extraction,
        requestId: freshRequestId,
        requestStartSeconds: startSample / SOURCE_SAMPLE_RATE,
        useVad: true,
        serverPath: whisperServer,
        modelPath: whisperModel,
        modelHash,
        vadModelPath: vadModel,
        runtime: whisperRuntime,
      });
      vadInferenceCount += Number(executed.inferenceExecuted);
      vadCacheHitCount += Number(executed.cacheHit);
      vadModelLoadCount += executed.modelLoadCount;
      vadWorkerStartCount += executed.workerStartCount;
      const response = executed.response;
      const emptyResponse =
        response.vad_segments.length === 0 &&
        response.transcription.length === 0 &&
        response.text.trim() === "";
      freshVadEvidence.push({
        requestId: freshRequestId,
        extractedAudioId: freshRequestId,
        extractedAudioSha256: extraction.audioSha256,
        sourceClipTransform: transform,
        cacheIdentity,
        providerSegments: response.vad_segments,
        mappedGetterUsed:
          response.runtime.capabilities.mapped_token_getter_used,
        rawVadGetterUsed: response.runtime.capabilities.raw_vad_getter_used,
        mappingVerified:
          response.runtime.capabilities.raw_vad_getter_used &&
          (response.runtime.capabilities.mapped_token_getter_used ||
            emptyResponse),
        emptyResponse,
        failureReasons: [],
      });
      freshRequestEntries.push(
        createRequestTimelineV2Entry({
          requestId: freshRequestId,
          legacyRequestId: legacy.requestId,
          sourceMediaSha256: sourceSha256,
          sourceClipTransform: transform,
          parentChain: [freshRequestId, "source-media-canonical-pcm-16khz"],
          extractedAudioSha256: extraction.audioSha256,
          extractedSampleRate: extraction.sampleRate,
          extractedSampleCount: extraction.sampleCount,
          tokenTimeBase: "mapped-original-audio-local",
          mappingStatus: "VERIFIED",
          mappingReason: emptyResponse
            ? "fresh-empty-response-source-lineage-verified-token-mapping-not-applicable"
            : "fresh-mapped-token-and-raw-vad-getter-lineage",
          cacheIdentity,
          cacheEntrySha256: await sha256File(executed.cacheEntryPath),
          modelIdentity: modelHash,
          vadEnabled: true,
          promptPresent: response.request.prompt_present,
          freshEvidence: true,
        }),
      );
      for (const [segmentIndex, segment] of response.transcription.entries()) {
        for (const [tokenIndex, token] of segment.tokens.entries()) {
          if (token.special) continue;
          if (token.mapped === null) {
            freshTokenObservations.push({
              tokenId: `${freshRequestId}:${String(segmentIndex).padStart(3, "0")}:${String(tokenIndex).padStart(4, "0")}`,
              requestId: freshRequestId,
              cueId: null,
              text: token.text,
              probability: token.probability,
              localStartCentiseconds: null,
              localEndCentiseconds: null,
              coordinateSystem: "unknown",
              associationStatus: "unassigned",
              cacheIdentity,
              freshEvidence: true,
            });
            continue;
          }
          const globalStart =
            startSample / SOURCE_SAMPLE_RATE +
            token.mapped.startCentiseconds * 0.01;
          const globalEnd =
            startSample / SOURCE_SAMPLE_RATE +
            token.mapped.endCentiseconds * 0.01;
          const associationResult = associateTokenToEvent({
            start: globalStart,
            end: globalEnd,
            events: machineEvents,
          });
          freshTokenObservations.push({
            tokenId: `${freshRequestId}:${String(segmentIndex).padStart(3, "0")}:${String(tokenIndex).padStart(4, "0")}`,
            requestId: freshRequestId,
            cueId: associationResult.cueId,
            text: token.text,
            probability: token.probability,
            localStartCentiseconds: token.mapped.startCentiseconds,
            localEndCentiseconds: token.mapped.endCentiseconds,
            coordinateSystem: "mapped-original-audio-local",
            associationStatus: associationResult.status,
            cacheIdentity,
            freshEvidence: true,
          });
        }
      }
      extractionAudit.push({
        requestId: freshRequestId,
        legacyRequestId: legacy.requestId,
        relativeAudioPath: path.relative(output, extraction.audioPath),
        startSample,
        endSample,
        sampleCount: extraction.sampleCount,
        audioSha256: extraction.audioSha256,
        commandIdentity: extraction.commandIdentity,
        audioCacheHit: extraction.cacheHit,
        whisperCacheHit: executed.cacheHit,
        inferenceExecuted: executed.inferenceExecuted,
      });
    }
  } finally {
    await vadPool.close();
  }
  const vadTimebase = buildVadGlobalTimebase({
    mode: vadMode,
    generatedAt: startedAt,
    sourceIdentity: {
      sourceMediaSha256: sourceSha256,
      sourceSampleRate: SOURCE_SAMPLE_RATE,
      sourceTotalSamples,
      sourceReadOnlyVerified: true,
    },
    vadProviderIdentity: {
      provider: "whisper.cpp-silero-vad",
      whisperVersion: "1.9.3",
      whisperBinarySha256: whisperBinaryHash,
      vadModelSha256: vadModelHash,
      capabilityHash: whisperCapabilityHash,
      mappedGetterUsed: true,
      rawVadGetterUsed: true,
      requestStateIsolation: "fresh-whisper-state-per-mvl-request",
    },
    legacyQuarantinedRequestIds: legacyQuarantined.map(
      (request) => request.requestId,
    ),
    requests: freshVadEvidence,
  });

  const oldRequestEntries: ReturnType<typeof createRequestTimelineV2Entry>[] =
    [];
  for (const legacy of legacyRequests.requests.filter(
    (request) => request.contractStatus === "verified",
  )) {
    const baselineCache = await findBaselineCacheEntry({
      baseline,
      cacheIdentity: legacy.cacheIdentity,
    });
    const startSample = Math.round(
      legacy.sourceMediaStartSeconds * SOURCE_SAMPLE_RATE,
    );
    const transform = sourceTransform({
      id: `legacy-verified:${legacy.requestId}`,
      sourceSha256,
      sourceTotalSamples,
      audioSha256: baselineCache.entry.identity.audioContentSha256,
      sampleCount: legacy.sampleCount,
      startSample,
      commandIdentity: machineQualitySemanticHash({
        legacyTimeline: legacy.requestId,
        status: "verified-pre-c6014",
      }),
    });
    oldRequestEntries.push(
      createRequestTimelineV2Entry({
        requestId: legacy.requestId,
        legacyRequestId: legacy.requestId,
        sourceMediaSha256: sourceSha256,
        sourceClipTransform: transform,
        parentChain: [legacy.requestId, "source-media-canonical-pcm-16khz"],
        extractedAudioSha256: baselineCache.entry.identity.audioContentSha256,
        extractedSampleRate: legacy.sampleRate,
        extractedSampleCount: legacy.sampleCount,
        tokenTimeBase: "original-audio-local",
        mappingStatus: "VERIFIED",
        mappingReason: "c6013-verified-no-vad-extraction-lineage-preserved",
        cacheIdentity: legacy.cacheIdentity,
        cacheEntrySha256: baselineCache.fileSha256,
        modelIdentity: baselineCache.entry.identity.modelHash,
        vadEnabled: false,
        promptPresent: false,
        freshEvidence: false,
      }),
    );
  }
  const requestTimeline = buildRequestTimelineV2({
    sourceMediaSha256: sourceSha256,
    vadGlobalTimebaseSemanticHash: vadTimebase.semanticHash,
    requests: [...oldRequestEntries, ...freshRequestEntries],
    generatedAt: startedAt,
  });
  const oldQuarantinedRequestIds = new Set(
    legacyQuarantined.map((request) => request.requestId),
  );
  const oldTokenObservations: Parameters<
    typeof buildGlobalTokenTimelineV2
  >[0]["observations"] = legacyTokens.tokens
    .filter((token) => !oldQuarantinedRequestIds.has(token.requestId))
    .map((token) => ({
      tokenId: token.tokenId,
      requestId: token.requestId,
      cueId: token.cueId,
      text: token.text,
      probability: token.trusted ? 0.9 : 0,
      localStartCentiseconds:
        token.localInterval === null
          ? null
          : Math.max(0, Math.round(token.localInterval.start * 100)),
      localEndCentiseconds:
        token.localInterval === null
          ? null
          : Math.max(1, Math.round(token.localInterval.end * 100)),
      coordinateSystem:
        token.coordinateSystem === "original-audio-local"
          ? ("original-audio-local" as const)
          : ("unknown" as const),
      associationStatus:
        token.trusted && token.cueId !== null
          ? ("assigned" as const)
          : ("unassigned" as const),
      cacheIdentity:
        legacyRequests.requests.find(
          (request) => request.requestId === token.requestId,
        )?.cacheIdentity ?? machineQualitySemanticHash(token.requestId),
      freshEvidence: false,
    }));
  const tokenTimeline = buildGlobalTokenTimelineV2({
    requestTimeline,
    observations: [...oldTokenObservations, ...freshTokenObservations],
    generatedAt: startedAt,
  });

  const pronunciation = await sudachiReadings({
    events: machineEvents,
    python: sudachiPython,
    helper: sudachiHelper,
  });
  const projections = projectJapanesePronunciationBatch({
    variants: machineEvents.flatMap((event) => event.variants),
    machineReadings: pronunciation.readings,
  });
  const projectionByVariant = new Map(
    projections.map((projection) => [
      projection.projectionId.replace(/^acoustic-projection:/u, ""),
      projection,
    ]),
  );
  const ctcVerified = await loadAndVerifyCtcRuntime({
    runtimeManifestPath: ctcRuntimeManifest,
    modelManifestPath: ctcModelManifest,
  });
  const ctcCapability = ctcRuntimeCapabilitySchema.parse(
    await json<unknown>(ctcCapabilityPath),
  );
  if (
    ctcVerified.runtime.runtimeIdentityHash !==
      ctcCapability.runtimeIdentityHash ||
    ctcVerified.model.modelSnapshotHash !== ctcCapability.modelSnapshotHash
  ) {
    throw new InputError("CTC runtime differs from its verified capability.");
  }
  const runIdentitySuffix = machineQualitySemanticHash({
    runLabel,
    output,
  }).slice(0, 16);
  const generationRunId = `c6-0-1-4-${runIdentitySuffix}`;
  const machineMemoryStoreId = `c6-0-1-4-empty-memory-${runIdentitySuffix}`;
  const ctcSnapshotSize = ctcVerified.model.modelFiles.reduce(
    (sum, file) => sum + file.size,
    0,
  );
  const blindManifest = await createBlindGenerationInputManifest({
    generatedAt: startedAt,
    generationRunId,
    sourceVideoPath: source,
    repositoryCommit,
    model: {
      modelName: "whisper-large-v3",
      modelPath: whisperModel,
      verifiedSnapshot: {
        sha256: modelHash,
        size: (await stat(whisperModel)).size,
      },
    },
    additionalModels: [
      {
        modelName: "silero-vad-v6.2.0",
        modelPath: vadModel,
        verifiedSnapshot: {
          sha256: vadModelHash,
          size: (await stat(vadModel)).size,
        },
      },
      {
        modelName: ctcVerified.model.modelRepo,
        modelPath: path.join(
          ctcVerified.model.snapshotDirectory,
          "model.safetensors",
        ),
        verifiedSnapshot: {
          sha256: ctcVerified.model.modelSnapshotHash,
          size: ctcSnapshotSize,
        },
      },
    ],
    runtimes: [
      {
        runtimeId: whisperCapabilityHash,
        name: "whisper.cpp-mvl",
        version: `1.9.3+${whisperRuntime.patch.patchSha256.slice(0, 12)}`,
        executablePath: whisperServer,
        device: "metal",
      },
      {
        runtimeId: ctcVerified.runtime.runtimeIdentityHash,
        name: "reazon-wav2vec2-ctc",
        version: ctcVerified.runtime.runtimeVersion,
        executablePath: ctcVerified.runtime.pythonExecutable,
        device: ctcCapability.deviceUsed,
      },
      {
        runtimeId: pronunciation.runtimeIdentityHash,
        name: "sudachipy-pronunciation-projection",
        version: "0.6.11+python-3.12",
        executablePath: sudachiPython,
        device: "cpu",
      },
      {
        runtimeId: ffmpegRuntimeHash,
        name: "ffmpeg",
        version: ffmpegVersion,
        executablePath: ffmpegExecutable,
        device: "cpu",
      },
    ],
    generationArguments: [
      "--baseline",
      baseline,
      "--input",
      source,
      "--output",
      output,
      "--asr-cache-dir",
      sharedCache,
      "--machine-quality-recovery",
      "enforce",
      "--vad-global-timebase",
      vadMode,
      "--acoustic-text-variant-verifier",
      variantMode,
      "--targeted-event-reasr",
      reasrMode,
      "--guidance-mode",
      "reference-free",
      "--network-policy",
      "off",
      "--whisper-server",
      whisperServer,
      "--whisper-model",
      whisperModel,
      "--vad-model",
      vadModel,
      "--ctc-runtime-manifest",
      ctcRuntimeManifest,
      "--ctc-model-manifest",
      ctcModelManifest,
      "--ctc-runtime-capability",
      ctcCapabilityPath,
      "--sudachi-python",
      sudachiPython,
      "--sudachi-helper",
      sudachiHelper,
    ],
    machineMemoryStoreId,
    importedMachineCaches:
      initialCacheInventory.fileCount === 0
        ? []
        : [
            {
              path: sharedCache,
              artifactType: "c6-0-1-4-machine-evidence-cache-v1",
              artifactHash: initialCacheInventory.artifactHash,
            },
          ],
  });
  await atomicWriteJson(
    path.join(output, "blind-generation-input-manifest.json"),
    blindManifest,
  );
  await atomicWriteJson(path.join(output, "machine-memory.json"), {
    schemaVersion: "1.0.0",
    artifactType: "machine-only-series-memory",
    storeId: machineMemoryStoreId,
    createdAt: startedAt,
    entryCount: 0,
    humanDerived: false,
    entries: [],
    semanticHash: blindManifest.machineMemoryInitialState.storeHash,
  });
  let ctcWorker: LocalCtcWorker | null = null;
  let ctcInferenceCount = 0;
  let ctcCacheHitCount = 0;
  let ctcModelLoadCount = 0;
  let ctcWorkerStartCount = 0;
  const eventAudio = new Map<string, ExtractionResult>();
  const ctcEventInputs: AcousticEventVerificationInput[] = [];

  const ensureEventAudio = async (
    event: MachineEvent,
  ): Promise<ExtractionResult> => {
    const existing = eventAudio.get(event.eventId);
    if (existing !== undefined) return existing;
    const startSample = Math.max(
      0,
      Math.floor(event.interval.start * SOURCE_SAMPLE_RATE),
    );
    const endSample = Math.min(
      sourceTotalSamples,
      Math.max(
        startSample + 1,
        Math.ceil(event.interval.end * SOURCE_SAMPLE_RATE),
      ),
    );
    const extracted = await ensureExtractedAudio({
      source,
      sourceSha256,
      startSample,
      endSample,
      ffmpeg,
      sharedCache,
      outputDirectory: path.join(evidenceRoot, "event-audio"),
      fileStem: event.eventId,
    });
    eventAudio.set(event.eventId, extracted);
    return extracted;
  };

  const ctcAttempt = async (input: {
    event: MachineEvent;
    variant: MachineVariant;
  }): Promise<CtcAlignmentAttempt | null> => {
    const projection = projectionByVariant.get(input.variant.variantId);
    if (
      projection === undefined ||
      projection.method === "unscorable" ||
      projection.projectionText === ""
    ) {
      return null;
    }
    const audio = await ensureEventAudio(input.event);
    const cacheIdentity = machineQualitySemanticHash({
      family: "ctc-text-variant-verification",
      policyVersion: POLICY_VERSION,
      eventId: input.event.eventId,
      audioSha256: audio.audioSha256,
      projectionTextHash: projection.projectionTextHash,
      ctcRuntimeIdentityHash: ctcCapability.runtimeIdentityHash,
      ctcModelSnapshotHash: ctcCapability.modelSnapshotHash,
      viterbiPolicy: "mvl-ctc-viterbi-v1",
    });
    const filePath = cachePath(sharedCache, "ctc-variant", cacheIdentity);
    if (await pathExists(filePath)) {
      ctcCacheHitCount += 1;
      return ctcAlignmentAttemptSchema.parse(await json<unknown>(filePath));
    }
    ctcWorker ??= new LocalCtcWorker({
      ...ctcVerified,
      device: ctcCapability.deviceUsed,
      workerScriptPath: path.resolve("scripts/runtime/ctc_worker.py"),
    });
    if (ctcWorkerStartCount === 0) ctcWorkerStartCount = 1;
    const attempt = await ctcWorker.align({
      attemptId: `ctc-variant:${cacheIdentity.slice(0, 24)}`,
      cueId: input.variant.variantId,
      componentId: input.event.eventId,
      windowType: "narrow",
      audioPath: audio.audioPath,
      audioSha256: audio.audioSha256,
      audioLocalInterval: {
        start: 0,
        end: audio.sampleCount / SOURCE_SAMPLE_RATE,
      },
      mediaGlobalInterval: input.event.interval,
      targetText: projection.projectionText,
    });
    ctcInferenceCount += 1;
    ctcModelLoadCount += attempt.modelLoadCount;
    await mkdir(path.dirname(filePath), { recursive: true });
    await atomicWriteJson(filePath, attempt);
    return attempt;
  };

  try {
    if (variantMode !== "off") {
      for (const event of machineEvents.filter(
        (value) => value.variants.length > 1,
      )) {
        const audio = await ensureEventAudio(event);
        const variants = [];
        for (const variant of event.variants) {
          const projection = projectionByVariant.get(variant.variantId);
          if (projection === undefined) continue;
          const attempt = await ctcAttempt({ event, variant });
          variants.push({
            variantId: variant.variantId,
            displayText: variant.displayText,
            projection,
            attempts: attempt === null ? [] : [attempt],
          });
        }
        ctcEventInputs.push({
          eventId: event.eventId,
          audioEvidenceId: `event-audio:${event.eventId}`,
          audioInterval: event.interval,
          audioSha256: audio.audioSha256,
          variants,
        });
      }
    }
  } finally {
    const workerToClose = ctcWorker as LocalCtcWorker | null;
    if (workerToClose !== null) await workerToClose.close();
    ctcWorker = null;
  }
  let acousticVerification = buildAcousticTextVariantVerification({
    mode: variantMode,
    ctcRuntimeIdentityHash: ctcCapability.runtimeIdentityHash,
    ctcModelSnapshotHash: ctcCapability.modelSnapshotHash,
    pronunciationRuntimeIdentityHash: pronunciation.runtimeIdentityHash,
    events: ctcEventInputs,
    workerStartCount: ctcWorkerStartCount,
    generatedAt: startedAt,
  });

  const trustedByCue = new Map<string, string[]>();
  for (const token of tokenTimeline.tokens) {
    if (!token.trusted || token.cueId === null) continue;
    const current = trustedByCue.get(token.cueId) ?? [];
    current.push(normalizeCandidateText(token.text));
    trustedByCue.set(token.cueId, current);
  }
  const decisionInputs = (): EventVariantDecisionInput[] =>
    machineEvents.map((event) => ({
      eventId: event.eventId,
      currentSelectedVariantId: event.currentSelectedVariantId,
      variants: event.variants.map((variant) => {
        const tokens = trustedByCue.get(event.representativeCueId) ?? [];
        const normalized = normalizeCandidateText(variant.displayText);
        const supported = tokens.filter(
          (token) => token !== "" && normalized.includes(token),
        ).length;
        const conflicts =
          tokens.length >= 2 &&
          supported === 0 &&
          variant.tokenTimingQuality > 0;
        const eventDuration = event.interval.end - event.interval.start;
        const edgeTruncationRisk =
          Math.abs(variant.interval.start - event.interval.start) < 0.03 ||
          Math.abs(variant.interval.end - event.interval.end) < 0.03;
        return {
          variantId: variant.variantId,
          hardRejectReasons: variant.hardRejectReasons,
          independentSupportCount: variant.independentSupportCount,
          trustedTokenSupportCount: supported,
          trustedTokenConflict: conflicts,
          decoderEvidence: `selection=${variant.selectionScore.toFixed(6)};hallucination=${variant.hallucinationRisk.toFixed(6)}`,
          edgeTruncationRisk: edgeTruncationRisk && eventDuration > 0.2,
          linguisticTieBreakRank: Math.round(
            variant.selectionScore * 1_000_000,
          ),
          orthographicReadingGroup:
            projectionByVariant.get(variant.variantId)?.projectionTextHash ??
            null,
        };
      }),
    }));
  let decisions = resolveTextVariants({
    mode: variantMode,
    events: decisionInputs(),
    acousticVerification,
    generatedAt: startedAt,
  });
  const poolInputs = (): PoolSufficiencyEventInput[] =>
    machineEvents.map((event) => {
      const tokens = trustedByCue.get(event.representativeCueId) ?? [];
      const normalizedVariants = event.variants.map((variant) =>
        normalizeCandidateText(variant.displayText),
      );
      return {
        eventId: event.eventId,
        candidateCount: event.variants.length,
        independentWindowDisagreement:
          event.variants.length > 1 &&
          new Set(event.variants.flatMap((variant) => variant.sourceRequestIds))
            .size > 1,
        trustedTokenConflict:
          tokens.length >= 2 &&
          !normalizedVariants.some((text) =>
            tokens.some((token) => token !== "" && text.includes(token)),
          ),
        fullSpeechSpanCovered: event.variants.some(
          (variant) =>
            variant.interval.start <= event.interval.start + 0.25 &&
            variant.interval.end >= event.interval.end - 0.25,
        ),
      };
    });
  let poolSufficiency = assessCandidatePoolSufficiency({
    events: poolInputs(),
    acousticVerification,
    decisions,
    generatedAt: startedAt,
  });

  let targetedReasr: MachineTargetedEventReasr;
  let reasrInferenceCount = 0;
  let reasrCacheHitCount = 0;
  let reasrModelLoadCount = 0;
  let reasrWorkerStartCount = 0;
  const planned = planTargetedEventReasr({
    events: machineEvents.map((event) => ({
      eventId: event.eventId,
      interval: event.interval,
    })),
    decisions,
    poolSufficiency,
    sourceSampleRate: SOURCE_SAMPLE_RATE,
    sourceTotalSamples,
  });
  const reasrPool = new WhisperCppWorkerPool({
    mode: "persistent",
    stateIsolation: "require-safe",
  });
  const executedReasr: ExecutedTargetedReasrRequest[] = [];
  try {
    if (reasrMode !== "off") {
      for (const plannedEvent of planned.events) {
        const sourceEvent = machineEvents.find(
          (event) => event.eventId === plannedEvent.eventId,
        );
        if (sourceEvent === undefined) continue;
        for (const [index, request] of plannedEvent.requests.entries()) {
          assertTargetedReasrPromptIsolation({
            request,
            serializedProviderConfiguration: JSON.stringify({
              language: "ja",
              vad: false,
              tokenTimestamps: true,
              requestFamily: request.requestFamily,
            }),
            candidateTexts: sourceEvent.variants.map(
              (variant) => variant.displayText,
            ),
          });
          const extraction = await ensureExtractedAudio({
            source,
            sourceSha256,
            startSample: request.sourceGlobalSampleInterval.startSample,
            endSample: request.sourceGlobalSampleInterval.endSample,
            ffmpeg,
            sharedCache,
            outputDirectory: path.join(evidenceRoot, "targeted-reasr-audio"),
            fileStem: `${plannedEvent.eventId}-${String(index + 1).padStart(2, "0")}`,
          });
          const cacheIdentity = machineQualitySemanticHash({
            family: "targeted-event-clean-reasr",
            policyVersion: POLICY_VERSION,
            requestFamily: request.requestFamily,
            sourceSha256,
            sourceGlobalSampleInterval: request.sourceGlobalSampleInterval,
            audioSha256: extraction.audioSha256,
            whisperBinaryHash,
            modelHash,
            prompt: null,
            vad: false,
          });
          const executed = await runWhisperRequest({
            pool: reasrPool,
            responseCacheRoot: sharedCache,
            cacheFamily: "whisper-targeted-reasr",
            cacheIdentity,
            audio: extraction,
            requestId: request.requestId,
            requestStartSeconds: request.sourceGlobalInterval.start,
            useVad: false,
            serverPath: whisperServer,
            modelPath: whisperModel,
            modelHash,
            vadModelPath: vadModel,
            runtime: whisperRuntime,
          });
          reasrInferenceCount += Number(executed.inferenceExecuted);
          reasrCacheHitCount += Number(executed.cacheHit);
          reasrModelLoadCount += executed.modelLoadCount;
          reasrWorkerStartCount += executed.workerStartCount;
          const lexical = executed.response.transcription.flatMap((segment) =>
            segment.tokens.filter(
              (token) => !token.special && token.mapped !== null,
            ),
          );
          const mappedStarts = lexical.flatMap((token) =>
            token.mapped === null
              ? []
              : [token.mapped.startCentiseconds * 0.01],
          );
          const mappedEnds = lexical.flatMap((token) =>
            token.mapped === null ? [] : [token.mapped.endCentiseconds * 0.01],
          );
          const responseInterval =
            mappedStarts.length === 0 || mappedEnds.length === 0
              ? null
              : {
                  start:
                    request.sourceGlobalInterval.start +
                    Math.min(...mappedStarts),
                  end:
                    request.sourceGlobalInterval.start +
                    Math.max(...mappedEnds),
                };
          executedReasr.push({
            plan: request,
            extractedAudioSha256: extraction.audioSha256,
            extractedSampleRate: extraction.sampleRate,
            extractedSampleCount: extraction.sampleCount,
            cacheIdentity,
            cacheHit: executed.cacheHit,
            inferenceExecuted: executed.inferenceExecuted,
            modelLoadCount: executed.modelLoadCount,
            workerStartCount: executed.workerStartCount,
            responseText: executed.response.text.trim(),
            responseInterval,
            tokenEvidenceIds: lexical.map(
              (_token, tokenIndex) =>
                `${request.requestId}:mapped-token-${String(tokenIndex).padStart(4, "0")}`,
            ),
            decoderEvidenceHash: machineQualitySemanticHash({
              response: executed.response.transcription.map((segment) => ({
                avgLogProbability: segment.avgLogProbability,
                noSpeechProbability: segment.noSpeechProbability,
              })),
            }),
          });
        }
      }
    }
  } finally {
    await reasrPool.close();
  }
  targetedReasr = buildTargetedEventReasrArtifact({
    mode: reasrMode,
    eligibleEventCount: planned.eligibleEventCount,
    budgetExhaustedCount: planned.budgetExhaustedCount,
    plannedEvents: reasrMode === "off" ? [] : planned.events,
    executedRequests: executedReasr,
    generatedAt: startedAt,
  });

  if (reasrMode !== "off" && targetedReasr.events.length > 0) {
    const newCandidates = targetedReasr.events.flatMap((event) =>
      event.candidateOutputs.map((candidate) => ({
        eventId: event.eventId,
        candidate,
      })),
    );
    const expandedEvents: MachineEvent[] = machineEvents.map((event) => ({
      ...event,
      variants: [
        ...event.variants,
        ...newCandidates
          .filter((entry) => entry.eventId === event.eventId)
          .map((entry) => ({
            variantId: entry.candidate.candidateId,
            displayText: entry.candidate.text,
            interval: entry.candidate.sourceGlobalInterval,
            sourceRequestIds: entry.candidate.requestIds,
            independentSupportCount: 1,
            selectionScore: 0,
            tokenTimingQuality:
              entry.candidate.tokenEvidenceIds.length > 0 ? 1 : 0,
            hardRejectReasons: entry.candidate.lineageComplete
              ? []
              : ["incomplete-targeted-reasr-lineage"],
            hallucinationRisk: 0,
          })),
      ],
    }));
    const newPronunciation = await sudachiReadings({
      events: expandedEvents,
      python: sudachiPython,
      helper: sudachiHelper,
    });
    const expandedProjections = projectJapanesePronunciationBatch({
      variants: expandedEvents.flatMap((event) => event.variants),
      machineReadings: newPronunciation.readings,
    });
    projectionByVariant.clear();
    for (const projection of expandedProjections) {
      projectionByVariant.set(
        projection.projectionId.replace(/^acoustic-projection:/u, ""),
        projection,
      );
    }
    machineEvents.splice(0, machineEvents.length, ...expandedEvents);
    const expandedCtcInputs: AcousticEventVerificationInput[] = [];
    const initialCtcWorkerStartCount = ctcWorkerStartCount;
    ctcWorkerStartCount = 0;
    try {
      for (const event of machineEvents.filter(
        (value) => value.variants.length > 1,
      )) {
        const audio = await ensureEventAudio(event);
        const variants = [];
        for (const variant of event.variants) {
          const projection = projectionByVariant.get(variant.variantId);
          if (projection === undefined) continue;
          const aligned = await ctcAttempt({ event, variant });
          variants.push({
            variantId: variant.variantId,
            displayText: variant.displayText,
            projection,
            attempts: aligned === null ? [] : [aligned],
          });
        }
        expandedCtcInputs.push({
          eventId: event.eventId,
          audioEvidenceId: `event-audio:${event.eventId}`,
          audioInterval: event.interval,
          audioSha256: audio.audioSha256,
          variants,
        });
      }
    } finally {
      const workerToClose = ctcWorker as LocalCtcWorker | null;
      if (workerToClose !== null) await workerToClose.close();
      ctcWorker = null;
    }
    ctcWorkerStartCount += initialCtcWorkerStartCount;
    acousticVerification = buildAcousticTextVariantVerification({
      mode: variantMode,
      ctcRuntimeIdentityHash: ctcCapability.runtimeIdentityHash,
      ctcModelSnapshotHash: ctcCapability.modelSnapshotHash,
      pronunciationRuntimeIdentityHash: newPronunciation.runtimeIdentityHash,
      events: expandedCtcInputs,
      workerStartCount: ctcWorkerStartCount,
      generatedAt: startedAt,
    });
    decisions = resolveTextVariants({
      mode: variantMode,
      events: decisionInputs(),
      acousticVerification,
      generatedAt: startedAt,
    });
    poolSufficiency = assessCandidatePoolSufficiency({
      events: poolInputs(),
      acousticVerification,
      decisions,
      generatedAt: startedAt,
    });
    const selectedNew = new Set(
      decisions.decisions.flatMap((decision) =>
        decision.selectedVariant?.startsWith("targeted-reasr:")
          ? [decision.selectedVariant]
          : [],
      ),
    );
    targetedReasr = buildTargetedEventReasrArtifact({
      mode: reasrMode,
      eligibleEventCount: planned.eligibleEventCount,
      budgetExhaustedCount: planned.budgetExhaustedCount,
      plannedEvents: planned.events,
      executedRequests: executedReasr,
      selectedCandidateIds: selectedNew,
      generatedAt: startedAt,
    });
  }

  const baselineFreeze = await verifyBlindOutputFreeze({
    taskDirectory: baseline,
  });
  const candidateText = new Map(
    machineEvents.flatMap((event) =>
      event.variants.map(
        (variant) => [variant.variantId, variant.displayText] as const,
      ),
    ),
  );
  const proposals = decisions.decisions.flatMap((decision) => {
    const event = machineEvents.find(
      (value) => value.eventId === decision.eventId,
    );
    if (
      event === undefined ||
      decision.selectedVariant === null ||
      decision.selectedVariant === event.currentSelectedVariantId
    ) {
      return [];
    }
    const acoustic = acousticVerification.events.find(
      (value) => value.eventId === event.eventId,
    );
    const selectedInput = decisionInputs()
      .find((value) => value.eventId === event.eventId)
      ?.variants.find(
        (variant) => variant.variantId === decision.selectedVariant,
      );
    const currentInput = decisionInputs()
      .find((value) => value.eventId === event.eventId)
      ?.variants.find(
        (variant) => variant.variantId === event.currentSelectedVariantId,
      );
    return [
      {
        fromCandidateId: event.currentSelectedVariantId,
        fromText: candidateText.get(event.currentSelectedVariantId) ?? "",
        toCandidateId: decision.selectedVariant,
        toText: candidateText.get(decision.selectedVariant) ?? "",
        eventId: event.eventId,
        evidenceTierBefore: "WEAK" as const,
        evidenceTierAfter:
          decision.confidenceClass === "HIGH"
            ? ("STRONG" as const)
            : decision.confidenceClass === "MEDIUM"
              ? ("MEDIUM" as const)
              : ("WEAK" as const),
        acousticComparison:
          acoustic?.selectedByAcousticEvidence === decision.selectedVariant
            ? ("DOMINATES" as const)
            : ("INCOMPARABLE" as const),
        tokenComparison:
          (selectedInput?.trustedTokenSupportCount ?? 0) >
          (currentInput?.trustedTokenSupportCount ?? 0)
            ? ("MORE_SUPPORT" as const)
            : ("SAME_SUPPORT" as const),
        independentSupportBefore: currentInput?.independentSupportCount ?? 0,
        independentSupportAfter: selectedInput?.independentSupportCount ?? 0,
        toCandidateIsRealMachineCandidate: candidateText.has(
          decision.selectedVariant,
        ),
        timingProposalId: null,
        // Final-cue materialization remains fail-closed until the event-to-final
        // delivery cue contract proves a single, presentation-safe target.
        timingNonDegradationPassed: false,
      },
    ];
  });
  const replacement = buildTextReplacementContract({
    proposals,
    beforeTextHash: baselineFreeze.canonicalTextHash,
    afterTextHash: baselineFreeze.canonicalTextHash,
    beforeTimingHash: baselineFreeze.canonicalTimingHash,
    afterTimingHash: baselineFreeze.canonicalTimingHash,
    presentationHash: baselineFreeze.presentationHash,
    canonicalTextMutationCount: 0,
    canonicalTimingMutationCount: 0,
    presentationMutationCount: 0,
    generatedAt: startedAt,
  });
  const artifactHashes = [
    vadTimebase.semanticHash,
    requestTimeline.semanticHash,
    tokenTimeline.semanticHash,
    acousticVerification.semanticHash,
    decisions.semanticHash,
    poolSufficiency.semanticHash,
    targetedReasr.semanticHash,
    replacement.semanticHash,
  ];
  const policy = createC6014QualityPolicy({
    vadGlobalTimebase: vadMode,
    textVariantVerifier: variantMode,
    targetedEventReasr: reasrMode,
    artifactSemanticHashes: artifactHashes,
    generatedAt: startedAt,
  });
  const sidecars = [
    ["machine-vad-global-timebase.json", vadTimebase],
    ["asr-request-timeline-contract-v2.json", requestTimeline],
    ["machine-global-token-timeline-v2.json", tokenTimeline],
    ["machine-text-variant-acoustic-verification.json", acousticVerification],
    ["machine-text-variant-decision.json", decisions],
    ["machine-candidate-pool-sufficiency.json", poolSufficiency],
    ["machine-targeted-event-reasr.json", targetedReasr],
    ["machine-text-replacement-contract.json", replacement],
    ["c6-0-1-4-quality-policy.json", policy],
  ] as const;
  for (const [fileName, value] of sidecars) {
    await atomicWriteJson(path.join(outputSubtitle, fileName), value);
  }
  await atomicWriteJson(
    path.join(evidenceRoot, "ffmpeg-extraction-audit.json"),
    {
      schemaVersion: "1.0.0",
      artifactType: "c6-0-1-4-ffmpeg-extraction-audit",
      policyVersion: POLICY_VERSION,
      entries: extractionAudit,
      sourceReadOnly: true,
      guessedOffsetCount: 0,
      semanticHash: machineQualitySemanticHash(extractionAudit),
    },
  );
  const sourceSha256After = await sha256BlindFile(source);
  const sourceInfoAfter = await stat(source);
  if (
    sourceSha256After !== sourceSha256 ||
    sourceInfoAfter.size !== sourceInfoBefore.size
  ) {
    throw new InputError("Source changed during C6.0.1.4 machine run.");
  }
  const completedAt = new Date().toISOString();
  const runAudit = {
    schemaVersion: "1.0.0",
    artifactType: "c6-0-1-4-machine-run-audit",
    policyVersion: POLICY_VERSION,
    runLabel,
    repositoryCommit,
    startedAt,
    completedAt,
    modes: { vadMode, variantMode, reasrMode },
    source: {
      sizeBefore: sourceInfoBefore.size,
      sizeAfter: sourceInfoAfter.size,
      sha256Before: sourceSha256,
      sha256After: sourceSha256After,
      readOnlyVerified: true,
    },
    runtimeIsolation: {
      networkUsed: false,
      runtimeGoldInputCount: 0,
      candidateTextPromptLeakCount: 0,
      humanMemoryLeakCount: 0,
      datasetHardcodingCount: 0,
    },
    whisperVad: {
      requestCount: legacyQuarantined.length,
      cacheHitCount: vadCacheHitCount,
      inferenceCount: vadInferenceCount,
      modelLoadCount: vadModelLoadCount,
      workerStartCount: vadWorkerStartCount,
      modelHash,
      runtimeBinaryHash: whisperBinaryHash,
      vadModelHash,
    },
    ctcVariantVerification: {
      requestCount: ctcInferenceCount + ctcCacheHitCount,
      cacheHitCount: ctcCacheHitCount,
      inferenceCount: ctcInferenceCount,
      modelLoadCount: ctcModelLoadCount,
      workerStartCount: ctcWorkerStartCount,
      runtimeIdentityHash: ctcCapability.runtimeIdentityHash,
      modelSnapshotHash: ctcCapability.modelSnapshotHash,
      deviceUsed: ctcCapability.deviceUsed,
    },
    targetedReasr: {
      requestCount: targetedReasr.summary.requestCount,
      cacheHitCount: reasrCacheHitCount,
      inferenceCount: reasrInferenceCount,
      modelLoadCount: reasrModelLoadCount,
      workerStartCount: reasrWorkerStartCount,
    },
    optionalProviders: {
      mfaRequestCount: 0,
      speakerRequestCount: 0,
      separationRequestCount: 0,
      reason: "no-text-stable-timing-only-or-genuine-multi-speaker-eligibility",
    },
    baselines: {
      vadQuarantinedRequestCount: legacyQuarantined.length,
      trustedMappedTokenCount: legacyTokens.summary.trustedMappedTokenCount,
      ambiguousTimeBaseTokenCount:
        legacyTokens.summary.quarantinedVadTokenCount,
    },
    recovered: {
      vadVerifiedRequestCount: vadTimebase.verifiedRequestCount,
      vadQuarantinedRequestCount: vadTimebase.quarantinedRequestCount,
      trustedMappedTokenCount: tokenTimeline.summary.trustedMappedTokenCount,
      ambiguousTimeBaseTokenCount:
        tokenTimeline.summary.ambiguousTimeBaseTokenCount,
      associationPendingTokenCount:
        tokenTimeline.summary.associationPendingTokenCount,
      trustedCueCount: tokenTimeline.summary.trustedCueCount,
      timingEligibleCueCount: tokenTimeline.summary.timingEligibleCueCount,
    },
    variants: {
      eventCount: machineEvents.length,
      multiVariantEventCount: machineEvents.filter(
        (event) => event.variants.length > 1,
      ).length,
      singleVariantEventCount: machineEvents.filter(
        (event) => event.variants.length === 1,
      ).length,
      selectorSummary: decisions.summary,
      poolSummary: poolSufficiency.summary,
      replacementSummary: replacement.summary,
    },
    semanticArtifactHashes: artifactHashes,
    productionStatus: "needs-review",
    finalizationMethod: "none",
    machineOnlyReleaseAuthorized: false,
  };
  await atomicWriteJson(path.join(output, "c6-0-1-4-machine-run-audit.json"), {
    ...runAudit,
    semanticHash: machineQualitySemanticHash(runAudit),
  });
  await atomicWriteJson(path.join(output, "blind-generation-execution.json"), {
    schemaVersion: "1.0.0",
    artifactType: "blind-generation-execution",
    generationRunId,
    generationStartedAt: startedAt,
    generationCompletedAt: completedAt,
    wallTimeMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
    exitCode: 0,
    sourceReadOnlyVerified: true,
    sourceHashBefore: sourceSha256,
    sourceHashAfter: sourceSha256After,
    networkUsed: false,
    onlineSubtitleSearchUsed: false,
    cloudModelInferenceCount: 0,
  });
  const provenance = await auditBlindRunProvenance({
    taskDirectory: output,
    generatedAt: completedAt,
    manifest: blindManifest,
  });
  await atomicWriteJson(
    path.join(output, "blind-provenance-audit.json"),
    provenance,
  );
  const freeze = await createBlindOutputFreeze({
    taskDirectory: output,
    freezeTimestamp: new Date().toISOString(),
  });
  await atomicWriteJson(path.join(output, "blind-output-freeze.json"), freeze);
  await verifyBlindOutputFreeze({ taskDirectory: output, expected: freeze });
  console.log(
    JSON.stringify(
      {
        output,
        runLabel,
        repositoryCommit,
        freezeHash: freeze.freezeSemanticHash,
        vad: runAudit.whisperVad,
        tokens: runAudit.recovered,
        ctc: runAudit.ctcVariantVerification,
        reasr: runAudit.targetedReasr,
        variants: runAudit.variants,
        productionStatus: runAudit.productionStatus,
        finalizationMethod: runAudit.finalizationMethod,
      },
      null,
      2,
    ),
  );
}

await main();

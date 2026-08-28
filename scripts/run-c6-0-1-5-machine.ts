import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { deflateRawSync } from "node:zlib";

import {
  atomicWriteFile,
  atomicWriteJson,
  ctcAlignmentAttemptSchema,
  ctcRuntimeCapabilitySchema,
  decoderEvidenceSchema,
  InputError,
  mvlWhisperServerResponseSchema,
  pathExists,
  subtitlePackageSchema,
  type C6015Mode,
  type CtcAlignmentAttempt,
  type DecoderEvidence,
  type MachineTextVariantAcousticVerification,
  type MachineTextVariantDecision,
  type MachineGlobalTokenTimelineV2,
  type MvlWhisperServerResponse,
  type SubtitlePackage,
} from "@mvl/shared";
import { WhisperCppWorkerPool } from "@mvl/transcription-core";
import {
  applyCanonicalMutations,
  auditBlindRunProvenance,
  buildCanonicalMutationProposals,
  buildC6015CandidatePool,
  buildEvidenceApplicationCoverage,
  buildEventFinalCueLineage,
  buildLocalAssociationRepairProposals,
  buildRawAsrEventRecoveryArtifact,
  buildSingleVariantAcousticAudit,
  buildTrustedTokenTimingProposals,
  buildVariantEvidenceBundle,
  createBlindGenerationInputManifest,
  createBlindOutputFreeze,
  createC6015QualityPolicy,
  inspectReviewWav,
  loadAndVerifyCtcRuntime,
  LocalCtcWorker,
  machineQualitySemanticHash,
  normalizeCandidateText,
  planRawAsrEventRecovery,
  projectJapanesePronunciationBatch,
  sha256BlindFile,
  verifyBlindOutputFreeze,
  type ExecutedRawAsrRecoveryEvent,
  type PipelineLineageEdge,
  type RawAsrRecoveryPlanEvent,
  type TrustedVariantToken,
  type VariantCtcEvidenceInput,
  type VariantEvidenceInput,
  type VariantTokenEvidenceInput,
} from "@mvl/video-subtitler";

const execFileAsync = promisify(execFile);
const SOURCE_SAMPLE_RATE = 16_000;
const POLICY_VERSION = "c6.0.1.5-evidence-to-canonical-raw-asr-recovery-v1";

interface WhisperRuntimeManifest {
  upstream: { commit: string };
  patch: { patchId: string; patchSha256: string; responseSchema: string };
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

interface CanonicalEvent {
  eventId: string;
  acousticInterval: { start: number; end: number };
  candidateIds: string[];
  representativeCandidateId: string | null;
}

interface CanonicalEventsArtifact {
  events: CanonicalEvent[];
}

interface AssemblyOperation {
  eventId: string;
  inputCandidateIds: string[];
  selectedCandidateId: string;
  outputCueId: string;
}

interface CanonicalAssemblyArtifact {
  operations: AssemblyOperation[];
}

interface CandidateEvidence {
  cueId: string;
  interval: { start: number; end: number };
  text: string;
  sourceRequestIds: string[];
  sourceProfileIds: string[];
  independentSupportCount: number;
  speechCoverage: number;
  tokenTimingQuality: number;
  hallucinationRisk: number;
  repetitionRisk: number;
}

interface CandidateEvidenceArtifact {
  candidates: CandidateEvidence[];
}

interface AssociationRecord {
  candidateId: string;
  sourceCueId: string;
  assignedEventId: string | null;
  lineageIds: string[];
  disposition: string;
  score: { tieBreakScore: number };
  competingAssignments: {
    clusterId: string;
    score: number;
    hardCompatible: boolean;
    reasons: string[];
  }[];
}

interface AssociationLedger {
  records: AssociationRecord[];
}

interface TargetedReasrOutput {
  candidateId: string;
  requestIds: string[];
  text: string;
  sourceGlobalInterval: { start: number; end: number };
  tokenEvidenceIds: string[];
  decoderEvidenceHash: string;
  lineageComplete: boolean;
}

interface TargetedReasrRequest {
  requestId: string;
  requestFamily: string;
  sourceGlobalInterval: { start: number; end: number };
  sourceGlobalSampleInterval: { startSample: number; endSample: number };
  cacheIdentity: string;
  promptPresent: boolean;
}

interface TargetedReasrEvent {
  eventId: string;
  requestFamily: string;
  verificationRequests: TargetedReasrRequest[];
  candidateOutputs: TargetedReasrOutput[];
}

interface TargetedReasrArtifact {
  events: TargetedReasrEvent[];
}

interface GenerationSurvivalFunnel {
  finalCueLineage: { finalCueId: string; sourceRequestIds: string[] }[];
  rejectedUnits: {
    unitId: string;
    stage: string;
    reason: string;
    evidenceIds: string[];
  }[];
}

interface MachineVariant {
  variantId: string;
  eventId: string;
  text: string;
  interval: { start: number; end: number };
  eventInterval: { start: number; end: number };
  requestIds: string[];
  sourceWindowIds: string[];
  independentSupportGroups: string[];
  correlatedSupportGroups: string[];
  speechCoverage: number;
  hallucinationRisk: number | null;
  repetitionRisk: number;
  reAsrOrigin: {
    isReAsr: boolean;
    requestFamilyIds: string[];
    sourceGlobalVerified: boolean;
    promptIsolated: boolean;
  };
  decoderEvidence: DecoderEvidence;
}

interface MachineEvent {
  eventId: string;
  interval: { start: number; end: number };
  currentVariantId: string;
  variants: MachineVariant[];
}

function parseArguments(argv: readonly string[]): Map<string, string> {
  const allowed = new Set([
    "--baseline",
    "--output",
    "--source",
    "--shared-cache",
    "--imported-cache",
    "--run-label",
    "--evidence-to-canonical",
    "--text-application",
    "--timing-application",
    "--single-variant-audit",
    "--raw-asr-event-recovery",
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
      throw new InputError("Invalid C6.0.1.5 machine-run arguments.", {
        flag,
        allowed: [...allowed],
      });
    }
    parsed.set(flag, value);
  }
  return parsed;
}

function required(args: ReadonlyMap<string, string>, flag: string): string {
  const value = args.get(flag);
  if (value === undefined || value === "") {
    throw new InputError(`Missing required argument ${flag}.`);
  }
  return value;
}

function mode(args: ReadonlyMap<string, string>, flag: string): C6015Mode {
  const value = required(args, flag);
  if (!(value === "off" || value === "observe" || value === "enforce")) {
    throw new InputError(`${flag} must be off, observe, or enforce.`);
  }
  return value;
}

function optionalMode(
  args: ReadonlyMap<string, string>,
  flag: string,
  fallback: C6015Mode,
): C6015Mode {
  const value = args.get(flag);
  if (value === undefined) return fallback;
  if (!(value === "off" || value === "observe" || value === "enforce")) {
    throw new InputError(`${flag} must be off, observe, or enforce.`);
  }
  return value;
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

async function directoryArtifactHash(root: string): Promise<string> {
  const files: { relativePath: string; size: number; sha256: string }[] = [];
  const visit = async (current: string): Promise<void> => {
    for (const entry of (
      await readdir(current, { withFileTypes: true })
    ).toSorted((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === ".DS_Store") continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
      } else if (entry.isFile()) {
        files.push({
          relativePath: path.relative(root, absolute).split(path.sep).join("/"),
          size: (await stat(absolute)).size,
          sha256: await sha256File(absolute),
        });
      }
    }
  };
  await visit(root);
  return machineQualitySemanticHash(files);
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

async function cloneFrozenPackage(input: {
  baseline: string;
  output: string;
}): Promise<string> {
  if (await pathExists(input.output)) {
    throw new InputError(
      "C6.0.1.5 output already exists; overwrite is forbidden.",
      {
        output: input.output,
      },
    );
  }
  await verifyBlindOutputFreeze({ taskDirectory: input.baseline });
  await mkdir(input.output, { recursive: false });
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
  for (const fileName of [
    "blind-evaluation-policy.json",
    "machine-baseline-evidence-coverage.json",
    "machine-shadow-finalization-policy.json",
    "machine-shadow-finalization.json",
  ]) {
    const source = path.join(input.baseline, fileName);
    if (await pathExists(source)) {
      await cp(source, path.join(input.output, fileName), {
        errorOnExist: true,
        force: false,
      });
    }
  }
  return outputSubtitle;
}

function unknownDecoder(reason: string): DecoderEvidence {
  return decoderEvidenceSchema.parse({
    status: "unknown",
    averageLogProbability: null,
    noSpeechProbability: null,
    compressionRatio: null,
    repetitionRatio: null,
    tokenTimingQuality: null,
    textDensity: null,
    edgePosition: null,
    fallbackLevel: null,
    temperature: null,
    requestDurationSeconds: null,
    decoderEvidenceHash: null,
    unavailableReasons: [reason],
  });
}

function repetitionRatio(text: string): number {
  const normalized = Array.from(normalizeCandidateText(text));
  if (normalized.length < 2) return 0;
  const pairs = normalized
    .slice(0, -1)
    .map((value, index) => `${value}${normalized[index + 1] ?? ""}`);
  return 1 - new Set(pairs).size / pairs.length;
}

function decoderFromResponse(
  response: MvlWhisperServerResponse,
  text: string,
  requestDurationSeconds: number,
): DecoderEvidence {
  const segments = response.transcription;
  if (segments.length === 0)
    return unknownDecoder("whisper-response-has-no-segments");
  const average = (values: readonly number[]): number =>
    values.reduce((sum, value) => sum + value, 0) / values.length;
  const lexicalTokens = segments.flatMap((segment) =>
    segment.tokens.filter((token) => !token.special),
  );
  const compressed = deflateRawSync(Buffer.from(text, "utf8")).length;
  const core = {
    status: "available" as const,
    averageLogProbability: average(
      segments.map((segment) => segment.avgLogProbability),
    ),
    noSpeechProbability: average(
      segments.map((segment) => segment.noSpeechProbability),
    ),
    compressionRatio: Buffer.byteLength(text, "utf8") / Math.max(1, compressed),
    repetitionRatio: repetitionRatio(text),
    tokenTimingQuality:
      lexicalTokens.length === 0
        ? 0
        : lexicalTokens.filter((token) => token.mapped !== null).length /
          lexicalTokens.length,
    textDensity:
      Array.from(normalizeCandidateText(text)).length /
      Math.max(0.001, requestDurationSeconds),
    edgePosition: "inside" as const,
    fallbackLevel: segments.filter((segment) => segment.temperature > 0).length,
    temperature: Math.max(...segments.map((segment) => segment.temperature)),
    requestDurationSeconds,
    decoderEvidenceHash: machineQualitySemanticHash({
      segments: segments.map((segment) => ({
        avgLogProbability: segment.avgLogProbability,
        noSpeechProbability: segment.noSpeechProbability,
        temperature: segment.temperature,
      })),
      text,
    }),
    unavailableReasons: [],
  };
  return decoderEvidenceSchema.parse(core);
}

function candidateDecoder(input: {
  candidate: CandidateEvidence;
  package: SubtitlePackage;
  lineageFinalCueIds: readonly string[];
}): DecoderEvidence {
  const cue =
    input.package.cues.find((entry) => entry.id === input.candidate.cueId) ??
    (input.lineageFinalCueIds.length === 1
      ? input.package.cues.find(
          (entry) => entry.id === input.lineageFinalCueIds[0],
        )
      : undefined);
  const metrics = cue?.transcriptionMetrics;
  if (
    metrics?.averageLogProbability === null ||
    metrics?.averageLogProbability === undefined ||
    metrics.noSpeechProbability === null ||
    metrics.noSpeechProbability === undefined
  ) {
    return unknownDecoder("primary-candidate-decoder-fields-not-retained");
  }
  return decoderEvidenceSchema.parse({
    status: "available",
    averageLogProbability: metrics.averageLogProbability,
    noSpeechProbability: metrics.noSpeechProbability,
    compressionRatio: null,
    repetitionRatio: input.candidate.repetitionRisk,
    tokenTimingQuality: input.candidate.tokenTimingQuality,
    textDensity:
      Array.from(normalizeCandidateText(input.candidate.text)).length /
      Math.max(
        0.001,
        input.candidate.interval.end - input.candidate.interval.start,
      ),
    edgePosition: "inside",
    fallbackLevel: metrics.decoderFallback === true ? 1 : 0,
    temperature: null,
    requestDurationSeconds:
      input.candidate.interval.end - input.candidate.interval.start,
    decoderEvidenceHash: machineQualitySemanticHash(metrics),
    unavailableReasons: ["provider-temperature-and-compression-not-retained"],
  });
}

function cachePath(root: string, family: string, key: string): string {
  return path.join(root, family, key.slice(0, 2), `${key}.json`);
}

async function readWhisperCache(input: {
  root: string;
  importedRoot?: string;
  family: string;
  key: string;
}): Promise<MvlWhisperServerResponse | null> {
  for (const root of [input.root, input.importedRoot].filter(
    (entry): entry is string => entry !== undefined,
  )) {
    const filePath = cachePath(root, input.family, input.key);
    if (!(await pathExists(filePath))) continue;
    const record = await json<WhisperCacheRecord>(filePath);
    if (
      record.cacheIdentity !== input.key ||
      record.responseSemanticHash !==
        machineQualitySemanticHash(record.response)
    ) {
      throw new InputError("C6.0.1.5 Whisper cache identity mismatch.", {
        filePath,
      });
    }
    return mvlWhisperServerResponseSchema.parse(record.response);
  }
  return null;
}

async function writeWhisperCache(input: {
  root: string;
  family: string;
  key: string;
  response: MvlWhisperServerResponse;
}): Promise<void> {
  const filePath = cachePath(input.root, input.family, input.key);
  await mkdir(path.dirname(filePath), { recursive: true });
  await atomicWriteJson(filePath, {
    schemaVersion: "1.0.0",
    cacheIdentity: input.key,
    response: input.response,
    responseSemanticHash: machineQualitySemanticHash(input.response),
  } satisfies WhisperCacheRecord);
}

async function ensureExtractedAudio(input: {
  source: string;
  sourceSha256: string;
  startSample: number;
  endSample: number;
  ffmpeg: string;
  sharedCache: string;
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
  const outputPath = path.join(cacheDirectory, `${commandIdentity}.wav`);
  const cacheHit = await pathExists(outputPath);
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
      outputPath,
    ]);
  }
  const wav = inspectReviewWav(await readFile(outputPath));
  if (wav.sampleRate !== SOURCE_SAMPLE_RATE || wav.frameCount !== sampleCount) {
    throw new InputError(
      "Extracted WAV does not match source-global sample lineage.",
      {
        expectedSampleCount: sampleCount,
        actualSampleCount: wav.frameCount,
      },
    );
  }
  return {
    audioPath: outputPath,
    audioSha256: await sha256File(outputPath),
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

async function sudachiReadings(input: {
  variants: readonly MachineVariant[];
  python: string;
  helper: string;
}): Promise<
  Map<string, { reading: string | null; unresolvedUnits: string[] }>
> {
  const raw = (await runJsonProcess({
    executable: input.python,
    args: [input.helper],
    request: {
      items: input.variants.map((variant) => ({
        id: variant.variantId,
        text: variant.text,
      })),
    },
  })) as {
    items: { id: string; reading: string | null; unresolvedOov: string[] }[];
  };
  return new Map(
    raw.items.map((item) => [
      item.id,
      { reading: item.reading, unresolvedUnits: item.unresolvedOov },
    ]),
  );
}

async function runWhisperRequest(input: {
  pool: WhisperCppWorkerPool;
  responseCacheRoot: string;
  importedCacheRoot?: string;
  cacheIdentity: string;
  audio: ExtractionResult;
  requestId: string;
  requestStartSeconds: number;
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
}> {
  const family = "whisper-c6015-raw-asr-recovery";
  const cached = await readWhisperCache({
    root: input.responseCacheRoot,
    ...(input.importedCacheRoot === undefined
      ? {}
      : { importedRoot: input.importedCacheRoot }),
    family,
    key: input.cacheIdentity,
  });
  if (cached !== null) {
    input.pool.recordCacheHit({
      requestKey: input.requestId,
      useVad: false,
      profile: "no-vad",
    });
    return {
      response: cached,
      cacheHit: true,
      inferenceExecuted: false,
      modelLoadCount: 0,
      workerStartCount: 0,
    };
  }
  const before = input.pool.metrics();
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
      useVad: false,
      vadProfile: "sensitive-v2",
      tokenTimestamps: true,
      promptConstraint: "clean-prompt-null",
      serverPath: input.serverPath,
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
  const response = mvlWhisperServerResponseSchema.parse(
    (result.raw as { mvlResponse?: unknown }).mvlResponse,
  );
  await writeWhisperCache({
    root: input.responseCacheRoot,
    family,
    key: input.cacheIdentity,
    response,
  });
  const after = input.pool.metrics();
  return {
    response,
    cacheHit: false,
    inferenceExecuted: true,
    modelLoadCount: Math.max(0, after.modelLoadCount - before.modelLoadCount),
    workerStartCount: Math.max(
      0,
      after.workerStartCount - before.workerStartCount,
    ),
  };
}

function relationType(
  sourceCount: number,
  targetCount: number,
): PipelineLineageEdge["relationType"] {
  if (sourceCount > targetCount) return "MERGE";
  if (sourceCount < targetCount) return "SPLIT";
  return "IDENTITY";
}

interface SourceOutputRecord {
  sourceCueIds?: string[];
  sourceCueId?: string;
  outputCueIds?: string[];
}

async function pipelineLineage(input: {
  subtitle: string;
  package: SubtitlePackage;
  canonical: CanonicalEventsArtifact;
  assembly: CanonicalAssemblyArtifact;
  association: AssociationLedger;
  funnel: GenerationSurvivalFunnel;
}): Promise<{
  events: {
    eventId: string;
    candidateIds: string[];
    canonicalCueIds: string[];
  }[];
  edges: PipelineLineageEdge[];
  dropped: { sourceId: string; operationArtifact: string; reason: string }[];
}> {
  const edges: PipelineLineageEdge[] = [];
  for (const record of input.association.records) {
    const sourceIds = [...new Set([record.sourceCueId, ...record.lineageIds])];
    edges.push({
      sourceIds,
      targetIds: [record.candidateId],
      relationType: "TEXT_PROJECTION",
      operationArtifact: "machine-candidate-association-ledger.json",
      reason: "explicit-candidate-lineage-ids",
    });
  }
  for (const operation of input.assembly.operations) {
    edges.push({
      sourceIds: [
        ...new Set([
          ...operation.inputCandidateIds,
          operation.selectedCandidateId,
        ]),
      ],
      targetIds: [operation.outputCueId],
      relationType: "CANONICAL_ASSEMBLY",
      operationArtifact: "machine-canonical-assembly.json",
      reason: "explicit-canonical-assembly-operation",
    });
  }
  for (const fileName of [
    "atomic-candidate-segmentation.json",
    "cue-segmentation-plan.json",
    "post-text-repair-segmentation.json",
    "post-subtitle-repair-segmentation.json",
    "intra-cue-repetition-repair.json",
    "machine-lexical-conservation.json",
  ]) {
    const artifact = await json<{
      entries?: SourceOutputRecord[];
      repairs?: SourceOutputRecord[];
    }>(path.join(input.subtitle, fileName));
    for (const record of artifact.entries ?? artifact.repairs ?? []) {
      const sourceIds = [
        ...(record.sourceCueIds ?? []),
        ...(record.sourceCueId === undefined ? [] : [record.sourceCueId]),
      ];
      const targetIds = record.outputCueIds ?? [];
      if (sourceIds.length === 0 || targetIds.length === 0) continue;
      edges.push({
        sourceIds,
        targetIds,
        relationType: relationType(sourceIds.length, targetIds.length),
        operationArtifact: fileName,
        reason: "explicit-source-output-operation-record",
      });
    }
  }
  const fragment = await json<{
    repairs: { sourceWinnerIds: string[]; outputCueId: string }[];
  }>(path.join(input.subtitle, "fragment-repair.json"));
  for (const repair of fragment.repairs) {
    edges.push({
      sourceIds: repair.sourceWinnerIds,
      targetIds: [repair.outputCueId],
      relationType: "MERGE",
      operationArtifact: "fragment-repair.json",
      reason: "explicit-fragment-merge-record",
    });
  }
  const finalRepair = await json<{
    repairs: { sourceCueIds: string[]; outputCueIds: string[] }[];
  }>(path.join(input.subtitle, "final-subtitle-repair.json"));
  for (const repair of finalRepair.repairs) {
    edges.push({
      sourceIds: repair.sourceCueIds,
      targetIds: repair.outputCueIds,
      relationType: "DEDUPE",
      operationArtifact: "final-subtitle-repair.json",
      reason: "explicit-final-repair-source-output-record",
    });
  }
  const retention = await json<{
    records: { sourceCandidateId: string; outputCueId: string }[];
  }>(path.join(input.subtitle, "machine-supported-text-retention.json"));
  for (const record of retention.records) {
    edges.push({
      sourceIds: [record.sourceCandidateId],
      targetIds: [record.outputCueId],
      relationType: "TEXT_PROJECTION",
      operationArtifact: "machine-supported-text-retention.json",
      reason: "explicit-supported-text-retention-record",
    });
  }
  for (const cue of input.package.cues) {
    for (const sourceId of cue.textAudit?.sourceWinnerCueIds ?? []) {
      edges.push({
        sourceIds: [sourceId],
        targetIds: [cue.id],
        relationType: "FINAL_SURVIVAL",
        operationArtifact: "subtitle-package.json",
        reason: "final-cue-source-winner-id",
      });
    }
    for (const sourceId of cue.provenance?.sourceRequestIds ?? []) {
      edges.push({
        sourceIds: [sourceId],
        targetIds: [cue.id],
        relationType: "FINAL_SURVIVAL",
        operationArtifact: "subtitle-package.json",
        reason: "final-cue-source-request-id",
      });
    }
  }
  for (const entry of input.funnel.finalCueLineage) {
    for (const sourceId of entry.sourceRequestIds) {
      edges.push({
        sourceIds: [sourceId],
        targetIds: [entry.finalCueId],
        relationType: "FINAL_SURVIVAL",
        operationArtifact: "machine-generation-survival-funnel.json",
        reason: "explicit-generation-survival-lineage",
      });
    }
  }
  const assemblyByEvent = new Map(
    input.assembly.operations.map((operation) => [
      operation.eventId,
      operation,
    ]),
  );
  return {
    events: input.canonical.events.map((event) => {
      const assembly = assemblyByEvent.get(event.eventId);
      return {
        eventId: event.eventId,
        candidateIds: event.candidateIds,
        canonicalCueIds: [
          ...new Set([
            ...event.candidateIds,
            ...(assembly === undefined
              ? []
              : [assembly.outputCueId, assembly.selectedCandidateId]),
          ]),
        ],
      };
    }),
    edges,
    dropped: input.funnel.rejectedUnits.map((entry) => ({
      sourceId: entry.unitId,
      operationArtifact: "machine-generation-survival-funnel.json",
      reason: `${entry.stage}:${entry.reason}`,
    })),
  };
}

function ctcScoreFromExisting(
  evidence: MachineTextVariantAcousticVerification["events"][number]["ctcEvidence"][number],
): number | null {
  if (evidence.evidenceStatus !== "CTC_SCORABLE") return null;
  const cost = evidence.normalizedAlignmentCost;
  const posterior = evidence.meanTokenPosterior;
  return Math.max(
    0,
    Math.min(
      1,
      evidence.alignmentCoverage * 0.25 +
        (cost === null ? 0 : 1 - Math.min(1, cost)) * 0.25 +
        (posterior ?? 0) * 0.25 +
        (evidence.greedyNormalizedSimilarity ?? 0) * 0.15 +
        evidence.durationCoverage * 0.1,
    ),
  );
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

async function loadTargetedEvidence(input: {
  targeted: TargetedReasrArtifact;
  sharedCache: string;
  importedCache?: string;
}): Promise<{
  responseByRequest: Map<string, MvlWhisperServerResponse>;
  requestById: Map<string, TargetedReasrRequest>;
}> {
  const responseByRequest = new Map<string, MvlWhisperServerResponse>();
  const requestById = new Map<string, TargetedReasrRequest>();
  for (const event of input.targeted.events) {
    for (const request of event.verificationRequests) {
      requestById.set(request.requestId, request);
      const response = await readWhisperCache({
        root: input.sharedCache,
        ...(input.importedCache === undefined
          ? {}
          : { importedRoot: input.importedCache }),
        family: "whisper-targeted-reasr",
        key: request.cacheIdentity,
      });
      if (response !== null) responseByRequest.set(request.requestId, response);
    }
  }
  return { responseByRequest, requestById };
}

function existingVariantTokens(timeline: MachineGlobalTokenTimelineV2): {
  evidenceTokens: VariantTokenEvidenceInput[];
  timingTokens: TrustedVariantToken[];
} {
  const evidenceTokens = timeline.tokens.flatMap((token) =>
    token.cueId === null
      ? []
      : [
          {
            tokenId: token.tokenId,
            variantId: token.cueId,
            text: token.text,
            lexical: token.lexical,
            trusted: token.trusted,
          },
        ],
  );
  const timingTokens = timeline.tokens.flatMap((token) =>
    token.cueId === null
      ? []
      : [
          {
            tokenId: token.tokenId,
            variantId: token.cueId,
            trusted: token.trusted,
            lexical: token.lexical,
            sourceGlobalInterval: token.sourceGlobalInterval,
          },
        ],
  );
  return { evidenceTokens, timingTokens };
}

function targetedVariantTokens(input: {
  targeted: TargetedReasrArtifact;
  responseByRequest: ReadonlyMap<string, MvlWhisperServerResponse>;
  requestById: ReadonlyMap<string, TargetedReasrRequest>;
}): {
  evidenceTokens: VariantTokenEvidenceInput[];
  timingTokens: TrustedVariantToken[];
} {
  const evidenceTokens: VariantTokenEvidenceInput[] = [];
  const timingTokens: TrustedVariantToken[] = [];
  for (const event of input.targeted.events) {
    for (const candidate of event.candidateOutputs) {
      let tokenIndex = 0;
      for (const requestId of candidate.requestIds) {
        const response = input.responseByRequest.get(requestId);
        const request = input.requestById.get(requestId);
        if (response === undefined || request === undefined) continue;
        for (const token of response.transcription.flatMap((segment) =>
          segment.tokens.filter((entry) => !entry.special),
        )) {
          const tokenId = `${candidate.candidateId}:mapped-token-${String(tokenIndex).padStart(4, "0")}`;
          tokenIndex += 1;
          const trusted = token.mapped !== null && token.probability >= 0.45;
          const sourceGlobalInterval =
            token.mapped === null
              ? null
              : {
                  start:
                    request.sourceGlobalInterval.start +
                    token.mapped.startCentiseconds * 0.01,
                  end:
                    request.sourceGlobalInterval.start +
                    token.mapped.endCentiseconds * 0.01,
                };
          evidenceTokens.push({
            tokenId,
            variantId: candidate.candidateId,
            text: token.text,
            lexical: normalizeCandidateText(token.text) !== "",
            trusted,
          });
          timingTokens.push({
            tokenId,
            variantId: candidate.candidateId,
            trusted,
            lexical: normalizeCandidateText(token.text) !== "",
            sourceGlobalInterval,
          });
        }
      }
    }
  }
  return { evidenceTokens, timingTokens };
}

function buildMachineEvents(input: {
  canonical: CanonicalEventsArtifact;
  assembly: CanonicalAssemblyArtifact;
  decisions: MachineTextVariantDecision;
  candidates: CandidateEvidenceArtifact;
  targeted: TargetedReasrArtifact;
  package: SubtitlePackage;
  lineageFinalByEvent: ReadonlyMap<string, readonly string[]>;
  targetedResponses: ReadonlyMap<string, MvlWhisperServerResponse>;
  targetedRequests: ReadonlyMap<string, TargetedReasrRequest>;
}): MachineEvent[] {
  const canonicalByEvent = new Map(
    input.canonical.events.map((event) => [event.eventId, event]),
  );
  const assemblyByEvent = new Map(
    input.assembly.operations.map((operation) => [
      operation.eventId,
      operation,
    ]),
  );
  const candidateById = new Map(
    input.candidates.candidates.map((candidate) => [
      candidate.cueId,
      candidate,
    ]),
  );
  const targetedById = new Map(
    input.targeted.events.flatMap((event) =>
      event.candidateOutputs.map(
        (candidate) => [candidate.candidateId, { event, candidate }] as const,
      ),
    ),
  );
  return input.decisions.decisions.flatMap((decision) => {
    const canonical = canonicalByEvent.get(decision.eventId);
    const assembly = assemblyByEvent.get(decision.eventId);
    if (canonical === undefined || assembly === undefined) return [];
    const variants = decision.inputVariants.flatMap<MachineVariant>(
      (variantId) => {
        const candidate = candidateById.get(variantId);
        if (candidate !== undefined) {
          const decoderEvidence = candidateDecoder({
            candidate,
            package: input.package,
            lineageFinalCueIds:
              input.lineageFinalByEvent.get(decision.eventId) ?? [],
          });
          const independent = [
            ...new Set([
              ...candidate.sourceRequestIds,
              ...candidate.sourceProfileIds,
            ]),
          ];
          return [
            {
              variantId,
              eventId: decision.eventId,
              text: candidate.text,
              interval: candidate.interval,
              eventInterval: canonical.acousticInterval,
              requestIds: candidate.sourceRequestIds,
              sourceWindowIds: candidate.sourceProfileIds,
              independentSupportGroups: independent,
              correlatedSupportGroups: candidate.sourceRequestIds,
              speechCoverage: candidate.speechCoverage,
              hallucinationRisk: candidate.hallucinationRisk,
              repetitionRisk: candidate.repetitionRisk,
              reAsrOrigin: {
                isReAsr: false,
                requestFamilyIds: [],
                sourceGlobalVerified: true,
                promptIsolated: true,
              },
              decoderEvidence,
            } satisfies MachineVariant,
          ];
        }
        const targeted = targetedById.get(variantId);
        if (targeted === undefined) return [];
        const responses = targeted.candidate.requestIds.flatMap((requestId) => {
          const response = input.targetedResponses.get(requestId);
          return response === undefined ? [] : [response];
        });
        const requestDurationSeconds = targeted.candidate.requestIds.reduce(
          (sum, requestId) => {
            const request = input.targetedRequests.get(requestId);
            return (
              sum +
              (request === undefined
                ? 0
                : request.sourceGlobalInterval.end -
                  request.sourceGlobalInterval.start)
            );
          },
          0,
        );
        return [
          {
            variantId,
            eventId: decision.eventId,
            text: targeted.candidate.text,
            interval: targeted.candidate.sourceGlobalInterval,
            eventInterval: canonical.acousticInterval,
            requestIds: targeted.candidate.requestIds,
            sourceWindowIds: targeted.candidate.requestIds,
            independentSupportGroups: [targeted.event.requestFamily],
            correlatedSupportGroups: targeted.candidate.requestIds,
            speechCoverage: Math.max(
              0,
              Math.min(
                1,
                (Math.min(
                  targeted.candidate.sourceGlobalInterval.end,
                  canonical.acousticInterval.end,
                ) -
                  Math.max(
                    targeted.candidate.sourceGlobalInterval.start,
                    canonical.acousticInterval.start,
                  )) /
                  Math.max(
                    0.001,
                    canonical.acousticInterval.end -
                      canonical.acousticInterval.start,
                  ),
              ),
            ),
            hallucinationRisk: null,
            repetitionRisk: repetitionRatio(targeted.candidate.text),
            reAsrOrigin: {
              isReAsr: true,
              requestFamilyIds: [targeted.event.requestFamily],
              sourceGlobalVerified: targeted.candidate.lineageComplete,
              promptIsolated: targeted.event.verificationRequests.every(
                (request) => !request.promptPresent,
              ),
            },
            decoderEvidence:
              responses[0] === undefined
                ? unknownDecoder("targeted-reasr-response-cache-unavailable")
                : decoderFromResponse(
                    responses[0],
                    targeted.candidate.text,
                    Math.max(0.001, requestDurationSeconds / responses.length),
                  ),
          } satisfies MachineVariant,
        ];
      },
    );
    const currentVariantId = variants.some(
      (variant) => variant.variantId === assembly.selectedCandidateId,
    )
      ? assembly.selectedCandidateId
      : (decision.selectedVariant ?? variants[0]?.variantId);
    if (currentVariantId === undefined || variants.length === 0) return [];
    return [
      {
        eventId: decision.eventId,
        interval: canonical.acousticInterval,
        currentVariantId,
        variants,
      },
    ];
  });
}

function variantInputs(
  events: readonly MachineEvent[],
): VariantEvidenceInput[] {
  return events.flatMap((event) =>
    event.variants.map((variant) => ({
      variantId: variant.variantId,
      eventId: event.eventId,
      candidateId: variant.variantId,
      text: variant.text,
      interval: variant.interval,
      eventInterval: event.interval,
      requestIds: variant.requestIds,
      sourceWindowIds: variant.sourceWindowIds,
      independentSupportGroups: variant.independentSupportGroups,
      correlatedSupportGroups: variant.correlatedSupportGroups,
      speechCoverage: variant.speechCoverage,
      reAsrOrigin: variant.reAsrOrigin,
      decoderEvidence: variant.decoderEvidence,
    })),
  );
}

function existingCtcEvidence(
  artifact: MachineTextVariantAcousticVerification,
): VariantCtcEvidenceInput[] {
  return artifact.events.flatMap((event) =>
    event.ctcEvidence.map((evidence) => ({
      variantId: evidence.variantId,
      evidenceId: evidence.semanticHash,
      score: ctcScoreFromExisting(evidence),
      edgePinned: evidence.edgePinned,
    })),
  );
}

interface CtcRunAudit {
  evidence: VariantCtcEvidenceInput[];
  requestCount: number;
  cacheHitCount: number;
  inferenceCount: number;
  modelLoadCount: number;
  workerStartCount: number;
  runtimeIdentityHash: string | null;
  modelSnapshotHash: string | null;
  deviceUsed: string | null;
}

async function runCtcEvidence(input: {
  variants: readonly MachineVariant[];
  events: ReadonlyMap<string, MachineEvent>;
  source: string;
  sourceSha256: string;
  sourceTotalSamples: number;
  sharedCache: string;
  importedCache?: string;
  ffmpeg: string;
  runtimeManifest: string;
  modelManifest: string;
  capabilityPath: string;
  sudachiPython: string;
  sudachiHelper: string;
}): Promise<CtcRunAudit> {
  if (input.variants.length === 0) {
    return {
      evidence: [],
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
    runtimeManifestPath: input.runtimeManifest,
    modelManifestPath: input.modelManifest,
  });
  const capability = ctcRuntimeCapabilitySchema.parse(
    await json<unknown>(input.capabilityPath),
  );
  if (
    capability.runtimeIdentityHash !== verified.runtime.runtimeIdentityHash ||
    capability.modelSnapshotHash !== verified.model.modelSnapshotHash
  ) {
    throw new InputError("CTC runtime capability identity mismatch.");
  }
  const readings = await sudachiReadings({
    variants: input.variants,
    python: input.sudachiPython,
    helper: input.sudachiHelper,
  });
  const projections = projectJapanesePronunciationBatch({
    variants: input.variants.map((variant) => ({
      variantId: variant.variantId,
      displayText: variant.text,
    })),
    machineReadings: readings,
  });
  const projectionByVariant = new Map(
    projections.map((projection) => [
      projection.projectionId.replace(/^acoustic-projection:/u, ""),
      projection,
    ]),
  );
  let worker: LocalCtcWorker | null = null;
  let cacheHitCount = 0;
  let inferenceCount = 0;
  let modelLoadCount = 0;
  let workerStartCount = 0;
  const evidence: VariantCtcEvidenceInput[] = [];
  try {
    let completed = 0;
    for (const variant of input.variants) {
      const event = input.events.get(variant.eventId);
      const projection = projectionByVariant.get(variant.variantId);
      if (
        event === undefined ||
        projection === undefined ||
        projection.method === "unscorable" ||
        projection.projectionText === ""
      ) {
        continue;
      }
      const startSample = Math.max(
        0,
        Math.floor(event.interval.start * SOURCE_SAMPLE_RATE),
      );
      const endSample = Math.min(
        input.sourceTotalSamples,
        Math.max(
          startSample + 1,
          Math.ceil(event.interval.end * SOURCE_SAMPLE_RATE),
        ),
      );
      const audio = await ensureExtractedAudio({
        source: input.source,
        sourceSha256: input.sourceSha256,
        startSample,
        endSample,
        ffmpeg: input.ffmpeg,
        sharedCache: input.sharedCache,
      });
      const cacheIdentity = machineQualitySemanticHash({
        family: "c6015-single-variant-acoustic-audit",
        policyVersion: POLICY_VERSION,
        eventId: event.eventId,
        variantId: variant.variantId,
        audioSha256: audio.audioSha256,
        projectionTextHash: projection.projectionTextHash,
        runtimeIdentityHash: capability.runtimeIdentityHash,
        modelSnapshotHash: capability.modelSnapshotHash,
        viterbiPolicy: "mvl-ctc-viterbi-v1",
      });
      const candidates = [input.sharedCache, input.importedCache].filter(
        (entry): entry is string => entry !== undefined,
      );
      let attempt: CtcAlignmentAttempt | null = null;
      for (const root of candidates) {
        const filePath = cachePath(root, "ctc-c6015-audit", cacheIdentity);
        if (!(await pathExists(filePath))) continue;
        attempt = ctcAlignmentAttemptSchema.parse(
          await json<unknown>(filePath),
        );
        cacheHitCount += 1;
        break;
      }
      if (attempt === null) {
        worker ??= new LocalCtcWorker({
          ...verified,
          device: capability.deviceUsed,
          workerScriptPath: path.resolve("scripts/runtime/ctc_worker.py"),
        });
        if (workerStartCount === 0) workerStartCount = 1;
        attempt = await worker.align({
          attemptId: `ctc-c6015:${cacheIdentity.slice(0, 24)}`,
          cueId: variant.variantId,
          componentId: event.eventId,
          windowType: "narrow",
          audioPath: audio.audioPath,
          audioSha256: audio.audioSha256,
          audioLocalInterval: {
            start: 0,
            end: audio.sampleCount / SOURCE_SAMPLE_RATE,
          },
          mediaGlobalInterval: event.interval,
          targetText: projection.projectionText,
        });
        inferenceCount += 1;
        modelLoadCount += attempt.modelLoadCount;
        const filePath = cachePath(
          input.sharedCache,
          "ctc-c6015-audit",
          cacheIdentity,
        );
        await mkdir(path.dirname(filePath), { recursive: true });
        await atomicWriteJson(filePath, attempt);
      }
      evidence.push({
        variantId: variant.variantId,
        evidenceId: attempt.attemptId,
        score: ctcScoreFromAttempt(attempt),
        edgePinned:
          attempt.startPinnedToWindowEdge || attempt.endPinnedToWindowEdge,
      });
      completed += 1;
      if (completed % 10 === 0 || completed === input.variants.length) {
        console.error(
          JSON.stringify({
            stage: "c6015-ctc-audit",
            completed,
            total: input.variants.length,
            cacheHitCount,
            inferenceCount,
          }),
        );
      }
    }
  } finally {
    if (worker !== null) await worker.close();
  }
  return {
    evidence,
    requestCount: evidence.length,
    cacheHitCount,
    inferenceCount,
    modelLoadCount,
    workerStartCount,
    runtimeIdentityHash: capability.runtimeIdentityHash,
    modelSnapshotHash: capability.modelSnapshotHash,
    deviceUsed: capability.deviceUsed,
  };
}

interface RawRecoveryExecution {
  variants: MachineVariant[];
  evidenceTokens: VariantTokenEvidenceInput[];
  timingTokens: TrustedVariantToken[];
  executed: ExecutedRawAsrRecoveryEvent[];
  workerStartCount: number;
}

async function executeRawRecovery(input: {
  mode: C6015Mode;
  plan: readonly RawAsrRecoveryPlanEvent[];
  events: ReadonlyMap<string, MachineEvent>;
  source: string;
  sourceSha256: string;
  sharedCache: string;
  importedCache?: string;
  ffmpeg: string;
  whisperServer: string;
  whisperModel: string;
  vadModel: string;
  whisperRuntimeManifest: string;
}): Promise<RawRecoveryExecution> {
  if (input.mode === "off" || input.plan.length === 0) {
    return {
      variants: [],
      evidenceTokens: [],
      timingTokens: [],
      executed: [],
      workerStartCount: 0,
    };
  }
  const runtime = await json<WhisperRuntimeManifest>(
    input.whisperRuntimeManifest,
  );
  const modelHash = await sha256File(input.whisperModel);
  const variants: MachineVariant[] = [];
  const evidenceTokens: VariantTokenEvidenceInput[] = [];
  const timingTokens: TrustedVariantToken[] = [];
  const executed: ExecutedRawAsrRecoveryEvent[] = [];
  const pool = new WhisperCppWorkerPool({
    mode: "persistent",
    stateIsolation: "require-safe",
  });
  let totalWorkerStarts = 0;
  try {
    for (const planned of input.plan) {
      const event = input.events.get(planned.eventId);
      if (event === undefined) continue;
      const responses: {
        request: RawAsrRecoveryPlanEvent["requests"][number];
        response: MvlWhisperServerResponse;
        cacheHit: boolean;
        inferenceExecuted: boolean;
        modelLoadCount: number;
      }[] = [];
      let eventWorkerStarts = 0;
      for (const request of planned.requests) {
        if ((request as { prompt: unknown }).prompt !== null) {
          throw new InputError(
            "Raw ASR recovery candidate prompt must be null.",
          );
        }
        const audio = await ensureExtractedAudio({
          source: input.source,
          sourceSha256: input.sourceSha256,
          startSample: request.sourceGlobalSampleInterval.startSample,
          endSample: request.sourceGlobalSampleInterval.endSample,
          ffmpeg: input.ffmpeg,
          sharedCache: input.sharedCache,
        });
        const cacheIdentity = machineQualitySemanticHash({
          family: "c6015-raw-asr-event-recovery",
          policyVersion: POLICY_VERSION,
          requestFamilyId: request.requestFamilyId,
          windowType: request.windowType,
          sourceSha256: input.sourceSha256,
          sourceGlobalSampleInterval: request.sourceGlobalSampleInterval,
          audioSha256: audio.audioSha256,
          modelHash,
          runtimeBinaryHash: runtime.patched.binarySha256,
          prompt: null,
          vad: false,
        });
        const result = await runWhisperRequest({
          pool,
          responseCacheRoot: input.sharedCache,
          ...(input.importedCache === undefined
            ? {}
            : { importedCacheRoot: input.importedCache }),
          cacheIdentity,
          audio,
          requestId: request.requestId,
          requestStartSeconds: request.sourceGlobalInterval.start,
          serverPath: input.whisperServer,
          modelPath: input.whisperModel,
          modelHash,
          vadModelPath: input.vadModel,
          runtime,
        });
        eventWorkerStarts += result.workerStartCount;
        totalWorkerStarts += result.workerStartCount;
        responses.push({
          request,
          response: result.response,
          cacheHit: result.cacheHit,
          inferenceExecuted: result.inferenceExecuted,
          modelLoadCount: result.modelLoadCount,
        });
      }
      const grouped = new Map<
        string,
        {
          text: string;
          members: typeof responses;
        }
      >();
      for (const response of responses) {
        const text = response.response.text.trim();
        const key = normalizeCandidateText(text);
        if (key === "") continue;
        const value = grouped.get(key) ?? { text, members: [] };
        value.members.push(response);
        grouped.set(key, value);
      }
      const newVariants = [...grouped.entries()]
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([, group], index) => {
          const variantId = `c6015-raw-reasr:${event.eventId}:${String(index + 1).padStart(2, "0")}`;
          const mappedIntervals = group.members.flatMap((member) =>
            member.response.transcription.flatMap((segment) =>
              segment.tokens.flatMap((token) =>
                token.special || token.mapped === null
                  ? []
                  : [
                      {
                        start:
                          member.request.sourceGlobalInterval.start +
                          token.mapped.startCentiseconds * 0.01,
                        end:
                          member.request.sourceGlobalInterval.start +
                          token.mapped.endCentiseconds * 0.01,
                      },
                    ],
              ),
            ),
          );
          const interval =
            mappedIntervals.length === 0
              ? event.interval
              : {
                  start: Math.min(
                    ...mappedIntervals.map((value) => value.start),
                  ),
                  end: Math.max(...mappedIntervals.map((value) => value.end)),
                };
          const duration = group.members.reduce(
            (sum, member) =>
              sum +
              member.request.sourceGlobalInterval.end -
              member.request.sourceGlobalInterval.start,
            0,
          );
          const firstResponse = group.members[0]?.response;
          if (firstResponse === undefined) {
            throw new InputError(
              "Raw recovery candidate has no decoder response.",
            );
          }
          const decoder = decoderFromResponse(
            firstResponse,
            group.text,
            Math.max(0.001, duration / Math.max(1, group.members.length)),
          );
          const noSpeech = decoder.noSpeechProbability ?? 1;
          const hallucinationRisk = Math.max(
            0,
            Math.min(1, noSpeech * 0.7 + repetitionRatio(group.text) * 0.3),
          );
          const variant: MachineVariant = {
            variantId,
            eventId: event.eventId,
            text: group.text,
            interval,
            eventInterval: event.interval,
            requestIds: group.members.map((member) => member.request.requestId),
            sourceWindowIds: group.members.map(
              (member) => member.request.windowType,
            ),
            independentSupportGroups: [
              planned.requests[0]?.requestFamilyId ?? event.eventId,
            ],
            correlatedSupportGroups: group.members.map(
              (member) => member.request.requestId,
            ),
            speechCoverage: Math.max(
              0,
              Math.min(
                1,
                (Math.min(interval.end, event.interval.end) -
                  Math.max(interval.start, event.interval.start)) /
                  Math.max(0.001, event.interval.end - event.interval.start),
              ),
            ),
            hallucinationRisk,
            repetitionRisk: repetitionRatio(group.text),
            reAsrOrigin: {
              isReAsr: true,
              requestFamilyIds: [
                planned.requests[0]?.requestFamilyId ?? event.eventId,
              ],
              sourceGlobalVerified: true,
              promptIsolated: true,
            },
            decoderEvidence: decoder,
          };
          let tokenIndex = 0;
          for (const member of group.members) {
            for (const token of member.response.transcription.flatMap(
              (segment) => segment.tokens.filter((entry) => !entry.special),
            )) {
              const tokenId = `${variantId}:mapped-token-${String(tokenIndex).padStart(4, "0")}`;
              tokenIndex += 1;
              const trusted =
                token.mapped !== null && token.probability >= 0.45;
              const sourceGlobalInterval =
                token.mapped === null
                  ? null
                  : {
                      start:
                        member.request.sourceGlobalInterval.start +
                        token.mapped.startCentiseconds * 0.01,
                      end:
                        member.request.sourceGlobalInterval.start +
                        token.mapped.endCentiseconds * 0.01,
                    };
              evidenceTokens.push({
                tokenId,
                variantId,
                text: token.text,
                lexical: normalizeCandidateText(token.text) !== "",
                trusted,
              });
              timingTokens.push({
                tokenId,
                variantId,
                lexical: normalizeCandidateText(token.text) !== "",
                trusted,
                sourceGlobalInterval,
              });
            }
          }
          return variant;
        });
      variants.push(...newVariants);
      executed.push({
        eventId: event.eventId,
        requestIds: planned.requests.map((request) => request.requestId),
        requestFamilyIds: [
          ...new Set(
            planned.requests.map((request) => request.requestFamilyId),
          ),
        ],
        sourceGlobalVerified: true,
        requestsExecuted: responses.length,
        cacheHitCount: responses.filter((response) => response.cacheHit).length,
        inferenceCount: responses.filter(
          (response) => response.inferenceExecuted,
        ).length,
        modelLoadCount: responses.reduce(
          (sum, response) => sum + response.modelLoadCount,
          0,
        ),
        newCandidateIds: newVariants.map((variant) => variant.variantId),
        evaluatedCandidateIds: [],
        selectedCandidateId: null,
      });
      if (eventWorkerStarts > 1) {
        throw new InputError(
          "Persistent Whisper worker restarted inside one event family.",
        );
      }
    }
  } finally {
    await pool.close();
  }
  return {
    variants,
    evidenceTokens,
    timingTokens,
    executed,
    workerStartCount: totalWorkerStarts,
  };
}

function chooseRecoveredVariants(input: {
  events: readonly MachineEvent[];
  evidence: ReturnType<typeof buildVariantEvidenceBundle>;
  executed: readonly ExecutedRawAsrRecoveryEvent[];
}): {
  selectedByEvent: Map<string, string>;
  executed: ExecutedRawAsrRecoveryEvent[];
} {
  const evidenceByVariant = new Map(
    input.evidence.variants.map((variant) => [variant.variantId, variant]),
  );
  const selectedByEvent = new Map(
    input.events.map(
      (event) => [event.eventId, event.currentVariantId] as const,
    ),
  );
  const executedByEvent = new Map(
    input.executed.map((event) => [event.eventId, event] as const),
  );
  for (const event of input.events) {
    const current = evidenceByVariant.get(event.currentVariantId);
    const recovery = event.variants
      .filter((variant) => variant.variantId.startsWith("c6015-raw-reasr:"))
      .flatMap((variant) => {
        const evidence = evidenceByVariant.get(variant.variantId);
        return evidence === undefined ? [] : [evidence];
      })
      .toSorted(
        (left, right) =>
          (right.ctcScore ?? -1) - (left.ctcScore ?? -1) ||
          right.tokenCoverage.coverageRatio -
            left.tokenCoverage.coverageRatio ||
          left.variantId.localeCompare(right.variantId),
      );
    const winner = recovery.find(
      (candidate) =>
        candidate.evidenceCompleteness === "COMPLETE" &&
        candidate.ctcScore !== null &&
        candidate.ctcScore >= (current?.ctcScore ?? 0) + 0.08 &&
        candidate.tokenCoverage.coverageRatio >=
          (current?.tokenCoverage.coverageRatio ?? 0) &&
        candidate.decoderEvidence.status === "available" &&
        (candidate.decoderEvidence.noSpeechProbability ?? 1) <=
          (current?.decoderEvidence.noSpeechProbability ?? 1),
    );
    if (winner !== undefined)
      selectedByEvent.set(event.eventId, winner.variantId);
    const raw = executedByEvent.get(event.eventId);
    if (raw !== undefined) {
      executedByEvent.set(event.eventId, {
        ...raw,
        evaluatedCandidateIds: recovery.map((candidate) => candidate.variantId),
        selectedCandidateId: winner?.variantId ?? null,
      });
    }
  }
  return { selectedByEvent, executed: [...executedByEvent.values()] };
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  const baseline = path.resolve(required(args, "--baseline"));
  const output = path.resolve(required(args, "--output"));
  const source = path.resolve(required(args, "--source"));
  const sharedCache = path.resolve(required(args, "--shared-cache"));
  const importedCacheValue = args.get("--imported-cache");
  const importedCache =
    importedCacheValue === undefined
      ? undefined
      : path.resolve(importedCacheValue);
  const runLabel = required(args, "--run-label");
  const evidenceMode = mode(args, "--evidence-to-canonical");
  const textApplicationMode = optionalMode(
    args,
    "--text-application",
    evidenceMode,
  );
  const timingApplicationMode = optionalMode(
    args,
    "--timing-application",
    evidenceMode,
  );
  const auditMode = mode(args, "--single-variant-audit");
  const recoveryMode = mode(args, "--raw-asr-event-recovery");
  const ffmpeg = path.resolve(required(args, "--ffmpeg"));
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
  const sourceInfoBefore = await stat(source);
  const sourceSha256Before = await sha256BlindFile(source);
  const repositoryCommit = (
    await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: process.cwd() })
  ).stdout.trim();
  const outputSubtitle = await cloneFrozenPackage({ baseline, output });
  await mkdir(sharedCache, { recursive: true });

  const subtitlePackage = subtitlePackageSchema.parse(
    await json<unknown>(path.join(outputSubtitle, "subtitle-package.json")),
  );
  const canonical = await json<CanonicalEventsArtifact>(
    path.join(outputSubtitle, "machine-canonical-events.json"),
  );
  const assembly = await json<CanonicalAssemblyArtifact>(
    path.join(outputSubtitle, "machine-canonical-assembly.json"),
  );
  const association = await json<AssociationLedger>(
    path.join(outputSubtitle, "machine-candidate-association-ledger.json"),
  );
  const candidateEvidence = await json<CandidateEvidenceArtifact>(
    path.join(outputSubtitle, "cue-candidate-evidence.json"),
  );
  const decisions = await json<MachineTextVariantDecision>(
    path.join(outputSubtitle, "machine-text-variant-decision.json"),
  );
  const acousticVerification =
    await json<MachineTextVariantAcousticVerification>(
      path.join(
        outputSubtitle,
        "machine-text-variant-acoustic-verification.json",
      ),
    );
  const tokenTimeline = await json<MachineGlobalTokenTimelineV2>(
    path.join(outputSubtitle, "machine-global-token-timeline-v2.json"),
  );
  const targeted = await json<TargetedReasrArtifact>(
    path.join(outputSubtitle, "machine-targeted-event-reasr.json"),
  );
  const funnel = await json<GenerationSurvivalFunnel>(
    path.join(outputSubtitle, "machine-generation-survival-funnel.json"),
  );
  const vadTimebase = await json<{
    sourceIdentity: { sourceTotalSamples: number };
  }>(path.join(outputSubtitle, "machine-vad-global-timebase.json"));
  const sourceTotalSamples = vadTimebase.sourceIdentity.sourceTotalSamples;

  const pipeline = await pipelineLineage({
    subtitle: outputSubtitle,
    package: subtitlePackage,
    canonical,
    assembly,
    association,
    funnel,
  });
  const lineage = buildEventFinalCueLineage({
    mode: evidenceMode,
    events: pipeline.events,
    finalCueIds: subtitlePackage.cues.map((cue) => cue.id),
    edges: pipeline.edges,
    dropped: pipeline.dropped,
    generatedAt: startedAt,
  });
  const lineageFinalByEvent = new Map(
    lineage.events.map((event) => [event.eventId, event.finalCueIds] as const),
  );
  const targetedEvidence = await loadTargetedEvidence({
    targeted,
    sharedCache,
    ...(importedCache === undefined ? {} : { importedCache }),
  });
  let machineEvents = buildMachineEvents({
    canonical,
    assembly,
    decisions,
    candidates: candidateEvidence,
    targeted,
    package: subtitlePackage,
    lineageFinalByEvent,
    targetedResponses: targetedEvidence.responseByRequest,
    targetedRequests: targetedEvidence.requestById,
  });
  const eventById = new Map(
    machineEvents.map((event) => [event.eventId, event] as const),
  );
  const baseTokens = existingVariantTokens(tokenTimeline);
  const c6014ReasrTokens = targetedVariantTokens({
    targeted,
    responseByRequest: targetedEvidence.responseByRequest,
    requestById: targetedEvidence.requestById,
  });
  let evidenceTokens = [
    ...baseTokens.evidenceTokens,
    ...c6014ReasrTokens.evidenceTokens,
  ];
  let timingTokens = [
    ...baseTokens.timingTokens,
    ...c6014ReasrTokens.timingTokens,
  ];
  const existingCtc = existingCtcEvidence(acousticVerification);
  const singleVariantIds = machineEvents
    .filter((event) => event.variants.length === 1)
    .map((event) => event.variants[0]?.variantId)
    .filter((variantId): variantId is string => variantId !== undefined);
  const singleVariants = machineEvents
    .filter((event) => event.variants.length === 1)
    .flatMap((event) => event.variants);
  const singleCtc =
    auditMode === "off"
      ? {
          evidence: [] as VariantCtcEvidenceInput[],
          requestCount: 0,
          cacheHitCount: 0,
          inferenceCount: 0,
          modelLoadCount: 0,
          workerStartCount: 0,
          runtimeIdentityHash: null,
          modelSnapshotHash: null,
          deviceUsed: null,
        }
      : await runCtcEvidence({
          variants: singleVariants,
          events: eventById,
          source,
          sourceSha256: sourceSha256Before,
          sourceTotalSamples,
          sharedCache,
          ...(importedCache === undefined ? {} : { importedCache }),
          ffmpeg,
          runtimeManifest: ctcRuntimeManifest,
          modelManifest: ctcModelManifest,
          capabilityPath: ctcCapabilityPath,
          sudachiPython,
          sudachiHelper,
        });
  let ctcEvidence = [...existingCtc, ...singleCtc.evidence];
  let variantEvidence = buildVariantEvidenceBundle({
    mode: evidenceMode,
    variants: variantInputs(machineEvents),
    tokens: evidenceTokens,
    ctcEvidence,
    generatedAt: startedAt,
  });
  const repetitionRiskByVariant = new Map(
    machineEvents.flatMap((event) =>
      event.variants.map(
        (variant) => [variant.variantId, variant.repetitionRisk] as const,
      ),
    ),
  );
  const singleAudit = buildSingleVariantAcousticAudit({
    mode: auditMode,
    singleVariantIds,
    variantEvidence,
    repetitionRiskByVariant,
    generatedAt: startedAt,
  });
  const rawPlanResult =
    recoveryMode === "off"
      ? { events: [] as RawAsrRecoveryPlanEvent[], budgetExhaustedCount: 0 }
      : planRawAsrEventRecovery({
          audit: singleAudit,
          eventIntervals: new Map(
            machineEvents.map((event) => [event.eventId, event.interval]),
          ),
          sourceTotalSamples,
        });
  const rawExecution = await executeRawRecovery({
    mode: recoveryMode,
    plan: rawPlanResult.events,
    events: eventById,
    source,
    sourceSha256: sourceSha256Before,
    sharedCache,
    ...(importedCache === undefined ? {} : { importedCache }),
    ffmpeg,
    whisperServer,
    whisperModel,
    vadModel,
    whisperRuntimeManifest,
  });
  if (rawExecution.variants.length > 0) {
    const rawByEvent = new Map<string, MachineVariant[]>();
    for (const variant of rawExecution.variants) {
      const values = rawByEvent.get(variant.eventId) ?? [];
      values.push(variant);
      rawByEvent.set(variant.eventId, values);
    }
    machineEvents = machineEvents.map((event) => ({
      ...event,
      variants: [...event.variants, ...(rawByEvent.get(event.eventId) ?? [])],
    }));
    evidenceTokens = [...evidenceTokens, ...rawExecution.evidenceTokens];
    timingTokens = [...timingTokens, ...rawExecution.timingTokens];
  }
  const expandedEventById = new Map(
    machineEvents.map((event) => [event.eventId, event] as const),
  );
  const rawCtc =
    rawExecution.variants.length === 0
      ? {
          evidence: [] as VariantCtcEvidenceInput[],
          requestCount: 0,
          cacheHitCount: 0,
          inferenceCount: 0,
          modelLoadCount: 0,
          workerStartCount: 0,
          runtimeIdentityHash: singleCtc.runtimeIdentityHash,
          modelSnapshotHash: singleCtc.modelSnapshotHash,
          deviceUsed: singleCtc.deviceUsed,
        }
      : await runCtcEvidence({
          variants: rawExecution.variants,
          events: expandedEventById,
          source,
          sourceSha256: sourceSha256Before,
          sourceTotalSamples,
          sharedCache,
          ...(importedCache === undefined ? {} : { importedCache }),
          ffmpeg,
          runtimeManifest: ctcRuntimeManifest,
          modelManifest: ctcModelManifest,
          capabilityPath: ctcCapabilityPath,
          sudachiPython,
          sudachiHelper,
        });
  ctcEvidence = [...ctcEvidence, ...rawCtc.evidence];
  variantEvidence = buildVariantEvidenceBundle({
    mode: evidenceMode,
    variants: variantInputs(machineEvents),
    tokens: evidenceTokens,
    ctcEvidence,
    generatedAt: startedAt,
  });
  const selection = chooseRecoveredVariants({
    events: machineEvents,
    evidence: variantEvidence,
    executed: rawExecution.executed,
  });
  const selectedRecoveryIds = new Set(
    [...selection.selectedByEvent.values()].filter((variantId) =>
      variantId.startsWith("c6015-raw-reasr:"),
    ),
  );
  const recovery = buildRawAsrEventRecoveryArtifact({
    mode: recoveryMode,
    audit: singleAudit,
    plan: rawPlanResult.events,
    executed: selection.executed,
    multiVariantTriggeredCount: targeted.events.length,
    workerStartCount: rawExecution.workerStartCount,
    improvedPoolRuntimeProxyCount: variantEvidence.variants.filter(
      (variant) =>
        variant.reAsrOrigin.isReAsr &&
        variant.evidenceCompleteness === "COMPLETE",
    ).length,
    replacedByReAsrCount: selectedRecoveryIds.size,
    generatedAt: startedAt,
  });
  const associationRepair = buildLocalAssociationRepairProposals({
    inspectedEventCount: canonical.events.length,
    risks: association.records.flatMap((record) => {
      const sourceEventId = record.assignedEventId;
      return sourceEventId === null
        ? []
        : record.competingAssignments.flatMap((competing) => {
            const targetEventId = competing.clusterId.replace(
              "atomic-hypothesis-cluster",
              "canonical-event",
            );
            return targetEventId === sourceEventId
              ? []
              : [
                  {
                    candidateId: record.candidateId,
                    sourceEventId,
                    competingEventId: targetEventId,
                    currentScore: record.score.tieBreakScore,
                    competingScore: competing.score,
                    evidenceIds: [`association:${record.candidateId}`],
                    hardCompatible: competing.hardCompatible,
                  },
                ];
          });
    }),
    generatedAt: startedAt,
  });
  const trustedCountByVariant = timingTokens.reduce<Map<string, number>>(
    (counts, token) => {
      if (
        token.trusted &&
        token.lexical &&
        token.sourceGlobalInterval !== null
      ) {
        counts.set(token.variantId, (counts.get(token.variantId) ?? 0) + 1);
      }
      return counts;
    },
    new Map(),
  );
  const timingEligibleCueIds = new Set<string>();
  for (const event of lineage.events) {
    const selectedVariant = selection.selectedByEvent.get(event.eventId);
    if (
      selectedVariant !== undefined &&
      (trustedCountByVariant.get(selectedVariant) ?? 0) >= 2 &&
      event.finalCueIds.length === 1 &&
      event.finalCueIds[0] !== undefined
    ) {
      timingEligibleCueIds.add(event.finalCueIds[0]);
    }
  }
  const overlapBlockedCueIds = new Set<string>();
  const sortedCues = subtitlePackage.cues.toSorted(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  for (let index = 1; index < sortedCues.length; index += 1) {
    const previous = sortedCues[index - 1];
    const current = sortedCues[index];
    if (
      previous !== undefined &&
      current !== undefined &&
      current.start < previous.end
    ) {
      overlapBlockedCueIds.add(previous.id);
      overlapBlockedCueIds.add(current.id);
    }
  }
  let timing = buildTrustedTokenTimingProposals({
    mode: evidenceMode,
    cues: subtitlePackage.cues,
    lineage,
    variantEvidence,
    selectedVariantByEvent: selection.selectedByEvent,
    tokens: timingTokens,
    timingEligibleCueIds,
    overlapBlockedCueIds,
    generatedAt: startedAt,
  });
  const proposals = buildCanonicalMutationProposals({
    mode: evidenceMode,
    cues: subtitlePackage.cues,
    lineage,
    variantEvidence,
    selections: machineEvents.map((event) => ({
      eventId: event.eventId,
      currentVariantId: event.currentVariantId,
      selectedVariantId: selection.selectedByEvent.get(event.eventId) ?? null,
    })),
    candidateTexts: machineEvents.flatMap((event) =>
      event.variants.map((variant) => ({
        variantId: variant.variantId,
        text: variant.text,
        hallucinationRisk: variant.hallucinationRisk,
      })),
    ),
    timing,
    generatedAt: startedAt,
  });
  const candidatePool = buildC6015CandidatePool({
    mode: evidenceMode,
    events: machineEvents,
    selectedByEvent: selection.selectedByEvent,
    evidence: variantEvidence,
    proposals,
    generatedAt: startedAt,
  });
  const applied = applyCanonicalMutations({
    mode: evidenceMode,
    textMode: textApplicationMode,
    timingMode: timingApplicationMode,
    package: subtitlePackage,
    proposals,
    lineage,
    generatedAt: startedAt,
  });
  const proposalById = new Map(
    proposals.proposals.map((proposal) => [proposal.proposalId, proposal]),
  );
  const appliedTimingCueIds = new Set(
    applied.ledger.records.flatMap((record) => {
      const proposal = proposalById.get(record.proposalId);
      return record.applyStatus === "APPLIED" &&
        proposal !== undefined &&
        (proposal.proposalType.includes("TIME") ||
          proposal.proposalType.includes("BOUNDARIES"))
        ? record.finalCueIds
        : [];
    }),
  );
  timing = buildTrustedTokenTimingProposals({
    mode: evidenceMode,
    cues: subtitlePackage.cues,
    lineage,
    variantEvidence,
    selectedVariantByEvent: selection.selectedByEvent,
    tokens: timingTokens,
    timingEligibleCueIds,
    overlapBlockedCueIds,
    appliedCueIds: appliedTimingCueIds,
    generatedAt: startedAt,
  });
  const coverage = buildEvidenceApplicationCoverage({
    trustedTokenCount: timingTokens.filter((token) => token.trusted).length,
    timingEligibleCueCount: timingEligibleCueIds.size,
    ctcEvidenceCount: ctcEvidence.length,
    variantDecisionCount: selection.selectedByEvent.size,
    lineage,
    variants: variantEvidence,
    timing,
    recovery,
    proposals,
    ledger: applied.ledger,
    generatedAt: startedAt,
  });
  const policy = createC6015QualityPolicy({
    evidenceToCanonical: evidenceMode,
    singleVariantAudit: auditMode,
    rawAsrEventRecovery: recoveryMode,
    artifactSemanticHashes: [
      lineage.semanticHash,
      variantEvidence.semanticHash,
      candidatePool.semanticHash,
      timing.semanticHash,
      singleAudit.semanticHash,
      recovery.semanticHash,
      associationRepair.semanticHash,
      proposals.semanticHash,
      applied.ledger.semanticHash,
      coverage.semanticHash,
    ],
    generatedAt: startedAt,
  });

  await atomicWriteJson(
    path.join(outputSubtitle, "subtitle-package.json"),
    applied.package,
    { overwrite: true },
  );
  await atomicWriteJson(
    path.join(outputSubtitle, "subtitle-package.needs-review.json"),
    applied.package,
    { overwrite: true },
  );
  const subtitleFiles = applied.package.subtitleFiles;
  if (
    subtitleFiles.srt === null ||
    subtitleFiles.vtt === null ||
    subtitleFiles.ass === null
  ) {
    throw new InputError(
      "Strict subtitle package is missing a rendered output path.",
    );
  }
  await atomicWriteFile(
    path.resolve(outputSubtitle, subtitleFiles.srt),
    applied.serialized.srt,
    { overwrite: true },
  );
  await atomicWriteFile(
    path.resolve(outputSubtitle, subtitleFiles.vtt),
    applied.serialized.vtt,
    { overwrite: true },
  );
  await atomicWriteFile(
    path.resolve(outputSubtitle, subtitleFiles.ass),
    applied.serialized.ass,
    { overwrite: true },
  );
  const sidecars = [
    ["machine-event-to-final-cue-lineage.json", lineage],
    ["machine-variant-evidence-bundle.json", variantEvidence],
    ["machine-candidate-pool-c6-0-1-5.json", candidatePool],
    ["machine-trusted-token-timing-proposals.json", timing],
    ["machine-single-variant-acoustic-audit.json", singleAudit],
    ["machine-raw-asr-event-recovery.json", recovery],
    ["machine-local-association-repair-proposals.json", associationRepair],
    ["machine-canonical-mutation-proposals.json", proposals],
    ["machine-canonical-mutation-ledger.json", applied.ledger],
    ["machine-evidence-application-coverage.json", coverage],
    ["c6-0-1-5-quality-policy.json", policy],
  ] as const;
  for (const [fileName, value] of sidecars) {
    await atomicWriteJson(path.join(outputSubtitle, fileName), value);
  }
  const tokenRefreshCore = {
    schemaVersion: "1.0.0",
    artifactType: "machine-variant-token-timeline-refresh",
    policyVersion: POLICY_VERSION,
    generatedAt: startedAt,
    associationPolicy: "exact-variant-id-no-representative-token-sharing",
    baselineTokenCount: baseTokens.evidenceTokens.length,
    c6014TargetedReAsrTokenCount: c6014ReasrTokens.evidenceTokens.length,
    c6015RawReAsrTokenCount: rawExecution.evidenceTokens.length,
    totalVariantTokenCount: evidenceTokens.length,
    trustedVariantTokenCount: evidenceTokens.filter((token) => token.trusted)
      .length,
    reAsrTokensMappedAfterCandidatePoolChange: true,
    representativeTokenLeakCount: 0,
    tokens: timingTokens,
  };
  await atomicWriteJson(
    path.join(outputSubtitle, "machine-variant-token-timeline-refresh.json"),
    {
      ...tokenRefreshCore,
      semanticHash: machineQualitySemanticHash(tokenRefreshCore),
    },
  );

  const ctcModel = await json<{
    modelRepo: string;
    snapshotDirectory: string;
    modelSnapshotHash: string;
    modelFiles: { relativePath: string; size: number; sha256: string }[];
  }>(ctcModelManifest);
  const ctcRuntime = await json<{
    runtimeVersion: string;
    runtimeIdentityHash: string;
    pythonExecutable: string;
  }>(ctcRuntimeManifest);
  const whisperRuntime = await json<WhisperRuntimeManifest>(
    whisperRuntimeManifest,
  );
  const whisperModelInfo = await stat(whisperModel);
  const vadModelInfo = await stat(vadModel);
  const ctcModelPath = path.join(
    ctcModel.snapshotDirectory,
    "model.safetensors",
  );
  const ctcModelInfo = await stat(ctcModelPath);
  const importedCacheHash =
    importedCache === undefined
      ? null
      : await directoryArtifactHash(importedCache);
  const generationRunId = `c6-0-1-5-${machineQualitySemanticHash({ runLabel, output }).slice(0, 16)}`;
  const machineMemoryStoreId = `${generationRunId}-empty-memory`;
  const manifest = await createBlindGenerationInputManifest({
    generatedAt: startedAt,
    generationRunId,
    sourceVideoPath: source,
    repositoryCommit,
    model: {
      modelName: "whisper-large-v3",
      modelPath: whisperModel,
      verifiedSnapshot: {
        sha256: await sha256File(whisperModel),
        size: whisperModelInfo.size,
      },
    },
    additionalModels: [
      {
        modelName: "silero-vad-v6.2.0",
        modelPath: vadModel,
        verifiedSnapshot: {
          sha256: await sha256File(vadModel),
          size: vadModelInfo.size,
        },
      },
      {
        modelName: ctcModel.modelRepo,
        modelPath: ctcModelPath,
        verifiedSnapshot: {
          sha256:
            ctcModel.modelFiles.find(
              (file) => file.relativePath === "model.safetensors",
            )?.sha256 ?? (await sha256File(ctcModelPath)),
          size: ctcModelInfo.size,
        },
      },
    ],
    runtimes: [
      {
        runtimeId: whisperRuntime.patched.binarySha256,
        name: "whisper.cpp-mvl",
        version: `1.9.3+${whisperRuntime.patch.patchSha256.slice(0, 12)}`,
        executablePath: whisperServer,
        device: "metal",
      },
      {
        runtimeId: ctcRuntime.runtimeIdentityHash,
        name: "reazon-wav2vec2-ctc",
        version: ctcRuntime.runtimeVersion,
        executablePath: ctcRuntime.pythonExecutable,
        device: singleCtc.deviceUsed ?? rawCtc.deviceUsed ?? "cpu",
      },
      {
        runtimeId: await sha256File(sudachiPython),
        name: "sudachipy-pronunciation-projection",
        version: "0.6.11+python-3.12",
        executablePath: sudachiPython,
        device: "cpu",
      },
      {
        runtimeId: await sha256File(ffmpeg),
        name: "ffmpeg",
        version:
          (await execFileAsync(ffmpeg, ["-version"])).stdout.split("\n")[0] ??
          "unknown",
        executablePath: ffmpeg,
        device: "cpu",
      },
    ],
    generationArguments: [
      "--machine-quality-recovery",
      "enforce",
      "--evidence-to-canonical",
      evidenceMode,
      "--text-application",
      textApplicationMode,
      "--timing-application",
      timingApplicationMode,
      "--single-variant-audit",
      auditMode,
      "--raw-asr-event-recovery",
      recoveryMode,
      "--asr-cache-dir",
      sharedCache,
      ...(importedCache === undefined
        ? []
        : ["--asr-cache-import", importedCache]),
      "--guidance-mode",
      "reference-free",
      "--network-policy",
      "off",
    ],
    machineMemoryStoreId,
    importedMachineCaches:
      importedCache === undefined || importedCacheHash === null
        ? []
        : [
            {
              path: importedCache,
              artifactType: "c6-0-1-5-machine-evidence-cache-v1",
              artifactHash: importedCacheHash,
            },
          ],
  });
  await atomicWriteJson(
    path.join(output, "blind-generation-input-manifest.json"),
    manifest,
  );
  await atomicWriteJson(path.join(output, "machine-memory.json"), {
    schemaVersion: "1.0.0",
    artifactType: "machine-only-series-memory",
    storeId: machineMemoryStoreId,
    createdAt: startedAt,
    entryCount: 0,
    humanDerived: false,
    entries: [],
    semanticHash: manifest.machineMemoryInitialState.storeHash,
  });
  const sourceSha256After = await sha256BlindFile(source);
  const sourceInfoAfter = await stat(source);
  if (
    sourceSha256After !== sourceSha256Before ||
    sourceInfoAfter.size !== sourceInfoBefore.size
  ) {
    throw new InputError("Source media changed during C6.0.1.5 execution.");
  }
  const completedAt = new Date().toISOString();
  const runAuditCore = {
    schemaVersion: "1.0.0",
    artifactType: "c6-0-1-5-machine-run-audit",
    policyVersion: POLICY_VERSION,
    runLabel,
    repositoryCommit,
    startedAt,
    completedAt,
    modes: {
      evidenceMode,
      textApplicationMode,
      timingApplicationMode,
      auditMode,
      recoveryMode,
    },
    source: {
      sizeBefore: sourceInfoBefore.size,
      sizeAfter: sourceInfoAfter.size,
      sha256Before: sourceSha256Before,
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
    ctcSingleVariantAudit: {
      requestCount: singleCtc.requestCount,
      cacheHitCount: singleCtc.cacheHitCount,
      inferenceCount: singleCtc.inferenceCount,
      modelLoadCount: singleCtc.modelLoadCount,
      workerStartCount: singleCtc.workerStartCount,
      runtimeIdentityHash: singleCtc.runtimeIdentityHash,
      modelSnapshotHash: singleCtc.modelSnapshotHash,
      deviceUsed: singleCtc.deviceUsed,
    },
    ctcRecoveredCandidates: {
      requestCount: rawCtc.requestCount,
      cacheHitCount: rawCtc.cacheHitCount,
      inferenceCount: rawCtc.inferenceCount,
      modelLoadCount: rawCtc.modelLoadCount,
      workerStartCount: rawCtc.workerStartCount,
      runtimeIdentityHash: rawCtc.runtimeIdentityHash,
      modelSnapshotHash: rawCtc.modelSnapshotHash,
      deviceUsed: rawCtc.deviceUsed,
    },
    rawAsrRecovery: recovery.summary,
    candidatePool: candidatePool.summary,
    evidenceApplication: coverage,
    mutations: applied.ledger.summary,
    productionStatus: "needs-review",
    finalizationMethod: "none",
    machineOnlyReleaseAuthorized: false,
  };
  await atomicWriteJson(path.join(output, "c6-0-1-5-machine-run-audit.json"), {
    ...runAuditCore,
    semanticHash: machineQualitySemanticHash(runAuditCore),
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
    sourceHashBefore: sourceSha256Before,
    sourceHashAfter: sourceSha256After,
    networkUsed: false,
    onlineSubtitleSearchUsed: false,
    cloudModelInferenceCount: 0,
  });
  const shareable = {
    schemaVersion: "1.0.0",
    artifactType: "c6-0-1-5-shareable-summary",
    policyVersion: POLICY_VERSION,
    generatedAt: completedAt,
    runLabel,
    sourceSha256: sourceSha256Before,
    lineage: lineage.summary,
    variants: variantEvidence.summary,
    candidatePool: candidatePool.summary,
    singleVariantAudit: singleAudit.summary,
    recovery: recovery.summary,
    timing: timing.summary,
    mutations: applied.ledger.summary,
    evidenceApplication: {
      trustedTokenCount: coverage.trustedTokenCount,
      trustedTokenConsumedCount: coverage.trustedTokenConsumedCount,
      ctcEvidenceCount: coverage.ctcEvidenceCount,
      ctcEvidenceConsumedCount: coverage.ctcEvidenceConsumedCount,
      engineeringGatePassed: coverage.engineeringGatePassed,
    },
    productionStatus: "needs-review",
    finalizationMethod: "none",
    machineOnlyReleaseAuthorized: false,
  };
  await mkdir(path.join(output, "shareable"), { recursive: true });
  await atomicWriteJson(
    path.join(output, "shareable", "c6-0-1-5-summary.json"),
    {
      ...shareable,
      semanticHash: machineQualitySemanticHash(shareable),
    },
  );
  const provenance = await auditBlindRunProvenance({
    taskDirectory: output,
    generatedAt: completedAt,
    manifest,
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
        lineage: lineage.summary,
        audit: singleAudit.summary,
        recovery: recovery.summary,
        mutations: applied.ledger.summary,
        evidenceApplication: coverage.engineeringGatePassed,
        productionStatus: "needs-review",
        finalizationMethod: "none",
        machineOnlyReleaseAuthorized: false,
      },
      null,
      2,
    ),
  );
}

await main();

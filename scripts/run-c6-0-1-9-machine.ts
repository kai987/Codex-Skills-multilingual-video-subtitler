import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { access, cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  c6019PolicyVersion,
  c6019QualityPolicySchema,
  machineIndependentAsrRuntimeSchema,
} from "@mvl/shared";
import {
  buildMachineCrossModelComparison,
  buildMachineIndependentAsrCandidates,
  buildMachineSecondAsrDiagnosticSet,
  buildMachineSecondAsrStability,
  genericHallucinationRisk,
  independentAsrCacheKey,
  loadReazonK2ModelIdentity,
  machineQualitySemanticHash,
  normalizeIndependentAsrDisplay,
  normalizeIndependentAsrLexical,
  normalizeJapanesePronunciation,
  projectJapanesePronunciationBatch,
  ReazonSpeechK2Provider,
  runSudachiMorphemeAnalysis,
  type IndependentAsrFrozenRecord,
  type IndependentAsrProviderRequest,
  type WhisperComparisonCandidate,
} from "@mvl/video-subtitler";

const SAMPLE_RATE = 16_000 as const;
const SOURCE_SHA256 =
  "294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43";
const MAX_RAW_SECONDS = 28.2;

interface Arguments {
  baseline: string;
  source: string;
  outputRoot: string;
  modelDirectory: string;
  pythonExecutable: string;
  sudachiPython: string;
  sudachiHelper: string;
  cacheFile: string;
  audioDirectory: string;
  generatedAt: string;
}

interface CoreSpanArtifact {
  semanticHash: string;
  events: {
    eventId: string;
    proposedCoreStart: number;
    proposedCoreEnd: number;
    coreSpanStatus: "VERIFIED" | "VERIFIED_WITH_CAUTION" | "AMBIGUOUS";
    evidenceIds: string[];
    semanticHash: string;
  }[];
}

interface RiskArtifact {
  events: {
    eventId: string;
    candidateId: string;
    positiveErrorEvidenceCount: number;
    strongPositiveErrorEvidenceCount: number;
    evidenceAbsenceCount: number;
    correctnessEvidenceCount: number;
    conflictingEvidence: boolean;
    absenceOnly: boolean;
    recommendedAction: string;
    budgetSelected: boolean;
    stableTieBreakHash: string;
    semanticHash: string;
  }[];
}

interface CanonicalArtifact {
  events: {
    eventId: string;
    acousticInterval: { start: number; end: number };
    eventType: string;
    representativeCandidateId: string;
    semanticHash: string;
  }[];
}

interface PoolArtifact {
  candidates: {
    eventId: string;
    candidateId: string;
    text: string;
    sourceGlobalVerified: boolean;
    semanticHash: string;
  }[];
}

interface DecoderArtifact {
  candidates: {
    eventId: string;
    candidateId: string;
    availability: string;
    semanticHash: string;
  }[];
}

interface ProjectionArtifact {
  candidates: {
    eventId: string;
    candidateId: string;
    coreProjectedText: string;
    projectionStatus: string;
    semanticHash: string;
  }[];
}

function parseArguments(values: string[]): Arguments {
  const value = (name: string): string => {
    const index = values.indexOf(name);
    const result = index >= 0 ? values[index + 1] : undefined;
    if (result === undefined || result.startsWith("--")) {
      throw new Error(`Missing required argument ${name}.`);
    }
    return path.resolve(result);
  };
  const generatedIndex = values.indexOf("--generated-at");
  const generatedAt =
    generatedIndex >= 0 ? values[generatedIndex + 1] : undefined;
  if (generatedAt === undefined || Number.isNaN(Date.parse(generatedAt))) {
    throw new Error("Missing valid --generated-at ISO timestamp.");
  }
  return {
    baseline: value("--baseline"),
    source: value("--source"),
    outputRoot: value("--output-root"),
    modelDirectory: value("--model-directory"),
    pythonExecutable: value("--python"),
    sudachiPython: value("--sudachi-python"),
    sudachiHelper: value("--sudachi-helper"),
    cacheFile: value("--cache-file"),
    audioDirectory: value("--audio-directory"),
    generatedAt,
  };
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function sha256File(file: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolve(hash.digest("hex")));
  });
}

async function locateSubtitleDirectory(root: string): Promise<string> {
  const entries = await (
    await import("node:fs/promises")
  ).readdir(root, {
    withFileTypes: true,
  });
  const matches = entries.filter(
    (entry) => entry.isDirectory() && entry.name.startsWith("subtitle-"),
  );
  if (matches.length !== 1)
    throw new Error(`Expected one subtitle directory under ${root}.`);
  return path.join(root, matches[0]?.name ?? "");
}

async function runProcess(
  executable: string,
  argumentsList: string[],
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, argumentsList, {
      shell: false,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-4_000);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `${path.basename(executable)} exited ${String(code)}: ${stderr}`,
          ),
        );
    });
  });
}

function contextInterval(
  core: { start: number; end: number },
  sourceDuration: number,
): { start: number; end: number } {
  const coreDuration = core.end - core.start;
  if (coreDuration > MAX_RAW_SECONDS)
    throw new Error("Core exceeds Reazon padded duration limit.");
  let start = Math.max(0, core.start - 1.5);
  let end = Math.min(sourceDuration, core.end + 1.5);
  const excess = end - start - MAX_RAW_SECONDS;
  if (excess > 0) {
    const leftContext = core.start - start;
    const removeLeft = Math.min(leftContext, excess / 2);
    start += removeLeft;
    end -= excess - removeLeft;
  }
  return { start, end };
}

async function wavSampleCount(file: string): Promise<number> {
  const buffer = await readFile(file);
  if (
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error("Extracted audio is not a RIFF/WAVE file.");
  }
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (type === "data") return Math.floor(size / 2);
    offset += 8 + size + (size % 2);
  }
  throw new Error("Extracted WAV data chunk is missing.");
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].toSorted((left, right) => left - right);
  return (
    sorted[
      Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))
    ] ?? 0
  );
}

async function snapshot(
  baseline: string,
  destination: string,
  artifacts: Readonly<Record<string, unknown>>,
): Promise<void> {
  try {
    await access(destination);
    throw new Error(`Refusing to overwrite existing output ${destination}.`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Refusing"))
      throw error;
  }
  await cp(baseline, destination, {
    recursive: true,
    preserveTimestamps: true,
  });
  const subtitle = await locateSubtitleDirectory(destination);
  await Promise.all(
    Object.entries(artifacts).map(async ([fileName, artifact]) => {
      await writeJson(path.join(subtitle, fileName), artifact);
    }),
  );
}

const argumentsValue = parseArguments(process.argv.slice(2));
const sourceHash = await sha256File(argumentsValue.source);
if (sourceHash !== SOURCE_SHA256)
  throw new Error("Source media identity mismatch.");
const baselineSubtitle = await locateSubtitleDirectory(argumentsValue.baseline);
const sourceInfo = await readJson<{ format: { durationSeconds: number } }>(
  path.join(baselineSubtitle, "source-info.json"),
);
const coreSpan = await readJson<CoreSpanArtifact>(
  path.join(baselineSubtitle, "machine-core-acoustic-span.json"),
);
const risk = await readJson<RiskArtifact>(
  path.join(baselineSubtitle, "machine-reasr-risk-v2.json"),
);
const canonical = await readJson<CanonicalArtifact>(
  path.join(baselineSubtitle, "machine-canonical-events.json"),
);
const pool = await readJson<PoolArtifact>(
  path.join(baselineSubtitle, "machine-candidate-pool-c6-0-1-5.json"),
);
const decoder = await readJson<DecoderArtifact>(
  path.join(baselineSubtitle, "machine-decoder-evidence.json"),
);
const projection = await readJson<ProjectionArtifact>(
  path.join(baselineSubtitle, "machine-core-text-projection.json"),
);

const diagnosticSet = buildMachineSecondAsrDiagnosticSet({
  generatedAt: argumentsValue.generatedAt,
  sourceMediaSha256: sourceHash,
  upstreamTargetSemanticHash: coreSpan.semanticHash,
  targetEvents: coreSpan.events,
  riskEvents: risk.events,
  canonicalEvents: canonical.events,
  poolCandidates: pool.candidates,
  decoderCandidates: decoder.candidates,
});

const outputNames = {
  diagnostic: "carnation-c6-0-1-9-diagnostic-set-20260829",
  runtime: "carnation-c6-0-1-9-second-asr-runtime-20260829",
  exact: "carnation-c6-0-1-9-reazon-core-exact-20260829",
  context: "carnation-c6-0-1-9-reazon-context-20260829",
  comparison: "carnation-c6-0-1-9-cross-model-comparison-20260829",
} as const;
await mkdir(argumentsValue.outputRoot, { recursive: true });
await snapshot(
  argumentsValue.baseline,
  path.join(argumentsValue.outputRoot, outputNames.diagnostic),
  { "machine-second-asr-diagnostic-set.json": diagnosticSet },
);

await mkdir(argumentsValue.audioDirectory, { recursive: true });
const modelIdentity = await loadReazonK2ModelIdentity(
  argumentsValue.modelDirectory,
);
const modelIdentityHash = machineQualitySemanticHash(modelIdentity);
const extractionConfigHash = machineQualitySemanticHash({
  ffmpeg: "local-ffmpeg",
  audioStream: "0:a:0",
  sampleRate: SAMPLE_RATE,
  channels: 1,
  codec: "pcm_s16le",
  seekMode: "accurate-output-seek",
});
const requests: IndependentAsrProviderRequest[] = [];
for (const event of diagnosticSet.events) {
  for (const windowType of ["CORE_EXACT", "CORE_CONTEXT"] as const) {
    const sourceInterval =
      windowType === "CORE_EXACT"
        ? event.coreInterval
        : contextInterval(
            event.coreInterval,
            sourceInfo.format.durationSeconds,
          );
    const requestId = `c6019:${event.eventId}:${windowType}`;
    const audioPath = path.join(
      argumentsValue.audioDirectory,
      `${requestId.replace(/:/gu, "-")}.wav`,
    );
    await runProcess("/opt/homebrew/bin/ffmpeg", [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      sourceInterval.start.toFixed(6),
      "-t",
      (sourceInterval.end - sourceInterval.start).toFixed(6),
      "-i",
      argumentsValue.source,
      "-map",
      "0:a:0",
      "-ac",
      "1",
      "-ar",
      String(SAMPLE_RATE),
      "-c:a",
      "pcm_s16le",
      "-y",
      audioPath,
    ]);
    const sampleCount = await wavSampleCount(audioPath);
    const audioSha256 = await sha256File(audioPath);
    requests.push({
      requestId,
      eventId: event.eventId,
      diagnosticRole: event.role,
      windowType,
      sourceInterval,
      sourceMediaSha256: sourceHash,
      audioPath,
      audioSha256,
      sampleRate: SAMPLE_RATE,
      sampleCount,
      extractionConfigHash,
    });
  }
}
if (requests.length !== 48)
  throw new Error(`Expected 48 requests; got ${requests.length}.`);

const provider = new ReazonSpeechK2Provider({
  pythonExecutable: argumentsValue.pythonExecutable,
  workerScriptPath: path.resolve("scripts/runtime/reazonspeech_k2_worker.py"),
  modelDirectory: argumentsValue.modelDirectory,
});
let providerRun: Awaited<ReturnType<ReazonSpeechK2Provider["transcribeBatch"]>>;
try {
  providerRun = await provider.transcribeBatch(requests);
} finally {
  await provider.close();
}
const resultById = new Map(
  providerRun.results.map((result) => [result.requestId, result]),
);
const modelFileHashes = Object.fromEntries(
  modelIdentity.modelFiles.map((file) => [file.fileName, file.sha256]),
);
const records: IndependentAsrFrozenRecord[] = requests.map((request) => {
  const result = resultById.get(request.requestId);
  if (result === undefined)
    throw new Error(`Missing provider result ${request.requestId}.`);
  const cacheKey = independentAsrCacheKey({
    providerId: "reazonspeech-k2-v2",
    modelRevision: modelIdentity.modelRevision,
    modelFileHashes,
    precision: "fp32",
    audioSha256: request.audioSha256,
    sourceInterval: request.sourceInterval,
    decodingConfig: {
      method: "greedy_search",
      threads: 1,
      sampleRate: SAMPLE_RATE,
      padSeconds: 0.9,
    },
    normalizationConfig: { version: "c6019-independent-asr-text-v1" },
  });
  return { request, result, cacheKey };
});

const whisperDrafts: {
  eventId: string;
  candidateId: string;
  text: string;
  duration: number;
}[] = [];
for (const event of diagnosticSet.events) {
  if (event.role === "TARGET") {
    const seen = new Set<string>();
    for (const candidate of projection.candidates) {
      if (
        candidate.eventId !== event.eventId ||
        candidate.coreProjectedText.trim() === ""
      ) {
        continue;
      }
      const normalized = normalizeIndependentAsrLexical(
        candidate.coreProjectedText,
      );
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      whisperDrafts.push({
        eventId: event.eventId,
        candidateId: candidate.candidateId,
        text: candidate.coreProjectedText,
        duration: event.coreInterval.end - event.coreInterval.start,
      });
    }
  } else {
    const riskEvent = risk.events.find(
      (candidate) => candidate.eventId === event.eventId,
    );
    const candidate = pool.candidates.find(
      (poolCandidate) =>
        poolCandidate.eventId === event.eventId &&
        poolCandidate.candidateId === riskEvent?.candidateId,
    );
    if (candidate !== undefined) {
      whisperDrafts.push({
        eventId: event.eventId,
        candidateId: candidate.candidateId,
        text: candidate.text,
        duration: event.coreInterval.end - event.coreInterval.start,
      });
    }
  }
}

const sudachiItems = [
  ...records.map((record) => ({
    id: record.request.requestId,
    text: record.result.text,
  })),
  ...whisperDrafts.map((draft) => ({
    id: `whisper:${machineQualitySemanticHash({ eventId: draft.eventId, candidateId: draft.candidateId })}`,
    text: draft.text,
  })),
];
const sudachi = await runSudachiMorphemeAnalysis({
  pythonExecutable: argumentsValue.sudachiPython,
  helperPath: argumentsValue.sudachiHelper,
  items: sudachiItems,
  timeoutMs: 120_000,
});
const requestReadings = new Map(
  records.map((record) => [
    record.request.requestId,
    sudachi.readingsById.get(record.request.requestId) ??
      normalizeJapanesePronunciation(record.result.text),
  ]),
);
const candidates = buildMachineIndependentAsrCandidates({
  generatedAt: argumentsValue.generatedAt,
  executionKind: "OFFICIAL_FRESH_INFERENCE",
  diagnosticSet,
  modelIdentityHash,
  records,
  pronunciationByRequestId: requestReadings,
});
const stability = buildMachineSecondAsrStability({
  generatedAt: argumentsValue.generatedAt,
  candidates,
});
const whisperCandidates: WhisperComparisonCandidate[] = whisperDrafts.map(
  (draft) => {
    const readingId = `whisper:${machineQualitySemanticHash({
      eventId: draft.eventId,
      candidateId: draft.candidateId,
    })}`;
    const displayText = normalizeIndependentAsrDisplay(draft.text);
    return {
      eventId: draft.eventId,
      candidateId: draft.candidateId,
      displayText,
      normalizedDisplayText: normalizeIndependentAsrLexical(displayText),
      pronunciationText:
        sudachi.readingsById.get(readingId) ??
        normalizeJapanesePronunciation(displayText),
      hallucinationRisk: genericHallucinationRisk({
        text: displayText,
        durationSeconds: draft.duration,
      }),
    };
  },
);
const comparison = buildMachineCrossModelComparison({
  generatedAt: argumentsValue.generatedAt,
  diagnosticSet,
  independentCandidates: candidates,
  whisperCandidates,
});

const adapterSourceSha256 = await sha256File(
  path.resolve("scripts/runtime/reazonspeech_k2_worker.py"),
);
const runtimeId = provider.runtimeIdentity({
  modelIdentity,
  adapterSourceSha256,
  pythonVersion: providerRun.diagnostics.pythonVersion,
  sherpaOnnxVersion: providerRun.diagnostics.sherpaOnnxVersion,
});
const requestSeconds = providerRun.results.map(
  (result) => result.wallClockSeconds,
);
const totalInferenceSeconds = requestSeconds.reduce(
  (sum, value) => sum + value,
  0,
);
const totalAudioSeconds = requests.reduce(
  (sum, request) => sum + request.sampleCount / request.sampleRate,
  0,
);
const runtimeCore = {
  schemaVersion: "1.0.0" as const,
  policyVersion: c6019PolicyVersion,
  generatedAt: argumentsValue.generatedAt,
  artifactType: "machine-independent-asr-runtime" as const,
  executionKind: "OFFICIAL_FRESH_INFERENCE" as const,
  provider: {
    providerId: "reazonspeech-k2-v2" as const,
    adapterType: "DIRECT_SHERPA_ONNX_OFFICIAL_REAZON_FP32" as const,
    adapterReason:
      "The official Reazon package resolves an unpinned snapshot at runtime; the direct official sherpa-onnx adapter freezes the exact local revision and all four FP32 files.",
    providerInterfaceVersion: "independent-asr-provider-v1" as const,
  },
  modelIdentity,
  runtimeIdentity: {
    runtimeId,
    os: `${os.platform()} ${os.release()}`,
    arch: os.arch(),
    cpu: os.cpus()[0]?.model ?? "unknown",
    pythonVersion: providerRun.diagnostics.pythonVersion,
    sherpaOnnxVersion: providerRun.diagnostics.sherpaOnnxVersion,
    adapterSourceSha256,
    threadCount: 1,
  },
  decoding: {
    method: "greedy_search" as const,
    sampleRate: SAMPLE_RATE,
    featureDim: 80 as const,
    maxAudioSeconds: 30 as const,
    padSeconds: 0.9 as const,
    hotwordsEnabled: false as const,
    contextualBiasingEnabled: false as const,
    externalLanguageModelEnabled: false as const,
  },
  bootstrap: {
    performed: true,
    networkUsedDuringBootstrap: true,
    modelCompleteBeforeAcceptance: true,
    runtimeCompleteBeforeAcceptance: true,
    hashesFrozenBeforeAcceptance: true,
  },
  acceptance: {
    networkUsed: false as const,
    remoteApiUsed: false as const,
    runtimeGoldInputCount: 0 as const,
    localOnlyVerified: true as const,
  },
  counts: {
    requestCount: requests.length,
    successfulRequestCount: providerRun.results.filter(
      (result) => result.status === "SUCCESS",
    ).length,
    failedRequestCount: providerRun.results.filter(
      (result) => !["SUCCESS", "EMPTY_OUTPUT"].includes(result.status),
    ).length,
    emptyOutputCount: providerRun.results.filter(
      (result) => result.status === "EMPTY_OUTPUT",
    ).length,
    cacheHitCount: 0,
    inferenceCount: providerRun.results.length,
    modelLoadCount: providerRun.diagnostics.modelLoadCount,
    processStartCount: providerRun.diagnostics.processStartCount,
  },
  performance: {
    modelLoadSeconds: providerRun.diagnostics.modelLoadSeconds,
    totalInferenceSeconds,
    meanRequestSeconds:
      totalInferenceSeconds / Math.max(1, requestSeconds.length),
    p50RequestSeconds: percentile(requestSeconds, 0.5),
    p95RequestSeconds: percentile(requestSeconds, 0.95),
    realTimeFactor: totalInferenceSeconds / Math.max(0.001, totalAudioSeconds),
    peakRssBytes: providerRun.diagnostics.peakRssBytes,
  },
};
const runtime = machineIndependentAsrRuntimeSchema.parse({
  ...runtimeCore,
  semanticHash: machineQualitySemanticHash(runtimeCore),
});
const qualityCore = {
  schemaVersion: "1.0.0" as const,
  policyVersion: c6019PolicyVersion,
  generatedAt: argumentsValue.generatedAt,
  artifactType: "c6-0-1-9-quality-policy" as const,
  modes: {
    independentAsr: "observe" as const,
    crossModelComparison: "observe" as const,
    ctcArbitration: "observe" as const,
  },
  goldIsolation: {
    runtimeGoldInputAllowed: false as const,
    diagnosticSetFrozenBeforeGold: true as const,
    machineArtifactsFrozenBeforeGold: true as const,
  },
  frozenRules: {
    whisperRulesChanged: false as const,
    timingRulesChanged: false as const,
    overlapRulesChanged: false as const,
    canonicalMutationAllowed: false as const,
    hotwordsAllowed: false as const,
    humanMemoryAllowed: false as const,
  },
  productionStatus: "needs-review" as const,
  finalizationMethod: "none" as const,
  machineReleaseAuthorized: false as const,
};
const qualityPolicy = c6019QualityPolicySchema.parse({
  ...qualityCore,
  semanticHash: machineQualitySemanticHash(qualityCore),
});
const freezeCore = {
  schemaVersion: "1.0.0",
  policyVersion: c6019PolicyVersion,
  generatedAt: argumentsValue.generatedAt,
  artifactType: "c6-0-1-9-machine-freeze",
  runtimeGoldInputCount: 0,
  frozenBeforeGold: true,
  artifactSemanticHashes: {
    diagnosticSet: diagnosticSet.semanticHash,
    runtime: runtime.semanticHash,
    independentCandidates: candidates.semanticHash,
    stability: stability.semanticHash,
    comparison: comparison.semanticHash,
    qualityPolicy: qualityPolicy.semanticHash,
  },
};
const machineFreeze = {
  ...freezeCore,
  machineFreezeHash: machineQualitySemanticHash({
    ...freezeCore,
    generatedAt: undefined,
  }),
};
const frozenCache = {
  schemaVersion: "1.0.0",
  policyVersion: c6019PolicyVersion,
  artifactType: "c6-0-1-9-frozen-exact-result-cache",
  generatedAt: argumentsValue.generatedAt,
  diagnosticSet,
  modelIdentity,
  modelIdentityHash,
  runtime,
  records: records.map(({ request, result, cacheKey }) => ({
    request: { ...request, audioPath: "FROZEN_AUDIO_NOT_REOPENED" },
    result,
    cacheKey,
  })),
  pronunciationByRequestId: Object.fromEntries(requestReadings),
  whisperCandidates,
  candidates,
  stability,
  comparison,
  qualityPolicy,
  machineFreeze,
};
await mkdir(path.dirname(argumentsValue.cacheFile), { recursive: true });
await writeJson(argumentsValue.cacheFile, frozenCache);

const commonArtifacts = {
  "machine-second-asr-diagnostic-set.json": diagnosticSet,
  "machine-independent-asr-runtime.json": runtime,
  "machine-independent-asr-candidates.json": candidates,
  "machine-second-asr-stability.json": stability,
  "machine-cross-model-comparison.json": comparison,
  "c6-0-1-9-quality-policy.json": qualityPolicy,
  "c6-0-1-9-machine-freeze.json": machineFreeze,
};
const exactSummary = {
  artifactType: "machine-reazon-core-exact-summary",
  schemaVersion: "1.0.0",
  policyVersion: c6019PolicyVersion,
  generatedAt: argumentsValue.generatedAt,
  requestCount: candidates.candidates.filter(
    (candidate) => candidate.windowType === "CORE_EXACT",
  ).length,
  candidateSemanticHashes: candidates.candidates
    .filter((candidate) => candidate.windowType === "CORE_EXACT")
    .map((candidate) => candidate.semanticHash),
  runtimeGoldInputCount: 0,
};
const contextSummary = {
  artifactType: "machine-reazon-context-summary",
  schemaVersion: "1.0.0",
  policyVersion: c6019PolicyVersion,
  generatedAt: argumentsValue.generatedAt,
  diagnosticOnly: true,
  requestCount: candidates.candidates.filter(
    (candidate) => candidate.windowType === "CORE_CONTEXT",
  ).length,
  candidateSemanticHashes: candidates.candidates
    .filter((candidate) => candidate.windowType === "CORE_CONTEXT")
    .map((candidate) => candidate.semanticHash),
  runtimeGoldInputCount: 0,
};
await snapshot(
  argumentsValue.baseline,
  path.join(argumentsValue.outputRoot, outputNames.runtime),
  commonArtifacts,
);
await snapshot(
  argumentsValue.baseline,
  path.join(argumentsValue.outputRoot, outputNames.exact),
  {
    ...commonArtifacts,
    "machine-reazon-core-exact-summary.json": exactSummary,
  },
);
await snapshot(
  argumentsValue.baseline,
  path.join(argumentsValue.outputRoot, outputNames.context),
  { ...commonArtifacts, "machine-reazon-context-summary.json": contextSummary },
);
await snapshot(
  argumentsValue.baseline,
  path.join(argumentsValue.outputRoot, outputNames.comparison),
  commonArtifacts,
);

process.stdout.write(
  `${JSON.stringify(
    {
      outputNames,
      diagnosticSet: {
        targetEventIds: diagnosticSet.targetEventIds,
        controlEventIds: diagnosticSet.controlEventIds,
        semanticHash: diagnosticSet.semanticHash,
      },
      runtime: {
        modelSnapshotHash: modelIdentity.modelSnapshotHash,
        runtimeId,
        counts: runtime.counts,
        performance: runtime.performance,
      },
      candidates: candidates.summary,
      stability: stability.summary,
      comparison: comparison.summary,
      machineFreezeHash: machineFreeze.machineFreezeHash,
      cacheFile: argumentsValue.cacheFile,
    },
    null,
    2,
  )}\n`,
);

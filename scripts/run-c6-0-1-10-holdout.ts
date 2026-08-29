import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import {
  access,
  cp,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  c60110HoldoutArbitrationSchema,
  c60110HoldoutReazonRuntimeSchema,
  subtitlePackageSchema,
  type C60110Dev24Evaluation,
  type C60110HoldoutReazonRuntime,
  type C60110PolicyFreeze,
  type C60110PolicyProfiles,
  type MachineCrossModelArbitrationEvidence,
  type MachineCrossModelArbitrationLedger,
  type SubtitlePackage,
} from "@mvl/shared";
import { parseAss } from "@mvl/subtitle-core";
import {
  applyCrossModelTextMutationProposals,
  arbitrateCrossModelCandidate,
  buildC60110HoldoutSelection,
  buildC60110OracleCaptureEvaluation,
  buildCrossModelTextMutationProposals,
  buildMachineCrossModelArbitrationEvidence,
  buildMachineCrossModelArbitrationLedger,
  genericHallucinationRisk,
  independentAsrCacheKey,
  independentAsrLexicalEditDistance,
  loadAndVerifyCtcRuntime,
  loadReazonK2ModelIdentity,
  LocalCtcWorker,
  machineQualitySemanticHash,
  normalizeC601GoldAssTimestamps,
  normalizeIndependentAsrDisplay,
  normalizeIndependentAsrLexical,
  normalizeJapanesePronunciation,
  normalizedEditSimilarity,
  ReazonSpeechK2Provider,
  runSudachiMorphemeAnalysis,
  type C60110CandidateInput,
  type C60110EvidenceEventInput,
  type C60110MachineEvidenceInput,
  type IndependentAsrProviderRequest,
  type IndependentAsrProviderResult,
} from "@mvl/video-subtitler";

const SAMPLE_RATE = 16_000 as const;
const SOURCE_SHA256 =
  "294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43";
const GOLD_SHA256 =
  "a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e";
const MAX_RAW_SECONDS = 28.2;

interface Arguments {
  baseline: string;
  devState: string;
  source: string;
  gold: string;
  outputRoot: string;
  modelDirectory: string;
  pythonExecutable: string;
  sudachiPython: string;
  sudachiHelper: string;
  ctcRuntimeManifest: string;
  ctcModelManifest: string;
  cacheFile: string;
  audioDirectory: string;
  generatedAt: string;
}

interface DevState {
  inputFreeze: { eventIds: string[]; semanticHash: string };
  profiles: C60110PolicyProfiles;
  evidence: MachineCrossModelArbitrationEvidence;
  ledgers: MachineCrossModelArbitrationLedger[];
  dev24Evaluation: C60110Dev24Evaluation;
  policyFreeze: C60110PolicyFreeze;
  qualityPolicy: unknown;
  controlEvaluation: {
    avoidedBlindRegressionCount: number;
    semanticHash: string;
  };
}

interface CanonicalArtifact {
  semanticHash: string;
  events: {
    eventId: string;
    acousticInterval: { start: number; end: number };
    eventType: string;
    representativeCandidateId: string;
    semanticHash: string;
  }[];
}

interface CandidatePoolArtifact {
  semanticHash: string;
  events: {
    eventId: string;
    currentVariantId: string;
    selectedVariantId: string;
  }[];
  candidates: {
    eventId: string;
    candidateId: string;
    text: string;
    evidenceCompleteness: string;
    sourceGlobalVerified: boolean;
    semanticHash: string;
  }[];
}

interface CueLineageArtifact {
  semanticHash: string;
  events: {
    eventId: string;
    finalCueIds: string[];
    lineageStatus: string;
    modifiable: boolean;
    semanticHash: string;
  }[];
}

interface TextSpanLineageArtifact {
  semanticHash: string;
  events: {
    eventId: string;
    finalCueId: string | null;
    spanStart: number | null;
    spanEnd: number | null;
    spanText: string | null;
    lineageStatus:
      | "EXACT"
      | "NORMALIZED_EXACT"
      | "DERIVED_FROM_SPLIT"
      | "DERIVED_FROM_MERGE"
      | "AMBIGUOUS"
      | "UNRESOLVED";
    modifiable: boolean;
    blockers: string[];
    semanticHash: string;
  }[];
}

interface RiskFact {
  factType: string;
  evidenceClass:
    | "POSITIVE_CORRECTNESS_EVIDENCE"
    | "POSITIVE_ERROR_EVIDENCE"
    | "SUPPORTING_ERROR_EVIDENCE"
    | "CONFLICTING_EVIDENCE"
    | "EVIDENCE_ABSENCE"
    | "UNKNOWN";
  severity: string;
  evidenceMissing: boolean;
  sourceEvidenceIds: string[];
}

interface RiskArtifact {
  semanticHash: string;
  events: { eventId: string; riskFacts: RiskFact[]; semanticHash: string }[];
}

interface SourceInfo {
  format: { durationSeconds: number };
}

interface HoldoutRecord {
  request: IndependentAsrProviderRequest;
  result: IndependentAsrProviderResult;
  cacheKey: string;
}

type ReazonBatchRun = Awaited<
  ReturnType<ReazonSpeechK2Provider["transcribeBatch"]>
>;

interface PreGoldReazonCheckpoint {
  generatedAt: string;
  artifactType: "c6-0-1-10-pre-gold-reazon-checkpoint";
  sourceMediaSha256: string;
  modelIdentity: { modelSnapshotHash: string };
  exactDiagnostics: ReazonBatchRun["diagnostics"];
  contextDiagnostics: ReazonBatchRun["diagnostics"];
  records: HoldoutRecord[];
  runtimeGoldInputCount: number;
}

interface HoldoutCtcEvidence {
  eventId: string;
  whisperSupport: number | null;
  reazonSupport: number | null;
  outcome:
    | "CTC_FAVORS_WHISPER"
    | "CTC_FAVORS_REAZON"
    | "CTC_AMBIGUOUS"
    | "CTC_UNSCORABLE";
  evidenceIds: string[];
}

function parseArguments(values: string[]): Arguments {
  const required = (name: string): string => {
    const index = values.indexOf(name);
    const result = index >= 0 ? values[index + 1] : undefined;
    if (result === undefined || result.startsWith("--")) {
      throw new Error(`Missing ${name}.`);
    }
    return path.resolve(result);
  };
  const generatedIndex = values.indexOf("--generated-at");
  const generatedAt =
    generatedIndex >= 0 ? values[generatedIndex + 1] : undefined;
  if (generatedAt === undefined || Number.isNaN(Date.parse(generatedAt))) {
    throw new Error("Missing valid --generated-at.");
  }
  return {
    baseline: required("--baseline"),
    devState: required("--dev-state"),
    source: required("--source"),
    gold: required("--gold"),
    outputRoot: required("--output-root"),
    modelDirectory: required("--model-directory"),
    pythonExecutable: required("--python"),
    sudachiPython: required("--sudachi-python"),
    sudachiHelper: required("--sudachi-helper"),
    ctcRuntimeManifest: required("--ctc-runtime-manifest"),
    ctcModelManifest: required("--ctc-model-manifest"),
    cacheFile: required("--cache-file"),
    audioDirectory: required("--audio-directory"),
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
  const matches = (await readdir(root, { withFileTypes: true })).filter(
    (entry) => entry.isDirectory() && entry.name.startsWith("subtitle-"),
  );
  if (matches.length !== 1) {
    throw new Error(`Expected one subtitle directory under ${root}.`);
  }
  return path.join(root, matches[0]?.name ?? "");
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
    if (error instanceof Error && error.message.startsWith("Refusing")) {
      throw error;
    }
  }
  await cp(baseline, destination, {
    recursive: true,
    preserveTimestamps: true,
  });
  const subtitle = await locateSubtitleDirectory(destination);
  await Promise.all(
    Object.entries(artifacts).map(([name, artifact]) =>
      writeJson(path.join(subtitle, name), artifact),
    ),
  );
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
      else reject(new Error(`${path.basename(executable)} failed: ${stderr}`));
    });
  });
}

async function wavSampleCount(file: string): Promise<number> {
  const buffer = await readFile(file);
  if (
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error("Extracted audio is not RIFF/WAVE.");
  }
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (type === "data") return Math.floor(size / 2);
    offset += 8 + size + (size % 2);
  }
  throw new Error("Extracted WAV has no data chunk.");
}

function contextInterval(
  core: { start: number; end: number },
  sourceDuration: number,
): { start: number; end: number } {
  let start = Math.max(0, core.start - 1.5);
  let end = Math.min(sourceDuration, core.end + 1.5);
  const excess = end - start - MAX_RAW_SECONDS;
  if (excess > 0) {
    const removeLeft = Math.min(core.start - start, excess / 2);
    start += removeLeft;
    end -= excess - removeLeft;
  }
  return { start, end };
}

function modelFileHashes(
  modelIdentity: Awaited<ReturnType<typeof loadReazonK2ModelIdentity>>,
) {
  return Object.fromEntries(
    modelIdentity.modelFiles.map((file) => [file.fileName, file.sha256]),
  );
}

async function extractRequest(input: {
  eventId: string;
  windowType: "CORE_EXACT" | "CORE_CONTEXT";
  interval: { start: number; end: number };
  source: string;
  sourceSha256: string;
  audioDirectory: string;
  extractionConfigHash: string;
}): Promise<IndependentAsrProviderRequest> {
  const requestId = `c60110:holdout:${input.eventId}:${input.windowType}`;
  const audioPath = path.join(
    input.audioDirectory,
    `${requestId.replaceAll(":", "-")}.wav`,
  );
  await runProcess("/opt/homebrew/bin/ffmpeg", [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    input.interval.start.toFixed(6),
    "-t",
    (input.interval.end - input.interval.start).toFixed(6),
    "-i",
    input.source,
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
  return {
    requestId,
    eventId: input.eventId,
    diagnosticRole: "CONTROL",
    windowType: input.windowType,
    sourceInterval: input.interval,
    sourceMediaSha256: input.sourceSha256,
    audioPath,
    audioSha256: await sha256File(audioPath),
    sampleRate: SAMPLE_RATE,
    sampleCount: await wavSampleCount(audioPath),
    extractionConfigHash: input.extractionConfigHash,
  };
}

function evidenceFromFact(
  riskEvent: RiskArtifact["events"][number] | undefined,
  factType: string,
  reasonCode:
    | "WHISPER_DECODER_INSTABILITY"
    | "WHISPER_LEXICALLY_UNSTABLE"
    | "WHISPER_INCOMPLETE_SPEECH_SUPPORT",
): C60110MachineEvidenceInput {
  const fact = riskEvent?.riskFacts.find(
    (value) => value.factType === factType,
  );
  if (fact === undefined) {
    return {
      status: "EVIDENCE_ABSENCE",
      strong: false,
      evidenceMissing: true,
      sourceEvidenceIds: [],
      reasonCodes: [],
    };
  }
  return {
    status: fact.evidenceClass,
    strong: fact.severity === "STRONG",
    evidenceMissing: fact.evidenceMissing,
    sourceEvidenceIds: fact.sourceEvidenceIds,
    reasonCodes:
      fact.evidenceClass === "POSITIVE_ERROR_EVIDENCE" ? [reasonCode] : [],
  };
}

function classifyWhisperStability(
  riskEvent: RiskArtifact["events"][number] | undefined,
): C60110EvidenceEventInput["whisperStability"]["class"] {
  const hallucination = riskEvent?.riskFacts.find(
    (fact) =>
      fact.factType === "repetitionRisk" &&
      fact.evidenceClass === "POSITIVE_ERROR_EVIDENCE",
  );
  if (hallucination !== undefined) return "HALLUCINATION_DISAGREEMENT";
  const disagreement = riskEvent?.riskFacts.find(
    (fact) =>
      fact.factType === "independentWindowDisagreement" &&
      fact.evidenceClass === "POSITIVE_ERROR_EVIDENCE",
  );
  return disagreement === undefined ? "NOT_RUN" : "LEXICAL_CORE_DISAGREEMENT";
}

function classifyReazonStability(input: {
  exact: C60110CandidateInput | null;
  context: C60110CandidateInput | null;
}) {
  if (input.exact === null) return "UNCOMPARABLE" as const;
  if (input.exact.text.trim() === "") return "REAZON_EMPTY_UNSTABLE" as const;
  if (input.exact.hallucinationRisk >= 0.6) {
    return "REAZON_HALLUCINATION_UNSTABLE" as const;
  }
  if (input.context === null) return "CONTEXT_NOT_RUN" as const;
  if (input.context.text.trim() === "") return "REAZON_EMPTY_UNSTABLE" as const;
  if (input.context.hallucinationRisk >= 0.6) {
    return "REAZON_HALLUCINATION_UNSTABLE" as const;
  }
  const exactNormalized = normalizeIndependentAsrLexical(input.exact.text);
  const contextNormalized = normalizeIndependentAsrLexical(input.context.text);
  if (exactNormalized === contextNormalized)
    return "REAZON_CORE_STABLE" as const;
  if (
    contextNormalized.includes(exactNormalized) ||
    normalizedEditSimilarity(
      input.exact.pronunciationText ??
        normalizeJapanesePronunciation(input.exact.text),
      input.context.pronunciationText ??
        normalizeJapanesePronunciation(input.context.text),
    ) >= 0.9
  ) {
    return "REAZON_CONTEXT_EXTENSION_ONLY" as const;
  }
  return "REAZON_LEXICALLY_UNSTABLE" as const;
}

function candidateFromRecord(input: {
  record: HoldoutRecord | undefined;
  pronunciation: string;
}): C60110CandidateInput | null {
  if (input.record === undefined) return null;
  const text = normalizeIndependentAsrDisplay(input.record.result.text);
  const core = {
    candidateId: input.record.request.requestId,
    providerFamily: "REAZON" as const,
    text,
    pronunciationText: input.pronunciation,
    hallucinationRisk: genericHallucinationRisk({
      text,
      durationSeconds:
        input.record.request.sampleCount / input.record.request.sampleRate,
    }),
    evidenceAvailability: ["SUCCESS", "EMPTY_OUTPUT"].includes(
      input.record.result.status,
    )
      ? ("COMPLETE" as const)
      : ("PARTIAL" as const),
  };
  return {
    ...core,
    sourceSemanticHash: machineQualitySemanticHash({
      ...core,
      request: {
        eventId: input.record.request.eventId,
        windowType: input.record.request.windowType,
        sourceInterval: input.record.request.sourceInterval,
        audioSha256: input.record.request.audioSha256,
      },
      resultStatus: input.record.result.status,
      cacheKey: input.record.cacheKey,
    }),
  };
}

function overlapSeconds(
  left: { start: number; end: number },
  right: { start: number; end: number },
): number {
  return Math.max(
    0,
    Math.min(left.end, right.end) - Math.max(left.start, right.start),
  );
}

function textError(value: string, gold: string): number {
  return independentAsrLexicalEditDistance(
    normalizeIndependentAsrLexical(value),
    normalizeIndependentAsrLexical(gold),
  );
}

function normalizeSudachiReadingInput(value: string): string {
  const normalized = value.normalize("NFKC").replace(/\p{Cf}/gu, "");
  return normalized.length > 0 ? normalized : value;
}

const argumentsValue = parseArguments(process.argv.slice(2));
const sourceHashBefore = await sha256File(argumentsValue.source);
if (sourceHashBefore !== SOURCE_SHA256) {
  throw new Error("Source media identity mismatch.");
}
const baselineSubtitle = await locateSubtitleDirectory(argumentsValue.baseline);
const devState = await readJson<DevState>(argumentsValue.devState);
const [
  canonical,
  pool,
  cueLineage,
  textSpanLineage,
  risk,
  sourceInfo,
  packageValue,
] = await Promise.all([
  readJson<CanonicalArtifact>(
    path.join(baselineSubtitle, "machine-canonical-events.json"),
  ),
  readJson<CandidatePoolArtifact>(
    path.join(baselineSubtitle, "machine-candidate-pool-c6-0-1-5.json"),
  ),
  readJson<CueLineageArtifact>(
    path.join(baselineSubtitle, "machine-event-to-final-cue-lineage.json"),
  ),
  readJson<TextSpanLineageArtifact>(
    path.join(baselineSubtitle, "machine-event-final-text-span-lineage.json"),
  ),
  readJson<RiskArtifact>(
    path.join(baselineSubtitle, "machine-reasr-risk-v2.json"),
  ),
  readJson<SourceInfo>(path.join(baselineSubtitle, "source-info.json")),
  readJson<unknown>(path.join(baselineSubtitle, "subtitle-package.json")).then(
    (value) => subtitlePackageSchema.parse(value),
  ),
]);
const poolEventById = new Map(
  pool.events.map((event) => [event.eventId, event] as const),
);
const candidateById = new Map(
  pool.candidates.map(
    (candidate) => [candidate.candidateId, candidate] as const,
  ),
);
const spanByEvent = new Map(
  textSpanLineage.events.map((event) => [event.eventId, event] as const),
);
const lineageByEvent = new Map(
  cueLineage.events.map((event) => [event.eventId, event] as const),
);
const riskByEvent = new Map(
  risk.events.map((event) => [event.eventId, event] as const),
);
const canonicalForSelection = canonical.events.map((event) => ({
  ...event,
  representativeCandidateId:
    poolEventById.get(event.eventId)?.selectedVariantId ??
    event.representativeCandidateId,
}));
const holdoutSelection = buildC60110HoldoutSelection({
  generatedAt: argumentsValue.generatedAt,
  sourceMediaSha256: SOURCE_SHA256,
  policyFreezeSemanticHash: devState.policyFreeze.semanticHash,
  canonicalEvents: canonicalForSelection,
  cueLineage: cueLineage.events,
  dev24EventIds: devState.inputFreeze.eventIds,
  sourceGlobalVerifiedCandidateIds: new Set(
    pool.candidates
      .filter((candidate) => candidate.sourceGlobalVerified)
      .map((candidate) => candidate.candidateId),
  ),
});
const outputNames = {
  selection: "carnation-c6-0-1-10-holdout-selection-20260829",
  runtime: "carnation-c6-0-1-10-holdout-reazon-20260829",
  arbitration: "carnation-c6-0-1-10-holdout-arbitration-20260829",
  proposals: "carnation-c6-0-1-10-mutation-proposals-20260829",
  full: "carnation-c6-0-1-10-full-candidate-20260829",
  finalA: "carnation-c6-0-1-10-final-a-20260829",
  oracle: "carnation-c6-0-1-10-oracle-capture-20260829",
} as const;
const devArtifacts = {
  "c6-0-1-10-dev24-input-freeze.json": devState.inputFreeze,
  "c6-0-1-10-policy-profiles.json": devState.profiles,
  "c6-0-1-10-dev24-evaluation.json": devState.dev24Evaluation,
  "c6-0-1-10-control-regression-evaluation.json": devState.controlEvaluation,
  "c6-0-1-10-policy-freeze.json": devState.policyFreeze,
  "c6-0-1-10-quality-policy.json": devState.qualityPolicy,
};
await snapshot(
  argumentsValue.baseline,
  path.join(argumentsValue.outputRoot, outputNames.selection),
  {
    ...devArtifacts,
    "c6-0-1-10-holdout-selection.json": holdoutSelection,
  },
);

await mkdir(argumentsValue.audioDirectory, { recursive: true });
const modelIdentity = await loadReazonK2ModelIdentity(
  argumentsValue.modelDirectory,
);
const extractionConfigHash = machineQualitySemanticHash({
  ffmpeg: "local-ffmpeg",
  audioStream: "0:a:0",
  sampleRate: SAMPLE_RATE,
  channels: 1,
  codec: "pcm_s16le",
  seekMode: "accurate-output-seek",
});
const localizable = holdoutSelection.events.filter(
  (event) => event.machineLocalizable,
);
const provider = new ReazonSpeechK2Provider({
  pythonExecutable: argumentsValue.pythonExecutable,
  workerScriptPath: path.resolve("scripts/runtime/reazonspeech_k2_worker.py"),
  modelDirectory: argumentsValue.modelDirectory,
});
let exactRun: ReazonBatchRun;
let contextRun: ReazonBatchRun;
const exactRequests: IndependentAsrProviderRequest[] = [];
const contextRequests: IndependentAsrProviderRequest[] = [];
const checkpointPath = path.resolve(
  "temp/c6-0-1-10-pre-gold-reazon-checkpoint.json",
);
let records: HoldoutRecord[];
let checkpoint: PreGoldReazonCheckpoint | null = null;
try {
  checkpoint = await readJson<PreGoldReazonCheckpoint>(checkpointPath);
} catch {
  // A missing or invalid checkpoint falls through to a new Fresh run.
}
const checkpointExactCount =
  checkpoint?.records.filter(
    (record) => record.request.windowType === "CORE_EXACT",
  ).length ?? 0;
const checkpointValid =
  checkpoint?.artifactType === "c6-0-1-10-pre-gold-reazon-checkpoint" &&
  checkpoint.generatedAt === argumentsValue.generatedAt &&
  checkpoint.sourceMediaSha256 === SOURCE_SHA256 &&
  checkpoint.modelIdentity.modelSnapshotHash ===
    modelIdentity.modelSnapshotHash &&
  checkpoint.runtimeGoldInputCount === 0 &&
  checkpointExactCount === localizable.length &&
  checkpoint.records.every(
    (record) =>
      record.request.sourceMediaSha256 === SOURCE_SHA256 &&
      record.request.requestId === record.result.requestId,
  );
if (checkpointValid && checkpoint !== null) {
  records = checkpoint.records;
  exactRequests.push(
    ...records
      .filter((record) => record.request.windowType === "CORE_EXACT")
      .map((record) => record.request),
  );
  contextRequests.push(
    ...records
      .filter((record) => record.request.windowType === "CORE_CONTEXT")
      .map((record) => record.request),
  );
  exactRun = {
    results: records
      .filter((record) => record.request.windowType === "CORE_EXACT")
      .map((record) => record.result),
    diagnostics: checkpoint.exactDiagnostics,
  };
  contextRun = {
    results: records
      .filter((record) => record.request.windowType === "CORE_CONTEXT")
      .map((record) => record.result),
    diagnostics: checkpoint.contextDiagnostics,
  };
  process.stderr.write(
    `C6.0.1.10 resumed ${records.length} pre-Gold Fresh Reazon results from checkpoint.\n`,
  );
} else {
  for (const [index, event] of localizable.entries()) {
    exactRequests.push(
      await extractRequest({
        eventId: event.eventId,
        windowType: "CORE_EXACT",
        interval: event.coreInterval,
        source: argumentsValue.source,
        sourceSha256: SOURCE_SHA256,
        audioDirectory: argumentsValue.audioDirectory,
        extractionConfigHash,
      }),
    );
    if ((index + 1) % 25 === 0 || index + 1 === localizable.length) {
      process.stderr.write(
        `C6.0.1.10 extracted CORE_EXACT ${index + 1}/${localizable.length}\n`,
      );
    }
  }
  try {
    exactRun = await provider.transcribeBatch(exactRequests);
    const exactResultById = new Map(
      exactRun.results.map((result) => [result.requestId, result] as const),
    );
    const contextEvents = localizable.filter((event) => {
      const requestId = `c60110:holdout:${event.eventId}:CORE_EXACT`;
      const exact = exactResultById.get(requestId);
      const poolEvent = poolEventById.get(event.eventId);
      const current = candidateById.get(
        poolEvent?.selectedVariantId ?? event.currentCandidateId,
      );
      const span = spanByEvent.get(event.eventId);
      const currentText = span?.spanText ?? current?.text ?? "";
      return (
        exact?.status !== "SUCCESS" ||
        normalizeIndependentAsrLexical(exact.text) !==
          normalizeIndependentAsrLexical(currentText)
      );
    });
    for (const [index, event] of contextEvents.entries()) {
      contextRequests.push(
        await extractRequest({
          eventId: event.eventId,
          windowType: "CORE_CONTEXT",
          interval: contextInterval(
            event.coreInterval,
            sourceInfo.format.durationSeconds,
          ),
          source: argumentsValue.source,
          sourceSha256: SOURCE_SHA256,
          audioDirectory: argumentsValue.audioDirectory,
          extractionConfigHash,
        }),
      );
      if ((index + 1) % 25 === 0 || index + 1 === contextEvents.length) {
        process.stderr.write(
          `C6.0.1.10 extracted CORE_CONTEXT ${index + 1}/${contextEvents.length}\n`,
        );
      }
    }
    contextRun =
      contextRequests.length === 0
        ? { results: [], diagnostics: exactRun.diagnostics }
        : await provider.transcribeBatch(contextRequests);
  } finally {
    await provider.close();
  }
  const freshResults = [...exactRun.results, ...contextRun.results];
  const resultById = new Map(
    freshResults.map((result) => [result.requestId, result] as const),
  );
  records = [...exactRequests, ...contextRequests].map((request) => {
    const result = resultById.get(request.requestId);
    if (result === undefined) throw new Error(`Missing ${request.requestId}.`);
    return {
      request,
      result,
      cacheKey: independentAsrCacheKey({
        providerId: "reazonspeech-k2-v2",
        modelRevision: modelIdentity.modelRevision,
        modelFileHashes: modelFileHashes(modelIdentity),
        precision: "fp32",
        audioSha256: request.audioSha256,
        sourceInterval: request.sourceInterval,
        decodingConfig: {
          method: "greedy_search",
          threads: 1,
          sampleRate: SAMPLE_RATE,
          padSeconds: 0.9,
        },
        normalizationConfig: {
          version: "c60110-independent-asr-text-v1",
        },
      }),
    };
  });
  await mkdir(path.resolve("temp"), { recursive: true });
  await writeJson(checkpointPath, {
    schemaVersion: "1.0.0",
    policyVersion: "c6.0.1.10-cross-model-arbitration-v1",
    generatedAt: argumentsValue.generatedAt,
    artifactType: "c6-0-1-10-pre-gold-reazon-checkpoint",
    sourceMediaSha256: SOURCE_SHA256,
    modelIdentity,
    exactDiagnostics: exactRun.diagnostics,
    contextDiagnostics: contextRun.diagnostics,
    records,
    runtimeGoldInputCount: 0,
  });
}
const allResults = [...exactRun.results, ...contextRun.results];

const readingItems = [
  ...records.map((record) => ({
    id: record.request.requestId,
    text: normalizeSudachiReadingInput(record.result.text),
  })),
  ...localizable.flatMap((event) => {
    const poolEvent = poolEventById.get(event.eventId);
    const currentId = poolEvent?.selectedVariantId ?? event.currentCandidateId;
    const current = candidateById.get(currentId);
    const span = spanByEvent.get(event.eventId);
    const currentText = span?.spanText ?? current?.text ?? "";
    return [
      {
        id: `whisper-current:${event.eventId}`,
        text: normalizeSudachiReadingInput(currentText),
      },
      ...pool.candidates
        .filter(
          (candidate) =>
            candidate.eventId === event.eventId &&
            candidate.candidateId !== currentId,
        )
        .map((candidate) => ({
          id: `whisper-alt:${candidate.candidateId}`,
          text: normalizeSudachiReadingInput(candidate.text),
        })),
    ];
  }),
];
const readings = await runSudachiMorphemeAnalysis({
  pythonExecutable: argumentsValue.sudachiPython,
  helperPath: argumentsValue.sudachiHelper,
  items: readingItems,
  timeoutMs: 300_000,
});
const candidateByRequestId = new Map<string, C60110CandidateInput | null>();
for (const record of records) {
  candidateByRequestId.set(
    record.request.requestId,
    candidateFromRecord({
      record,
      pronunciation:
        readings.readingsById.get(record.request.requestId) ??
        normalizeJapanesePronunciation(record.result.text),
    }),
  );
}

const runtimeCandidates: C60110HoldoutReazonRuntime["candidates"] = records.map(
  (record) => {
    const candidate = candidateByRequestId.get(record.request.requestId);
    if (candidate === undefined || candidate === null) {
      throw new Error(
        `Candidate materialization failed for ${record.request.requestId}.`,
      );
    }
    const displayText = normalizeIndependentAsrDisplay(candidate.text);
    const core = {
      candidateId: candidate.candidateId,
      providerFamily: "REAZON" as const,
      displayText,
      normalizedDisplayText: normalizeIndependentAsrLexical(displayText),
      pronunciationText:
        candidate.pronunciationText ??
        normalizeJapanesePronunciation(displayText),
      hallucinationRisk: candidate.hallucinationRisk,
      evidenceAvailability: candidate.evidenceAvailability,
      semanticHash:
        candidate.sourceSemanticHash ?? machineQualitySemanticHash(candidate),
      eventId: record.request.eventId,
      windowType: record.request.windowType,
      requestId: record.request.requestId,
      cacheKey: record.cacheKey,
      cacheHit: false,
      inferenceExecuted: true,
      sourceInterval: record.request.sourceInterval,
    };
    return core;
  },
);
const adapterSourceSha256 = await sha256File(
  path.resolve("scripts/runtime/reazonspeech_k2_worker.py"),
);
const runtimeId = provider.runtimeIdentity({
  modelIdentity,
  adapterSourceSha256,
  pythonVersion: exactRun.diagnostics.pythonVersion,
  sherpaOnnxVersion: exactRun.diagnostics.sherpaOnnxVersion,
});
const runtimeCore = {
  schemaVersion: "1.0.0" as const,
  policyVersion: "c6.0.1.10-cross-model-arbitration-v1" as const,
  generatedAt: argumentsValue.generatedAt,
  artifactType: "c6-0-1-10-holdout-reazon-runtime" as const,
  executionKind: "OFFICIAL_FRESH_INFERENCE" as const,
  selectionSemanticHash: holdoutSelection.semanticHash,
  modelIdentity: {
    modelId: "reazon-research/reazonspeech-k2-v2" as const,
    modelRevision: "291488c8151be24d7da4bf7af26e533fad96e407" as const,
    modelSnapshotHash: modelIdentity.modelSnapshotHash,
    encoderSha256:
      "ecdb0b771e16104aaf8e579cb3c1e32fbd589eb641c5946d82b615bd366c5f96" as const,
    decoderSha256:
      "58b18211ae06265466bfa17172dab574df94f76c8bcb61a3640c28ba860e4124" as const,
    joinerSha256:
      "d38a81d1191c9ed6de6a1719503692e07e3e973e2364adde0abae5eaaded1174" as const,
    tokensSha256:
      "2c3ac659818a48a0c04010e0593bbc4d7c8a24a054340b01131499c05fd52def" as const,
    precision: "fp32" as const,
  },
  runtimeIdentity: {
    runtimeId,
    adapterType: "DIRECT_SHERPA_ONNX_OFFICIAL_REAZON_FP32" as const,
    sherpaOnnxVersion: "1.13.6" as const,
    device: "cpu" as const,
    architecture: `${os.arch()} / ${os.cpus()[0]?.model ?? "unknown"}`,
  },
  requests: {
    coreExactPlannedCount: localizable.length,
    coreExactActualCount: exactRequests.length,
    coreExactCacheHitCount: 0,
    coreExactFreshInferenceCount: exactRun.results.length,
    contextEscalationPlannedCount: contextRequests.length,
    contextActualCount: contextRun.results.length,
    contextCacheHitCount: 0,
    contextFreshInferenceCount: contextRun.results.length,
    successfulCount: allResults.filter((result) => result.status === "SUCCESS")
      .length,
    failedCount: allResults.filter(
      (result) => !["SUCCESS", "EMPTY_OUTPUT"].includes(result.status),
    ).length,
    emptyOutputCount: allResults.filter(
      (result) => result.status === "EMPTY_OUTPUT",
    ).length,
    modelLoadCount: Math.max(
      exactRun.diagnostics.modelLoadCount,
      contextRun.diagnostics.modelLoadCount,
    ),
    processStartCount: Math.max(
      exactRun.diagnostics.processStartCount,
      contextRun.diagnostics.processStartCount,
    ),
  },
  candidates: runtimeCandidates,
  networkUsed: false as const,
  remoteApiUsed: false as const,
  runtimeGoldInputCount: 0 as const,
};
const holdoutRuntime = c60110HoldoutReazonRuntimeSchema.parse({
  ...runtimeCore,
  semanticHash: machineQualitySemanticHash({
    ...runtimeCore,
    generatedAt: undefined,
  }),
});
await snapshot(
  argumentsValue.baseline,
  path.join(argumentsValue.outputRoot, outputNames.runtime),
  {
    ...devArtifacts,
    "c6-0-1-10-holdout-selection.json": holdoutSelection,
    "c6-0-1-10-holdout-reazon-runtime.json": holdoutRuntime,
  },
);

function buildEvidenceInputs(
  ctcByEvent: ReadonlyMap<string, HoldoutCtcEvidence>,
): C60110EvidenceEventInput[] {
  return localizable.map((event) => {
    const poolEvent = poolEventById.get(event.eventId);
    const currentId = poolEvent?.selectedVariantId ?? event.currentCandidateId;
    const currentCandidate = candidateById.get(currentId);
    const span = spanByEvent.get(event.eventId);
    const lineage = lineageByEvent.get(event.eventId);
    const riskEvent = riskByEvent.get(event.eventId);
    const currentText = span?.spanText ?? currentCandidate?.text ?? "";
    const exactRequestId = `c60110:holdout:${event.eventId}:CORE_EXACT`;
    const contextRequestId = `c60110:holdout:${event.eventId}:CORE_CONTEXT`;
    const exact = candidateByRequestId.get(exactRequestId) ?? null;
    const context = candidateByRequestId.get(contextRequestId) ?? null;
    const reazonClass = classifyReazonStability({ exact, context });
    const ctc = ctcByEvent.get(event.eventId);
    const associationFact = riskEvent?.riskFacts.find(
      (fact) => fact.factType === "associationAmbiguity",
    );
    const current: C60110CandidateInput = {
      candidateId: currentId,
      providerFamily: "WHISPER",
      text: currentText,
      pronunciationText:
        readings.readingsById.get(`whisper-current:${event.eventId}`) ??
        normalizeJapanesePronunciation(currentText),
      hallucinationRisk: genericHallucinationRisk({
        text: currentText,
        durationSeconds: event.coreInterval.end - event.coreInterval.start,
      }),
      evidenceAvailability:
        currentCandidate?.evidenceCompleteness === "COMPLETE"
          ? "COMPLETE"
          : "PARTIAL",
      ...(currentCandidate === undefined
        ? {}
        : { sourceSemanticHash: currentCandidate.semanticHash }),
    };
    const alternates = pool.candidates
      .filter(
        (candidate) =>
          candidate.eventId === event.eventId &&
          candidate.candidateId !== currentId,
      )
      .map((candidate): C60110CandidateInput => ({
        candidateId: candidate.candidateId,
        providerFamily: "WHISPER",
        text: candidate.text,
        pronunciationText:
          readings.readingsById.get(`whisper-alt:${candidate.candidateId}`) ??
          normalizeJapanesePronunciation(candidate.text),
        hallucinationRisk: genericHallucinationRisk({
          text: candidate.text,
          durationSeconds: event.coreInterval.end - event.coreInterval.start,
        }),
        evidenceAvailability:
          candidate.evidenceCompleteness === "COMPLETE"
            ? "COMPLETE"
            : "PARTIAL",
        sourceSemanticHash: candidate.semanticHash,
      }));
    return {
      eventId: event.eventId,
      diagnosticRole: "HOLDOUT",
      currentFinalCueIds: lineage?.finalCueIds ?? [],
      currentFinalSpanLineage: {
        finalCueId: span?.finalCueId ?? null,
        spanStart: span?.spanStart ?? null,
        spanEnd: span?.spanEnd ?? null,
        lineageStatus: span?.lineageStatus ?? "UNRESOLVED",
        modifiable: span?.modifiable ?? false,
        blockers: span?.blockers ?? ["text-span-lineage-unavailable"],
        semanticHash:
          span?.semanticHash ??
          machineQualitySemanticHash({ eventId: event.eventId, missing: true }),
      },
      currentWhisperCandidate: current,
      alternateWhisperCandidates: alternates,
      reazonCoreExactCandidate: exact,
      reazonCoreContextCandidate: context,
      whisperStability: {
        class: classifyWhisperStability(riskEvent),
        sourceEvidenceIds: [riskEvent?.semanticHash ?? event.semanticHash],
      },
      reazonStability: {
        class: reazonClass,
        sourceEvidenceIds: [
          ...(runtimeCandidates.find(
            (candidate) => candidate.requestId === exactRequestId,
          ) === undefined
            ? []
            : [
                runtimeCandidates.find(
                  (candidate) => candidate.requestId === exactRequestId,
                )?.semanticHash ?? "",
              ]
          ).filter((value) => value !== ""),
          ...(runtimeCandidates.find(
            (candidate) => candidate.requestId === contextRequestId,
          ) === undefined
            ? []
            : [
                runtimeCandidates.find(
                  (candidate) => candidate.requestId === contextRequestId,
                )?.semanticHash ?? "",
              ]
          ).filter((value) => value !== ""),
        ],
      },
      whisperDecoderEvidence: evidenceFromFact(
        riskEvent,
        "decoderWeak",
        "WHISPER_DECODER_INSTABILITY",
      ),
      whisperTokenEvidence: evidenceFromFact(
        riskEvent,
        "tokenConflict",
        "WHISPER_LEXICALLY_UNSTABLE",
      ),
      requestEdgeEvidence: evidenceFromFact(
        riskEvent,
        "requestEdgeRisk",
        "WHISPER_INCOMPLETE_SPEECH_SUPPORT",
      ),
      speechCompletenessEvidence: evidenceFromFact(
        riskEvent,
        "speechIncomplete",
        "WHISPER_INCOMPLETE_SPEECH_SUPPORT",
      ),
      ctc:
        ctc === undefined
          ? {
              whisperSupport: null,
              reazonSupport: null,
              outcome: "CTC_NOT_RUN",
              sourceEvidenceIds: [],
            }
          : {
              whisperSupport: ctc.whisperSupport,
              reazonSupport: ctc.reazonSupport,
              outcome: ctc.outcome,
              sourceEvidenceIds: ctc.evidenceIds,
            },
      coreLocalizationStatus: "MACHINE_LOCALIZABLE",
      crossEventAmbiguity:
        associationFact?.evidenceClass === "CONFLICTING_EVIDENCE" &&
        associationFact.severity === "STRONG",
      runtimeProvenanceComplete: exact !== null,
    };
  });
}

const preliminaryEvidence = buildMachineCrossModelArbitrationEvidence({
  generatedAt: argumentsValue.generatedAt,
  scope: "EPISODE_HOLDOUT",
  sourceMediaSha256: SOURCE_SHA256,
  upstreamSemanticHashes: {
    policyFreeze: devState.policyFreeze.semanticHash,
    holdoutSelection: holdoutSelection.semanticHash,
    holdoutRuntime: holdoutRuntime.semanticHash,
  },
  events: buildEvidenceInputs(new Map()),
});
const shadowProfile =
  devState.policyFreeze.selectedProductionProfile === "DISABLED"
    ? ("CONSERVATIVE" as const)
    : devState.policyFreeze.selectedProductionProfile;
const preliminaryDecisions = preliminaryEvidence.events.map((bundle) =>
  arbitrateCrossModelCandidate({
    bundle,
    profiles: devState.profiles,
    profileName: shadowProfile,
    productionEnforcementEnabled: true,
  }),
);
const ctcEligibleIds = new Set(
  preliminaryDecisions
    .filter(
      (decision) =>
        decision.decision === "SELECT_REAZON" &&
        decision.reazonCandidateId !== null,
    )
    .map((decision) => decision.eventId),
);
const ctcEvidenceByEvent = new Map<string, HoldoutCtcEvidence>();
const ctcAttempts: unknown[] = [];
let ctcInferenceCount = 0;
let ctcModelLoadCount = 0;
if (ctcEligibleIds.size > 0) {
  const verifiedCtc = await loadAndVerifyCtcRuntime({
    runtimeManifestPath: argumentsValue.ctcRuntimeManifest,
    modelManifestPath: argumentsValue.ctcModelManifest,
  });
  const worker = new LocalCtcWorker({
    ...verifiedCtc,
    device: "cpu",
    workerScriptPath: path.resolve("scripts/runtime/ctc_worker.py"),
  });
  try {
    for (const eventId of [...ctcEligibleIds].toSorted()) {
      const bundle = preliminaryEvidence.events.find(
        (event) => event.eventId === eventId,
      );
      const record = records.find(
        (value) =>
          value.request.eventId === eventId &&
          value.request.windowType === "CORE_EXACT",
      );
      if (
        bundle === undefined ||
        record === undefined ||
        bundle.reazonCoreExactCandidate === null
      ) {
        continue;
      }
      const common = {
        cueId: eventId,
        componentId: eventId,
        windowType: "narrow" as const,
        audioPath: record.request.audioPath,
        audioSha256: record.request.audioSha256,
        audioLocalInterval: {
          start: 0,
          end: record.request.sampleCount / record.request.sampleRate,
        },
        mediaGlobalInterval: record.request.sourceInterval,
      };
      const whisperAttempt = await worker.align({
        ...common,
        attemptId: `ctc-c60110:${eventId}:whisper`,
        targetText: bundle.currentWhisperCandidate.pronunciationText,
      });
      const reazonAttempt = await worker.align({
        ...common,
        attemptId: `ctc-c60110:${eventId}:reazon`,
        targetText: bundle.reazonCoreExactCandidate.pronunciationText,
      });
      ctcInferenceCount += 2;
      ctcModelLoadCount +=
        whisperAttempt.modelLoadCount + reazonAttempt.modelLoadCount;
      ctcAttempts.push(whisperAttempt, reazonAttempt);
      const whisperScore = whisperAttempt.normalizedPathLogScore;
      const reazonScore = reazonAttempt.normalizedPathLogScore;
      const difference =
        whisperScore === null || reazonScore === null
          ? null
          : reazonScore - whisperScore;
      ctcEvidenceByEvent.set(eventId, {
        eventId,
        whisperSupport: whisperScore,
        reazonSupport: reazonScore,
        outcome:
          difference === null
            ? "CTC_UNSCORABLE"
            : Math.abs(difference) < 0.05
              ? "CTC_AMBIGUOUS"
              : difference > 0
                ? "CTC_FAVORS_REAZON"
                : "CTC_FAVORS_WHISPER",
        evidenceIds: [whisperAttempt.attemptId, reazonAttempt.attemptId],
      });
    }
  } finally {
    await worker.close();
  }
}
const holdoutEvidence = buildMachineCrossModelArbitrationEvidence({
  generatedAt: argumentsValue.generatedAt,
  scope: "EPISODE_HOLDOUT",
  sourceMediaSha256: SOURCE_SHA256,
  upstreamSemanticHashes: {
    policyFreeze: devState.policyFreeze.semanticHash,
    holdoutSelection: holdoutSelection.semanticHash,
    holdoutRuntime: holdoutRuntime.semanticHash,
  },
  events: buildEvidenceInputs(ctcEvidenceByEvent),
});
const holdoutLedger = buildMachineCrossModelArbitrationLedger({
  generatedAt: argumentsValue.generatedAt,
  scope: "EPISODE_HOLDOUT",
  evidence: holdoutEvidence,
  profiles: devState.profiles,
  profileName: shadowProfile,
  arbitrationPolicyHash: devState.policyFreeze.arbitrationPolicyHash,
  productionEnforcementEnabled: devState.policyFreeze.enforcementEnabled,
});
const productionDevLedger = buildMachineCrossModelArbitrationLedger({
  generatedAt: argumentsValue.generatedAt,
  scope: "DEV24",
  evidence: devState.evidence,
  profiles: devState.profiles,
  profileName: shadowProfile,
  arbitrationPolicyHash: devState.policyFreeze.arbitrationPolicyHash,
  productionEnforcementEnabled: devState.policyFreeze.enforcementEnabled,
});
const mutationProposals = buildCrossModelTextMutationProposals({
  generatedAt: argumentsValue.generatedAt,
  ledgers: [productionDevLedger, holdoutLedger],
  evidenceArtifacts: [devState.evidence, holdoutEvidence],
  finalCues: packageValue.cues,
  productionEnforcementEnabled: devState.policyFreeze.enforcementEnabled,
});
const finalCues = applyCrossModelTextMutationProposals(
  packageValue.cues,
  mutationProposals,
);
const finalPackage: SubtitlePackage = subtitlePackageSchema.parse({
  ...packageValue,
  cues: finalCues,
});
const baselineTextHash = machineQualitySemanticHash(
  packageValue.cues.map((cue) => [cue.id, cue.text]),
);
const finalTextHash = machineQualitySemanticHash(
  finalPackage.cues.map((cue) => [cue.id, cue.text]),
);
const baselineTimingHash = machineQualitySemanticHash(
  packageValue.cues.map((cue) => [cue.id, cue.start, cue.end]),
);
const finalTimingHash = machineQualitySemanticHash(
  finalPackage.cues.map((cue) => [cue.id, cue.start, cue.end]),
);
const machineFreezeCore = {
  schemaVersion: "1.0.0",
  policyVersion: "c6.0.1.10-cross-model-arbitration-v1",
  generatedAt: argumentsValue.generatedAt,
  artifactType: "c6-0-1-10-machine-freeze",
  policyFreezeSemanticHash: devState.policyFreeze.semanticHash,
  holdoutSelectionSemanticHash: holdoutSelection.semanticHash,
  holdoutRuntimeSemanticHash: holdoutRuntime.semanticHash,
  evidenceSemanticHash: holdoutEvidence.semanticHash,
  holdoutLedgerSemanticHash: holdoutLedger.semanticHash,
  productionDevLedgerSemanticHash: productionDevLedger.semanticHash,
  mutationProposalsSemanticHash: mutationProposals.semanticHash,
  finalTextHash,
  finalTimingHash,
  finalFrozenBeforeGold: true,
  runtimeGoldInputCount: 0,
};
const machineFreeze = {
  ...machineFreezeCore,
  machineFreezeHash: machineQualitySemanticHash({
    ...machineFreezeCore,
    generatedAt: undefined,
  }),
};
const routeDecision = {
  schemaVersion: "1.0.0",
  policyVersion: "c6.0.1.10-cross-model-arbitration-v1",
  generatedAt: argumentsValue.generatedAt,
  artifactType: "c6-0-1-10-route-decision",
  decision: devState.policyFreeze.enforcementEnabled
    ? "PENDING_POST_GOLD_SAFETY_EVALUATION"
    : "HOLD_ARBITRATION_NOT_SAFE",
  selectedProductionProfile: devState.policyFreeze.selectedProductionProfile,
  productionEnforcementEnabled: devState.policyFreeze.enforcementEnabled,
  canonicalTextMutationCount: mutationProposals.summary.appliedCount,
  canonicalTimingMutationCount: 0,
  productionStatus: "needs-review",
  finalizationMethod: "none",
  machineOnlyReleaseAuthorized: false,
  runtimeGoldInputCount: 0,
  semanticHash: machineQualitySemanticHash({
    selectedProductionProfile: devState.policyFreeze.selectedProductionProfile,
    productionEnforcementEnabled: devState.policyFreeze.enforcementEnabled,
    canonicalTextMutationCount: mutationProposals.summary.appliedCount,
    canonicalTimingMutationCount: 0,
  }),
};
const holdoutArbitrationCore = {
  schemaVersion: "1.0.0" as const,
  policyVersion: "c6.0.1.10-cross-model-arbitration-v1" as const,
  generatedAt: argumentsValue.generatedAt,
  artifactType: "c6-0-1-10-holdout-arbitration" as const,
  policyFreezeSemanticHash: devState.policyFreeze.semanticHash,
  holdoutSelectionSemanticHash: holdoutSelection.semanticHash,
  holdoutRuntimeSemanticHash: holdoutRuntime.semanticHash,
  evidenceSemanticHash: holdoutEvidence.semanticHash,
  ledgerSemanticHash: holdoutLedger.semanticHash,
  decisionsFrozenBeforeGold: true as const,
  finalSubtitleFrozenBeforeGold: true as const,
  summary: {
    eventCount: holdoutLedger.summary.eventCount,
    lexicalDisagreementCount: holdoutEvidence.summary.lexicalDisagreementCount,
    selectReazonCount: holdoutLedger.summary.selectReazonCount,
    keepWhisperCount: holdoutLedger.summary.keepWhisperCount,
    abstainCount: holdoutLedger.summary.abstainCount,
    blockedLocalizationCount: holdoutLedger.events.filter(
      (event) => event.decision === "BLOCKED_NOT_LOCALIZABLE",
    ).length,
    blockedSpanCount: holdoutLedger.events.filter(
      (event) => event.decision === "BLOCKED_NO_SAFE_SPAN",
    ).length,
    mutationProposalCount: mutationProposals.summary.proposalCount,
    appliedMutationCount: mutationProposals.summary.appliedCount,
  },
  runtimeGoldInputCount: 0 as const,
};
const holdoutArbitration = c60110HoldoutArbitrationSchema.parse({
  ...holdoutArbitrationCore,
  semanticHash: machineQualitySemanticHash({
    ...holdoutArbitrationCore,
    generatedAt: undefined,
  }),
});
const ctcAudit = {
  schemaVersion: "1.0.0",
  policyVersion: "c6.0.1.10-cross-model-arbitration-v1",
  generatedAt: argumentsValue.generatedAt,
  artifactType: "c6-0-1-10-holdout-ctc-audit",
  role: "SUPPORT_OR_VETO_NEVER_WINNER",
  correlationPolicy: "DATA_FAMILY_CORRELATED_NOT_AN_INDEPENDENT_VOTE",
  eligibleEventCount: ctcEligibleIds.size,
  events: [...ctcEvidenceByEvent.values()],
  attempts: ctcAttempts,
  inferenceCount: ctcInferenceCount,
  modelLoadCount: ctcModelLoadCount,
  runtimeGoldInputCount: 0,
  semanticHash: machineQualitySemanticHash({
    events: [...ctcEvidenceByEvent.values()],
    inferenceCount: ctcInferenceCount,
    modelLoadCount: ctcModelLoadCount,
  }),
};
const commonMachineArtifacts = {
  ...devArtifacts,
  "c6-0-1-10-holdout-selection.json": holdoutSelection,
  "c6-0-1-10-holdout-reazon-runtime.json": holdoutRuntime,
  "machine-cross-model-arbitration-evidence.json": holdoutEvidence,
  "machine-cross-model-arbitration-ledger.json": holdoutLedger,
  "c6-0-1-10-production-dev24-ledger.json": productionDevLedger,
  "c6-0-1-10-holdout-ctc-audit.json": ctcAudit,
  "machine-cross-model-text-mutation-proposals.json": mutationProposals,
  "c6-0-1-10-holdout-arbitration.json": holdoutArbitration,
  "c6-0-1-10-machine-freeze.json": machineFreeze,
  "c6-0-1-10-route-decision.json": routeDecision,
};
await snapshot(
  argumentsValue.baseline,
  path.join(argumentsValue.outputRoot, outputNames.arbitration),
  commonMachineArtifacts,
);
await snapshot(
  argumentsValue.baseline,
  path.join(argumentsValue.outputRoot, outputNames.proposals),
  commonMachineArtifacts,
);
await snapshot(
  argumentsValue.baseline,
  path.join(argumentsValue.outputRoot, outputNames.full),
  {
    ...commonMachineArtifacts,
    "subtitle-package.json": finalPackage,
  },
);
await snapshot(
  argumentsValue.baseline,
  path.join(argumentsValue.outputRoot, outputNames.finalA),
  {
    ...commonMachineArtifacts,
    "subtitle-package.json": finalPackage,
  },
);

const frozenCache = {
  schemaVersion: "1.0.0",
  policyVersion: "c6.0.1.10-cross-model-arbitration-v1",
  generatedAt: argumentsValue.generatedAt,
  artifactType: "c6-0-1-10-frozen-exact-result-cache",
  sourceMediaSha256: SOURCE_SHA256,
  modelIdentity,
  holdoutSelection,
  holdoutRuntime,
  records: records.map((record) => ({
    request: record.request,
    result: record.result,
    cacheKey: record.cacheKey,
  })),
  readings: Object.fromEntries(readings.readingsById),
  holdoutEvidence,
  holdoutLedger,
  productionDevLedger,
  ctcAudit,
  mutationProposals,
  holdoutArbitration,
  machineFreeze,
  routeDecision,
  finalPackage,
  runtimeGoldInputCount: 0,
};
await mkdir(path.dirname(argumentsValue.cacheFile), { recursive: true });
await writeJson(argumentsValue.cacheFile, frozenCache);

// This is the first Gold filesystem read in the holdout process. It occurs
// only after selection, Reazon inference, evidence, decisions, mutation
// proposals, final candidate, final A and the machine freeze are persisted.
const goldBuffer = await readFile(argumentsValue.gold);
const goldHash = createHash("sha256").update(goldBuffer).digest("hex");
if (goldHash !== GOLD_SHA256) throw new Error("Gold identity mismatch.");
const goldCues = parseAss(
  normalizeC601GoldAssTimestamps(goldBuffer.toString("utf8")).content,
).map((cue, index) => ({
  cueId: `gold-cue-${String(index + 1).padStart(4, "0")}`,
  start: cue.start,
  end: cue.end,
  text: cue.text,
}));
const decisionByEvent = new Map(
  holdoutLedger.events.map((event) => [event.eventId, event] as const),
);
const evidenceByEvent = new Map(
  holdoutEvidence.events.map((event) => [event.eventId, event] as const),
);
const holdoutGoldEvents = localizable.map((event) => {
  const matched = goldCues.filter(
    (cue) =>
      overlapSeconds(
        {
          start: Math.max(0, event.coreInterval.start - 0.35),
          end: event.coreInterval.end + 0.35,
        },
        cue,
      ) > 0,
  );
  const goldText = matched.map((cue) => cue.text).join("");
  const bundle = evidenceByEvent.get(event.eventId);
  const decision = decisionByEvent.get(event.eventId);
  const baselinePool = [
    ...(bundle === undefined ? [] : [bundle.currentWhisperCandidate]),
    ...(bundle?.alternateWhisperCandidates ?? []),
  ];
  const baselineErrors = baselinePool.map((candidate) =>
    textError(candidate.displayText, goldText),
  );
  const baselineError =
    matched.length === 0 || baselineErrors.length === 0
      ? null
      : Math.min(...baselineErrors);
  const reazonError =
    matched.length === 0 || bundle?.reazonCoreExactCandidate === null
      ? null
      : textError(bundle?.reazonCoreExactCandidate.displayText ?? "", goldText);
  const selected = decision?.decision === "SELECT_REAZON";
  const finalError =
    baselineError === null || reazonError === null
      ? null
      : selected
        ? reazonError
        : baselineError;
  const switchOutcome =
    !selected || baselineError === null || reazonError === null
      ? ("NO_SWITCH" as const)
      : reazonError < baselineError
        ? ("CORRECT_SWITCH" as const)
        : reazonError > baselineError
          ? ("WRONG_SWITCH" as const)
          : ("NEUTRAL_SWITCH" as const);
  const core = {
    eventId: event.eventId,
    evaluationStatus:
      matched.length === 0 ? "UNEVALUABLE_NO_GOLD_OVERLAP" : "EVALUABLE_LOCAL",
    matchedGoldCueCount: matched.length,
    matchedGoldTextHash:
      matched.length === 0
        ? null
        : machineQualitySemanticHash(normalizeIndependentAsrLexical(goldText)),
    baselineWhisperPoolError: baselineError,
    reazonCoreExactError: reazonError,
    finalArbitrationError: finalError,
    arbitrationDecision: decision?.decision ?? "ABSTAIN_REVIEW",
    switchOutcome,
    oracleGain:
      baselineError === null || reazonError === null
        ? null
        : Math.max(0, baselineError - reazonError),
    realizedGain:
      baselineError === null || finalError === null
        ? null
        : baselineError - finalError,
    avoidedRegression:
      baselineError !== null &&
      reazonError !== null &&
      reazonError > baselineError &&
      !selected,
    abstentionAvoidedWrongMutation:
      decision?.decision === "ABSTAIN_REVIEW" &&
      baselineError !== null &&
      reazonError !== null &&
      reazonError > baselineError,
  };
  return { ...core, semanticHash: machineQualitySemanticHash(core) };
});
const evaluableHoldout = holdoutGoldEvents.filter(
  (event) =>
    event.baselineWhisperPoolError !== null &&
    event.reazonCoreExactError !== null,
);
const correctSwitchCount = holdoutGoldEvents.filter(
  (event) => event.switchOutcome === "CORRECT_SWITCH",
).length;
const wrongSwitchCount = holdoutGoldEvents.filter(
  (event) => event.switchOutcome === "WRONG_SWITCH",
).length;
const neutralSwitchCount = holdoutGoldEvents.filter(
  (event) => event.switchOutcome === "NEUTRAL_SWITCH",
).length;
const availableHoldoutGain = evaluableHoldout.reduce(
  (sum, event) => sum + (event.oracleGain ?? 0),
  0,
);
const realizedHoldoutGain = evaluableHoldout.reduce(
  (sum, event) => sum + (event.realizedGain ?? 0),
  0,
);
const holdoutGoldEvaluationCore = {
  schemaVersion: "1.0.0",
  policyVersion: "c6.0.1.10-cross-model-arbitration-v1",
  generatedAt: argumentsValue.generatedAt,
  artifactType: "c6-0-1-10-holdout-gold-evaluation",
  evaluationPhase: "post-final-freeze-gold-isolated",
  machineFreezeHash: machineFreeze.machineFreezeHash,
  goldIdentityHash: GOLD_SHA256,
  goldTextIncluded: false,
  events: holdoutGoldEvents,
  summary: {
    holdoutEventCount: localizable.length,
    evaluableEventCount: evaluableHoldout.length,
    evaluableSwitchCount:
      correctSwitchCount + wrongSwitchCount + neutralSwitchCount,
    correctSwitchCount,
    wrongSwitchCount,
    neutralSwitchCount,
    avoidedRegressionCount: holdoutGoldEvents.filter(
      (event) => event.avoidedRegression,
    ).length,
    abstentionUtilityCount: holdoutGoldEvents.filter(
      (event) => event.abstentionAvoidedWrongMutation,
    ).length,
    availableOracleGain: availableHoldoutGain,
    realizedArbitrationGain: realizedHoldoutGain,
  },
  runtimeGoldInputCount: 0,
};
const holdoutGoldEvaluation = {
  ...holdoutGoldEvaluationCore,
  semanticHash: machineQualitySemanticHash({
    ...holdoutGoldEvaluationCore,
    generatedAt: undefined,
  }),
};
const ctcGoldUtilityEvents = [...ctcEvidenceByEvent.values()].map((ctc) => {
  const goldEvent = holdoutGoldEvents.find(
    (event) => event.eventId === ctc.eventId,
  );
  const baselineError = goldEvent?.baselineWhisperPoolError;
  const reazonError = goldEvent?.reazonCoreExactError;
  const preferenceCorrect =
    baselineError === null ||
    baselineError === undefined ||
    reazonError === null ||
    reazonError === undefined ||
    ["CTC_AMBIGUOUS", "CTC_UNSCORABLE"].includes(ctc.outcome)
      ? null
      : ctc.outcome === "CTC_FAVORS_REAZON"
        ? reazonError < baselineError
        : baselineError < reazonError;
  const core = {
    eventId: ctc.eventId,
    outcome: ctc.outcome,
    preferenceCorrect,
    usefulContradiction:
      ctc.outcome === "CTC_FAVORS_WHISPER" && preferenceCorrect === true,
    harmfulContradiction:
      ctc.outcome === "CTC_FAVORS_WHISPER" && preferenceCorrect === false,
  };
  return { ...core, semanticHash: machineQualitySemanticHash(core) };
});
const ctcGoldUtility = {
  schemaVersion: "1.0.0",
  policyVersion: "c6.0.1.10-cross-model-arbitration-v1",
  generatedAt: argumentsValue.generatedAt,
  artifactType: "c6-0-1-10-ctc-utility-evaluation",
  evaluationPhase: "post-final-freeze-gold-isolated",
  events: ctcGoldUtilityEvents,
  summary: {
    correctSupportCount: ctcGoldUtilityEvents.filter(
      (event) => event.preferenceCorrect === true,
    ).length,
    wrongSupportCount: ctcGoldUtilityEvents.filter(
      (event) => event.preferenceCorrect === false,
    ).length,
    usefulContradictionCount: ctcGoldUtilityEvents.filter(
      (event) => event.usefulContradiction,
    ).length,
    harmfulContradictionCount: ctcGoldUtilityEvents.filter(
      (event) => event.harmfulContradiction,
    ).length,
    ambiguousOrUnscorableCount: ctcGoldUtilityEvents.filter(
      (event) => event.preferenceCorrect === null,
    ).length,
  },
  runtimeGoldInputCount: 0,
  semanticHash: machineQualitySemanticHash(ctcGoldUtilityEvents),
};
const oracleCapture = buildC60110OracleCaptureEvaluation({
  generatedAt: argumentsValue.generatedAt,
  machineFreezeHash: machineFreeze.machineFreezeHash,
  goldIdentityHash: GOLD_SHA256,
  dev24: {
    evaluableSwitchCount: 0,
    correctSwitchCount: 0,
    wrongSwitchCount: 0,
    neutralSwitchCount: 0,
    avoidedRegressionCount:
      devState.controlEvaluation.avoidedBlindRegressionCount,
    availableOracleGain: 22,
    realizedArbitrationGain: 0,
  },
  holdout: {
    evaluableSwitchCount:
      correctSwitchCount + wrongSwitchCount + neutralSwitchCount,
    correctSwitchCount,
    wrongSwitchCount,
    neutralSwitchCount,
    avoidedRegressionCount:
      holdoutGoldEvaluation.summary.avoidedRegressionCount,
    availableOracleGain: availableHoldoutGain,
    realizedArbitrationGain: realizedHoldoutGain,
  },
  wrongProviderSwitchEventIds: holdoutGoldEvents
    .filter((event) => event.switchOutcome === "WRONG_SWITCH")
    .map((event) => event.eventId),
});
await snapshot(
  argumentsValue.baseline,
  path.join(argumentsValue.outputRoot, outputNames.oracle),
  {
    ...commonMachineArtifacts,
    "c6-0-1-10-holdout-gold-evaluation.json": holdoutGoldEvaluation,
    "c6-0-1-10-ctc-utility-evaluation.json": ctcGoldUtility,
    "c6-0-1-10-oracle-capture-evaluation.json": oracleCapture,
    "subtitle-package.json": finalPackage,
  },
);

const sourceHashAfter = await sha256File(argumentsValue.source);
const goldHashAfter = await sha256File(argumentsValue.gold);
if (sourceHashAfter !== sourceHashBefore || goldHashAfter !== GOLD_SHA256) {
  throw new Error("Read-only source or Gold identity changed.");
}
await writeJson(
  path.resolve("temp/c6-0-1-10-post-gold-evaluation-state.json"),
  {
    schemaVersion: "1.0.0",
    policyVersion: "c6.0.1.10-cross-model-arbitration-v1",
    artifactType: "c6-0-1-10-post-gold-evaluation-state",
    generatedAt: argumentsValue.generatedAt,
    holdoutGoldEvaluation,
    ctcGoldUtility,
    oracleCapture,
    sourceSha256Before: sourceHashBefore,
    sourceSha256After: sourceHashAfter,
    goldSha256Before: GOLD_SHA256,
    goldSha256After: goldHashAfter,
    runtimeGoldInputCount: 0,
  },
);

process.stdout.write(
  `${JSON.stringify(
    {
      outputNames,
      holdoutSelection: holdoutSelection.summary,
      reazonRuntime: {
        modelSnapshotHash: holdoutRuntime.modelIdentity.modelSnapshotHash,
        runtimeId: holdoutRuntime.runtimeIdentity.runtimeId,
        requests: holdoutRuntime.requests,
      },
      reazonStability: {
        coreStable: holdoutEvidence.events.filter(
          (event) => event.reazonStability.class === "REAZON_CORE_STABLE",
        ).length,
        contextExtensionOnly: holdoutEvidence.events.filter(
          (event) =>
            event.reazonStability.class === "REAZON_CONTEXT_EXTENSION_ONLY",
        ).length,
        lexicalUnstable: holdoutEvidence.events.filter(
          (event) =>
            event.reazonStability.class === "REAZON_LEXICALLY_UNSTABLE",
        ).length,
        hallucinationUnstable: holdoutEvidence.events.filter(
          (event) =>
            event.reazonStability.class === "REAZON_HALLUCINATION_UNSTABLE",
        ).length,
        contextNotRun: holdoutEvidence.events.filter(
          (event) => event.reazonStability.class === "CONTEXT_NOT_RUN",
        ).length,
      },
      evidence: holdoutEvidence.summary,
      ctc: {
        eligible: ctcEligibleIds.size,
        inferenceCount: ctcInferenceCount,
        modelLoadCount: ctcModelLoadCount,
        outcomes: Object.fromEntries(
          [
            "CTC_FAVORS_WHISPER",
            "CTC_FAVORS_REAZON",
            "CTC_AMBIGUOUS",
            "CTC_UNSCORABLE",
          ].map((outcome) => [
            outcome,
            [...ctcEvidenceByEvent.values()].filter(
              (event) => event.outcome === outcome,
            ).length,
          ]),
        ),
      },
      arbitration: holdoutLedger.summary,
      mutations: mutationProposals.summary,
      hashes: {
        baselineTextHash,
        finalTextHash,
        baselineTimingHash,
        finalTimingHash,
      },
      holdoutGold: holdoutGoldEvaluation.summary,
      oracleCapture,
      ctcUtility: ctcGoldUtility.summary,
      sourceReadOnly: true,
      goldReadOnly: true,
    },
    null,
    2,
  )}\n`,
);

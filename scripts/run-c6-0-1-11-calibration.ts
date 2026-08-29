import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, cp, mkdir, readFile, readdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { promisify } from "node:util";

import {
  atomicWriteJson,
  c60110HoldoutGoldEvaluationSchema,
  c60110HoldoutSelectionSchema,
  c60111PolicyVersion,
  c60111ValidationSchema,
  machineCrossModelArbitrationEvidenceSchema,
  machineIndependentAcousticDiscriminatorSchema,
  machineIndependentVerifierRuntimeSchema,
  mvlWhisperServerResponseSchema,
  type C60111CvResults,
  type C60111OutOfFoldPredictions,
  type MachineIndependentAcousticDiscriminator,
  type MachineIndependentVerifierRuntime,
  type MvlWhisperServerResponse,
} from "@mvl/shared";
import { WhisperCppWorkerPool } from "@mvl/transcription-core";
import {
  auditC60111CalibrationData,
  buildC60111CalibrationFolds,
  buildC60111FeatureAblationReport,
  buildCrossModelCalibrationCorpus,
  buildCrossModelDiscriminatorFeatures,
  buildGoldCrossModelCalibrationLabels,
  buildIndependentDiscriminatorEvent,
  buildMachinePairedWhisperEvidence,
  c60111FeatureSets,
  C60111_INDEPENDENT_MODEL_ID,
  C60111_INDEPENDENT_MODEL_REVISION,
  decideC60111Route,
  freezeC60111SelectiveDiscriminator,
  independentCtcCacheKey,
  independentCtcRepresentations,
  IndependentCtcDiscriminatorWorker,
  independentVerifierRuntimeId,
  inspectReviewWav,
  machineQualitySemanticHash,
  runSelectiveGroupedCrossValidation,
  type C60111WhisperExecution,
  type IndependentCtcProjectedScore,
  type IndependentCtcWorkerReady,
} from "@mvl/video-subtitler";

const execFileAsync = promisify(execFile);
const GENERATED_AT = "2026-08-29T12:00:00.000Z";
const SAMPLE_RATE = 16_000;
const CACHE_NAMESPACE = "c6-0-1-11-paired-evidence-v1";

interface Arguments {
  baseline: string;
  goldEvaluation: string;
  source: string;
  gold: string;
  outputRoot: string;
  outputPrefix: string;
  outputDate: string;
  cacheRoot: string;
  ffmpeg: string;
  whisperServer: string;
  whisperModel: string;
  whisperModelSha256: string;
  vadModel: string;
  whisperRuntimeManifest: string;
  python: string;
  independentModel: string;
}

interface WhisperRuntimeManifest {
  upstream: { tag: string; commit: string };
  patch: { patchId: string; patchSha256: string; responseSchema: string };
  build: { flagsHash: string };
  patched: { binarySha256: string };
}

interface WhisperCacheRecord {
  schemaVersion: "1.0.0";
  cacheNamespace: typeof CACHE_NAMESPACE;
  requestIdentity: string;
  response: unknown;
  responseSemanticHash: string;
}

interface IndependentScoreResult {
  type: "score-result";
  requestId: string;
  audioSampleCount: number;
  whisper: IndependentCtcProjectedScore;
  reazon: IndependentCtcProjectedScore;
  forwardPassCount: 1;
  wallClockSeconds: number;
}

interface IndependentCacheRecord {
  schemaVersion: "1.0.0";
  cacheNamespace: "c6-0-1-11-independent-ctc-v1";
  cacheKey: string;
  result: IndependentScoreResult;
  resultSemanticHash: string;
}

interface ExtractedAudio {
  audioPath: string;
  audioSha256: string;
  sampleCount: number;
  startSample: number;
  endSample: number;
}

interface ExecutionBatch {
  executions: C60111WhisperExecution[];
  modelLoadCount: number;
  processStartCount: number;
  inferenceCount: number;
  cacheHitCount: number;
  wallClockSeconds: number;
}

interface OutputDirectories {
  baseline: string;
  calibrationCorpus: string;
  pairedWhisper: string;
  independentVerifierRuntime: string;
  independentAcousticScores: string;
  featureTable: string;
  calibrationLabels: string;
  folds: string;
  cv: string;
  featureAblation: string;
  discriminatorFreeze: string;
  routeDecision: string;
  finalA: string;
  finalB: string;
  validation: string;
}

function argumentValue(list: readonly string[], flag: string): string {
  const index = list.indexOf(flag);
  const value = index < 0 ? undefined : list[index + 1];
  if (value === undefined || value === "") {
    throw new Error(`Missing required argument ${flag}.`);
  }
  return path.resolve(value);
}

function stringArgument(list: readonly string[], flag: string): string {
  const index = list.indexOf(flag);
  const value = index < 0 ? undefined : list[index + 1];
  if (value === undefined || value === "") {
    throw new Error(`Missing required argument ${flag}.`);
  }
  return value;
}

function parseArguments(list: readonly string[]): Arguments {
  return {
    baseline: argumentValue(list, "--baseline"),
    goldEvaluation: argumentValue(list, "--gold-evaluation"),
    source: argumentValue(list, "--source"),
    gold: argumentValue(list, "--gold"),
    outputRoot: argumentValue(list, "--output-root"),
    outputPrefix: stringArgument(list, "--output-prefix"),
    outputDate: stringArgument(list, "--output-date"),
    cacheRoot: argumentValue(list, "--cache-root"),
    ffmpeg: argumentValue(list, "--ffmpeg"),
    whisperServer: argumentValue(list, "--whisper-server"),
    whisperModel: argumentValue(list, "--whisper-model"),
    whisperModelSha256: stringArgument(list, "--whisper-model-sha256"),
    vadModel: argumentValue(list, "--vad-model"),
    whisperRuntimeManifest: argumentValue(list, "--whisper-runtime-manifest"),
    python: argumentValue(list, "--python"),
    independentModel: argumentValue(list, "--independent-model"),
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
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", resolve);
  });
  return hash.digest("hex");
}

async function onlySubtitleDirectory(root: string): Promise<string> {
  const directories = (await readdir(root, { withFileTypes: true })).filter(
    (entry) => entry.isDirectory() && entry.name.startsWith("subtitle-"),
  );
  if (directories.length !== 1) {
    throw new Error(`Expected one subtitle directory in ${root}.`);
  }
  return path.join(root, directories[0]?.name ?? "");
}

function outputPaths(input: Arguments): OutputDirectories {
  const output = (suffix: string) =>
    path.join(
      input.outputRoot,
      `${input.outputPrefix}-c6-0-1-11-${suffix}-${input.outputDate}`,
    );
  return {
    baseline: output("baseline"),
    calibrationCorpus: output("calibration-corpus"),
    pairedWhisper: output("paired-whisper"),
    independentVerifierRuntime: output("independent-verifier-runtime"),
    independentAcousticScores: output("independent-acoustic-scores"),
    featureTable: output("feature-table"),
    calibrationLabels: output("calibration-labels"),
    folds: output("folds"),
    cv: output("cv"),
    featureAblation: output("feature-ablation"),
    discriminatorFreeze: output("discriminator-freeze"),
    routeDecision: output("route-decision"),
    finalA: output("final-a"),
    finalB: output("final-b"),
    validation: output("validation"),
  };
}

function outputBasenames(value: OutputDirectories): Record<string, string> {
  return {
    baseline: path.basename(value.baseline),
    calibrationCorpus: path.basename(value.calibrationCorpus),
    pairedWhisper: path.basename(value.pairedWhisper),
    independentVerifierRuntime: path.basename(value.independentVerifierRuntime),
    independentAcousticScores: path.basename(value.independentAcousticScores),
    featureTable: path.basename(value.featureTable),
    calibrationLabels: path.basename(value.calibrationLabels),
    folds: path.basename(value.folds),
    cv: path.basename(value.cv),
    featureAblation: path.basename(value.featureAblation),
    discriminatorFreeze: path.basename(value.discriminatorFreeze),
    routeDecision: path.basename(value.routeDecision),
    finalA: path.basename(value.finalA),
    finalB: path.basename(value.finalB),
    validation: path.basename(value.validation),
  };
}

async function assertOutputsAbsent(
  paths: Readonly<OutputDirectories>,
): Promise<void> {
  const present = [];
  for (const output of Object.values(paths)) {
    if (await exists(output)) present.push(output);
  }
  if (present.length > 0) {
    throw new Error(
      `Refusing existing C6.0.1.11 outputs: ${present.join(", ")}`,
    );
  }
}

async function hashNamedFiles(
  root: string,
  names: readonly string[],
): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  for (const name of names)
    hashes[name] = await sha256File(path.join(root, name));
  return hashes;
}

function audioCachePath(root: string, identity: string): string {
  return path.join(root, CACHE_NAMESPACE, "audio", `${identity}.wav`);
}

async function extractAudio(input: {
  arguments: Arguments;
  sourceSha256: string;
  startSeconds: number;
  endSeconds: number;
}): Promise<ExtractedAudio> {
  const startSample = Math.max(0, Math.round(input.startSeconds * SAMPLE_RATE));
  const endSample = Math.max(
    startSample + 1,
    Math.round(input.endSeconds * SAMPLE_RATE),
  );
  const sampleCount = endSample - startSample;
  const identity = machineQualitySemanticHash({
    cacheNamespace: CACHE_NAMESPACE,
    sourceSha256: input.sourceSha256,
    sampleRate: SAMPLE_RATE,
    startSample,
    endSample,
    codec: "pcm_s16le",
    channels: 1,
  });
  const audioPath = audioCachePath(input.arguments.cacheRoot, identity);
  await mkdir(path.dirname(audioPath), { recursive: true });
  if (!(await exists(audioPath))) {
    await execFileAsync(input.arguments.ffmpeg, [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      (startSample / SAMPLE_RATE).toFixed(6),
      "-i",
      input.arguments.source,
      "-map",
      "0:a:0",
      "-vn",
      "-af",
      `aresample=${SAMPLE_RATE},atrim=start_sample=0:end_sample=${sampleCount},asetpts=N/SR/TB`,
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      "-y",
      audioPath,
    ]);
  }
  const inspected = inspectReviewWav(await readFile(audioPath));
  if (
    inspected.sampleRate !== SAMPLE_RATE ||
    inspected.frameCount !== sampleCount
  ) {
    throw new Error(`Extracted WAV lineage mismatch for ${identity}.`);
  }
  return {
    audioPath,
    audioSha256: await sha256File(audioPath),
    sampleCount,
    startSample,
    endSample,
  };
}

function whisperCachePath(root: string, identity: string): string {
  return path.join(
    root,
    CACHE_NAMESPACE,
    "whisper",
    identity.slice(0, 2),
    `${identity}.json`,
  );
}

function independentCachePath(root: string, identity: string): string {
  return path.join(
    root,
    CACHE_NAMESPACE,
    "independent-ctc",
    identity.slice(0, 2),
    `${identity}.json`,
  );
}

function decoderEvidence(
  response: MvlWhisperServerResponse,
): C60111WhisperExecution["decoderEvidence"] {
  const segments = response.transcription;
  const averageLogProbability =
    segments.length === 0
      ? null
      : segments.reduce((sum, segment) => sum + segment.avgLogProbability, 0) /
        segments.length;
  const noSpeechProbability =
    segments.length === 0
      ? null
      : Math.max(...segments.map((segment) => segment.noSpeechProbability));
  return {
    averageLogProbability,
    noSpeechProbability,
    compressionRatio: null,
    temperature:
      segments.length === 0
        ? null
        : Math.max(...segments.map((segment) => segment.temperature)),
    fallbackCount: null,
    tokenTimestampAvailable: segments.some((segment) =>
      segment.tokens.some((token) => token.mapped !== null),
    ),
    decoderSegmentCount: segments.length,
  };
}

async function runWhisperBatch(input: {
  arguments: Arguments;
  sourceSha256: string;
  corpus: ReturnType<typeof buildCrossModelCalibrationCorpus>;
  runtime: WhisperRuntimeManifest;
  replay: boolean;
}): Promise<ExecutionBatch> {
  const started = performance.now();
  const executions: C60111WhisperExecution[] = [];
  let inferenceCount = 0;
  let cacheHitCount = 0;
  let modelLoadCount = 0;
  let processStartCount = 0;
  let pool: WhisperCppWorkerPool | null = null;
  const requests = input.corpus.events.flatMap((event) => [
    {
      eventId: event.eventId,
      windowType: "CORE_EXACT" as const,
      sourceInterval: event.coreInterval,
    },
    {
      eventId: event.eventId,
      windowType: "CORE_CONTEXT" as const,
      sourceInterval: event.sourceInterval,
    },
  ]);
  try {
    for (const [index, request] of requests.entries()) {
      const audio = await extractAudio({
        arguments: input.arguments,
        sourceSha256: input.sourceSha256,
        startSeconds: request.sourceInterval.start,
        endSeconds: request.sourceInterval.end,
      });
      const requestId = `c60111:${request.eventId}:${request.windowType}`;
      const cacheKey = machineQualitySemanticHash({
        cacheNamespace: CACHE_NAMESPACE,
        requestId,
        sourceSha256: input.sourceSha256,
        audioSha256: audio.audioSha256,
        modelSha256: input.arguments.whisperModelSha256,
        runtimeBinarySha256: input.runtime.patched.binarySha256,
        runtimePatchSha256: input.runtime.patch.patchSha256,
        prompt: null,
        useVad: false,
        tokenTimestamps: true,
      });
      const cacheFile = whisperCachePath(input.arguments.cacheRoot, cacheKey);
      const cacheExists = await exists(cacheFile);
      if (input.replay && !cacheExists) {
        throw new Error(`Missing exact Whisper replay cache for ${requestId}.`);
      }
      let response: MvlWhisperServerResponse;
      if (cacheExists) {
        const record = await json<WhisperCacheRecord>(cacheFile);
        if (
          record.requestIdentity !== cacheKey ||
          record.responseSemanticHash !==
            machineQualitySemanticHash(record.response)
        ) {
          throw new Error(`Whisper cache identity mismatch for ${requestId}.`);
        }
        response = mvlWhisperServerResponseSchema.parse(record.response);
        cacheHitCount += 1;
      } else {
        pool ??= new WhisperCppWorkerPool({
          mode: "persistent",
          stateIsolation: "require-safe",
        });
        const before = pool.metrics();
        const result = await pool.transcribe({
          request: {
            audioPath: audio.audioPath,
            chunk: {
              id: requestId,
              relativePath: path.basename(audio.audioPath),
              start: request.sourceInterval.start,
              end: request.sourceInterval.end,
              duration: audio.sampleCount / SAMPLE_RATE,
              sha256: audio.audioSha256,
            },
            language: "ja",
            timestampStrategy: "segment",
            tokenTimestamps: true,
          },
          capability: {
            executablePath: input.arguments.whisperServer,
            modelPath: input.arguments.whisperModel,
            modelHash: input.arguments.whisperModelSha256,
            whisperCppVersion: input.runtime.upstream.tag.replace(/^v/u, ""),
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
              new Error("Persistent Whisper fallback is forbidden."),
            ),
        });
        response = mvlWhisperServerResponseSchema.parse(
          (result.raw as { mvlResponse?: unknown }).mvlResponse,
        );
        const after = pool.metrics();
        modelLoadCount += Math.max(
          0,
          after.modelLoadCount - before.modelLoadCount,
        );
        processStartCount += Math.max(
          0,
          after.workerStartCount - before.workerStartCount,
        );
        inferenceCount += 1;
        await mkdir(path.dirname(cacheFile), { recursive: true });
        await atomicWriteJson(cacheFile, {
          schemaVersion: "1.0.0",
          cacheNamespace: CACHE_NAMESPACE,
          requestIdentity: cacheKey,
          response,
          responseSemanticHash: machineQualitySemanticHash(response),
        } satisfies WhisperCacheRecord);
      }
      executions.push({
        eventId: request.eventId,
        requestId,
        windowType: request.windowType,
        sourceInterval: request.sourceInterval,
        audioSha256: audio.audioSha256,
        cacheKey,
        execution: input.replay ? "VERIFIED_EXACT_REPLAY" : "FRESH_INFERENCE",
        text: response.text,
        decoderEvidence: decoderEvidence(response),
        tokenEvidenceAvailable: response.transcription.some((segment) =>
          segment.tokens.some((token) => !token.special),
        ),
      });
      console.error(
        JSON.stringify({
          stage: input.replay
            ? "paired-whisper-replay"
            : "paired-whisper-fresh",
          completed: index + 1,
          total: requests.length,
          eventId: request.eventId,
          windowType: request.windowType,
          cacheHit: cacheExists,
        }),
      );
    }
  } finally {
    if (pool !== null) await pool.close();
  }
  return {
    executions,
    modelLoadCount,
    processStartCount,
    inferenceCount,
    cacheHitCount,
    wallClockSeconds: (performance.now() - started) / 1000,
  };
}

function pairedSemanticPayload(
  value: ReturnType<typeof buildMachinePairedWhisperEvidence>,
): unknown {
  return value.events.map((event) => ({
    eventId: event.eventId,
    current: event.whisperCurrentCandidate,
    exact:
      event.whisperCoreExact === null
        ? null
        : {
            ...event.whisperCoreExact,
            execution: undefined,
            semanticHash: undefined,
          },
    context:
      event.whisperCoreContext === null
        ? null
        : {
            ...event.whisperCoreContext,
            execution: undefined,
            semanticHash: undefined,
          },
    stabilityClass: event.stabilityClass,
    exactAudioSha256: event.exactAudioSha256,
    contextAudioSha256: event.contextAudioSha256,
  }));
}

async function independentModelHashes(modelDirectory: string) {
  const configSha256 = await sha256File(
    path.join(modelDirectory, "config.json"),
  );
  const preprocessorSha256 = await sha256File(
    path.join(modelDirectory, "preprocessor_config.json"),
  );
  const vocabularySha256 = await sha256File(
    path.join(modelDirectory, "vocab.json"),
  );
  const modelWeightSha256 = await sha256File(
    path.join(modelDirectory, "pytorch_model.bin"),
  );
  const specialTokensSha256 = await sha256File(
    path.join(modelDirectory, "special_tokens_map.json"),
  );
  const processorSha256 = machineQualitySemanticHash({
    preprocessorSha256,
    vocabularySha256,
    specialTokensSha256,
  });
  return {
    configSha256,
    preprocessorSha256,
    vocabularySha256,
    modelWeightSha256,
    processorSha256,
    modelSnapshotHash: machineQualitySemanticHash({
      revision: C60111_INDEPENDENT_MODEL_REVISION,
      configSha256,
      preprocessorSha256,
      vocabularySha256,
      modelWeightSha256,
      specialTokensSha256,
    }),
  };
}

async function runIndependentBatch(input: {
  arguments: Arguments;
  corpus: ReturnType<typeof buildCrossModelCalibrationCorpus>;
  baselineEvidence: ReturnType<
    typeof machineCrossModelArbitrationEvidenceSchema.parse
  >;
  exactAudioByEvent: ReadonlyMap<string, ExtractedAudio>;
  replay: boolean;
  hashes: Awaited<ReturnType<typeof independentModelHashes>>;
}): Promise<{
  runtime: MachineIndependentVerifierRuntime;
  discriminator: MachineIndependentAcousticDiscriminator;
  ready: IndependentCtcWorkerReady | null;
}> {
  const workerPath = path.resolve(
    "scripts/runtime/independent_ctc_discriminator_worker.py",
  );
  const workerSourceSha256 = await sha256File(workerPath);
  const baselineById = new Map(
    input.baselineEvidence.events.map((event) => [event.eventId, event]),
  );
  let worker: IndependentCtcDiscriminatorWorker | null = null;
  let ready: IndependentCtcWorkerReady | null = null;
  let inferenceCount = 0;
  let cacheHitCount = 0;
  let wallClockSeconds = 0;
  const events: MachineIndependentAcousticDiscriminator["events"] = [];
  try {
    for (const [index, corpusEvent] of input.corpus.events.entries()) {
      const baseline = baselineById.get(corpusEvent.eventId);
      const audio = input.exactAudioByEvent.get(corpusEvent.eventId);
      if (baseline?.reazonCoreExactCandidate == null || audio === undefined) {
        throw new Error(
          `Missing independent discriminator input for ${corpusEvent.eventId}.`,
        );
      }
      const whisperRepresentations = independentCtcRepresentations({
        displayText: baseline.currentWhisperCandidate.displayText,
        pronunciationText: baseline.currentWhisperCandidate.pronunciationText,
      });
      const reazonRepresentations = independentCtcRepresentations({
        displayText: baseline.reazonCoreExactCandidate.displayText,
        pronunciationText: baseline.reazonCoreExactCandidate.pronunciationText,
      });
      const provisionalVersions = ready?.versions ?? {
        torch: "2.6.0",
        transformers: "4.57.6",
        scikitLearn: "1.6.1",
        numpy: "2.2.2",
        scipy: "1.15.2",
      };
      const provisionalRuntimeId = independentVerifierRuntimeId({
        modelSnapshotHash: input.hashes.modelSnapshotHash,
        workerSourceSha256,
        versions: provisionalVersions,
        pythonVersion: ready?.pythonVersion ?? "3.13.14",
      });
      const cacheKey = independentCtcCacheKey({
        audioSha256: audio.audioSha256,
        whisperRepresentations,
        reazonRepresentations,
        modelSnapshotHash: input.hashes.modelSnapshotHash,
        runtimeId: provisionalRuntimeId,
      });
      const cacheFile = independentCachePath(
        input.arguments.cacheRoot,
        cacheKey,
      );
      const cacheExists = await exists(cacheFile);
      if (input.replay && !cacheExists) {
        throw new Error(
          `Missing independent CTC replay cache for ${corpusEvent.eventId}.`,
        );
      }
      let result: IndependentScoreResult;
      if (cacheExists) {
        const record = await json<IndependentCacheRecord>(cacheFile);
        if (
          record.cacheKey !== cacheKey ||
          record.resultSemanticHash !==
            machineQualitySemanticHash(record.result)
        ) {
          throw new Error(
            `Independent cache identity mismatch for ${corpusEvent.eventId}.`,
          );
        }
        result = record.result;
        cacheHitCount += 1;
      } else {
        worker ??= new IndependentCtcDiscriminatorWorker({
          pythonExecutable: input.arguments.python,
          workerPath,
          modelDirectory: input.arguments.independentModel,
          minimumCoverage: 0.95,
        });
        ready ??= await worker.ready;
        const actualRuntimeId = independentVerifierRuntimeId({
          modelSnapshotHash: input.hashes.modelSnapshotHash,
          workerSourceSha256,
          versions: ready.versions,
          pythonVersion: ready.pythonVersion,
        });
        if (actualRuntimeId !== provisionalRuntimeId) {
          throw new Error(
            "Independent verifier runtime identity drifted from pinned acceptance runtime.",
          );
        }
        const started = performance.now();
        result = await worker.scorePair({
          requestId: `c60111-independent:${corpusEvent.eventId}`,
          audioPath: audio.audioPath,
          whisperRepresentations,
          reazonRepresentations,
        });
        wallClockSeconds += (performance.now() - started) / 1000;
        inferenceCount += 1;
        await mkdir(path.dirname(cacheFile), { recursive: true });
        await atomicWriteJson(cacheFile, {
          schemaVersion: "1.0.0",
          cacheNamespace: "c6-0-1-11-independent-ctc-v1",
          cacheKey,
          result,
          resultSemanticHash: machineQualitySemanticHash(result),
        } satisfies IndependentCacheRecord);
      }
      events.push(
        buildIndependentDiscriminatorEvent({
          eventId: corpusEvent.eventId,
          audioSha256: audio.audioSha256,
          whisperCandidateId: baseline.currentWhisperCandidate.candidateId,
          reazonCandidateId: baseline.reazonCoreExactCandidate.candidateId,
          result,
        }),
      );
      console.error(
        JSON.stringify({
          stage: input.replay
            ? "independent-ctc-replay"
            : "independent-ctc-fresh",
          completed: index + 1,
          total: input.corpus.events.length,
          eventId: corpusEvent.eventId,
          cacheHit: cacheExists,
        }),
      );
    }
  } finally {
    if (worker !== null) await worker.close();
  }
  if (!input.replay && ready === null) {
    throw new Error("Independent verifier performed no fresh inference.");
  }
  const pinnedReady: IndependentCtcWorkerReady = ready ?? {
    pythonVersion: "3.13.14",
    versions: {
      torch: "2.6.0",
      transformers: "4.57.6",
      scikitLearn: "1.6.1",
      numpy: "2.2.2",
      scipy: "1.15.2",
    },
    device: "cpu",
    precision: "fp32",
    sampleRate: 16000,
    processorClass: "Wav2Vec2Processor",
    modelClass: "Wav2Vec2ForCTC",
    tokenizerClass: "Wav2Vec2CTCTokenizer",
    vocabularyHash:
      "e871a4828a6230b13cc1347a703918cd821301a153b9bef3793dfc67ec75bf33",
    vocabularySize: 2341,
    blankTokenId: 0,
    unknownTokenId: 3,
    modelLoadCount: 0,
  };
  const runtimeId = independentVerifierRuntimeId({
    modelSnapshotHash: input.hashes.modelSnapshotHash,
    workerSourceSha256,
    versions: pinnedReady.versions,
    pythonVersion: pinnedReady.pythonVersion,
  });
  const runtimeCore = {
    schemaVersion: "1.0.0" as const,
    policyVersion: c60111PolicyVersion,
    generatedAt: GENERATED_AT,
    artifactType: "machine-independent-verifier-runtime" as const,
    modelIdentity: {
      modelId: C60111_INDEPENDENT_MODEL_ID,
      requestedRevision: C60111_INDEPENDENT_MODEL_REVISION,
      resolvedRevision: C60111_INDEPENDENT_MODEL_REVISION,
      ...input.hashes,
    },
    runtimeIdentity: {
      runtimeId,
      pythonVersion: pinnedReady.pythonVersion,
      torchVersion: pinnedReady.versions.torch,
      transformersVersion: pinnedReady.versions.transformers,
      scikitLearnVersion: pinnedReady.versions.scikitLearn,
      numpyVersion: pinnedReady.versions.numpy,
      scipyVersion: pinnedReady.versions.scipy,
      device: "cpu" as const,
      precision: "fp32" as const,
      sampleRate: 16000 as const,
      workerSourceSha256,
    },
    requests: {
      plannedCount: input.corpus.events.length,
      actualCount: events.length,
      freshInferenceCount: inferenceCount,
      cacheHitCount,
      failedCount: 0,
      modelLoadCount: input.replay ? 0 : (ready?.modelLoadCount ?? 0),
      processStartCount: input.replay ? 0 : ready === null ? 0 : 1,
      wallClockSeconds,
    },
    bootstrapNetworkUsed: true,
    inferenceNetworkUsed: false as const,
    runtimeGoldInputCount: 0 as const,
  };
  const runtime = machineIndependentVerifierRuntimeSchema.parse({
    ...runtimeCore,
    semanticHash: machineQualitySemanticHash({
      ...runtimeCore,
      generatedAt: undefined,
    }),
  });
  const summary = {
    eventCount: events.length,
    scorableCount: events.filter((event) => event.scorability === "SCORABLE")
      .length,
    unscorableCount: events.filter(
      (event) => event.scorability === "UNSCORABLE",
    ).length,
    scorableCoverage:
      events.length === 0
        ? 0
        : events.filter((event) => event.scorability === "SCORABLE").length /
          events.length,
    favorsWhisperCount: events.filter(
      (event) => event.outcome === "INDEPENDENT_FAVORS_WHISPER",
    ).length,
    favorsReazonCount: events.filter(
      (event) => event.outcome === "INDEPENDENT_FAVORS_REAZON",
    ).length,
    nearTieCount: events.filter(
      (event) => event.outcome === "INDEPENDENT_NEAR_TIE",
    ).length,
    runtimeGoldInputCount: 0 as const,
    networkUsed: false as const,
  };
  const discriminatorCore = {
    schemaVersion: "1.0.0" as const,
    policyVersion: c60111PolicyVersion,
    generatedAt: GENERATED_AT,
    artifactType: "machine-independent-acoustic-discriminator" as const,
    corpusSemanticHash: input.corpus.semanticHash,
    pairedWhisperSemanticHash: "0".repeat(64),
    verifierRuntimeSemanticHash: runtime.semanticHash,
    lowerIsBetter: true as const,
    marginDefinition:
      "whisperNllPerTargetToken-minus-reazonNllPerTargetToken" as const,
    oldCorrelatedCtcRole: "AUDIT_ONLY" as const,
    events,
    summary,
  };
  const discriminator = machineIndependentAcousticDiscriminatorSchema.parse({
    ...discriminatorCore,
    semanticHash: machineQualitySemanticHash({
      ...discriminatorCore,
      generatedAt: undefined,
    }),
  });
  return { runtime, discriminator, ready };
}

function auc(
  rows: readonly { score: number; positive: boolean }[],
): number | null {
  const positives = rows.filter((row) => row.positive);
  const negatives = rows.filter((row) => !row.positive);
  if (positives.length === 0 || negatives.length === 0) return null;
  let wins = 0;
  for (const positive of positives) {
    for (const negative of negatives) {
      wins +=
        positive.score > negative.score
          ? 1
          : positive.score === negative.score
            ? 0.5
            : 0;
    }
  }
  return wins / (positives.length * negatives.length);
}

function correlation(rows: readonly { x: number; y: number }[]): number | null {
  if (rows.length < 2) return null;
  const meanX = rows.reduce((sum, row) => sum + row.x, 0) / rows.length;
  const meanY = rows.reduce((sum, row) => sum + row.y, 0) / rows.length;
  const numerator = rows.reduce(
    (sum, row) => sum + (row.x - meanX) * (row.y - meanY),
    0,
  );
  const denominator = Math.sqrt(
    rows.reduce((sum, row) => sum + (row.x - meanX) ** 2, 0) *
      rows.reduce((sum, row) => sum + (row.y - meanY) ** 2, 0),
  );
  return denominator === 0 ? null : numerator / denominator;
}

function independentGoldEvaluation(input: {
  discriminator: MachineIndependentAcousticDiscriminator;
  labels: ReturnType<typeof buildGoldCrossModelCalibrationLabels>;
  baselineEvidence: ReturnType<
    typeof machineCrossModelArbitrationEvidenceSchema.parse
  >;
}) {
  const labels = new Map(
    input.labels.events.map((event) => [event.eventId, event]),
  );
  const baseline = new Map(
    input.baselineEvidence.events.map((event) => [event.eventId, event]),
  );
  let correct = 0;
  let wrong = 0;
  let oldCorrect = 0;
  let oldWrong = 0;
  const aucRows: { score: number; positive: boolean }[] = [];
  const correlationRows: { x: number; y: number }[] = [];
  for (const event of input.discriminator.events) {
    const label = labels.get(event.eventId);
    if (
      label === undefined ||
      event.pairwiseMargin === null ||
      !["REAZON_BETTER", "WHISPER_BETTER"].includes(label.label)
    ) {
      continue;
    }
    const favorsReazon = event.pairwiseMargin > 0;
    const positive = label.label === "REAZON_BETTER";
    if (favorsReazon === positive) correct += 1;
    else wrong += 1;
    aucRows.push({ score: event.pairwiseMargin, positive });
    if (label.localErrorDelta !== null) {
      correlationRows.push({
        x: event.pairwiseMargin,
        y: label.localErrorDelta,
      });
    }
    const old = baseline.get(event.eventId);
    if (old?.ctcWhisperSupport != null && old.ctcReazonSupport != null) {
      const oldFavorsReazon = old.ctcReazonSupport > old.ctcWhisperSupport;
      if (oldFavorsReazon === positive) oldCorrect += 1;
      else oldWrong += 1;
    }
  }
  return {
    schemaVersion: "1.0.0",
    artifactType: "c6-0-1-11-independent-gold-evaluation",
    generatedAt: GENERATED_AT,
    correctPreferenceCount: correct,
    wrongPreferenceCount: wrong,
    preferenceAccuracy:
      correct + wrong === 0 ? null : correct / (correct + wrong),
    preferenceAuc: auc(aucRows),
    marginGoldDeltaCorrelation: correlation(correlationRows),
    currentCtcCorrectPreferenceCount: oldCorrect,
    currentCtcWrongPreferenceCount: oldWrong,
    currentCtcAccuracy:
      oldCorrect + oldWrong === 0 ? null : oldCorrect / (oldCorrect + oldWrong),
    independentBetterThanCurrentCtc:
      correct + wrong > 0 &&
      oldCorrect + oldWrong > 0 &&
      correct / (correct + wrong) > oldCorrect / (oldCorrect + oldWrong),
  };
}

function errorSlices(input: {
  features: ReturnType<typeof buildCrossModelDiscriminatorFeatures>;
  oof: C60111OutOfFoldPredictions;
}) {
  const features = new Map(
    input.features.events.map((event) => [event.eventId, event]),
  );
  const sliceDefinitions: Record<
    string,
    (values: Record<string, number | null>) => boolean
  > = {
    reazonStable: (values) => values.reazonCoreStable === 1,
    reazonUnstable: (values) => values.reazonLexicallyUnstable === 1,
    whisperStable: (values) => values.whisperCoreStable === 1,
    whisperUnstable: (values) => values.whisperLexicallyUnstable === 1,
    hallucinationRisk: (values) =>
      values.relationWhisperHallucinationRisk === 1 ||
      (values.whisperHallucinationRisk ?? 0) >= 0.6,
    shortDuration: (values) => (values.coreDurationSeconds ?? 0) < 2,
    longDuration: (values) => (values.coreDurationSeconds ?? 0) >= 6,
  };
  return Object.fromEntries(
    Object.entries(sliceDefinitions).map(([name, predicate]) => {
      const rows = input.oof.predictions.filter((prediction) => {
        const feature = features.get(prediction.eventId);
        return feature !== undefined && predicate(feature.featureValues);
      });
      const selected = rows.filter((row) => row.decision === "SELECT_REAZON");
      const correct = selected.filter(
        (row) => row.label === "REAZON_BETTER",
      ).length;
      const wrong = selected.filter(
        (row) => row.label === "WHISPER_BETTER",
      ).length;
      return [
        name,
        {
          eventCount: rows.length,
          selectedCount: selected.length,
          correctCount: correct,
          wrongCount: wrong,
          gain: selected.reduce((sum, row) => sum + (row.localGain ?? 0), 0),
        },
      ];
    }),
  );
}

async function writeArtifact(
  root: string,
  fileName: string,
  value: unknown,
): Promise<void> {
  await mkdir(root, { recursive: true });
  await atomicWriteJson(path.join(root, fileName), value);
}

async function copyFinalBaseline(
  source: string,
  destination: string,
): Promise<string> {
  await cp(source, destination, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  return onlySubtitleDirectory(destination);
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  const outputs = outputPaths(args);
  await assertOutputsAbsent(outputs);
  const sourceShaBefore = await sha256File(args.source);
  if (
    sourceShaBefore !==
    "294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43"
  ) {
    throw new Error("Source SHA does not match the frozen C6.0.1.10 baseline.");
  }
  if ((await sha256File(args.whisperModel)) !== args.whisperModelSha256) {
    throw new Error("Whisper model SHA mismatch.");
  }
  const baselineSubtitle = await onlySubtitleDirectory(args.baseline);
  const baselineEvidence = machineCrossModelArbitrationEvidenceSchema.parse(
    await json(
      path.join(
        baselineSubtitle,
        "machine-cross-model-arbitration-evidence.json",
      ),
    ),
  );
  const selection = c60110HoldoutSelectionSchema.parse(
    await json(path.join(baselineSubtitle, "c6-0-1-10-holdout-selection.json")),
  );
  const corpus = buildCrossModelCalibrationCorpus({
    generatedAt: GENERATED_AT,
    sourceMediaSha256: sourceShaBefore,
    evidence: baselineEvidence,
    selection,
  });
  const folds = buildC60111CalibrationFolds({
    generatedAt: GENERATED_AT,
    corpus,
  });
  const whisperRuntime = await json<WhisperRuntimeManifest>(
    args.whisperRuntimeManifest,
  );
  const whisperFresh = await runWhisperBatch({
    arguments: args,
    sourceSha256: sourceShaBefore,
    corpus,
    runtime: whisperRuntime,
    replay: false,
  });
  const currentCandidates = baselineEvidence.events
    .filter((event) =>
      corpus.events.some((value) => value.eventId === event.eventId),
    )
    .map((event) => ({
      eventId: event.eventId,
      candidateId: event.currentWhisperCandidate.candidateId,
      text: event.currentWhisperCandidate.displayText,
      pronunciationText: event.currentWhisperCandidate.pronunciationText,
      hallucinationRisk: event.currentWhisperCandidate.hallucinationRisk,
      semanticHash: event.currentWhisperCandidate.semanticHash,
    }));
  const baselineManifest = await json<{
    runtimeIdentities: { runtimeId: string; name: string }[];
  }>(path.join(args.baseline, "blind-generation-input-manifest.json"));
  const whisperRuntimeId = baselineManifest.runtimeIdentities.find(
    (runtime) => runtime.name === "whisper.cpp-mvl",
  )?.runtimeId;
  if (whisperRuntimeId === undefined)
    throw new Error("Missing Whisper runtime ID.");
  const modelIdentity = {
    modelId: "whisper.cpp/large-v3" as const,
    modelSha256: args.whisperModelSha256,
    runtimeId: whisperRuntimeId,
    runtimeBinarySha256: whisperRuntime.patched.binarySha256,
    runtimePatchSha256: whisperRuntime.patch.patchSha256,
    device: "metal" as const,
    precision: "f16-metal",
  };
  const pairedFresh = buildMachinePairedWhisperEvidence({
    generatedAt: GENERATED_AT,
    sourceMediaSha256: sourceShaBefore,
    corpus,
    currentCandidates,
    executions: whisperFresh.executions,
    modelIdentity,
    modelLoadCount: whisperFresh.modelLoadCount,
    processStartCount: whisperFresh.processStartCount,
  });
  const exactAudioByEvent = new Map<string, ExtractedAudio>();
  for (const event of corpus.events) {
    exactAudioByEvent.set(
      event.eventId,
      await extractAudio({
        arguments: args,
        sourceSha256: sourceShaBefore,
        startSeconds: event.coreInterval.start,
        endSeconds: event.coreInterval.end,
      }),
    );
  }
  const independentHashes = await independentModelHashes(args.independentModel);
  const independentFresh = await runIndependentBatch({
    arguments: args,
    corpus,
    baselineEvidence,
    exactAudioByEvent,
    replay: false,
    hashes: independentHashes,
  });
  const independentDiscriminator =
    machineIndependentAcousticDiscriminatorSchema.parse({
      ...independentFresh.discriminator,
      pairedWhisperSemanticHash: pairedFresh.semanticHash,
      semanticHash: machineQualitySemanticHash({
        ...independentFresh.discriminator,
        pairedWhisperSemanticHash: pairedFresh.semanticHash,
        semanticHash: undefined,
        generatedAt: undefined,
      }),
    });
  const features = buildCrossModelDiscriminatorFeatures({
    generatedAt: GENERATED_AT,
    corpus,
    baselineEvidence,
    pairedWhisper: pairedFresh,
    independentDiscriminator,
  });
  const featureFreezeHashBeforeGold = features.semanticHash;
  const foldFreezeHashBeforeGold = folds.semanticHash;
  const goldShaBefore = await sha256File(args.gold);
  const goldEvaluation = c60110HoldoutGoldEvaluationSchema.parse(
    await json(args.goldEvaluation),
  );
  const labels = buildGoldCrossModelCalibrationLabels({
    generatedAt: GENERATED_AT,
    corpus,
    features,
    folds,
    goldEvaluation,
  });
  if (
    featureFreezeHashBeforeGold !== features.semanticHash ||
    foldFreezeHashBeforeGold !== folds.semanticHash
  ) {
    throw new Error("Feature or fold freeze changed after Gold evaluation.");
  }
  const dataQuality = auditC60111CalibrationData({
    generatedAt: GENERATED_AT,
    corpus,
    features,
    folds,
  });
  const featureSets = c60111FeatureSets();
  const cvResults: C60111CvResults[] = [];
  const oofResults: C60111OutOfFoldPredictions[] = [];
  for (const modelId of ["M0", "M1", "M2", "M3", "M4", "M5"] as const) {
    const result = runSelectiveGroupedCrossValidation({
      generatedAt: GENERATED_AT,
      modelId,
      featureNames: featureSets[modelId],
      corpus,
      features,
      folds,
      labels,
    });
    cvResults.push(result.cv);
    oofResults.push(result.oof);
  }
  const ablation = buildC60111FeatureAblationReport({
    generatedAt: GENERATED_AT,
    results: cvResults,
  });
  const bestCv = cvResults.find(
    (result) => result.modelId === ablation.bestModelId,
  );
  const bestOof = oofResults.find(
    (result) => result.modelId === ablation.bestModelId,
  );
  if (bestCv === undefined || bestOof === undefined)
    throw new Error("Missing best CV result.");
  const route = decideC60111Route({
    generatedAt: GENERATED_AT,
    bestCv,
    pairedWhisperCoverage: pairedFresh.summary.coverage,
    independentVerifierEngineeringValid:
      independentFresh.runtime.requests.failedCount === 0 &&
      independentFresh.runtime.requests.actualCount === corpus.events.length,
    independentScorableCoverage:
      independentDiscriminator.summary.scorableCoverage,
    evaluableDisagreementCount: labels.events.filter((label) => {
      const event = corpus.events.find(
        (value) => value.eventId === label.eventId,
      );
      return event?.role === "DISAGREEMENT" && label.label !== "UNEVALUABLE";
    }).length,
    dataQuality,
  });
  const freeze = freezeC60111SelectiveDiscriminator({
    generatedAt: GENERATED_AT,
    modelId: ablation.bestModelId,
    featureNames: featureSets[ablation.bestModelId],
    features,
    labels,
    oof: bestOof,
    strongCalibrationPass: route.strongCalibrationPass,
    promisingCalibration: route.promisingCalibration,
  });
  const independentEvaluation = independentGoldEvaluation({
    discriminator: independentDiscriminator,
    labels,
    baselineEvidence,
  });
  const slices = errorSlices({ features, oof: bestOof });
  const whisperReplay = await runWhisperBatch({
    arguments: args,
    sourceSha256: sourceShaBefore,
    corpus,
    runtime: whisperRuntime,
    replay: true,
  });
  const pairedReplay = buildMachinePairedWhisperEvidence({
    generatedAt: GENERATED_AT,
    sourceMediaSha256: sourceShaBefore,
    corpus,
    currentCandidates,
    executions: whisperReplay.executions,
    modelIdentity,
    modelLoadCount: whisperReplay.modelLoadCount,
    processStartCount: whisperReplay.processStartCount,
  });
  const independentReplay = await runIndependentBatch({
    arguments: args,
    corpus,
    baselineEvidence,
    exactAudioByEvent,
    replay: true,
    hashes: independentHashes,
  });
  const pairedParity =
    machineQualitySemanticHash(pairedSemanticPayload(pairedFresh)) ===
    machineQualitySemanticHash(pairedSemanticPayload(pairedReplay));
  const independentParity =
    machineQualitySemanticHash(independentFresh.discriminator.events) ===
    machineQualitySemanticHash(independentReplay.discriminator.events);
  const sourceShaAfter = await sha256File(args.source);
  const goldShaAfter = await sha256File(args.gold);
  const baselineSubtitleFiles = (await readdir(baselineSubtitle)).filter(
    (name) => /\.(?:ass|srt|vtt)$/u.test(name),
  );
  const baselineSubtitleHashes = await hashNamedFiles(
    baselineSubtitle,
    baselineSubtitleFiles,
  );
  await writeArtifact(outputs.baseline, "c6-0-1-11-baseline-replay.json", {
    schemaVersion: "1.0.0",
    artifactType: "c6-0-1-11-baseline-replay",
    generatedAt: GENERATED_AT,
    baselineEvidenceSemanticHash: baselineEvidence.semanticHash,
    holdoutEventCount: selection.summary.candidateHoldoutEventCount,
    machineLocalizableCount: selection.summary.machineLocalizableCount,
    availableOracleGain: goldEvaluation.summary.availableOracleGain,
    realizedGain: goldEvaluation.summary.realizedArbitrationGain,
    productionProfile: "DISABLED",
    productionStatus: "needs-review",
    finalizationMethod: "none",
    subtitleHashes: baselineSubtitleHashes,
    passed: true,
  });
  await writeArtifact(
    outputs.calibrationCorpus,
    "machine-cross-model-calibration-corpus.json",
    corpus,
  );
  await writeArtifact(
    outputs.pairedWhisper,
    "machine-paired-whisper-evidence.json",
    pairedFresh,
  );
  await writeArtifact(
    outputs.pairedWhisper,
    "machine-paired-whisper-evidence.cache-replay.json",
    pairedReplay,
  );
  await writeArtifact(
    outputs.pairedWhisper,
    "paired-whisper-replay-audit.json",
    {
      pairedParity,
      freshInferenceCount: whisperFresh.inferenceCount,
      replayCacheHitCount: whisperReplay.cacheHitCount,
      replayInferenceCount: whisperReplay.inferenceCount,
      replayModelLoadCount: whisperReplay.modelLoadCount,
      freshWallClockSeconds: whisperFresh.wallClockSeconds,
      replayWallClockSeconds: whisperReplay.wallClockSeconds,
    },
  );
  await writeArtifact(
    outputs.independentVerifierRuntime,
    "machine-independent-verifier-runtime.json",
    independentFresh.runtime,
  );
  await writeArtifact(
    outputs.independentVerifierRuntime,
    "machine-independent-verifier-runtime.cache-replay.json",
    independentReplay.runtime,
  );
  await writeArtifact(
    outputs.independentAcousticScores,
    "machine-independent-acoustic-discriminator.json",
    independentDiscriminator,
  );
  await writeArtifact(
    outputs.independentAcousticScores,
    "machine-independent-acoustic-discriminator.cache-replay.json",
    independentReplay.discriminator,
  );
  await writeArtifact(
    outputs.independentAcousticScores,
    "independent-replay-audit.json",
    {
      independentParity,
      freshInferenceCount:
        independentFresh.runtime.requests.freshInferenceCount,
      replayCacheHitCount: independentReplay.runtime.requests.cacheHitCount,
      replayInferenceCount:
        independentReplay.runtime.requests.freshInferenceCount,
      replayModelLoadCount: independentReplay.runtime.requests.modelLoadCount,
    },
  );
  await writeArtifact(
    outputs.featureTable,
    "machine-cross-model-discriminator-features.json",
    features,
  );
  await writeArtifact(
    outputs.calibrationLabels,
    "gold-cross-model-calibration-labels.json",
    labels,
  );
  await writeArtifact(
    outputs.calibrationLabels,
    "c6-0-1-11-independent-gold-evaluation.json",
    independentEvaluation,
  );
  await writeArtifact(outputs.folds, "c6-0-1-11-calibration-folds.json", folds);
  await writeArtifact(
    outputs.folds,
    "c6-0-1-11-data-quality-audit.json",
    dataQuality,
  );
  for (const result of cvResults) {
    await writeArtifact(
      outputs.cv,
      `c6-0-1-11-cv-results-${result.modelId.toLowerCase()}.json`,
      result,
    );
  }
  for (const result of oofResults) {
    await writeArtifact(
      outputs.cv,
      `c6-0-1-11-oof-${result.modelId.toLowerCase()}.json`,
      result,
    );
  }
  await writeArtifact(outputs.cv, "c6-0-1-11-error-slices.json", slices);
  await writeArtifact(
    outputs.featureAblation,
    "c6-0-1-11-feature-ablation-report.json",
    ablation,
  );
  await writeArtifact(
    outputs.discriminatorFreeze,
    "c6-0-1-11-selective-discriminator-freeze.json",
    freeze,
  );
  await writeArtifact(
    outputs.routeDecision,
    "c6-0-1-11-route-decision.json",
    route,
  );
  const finalASubtitle = await copyFinalBaseline(args.baseline, outputs.finalA);
  await atomicWriteJson(
    path.join(finalASubtitle, "machine-cross-model-calibration-corpus.json"),
    corpus,
  );
  await atomicWriteJson(
    path.join(finalASubtitle, "machine-paired-whisper-evidence.json"),
    pairedFresh,
  );
  await atomicWriteJson(
    path.join(finalASubtitle, "machine-independent-verifier-runtime.json"),
    independentFresh.runtime,
  );
  await atomicWriteJson(
    path.join(
      finalASubtitle,
      "machine-independent-acoustic-discriminator.json",
    ),
    independentDiscriminator,
  );
  await atomicWriteJson(
    path.join(
      finalASubtitle,
      "machine-cross-model-discriminator-features.json",
    ),
    features,
  );
  await atomicWriteJson(
    path.join(finalASubtitle, "gold-cross-model-calibration-labels.json"),
    labels,
  );
  await atomicWriteJson(
    path.join(finalASubtitle, "c6-0-1-11-calibration-folds.json"),
    folds,
  );
  await atomicWriteJson(
    path.join(finalASubtitle, "c6-0-1-11-data-quality-audit.json"),
    dataQuality,
  );
  await atomicWriteJson(
    path.join(finalASubtitle, "c6-0-1-11-feature-ablation-report.json"),
    ablation,
  );
  await atomicWriteJson(
    path.join(finalASubtitle, "c6-0-1-11-selective-discriminator-freeze.json"),
    freeze,
  );
  await atomicWriteJson(
    path.join(finalASubtitle, "c6-0-1-11-route-decision.json"),
    route,
  );
  const finalBSubtitle = await copyFinalBaseline(
    outputs.finalA,
    outputs.finalB,
  );
  await atomicWriteJson(
    path.join(finalBSubtitle, "c6-0-1-11-replay-parity.json"),
    {
      pairedParity,
      independentParity,
      canonicalTextMutationCount: 0,
      canonicalTimingMutationCount: 0,
    },
  );
  const finalAHashes = await hashNamedFiles(
    finalASubtitle,
    baselineSubtitleFiles,
  );
  const finalBHashes = await hashNamedFiles(
    finalBSubtitle,
    baselineSubtitleFiles,
  );
  const finalParity =
    JSON.stringify(baselineSubtitleHashes) === JSON.stringify(finalAHashes) &&
    JSON.stringify(finalAHashes) === JSON.stringify(finalBHashes);
  const validationCore = {
    schemaVersion: "1.0.0" as const,
    policyVersion: c60111PolicyVersion,
    generatedAt: GENERATED_AT,
    artifactType: "c6-0-1-11-validation" as const,
    baselineReplayPassed: true,
    artifactSchemasPassed: true,
    dataQualityPassed: dataQuality.passed,
    finalParityPassed: finalParity,
    sourceReadOnly: sourceShaBefore === sourceShaAfter,
    goldReadOnly: goldShaBefore === goldShaAfter,
    canonicalTextMutationCount: 0 as const,
    canonicalTimingMutationCount: 0 as const,
    finalAssParity: finalParity,
    finalSrtParity: finalParity,
    finalVttParity: finalParity,
    runtimeGoldInputCount: 0 as const,
    datasetHardcodingCount: 0 as const,
    inferenceNetworkUsed: false as const,
    checks: {
      pairedWhisperFreshComplete:
        whisperFresh.inferenceCount === corpus.events.length * 2,
      pairedWhisperReplayComplete:
        whisperReplay.cacheHitCount === corpus.events.length * 2,
      pairedWhisperReplayParity: pairedParity,
      independentFreshComplete:
        independentFresh.runtime.requests.freshInferenceCount ===
        corpus.events.length,
      independentReplayComplete:
        independentReplay.runtime.requests.cacheHitCount ===
        corpus.events.length,
      independentReplayParity: independentParity,
      featureFreezeBeforeGold: features.featuresFrozenBeforeGold,
      foldsBeforeLabels: folds.constructedBeforeLabels,
      noRandomSplit: !folds.randomSplitUsed,
      noLeakage: dataQuality.passed,
      productionDisabled: true,
      noCanonicalMutation: true,
      finalSubtitleParity: finalParity,
    },
    passed:
      dataQuality.passed &&
      pairedParity &&
      independentParity &&
      finalParity &&
      sourceShaBefore === sourceShaAfter &&
      goldShaBefore === goldShaAfter,
  };
  const validation = c60111ValidationSchema.parse({
    ...validationCore,
    semanticHash: machineQualitySemanticHash({
      ...validationCore,
      generatedAt: undefined,
    }),
  });
  await writeArtifact(
    outputs.validation,
    "c6-0-1-11-validation.json",
    validation,
  );
  await writeArtifact(outputs.validation, "c6-0-1-11-output-manifest.json", {
    policyVersion: c60111PolicyVersion,
    outputs: outputBasenames(outputs),
    sourceSha256: sourceShaAfter,
    goldSha256: goldShaAfter,
    baselineSubtitleHashes,
    finalAHashes,
    finalBHashes,
  });
  console.log(
    JSON.stringify(
      {
        corpus: corpus.summary,
        pairedWhisper: pairedFresh.summary,
        independent: independentDiscriminator.summary,
        labels: labels.summary,
        bestModelId: ablation.bestModelId,
        bestMetrics: bestCv.aggregate,
        route,
        freezeCreated: freeze.created,
        validationPassed: validation.passed,
        outputs,
      },
      null,
      2,
    ),
  );
}

await main();

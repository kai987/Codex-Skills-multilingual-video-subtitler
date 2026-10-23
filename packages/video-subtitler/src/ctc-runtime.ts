import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  InputError,
  ctcAlignmentAttemptSchema,
  ctcModelManifestSchema,
  ctcRuntimeCapabilitySchema,
  ctcRuntimeManifestSchema,
  type CtcAlignmentAttempt,
  type CtcDevice,
  type CtcDeviceUsed,
  type CtcModelManifest,
  type CtcRuntimeCapability,
  type CtcRuntimeManifest,
  type CtcTargetEncoding,
} from "@mvl/shared";

import {
  CTC_FRAME_MAPPING_POLICY,
  CTC_VITERBI_POLICY,
} from "./ctc-alignment.js";
import { sha256Value } from "./finalization-support.js";
import { inspectReviewWav } from "./review-audio.js";

export const CTC_MODEL_REPO =
  "reazon-research/japanese-wav2vec2-large-rs35kh" as const;
export const CTC_MODEL_REVISION =
  "2162c9edb97f362f7623d6b3a2e417458e879bca" as const;
export const CTC_MODEL_LICENSE = "Apache-2.0" as const;
export const SEPARATION_MODEL_REPO = "speechbrain/sepformer-whamr16k" as const;
export const SEPARATION_MODEL_REVISION =
  "21a5b500c6f52fddc387c5d9e5fb13ffd6f039c5" as const;
export const CTC_RUNTIME_REQUIREMENTS = [
  "torch==2.13.0",
  "transformers==5.16.1",
  "huggingface-hub==1.28.0",
  "safetensors==0.8.0",
  "numpy==2.5.2",
  "soundfile==0.14.0",
  "speechbrain==1.1.0",
] as const;

export function ctcRuntimeIdentity(input: {
  pythonVersion: string;
  packages: readonly { name: string; version: string }[];
  explicitSpecSha256: string;
  dependencySpecSha256: string;
}): string {
  return sha256Value({
    runtimeVersion: "C5.18.1",
    pythonVersion: input.pythonVersion,
    packages: [...input.packages].toSorted((left, right) =>
      left.name.localeCompare(right.name),
    ),
    explicitSpecSha256: input.explicitSpecSha256,
    dependencySpecSha256: input.dependencySpecSha256,
    viterbiPolicy: CTC_VITERBI_POLICY,
    frameMappingPolicy: CTC_FRAME_MAPPING_POLICY,
  });
}

export function ctcModelSnapshotIdentity(input: {
  modelRepo: string;
  modelRevision: string;
  modelFiles: readonly { relativePath: string; size: number; sha256: string }[];
}): string {
  return sha256Value({
    modelRepo: input.modelRepo,
    modelRevision: input.modelRevision,
    modelFiles: [...input.modelFiles].toSorted((left, right) =>
      left.relativePath.localeCompare(right.relativePath),
    ),
  });
}

async function sha256File(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

async function verifySnapshot(input: {
  root: string;
  files: readonly { relativePath: string; size: number; sha256: string }[];
}): Promise<{ relativePath: string; size: number; sha256: string }[]> {
  return await Promise.all(
    input.files.map(async (file) => {
      const resolved = path.resolve(input.root, file.relativePath);
      const relation = path.relative(input.root, resolved);
      if (
        relation === ".." ||
        relation.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relation)
      ) {
        throw new InputError("CTC model file escapes its snapshot root.");
      }
      const info = await stat(resolved);
      const actual = {
        relativePath: file.relativePath,
        size: info.size,
        sha256: await sha256File(resolved),
      };
      if (sha256Value(actual) !== sha256Value(file)) {
        throw new InputError(
          `CTC model file identity mismatch: ${file.relativePath}`,
        );
      }
      return actual;
    }),
  );
}

export async function loadAndVerifyCtcRuntime(input: {
  runtimeManifestPath: string;
  modelManifestPath: string;
}): Promise<{ runtime: CtcRuntimeManifest; model: CtcModelManifest }> {
  const runtime = ctcRuntimeManifestSchema.parse(
    JSON.parse(await readFile(input.runtimeManifestPath, "utf8")) as unknown,
  );
  const model = ctcModelManifestSchema.parse(
    JSON.parse(await readFile(input.modelManifestPath, "utf8")) as unknown,
  );
  if (
    model.requestedRevision !== CTC_MODEL_REVISION ||
    model.resolvedRevision !== CTC_MODEL_REVISION
  ) {
    throw new InputError(
      "CTC model manifest does not use the fixed Large snapshot.",
    );
  }
  const [pythonInfo, explicitHash] = await Promise.all([
    stat(runtime.pythonExecutable),
    sha256File(runtime.explicitSpecPath),
  ]);
  if (!pythonInfo.isFile() || explicitHash !== runtime.explicitSpecSha256) {
    throw new InputError("CTC runtime executable or explicit spec mismatch.");
  }
  if (
    ctcRuntimeIdentity({
      pythonVersion: runtime.pythonVersion,
      packages: runtime.packages,
      explicitSpecSha256: runtime.explicitSpecSha256,
      dependencySpecSha256: runtime.dependencySpecSha256,
    }) !== runtime.runtimeIdentityHash
  ) {
    throw new InputError("CTC runtime identity hash mismatch.");
  }
  const files = await verifySnapshot({
    root: model.snapshotDirectory,
    files: model.modelFiles,
  });
  if (
    ctcModelSnapshotIdentity({
      modelRepo: model.modelRepo,
      modelRevision: model.resolvedRevision,
      modelFiles: files,
    }) !== model.modelSnapshotHash
  ) {
    throw new InputError("CTC model snapshot hash mismatch.");
  }
  if (model.separationModel !== null) {
    const separationFiles = await verifySnapshot({
      root: model.separationModel.snapshotDirectory,
      files: model.separationModel.modelFiles,
    });
    if (
      ctcModelSnapshotIdentity({
        modelRepo: model.separationModel.modelRepo,
        modelRevision: model.separationModel.resolvedRevision,
        modelFiles: separationFiles,
      }) !== model.separationModel.modelSnapshotHash
    ) {
      throw new InputError("Source-separation model snapshot hash mismatch.");
    }
  }
  return { runtime, model };
}

export interface CtcWorkerReady {
  deviceRequested: CtcDevice;
  deviceUsed: CtcDeviceUsed;
  fallback: {
    applied: boolean;
    from: "mps" | null;
    to: "cpu" | null;
    reason: string | null;
  };
  mpsAvailable: boolean;
  modelLoadCount: number;
  versions: Record<string, string>;
  processorClass: string;
  modelClass: "Wav2Vec2ForCTC";
  tokenizerClass: string;
  tokenizerVocabularyHash: string;
  tokenizerVocabularySize: number;
  blankTokenId: number;
  padTokenId: number;
  unknownTokenId: number | null;
  convKernel: number[];
  convStride: number[];
  totalStrideSamples: number;
  receptiveFieldSamples: number;
}

interface WorkerAlignmentResult {
  pathStatus: CtcAlignmentAttempt["pathStatus"];
  target: CtcTargetEncoding;
  predictedFrameCount: number;
  expectedFrameCount: number;
  frameCountVerified: boolean;
  tokenSpans: CtcAlignmentAttempt["tokenSpans"];
  selectedBoundary: CtcAlignmentAttempt["selectedBoundary"];
  startPinnedToWindowEdge: boolean;
  endPinnedToWindowEdge: boolean;
  meanTokenPosterior: number | null;
  minimumTokenPosterior: number | null;
  alignedTokenMeanLogPosterior: number | null;
  alignedTokenMinLogPosterior: number | null;
  pathScore: number | null;
  normalizedPathLogScore: number | null;
  blankFrameRatio: number | null;
  targetSpanDurationSeconds: number | null;
  targetSpanToWindowRatio: number | null;
  greedyText: string;
  greedyTextMatchesTarget: boolean;
  greedyNormalizedSimilarity: number;
  greedyEditRatio: number;
  workerRequestVerified: true;
  wallClockSeconds: number;
  warnings: string[];
  blockers: string[];
}

interface PendingRequest {
  resolve: (value: WorkerAlignmentResult) => void;
  reject: (error: Error) => void;
}

function workerString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function sanitizedMessage(value: unknown): string {
  return (value instanceof Error ? value.message : String(value))
    .replace(/(?:hf|api)[_-]?token\s*[:=]\s*\S+/giu, "TOKEN_REDACTED")
    .replace(/\/Users\/[^\s"']+/gu, "LOCAL_PATH_REDACTED")
    .slice(0, 800);
}

export class LocalCtcWorker {
  readonly #runtime: CtcRuntimeManifest;
  readonly #model: CtcModelManifest;
  readonly #device: CtcDevice;
  readonly #workerScriptPath: string;
  #child: ChildProcessWithoutNullStreams | null = null;
  #ready: Promise<CtcWorkerReady> | null = null;
  #pending = new Map<string, PendingRequest>();
  #stderr = "";
  #modelLoadAttributed = false;

  constructor(input: {
    runtime: CtcRuntimeManifest;
    model: CtcModelManifest;
    device: CtcDevice;
    workerScriptPath: string;
  }) {
    this.#runtime = input.runtime;
    this.#model = input.model;
    this.#device = input.device;
    this.#workerScriptPath = input.workerScriptPath;
  }

  async start(): Promise<CtcWorkerReady> {
    if (this.#ready !== null) return await this.#ready;
    this.#ready = new Promise<CtcWorkerReady>((resolve, reject) => {
      const environment = { ...process.env };
      delete environment.HF_TOKEN;
      delete environment.HUGGING_FACE_HUB_TOKEN;
      environment.HF_HUB_OFFLINE = "1";
      environment.TRANSFORMERS_OFFLINE = "1";
      environment.HF_HUB_DISABLE_TELEMETRY = "1";
      const child = spawn(
        this.#runtime.pythonExecutable,
        [
          this.#workerScriptPath,
          "--model-directory",
          this.#model.snapshotDirectory,
          "--device",
          this.#device,
        ],
        { shell: false, env: environment, stdio: ["pipe", "pipe", "pipe"] },
      );
      this.#child = child;
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        this.#stderr = `${this.#stderr}${chunk}`.slice(-4_000);
      });
      const lines = createInterface({ input: child.stdout });
      lines.on("line", (line) => {
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(line) as Record<string, unknown>;
        } catch (error) {
          reject(
            new InputError(
              `CTC worker emitted invalid JSON: ${sanitizedMessage(error)}`,
            ),
          );
          return;
        }
        if (message.type === "ready") {
          resolve(message as unknown as CtcWorkerReady);
          return;
        }
        if (message.type === "result" || message.type === "error") {
          const requestId = workerString(message.requestId);
          const pending = this.#pending.get(requestId);
          if (pending === undefined) return;
          this.#pending.delete(requestId);
          if (message.type === "error") {
            pending.reject(
              new InputError(
                `CTC inference failed (${workerString(message.code, "UNKNOWN")}): ${sanitizedMessage(message.message)}`,
              ),
            );
          } else {
            pending.resolve(message as unknown as WorkerAlignmentResult);
          }
          return;
        }
        if (message.type === "fatal") {
          reject(
            new InputError(
              `CTC worker failed closed (${workerString(message.code, "UNKNOWN")}): ${sanitizedMessage(message.message)}`,
            ),
          );
        }
      });
      child.once("error", (error) => {
        reject(
          new InputError(
            `Unable to start CTC worker: ${sanitizedMessage(error)}`,
          ),
        );
      });
      child.once("close", (code) => {
        const error = new InputError(
          `CTC worker exited with ${String(code)}: ${sanitizedMessage(this.#stderr)}`,
        );
        reject(error);
        for (const pending of this.#pending.values()) pending.reject(error);
        this.#pending.clear();
      });
    });
    return await this.#ready;
  }

  async align(input: {
    attemptId: string;
    cueId: string;
    componentId: string;
    windowType: "narrow" | "expanded";
    audioPath: string;
    audioSha256: string;
    audioLocalInterval: { start: number; end: number };
    mediaGlobalInterval: { start: number; end: number };
    targetText: string;
    targetTokenIds?: readonly number[];
  }): Promise<CtcAlignmentAttempt> {
    const ready = await this.start();
    if (this.#child === null)
      throw new InputError("CTC worker is not running.");
    const audio = await readFile(input.audioPath);
    const metadata = inspectReviewWav(audio);
    const requestId = randomUUID();
    const resultPromise = new Promise<WorkerAlignmentResult>(
      (resolve, reject) => {
        this.#pending.set(requestId, { resolve, reject });
      },
    );
    this.#child.stdin.write(
      `${JSON.stringify({
        type: "align",
        requestId,
        audioPath: input.audioPath,
        audioFrameStart: 0,
        audioFrameEnd: metadata.frameCount,
        targetText: input.targetText,
        targetTokenIds: input.targetTokenIds ?? null,
        device: ready.deviceUsed,
        alignmentAlgorithmVersion: CTC_VITERBI_POLICY,
        mediaGlobalStart: input.mediaGlobalInterval.start,
      })}\n`,
    );
    const result = await resultPromise;
    const modelLoadCount = this.#modelLoadAttributed ? 0 : ready.modelLoadCount;
    this.#modelLoadAttributed = true;
    return ctcAlignmentAttemptSchema.parse({
      attemptId: input.attemptId,
      cueId: input.cueId,
      componentId: input.componentId,
      windowType: input.windowType,
      audioSha256: input.audioSha256,
      audioSampleRate: 16_000,
      audioFrameCount: metadata.frameCount,
      audioDurationSeconds: metadata.actualDurationSeconds,
      audioLocalInterval: input.audioLocalInterval,
      mediaGlobalInterval: input.mediaGlobalInterval,
      target: result.target,
      targetTokenCount: result.target.tokenIds.length,
      cacheHit: false,
      inferenceExecuted: true,
      modelLoadCount,
      pathStatus: result.pathStatus,
      pathExists: result.pathStatus === "success",
      predictedFrameCount: result.predictedFrameCount,
      logitsFrameCount: result.predictedFrameCount,
      expectedFrameCount: result.expectedFrameCount,
      frameCountVerified: result.frameCountVerified,
      tokenSpans: result.tokenSpans,
      selectedBoundary: result.selectedBoundary,
      startPinnedToWindowEdge: result.startPinnedToWindowEdge,
      endPinnedToWindowEdge: result.endPinnedToWindowEdge,
      meanTokenPosterior: result.meanTokenPosterior,
      minimumTokenPosterior: result.minimumTokenPosterior,
      alignedTokenMeanLogPosterior: result.alignedTokenMeanLogPosterior,
      alignedTokenMinLogPosterior: result.alignedTokenMinLogPosterior,
      pathScore: result.pathScore,
      normalizedPathLogScore: result.normalizedPathLogScore,
      blankFrameRatio: result.blankFrameRatio,
      targetSpanDurationSeconds: result.targetSpanDurationSeconds,
      targetSpanToWindowRatio: result.targetSpanToWindowRatio,
      scoreCalibrationStatus: "uncalibrated-ctc-score",
      greedyText: result.greedyText,
      greedyTextMatchesTarget: result.greedyTextMatchesTarget,
      greedyNormalizedSimilarity: result.greedyNormalizedSimilarity,
      greedyEditRatio: result.greedyEditRatio,
      greedyDiagnosticOnly: true,
      workerRequestVerified: result.workerRequestVerified,
      viterbiPolicy: CTC_VITERBI_POLICY,
      frameMapping: {
        sampleRate: 16_000,
        convKernel: ready.convKernel,
        convStride: ready.convStride,
        totalStrideSamples: ready.totalStrideSamples,
        receptiveFieldSamples: ready.receptiveFieldSamples,
        frameCountFormula: "iterated-valid-convolution-v1",
        frameIntervalPolicy: "receptive-field-clipped-v1",
      },
      deviceRequested: ready.deviceRequested,
      deviceUsed: ready.deviceUsed,
      wallClockSeconds: result.wallClockSeconds,
      warnings: result.warnings,
      blockers: result.blockers,
    });
  }

  async close(): Promise<void> {
    if (this.#child === null) return;
    const child = this.#child;
    this.#child = null;
    if (child.exitCode !== null || child.killed) return;
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGTERM");
        finish();
      }, 5_000);
      timer.unref();
      child.once("close", finish);
      try {
        child.stdin.write(`${JSON.stringify({ type: "shutdown" })}\n`);
        child.stdin.end();
      } catch {
        child.kill("SIGTERM");
      }
    });
  }
}

function requiredVersion(
  versions: Readonly<Record<string, string>>,
  key: string,
): string {
  const value = versions[key];
  if (value === undefined || value === "") {
    throw new InputError(`CTC worker did not report ${key}.`);
  }
  return value;
}

export function buildCtcRuntimeCapability(input: {
  runtime: CtcRuntimeManifest;
  model: CtcModelManifest;
  ready: CtcWorkerReady;
  probe: CtcAlignmentAttempt;
  cpuProbePassed: boolean;
  mpsProbePassed: boolean | null;
  cpuMpsTokenPathParity: boolean | null;
  cpuMpsMaximumBoundaryDeltaSeconds: number | null;
}): CtcRuntimeCapability {
  const base = {
    schemaVersion: "1.0.0" as const,
    artifactType: "ctc-runtime-capability" as const,
    runtimeVersion: "C5.18.1" as const,
    generatedAt: new Date().toISOString(),
    runtimeIdentityHash: input.runtime.runtimeIdentityHash,
    backend: "reazon-wav2vec2-ctc" as const,
    runtimeLockHash: sha256Value({
      explicitSpecSha256: input.runtime.explicitSpecSha256,
      dependencySpecSha256: input.runtime.dependencySpecSha256,
    }),
    modelRepo: input.model.modelRepo,
    modelRevision: input.model.resolvedRevision,
    modelSnapshotHash: input.model.modelSnapshotHash,
    modelFileCount: input.model.modelFiles.length,
    modelFiles: input.model.modelFiles,
    license: CTC_MODEL_LICENSE,
    citations: [
      "https://huggingface.co/reazon-research/japanese-wav2vec2-large-rs35kh",
      "https://research.reazon.jp/projects/ReazonSpeech/",
    ],
    architecture: "Wav2Vec2ForCTC" as const,
    processorClass: input.ready.processorClass,
    modelClass: input.ready.modelClass,
    tokenizerClass: input.ready.tokenizerClass,
    tokenizerVocabularyHash: input.ready.tokenizerVocabularyHash,
    tokenizerVocabularySize: input.ready.tokenizerVocabularySize,
    blankTokenId: input.ready.blankTokenId,
    padTokenId: input.ready.padTokenId,
    unknownTokenId: input.ready.unknownTokenId,
    pythonVersion: requiredVersion(input.ready.versions, "python"),
    torchVersion: requiredVersion(input.ready.versions, "torch"),
    transformersVersion: requiredVersion(input.ready.versions, "transformers"),
    huggingfaceHubVersion: requiredVersion(
      input.ready.versions,
      "huggingface_hub",
    ),
    safetensorsVersion: requiredVersion(input.ready.versions, "safetensors"),
    numpyVersion: requiredVersion(input.ready.versions, "numpy"),
    soundfileVersion: requiredVersion(input.ready.versions, "soundfile"),
    frameMapping: input.probe.frameMapping,
    sampleRate: 16_000 as const,
    ctcAlignmentAlgorithm: CTC_VITERBI_POLICY,
    viterbiPolicy: CTC_VITERBI_POLICY,
    scoreCalibrationStatus: "uncalibrated-ctc-score" as const,
    torchaudioForcedAlignUsed: false as const,
    deviceRequested: input.ready.deviceRequested,
    deviceUsed: input.ready.deviceUsed,
    fallback: input.ready.fallback,
    mpsAvailable: input.ready.mpsAvailable,
    cpuProbePassed: input.cpuProbePassed,
    mpsProbePassed: input.mpsProbePassed,
    cpuMpsTokenPathParity: input.cpuMpsTokenPathParity,
    cpuMpsMaximumBoundaryDeltaSeconds: input.cpuMpsMaximumBoundaryDeltaSeconds,
    finiteOutputVerified:
      input.probe.pathScore === null || Number.isFinite(input.probe.pathScore),
    frameCountVerified: input.probe.frameCountVerified,
    targetEncodable: input.probe.target.targetEncodable,
    networkUsedDuringInference: false as const,
    runtimePath: null,
    modelCachePath: null,
    shareable: true as const,
    validationPassed:
      input.cpuProbePassed &&
      input.probe.frameCountVerified &&
      input.probe.target.targetEncodable,
  };
  return ctcRuntimeCapabilitySchema.parse({
    ...base,
    semanticHash: sha256Value({ ...base, generatedAt: null }),
  });
}

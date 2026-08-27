import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  InputError,
  speakerEvidenceRuntimeCapabilitySchema,
  speakerModelManifestSchema,
  speakerRuntimeManifestSchema,
  type SpeakerDevice,
  type SpeakerDeviceUsed,
  type SpeakerEvidenceRuntimeCapability,
  type SpeakerModelManifest,
  type SpeakerRuntimeManifest,
} from "@mvl/shared";

import { sha256Value } from "./finalization-support.js";
import { inspectReviewWav } from "./review-audio.js";

export const SPEAKER_MODEL_REPO =
  "pyannote/speaker-diarization-community-1" as const;
export const SPEAKER_MODEL_REVISION =
  "3533c8cf8e369892e6b79ff1bf80f7b0286a54ee" as const;
export const SPEAKER_RUNTIME_REQUIREMENTS = [
  "pyannote.audio==4.0.7",
  "torch==2.11.0",
  "torchaudio==2.11.0",
  "huggingface_hub==1.28.0",
  "numpy==2.5.2",
  "scipy==1.18.1",
  "soundfile==0.14.0",
] as const;

export const SPEAKER_MODEL_LICENSE = "cc-by-4.0" as const;
export const SPEAKER_MODEL_CITATIONS = [
  {
    title: "pyannote.audio: neural building blocks for speaker diarization",
    url: "https://arxiv.org/abs/1911.01255",
  },
  {
    title: "End-to-end speaker segmentation for overlap-aware resegmentation",
    url: "https://arxiv.org/abs/2104.04045",
  },
] as const;

export function assertSpeakerPreparationAuthorization(input: {
  fetchSpeakerModels: boolean;
  tokenEnvironmentName: string;
  environment?: Readonly<Record<string, string | undefined>>;
}): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(input.tokenEnvironmentName)) {
    throw new InputError("--hf-token-env must name one environment variable.");
  }
  const environment = input.environment ?? process.env;
  if (
    input.fetchSpeakerModels &&
    (environment[input.tokenEnvironmentName] ?? "").trim() === ""
  ) {
    throw new InputError(
      `${input.tokenEnvironmentName} is not set. Accept the official Community-1 model conditions, export a read-capable Hugging Face token in that environment variable, and rerun. The token is never accepted as a CLI value.`,
    );
  }
}

export function speakerRuntimeIdentity(input: {
  pythonVersion: string;
  packages: readonly { name: string; version: string }[];
  explicitSpecSha256: string;
  dependencySpecSha256: string;
}): string {
  return sha256Value({
    runtimeVersion: "C5.18",
    pythonVersion: input.pythonVersion,
    packages: [...input.packages].toSorted((left, right) =>
      left.name.localeCompare(right.name),
    ),
    explicitSpecSha256: input.explicitSpecSha256,
    dependencySpecSha256: input.dependencySpecSha256,
  });
}

export function speakerModelSnapshotIdentity(input: {
  modelRepo: string;
  modelRevision: string;
  modelFiles: readonly { relativePath: string; size: number; sha256: string }[];
  dependencyModelSnapshots: readonly unknown[];
}): string {
  const dependencies = input.dependencyModelSnapshots
    .map((snapshot) => ({ snapshot, sortKey: sha256Value(snapshot) }))
    .toSorted((left, right) => left.sortKey.localeCompare(right.sortKey))
    .map(({ snapshot }) => snapshot);
  return sha256Value({
    modelRepo: input.modelRepo,
    modelRevision: input.modelRevision,
    modelFiles: [...input.modelFiles].toSorted((left, right) =>
      left.relativePath.localeCompare(right.relativePath),
    ),
    dependencyModelSnapshots: dependencies,
  });
}

export function dependencyModelSnapshotIdentity(input: {
  modelRepo: string;
  modelRevision: string;
  snapshotSubdirectory: string;
  files: readonly { relativePath: string; size: number; sha256: string }[];
}): string {
  return sha256Value({
    modelRepo: input.modelRepo,
    modelRevision: input.modelRevision,
    snapshotSubdirectory: input.snapshotSubdirectory,
    files: [...input.files].toSorted((left, right) =>
      left.relativePath.localeCompare(right.relativePath),
    ),
  });
}

async function sha256File(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

export async function loadAndVerifySpeakerRuntime(input: {
  runtimeManifestPath: string;
  modelManifestPath: string;
}): Promise<{
  runtime: SpeakerRuntimeManifest;
  model: SpeakerModelManifest;
}> {
  const runtime = speakerRuntimeManifestSchema.parse(
    JSON.parse(await readFile(input.runtimeManifestPath, "utf8")) as unknown,
  );
  const model = speakerModelManifestSchema.parse(
    JSON.parse(await readFile(input.modelManifestPath, "utf8")) as unknown,
  );
  if (
    model.requestedRevision !== SPEAKER_MODEL_REVISION ||
    model.resolvedRevision !== SPEAKER_MODEL_REVISION
  ) {
    throw new InputError(
      "Speaker model manifest must use the fixed official Community-1 snapshot.",
    );
  }
  const [explicitSpecHash, pythonInfo] = await Promise.all([
    sha256File(runtime.explicitSpecPath),
    stat(runtime.pythonExecutable),
  ]);
  if (!pythonInfo.isFile() || explicitSpecHash !== runtime.explicitSpecSha256) {
    throw new InputError("Speaker runtime explicit spec identity mismatch.");
  }
  const runtimeIdentityHash = speakerRuntimeIdentity({
    pythonVersion: runtime.pythonVersion,
    packages: runtime.packages,
    explicitSpecSha256: runtime.explicitSpecSha256,
    dependencySpecSha256: runtime.dependencySpecSha256,
  });
  if (runtimeIdentityHash !== runtime.runtimeIdentityHash) {
    throw new InputError("Speaker runtime identity hash mismatch.");
  }
  const verifiedFiles = await Promise.all(
    model.modelFiles.map(async (file) => {
      const filePath = path.resolve(model.snapshotDirectory, file.relativePath);
      const relative = path.relative(model.snapshotDirectory, filePath);
      if (
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative) ||
        relative === ".."
      ) {
        throw new InputError("Speaker model file escapes its snapshot root.");
      }
      const info = await stat(filePath);
      return {
        relativePath: file.relativePath,
        size: info.size,
        sha256: await sha256File(filePath),
      };
    }),
  );
  const verifiedDependencies = await Promise.all(
    model.dependencyModelSnapshots.map(async (snapshot) => {
      const snapshotRoot = path.resolve(
        model.snapshotDirectory,
        snapshot.snapshotSubdirectory,
      );
      const rootRelation = path.relative(model.snapshotDirectory, snapshotRoot);
      if (
        rootRelation === ".." ||
        rootRelation.startsWith(`..${path.sep}`) ||
        path.isAbsolute(rootRelation)
      ) {
        throw new InputError("Dependency model snapshot escapes model root.");
      }
      const files = await Promise.all(
        snapshot.files.map(async (file) => {
          const filePath = path.resolve(snapshotRoot, file.relativePath);
          const relation = path.relative(snapshotRoot, filePath);
          if (
            relation === ".." ||
            relation.startsWith(`..${path.sep}`) ||
            path.isAbsolute(relation)
          ) {
            throw new InputError(
              "Dependency model file escapes snapshot root.",
            );
          }
          const info = await stat(filePath);
          return {
            relativePath: file.relativePath,
            size: info.size,
            sha256: await sha256File(filePath),
          };
        }),
      );
      const actualHash = dependencyModelSnapshotIdentity({
        ...snapshot,
        files,
      });
      if (
        actualHash !== snapshot.modelSnapshotHash ||
        sha256Value(files) !== sha256Value(snapshot.files)
      ) {
        throw new InputError("Dependency model snapshot identity mismatch.");
      }
      return snapshot.snapshotSubdirectory;
    }),
  );
  for (const required of ["embedding", "plda", "segmentation"]) {
    if (!verifiedDependencies.includes(required)) {
      throw new InputError(
        `Community-1 model manifest lacks bundled ${required} dependency identity.`,
      );
    }
  }
  if (
    sha256Value(verifiedFiles) !== sha256Value(model.modelFiles) ||
    speakerModelSnapshotIdentity({
      modelRepo: model.modelRepo,
      modelRevision: model.resolvedRevision,
      modelFiles: verifiedFiles,
      dependencyModelSnapshots: model.dependencyModelSnapshots,
    }) !== model.modelSnapshotHash
  ) {
    throw new InputError("Speaker model snapshot file identity mismatch.");
  }
  return { runtime, model };
}

export interface RawSpeakerTurn {
  speaker: string;
  start: number;
  end: number;
}

export interface RawSpeakerInference {
  standardTurns: RawSpeakerTurn[];
  exclusiveTurns: RawSpeakerTurn[];
  wallClockSeconds: number;
  confidenceStatus: "available" | "unavailable";
  warnings: string[];
}

export interface SpeakerWorkerReady {
  deviceRequested: SpeakerDevice;
  deviceUsed: SpeakerDeviceUsed;
  fallback: {
    applied: boolean;
    from: "mps" | null;
    to: "cpu" | null;
    reason: string | null;
  };
  mpsAvailable: boolean;
  allPipelineModulesOnDevice: boolean;
  modelLoadCount: number;
  versions: Record<string, string>;
}

function requiredVersion(
  versions: Readonly<Record<string, string>>,
  name: string,
): string {
  const value = versions[name];
  if (value === undefined || value.trim() === "") {
    throw new InputError(`Speaker runtime did not report ${name}.`);
  }
  return value;
}

export function buildSpeakerRuntimeCapability(input: {
  runtime: SpeakerRuntimeManifest;
  model: SpeakerModelManifest;
  ready: SpeakerWorkerReady;
  inference: RawSpeakerInference;
  mpsCpuSemanticComparable?: boolean | null;
}): SpeakerEvidenceRuntimeCapability {
  const finiteOutputVerified = [
    ...input.inference.standardTurns,
    ...input.inference.exclusiveTurns,
  ].every(
    (turn) =>
      Number.isFinite(turn.start) &&
      Number.isFinite(turn.end) &&
      turn.start >= 0 &&
      turn.end > turn.start,
  );
  const base = {
    schemaVersion: "1.0.0" as const,
    artifactType: "speaker-evidence-runtime-capability" as const,
    runtimeVersion: "C5.18" as const,
    generatedAt: new Date().toISOString(),
    backend: "pyannote-community-1" as const,
    pythonVersion: requiredVersion(input.ready.versions, "python"),
    pyannoteAudioVersion: requiredVersion(
      input.ready.versions,
      "pyannote.audio",
    ),
    torchVersion: requiredVersion(input.ready.versions, "torch"),
    torchaudioVersion: requiredVersion(input.ready.versions, "torchaudio"),
    huggingfaceHubVersion: requiredVersion(
      input.ready.versions,
      "huggingface_hub",
    ),
    numpyVersion: requiredVersion(input.ready.versions, "numpy"),
    scipyVersion: requiredVersion(input.ready.versions, "scipy"),
    soundfileVersion: requiredVersion(input.ready.versions, "soundfile"),
    runtimeExplicitSpecSha256: input.runtime.explicitSpecSha256,
    dependencySpecSha256: input.runtime.dependencySpecSha256,
    runtimeIdentityHash: input.runtime.runtimeIdentityHash,
    modelRepo: input.model.modelRepo,
    modelRevision: input.model.resolvedRevision,
    modelSnapshotHash: input.model.modelSnapshotHash,
    modelFiles: input.model.modelFiles,
    license: input.model.license,
    citations: input.model.citations,
    dependencyModelSnapshots: input.model.dependencyModelSnapshots,
    standardDiarizationAvailable: true,
    exclusiveDiarizationAvailable: true,
    overlapTrackAvailable: true,
    segmentationConfidenceAvailable: false,
    speakerConfidenceAvailable: false,
    confidenceStatus: input.inference.confidenceStatus,
    deviceRequested: input.ready.deviceRequested,
    deviceUsed: input.ready.deviceUsed,
    fallback: input.ready.fallback,
    mpsAvailable: input.ready.mpsAvailable,
    allPipelineModulesOnDevice: input.ready.allPipelineModulesOnDevice,
    finiteOutputVerified,
    mpsCpuSemanticComparable: input.mpsCpuSemanticComparable ?? null,
    networkUsedDuringPreparation: input.model.networkUsedDuringPreparation,
    networkUsedDuringInference: false as const,
    hfTokenStored: false as const,
    runtimePath: null,
    modelCachePath: null,
    shareable: true as const,
  };
  return speakerEvidenceRuntimeCapabilitySchema.parse({
    ...base,
    semanticHash: sha256Value({ ...base, generatedAt: null }),
  });
}

interface PendingRequest {
  resolve: (value: RawSpeakerInference) => void;
  reject: (error: Error) => void;
}

function sanitizedWorkerMessage(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value);
  return message
    .replace(/(?:hf|api)[_-]?token\s*[:=]\s*\S+/giu, "TOKEN_REDACTED")
    .replace(/\/Users\/[^\s"']+/gu, "LOCAL_PATH_REDACTED")
    .slice(0, 800);
}

function workerString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export class LocalSpeakerWorker {
  readonly #runtime: SpeakerRuntimeManifest;
  readonly #model: SpeakerModelManifest;
  readonly #device: SpeakerDevice;
  readonly #workerScriptPath: string;
  #child: ChildProcessWithoutNullStreams | null = null;
  #ready: Promise<SpeakerWorkerReady> | null = null;
  #pending = new Map<string, PendingRequest>();
  #stderr = "";

  constructor(input: {
    runtime: SpeakerRuntimeManifest;
    model: SpeakerModelManifest;
    device: SpeakerDevice;
    workerScriptPath: string;
  }) {
    this.#runtime = input.runtime;
    this.#model = input.model;
    this.#device = input.device;
    this.#workerScriptPath = input.workerScriptPath;
  }

  async start(): Promise<SpeakerWorkerReady> {
    if (this.#ready !== null) return await this.#ready;
    this.#ready = new Promise<SpeakerWorkerReady>((resolve, reject) => {
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
              `Speaker worker emitted invalid JSON: ${sanitizedWorkerMessage(error)}`,
            ),
          );
          return;
        }
        if (message.type === "ready") {
          resolve(message as unknown as SpeakerWorkerReady);
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
                `Local speaker inference failed (${workerString(message.code, "UNKNOWN")}): ${sanitizedWorkerMessage(message.message)}`,
              ),
            );
          } else {
            pending.resolve({
              standardTurns: message.standardTurns as RawSpeakerTurn[],
              exclusiveTurns: message.exclusiveTurns as RawSpeakerTurn[],
              wallClockSeconds: Number(message.wallClockSeconds),
              confidenceStatus:
                message.confidenceStatus === "available"
                  ? "available"
                  : "unavailable",
              warnings: Array.isArray(message.warnings)
                ? message.warnings.map(String)
                : [],
            });
          }
        }
        if (message.type === "fatal") {
          reject(
            new InputError(
              `Speaker worker failed closed (${workerString(message.code, "UNKNOWN")}): ${sanitizedWorkerMessage(message.message)}`,
            ),
          );
        }
      });
      child.once("error", (error) => {
        reject(
          new InputError(
            `Unable to start local speaker worker: ${sanitizedWorkerMessage(error)}`,
          ),
        );
      });
      child.once("close", (code) => {
        const error = new InputError(
          `Local speaker worker exited with ${String(code)}: ${sanitizedWorkerMessage(this.#stderr)}`,
        );
        reject(error);
        for (const pending of this.#pending.values()) pending.reject(error);
        this.#pending.clear();
      });
    });
    return await this.#ready;
  }

  async infer(input: {
    audioPath: string;
    minSpeakers: number;
    maxSpeakers: number;
  }): Promise<RawSpeakerInference> {
    await this.start();
    if (this.#child === null) {
      throw new InputError("Speaker worker is not running.");
    }
    const requestId = randomUUID();
    const result = new Promise<RawSpeakerInference>((resolve, reject) => {
      this.#pending.set(requestId, { resolve, reject });
    });
    this.#child.stdin.write(
      `${JSON.stringify({ type: "infer", requestId, ...input })}\n`,
    );
    return await result;
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
      child.stdin.once("error", () => {
        if (child.exitCode === null) child.kill("SIGTERM");
        finish();
      });
      try {
        child.stdin.write(`${JSON.stringify({ type: "shutdown" })}\n`);
        child.stdin.end();
      } catch {
        child.kill("SIGTERM");
      }
    });
  }
}

function dataChunk(buffer: Buffer): { offset: number; length: number } {
  let cursor = 12;
  while (cursor + 8 <= buffer.length) {
    const id = buffer.toString("ascii", cursor, cursor + 4);
    const length = buffer.readUInt32LE(cursor + 4);
    const offset = cursor + 8;
    if (offset + length > buffer.length) throw new InputError("Truncated WAV.");
    if (id === "data") return { offset, length };
    cursor = offset + length + (length % 2);
  }
  throw new InputError("WAV data chunk is missing.");
}

export async function cropReviewWavFrames(input: {
  sourcePath: string;
  targetPath: string;
  startSeconds: number;
  endSeconds: number;
}): Promise<{
  sha256: string;
  frameCount: number;
  durationSeconds: number;
}> {
  const source = await readFile(input.sourcePath);
  const metadata = inspectReviewWav(source);
  const chunk = dataChunk(source);
  const startFrame = Math.max(
    0,
    Math.min(metadata.frameCount, Math.round(input.startSeconds * 16_000)),
  );
  const endFrame = Math.max(
    startFrame + 1,
    Math.min(metadata.frameCount, Math.round(input.endSeconds * 16_000)),
  );
  const pcm = source.subarray(
    chunk.offset + startFrame * metadata.blockAlign,
    chunk.offset + endFrame * metadata.blockAlign,
  );
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16_000, 24);
  header.writeUInt32LE(32_000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  const target = Buffer.concat([header, pcm]);
  await writeFile(input.targetPath, target, { flag: "wx" });
  const inspected = inspectReviewWav(target);
  return {
    sha256: createHash("sha256").update(target).digest("hex"),
    frameCount: inspected.frameCount,
    durationSeconds: inspected.actualDurationSeconds,
  };
}

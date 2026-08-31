import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { readFile, mkdir, access } from "node:fs/promises";
import path from "node:path";
import {
  NodeProcessRunner,
  c601141RuntimeIdentitySchema,
  c601141DetectorRunSchema,
  c601141SweepsSchema,
  type C601141RuntimeIdentity,
  type C601141AudioViews,
  type C601141Policy,
  type C601141AudioView,
  type C601141DetectorRun,
} from "@mvl/shared";
import { loadAndVerifySpeakerRuntime } from "../speaker-runtime.js";
import {
  hash141,
  hashed141,
  header141,
  id141,
  assertBudget141,
  assertHash141,
  union141,
} from "./c601141-policy.js";
import {
  fileHash141,
  durableJson141,
  readJson141,
  reserveDispatch141,
  pcm141,
  bytesHash141,
} from "./c601141-io.js";

export interface C601141DetectorPaths {
  python: string;
  worker: string;
  sileroModel: string;
  sileroLibrary: string;
  speakerRuntimeManifest: string;
  speakerModelManifest: string;
}
export interface C601141DetectorBackend {
  identity: C601141RuntimeIdentity;
  python: string;
  worker: string;
  model: string;
  library: string | null;
}
export interface C601141SweepJob {
  runId: string;
  cacheKey: string;
  viewId: string;
  pcmSha256: string;
  profileId: string;
  profile: C601141Policy["profiles"][number] | null;
  backend: C601141DetectorBackend;
}
/** Metadata and pinned-file verification only. This does not import torch,
 * construct a provider, initialize a model, or call the network. */
export async function detectorPreflight141(paths: C601141DetectorPaths) {
  const workerSha256 = await fileHash141(paths.worker);
  const runner = new NodeProcessRunner();
  const metadata = await runner.run(
    paths.python,
    [
      "-c",
      "import json,sys,importlib.metadata as m; print(json.dumps({'python':sys.version.split()[0],'numpy':m.version('numpy')}))",
    ],
    { timeoutMs: 30000 },
  );
  const versions = JSON.parse(metadata.stdout) as Record<string, string>;
  const [sileroHash, libraryHash, pythonHash, speaker] = await Promise.all([
    fileHash141(paths.sileroModel),
    fileHash141(paths.sileroLibrary),
    fileHash141(paths.python),
    loadAndVerifySpeakerRuntime({
      runtimeManifestPath: paths.speakerRuntimeManifest,
      modelManifestPath: paths.speakerModelManifest,
    }),
  ]);
  const sileroIdentity = c601141RuntimeIdentitySchema.parse({
    detectorFamily: "SILERO",
    modelId: "silero-v6.2.0-ggml-vad-only",
    modelSnapshotHash: sileroHash,
    runtimeIdentityHash: hash141({
      libraryHash,
      pythonHash,
      workerSha256,
      versions,
      api: "whisper_vad_detect_speech-reset",
    }),
    workerSha256,
    binarySha256: libraryHash,
    device: "cpu",
    offline: true,
    modelDownloadCount: 0,
    versions: { ...versions, "whisper.cpp": "1.9.3-pinned-vad-c-api" },
  });
  const speakerPythonHash = await fileHash141(speaker.runtime.pythonExecutable);
  const speakerVersions = Object.fromEntries(
    speaker.runtime.packages.map((p) => [p.name, p.version]),
  );
  const pyannoteIdentity = c601141RuntimeIdentitySchema.parse({
    detectorFamily: "PYANNOTE",
    modelId: speaker.model.modelRepo,
    modelSnapshotHash: speaker.model.modelSnapshotHash,
    runtimeIdentityHash: hash141({
      runtime: speaker.runtime.runtimeIdentityHash,
      workerSha256,
      speakerPythonHash,
      device: "cpu",
      mode: "anonymous-union-only",
    }),
    workerSha256,
    binarySha256: speakerPythonHash,
    device: "cpu",
    offline: true,
    modelDownloadCount: 0,
    versions: { ...speakerVersions, python: speaker.runtime.pythonVersion },
  });
  const backends: C601141DetectorBackend[] = [
    {
      identity: sileroIdentity,
      python: paths.python,
      worker: paths.worker,
      model: paths.sileroModel,
      library: paths.sileroLibrary,
    },
    {
      identity: pyannoteIdentity,
      python: speaker.runtime.pythonExecutable,
      worker: paths.worker,
      model: speaker.model.snapshotDirectory,
      library: null,
    },
  ];
  return backends;
}
export function planSweeps141(
  views: C601141AudioViews,
  policy: C601141Policy,
  backends: C601141DetectorBackend[],
): C601141SweepJob[] {
  assertHash141(views);
  const unique = views.views.filter(
    (v) => v.detectorEligible && v.duplicateOfViewId === null,
  );
  if (
    unique.length > 5 ||
    new Set(unique.map((v) => v.pcmSha256)).size !== unique.length
  )
    throw new Error("C601141_DUPLICATE_DETECTOR_PCM");
  const jobs: C601141SweepJob[] = [];
  for (const backend of backends) {
    const selected =
      backend.identity.detectorFamily === "SILERO"
        ? unique
        : unique
            .filter(
              (v) => v.role === "NATIVE_MONO" || v.role === "VOICE_BAND_CENTER",
            )
            .slice(0, 2);
    for (const view of selected)
      for (const profile of backend.identity.detectorFamily === "SILERO"
        ? policy.profiles
        : [null]) {
        const core = {
          sourceIdentity: views.sourceIdentity,
          policyHash: policy.semanticHash,
          viewSemanticHash: view.semanticHash,
          pcmSha256: view.pcmSha256,
          runtime: backend.identity,
          profile,
        };
        jobs.push({
          runId: id141("speech-sweep", core),
          cacheKey: hash141(core),
          viewId: view.viewId,
          pcmSha256: view.pcmSha256,
          profileId: profile?.profileId ?? "community-1-anonymous-union-v1",
          profile,
          backend,
        });
      }
  }
  assertBudget141("SPEECH", jobs.length);
  return jobs;
}
interface RawResult {
  rawUnit: "CENTISECONDS" | "SECONDS";
  rawIntervals: { start: number; end: number }[];
  exclusiveRawIntervals: { start: number; end: number }[];
  inputFrames: number;
  sampleRate: number;
  device: string;
}
interface Message {
  type: string;
  requestId?: string;
  result?: RawResult;
  code?: string;
  modelLoadCount?: number;
  device?: string;
  versions?: Record<string, string>;
}

export function speechEnvironment141(
  library: string | null,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !/TOKEN|API_KEY|SECRET/iu.test(key),
      ),
    ),
    HF_HUB_OFFLINE: "1",
    TRANSFORMERS_OFFLINE: "1",
    HF_DATASETS_OFFLINE: "1",
    PYANNOTE_METRICS_ENABLED: "0",
  };
  // The pinned macOS runtime keeps its @rpath dependencies beside libwhisper.
  // Set only the child loader path; never install or mutate a system library.
  if (library)
    environment[
      process.platform === "darwin" ? "DYLD_LIBRARY_PATH" : "LD_LIBRARY_PATH"
    ] = path.dirname(library);
  return environment;
}

class SpeechWorker141 {
  #child: ChildProcessWithoutNullStreams;
  #pending = new Map<
    string,
    { resolve: (v: Message) => void; reject: (e: Error) => void }
  >();
  readonly ready: Promise<Message>;
  #stderr = "";
  constructor(backend: C601141DetectorBackend) {
    const environment = speechEnvironment141(backend.library);
    this.#child = spawn(
      backend.python,
      [
        backend.worker,
        "--backend",
        backend.identity.detectorFamily.toLowerCase(),
        "--model",
        backend.model,
        ...(backend.library ? ["--library", backend.library] : []),
      ],
      { env: environment, stdio: ["pipe", "pipe", "pipe"] },
    );
    this.#child.stderr.on("data", (chunk: Buffer) => {
      this.#stderr = (this.#stderr + chunk.toString()).slice(-5000);
    });
    this.ready = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#child.kill("SIGTERM");
        reject(new Error("C601141_DETECTOR_MODEL_LOAD_TIMEOUT"));
      }, 180000);
      const lines = createInterface({ input: this.#child.stdout });
      lines.on("line", (line) => {
        let message: Message;
        try {
          message = JSON.parse(line) as Message;
        } catch {
          return;
        }
        if (message.type === "ready") {
          clearTimeout(timeout);
          resolve(message);
          return;
        }
        if (message.requestId) {
          const item = this.#pending.get(message.requestId);
          if (item) {
            this.#pending.delete(message.requestId);
            item.resolve(message);
          }
        }
      });
      this.#child.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
        for (const p of this.#pending.values()) p.reject(error);
        this.#pending.clear();
      });
      this.#child.on("exit", (code) => {
        clearTimeout(timeout);
        const error = new Error(
          `C601141_DETECTOR_PROCESS_EXIT:${code}:${this.#stderr.replace(/\/Users\/[^\s]+/gu, "LOCAL_PATH")}`,
        );
        reject(error);
        for (const p of this.#pending.values()) p.reject(error);
        this.#pending.clear();
      });
    });
  }
  async run(job: C601141SweepJob, audioPath: string): Promise<Message> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#child.kill("SIGTERM");
        reject(new Error("C601141_DETECTOR_INFERENCE_TIMEOUT_NO_RETRY"));
      }, 1200000);
      this.#pending.set(job.runId, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
      this.#child.stdin.write(
        JSON.stringify({
          requestId: job.runId,
          audioPath,
          profile: job.profile,
        }) + "\n",
      );
    });
  }
  async close() {
    if (this.#child.exitCode !== null) return;
    this.#child.stdin.end(JSON.stringify({ type: "shutdown" }) + "\n");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.#child.kill("SIGTERM");
        resolve();
      }, 5000);
      this.#child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

export function normalizeDetectorIntervals141(
  raw: RawResult,
  view: C601141AudioView,
  maximumNativeSample: number,
) {
  if (
    raw.sampleRate !== 16000 ||
    raw.inputFrames !== view.frameCount ||
    raw.device !== "cpu"
  )
    throw new Error("C601141_DETECTOR_INPUT_IDENTITY_MISMATCH");
  const unit = raw.rawUnit === "CENTISECONDS" ? 100 : 1;
  return union141(
    raw.rawIntervals
      .map((v) => {
        if (
          !Number.isFinite(v.start) ||
          !Number.isFinite(v.end) ||
          v.end <= v.start ||
          v.start < 0 ||
          v.end / unit > view.durationSeconds + 0.04
        )
          throw new Error("C601141_DETECTOR_TIMEBASE_INVALID");
        const start16k = Math.round((v.start / unit) * 16000),
          end16k = Math.min(
            view.frameCount,
            Math.round((v.end / unit) * 16000),
          );
        return {
          startSample:
            view.timeMapping.sourceStartSample +
            Math.round(
              (start16k * view.timeMapping.numerator) /
                view.timeMapping.denominator,
            ),
          endSample: Math.min(
            maximumNativeSample,
            view.timeMapping.sourceStartSample +
              Math.round(
                (end16k * view.timeMapping.numerator) /
                  view.timeMapping.denominator,
              ),
          ),
        };
      })
      .filter((v) => v.endSample > v.startSample),
  );
}
export async function runSweeps141(input: {
  mode: "FRESH" | "EXACT_CACHE_ONLY";
  authorized: boolean;
  views: C601141AudioViews;
  policy: C601141Policy;
  jobs: C601141SweepJob[];
  viewsDirectory: string;
  cacheDirectory: string;
  outputDirectory: string;
  onProgress?: (message: string) => void;
}) {
  assertBudget141("SPEECH", input.jobs.length);
  assertHash141(input.views);
  if (input.mode === "FRESH" && !input.authorized)
    throw new Error("C601141_SPEECH_AUTHORIZATION_REQUIRED_PLAN_ONLY");
  await mkdir(input.outputDirectory, { recursive: true });
  const runs: C601141DetectorRun[] = [];
  let cacheHits = 0,
    inferences = 0,
    loads = 0,
    processes = 0;
  const workers = new Map<string, SpeechWorker141>();
  try {
    for (const job of input.jobs) {
      const view = input.views.views.find((v) => v.viewId === job.viewId);
      if (!view || !view.detectorEligible || view.pcmSha256 !== job.pcmSha256)
        throw new Error("C601141_SWEEP_VIEW_IDENTITY_MISMATCH");
      const audioPath = path.join(input.viewsDirectory, view.relativePath),
        bytes = await readFile(audioPath);
      if (
        bytesHash141(bytes) !== view.audioSha256 ||
        bytesHash141(pcm141(bytes).pcm) !== job.pcmSha256
      )
        throw new Error("C601141_SWEEP_AUDIO_HASH_MISMATCH");
      const cacheFile = path.join(
        input.cacheDirectory,
        "speech",
        `${job.cacheKey}.json`,
      );
      if (input.mode === "EXACT_CACHE_ONLY") {
        const cached = c601141DetectorRunSchema.parse(
          await readJson141(cacheFile),
        );
        assertHash141(cached);
        if (
          cached.cacheKey !== job.cacheKey ||
          cached.runId !== job.runId ||
          hash141(cached.runtime) !== hash141(job.backend.identity) ||
          !cached.resultPersisted
        )
          throw new Error("C601141_EXACT_DETECTOR_CACHE_IDENTITY_MISMATCH");
        const raw = await readJson141(
          path.join(input.cacheDirectory, "speech-raw", `${job.cacheKey}.json`),
        );
        if (hash141(raw) !== cached.rawResultHash)
          throw new Error("C601141_DETECTOR_RAW_CACHE_HASH_MISMATCH");
        runs.push(cached);
        cacheHits++;
        continue;
      }
      try {
        await access(cacheFile);
        throw new Error("C601141_FRESH_CACHE_ALREADY_EXISTS");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const key = job.backend.identity.runtimeIdentityHash;
      let worker = workers.get(key),
        loadDelta = 0,
        processDelta = 0;
      if (!worker) {
        if (
          (await fileHash141(job.backend.worker)) !==
            job.backend.identity.workerSha256 ||
          (await fileHash141(job.backend.library ?? job.backend.python)) !==
            job.backend.identity.binarySha256 ||
          (job.backend.identity.detectorFamily === "SILERO" &&
            (await fileHash141(job.backend.model)) !==
              job.backend.identity.modelSnapshotHash)
        )
          throw new Error("C601141_DETECTOR_RUNTIME_CHANGED_AFTER_PLAN");
        worker = new SpeechWorker141(job.backend);
        workers.set(key, worker);
        processes++;
        processDelta = 1;
        const ready = await worker.ready;
        if (
          ready.modelLoadCount !== 1 ||
          ready.device !== job.backend.identity.device
        )
          throw new Error("C601141_DETECTOR_RUNTIME_READY_MISMATCH");
        loads++;
        loadDelta = 1;
      }
      await reserveDispatch141({
        cacheDirectory: input.cacheDirectory,
        kind: "SPEECH",
        requestId: job.runId,
        identity: { cacheKey: job.cacheKey, planHash: hash141(input.jobs) },
      });
      inferences++;
      input.onProgress?.(
        `Speech ${inferences}/${input.jobs.length}: ${job.backend.identity.detectorFamily} ${view.role} ${job.profileId}`,
      );
      let message: Message;
      try {
        message = await worker.run(job, audioPath);
      } catch (error) {
        message = {
          type: "error",
          requestId: job.runId,
          code: error instanceof Error ? error.message : "DETECTOR_FAILED",
        };
      }
      try {
        await durableJson141(
          path.join(input.cacheDirectory, "speech-raw", `${job.cacheKey}.json`),
          message,
        );
      } catch (error) {
        throw new Error("INFERENCE_CONSUMED_RESULT_NOT_PERSISTED", {
          cause: error,
        });
      }
      const raw = message.result;
      const run = c601141DetectorRunSchema.parse(
        hashed141({
          runId: job.runId,
          viewId: job.viewId,
          pcmSha256: job.pcmSha256,
          profileId: job.profileId,
          runtime: job.backend.identity,
          cacheKey: job.cacheKey,
          rawUnit: raw?.rawUnit ?? "SECONDS",
          rawIntervals: raw?.rawIntervals ?? [],
          exclusiveRawIntervals: raw?.exclusiveRawIntervals ?? [],
          nativeIntervals: raw
            ? normalizeDetectorIntervals141(
                raw,
                view,
                Math.round(
                  input.views.sourceIdentity.durationSeconds *
                    input.views.sourceIdentity.sampleRate,
                ),
              )
            : [],
          inferenceConsumed: true,
          resultPersisted: true,
          status: raw ? "SUCCESS" : "FAILED",
          modelLoadDelta: loadDelta,
          providerProcessDelta: processDelta,
          errorCode: raw ? null : (message.code ?? "DETECTOR_FAILED"),
          rawResultHash: hash141(message),
        }),
      );
      await durableJson141(cacheFile, run);
      runs.push(run);
      await durableJson141(
        path.join(input.outputDirectory, `${job.runId}.json`),
        run,
      );
    }
  } catch (error) {
    await durableJson141(
      path.join(
        input.outputDirectory,
        `execution-failure-${randomUUID()}.local-only.json`,
      ),
      {
        schemaVersion: "1.0.0",
        artifactType: "c601141-speech-execution-failure",
        mode: input.mode,
        planHash: hash141(input.jobs),
        inferenceCount: inferences,
        modelReadyCount: loads,
        providerProcessStartCount: processes,
        persistedRunCount: runs.length,
        automaticRetryCount: 0,
        recordedAt: new Date().toISOString(),
        errorCode:
          error instanceof Error ? error.message : "SPEECH_EXECUTION_FAILED",
      },
    );
    throw error;
  } finally {
    for (const worker of workers.values()) await worker.close();
  }
  const artifact = c601141SweepsSchema.parse(
    hashed141({
      ...header141(input.policy, input.views.sourceIdentity),
      artifactType: "machine-whole-media-speech-activity-sweeps",
      mode: input.mode,
      viewsHash: input.views.semanticHash,
      planHash: hash141(input.jobs),
      runs,
      accounting: {
        plannedRuns: input.jobs.length,
        sileroRuns: input.jobs.filter(
          (v) => v.backend.identity.detectorFamily === "SILERO",
        ).length,
        pyannoteRuns: input.jobs.filter(
          (v) => v.backend.identity.detectorFamily === "PYANNOTE",
        ).length,
        inferenceCount: inferences,
        cacheHits,
        cacheMisses: 0,
        modelLoadCount: loads,
        providerProcessStartCount: processes,
        fullMediaAsrCount: 0,
        retryCount: 0,
      },
      evidenceSemanticHash: hash141(runs),
    }),
  );
  await durableJson141(
    path.join(
      input.outputDirectory,
      "machine-whole-media-speech-activity-sweeps.json",
    ),
    artifact,
  );
  return artifact;
}

import path from "node:path";
import {
  access,
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  unlink,
  constants,
} from "node:fs/promises";
import { z } from "zod";
import {
  NodeProcessRunner,
  detectorRuntime142Schema,
  detectorPlan142Schema,
  detectorRun142Schema,
  sweeps142Schema,
  scoreTracks142Schema,
  scoreTrack142Schema,
  webrtcRuntime142Schema,
  type C601141AudioViews,
  type DialogueViews142,
  type ViewAudit142,
  type Policy142,
  type DetectorRuntime142,
  type DetectorJob142,
  type DetectorPlan142,
  type DetectorRun142,
  type WebrtcRuntime142,
  type ProcessRunner,
} from "@mvl/shared";
import {
  detectorPreflight141,
  speechEnvironment141,
  type C601141DetectorPaths,
} from "./c601141-detectors.js";
import {
  hash141,
  hashed141,
  assertHash141,
  id141,
  required141,
  union141,
} from "./c601141-policy.js";
import {
  durableJson141,
  readJson141,
  fileHash141,
  pcm141,
  bytesHash141,
} from "./c601141-io.js";
import { header142, assertBudget142 } from "./c601142-policy.js";
import { decodeScores142, materializeScoreTrack142 } from "./c601142-scores.js";

export interface DetectorBackend142 {
  identity: DetectorRuntime142;
  python: string;
  worker: string;
  model: string;
  library: string | null;
}
export interface DetectorExecution142 {
  runId: string;
  backend: DetectorBackend142;
  audioPath: string;
}
const exists = async (file: string) =>
  access(file).then(
    () => true,
    (e: unknown) => {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      return false;
    },
  );
export async function detectorPreflight142(
  paths: C601141DetectorPaths,
  webrtcDirectory: string,
) {
  const old = await detectorPreflight141(paths),
    helperHash = await fileHash141(
      path.join(
        path.dirname(paths.worker),
        "c601141_speech_activity_worker.py",
      ),
    );
  const backends: DetectorBackend142[] = old.map((b) => {
    const implementationHash = hash141({
      binary: b.identity.binarySha256,
      worker: b.identity.workerSha256,
      helperHash,
    });
    return {
      ...b,
      identity: detectorRuntime142Schema.parse({
        ...b.identity,
        implementationHash,
        runtimeIdentityHash: hash141({
          previous: b.identity.runtimeIdentityHash,
          implementationHash,
        }),
        posteriorCapture:
          b.identity.detectorFamily === "SILERO"
            ? "SILERO_VAD_PROBS"
            : "PYANNOTE_PRE_CONVERSION_POWERSET_ANONYMOUS",
      }),
    };
  });
  const independent = webrtcRuntime142Schema.parse(
    await readJson141(path.join(webrtcDirectory, "runtime-manifest.json")),
  );
  assertHash141(independent);
  if (independent.workerHash !== (await fileHash141(paths.worker)))
    throw new Error("C601142_WEBRTC_WORKER_CHANGED_AFTER_PREPARE");
  if (independent.status === "AVAILABLE") {
    const files = z
      .object({
        python: z.string(),
        module: z.string(),
        implementation: z.string(),
        record: z.string(),
      })
      .strict()
      .parse(
        await readJson141(
          path.join(webrtcDirectory, "runtime-files.local-only.json"),
        ),
      );
    for (const [file, expected] of [
      [files.python, independent.pythonBinaryHash],
      [files.module, independent.moduleHash],
      [files.implementation, independent.implementationHash],
      [files.record, independent.packageRecordHash],
    ])
      if (!file || (await fileHash141(file)) !== expected)
        throw new Error("C601142_WEBRTC_RUNTIME_INTEGRITY_FAILED");
    const identity = detectorRuntime142Schema.parse({
      detectorFamily: "WEBRTC",
      modelId: "webrtcvad-wheels-2.0.14-gmm-vad",
      modelSnapshotHash: independent.implementationHash,
      runtimeIdentityHash: independent.runtimeIdentityHash,
      workerSha256: independent.workerHash,
      binarySha256: independent.implementationHash,
      implementationHash: independent.implementationHash,
      device: "cpu",
      offline: true,
      modelDownloadCount: 0,
      versions: {
        python: independent.pythonVersion,
        "webrtcvad-wheels": independent.packageVersion,
      },
      posteriorCapture: "WEBRTC_BINARY_DECISIONS",
    });
    backends.unshift({
      identity,
      python: files.python,
      worker: paths.worker,
      model: files.implementation,
      library: null,
    });
  }
  return { backends, independent };
}
export function detectorProfile142(
  family: DetectorJob142["family"],
  policy: Policy142,
) {
  return family === "SILERO"
    ? {
        profileId: "c601142-new-view-extra-sensitive-v1",
        threshold: policy.detectors.sileroMainThreshold,
        minSpeechMs: 96,
        minSilenceMs: 80,
        maxSpeechSeconds: 12,
        speechPadMs: 0,
        samplesOverlap: 0,
      }
    : family === "WEBRTC"
      ? policy.detectors.webrtc
      : {
          anonymousUnionOnly: true,
          posteriorCaptureBeforeHardPowersetConversion: true,
          threshold: policy.detectors.pyannoteMainThreshold,
        };
}
export function planDetectors142(input: {
  policy: Policy142;
  oldViews: C601141AudioViews;
  views: DialogueViews142;
  audit: ViewAudit142;
  phaseAHash: string;
  independent: WebrtcRuntime142;
  backends: DetectorBackend142[];
  oldDirectory: string;
  viewDirectory: string;
  frozenAt: string;
}) {
  const { policy } = input;
  [policy, input.views, input.audit, input.oldViews, input.independent].forEach(
    assertHash141,
  );
  const jobs: DetectorJob142[] = [],
    execution: DetectorExecution142[] = [],
    skippedViews: z.infer<typeof detectorPlan142Schema>["skippedViews"] = [];
  const newViews = input.views.views;
  const native = input.oldViews.views.filter(
    (v) => v.role === "NATIVE_MONO" || v.role === "VOICE_BAND_CENTER",
  );
  for (const backend of input.backends) {
    const family = backend.identity.detectorFamily;
    const views = family === "WEBRTC" ? [...native, ...newViews] : newViews;
    for (const view of views) {
      const audited = required141(
        input.audit.rows.find((row) => row.viewId === view.viewId),
      );
      if (
        !audited.detectorEligible ||
        !audited.verifiedTimebase ||
        audited.effectiveNoOp
      ) {
        skippedViews.push({
          role: view.role,
          family,
          reason: audited.rejectionReason ?? "VIEW_NOT_ELIGIBLE",
        });
        continue;
      }
      const profile = detectorProfile142(family, policy),
        profileHash = hash141(profile);
      const mainThreshold =
        family === "WEBRTC"
          ? 1
          : family === "SILERO"
            ? policy.detectors.sileroMainThreshold
            : policy.detectors.pyannoteMainThreshold;
      const auditThreshold =
        family === "WEBRTC"
          ? 1
          : family === "SILERO"
            ? policy.detectors.sileroAuditThreshold
            : policy.detectors.pyannoteAuditThreshold;
      const core = {
        source: input.views.sourceIdentity,
        policyHash: policy.semanticHash,
        family,
        pcmSha256: view.pcmSha256,
        viewId: view.viewId,
        runtime: backend.identity,
        profileHash,
        mainThreshold,
        auditThreshold,
        timeMapping: view.timeMapping,
      };
      const job = {
        runId: id141("detector-ceiling", core),
        cacheKey: hash141(core),
        family,
        viewId: view.viewId,
        viewRole: view.role,
        pcmSha256: view.pcmSha256,
        audioSha256: view.audioSha256,
        frameCount: view.frameCount,
        timeMapping: view.timeMapping,
        runtime: backend.identity,
        profileId: `c601142-${family.toLowerCase()}-frozen-v1`,
        mainThreshold,
        auditThreshold,
        profileHash,
      };
      jobs.push(job);
      execution.push({
        runId: job.runId,
        backend,
        audioPath: path.join(
          native.some((v) => v.viewId === view.viewId)
            ? input.oldDirectory
            : input.viewDirectory,
          view.relativePath,
        ),
      });
    }
  }
  assertBudget142("DETECTOR", jobs.length);
  const plan = detectorPlan142Schema.parse(
    hashed141({
      ...header142(policy, input.views.sourceIdentity),
      artifactType: "machine-c6-0-1-14-2-detector-plan",
      phaseAHash: input.phaseAHash,
      audioViewsHash: input.views.semanticHash,
      viewAuditHash: input.audit.semanticHash,
      independentRuntimeHash: input.independent.semanticHash,
      frozenAt: input.frozenAt,
      jobs,
      skippedViews,
      scorePolicyHash: hash141({
        detectors: policy.detectors,
        masked: policy.masked,
      }),
      runtimeUnavailable: input.independent.status !== "AVAILABLE",
      maximumRuns: 8,
      maximumWebrtc: 4,
      maximumSilero: 2,
      maximumPyannote: 2,
      automaticRetryAllowed: false,
      backfillAllowed: false,
      goldBlind: true,
    }),
  );
  return { plan, execution };
}
export async function reserve142(input: {
  directory: string;
  kind: "DETECTOR" | "ASR";
  requestId: string;
  planHash: string;
  family: string;
  identity: unknown;
}) {
  const directory = path.join(
    input.directory,
    "dispatch",
    input.kind.toLowerCase(),
  );
  await mkdir(directory, { recursive: true });
  const lockFile = path.join(directory, ".reservation.lock"),
    lock = await open(lockFile, "wx", 0o600);
  try {
    const files = (await readdir(directory)).filter((f) => f.endsWith(".json"));
    assertBudget142(input.kind, 1, files.length);
    const tickets = await Promise.all(
      files.map(
        (f) =>
          readJson141(path.join(directory, f)) as Promise<{ family: string }>,
      ),
    );
    const familyLimit =
      input.kind === "ASR" ? 6 : input.family === "WEBRTC" ? 4 : 2;
    if (tickets.filter((t) => t.family === input.family).length >= familyLimit)
      throw new Error("C601142_FAMILY_BUDGET_EXCEEDED");
    await durableJson141(
      path.join(directory, `${hash141(input.requestId)}.json`),
      {
        schemaVersion: "1.0.0",
        artifactType: "machine-c601142-dispatch-ticket",
        requestId: input.requestId,
        kind: input.kind,
        family: input.family,
        planHash: input.planHash,
        identityHash: hash141(input.identity),
        reservedAt: new Date().toISOString(),
        retryAllowed: false,
        inferenceReserved: true,
        visibility: "LOCAL_ONLY",
      },
    );
  } finally {
    await lock.close();
    await unlink(lockFile);
  }
}
const interval = z
  .object({ start: z.number().nonnegative(), end: z.number().nonnegative() })
  .strict();
const rawResult142Schema = z
  .object({
    rawUnit: z.enum(["SECONDS", "CENTISECONDS"]),
    rawIntervals: z.array(interval),
    exclusiveRawIntervals: z.array(interval),
    inputFrames: z.number().int().positive(),
    sampleRate: z.literal(16000),
    device: z.literal("cpu"),
    frameHopSamples16k: z.number().int().positive(),
    frameWindowSamples16k: z.number().int().positive(),
    frameOffsetSamples16k: z.number().int(),
    scoreKind: z.enum(["PROBABILITY", "BINARY_DECISION"]),
    originalChunkScores: scoreTrack142Schema.shape.originalChunkScores,
    scoreSource: z.string(),
    modelLoadCount: z.number().int().nonnegative(),
    scoreRelativePath: z.literal("scores.f32le"),
    scoreSha256: z.string(),
    scoreFrameCount: z.number().int().positive(),
    stateIsolation: z
      .literal("WHISPER_VAD_DETECT_SPEECH_RESETS_LSTM")
      .optional(),
    speakerIdentityPersisted: z.literal(false).optional(),
    embeddingPersisted: z.literal(false).optional(),
    extraModelForwardCount: z.literal(0).optional(),
  })
  .strict();
export const detectorReceipt142Schema = z
  .object({
    status: z.enum(["SUCCESS", "FAILED"]),
    runId: z.string(),
    result: rawResult142Schema.nullable(),
    inferenceConsumed: z.boolean(),
    modelLoadCount: z.number().int().nonnegative(),
    wallClockSeconds: z.number().nonnegative(),
    errorCode: z.string().optional(),
  })
  .strict();
async function verifiedCopy(file: string, output: string, expected: string) {
  if ((await fileHash141(file)) !== expected)
    throw new Error("C601142_CACHED_BINARY_HASH_MISMATCH");
  await mkdir(path.dirname(output), { recursive: true });
  await copyFile(file, output, constants.COPYFILE_EXCL);
  if ((await fileHash141(output)) !== expected)
    throw new Error("C601142_COPIED_BINARY_HASH_MISMATCH");
}
async function normalizeRun(input: {
  job: DetectorJob142;
  policy: Policy142;
  receipt: z.infer<typeof detectorReceipt142Schema>;
  rawDirectory: string;
  outputDirectory: string;
  maximumNativeSample: number;
}) {
  const { job, receipt, policy } = input;
  if (receipt.runId !== job.runId) throw new Error("C601142_WRONG_RUN_RECEIPT");
  const raw = receipt.result,
    prefix = `detector-scores/${job.runId}`;
  let scoreTrack: DetectorRun142["scoreTrack"] = null;
  if (receipt.status === "SUCCESS") {
    if (raw?.inputFrames !== job.frameCount)
      throw new Error("C601142_RESULT_PCM_FRAME_MISMATCH");
    const binary = path.join(input.rawDirectory, raw.scoreRelativePath),
      scores = decodeScores142(await readFile(binary));
    if (scores.length !== raw.scoreFrameCount)
      throw new Error("C601142_SCORE_RECEIPT_FRAME_MISMATCH");
    await verifiedCopy(
      binary,
      path.join(input.outputDirectory, prefix, raw.scoreRelativePath),
      raw.scoreSha256,
    );
    const chunks = raw.originalChunkScores;
    if (chunks)
      await verifiedCopy(
        path.join(input.rawDirectory, chunks.relativePath),
        path.join(input.outputDirectory, prefix, chunks.relativePath),
        chunks.sha256,
      );
    scoreTrack = materializeScoreTrack142({
      job,
      policy,
      scores,
      scoreSha256: raw.scoreSha256,
      relativePath: `${prefix}/${raw.scoreRelativePath}`,
      kind: raw.scoreKind,
      hop: raw.frameHopSamples16k,
      window: raw.frameWindowSamples16k,
      offset: raw.frameOffsetSamples16k,
      maximumNativeSample: input.maximumNativeSample,
      originalChunkScores: chunks
        ? { ...chunks, relativePath: `${prefix}/${chunks.relativePath}` }
        : null,
    });
  }
  const rawIntervals = (raw?.rawIntervals ?? []).map((v) => ({
    start: v.start / (raw?.rawUnit === "CENTISECONDS" ? 100 : 1),
    end: v.end / (raw?.rawUnit === "CENTISECONDS" ? 100 : 1),
  }));
  // Pyannote's authoritative main speech remains the original anonymous
  // pipeline union. The captured soft track is additional audit evidence,
  // not a replacement for its standard/exclusive segmentation algorithm.
  const pyannoteNative = union141(
    rawIntervals
      .map((v) => ({
        startSample: Math.max(
          0,
          Math.round(v.start * job.timeMapping.sourceSampleRate),
        ),
        endSample: Math.min(
          input.maximumNativeSample,
          Math.round(v.end * job.timeMapping.sourceSampleRate),
        ),
      }))
      .filter((v) => v.endSample > v.startSample),
  );
  return detectorRun142Schema.parse(
    hashed141({
      runId: job.runId,
      cacheKey: job.cacheKey,
      jobHash: hash141(job),
      family: job.family,
      runtimeIdentityHash: job.runtime.runtimeIdentityHash,
      viewId: job.viewId,
      pcmSha256: job.pcmSha256,
      status: receipt.status,
      inferenceConsumed: receipt.inferenceConsumed,
      resultPersisted: true,
      modelLoadCount: receipt.modelLoadCount,
      providerProcessStartCount: 1,
      rawResultHash: hash141(receipt),
      rawIntervals,
      exclusiveRawIntervals: raw?.exclusiveRawIntervals ?? [],
      nativeIntervals:
        job.family === "PYANNOTE"
          ? pyannoteNative
          : (scoreTrack?.mainCrossingNativeIntervals ?? []),
      scoreTrack,
      errorCode: receipt.errorCode
        ? "DETECTOR_EXECUTION_FAILED_SEE_LOCAL_RECEIPT"
        : null,
    }),
  );
}
export async function runDetectors142(input: {
  mode: "FRESH" | "EXACT_CACHE_ONLY";
  plan: DetectorPlan142;
  policy: Policy142;
  execution?: DetectorExecution142[];
  cacheDirectory: string;
  outputDirectory: string;
  authorized: boolean;
  runner?: ProcessRunner;
  onProgress?: (event: {
    runId: string;
    family: string;
    status: string;
  }) => void;
}) {
  const { plan, policy } = input;
  [plan, policy].forEach(assertHash141);
  if (
    plan.policyHash !== policy.semanticHash ||
    plan.scorePolicyHash !==
      hash141({ detectors: policy.detectors, masked: policy.masked })
  )
    throw new Error("C601142_FROZEN_POLICY_CHANGED");
  if (input.mode === "FRESH" && !input.authorized)
    throw new Error("C601142_DETECTOR_AUTHORIZATION_REQUIRED");
  assertBudget142("DETECTOR", plan.jobs.length);
  const runs: DetectorRun142[] = [];
  const accounting = {
    plannedRuns: plan.jobs.length,
    inferenceCount: 0,
    cacheHits: 0,
    cacheMisses: 0,
    modelLoadCount: 0,
    providerProcessStartCount: 0,
    webrtcRuns: 0,
    sileroRuns: 0,
    pyannoteRuns: 0,
    persistedResultCount: 0,
    failedCount: 0,
    retryCount: 0 as const,
    backfillCount: 0 as const,
    fullMediaAsrCount: 0 as const,
    networkRequestCount: 0 as const,
  };
  for (const job of plan.jobs) {
    const rawDirectory = path.join(
        input.cacheDirectory,
        "detector-raw",
        job.cacheKey,
      ),
      receiptPath = path.join(rawDirectory, "result-receipt.json"),
      bindingPath = path.join(rawDirectory, "cache-binding.json");
    let receipt: z.infer<typeof detectorReceipt142Schema>;
    if (await exists(receiptPath)) {
      receipt = detectorReceipt142Schema.parse(await readJson141(receiptPath));
      if (!(await exists(bindingPath)) && input.mode === "FRESH") {
        // A parent may die after the child fsynced its receipt. Recover that
        // exact result using the earlier write-once dispatch, never re-infer.
        const ticket = (await readJson141(
          path.join(
            input.cacheDirectory,
            "dispatch/detector",
            `${hash141(job.runId)}.json`,
          ),
        )) as { planHash: string; identityHash: string; requestId: string };
        if (
          ticket.planHash !== plan.semanticHash ||
          ticket.identityHash !== hash141(job) ||
          ticket.requestId !== receipt.runId
        )
          throw new Error("C601142_RECOVERY_TICKET_MISMATCH");
        await durableJson141(bindingPath, {
          planHash: plan.semanticHash,
          jobHash: hash141(job),
          receiptHash: hash141(receipt),
        });
      }
      const binding = z
        .object({
          planHash: z.string(),
          jobHash: z.string(),
          receiptHash: z.string(),
        })
        .strict()
        .parse(await readJson141(bindingPath));
      if (
        binding.planHash !== plan.semanticHash ||
        binding.jobHash !== hash141(job) ||
        binding.receiptHash !== hash141(receipt)
      )
        throw new Error("C601142_DETECTOR_CACHE_BINDING_MISMATCH");
      accounting.cacheHits++;
    } else {
      accounting.cacheMisses++;
      if (input.mode === "EXACT_CACHE_ONLY")
        throw new Error("C601142_DETECTOR_CACHE_ONLY_MISS_NO_PROVIDER_START");
      const execution = required141(
        input.execution?.find((v) => v.runId === job.runId),
      );
      if (
        hash141(execution.backend.identity) !== hash141(job.runtime) ||
        (await fileHash141(execution.backend.worker)) !==
          job.runtime.workerSha256
      )
        throw new Error("C601142_DETECTOR_RUNTIME_CHANGED");
      const bytes = await readFile(execution.audioPath),
        pcm = pcm141(bytes);
      if (
        bytesHash141(bytes) !== job.audioSha256 ||
        bytesHash141(pcm.pcm) !== job.pcmSha256 ||
        pcm.frames !== job.frameCount ||
        pcm.sampleRate !== 16000 ||
        pcm.channels !== 1
      )
        throw new Error("C601142_DETECTOR_INPUT_IDENTITY_MISMATCH");
      await mkdir(rawDirectory, { recursive: true });
      const requestPath = path.join(rawDirectory, "request.local-only.json");
      await durableJson141(requestPath, {
        runId: job.runId,
        family: job.family,
        audioPath: execution.audioPath,
        model: execution.backend.model,
        library: execution.backend.library,
        profile: detectorProfile142(job.family, policy),
        scoreDirectory: rawDirectory,
        authorized: true,
        dispatchReserved: true,
      });
      await reserve142({
        directory: input.cacheDirectory,
        kind: "DETECTOR",
        requestId: job.runId,
        planHash: plan.semanticHash,
        family: job.family,
        identity: job,
      });
      input.onProgress?.({
        runId: job.runId,
        family: job.family,
        status: "DISPATCH_RESERVED",
      });
      accounting.providerProcessStartCount++;
      let transportError: string | null = null;
      try {
        const result = await (input.runner ?? new NodeProcessRunner()).run(
          execution.backend.python,
          [execution.backend.worker, "--request", requestPath],
          {
            timeoutMs: 7200000,
            allowNonZero: true,
            environment: speechEnvironment141(execution.backend.library),
          },
        );
        await durableJson141(
          path.join(rawDirectory, "transport-receipt.local-only.json"),
          result,
        );
      } catch (error) {
        transportError = String(error);
      }
      if (!(await exists(receiptPath))) {
        const lost = detectorRun142Schema.parse(
          hashed141({
            runId: job.runId,
            cacheKey: job.cacheKey,
            jobHash: hash141(job),
            family: job.family,
            runtimeIdentityHash: job.runtime.runtimeIdentityHash,
            viewId: job.viewId,
            pcmSha256: job.pcmSha256,
            status: "INFERENCE_CONSUMED_RESULT_NOT_PERSISTED",
            inferenceConsumed: true,
            resultPersisted: false,
            modelLoadCount: job.family === "WEBRTC" ? 0 : 1,
            providerProcessStartCount: 1,
            rawResultHash: hash141({ transportError }),
            rawIntervals: [],
            exclusiveRawIntervals: [],
            nativeIntervals: [],
            scoreTrack: null,
            errorCode: "INFERENCE_CONSUMED_RESULT_NOT_PERSISTED",
          }),
        );
        await durableJson141(
          path.join(input.outputDirectory, `${job.runId}-lost-result.json`),
          lost,
        );
        throw new Error(
          "C601142_INFERENCE_CONSUMED_RESULT_NOT_PERSISTED_NO_RETRY",
        );
      }
      receipt = detectorReceipt142Schema.parse(await readJson141(receiptPath));
      await durableJson141(bindingPath, {
        planHash: plan.semanticHash,
        jobHash: hash141(job),
        receiptHash: hash141(receipt),
      });
      accounting.inferenceCount += Number(receipt.inferenceConsumed);
      accounting.modelLoadCount += receipt.modelLoadCount;
      if (receipt.inferenceConsumed)
        accounting[
          job.family === "WEBRTC"
            ? "webrtcRuns"
            : job.family === "SILERO"
              ? "sileroRuns"
              : "pyannoteRuns"
        ]++;
    }
    const run = await normalizeRun({
      job,
      policy,
      receipt,
      rawDirectory,
      outputDirectory: input.outputDirectory,
      maximumNativeSample: Math.round(
        plan.sourceIdentity.durationSeconds * plan.sourceIdentity.sampleRate,
      ),
    });
    runs.push(run);
    accounting.persistedResultCount++;
    accounting.failedCount += Number(run.status !== "SUCCESS");
    await durableJson141(
      path.join(input.outputDirectory, "runs", `${job.runId}.json`),
      run,
    );
    input.onProgress?.({
      runId: job.runId,
      family: job.family,
      status: run.status,
    });
  }
  const evidenceSemanticHash = hash141({ planHash: plan.semanticHash, runs });
  const sweeps = sweeps142Schema.parse(
    hashed141({
      ...header142(policy, plan.sourceIdentity),
      artifactType: "machine-independent-speech-presence-sweeps",
      mode: input.mode,
      planHash: plan.semanticHash,
      runs,
      accounting,
      evidenceSemanticHash,
    }),
  );
  const scores = scoreTracks142Schema.parse(
    hashed141({
      ...header142(policy, plan.sourceIdentity),
      artifactType: "machine-speech-detector-score-tracks-v1",
      planHash: plan.semanticHash,
      tracks: runs.flatMap((r) => (r.scoreTrack ? [r.scoreTrack] : [])),
      scorePolicyHash: plan.scorePolicyHash,
      rawScoresPreserved: true,
      postGoldThresholdChangeCount: 0,
    }),
  );
  await durableJson141(
    path.join(
      input.outputDirectory,
      "machine-independent-speech-presence-sweeps.json",
    ),
    sweeps,
  );
  await durableJson141(
    path.join(
      input.outputDirectory,
      "machine-speech-detector-score-tracks-v1.json",
    ),
    scores,
  );
  return { sweeps, scores };
}

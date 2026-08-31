/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Validate pinned literal values across runtime trust boundaries. */
import { mkdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  atomicWriteJson,
  NodeProcessRunner,
  mvlWhisperServerResponseSchema,
  whisperRuntimeBuildManifestSchema,
  type C60114ProbeRuntime,
  type C60114SourceIdentity,
  type C60114ProbeToken,
  type SubtitleCue,
} from "@mvl/shared";
import { WhisperCppWorkerPool } from "@mvl/transcription-core";
import { sha256LocalFile } from "../finalization-support.js";
import { inspectReviewWav, resolveReviewAudio } from "../review-audio.js";
import { machineQualitySemanticHash } from "../machine-quality/evidence-correlation.js";
import {
  loadReazonK2ModelIdentity,
  ReazonSpeechK2Provider,
} from "../machine-quality/reazonspeech-k2-provider.js";
import { buildGlobalTokenTimeline } from "../machine-quality/global-token-timeline.js";
import { buildAsrRequestTimelineContract } from "../machine-quality/request-timeline-contract.js";
import {
  assertC60114ProbePersistenceSchema,
  writeC60114ProbeJournal,
  writeC60114ProbeCacheManifest,
} from "./c60114-probe-persistence.js";
import {
  executeC60114ProbePlan,
  C60114ProbeReplayError,
  assertC60114ProbeBudget,
  type C60114ProbePlanInput,
  type C60114ProbeRuntimeAdapter,
  type C60114ProbeRawResult,
} from "./missing-dialogue-local-probe.js";

export interface C60114LocalRuntimeInput {
  sourcePath: string;
  sourceIdentity: C60114SourceIdentity;
  whisperRuntimeManifestPath: string;
  whisperModelPath: string;
  whisperModelSha256: string;
  reazonModelDirectory: string;
  reazonPython: string;
  reazonRuntimeManifestPath?: string;
  reazonModelManifestPath?: string;
  ffmpegPath?: string;
  ffprobePath?: string;
  outputDirectory: string;
  reazonWorkerPath?: string;
  exactSampleExtraction?: boolean;
  retryOnFailure?: boolean;
}

export async function createC60114LocalProbeRuntime(
  input: C60114LocalRuntimeInput,
): Promise<C60114ProbeRuntimeAdapter> {
  if (process.env.MVL_C60114_EXISTING_PROBES_ONLY === "1")
    throw new Error("C60114_REPLAY_ONLY_PROVIDER_RUNTIME_FORBIDDEN");
  assertC60114ProbePersistenceSchema();
  const runner = new NodeProcessRunner();
  const sourceStat = await stat(input.sourcePath);
  if (
    !sourceStat.isFile() ||
    /\.(?:wav|mp3|flac|m4a|json|srt|ass|vtt)$/iu.test(input.sourcePath) ||
    (await sha256LocalFile(input.sourcePath)) !==
      input.sourceIdentity.sourceMediaSha256
  )
    throw new Error("C60114_SOURCE_VIDEO_IDENTITY_MISMATCH");
  const probe = await runner.run(
    input.ffprobePath ??
      (input.ffmpegPath
        ? path.join(path.dirname(input.ffmpegPath), "ffprobe")
        : "ffprobe"),
    [
      "-v",
      "error",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      input.sourcePath,
    ],
    { timeoutMs: 30000 },
  );
  const sourceMetadata = JSON.parse(probe.stdout) as {
    streams: {
      index: number;
      codec_type: string;
      sample_rate?: string;
      time_base?: string;
    }[];
    format: { duration: string };
  };
  const stream = sourceMetadata.streams.find(
    (stream) =>
      stream.index === input.sourceIdentity.audioStreamIndex &&
      stream.codec_type === "audio",
  );
  if (
    !sourceMetadata.streams.some((stream) => stream.codec_type === "video") ||
    !stream ||
    Number(stream.sample_rate) !== input.sourceIdentity.sampleRate ||
    stream.time_base !== input.sourceIdentity.audioTimebase ||
    Math.abs(
      Number(sourceMetadata.format.duration) -
        input.sourceIdentity.durationSeconds,
    ) > 0.01
  )
    throw new Error("C60114_SOURCE_STREAM_OR_TIMEBASE_MISMATCH");
  const manifest = whisperRuntimeBuildManifestSchema.parse(
    JSON.parse(await readFile(input.whisperRuntimeManifestPath, "utf8")),
  );
  if (
    !manifest.patch.patchFiles?.some(
      (file) => file.path === "0003-mvl-untimed-token-evidence-guard.patch",
    ) ||
    !manifest.patch.patchFiles?.some(
      (file) => file.path === "0002-mvl-request-state-reset.patch",
    )
  )
    throw new Error("C60114_WHISPER_PATCH_IDENTITY_UNSAFE");
  const binary = path.resolve(
    path.dirname(input.whisperRuntimeManifestPath),
    manifest.patched.binaryRelativePath,
  );
  const [binarySha256, modelSha256, manifestSha256] = await Promise.all([
    sha256LocalFile(binary),
    sha256LocalFile(input.whisperModelPath),
    sha256LocalFile(input.whisperRuntimeManifestPath),
  ]);
  if (
    binarySha256 !== manifest.patched.binarySha256 ||
    modelSha256 !== input.whisperModelSha256 ||
    path.basename(input.whisperModelPath) !== "ggml-large-v3.bin"
  )
    throw new Error("C60114_WHISPER_BINARY_OR_MODEL_MISMATCH");
  const reazonIdentity = await loadReazonK2ModelIdentity(
    input.reazonModelDirectory,
  );
  const worker =
    input.reazonWorkerPath ??
    fileURLToPath(
      new URL(
        "../../../../scripts/runtime/reazonspeech_k2_worker.py",
        import.meta.url,
      ),
    );
  const [workerSha256, pythonBinarySha256] = await Promise.all([
    sha256LocalFile(worker),
    sha256LocalFile(input.reazonPython),
  ]);
  // Metadata-only preflight. No model is constructed by this Python command.
  const version = await runner.run(
    input.reazonPython,
    [
      "-c",
      "import importlib.metadata as m,json,platform; print(json.dumps({'sherpa':m.version('sherpa-onnx'),'python':platform.python_version()}))",
    ],
    { timeoutMs: 15000 },
  );
  const versions = JSON.parse(version.stdout) as {
    sherpa: string;
    python: string;
  };
  if (versions.sherpa !== "1.13.6")
    throw new Error("C60114_REAZON_SHERPA_VERSION_MISMATCH");
  const reazonManifestIdentity = {
    modelIdentity: reazonIdentity,
    workerSha256,
    pythonBinarySha256,
    sherpaOnnxVersion: versions.sherpa,
    pythonVersion: versions.python,
    precision: "fp32",
    device: "cpu",
    threads: 1,
  };
  if (input.reazonModelManifestPath) {
    const stored = JSON.parse(
      await readFile(input.reazonModelManifestPath, "utf8"),
    ) as {
      modelSnapshotHash?: string;
      modelIdentity?: { modelSnapshotHash?: string };
    };
    if (
      (stored.modelSnapshotHash ?? stored.modelIdentity?.modelSnapshotHash) !==
      reazonIdentity.modelSnapshotHash
    )
      throw new Error("C60114_REAZON_MODEL_MANIFEST_MISMATCH");
  }
  if (input.reazonRuntimeManifestPath) {
    const stored = JSON.parse(
      await readFile(input.reazonRuntimeManifestPath, "utf8"),
    ) as {
      modelIdentity?: { modelSnapshotHash?: string };
      runtimeIdentity?: { sherpaOnnxVersion?: string };
    };
    if (
      stored.modelIdentity?.modelSnapshotHash !==
        reazonIdentity.modelSnapshotHash ||
      stored.runtimeIdentity?.sherpaOnnxVersion !== versions.sherpa
    )
      throw new Error("C60114_REAZON_RUNTIME_MANIFEST_MISMATCH");
  }
  const identities: C60114ProbeRuntime[] = [
    {
      provider: "whisper-large-v3",
      modelId: "whisper-large-v3",
      modelRevision: modelSha256,
      modelIdentityHash: machineQualitySemanticHash({
        model: "large-v3",
        modelSha256,
      }),
      runtimeIdentityHash: machineQualitySemanticHash({
        binarySha256,
        patch: manifest.patch.patchSha256,
        build: manifest.build.flagsHash,
        upstream: manifest.upstream.commit,
      }),
      modelFileHashes: { "ggml-large-v3.bin": modelSha256 },
      manifestSha256,
      binarySha256,
      workerSha256: null,
      precision: "ggml-f16",
      device: "metal",
      verified: true,
    },
    {
      provider: "reazonspeech-k2-v2",
      modelId: reazonIdentity.modelId,
      modelRevision: reazonIdentity.modelRevision,
      modelIdentityHash: machineQualitySemanticHash(reazonIdentity),
      runtimeIdentityHash: machineQualitySemanticHash(reazonManifestIdentity),
      modelFileHashes: Object.fromEntries(
        reazonIdentity.modelFiles.map((file) => [file.fileName, file.sha256]),
      ),
      manifestSha256: machineQualitySemanticHash(reazonManifestIdentity),
      binarySha256: pythonBinarySha256,
      workerSha256,
      precision: "fp32",
      device: "cpu",
      verified: true,
    },
  ];
  const whisper = new WhisperCppWorkerPool({
    retryOnFailure: input.retryOnFailure,
    mode: "persistent",
    stateIsolation: "require-safe",
  });
  const reazon = new ReazonSpeechK2Provider({
    pythonExecutable: input.reazonPython,
    workerScriptPath: worker,
    modelDirectory: input.reazonModelDirectory,
  });
  let reazonLoads = 0;
  let reazonStarts = 0;
  return {
    identities,
    async extract(request) {
      if (input.exactSampleExtraction === true) {
        const sampleCount = Math.round(
          (request.extractionInterval.end - request.extractionInterval.start) *
            16000,
        );
        const audioPath = path.join(
          input.outputDirectory,
          "audio",
          "review",
          `c60114-${request.extractionIdentityHash}.wav`,
        );
        await mkdir(path.dirname(audioPath), { recursive: true });
        // The established C60111 recipe drains the resampler then limits actual
        // decoded source samples. It never pads, recrops an old WAV, or widens
        // the audio delivered to a model beyond the frozen extraction interval.
        await runner.run(
          input.ffmpegPath ?? "ffmpeg",
          [
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            request.extractionInterval.start.toFixed(6),
            "-i",
            input.sourcePath,
            "-map",
            `0:${input.sourceIdentity.audioStreamIndex}`,
            "-vn",
            "-af",
            `aresample=16000,atrim=start_sample=0:end_sample=${sampleCount},asetpts=N/SR/TB`,
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            audioPath,
          ],
          { timeoutMs: 30000 },
        );
        const wav = inspectReviewWav(await readFile(audioPath));
        if (
          wav.frameCount !== sampleCount ||
          wav.sampleRate !== 16000 ||
          wav.channelCount !== 1 ||
          wav.bitsPerSample !== 16
        )
          throw new Error("C60114_EXACT_SAMPLE_EXTRACTION_FAILED");
        return {
          audioPath,
          audioSha256: await sha256LocalFile(audioPath),
          sampleCount,
        };
      }
      const extraction = await resolveReviewAudio({
        mode: "generate",
        reviewId: `c60114-${request.extractionIdentityHash}`,
        componentId: request.targetId,
        componentUnionInterval: request.extractionInterval,
        mediaDurationSeconds: input.sourceIdentity.durationSeconds,
        targetSubtitleDirectory: input.outputDirectory,
        sourceVideoPath: input.sourcePath,
        runner,
        ffmpegPath: input.ffmpegPath ?? "ffmpeg",
        audioStreamIndex: input.sourceIdentity.audioStreamIndex,
        contextSeconds: 0,
        maximumSeconds: 15,
      });
      if (
        extraction.validationStatus !== "validated" ||
        extraction.sha256 === null ||
        extraction.frameCount === null ||
        extraction.sampleRate !== 16000 ||
        extraction.extractedInterval === null ||
        Math.abs(
          extraction.extractedInterval.start - request.extractionInterval.start,
        ) > 0.001 ||
        Math.abs(
          extraction.extractedInterval.end - request.extractionInterval.end,
        ) > 0.001
      )
        throw new Error("C60114_EXTRACTED_SOURCE_TIMEBASE_MISMATCH");
      const audioPath = path.join(
        input.outputDirectory,
        "audio",
        "review",
        `c60114-${request.extractionIdentityHash}.wav`,
      );
      const wav = inspectReviewWav(await readFile(audioPath));
      if (
        wav.channelCount !== 1 ||
        wav.bitsPerSample !== 16 ||
        wav.sampleRate !== 16000
      )
        throw new Error("C60114_AUDIO_FORMAT_MISMATCH");
      return {
        audioPath,
        audioSha256: extraction.sha256,
        sampleCount: extraction.frameCount,
      };
    },
    async transcribe(request, audio): Promise<C60114ProbeRawResult> {
      if (request.prompt !== "" || request.vadEnabled)
        throw new Error("C60114_PROMPT_ISOLATION_FAILED");
      if (request.provider === "reazonspeech-k2-v2") {
        const batch = await reazon.transcribeBatch([
          {
            requestId: request.requestId,
            eventId: request.targetId,
            diagnosticRole: "TARGET",
            windowType: request.windowType,
            sourceInterval: request.extractionInterval,
            sourceMediaSha256: request.sourceMediaSha256,
            audioPath: audio.audioPath,
            audioSha256: audio.audioSha256,
            sampleRate: 16000,
            sampleCount: audio.sampleCount,
            extractionConfigHash: request.extractionIdentityHash,
          },
        ]);
        await writeC60114ProbeJournal({
          directory: input.outputDirectory,
          sourceIdentity: input.sourceIdentity,
          request,
          phase: "PROVIDER_RAW",
          payload: batch,
        });
        reazonLoads = Math.max(reazonLoads, batch.diagnostics.modelLoadCount);
        reazonStarts = Math.max(
          reazonStarts,
          batch.diagnostics.processStartCount,
        );
        if (batch.diagnostics.sherpaOnnxVersion !== "1.13.6")
          throw new Error("C60114_REAZON_RUNTIME_DRIFT");
        const result = batch.results[0];
        if (result?.requestId !== request.requestId)
          throw new Error("C60114_REAZON_RESPONSE_ID_MISMATCH");
        // RNNT emits points, not word spans. Never manufacture end times from
        // next-point midpoints, character ratios, or the enclosing core.
        const tokens: C60114ProbeToken[] = result.tokenPoints.map((point) => ({
          text: point.token,
          sourceInterval: null,
          trusted: false,
          probability: null,
          reason: "RNNT_POINT_TIMESTAMP_NOT_VERIFIED_INTERVAL",
        }));
        return {
          inferenceExecuted:
            result.status === "SUCCESS" || result.status === "EMPTY_OUTPUT",
          status:
            result.status === "SUCCESS" || result.status === "EMPTY_OUTPUT"
              ? result.status
              : "PROVIDER_ERROR",
          text: result.text,
          rawOutput: JSON.parse(
            JSON.stringify(result),
          ) as C60114ProbeRawResult["rawOutput"],
          tokens,
          decoder: {
            averageLogProbability: null,
            noSpeechProbability: null,
            temperature: null,
          },
          warnings: result.warnings,
          wallClockSeconds: result.wallClockSeconds,
        };
      }
      const started = performance.now();
      const decoded = await whisper.transcribe({
        request: {
          audioPath: audio.audioPath,
          chunk: {
            id: request.requestId,
            relativePath: path.basename(audio.audioPath),
            start: request.extractionInterval.start,
            end: request.extractionInterval.end,
            duration: audio.sampleCount / 16000,
            sha256: audio.audioSha256,
          },
          language: "ja",
          timestampStrategy: "segment",
          tokenTimestamps: true,
        },
        capability: {
          executablePath: binary,
          serverPath: binary,
          modelPath: input.whisperModelPath,
          modelHash: modelSha256,
          whisperCppVersion: manifest.upstream.tag.replace(/^v/u, ""),
          coreML: false,
          threads: Math.min(8, Math.max(1, os.cpus().length - 2)),
          language: "ja",
          useVad: false,
          vadProfile: "sensitive-v2",
          tokenTimestamps: true,
          promptConstraint: "clean-prompt-null",
          timestampRuntimePolicy: "require-mapped",
          rawVadPolicy: "off",
          mvlResponseSchemaVersion: manifest.patch.responseSchema,
          expectedMvlRuntime: {
            upstreamCommit: manifest.upstream.commit,
            patchId: manifest.patch.patchId,
            patchSha256: manifest.patch.patchSha256,
            binarySha256,
            buildFlagsHash: manifest.build.flagsHash,
          },
        },
        initialPrompt: null,
        processFallback: () =>
          Promise.reject(new Error("C60114_PROCESS_FALLBACK_FORBIDDEN")),
      });
      await writeC60114ProbeJournal({
        directory: input.outputDirectory,
        sourceIdentity: input.sourceIdentity,
        request,
        phase: "PROVIDER_RAW",
        payload: decoded.raw,
      });
      const response = mvlWhisperServerResponseSchema.parse(
        (decoded.raw as { mvlResponse?: unknown }).mvlResponse,
      );
      const contract = buildAsrRequestTimelineContract({
        sourceMediaSha256: request.sourceMediaSha256,
        recovery: {
          units: [
            {
              id: request.targetId,
              interval: request.coreInterval,
              extractedInterval: request.extractionInterval,
              attempts: [
                {
                  asrRequestId: request.requestId,
                  vadEnabled: false,
                  cacheKey: request.cacheKey,
                },
              ],
            },
          ],
        },
      });
      const cues: SubtitleCue[] = response.transcription.map(
        (segment) =>
          ({
            id: `${request.requestId}:${segment.id}`,
            start: request.extractionInterval.start + segment.startSeconds,
            end: request.extractionInterval.start + segment.endSeconds,
            text: segment.text,
            language: "ja",
            provenance: { sourceRequestIds: [request.requestId] },
            timingEvidence: {
              tokens: segment.tokens
                .filter((token) => !token.special && token.mapped !== null)
                .map((token) => ({
                  text: token.text,
                  start:
                    request.extractionInterval.start +
                    (token.mapped?.startCentiseconds ?? 0) / 100,
                  end:
                    request.extractionInterval.start +
                    (token.mapped?.endCentiseconds ?? 0) / 100,
                  probability: token.probability,
                })),
            },
          }) as SubtitleCue,
      );
      const timeline = buildGlobalTokenTimeline({
        cues,
        requestContract: contract,
        mode: "enforce",
      });
      const tokens = timeline.tokens.map((token) => ({
        text: token.text,
        sourceInterval: token.globalInterval,
        trusted: token.trusted,
        probability: null,
        reason: token.reasons.join(";"),
      }));
      return {
        status: response.text.trim() ? "SUCCESS" : "EMPTY_OUTPUT",
        text: response.text,
        rawOutput: JSON.parse(
          JSON.stringify(response),
        ) as C60114ProbeRawResult["rawOutput"],
        tokens,
        decoder: {
          averageLogProbability: response.transcription.length
            ? response.transcription.reduce(
                (sum, segment) => sum + segment.avgLogProbability,
                0,
              ) / response.transcription.length
            : null,
          noSpeechProbability: response.transcription.length
            ? Math.max(
                ...response.transcription.map(
                  (segment) => segment.noSpeechProbability,
                ),
              )
            : null,
          temperature: response.transcription.length
            ? Math.max(
                ...response.transcription.map((segment) => segment.temperature),
              )
            : null,
        },
        warnings: [],
        wallClockSeconds: (performance.now() - started) / 1000,
      };
    },
    counts() {
      const metrics = whisper.metrics();
      return {
        modelLoadCount: metrics.modelLoadCount + reazonLoads,
        processStartCount: metrics.workerStartCount + reazonStarts,
        perProvider: {
          "whisper-large-v3": {
            modelLoadCount: metrics.modelLoadCount,
            processStartCount: metrics.workerStartCount,
          },
          "reazonspeech-k2-v2": {
            modelLoadCount: reazonLoads,
            processStartCount: reazonStarts,
          },
        },
      };
    },
    async close() {
      await Promise.all([whisper.close(), reazon.close()]);
      const after = await stat(input.sourcePath);
      if (
        after.size !== sourceStat.size ||
        after.mtimeMs !== sourceStat.mtimeMs ||
        after.ino !== sourceStat.ino
      )
        throw new Error("C60114_SOURCE_MUTATED_DURING_PROBES");
    },
  };
}

export async function runMissingDialogueLocalProbes(
  input: Omit<C60114ProbePlanInput, "adapter"> & C60114LocalRuntimeInput,
) {
  assertC60114ProbeBudget(input);
  const adapter = await createC60114LocalProbeRuntime(input);
  let artifact;
  try {
    artifact = await executeC60114ProbePlan({ ...input, adapter });
  } catch (error) {
    if (error instanceof C60114ProbeReplayError)
      await atomicWriteJson(
        path.join(input.outputDirectory, "missing-dialogue-local-probe.json"),
        error.artifact,
        { overwrite: true },
      );
    throw error;
  }
  await atomicWriteJson(
    path.join(input.outputDirectory, "missing-dialogue-local-probe.json"),
    artifact,
    { overwrite: true },
  );
  await writeC60114ProbeCacheManifest({
    artifact,
    cacheDirectory: input.cacheDirectory,
    outputDirectory: input.outputDirectory,
  });
  return artifact;
}

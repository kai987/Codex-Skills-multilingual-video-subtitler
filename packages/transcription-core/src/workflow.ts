import path from "node:path";

import {
  atomicWriteJson,
  pathExists,
  portableTranscriptionChunkResultSchema,
  readJson,
  type SubtitleCue,
} from "@mvl/shared";

import { extractAudioChunks } from "./audio.js";
import {
  canonicalizeAsrSegments,
  canonicalUtterancesToCues,
  rawEvidenceFromResult,
} from "./canonical.js";
import type {
  TranscriptionChunkResult,
  TranscriptionWorkflowOptions,
  TranscriptionWorkflowResult,
} from "./types.js";
import {
  buildLegacyBaselineCacheKeyV1,
  buildPortableAsrCacheIdentityV2,
} from "./asr-cache.js";

const cachedResultSchema = portableTranscriptionChunkResultSchema;

function promptFor(names: readonly string[], previousText: string): string {
  const context = [
    "Transcribe only speech that is audibly present. Preserve the original spoken language; do not translate.",
    "Do not invent dialogue for silence or inaudible audio. Preserve natural punctuation and code-switching.",
    names.length === 0 ? "" : `Confirmed names and terms: ${names.join(", ")}.`,
    previousText === ""
      ? ""
      : `Previous segment context: ${previousText.slice(-800)}`,
  ];
  return context.filter(Boolean).join(" ");
}

export async function transcribeMedia(
  options: TranscriptionWorkflowOptions,
): Promise<TranscriptionWorkflowResult> {
  const ffmpegPath = options.ffmpegPath ?? process.env.FFMPEG_PATH ?? "ffmpeg";
  const audioDirectory = path.join(options.outputDirectory, "audio");
  const timestampStrategy = options.timestampStrategy ?? "chunk";
  const manifest = await extractAudioChunks({
    mediaPath: options.mediaPath,
    audioDirectory,
    audioStreamIndex: options.audioStreamIndex,
    durationSeconds: options.durationSeconds,
    runner: options.runner,
    logger: options.logger,
    ffmpegPath,
    targetChunkSeconds: options.targetChunkSeconds ?? 480,
    silenceThresholdDb: options.silenceThresholdDb ?? -35,
    silenceMinimumSeconds: options.silenceMinimumSeconds ?? 0.35,
    overwrite: options.overwrite ?? false,
  });
  const rawChunks: {
    chunkId: string;
    start: number;
    end: number;
    cacheHit: boolean;
    result: TranscriptionChunkResult;
  }[] = [];
  let previousText = "";
  let cacheHits = 0;
  let transcribedChunks = 0;
  for (const chunk of manifest.chunks) {
    const prompt = promptFor(options.promptNames ?? [], previousText);
    const legacyInput = {
      sha256: chunk.sha256,
      interval: { start: chunk.start, end: chunk.end },
      adapterId: options.adapter.id,
      model: options.adapter.model,
      modelHash: options.adapter.runtime?.modelHash ?? null,
      modelFamily: options.adapter.runtime?.modelFamily ?? null,
      coreML: options.adapter.runtime?.coreML ?? null,
      whisperCppVersion: options.adapter.runtime?.whisperCppVersion ?? null,
      prompt,
      timestampStrategy,
    };
    const key = buildLegacyBaselineCacheKeyV1(legacyInput);
    const cachePath = path.join(
      audioDirectory,
      "transcription-cache",
      `${key}.json`,
    );
    let result: TranscriptionChunkResult;
    let cacheHit = false;
    const portableIdentity = buildPortableAsrCacheIdentityV2({
      audioContentSha256: chunk.sha256,
      interval: { start: chunk.start, end: chunk.end },
      sampleRate: manifest.sampleRate,
      channels: manifest.channels,
      codec: "pcm_s16le",
      adapterId: options.adapter.id,
      model: options.adapter.model,
      modelHash: options.adapter.runtime?.modelHash ?? null,
      modelFamily: options.adapter.runtime?.modelFamily ?? null,
      coreML: options.adapter.runtime?.coreML ?? null,
      whisperCppVersion: options.adapter.runtime?.whisperCppVersion ?? null,
      language: options.language ?? null,
      vadMode: options.adapter.id.includes("no-vad")
        ? "no-vad"
        : "adapter-default",
      timestampStrategy,
      tokenTimestamps: false,
      prompt,
      decodeConfiguration: {
        language: options.language ?? null,
        timestampStrategy,
        tokenTimestamps: false,
      },
    });
    const portable =
      options.asrCache === undefined
        ? null
        : await options.asrCache.lookup({
            requestId: `baseline:${chunk.id}`,
            requestType: "baseline",
            identity: portableIdentity,
            legacyKeys: [key],
          });
    if (portable?.hit === true && portable.result !== null) {
      result = portable.result;
      cacheHits += 1;
      cacheHit = true;
    } else if (await pathExists(cachePath)) {
      result = cachedResultSchema.parse(await readJson(cachePath));
      cacheHits += 1;
      cacheHit = true;
      await options.asrCache?.store({
        requestId: `baseline:${chunk.id}`,
        requestType: "baseline",
        identity: portableIdentity,
        legacyKeys: [key],
        result,
      });
    } else {
      result = cachedResultSchema.parse(
        await options.adapter.transcribe({
          audioPath: path.join(audioDirectory, chunk.relativePath),
          chunk,
          timestampStrategy,
          ...(options.language === undefined
            ? {}
            : { language: options.language }),
          prompt,
        }),
      );
      await atomicWriteJson(cachePath, result);
      await options.asrCache?.store({
        requestId: `baseline:${chunk.id}`,
        requestType: "baseline",
        identity: portableIdentity,
        legacyKeys: [key],
        result,
      });
      transcribedChunks += 1;
    }
    previousText = result.text;
    rawChunks.push({
      chunkId: chunk.id,
      start: chunk.start,
      end: chunk.end,
      cacheHit,
      result,
    });
  }
  const rawSegments = rawChunks.flatMap((entry) =>
    rawEvidenceFromResult({
      result: entry.result,
      adapterId: options.adapter.id,
      chunkId: entry.chunkId,
      globalStart: entry.start,
      ...(options.language === undefined ? {} : { language: options.language }),
    }),
  );
  const canonicalUtterances = canonicalizeAsrSegments({
    segments: rawSegments,
    speechIntervals: options.speechIntervals ?? [],
    sceneBoundaries: options.sceneBoundaries ?? [],
    timingConfig: options.timingConfig,
  });
  const cues: SubtitleCue[] = canonicalUtterancesToCues(canonicalUtterances);
  for (const boundary of rawChunks.slice(1).map((entry) => entry.start)) {
    const previousCue = cues
      .filter((cue) => cue.start < boundary && cue.end >= boundary - 1)
      .at(-1);
    const nextCue = cues.find(
      (cue) => cue.end > boundary && cue.start <= boundary + 1,
    );
    if (
      previousCue === undefined ||
      nextCue === undefined ||
      nextCue.start - previousCue.end > 1
    ) {
      continue;
    }
    for (const cue of [previousCue, nextCue]) {
      cue.timingEvidence = {
        sourceTrusted: false,
        speechStart: cue.timingEvidence?.speechStart ?? null,
        speechEnd: cue.timingEvidence?.speechEnd ?? null,
        tokenTimestampsAvailable:
          cue.timingEvidence?.tokenTimestampsAvailable ?? false,
        tokenTimestampsUsed: cue.timingEvidence?.tokenTimestampsUsed ?? false,
        tokens: cue.timingEvidence?.tokens ?? [],
        alignmentSource: cue.timingEvidence?.alignmentSource ?? "segment",
        presentationTimingMethod:
          cue.timingEvidence?.presentationTimingMethod ?? null,
        chunkBoundaryConflict: true,
        ...(cue.timingEvidence?.speechIntervals === undefined
          ? {}
          : {
              speechIntervals: cue.timingEvidence.speechIntervals,
            }),
        ...(cue.timingEvidence?.speechBoundarySource === undefined
          ? {}
          : {
              speechBoundarySource: cue.timingEvidence.speechBoundarySource,
            }),
      };
    }
  }
  const rawTranscriptionPath = path.join(
    audioDirectory,
    "raw-transcription.json",
  );
  const canonicalArtifactPath =
    options.canonicalArtifactPath ??
    path.join(audioDirectory, "canonical-asr-segments.json");
  await atomicWriteJson(
    canonicalArtifactPath,
    {
      schemaVersion: "1.0.0",
      sourceAdapter:
        canonicalUtterances[0]?.sourceAdapter ??
        (options.adapter.id === "openai" ? "openai" : "whisper-cli"),
      rawSegmentCount: rawSegments.length,
      canonicalUtteranceCount: canonicalUtterances.length,
      rawSegments,
      utterances: canonicalUtterances,
    },
    {
      overwrite:
        (options.overwrite ?? false) ||
        (await pathExists(canonicalArtifactPath)),
    },
  );
  await atomicWriteJson(
    rawTranscriptionPath,
    {
      schemaVersion: "1.0.0",
      adapter: options.adapter.id,
      model: options.adapter.model,
      timestampStrategy,
      chunks: rawChunks,
      canonicalArtifactPath: path.basename(canonicalArtifactPath),
      rawSegmentCount: rawSegments.length,
      canonicalUtteranceCount: canonicalUtterances.length,
      cues,
    },
    {
      overwrite:
        (options.overwrite ?? false) ||
        (await pathExists(rawTranscriptionPath)),
    },
  );
  return {
    cues,
    audioManifest: manifest,
    rawTranscriptionPath,
    canonicalArtifactPath,
    rawSegmentCount: rawSegments.length,
    canonicalUtteranceCount: canonicalUtterances.length,
    cacheHits,
    transcribedChunks,
  };
}

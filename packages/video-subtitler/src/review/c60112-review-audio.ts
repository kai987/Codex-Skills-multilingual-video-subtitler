import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { inspectReviewWav, reviewAudioBounds } from "../review-audio.js";

const execFileAsync = promisify(execFile);

export interface C60112AudioRegionInput {
  regionId: string;
  interval: { start: number; end: number };
  itemIds: string[];
}

export interface C60112AudioClip {
  regionId: string;
  itemIds: string[];
  relativePath: string;
  requestedInterval: { start: number; end: number };
  extractedInterval: { start: number; end: number };
  coreInterval: { start: number; end: number };
  coreOffsetSeconds: number;
  coreDurationSeconds: number;
  actualDurationSeconds: number;
  sampleRate: 16000;
  channelCount: 1;
  bitsPerSample: 16;
  frameCount: number;
  sha256: string;
  playable: true;
  sourceMediaSha256: string;
}

export interface C60112ReviewAudioManifest {
  schemaVersion: "1.0.0";
  policyVersion: "c6.0.1.12-multi-asr-review-assistance-v2";
  artifactType: "c6-0-1-12-review-audio-manifest";
  generatedAt: string;
  sourceMediaSha256: string;
  extractionPolicy: "region-core-plus-two-second-context-pcm-s16le-16khz-mono-v1";
  ffmpegIdentity: string;
  clips: C60112AudioClip[];
  summary: {
    regionCount: number;
    generatedCount: number;
    playableCount: number;
    failedCount: 0;
    totalAudioSeconds: number;
    asrInferenceCount: 0;
    networkUsed: false;
  };
  semanticHash: string;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashValue(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

async function fileHash(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(
    filePath,
  ) as AsyncIterable<Buffer>) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

function safeAudioName(regionId: string): string {
  const normalized = regionId.replace(/[^a-zA-Z0-9._-]+/gu, "-");
  if (normalized === "" || normalized === "." || normalized === "..") {
    throw new Error(`Unsafe region id: ${regionId}`);
  }
  return `${normalized}.wav`;
}

export async function buildC60112ReviewAudio(input: {
  sourcePath: string;
  expectedSourceMediaSha256: string;
  durationSeconds: number;
  regions: readonly C60112AudioRegionInput[];
  outputDirectory: string;
  generatedAt: string;
  ffmpegPath?: string;
  audioStreamIndex?: number;
}): Promise<C60112ReviewAudioManifest> {
  const sourceStat = await lstat(input.sourcePath);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
    throw new Error("SOURCE_MEDIA_MUST_BE_A_REGULAR_FILE");
  }
  const sourceMediaSha256 = await fileHash(input.sourcePath);
  if (sourceMediaSha256 !== input.expectedSourceMediaSha256) {
    throw new Error(
      `SOURCE_MEDIA_HASH_MISMATCH: expected ${input.expectedSourceMediaSha256}, received ${sourceMediaSha256}`,
    );
  }
  const ffmpegPath = input.ffmpegPath ?? "ffmpeg";
  const { stdout: ffmpegVersion } = await execFileAsync(ffmpegPath, [
    "-version",
  ]);
  const ffmpegIdentity =
    ffmpegVersion.split(/\r?\n/u)[0]?.trim() ?? "ffmpeg-unknown";
  await mkdir(input.outputDirectory, { recursive: true });
  const clips: C60112AudioClip[] = [];
  for (const region of [...input.regions].toSorted(
    (left, right) =>
      left.interval.start - right.interval.start ||
      left.regionId.localeCompare(right.regionId),
  )) {
    if (
      region.interval.start < 0 ||
      region.interval.end <= region.interval.start
    ) {
      throw new Error(`INVALID_REVIEW_REGION_INTERVAL:${region.regionId}`);
    }
    const bounds = reviewAudioBounds({
      start: region.interval.start,
      end: region.interval.end,
      duration: input.durationSeconds,
      contextSeconds: 2,
      maximumSeconds: Math.max(
        45,
        region.interval.end - region.interval.start + 4,
      ),
    });
    const fileName = safeAudioName(region.regionId);
    const targetPath = path.join(input.outputDirectory, fileName);
    const temporaryPath = `${targetPath}.tmp-${randomUUID()}.wav`;
    try {
      await execFileAsync(ffmpegPath, [
        "-hide_banner",
        "-nostdin",
        "-loglevel",
        "error",
        "-ss",
        bounds.start.toFixed(6),
        "-i",
        input.sourcePath,
        ...(input.audioStreamIndex === undefined
          ? []
          : ["-map", `0:${input.audioStreamIndex}`]),
        "-t",
        (bounds.end - bounds.start).toFixed(6),
        "-vn",
        "-acodec",
        "pcm_s16le",
        "-ar",
        "16000",
        "-ac",
        "1",
        "-y",
        temporaryPath,
      ]);
      const metadata = inspectReviewWav(await readFile(temporaryPath));
      const allowedDriftSeconds = 0.08;
      const requestedDuration = bounds.end - bounds.start;
      if (
        Math.abs(metadata.actualDurationSeconds - requestedDuration) >
        allowedDriftSeconds
      ) {
        throw new Error(`REVIEW_AUDIO_DURATION_MISMATCH:${region.regionId}`);
      }
      await rename(temporaryPath, targetPath);
      const sha256 = await fileHash(targetPath);
      clips.push({
        regionId: region.regionId,
        itemIds: [...region.itemIds],
        relativePath: `audio/${fileName}`,
        requestedInterval: bounds,
        extractedInterval: {
          start: bounds.start,
          end: bounds.start + metadata.actualDurationSeconds,
        },
        coreInterval: { ...region.interval },
        coreOffsetSeconds: region.interval.start - bounds.start,
        coreDurationSeconds: region.interval.end - region.interval.start,
        actualDurationSeconds: metadata.actualDurationSeconds,
        sampleRate: 16000,
        channelCount: 1,
        bitsPerSample: 16,
        frameCount: metadata.frameCount,
        sha256,
        playable: true,
        sourceMediaSha256,
      });
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: "c6.0.1.12-multi-asr-review-assistance-v2" as const,
    artifactType: "c6-0-1-12-review-audio-manifest" as const,
    generatedAt: input.generatedAt,
    sourceMediaSha256,
    extractionPolicy:
      "region-core-plus-two-second-context-pcm-s16le-16khz-mono-v1" as const,
    ffmpegIdentity,
    clips,
    summary: {
      regionCount: input.regions.length,
      generatedCount: clips.length,
      playableCount: clips.length,
      failedCount: 0 as const,
      totalAudioSeconds: clips.reduce(
        (sum, clip) => sum + clip.actualDurationSeconds,
        0,
      ),
      asrInferenceCount: 0 as const,
      networkUsed: false as const,
    },
  };
  return {
    ...core,
    semanticHash: hashValue({ ...core, generatedAt: undefined }),
  };
}

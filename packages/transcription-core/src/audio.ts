import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  atomicWriteJson,
  pathExists,
  readJson,
  type Logger,
  type ProcessRunner,
} from "@mvl/shared";
import { z } from "zod";

import type { AudioChunk, AudioManifest } from "./types.js";

const audioManifestSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    sourcePath: z.string().min(1),
    audioStreamIndex: z.number().int().nonnegative(),
    sampleRate: z.number().int().positive(),
    channels: z.number().int().positive(),
    targetChunkSeconds: z.number().positive(),
    silenceThresholdDb: z.number().negative(),
    silenceMinimumSeconds: z.number().positive(),
    chunks: z.array(
      z
        .object({
          id: z.string().min(1),
          relativePath: z.string().regex(/^(?!\/)(?![A-Za-z]:[\\/]).+/u),
          start: z.number().nonnegative(),
          end: z.number().positive(),
          duration: z.number().positive(),
          sha256: z.string().regex(/^[a-f0-9]{64}$/u),
        })
        .strict(),
    ),
  })
  .strict();

async function sha256(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

function silenceMidpoints(stderr: string): number[] {
  const starts = [...stderr.matchAll(/silence_start:\s*([0-9.]+)/gu)].map(
    (match) => Number(match[1]),
  );
  const ends = [...stderr.matchAll(/silence_end:\s*([0-9.]+)/gu)].map((match) =>
    Number(match[1]),
  );
  return starts.flatMap((start, index) => {
    const end = ends[index];
    return end === undefined || end < start ? [] : [(start + end) / 2];
  });
}

function chooseBoundaries(
  duration: number,
  target: number,
  silences: readonly number[],
): number[] {
  const boundaries = [0];
  let cursor = target;
  while (cursor < duration) {
    const nearby = silences
      .filter((time) => time > (boundaries.at(-1) ?? 0) + 10)
      .filter((time) => Math.abs(time - cursor) <= Math.min(30, target * 0.2))
      .toSorted(
        (left, right) => Math.abs(left - cursor) - Math.abs(right - cursor),
      );
    const boundary = nearby[0] ?? cursor;
    boundaries.push(
      Math.min(duration, Math.max(boundary, (boundaries.at(-1) ?? 0) + 1)),
    );
    cursor = boundary + target;
  }
  boundaries.push(duration);
  return [...new Set(boundaries.map((value) => Number(value.toFixed(3))))];
}

async function allChunkFilesExist(
  directory: string,
  manifest: AudioManifest,
): Promise<boolean> {
  if (manifest.chunks.some((chunk) => !chunk.relativePath.endsWith(".wav"))) {
    return false;
  }
  const states = await Promise.all(
    manifest.chunks.map(
      async (chunk) =>
        await pathExists(path.join(directory, chunk.relativePath)),
    ),
  );
  return states.every(Boolean);
}

export async function extractAudioChunks(input: {
  mediaPath: string;
  audioDirectory: string;
  audioStreamIndex: number;
  durationSeconds: number;
  runner: ProcessRunner;
  logger: Logger;
  ffmpegPath: string;
  targetChunkSeconds: number;
  silenceThresholdDb: number;
  silenceMinimumSeconds: number;
  overwrite: boolean;
}): Promise<AudioManifest> {
  const manifestPath = path.join(input.audioDirectory, "audio-manifest.json");
  if (await pathExists(manifestPath)) {
    const existing = audioManifestSchema.parse(await readJson(manifestPath));
    if (
      existing.sourcePath === input.mediaPath &&
      existing.audioStreamIndex === input.audioStreamIndex &&
      existing.targetChunkSeconds === input.targetChunkSeconds &&
      existing.silenceThresholdDb === input.silenceThresholdDb &&
      existing.silenceMinimumSeconds === input.silenceMinimumSeconds &&
      (await allChunkFilesExist(input.audioDirectory, existing))
    ) {
      input.logger.log(
        "info",
        "Reusing validated audio chunks from the manifest.",
        {
          chunkCount: existing.chunks.length,
        },
      );
      return existing;
    }
  }
  await mkdir(path.join(input.audioDirectory, "chunks"), { recursive: true });
  const fullAudio = path.join(input.audioDirectory, "full-audio.mp3");
  await input.runner.run(input.ffmpegPath, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    input.mediaPath,
    "-map",
    `0:${input.audioStreamIndex}`,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-b:a",
    "64k",
    fullAudio,
  ]);
  const silence = await input.runner.run(
    input.ffmpegPath,
    [
      "-hide_banner",
      "-i",
      fullAudio,
      "-af",
      `silencedetect=noise=${input.silenceThresholdDb}dB:d=${input.silenceMinimumSeconds}`,
      "-f",
      "null",
      "-",
    ],
    { allowNonZero: true },
  );
  const boundaries = chooseBoundaries(
    input.durationSeconds,
    input.targetChunkSeconds,
    silenceMidpoints(silence.stderr),
  );
  const chunks: AudioChunk[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    if (start === undefined || end === undefined || end <= start) continue;
    const id = `chunk-${String(index + 1).padStart(4, "0")}`;
    const relativePath = `chunks/${id}.wav`;
    const outputPath = path.join(input.audioDirectory, relativePath);
    await input.runner.run(input.ffmpegPath, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-ss",
      String(start),
      "-i",
      fullAudio,
      "-t",
      String(end - start),
      "-c:a",
      "pcm_s16le",
      "-ar",
      "16000",
      "-ac",
      "1",
      outputPath,
    ]);
    chunks.push({
      id,
      relativePath,
      start,
      end,
      duration: end - start,
      sha256: await sha256(outputPath),
    });
  }
  const manifest = audioManifestSchema.parse({
    schemaVersion: "1.0.0",
    sourcePath: input.mediaPath,
    audioStreamIndex: input.audioStreamIndex,
    sampleRate: 16000,
    channels: 1,
    targetChunkSeconds: input.targetChunkSeconds,
    silenceThresholdDb: input.silenceThresholdDb,
    silenceMinimumSeconds: input.silenceMinimumSeconds,
    chunks,
  });
  await atomicWriteJson(manifestPath, manifest, {
    overwrite: input.overwrite || (await pathExists(manifestPath)),
  });
  return manifest;
}

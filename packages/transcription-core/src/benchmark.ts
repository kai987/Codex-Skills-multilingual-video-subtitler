import path from "node:path";
import { homedir } from "node:os";
import { mkdir } from "node:fs/promises";

import {
  atomicWriteJson,
  pathExists,
  readJson,
  whisperBenchmarkSchema,
  type WhisperBenchmark,
  type WhisperModelCapability,
  type ProcessRunner,
} from "@mvl/shared";

import type { BenchmarkMode } from "./types.js";

const DEFAULT_BENCHMARK_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function defaultWhisperBenchmarkCachePath(): string {
  return path.join(
    homedir(),
    ".cache",
    "multilingual-video-subtitler",
    "whisper-benchmark.json",
  );
}

export async function extractWhisperBenchmarkSample(input: {
  mediaPath: string;
  audioStreamIndex: number;
  outputDirectory: string;
  runner: ProcessRunner;
  ffmpegPath: string;
  speechIntervals?: readonly { start: number; end: number }[];
  sampleAudioSeconds?: number;
  mediaDurationSeconds?: number;
}): Promise<{ path: string; start: number; duration: number }> {
  const requestedDuration = Math.min(
    60,
    Math.max(1, input.sampleAudioSeconds ?? 45),
  );
  const interval = (input.speechIntervals ?? [])
    .filter((candidate) => candidate.end - candidate.start >= 1)
    .toSorted(
      (left, right) => right.end - right.start - (left.end - left.start),
    )[0];
  const start = interval?.start ?? 0;
  const duration = Math.min(
    requestedDuration,
    interval === undefined
      ? (input.mediaDurationSeconds ?? requestedDuration)
      : interval.end - interval.start,
  );
  const audioDirectory = path.join(input.outputDirectory, "audio");
  await mkdir(audioDirectory, { recursive: true });
  const outputPath = path.join(audioDirectory, "whisper-benchmark-sample.wav");
  await input.runner.run(input.ffmpegPath, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    String(start),
    "-i",
    input.mediaPath,
    "-map",
    `0:${input.audioStreamIndex}`,
    "-t",
    String(duration),
    "-vn",
    "-c:a",
    "pcm_s16le",
    "-ar",
    "16000",
    "-ac",
    "1",
    outputPath,
  ]);
  return { path: outputPath, start, duration };
}

function benchmarkIdentity(input: {
  deviceFingerprint: string;
  whisperCppVersion: string;
  capabilities: readonly WhisperModelCapability[];
}): string {
  return JSON.stringify({
    deviceFingerprint: input.deviceFingerprint,
    whisperCppVersion: input.whisperCppVersion,
    capabilities: input.capabilities
      .map((capability) => ({
        id: capability.id,
        modelHash: capability.modelHash,
        coreML: capability.runtime === "coreml",
        encoderPath: capability.coreML.encoderPath,
        encoderFingerprint: capability.coreML.encoderFingerprint ?? null,
      }))
      .toSorted((left, right) => left.id.localeCompare(right.id)),
  });
}

function canReuse(
  benchmark: WhisperBenchmark,
  input: {
    now: Date;
    deviceFingerprint: string;
    whisperCppVersion: string;
    capabilities: readonly WhisperModelCapability[];
  },
): boolean {
  if (benchmark.status === "skipped") return false;
  if (new Date(benchmark.expiresAt).getTime() <= input.now.getTime()) {
    return false;
  }
  const expected = benchmarkIdentity(input);
  const actual = JSON.stringify({
    deviceFingerprint: benchmark.deviceFingerprint,
    whisperCppVersion:
      benchmark.entries[0]?.whisperCppVersion ??
      benchmark.errors[0]?.whisperCppVersion ??
      "unknown",
    capabilities: [
      ...benchmark.entries.map((entry) => ({
        id: entry.capabilityId,
        modelHash: entry.modelHash,
        coreML: entry.coreML,
        encoderPath: entry.encoderPath ?? null,
        encoderFingerprint: entry.encoderFingerprint ?? null,
      })),
      ...benchmark.errors.map((entry) => ({
        id: entry.capabilityId,
        modelHash: entry.modelHash,
        coreML: entry.coreML,
        encoderPath: entry.encoderPath ?? null,
        encoderFingerprint: entry.encoderFingerprint ?? null,
      })),
    ].toSorted((left, right) => left.id.localeCompare(right.id)),
  });
  return actual === expected;
}

export async function runWhisperBenchmark(input: {
  mode: BenchmarkMode;
  cachePath?: string;
  deviceFingerprint: string;
  whisperCppVersion: string;
  capabilities: readonly WhisperModelCapability[];
  sampleAudioSeconds: number;
  runCandidate: (capability: WhisperModelCapability) => Promise<number>;
  now?: Date;
  maxAgeMs?: number;
}): Promise<WhisperBenchmark> {
  const now = input.now ?? new Date();
  const maxAgeMs = input.maxAgeMs ?? DEFAULT_BENCHMARK_MAX_AGE_MS;
  const cachePath = input.cachePath ?? defaultWhisperBenchmarkCachePath();
  if (input.mode === "off") {
    return whisperBenchmarkSchema.parse({
      schemaVersion: "1.0.0",
      status: "skipped",
      skipReason: "disabled-by-user",
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + maxAgeMs).toISOString(),
      deviceFingerprint: input.deviceFingerprint,
      sampleAudioSeconds: input.sampleAudioSeconds,
      entries: [],
      errors: [],
    });
  }
  if (input.mode === "auto" && (await pathExists(cachePath))) {
    try {
      const cached = whisperBenchmarkSchema.parse(await readJson(cachePath));
      if (
        canReuse(cached, {
          now,
          deviceFingerprint: input.deviceFingerprint,
          whisperCppVersion: input.whisperCppVersion,
          capabilities: input.capabilities,
        })
      ) {
        return whisperBenchmarkSchema.parse({
          ...cached,
          status: "reused",
          skipReason: null,
        });
      }
    } catch {
      // Invalid cache entries are replaced by a fresh benchmark.
    }
  }
  const entries = [];
  const errors = [];
  for (const capability of input.capabilities) {
    try {
      const processingSeconds = await input.runCandidate(capability);
      entries.push({
        capabilityId: capability.id,
        modelHash: capability.modelHash,
        whisperCppVersion: input.whisperCppVersion,
        coreML: capability.runtime === "coreml",
        encoderPath: capability.coreML.encoderPath,
        encoderFingerprint: capability.coreML.encoderFingerprint ?? null,
        audioSeconds: input.sampleAudioSeconds,
        processingSeconds,
        rtf: processingSeconds / input.sampleAudioSeconds,
      });
    } catch (error) {
      errors.push({
        capabilityId: capability.id,
        modelHash: capability.modelHash,
        whisperCppVersion: input.whisperCppVersion,
        coreML: capability.runtime === "coreml",
        encoderPath: capability.coreML.encoderPath,
        encoderFingerprint: capability.coreML.encoderFingerprint ?? null,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const benchmark = whisperBenchmarkSchema.parse({
    schemaVersion: "1.0.0",
    status: "executed",
    skipReason: null,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + maxAgeMs).toISOString(),
    deviceFingerprint: input.deviceFingerprint,
    sampleAudioSeconds: input.sampleAudioSeconds,
    entries,
    errors,
  });
  await atomicWriteJson(cachePath, benchmark, {
    overwrite: await pathExists(cachePath),
  });
  return benchmark;
}

import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { independentAsrModelIdentitySchema } from "@mvl/shared";
import {
  assertIndependentAsrAudioRequest,
  independentAsrCacheKey,
  REAZON_K2_FP32_FILE_IDENTITIES,
  REAZON_K2_MODEL_FILES,
  REAZON_K2_MODEL_ID,
  REAZON_K2_MODEL_REVISION,
} from "@mvl/video-subtitler";
import { describe, expect, it } from "vitest";

const HASH = "a".repeat(64);

describe("C6.0.1.9 independent ASR provider contract", () => {
  it("builds an order-independent cache key with every runtime boundary frozen", () => {
    const common = {
      providerId: "reazonspeech-k2-v2",
      modelRevision: REAZON_K2_MODEL_REVISION,
      precision: "fp32" as const,
      audioSha256: HASH,
      sourceInterval: { start: 10, end: 12 },
      decodingConfig: { method: "greedy_search", threads: 1 },
      normalizationConfig: { version: "c6019-v1" },
    };
    expect(
      independentAsrCacheKey({
        ...common,
        modelFileHashes: { decoder: "b", encoder: "a" },
      }),
    ).toBe(
      independentAsrCacheKey({
        ...common,
        modelFileHashes: { encoder: "a", decoder: "b" },
      }),
    );
    expect(
      independentAsrCacheKey({
        ...common,
        modelFileHashes: { encoder: "a", decoder: "b" },
      }),
    ).not.toBe(
      independentAsrCacheKey({
        ...common,
        audioSha256: "c".repeat(64),
        modelFileHashes: { encoder: "a", decoder: "b" },
      }),
    );
  });

  it("rejects requests that exceed the provider's padded 30-second limit", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "mvl-c6019-"));
    const audioPath = path.join(directory, "sample.wav");
    await writeFile(audioPath, Buffer.alloc(64));
    const request = {
      requestId: "request-1",
      eventId: "event-1",
      diagnosticRole: "TARGET" as const,
      windowType: "CORE_EXACT" as const,
      sourceInterval: { start: 0, end: 29 },
      sourceMediaSha256: HASH,
      audioPath,
      audioSha256: HASH,
      sampleRate: 16_000 as const,
      sampleCount: 29 * 16_000,
      extractionConfigHash: HASH,
    };
    await expect(assertIndependentAsrAudioRequest(request)).rejects.toThrow(
      "padded 30 second provider limit",
    );
    await expect(
      assertIndependentAsrAudioRequest({
        ...request,
        sourceInterval: { start: 0, end: 28 },
        sampleCount: 28 * 16_000,
      }),
    ).resolves.toBeUndefined();
  });

  it("pins the official Reazon K2 FP32 model identity", () => {
    expect(REAZON_K2_MODEL_ID).toBe("reazon-research/reazonspeech-k2-v2");
    expect(REAZON_K2_MODEL_REVISION).toMatch(/^[a-f0-9]{40}$/u);
    expect(REAZON_K2_MODEL_FILES).toHaveLength(4);
    expect(Object.keys(REAZON_K2_FP32_FILE_IDENTITIES)).toEqual([
      "encoder-epoch-99-avg-1.onnx",
      "decoder-epoch-99-avg-1.onnx",
      "joiner-epoch-99-avg-1.onnx",
      "tokens.txt",
    ]);
    expect(
      independentAsrModelIdentitySchema.safeParse({
        providerId: "reazonspeech-k2-v2",
        modelId: REAZON_K2_MODEL_ID,
        modelRevision: REAZON_K2_MODEL_REVISION,
        architecture: "Zipformer character RNN-T",
        modelFiles: REAZON_K2_MODEL_FILES.map((fileName) => ({
          fileName,
          ...REAZON_K2_FP32_FILE_IDENTITIES[fileName],
        })),
        modelSnapshotHash: HASH,
        precision: "fp32",
        device: "cpu",
        language: "ja",
      }).success,
    ).toBe(true);
  });
});

import { createHash } from "node:crypto";
import {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ProcessRunner,
  SubtitleOverlapAcousticResolution,
} from "@mvl/shared";
import {
  atomicHandoffReviewAudio,
  inspectReviewWav,
  resolveReviewAudio,
} from "@mvl/video-subtitler";

const temporaryDirectories: string[] = [];
const REVIEW_ID = "review-test";
const COMPONENT_ID = "component-test";

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function wav(
  input: {
    frameCount?: number;
    sampleRate?: number;
    channelCount?: number;
    bitsPerSample?: number;
  } = {},
): Buffer {
  const frameCount = input.frameCount ?? 64_000;
  const sampleRate = input.sampleRate ?? 16_000;
  const channelCount = input.channelCount ?? 1;
  const bitsPerSample = input.bitsPerSample ?? 16;
  const blockAlign = channelCount * (bitsPerSample / 8);
  const dataBytes = frameCount * blockAlign;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channelCount, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * blockAlign, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function overlap(input: {
  sha256: string | null;
  audioPath?: string | null;
  extractionInterval?: { start: number; end: number };
  fullyCovers?: boolean;
}): SubtitleOverlapAcousticResolution {
  return {
    components: [
      {
        componentId: COMPONENT_ID,
        audioPath: input.audioPath ?? "audio/overlap/component-test.wav",
        audioSha256: input.sha256,
        audioDurationSeconds: 4,
        extractionInterval: input.extractionInterval ?? { start: 1, end: 5 },
        audioFullyCoversComponent: input.fullyCovers ?? true,
        profileAttemptIds: ["attempt-a"],
        cueAlignments: [
          { cueId: "cue-a", timingEvidenceLineageIds: ["lineage-a"] },
        ],
      },
    ],
  } as unknown as SubtitleOverlapAcousticResolution;
}

async function directories() {
  const root = await mkdtemp(path.join(tmpdir(), "mvl-c5172-audio-"));
  temporaryDirectories.push(root);
  const source = path.join(root, "source", "subtitle-sample");
  const target = path.join(root, "target", "subtitle-sample");
  await Promise.all([
    mkdir(path.join(source, "audio", "review"), { recursive: true }),
    mkdir(path.join(source, "audio", "overlap"), { recursive: true }),
    mkdir(path.join(target, "audio", "review"), { recursive: true }),
    mkdir(path.join(target, "audio", "overlap"), { recursive: true }),
  ]);
  return { root, source, target };
}

function resolverInput(input: {
  source: string;
  target: string;
  mode?: "auto" | "generate" | "reuse-only" | "off";
  artifact: SubtitleOverlapAcousticResolution;
  runner?: ProcessRunner;
  sourceVideoPath?: string | null;
}) {
  return {
    mode: input.mode ?? ("reuse-only" as const),
    reviewId: REVIEW_ID,
    componentId: COMPONENT_ID,
    componentUnionInterval: { start: 2, end: 4 },
    mediaDurationSeconds: 10,
    targetSubtitleDirectory: input.target,
    sourceSubtitleDirectory: input.source,
    sourceVideoPath: input.sourceVideoPath ?? null,
    overlapArtifact: input.artifact,
    ...(input.runner === undefined ? {} : { runner: input.runner }),
    ffmpegPath: "ffmpeg",
  };
}

describe("C5.17.2 review WAV inspection", () => {
  it("reads PCM frame count and derives the actual duration", () => {
    const metadata = inspectReviewWav(wav({ frameCount: 80_000 }));
    expect(metadata).toMatchObject({
      sampleRate: 16_000,
      channelCount: 1,
      bitsPerSample: 16,
      frameCount: 80_000,
      actualDurationSeconds: 5,
      codec: "pcm-s16le",
    });
  });

  it.each([
    ["sample rate", { sampleRate: 48_000 }],
    ["channel count", { channelCount: 2 }],
    ["bit depth", { bitsPerSample: 8 }],
  ])("rejects unsupported %s", (_label, format) => {
    expect(() => inspectReviewWav(wav(format))).toThrow(
      /UNSUPPORTED_REVIEW_WAV_FORMAT/u,
    );
  });

  it("rejects truncated RIFF data", () => {
    expect(() => inspectReviewWav(wav().subarray(0, 43))).toThrow();
  });
});

describe("C5.17.2 review audio resolver", () => {
  it("reuses a verified source review WAV without modifying it", async () => {
    const { source, target } = await directories();
    const content = wav();
    const sourcePath = path.join(source, "audio", "review", `${REVIEW_ID}.wav`);
    await writeFile(sourcePath, content);
    const before = sha256(await readFile(sourcePath));
    const result = await resolveReviewAudio(
      resolverInput({ source, target, artifact: overlap({ sha256: before }) }),
    );
    expect(result).toMatchObject({
      source: "inherited-verified-review-audio",
      validationStatus: "validated",
      fullyCoversComponent: true,
      sha256: before,
      sourceComponentId: COMPONENT_ID,
    });
    expect(sha256(await readFile(sourcePath))).toBe(before);
    expect(
      sha256(
        await readFile(
          path.join(target, "audio", "review", `${REVIEW_ID}.wav`),
        ),
      ),
    ).toBe(before);
  });

  it("accepts an already-present target review WAV", async () => {
    const { source, target } = await directories();
    const content = wav();
    await writeFile(
      path.join(target, "audio", "review", `${REVIEW_ID}.wav`),
      content,
    );
    const result = await resolveReviewAudio(
      resolverInput({
        source,
        target,
        artifact: overlap({ sha256: sha256(content) }),
      }),
    );
    expect(result.source).toBe("reused-existing-review-audio");
    expect(result.handoffMethod).toBe("existing");
  });

  it("falls back to the verified overlap WAV after a review hash mismatch", async () => {
    const { source, target } = await directories();
    const expected = wav();
    await writeFile(
      path.join(source, "audio", "review", `${REVIEW_ID}.wav`),
      wav({ frameCount: 48_000 }),
    );
    await writeFile(
      path.join(source, "audio", "overlap", "component-test.wav"),
      expected,
    );
    const result = await resolveReviewAudio(
      resolverInput({
        source,
        target,
        artifact: overlap({ sha256: sha256(expected) }),
      }),
    );
    expect(result).toMatchObject({
      source: "reused-overlap-audio",
      validationStatus: "validated",
      sha256: sha256(expected),
    });
  });

  it("reuses overlap audio when the review WAV is missing", async () => {
    const { source, target } = await directories();
    const content = wav();
    await writeFile(
      path.join(source, "audio", "overlap", "component-test.wav"),
      content,
    );
    const result = await resolveReviewAudio(
      resolverInput({
        source,
        target,
        artifact: overlap({ sha256: sha256(content) }),
      }),
    );
    expect(result.source).toBe("reused-overlap-audio");
    expect(result.actualDurationSeconds).toBe(4);
  });

  it("fails closed when no verified audio source exists", async () => {
    const { source, target } = await directories();
    const result = await resolveReviewAudio(
      resolverInput({
        source,
        target,
        artifact: overlap({ sha256: "a".repeat(64) }),
      }),
    );
    expect(result).toMatchObject({
      path: null,
      error: "VERIFIED_REVIEW_AUDIO_UNAVAILABLE",
      validationStatus: "unavailable",
    });
  });

  it("reports a hash mismatch when only an untrusted review WAV exists", async () => {
    const { source, target } = await directories();
    await writeFile(
      path.join(source, "audio", "review", `${REVIEW_ID}.wav`),
      wav(),
    );
    const result = await resolveReviewAudio(
      resolverInput({
        source,
        target,
        artifact: overlap({ sha256: "b".repeat(64), audioPath: null }),
      }),
    );
    expect(result).toMatchObject({
      error: "AUDIO_HASH_MISMATCH",
      validationStatus: "hash-mismatch",
    });
  });

  it("does not invoke FFmpeg in reuse-only mode", async () => {
    const { source, target } = await directories();
    const run = vi.fn();
    const result = await resolveReviewAudio(
      resolverInput({
        source,
        target,
        artifact: overlap({ sha256: "c".repeat(64) }),
        runner: { run },
        sourceVideoPath: path.join(source, "video.mkv"),
      }),
    );
    expect(run).not.toHaveBeenCalled();
    expect(result.path).toBeNull();
  });

  it("generates in auto mode only after reuse sources are exhausted", async () => {
    const { source, target } = await directories();
    const run = vi.fn(async (_executable: string, args: readonly string[]) => {
      const output = args.at(-1);
      if (output === undefined) throw new Error("missing output");
      await writeFile(output, wav({ frameCount: 80_000 }));
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const result = await resolveReviewAudio(
      resolverInput({
        source,
        target,
        mode: "auto",
        artifact: overlap({ sha256: "d".repeat(64), audioPath: null }),
        runner: { run },
        sourceVideoPath: path.join(source, "video.mkv"),
      }),
    );
    expect(run).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      source: "generated-from-source-video",
      validationStatus: "validated",
      fullyCoversComponent: true,
    });
  });

  it("records an explicit disabled-by-user outcome", async () => {
    const { source, target } = await directories();
    const result = await resolveReviewAudio(
      resolverInput({
        source,
        target,
        mode: "off",
        artifact: overlap({ sha256: null }),
      }),
    );
    expect(result).toMatchObject({
      source: "disabled-by-user",
      validationStatus: "disabled",
      error: "AUDIO_DISABLED_BY_USER",
    });
  });

  it("rejects audio that does not cover the full component union", async () => {
    const { source, target } = await directories();
    const content = wav();
    await writeFile(
      path.join(source, "audio", "review", `${REVIEW_ID}.wav`),
      content,
    );
    const result = await resolveReviewAudio(
      resolverInput({
        source,
        target,
        artifact: overlap({
          sha256: sha256(content),
          audioPath: null,
          extractionInterval: { start: 2.5, end: 4 },
        }),
      }),
    );
    expect(result).toMatchObject({
      error: "AUDIO_COVERAGE_INCOMPLETE",
      validationStatus: "coverage-incomplete",
      fullyCoversComponent: false,
    });
  });

  it("rejects an absolute symbolic-link review source", async () => {
    const { root, source, target } = await directories();
    const external = path.join(root, "external.wav");
    const content = wav();
    await writeFile(external, content);
    await symlink(
      external,
      path.join(source, "audio", "review", `${REVIEW_ID}.wav`),
    );
    const result = await resolveReviewAudio(
      resolverInput({
        source,
        target,
        artifact: overlap({ sha256: sha256(content), audioPath: null }),
      }),
    );
    expect(result.validationStatus).toBe("invalid-wav");
    expect(result.path).toBeNull();
  });
});

describe("C5.17.2 atomic audio handoff", () => {
  it("atomically copies and preserves file content", async () => {
    const { root } = await directories();
    const source = path.join(root, "copy-source.wav");
    const target = path.join(root, "nested", "copy-target.wav");
    await writeFile(source, wav());
    await expect(
      atomicHandoffReviewAudio({ sourcePath: source, targetPath: target }),
    ).resolves.toBe("copy");
    expect(await readFile(target)).toEqual(await readFile(source));
  });

  it("can use a same-filesystem hardlink", async () => {
    const { root } = await directories();
    const source = path.join(root, "link-source.wav");
    const target = path.join(root, "nested", "link-target.wav");
    await writeFile(source, wav());
    await expect(
      atomicHandoffReviewAudio({
        sourcePath: source,
        targetPath: target,
        preferHardlink: true,
      }),
    ).resolves.toBe("hardlink");
    expect((await stat(source)).ino).toBe((await stat(target)).ino);
  });

  it("falls back to copy when hardlink creation fails", async () => {
    const { root } = await directories();
    const source = path.join(root, "fallback-source.wav");
    const target = path.join(root, "nested", "fallback-target.wav");
    await writeFile(source, wav());
    await expect(
      atomicHandoffReviewAudio({
        sourcePath: source,
        targetPath: target,
        preferHardlink: true,
        linkFile: () => Promise.reject(new Error("simulated EXDEV")),
      }),
    ).resolves.toBe("copy");
    expect((await lstat(target)).isSymbolicLink()).toBe(false);
    expect(await readFile(target)).toEqual(await readFile(source));
  });
});

import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  link,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";

import {
  type ProcessRunner,
  type ReviewAudioMode,
  type SubtitleOverlapAcousticResolution,
} from "@mvl/shared";

export const REVIEW_AUDIO_INSPECTION_METHOD =
  "riff-wave-fmt-data-frame-count-v1" as const;

export interface ReviewWavMetadata {
  sampleRate: number;
  channelCount: number;
  bitsPerSample: number;
  frameCount: number;
  actualDurationSeconds: number;
  audioFormat: number;
  blockAlign: number;
  dataByteLength: number;
  codec: "pcm-s16le";
  inspectionMethod: typeof REVIEW_AUDIO_INSPECTION_METHOD;
}

export interface ResolvedReviewAudio {
  path: string | null;
  error: string | null;
  source:
    | "generated-from-source-video"
    | "reused-existing-review-audio"
    | "reused-overlap-audio"
    | "inherited-verified-review-audio"
    | "disabled-by-user"
    | "unavailable";
  validationStatus:
    | "validated"
    | "hash-mismatch"
    | "coverage-incomplete"
    | "invalid-wav"
    | "source-missing"
    | "disabled"
    | "unavailable";
  sourceArtifact: string | null;
  sourceAudioPath: string | null;
  sourceComponentId: string | null;
  sourceEvidenceLineageIds: string[];
  requestedInterval: { start: number; end: number };
  extractedInterval: { start: number; end: number } | null;
  durationSeconds: number | null;
  actualDurationSeconds: number | null;
  sampleRate: number | null;
  channelCount: number | null;
  bitsPerSample: number | null;
  frameCount: number | null;
  inspectionMethod: string | null;
  sha256: string | null;
  contextBeforeSeconds: number;
  contextAfterSeconds: number;
  fullyCoversComponent: boolean;
  handoffMethod: "existing" | "copy" | "hardlink" | "generated" | "none";
}

export function reviewAudioBounds(input: {
  start: number;
  end: number;
  duration: number;
  contextSeconds: number;
  maximumSeconds: number;
}): { start: number; end: number } {
  const componentDuration = input.end - input.start;
  const maximumSeconds = Math.max(input.maximumSeconds, componentDuration);
  const availableContext = Math.max(0, maximumSeconds - componentDuration);
  const desiredBefore = Math.min(input.contextSeconds, input.start);
  const desiredAfter = Math.min(
    input.contextSeconds,
    Math.max(0, input.duration - input.end),
  );
  let before = Math.min(desiredBefore, availableContext / 2);
  let after = Math.min(desiredAfter, availableContext - before);
  const remaining = Math.max(0, availableContext - before - after);
  if (remaining > 0) {
    const moreBefore = Math.min(remaining, desiredBefore - before);
    before += moreBefore;
    after += Math.min(remaining - moreBefore, desiredAfter - after);
  }
  return {
    start: Math.max(0, input.start - before),
    end: Math.min(input.duration, input.end + after),
  };
}

function uint32(buffer: Buffer, offset: number): number {
  if (offset + 4 > buffer.length) throw new Error("TRUNCATED_WAV");
  return buffer.readUInt32LE(offset);
}

export function inspectReviewWav(buffer: Buffer): ReviewWavMetadata {
  if (
    buffer.length < 44 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error("INVALID_RIFF_WAVE");
  }
  let offset = 12;
  let format:
    | {
        audioFormat: number;
        channelCount: number;
        sampleRate: number;
        blockAlign: number;
        bitsPerSample: number;
      }
    | undefined;
  let dataByteLength: number | undefined;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = uint32(buffer, offset + 4);
    const body = offset + 8;
    if (body + size > buffer.length) throw new Error("TRUNCATED_WAV_CHUNK");
    if (id === "fmt ") {
      if (size < 16) throw new Error("INVALID_WAV_FMT_CHUNK");
      format = {
        audioFormat: buffer.readUInt16LE(body),
        channelCount: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        blockAlign: buffer.readUInt16LE(body + 12),
        bitsPerSample: buffer.readUInt16LE(body + 14),
      };
    }
    if (id === "data") dataByteLength = size;
    offset = body + size + (size % 2);
  }
  if (format === undefined || dataByteLength === undefined) {
    throw new Error("WAV_FMT_OR_DATA_CHUNK_MISSING");
  }
  if (
    format.audioFormat !== 1 ||
    format.sampleRate !== 16_000 ||
    format.channelCount !== 1 ||
    format.bitsPerSample !== 16 ||
    format.blockAlign !== 2
  ) {
    throw new Error("UNSUPPORTED_REVIEW_WAV_FORMAT");
  }
  if (dataByteLength % format.blockAlign !== 0) {
    throw new Error("INVALID_WAV_FRAME_ALIGNMENT");
  }
  const frameCount = dataByteLength / format.blockAlign;
  return {
    ...format,
    frameCount,
    dataByteLength,
    actualDurationSeconds: frameCount / format.sampleRate,
    codec: "pcm-s16le",
    inspectionMethod: REVIEW_AUDIO_INSPECTION_METHOD,
  };
}

async function fileInspection(filePath: string): Promise<{
  sha256: string;
  metadata: ReviewWavMetadata;
}> {
  const file = await lstat(filePath);
  if (!file.isFile() || file.isSymbolicLink()) {
    throw new Error("REVIEW_AUDIO_MUST_BE_A_REGULAR_FILE");
  }
  const buffer = await readFile(filePath);
  return {
    sha256: createHash("sha256").update(buffer).digest("hex"),
    metadata: inspectReviewWav(buffer),
  };
}

export async function atomicHandoffReviewAudio(input: {
  sourcePath: string;
  targetPath: string;
  preferHardlink?: boolean;
  linkFile?: typeof link;
}): Promise<"copy" | "hardlink"> {
  await mkdir(path.dirname(input.targetPath), { recursive: true });
  const temporaryPath = `${input.targetPath}.tmp-${randomUUID()}`;
  try {
    if (input.preferHardlink === true) {
      try {
        await (input.linkFile ?? link)(input.sourcePath, temporaryPath);
        await rename(temporaryPath, input.targetPath);
        return "hardlink";
      } catch {
        await rm(temporaryPath, { force: true });
      }
    }
    const source = await readFile(input.sourcePath);
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(source);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, input.targetPath);
    return "copy";
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function coverage(input: {
  extracted: { start: number; end: number };
  component: { start: number; end: number };
}): boolean {
  return (
    input.extracted.start <= input.component.start + 0.001 &&
    input.extracted.end >= input.component.end - 0.001
  );
}

function lineageIds(
  component: SubtitleOverlapAcousticResolution["components"][number],
): string[] {
  return [
    ...component.profileAttemptIds,
    ...component.cueAlignments.flatMap(
      (cue) => cue.timingEvidenceLineageIds ?? [],
    ),
  ]
    .filter((value, index, values) => values.indexOf(value) === index)
    .toSorted();
}

function unavailable(input: {
  requestedInterval: { start: number; end: number };
  error: string;
  validationStatus: ResolvedReviewAudio["validationStatus"];
  source?: ResolvedReviewAudio["source"];
}): ResolvedReviewAudio {
  return {
    path: null,
    error: input.error,
    source: input.source ?? "unavailable",
    validationStatus: input.validationStatus,
    sourceArtifact: null,
    sourceAudioPath: null,
    sourceComponentId: null,
    sourceEvidenceLineageIds: [],
    requestedInterval: input.requestedInterval,
    extractedInterval: null,
    durationSeconds: null,
    actualDurationSeconds: null,
    sampleRate: null,
    channelCount: null,
    bitsPerSample: null,
    frameCount: null,
    inspectionMethod: null,
    sha256: null,
    contextBeforeSeconds: 0,
    contextAfterSeconds: 0,
    fullyCoversComponent: false,
    handoffMethod: "none",
  };
}

export async function resolveReviewAudio(input: {
  mode: ReviewAudioMode;
  reviewId: string;
  componentId: string;
  componentUnionInterval: { start: number; end: number };
  mediaDurationSeconds: number;
  targetSubtitleDirectory: string;
  sourceSubtitleDirectory?: string;
  sourceVideoPath: string | null;
  overlapArtifact?: SubtitleOverlapAcousticResolution;
  runner?: ProcessRunner;
  ffmpegPath?: string;
  audioStreamIndex?: number;
  contextSeconds?: number;
  maximumSeconds?: number;
  preferHardlink?: boolean;
}): Promise<ResolvedReviewAudio> {
  const requestedInterval = reviewAudioBounds({
    start: input.componentUnionInterval.start,
    end: input.componentUnionInterval.end,
    duration: input.mediaDurationSeconds,
    contextSeconds: input.contextSeconds ?? 1.5,
    maximumSeconds: input.maximumSeconds ?? 30,
  });
  if (input.mode === "off") {
    return unavailable({
      requestedInterval,
      error: "AUDIO_DISABLED_BY_USER",
      validationStatus: "disabled",
      source: "disabled-by-user",
    });
  }
  const component = input.overlapArtifact?.components.find(
    (value) => value.componentId === input.componentId,
  );
  const targetPath = path.join(
    input.targetSubtitleDirectory,
    "audio",
    "review",
    `${input.reviewId}.wav`,
  );
  let observedHashMismatch = false;
  let observedInvalidWav = false;
  let observedCoverageFailure = false;

  if (input.mode !== "generate" && component !== undefined) {
    const reviewRelative = path.posix.join(
      "audio",
      "review",
      `${input.reviewId}.wav`,
    );
    const overlapRelative = component.audioPath;
    const candidates = [
      {
        filePath: targetPath,
        source: "reused-existing-review-audio" as const,
        sourceAudioPath: reviewRelative,
        alreadyTarget: true,
      },
      ...(input.sourceSubtitleDirectory === undefined
        ? []
        : [
            {
              filePath: path.join(
                input.sourceSubtitleDirectory,
                reviewRelative,
              ),
              source: "inherited-verified-review-audio" as const,
              sourceAudioPath: reviewRelative,
              alreadyTarget: false,
            },
          ]),
      ...(overlapRelative === null
        ? []
        : [
            {
              filePath: path.join(
                input.targetSubtitleDirectory,
                overlapRelative,
              ),
              source: "reused-overlap-audio" as const,
              sourceAudioPath: overlapRelative,
              alreadyTarget: false,
            },
            ...(input.sourceSubtitleDirectory === undefined
              ? []
              : [
                  {
                    filePath: path.join(
                      input.sourceSubtitleDirectory,
                      overlapRelative,
                    ),
                    source: "reused-overlap-audio" as const,
                    sourceAudioPath: overlapRelative,
                    alreadyTarget: false,
                  },
                ]),
          ]),
    ];
    for (const candidate of candidates) {
      if (!(await exists(candidate.filePath))) continue;
      let inspected: Awaited<ReturnType<typeof fileInspection>>;
      try {
        inspected = await fileInspection(candidate.filePath);
      } catch {
        observedInvalidWav = true;
        continue;
      }
      if (
        component.audioSha256 === null ||
        inspected.sha256 !== component.audioSha256
      ) {
        observedHashMismatch = true;
        continue;
      }
      const extractedInterval = component.extractionInterval;
      if (
        !component.audioFullyCoversComponent ||
        !coverage({
          extracted: extractedInterval,
          component: input.componentUnionInterval,
        })
      ) {
        observedCoverageFailure = true;
        continue;
      }
      const handoffMethod = candidate.alreadyTarget
        ? "existing"
        : await atomicHandoffReviewAudio({
            sourcePath: candidate.filePath,
            targetPath,
            ...(input.preferHardlink === undefined
              ? {}
              : { preferHardlink: input.preferHardlink }),
          });
      const targetInspection = candidate.alreadyTarget
        ? inspected
        : await fileInspection(targetPath);
      if (targetInspection.sha256 !== inspected.sha256) {
        throw new Error("ATOMIC_AUDIO_HANDOFF_HASH_MISMATCH");
      }
      return {
        path: path.posix.join("..", "audio", "review", `${input.reviewId}.wav`),
        error: null,
        source: candidate.source,
        validationStatus: "validated",
        sourceArtifact: "subtitle-overlap-acoustic-resolution.json",
        sourceAudioPath: candidate.sourceAudioPath,
        sourceComponentId: component.componentId,
        sourceEvidenceLineageIds: lineageIds(component),
        requestedInterval,
        extractedInterval,
        durationSeconds: component.audioDurationSeconds,
        actualDurationSeconds: targetInspection.metadata.actualDurationSeconds,
        sampleRate: targetInspection.metadata.sampleRate,
        channelCount: targetInspection.metadata.channelCount,
        bitsPerSample: targetInspection.metadata.bitsPerSample,
        frameCount: targetInspection.metadata.frameCount,
        inspectionMethod: targetInspection.metadata.inspectionMethod,
        sha256: targetInspection.sha256,
        contextBeforeSeconds: Math.max(
          0,
          input.componentUnionInterval.start - extractedInterval.start,
        ),
        contextAfterSeconds: Math.max(
          0,
          extractedInterval.end - input.componentUnionInterval.end,
        ),
        fullyCoversComponent: true,
        handoffMethod,
      };
    }
  }

  if (input.mode === "reuse-only") {
    return unavailable({
      requestedInterval,
      error: observedHashMismatch
        ? "AUDIO_HASH_MISMATCH"
        : observedInvalidWav
          ? "INVALID_REVIEW_WAV"
          : observedCoverageFailure
            ? "AUDIO_COVERAGE_INCOMPLETE"
            : "VERIFIED_REVIEW_AUDIO_UNAVAILABLE",
      validationStatus: observedHashMismatch
        ? "hash-mismatch"
        : observedInvalidWav
          ? "invalid-wav"
          : observedCoverageFailure
            ? "coverage-incomplete"
            : "unavailable",
    });
  }
  if (
    input.sourceVideoPath === null ||
    input.runner === undefined ||
    input.ffmpegPath === undefined
  ) {
    return unavailable({
      requestedInterval,
      error: "SOURCE_VIDEO_UNAVAILABLE",
      validationStatus: "source-missing",
    });
  }
  await mkdir(path.dirname(targetPath), { recursive: true });
  await input.runner.run(input.ffmpegPath, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    requestedInterval.start.toFixed(3),
    "-i",
    input.sourceVideoPath,
    ...(input.audioStreamIndex === undefined
      ? []
      : ["-map", `0:${input.audioStreamIndex}`]),
    "-t",
    Math.max(0.001, requestedInterval.end - requestedInterval.start).toFixed(3),
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "pcm_s16le",
    targetPath,
  ]);
  const inspected = await fileInspection(targetPath);
  const extractedInterval = {
    start: requestedInterval.start,
    end: requestedInterval.start + inspected.metadata.actualDurationSeconds,
  };
  const fullyCoversComponent = coverage({
    extracted: extractedInterval,
    component: input.componentUnionInterval,
  });
  return {
    path: path.posix.join("..", "audio", "review", `${input.reviewId}.wav`),
    error: fullyCoversComponent ? null : "AUDIO_COVERAGE_INCOMPLETE",
    source: "generated-from-source-video",
    validationStatus: fullyCoversComponent
      ? "validated"
      : "coverage-incomplete",
    sourceArtifact: null,
    sourceAudioPath: null,
    sourceComponentId: input.componentId,
    sourceEvidenceLineageIds: [],
    requestedInterval,
    extractedInterval,
    durationSeconds: inspected.metadata.actualDurationSeconds,
    actualDurationSeconds: inspected.metadata.actualDurationSeconds,
    sampleRate: inspected.metadata.sampleRate,
    channelCount: inspected.metadata.channelCount,
    bitsPerSample: inspected.metadata.bitsPerSample,
    frameCount: inspected.metadata.frameCount,
    inspectionMethod: inspected.metadata.inspectionMethod,
    sha256: inspected.sha256,
    contextBeforeSeconds: Math.max(
      0,
      input.componentUnionInterval.start - extractedInterval.start,
    ),
    contextAfterSeconds: Math.max(
      0,
      extractedInterval.end - input.componentUnionInterval.end,
    ),
    fullyCoversComponent,
    handoffMethod: "generated",
  };
}

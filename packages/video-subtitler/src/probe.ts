import { stat } from "node:fs/promises";
import path from "node:path";

import {
  InputError,
  normalizeLanguageTag,
  type ProcessRunner,
} from "@mvl/shared";
import { z } from "zod";

import type { MediaStreamInfo, SourceInfo, StreamType } from "./types.js";

const rawStreamSchema = z
  .object({
    index: z.number().int().nonnegative(),
    codec_name: z.string().optional(),
    codec_long_name: z.string().optional(),
    codec_type: z.string().optional(),
    start_time: z.string().optional(),
    duration: z.string().optional(),
    channels: z.number().optional(),
    sample_rate: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    disposition: z.record(z.string(), z.number()).optional(),
    tags: z.record(z.string(), z.string()).optional(),
  })
  .loose();

const rawProgramSchema = z
  .object({
    program_id: z.number().optional(),
    program_num: z.number().optional(),
    streams: z.array(rawStreamSchema).optional(),
    tags: z.record(z.string(), z.string()).optional(),
  })
  .loose();

const rawChapterSchema = z
  .object({
    id: z.number().optional(),
    start_time: z.string().optional(),
    end_time: z.string().optional(),
    tags: z.record(z.string(), z.string()).optional(),
  })
  .loose();

const rawProbeSchema = z
  .object({
    streams: z.array(rawStreamSchema).default([]),
    programs: z.array(rawProgramSchema).default([]),
    chapters: z.array(rawChapterSchema).default([]),
    format: z
      .object({
        format_name: z.string().optional(),
        format_long_name: z.string().optional(),
        start_time: z.string().optional(),
        duration: z.string().optional(),
        bit_rate: z.string().optional(),
        tags: z.record(z.string(), z.string()).optional(),
      })
      .loose(),
    error: z
      .object({
        code: z.number().optional(),
        string: z.string().optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

const SUPPORTED_EXTENSIONS = new Set([
  ".mp4",
  ".mkv",
  ".mov",
  ".webm",
  ".ts",
  ".m2ts",
]);
const TEXT_SUBTITLE_CODECS = new Set([
  "ass",
  "mov_text",
  "ssa",
  "subrip",
  "srt",
  "text",
  "ttml",
  "webvtt",
]);
const GRAPHICAL_SUBTITLE_CODECS = new Set([
  "dvb_subtitle",
  "dvd_subtitle",
  "hdmv_pgs_subtitle",
  "xsub",
]);

function numberOrNull(value: string | number | undefined): number | null {
  if (value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function streamType(value: string | undefined): StreamType {
  switch (value) {
    case "video":
    case "audio":
    case "subtitle":
    case "attachment":
    case "data":
      return value;
    default:
      return "unknown";
  }
}

function normalizeTags(
  tags: Record<string, string> | undefined,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(tags ?? {}).map(([key, value]) => [
      key.toLowerCase(),
      value,
    ]),
  );
}

function mapStream(raw: z.infer<typeof rawStreamSchema>): MediaStreamInfo {
  const tags = normalizeTags(raw.tags);
  const codec = raw.codec_name ?? null;
  const type = streamType(raw.codec_type);
  return {
    index: raw.index,
    type,
    codec,
    codecLongName: raw.codec_long_name ?? null,
    language: normalizeLanguageTag(tags.language),
    rawLanguage: tags.language ?? null,
    title: tags.title ?? null,
    startTime: numberOrNull(raw.start_time),
    durationSeconds: numberOrNull(raw.duration),
    channels: raw.channels ?? null,
    sampleRate: numberOrNull(raw.sample_rate),
    width: raw.width ?? null,
    height: raw.height ?? null,
    isDefault: raw.disposition?.default === 1,
    isForced: raw.disposition?.forced === 1,
    isTextSubtitle:
      type === "subtitle" && codec !== null && TEXT_SUBTITLE_CODECS.has(codec),
    isGraphicalSubtitle:
      type === "subtitle" &&
      codec !== null &&
      GRAPHICAL_SUBTITLE_CODECS.has(codec),
  };
}

export async function probeMedia(
  inputPath: string,
  runner: ProcessRunner,
  ffprobePath: string,
  now = new Date(),
): Promise<SourceInfo> {
  const extension = path.extname(inputPath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new InputError(
      `Unsupported video extension: ${extension || "(none)"}`,
      {
        supported: [...SUPPORTED_EXTENSIONS],
      },
    );
  }
  const result = await runner.run(ffprobePath, [
    "-v",
    "error",
    "-show_error",
    "-show_format",
    "-show_streams",
    "-show_programs",
    "-show_chapters",
    "-print_format",
    "json",
    inputPath,
  ]);
  let decoded: unknown;
  try {
    decoded = JSON.parse(result.stdout) as unknown;
  } catch (error) {
    throw new InputError("ffprobe returned invalid JSON.", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  const raw = rawProbeSchema.parse(decoded);
  if (raw.error !== undefined) {
    throw new InputError(
      `ffprobe could not inspect the input: ${raw.error.string ?? "unknown error"}`,
      {
        ffprobeCode: raw.error.code ?? null,
      },
    );
  }
  const streams = raw.streams.map(mapStream);
  if (!streams.some((stream) => stream.type === "video")) {
    throw new InputError("The selected file has no video stream.", {
      streamTypes: streams.map((stream) => stream.type),
    });
  }
  const file = await stat(inputPath);
  const tags = normalizeTags(raw.format.tags);
  const duration = numberOrNull(raw.format.duration);
  if (duration === null || duration < 0) {
    throw new InputError("The video duration could not be determined.");
  }
  const warnings: string[] = [];
  const graphical = streams.filter((stream) => stream.isGraphicalSubtitle);
  if (graphical.length > 0) {
    warnings.push(
      `Graphical subtitle streams cannot be converted to text: ${graphical.map((stream) => stream.index).join(", ")}.`,
    );
  }
  return {
    schemaVersion: "1.0.0",
    fileName: path.basename(inputPath),
    fileSizeBytes: file.size,
    extension,
    supportedExtension: true,
    inspectedAt: now.toISOString(),
    format: {
      names: (raw.format.format_name ?? "").split(",").filter(Boolean),
      longName: raw.format.format_long_name ?? null,
      durationSeconds: duration,
      startTime: numberOrNull(raw.format.start_time),
      bitRate: numberOrNull(raw.format.bit_rate),
      title: tags.title ?? null,
      tags,
    },
    streams,
    programs: raw.programs.map((program) => ({
      id: program.program_id ?? null,
      number: program.program_num ?? null,
      streamIndexes: (program.streams ?? []).map((stream) => stream.index),
      tags: normalizeTags(program.tags),
    })),
    chapters: raw.chapters.map((chapter) => {
      const chapterTags = normalizeTags(chapter.tags);
      return {
        id: chapter.id ?? null,
        start: numberOrNull(chapter.start_time),
        end: numberOrNull(chapter.end_time),
        title: chapterTags.title ?? null,
      };
    }),
    transport: null,
    warnings,
  };
}

export function isTransportStream(sourceInfo: SourceInfo): boolean {
  return (
    sourceInfo.extension === ".ts" ||
    sourceInfo.extension === ".m2ts" ||
    sourceInfo.format.names.includes("mpegts")
  );
}

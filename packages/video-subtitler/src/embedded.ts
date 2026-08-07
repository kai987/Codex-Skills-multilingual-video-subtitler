import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  InputError,
  type LanguageTag,
  type Logger,
  type ProcessRunner,
  UserActionRequiredError,
} from "@mvl/shared";
import {
  normalizeSubtitleCues,
  parseSrt,
  type NormalizedSubtitle,
} from "@mvl/subtitle-core";

import type { MediaStreamInfo, ProcessingManifest } from "./types.js";

export interface SubtitleSelection {
  selected: MediaStreamInfo | null;
  textCandidates: MediaStreamInfo[];
  graphicalCandidates: MediaStreamInfo[];
}

export function selectEmbeddedSubtitle(
  streams: readonly MediaStreamInfo[],
  requestedIndex: number | undefined,
  preferredLanguages: readonly LanguageTag[],
): SubtitleSelection {
  const subtitles = streams.filter((stream) => stream.type === "subtitle");
  const textCandidates = subtitles.filter((stream) => stream.isTextSubtitle);
  const graphicalCandidates = subtitles.filter(
    (stream) => stream.isGraphicalSubtitle,
  );
  if (requestedIndex !== undefined) {
    const requested = subtitles.find(
      (stream) => stream.index === requestedIndex,
    );
    if (requested === undefined) {
      throw new InputError(
        `Subtitle stream ${requestedIndex} does not exist.`,
        {
          candidates: subtitles.map((stream) => stream.index),
        },
      );
    }
    if (!requested.isTextSubtitle) {
      throw new UserActionRequiredError(
        `Subtitle stream ${requestedIndex} is graphical or unsupported and cannot be converted to text.`,
        { stream: requested },
      );
    }
    return { selected: requested, textCandidates, graphicalCandidates };
  }
  if (textCandidates.length === 0) {
    return { selected: null, textCandidates, graphicalCandidates };
  }
  if (textCandidates.length === 1) {
    return {
      selected: textCandidates[0] ?? null,
      textCandidates,
      graphicalCandidates,
    };
  }
  const preferred = textCandidates.filter((stream) =>
    preferredLanguages.includes(stream.language),
  );
  if (preferred.length === 1) {
    return {
      selected: preferred[0] ?? null,
      textCandidates,
      graphicalCandidates,
    };
  }
  const defaults = (preferred.length > 0 ? preferred : textCandidates).filter(
    (stream) => stream.isDefault,
  );
  if (defaults.length === 1) {
    return {
      selected: defaults[0] ?? null,
      textCandidates,
      graphicalCandidates,
    };
  }
  throw new UserActionRequiredError(
    "Multiple text subtitle streams are plausible. Re-run with --subtitle-track <ffprobe stream index>.",
    {
      candidates: textCandidates.map((stream) => ({
        index: stream.index,
        codec: stream.codec,
        language: stream.language,
        title: stream.title,
        default: stream.isDefault,
      })),
    },
  );
}

export async function extractEmbeddedSubtitle(input: {
  mediaPath: string;
  stream: MediaStreamInfo;
  taskDirectory: string;
  runner: ProcessRunner;
  ffmpegPath: string;
  logger: Logger;
  manifest: ProcessingManifest;
}): Promise<NormalizedSubtitle> {
  const rawPath = path.join(
    input.taskDirectory,
    "temp",
    `embedded-${input.stream.index}-${randomUUID()}.srt`,
  );
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path.dirname(rawPath), { recursive: true });
  input.logger.log("info", "Extracting embedded text subtitle.", {
    streamIndex: input.stream.index,
    codec: input.stream.codec,
    language: input.stream.language,
  });
  const result = await input.runner.run(input.ffmpegPath, [
    "-hide_banner",
    "-nostdin",
    "-v",
    "error",
    "-i",
    input.mediaPath,
    "-map",
    `0:${input.stream.index}`,
    "-c:s",
    "srt",
    "-f",
    "srt",
    "-y",
    rawPath,
  ]);
  input.manifest.operations.push({
    executable: input.ffmpegPath,
    purpose: `extract-embedded-subtitle-stream-${input.stream.index}`,
    exitCode: result.exitCode,
  });
  const raw = await readFile(rawPath, "utf8");
  return normalizeSubtitleCues(parseSrt(raw));
}

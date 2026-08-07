import { randomUUID } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import {
  InputError,
  MissingDependencyError,
  OutputExistsError,
  pathExists,
  type Logger,
  type ProcessRunner,
} from "@mvl/shared";

import type { ProcessingManifest } from "./types.js";

function escapeFilterValue(value: string): string {
  return value
    .replaceAll("\\", "/")
    .replaceAll(":", "\\:")
    .replaceAll("'", "\\'");
}

export async function burnSubtitleIntoVideo(input: {
  mediaPath: string;
  subtitlePath: string;
  outputDirectory: string;
  fontDirectories: readonly string[];
  runner: ProcessRunner;
  logger: Logger;
  ffmpegPath: string;
  overwrite: boolean;
  manifest: ProcessingManifest;
}): Promise<string> {
  const resolvedMedia = path.resolve(input.mediaPath);
  const videoDirectory = path.join(input.outputDirectory, "video");
  const outputPath = path.join(videoDirectory, "subtitled.mkv");
  if (resolvedMedia === path.resolve(outputPath)) {
    throw new InputError(
      "Burn-in output must not be the selected source video.",
    );
  }
  if (!input.overwrite && (await pathExists(outputPath))) {
    throw new OutputExistsError(outputPath);
  }
  const filters = await input.runner.run(input.ffmpegPath, [
    "-hide_banner",
    "-filters",
  ]);
  if (!/^\s*[.A-Z]+\s+subtitles\s+/mu.test(filters.stdout + filters.stderr)) {
    throw new MissingDependencyError("ffmpeg subtitles filter (libass)");
  }
  await mkdir(videoDirectory, { recursive: true });
  const temporaryPath = path.join(
    videoDirectory,
    `.subtitled.${randomUUID()}.mkv`,
  );
  const fontExpression = input.fontDirectories
    .map((directory) => path.resolve(directory))
    .filter((directory, index, values) => values.indexOf(directory) === index)
    .map(escapeFilterValue)
    .join("\\;");
  const filter = [
    `subtitles=filename='${escapeFilterValue(path.resolve(input.subtitlePath))}'`,
    ...(fontExpression === "" ? [] : [`fontsdir='${fontExpression}'`]),
  ].join(":");
  input.logger.log("info", "Burning subtitles into a new video artifact.", {
    outputFile: path.basename(outputPath),
  });
  try {
    const result = await input.runner.run(input.ffmpegPath, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      input.mediaPath,
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-vf",
      filter,
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "18",
      "-c:a",
      "copy",
      temporaryPath,
    ]);
    input.manifest.operations.push({
      executable: input.ffmpegPath,
      purpose: "burn subtitles into new video artifact",
      exitCode: result.exitCode,
    });
    if (input.overwrite) await rm(outputPath, { force: true });
    await rename(temporaryPath, outputPath);
    return outputPath;
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

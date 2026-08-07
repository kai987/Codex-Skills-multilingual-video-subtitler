import path from "node:path";

import {
  assertRegularFile,
  InputError,
  type Logger,
  type ProcessRunner,
} from "@mvl/shared";

import type {
  ProcessingManifest,
  SourceInfo,
  TransportAnalysis,
  TransportNormalizationMode,
} from "./types.js";

const TIMESTAMP_WARNING =
  /(?:non[- ]monoton(?:ic|ous)|timestamp discontinuity|invalid dts|pts .* dts|dts .* out of order|time stamp)/iu;
const CORRUPT_WARNING =
  /(?:corrupt|damaged|packet size mismatch|continuity check failed|dropping packet|invalid data)/iu;

export async function scanTransportStream(
  inputPath: string,
  sourceInfo: SourceInfo,
  runner: ProcessRunner,
  ffmpegPath: string,
  logger: Logger,
  manifest?: ProcessingManifest,
): Promise<TransportAnalysis> {
  logger.log("info", "Scanning MPEG transport stream packets.");
  const result = await runner.run(
    ffmpegPath,
    [
      "-hide_banner",
      "-nostdin",
      "-v",
      "warning",
      "-fflags",
      "+discardcorrupt",
      "-i",
      inputPath,
      "-map",
      "0:v?",
      "-map",
      "0:a?",
      "-c",
      "copy",
      "-f",
      "null",
      "-",
    ],
    { allowNonZero: true },
  );
  manifest?.operations.push({
    executable: ffmpegPath,
    purpose: "scan-transport-stream",
    exitCode: result.exitCode,
  });
  const warningLines = result.stderr
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const timestampWarnings = warningLines.filter((line) =>
    TIMESTAMP_WARNING.test(line),
  );
  const corruptPacketWarnings = warningLines.filter((line) =>
    CORRUPT_WARNING.test(line),
  );
  if (result.exitCode !== 0 && corruptPacketWarnings.length === 0) {
    corruptPacketWarnings.push(
      `FFmpeg packet scan exited with code ${result.exitCode}.`,
    );
  }
  const startTimes = [
    sourceInfo.format.startTime,
    ...sourceInfo.streams.map((stream) => stream.startTime),
  ].filter((value): value is number => value !== null);
  const needsNormalization = timestampWarnings.length > 0;
  return {
    performed: true,
    programCount: sourceInfo.programs.length,
    hasMultiplePrograms: sourceInfo.programs.length > 1,
    hasMissingLanguageTags: sourceInfo.streams
      .filter((stream) => stream.type === "audio" || stream.type === "subtitle")
      .some((stream) => stream.rawLanguage === null),
    hasNonZeroStartTime: startTimes.some((value) => Math.abs(value) > 0.5),
    warningLines,
    timestampWarnings,
    corruptPacketWarnings,
    needsNormalization,
    normalizationReason:
      timestampWarnings.length > 0
        ? "FFmpeg reported timestamp discontinuity or ordering warnings."
        : null,
    normalizedRelativePath: null,
  };
}

export async function maybeNormalizeTransportStream(input: {
  inputPath: string;
  taskDirectory: string;
  analysis: TransportAnalysis;
  mode: TransportNormalizationMode;
  runner: ProcessRunner;
  ffmpegPath: string;
  overwrite: boolean;
  logger: Logger;
  manifest: ProcessingManifest;
}): Promise<string> {
  const shouldNormalize =
    input.mode === "always" ||
    (input.mode === "auto" && input.analysis.needsNormalization);
  if (!shouldNormalize) return input.inputPath;
  const temporaryDirectory = path.join(input.taskDirectory, "temp");
  const normalizedPath = path.join(
    temporaryDirectory,
    "temporary-normalized.mkv",
  );
  const { mkdir } = await import("node:fs/promises");
  await mkdir(temporaryDirectory, { recursive: true });
  input.logger.log(
    "warning",
    "Remuxing transport stream to a temporary MKV with generated PTS.",
    {
      reason:
        input.mode === "always"
          ? "requested"
          : input.analysis.normalizationReason,
    },
  );
  const result = await input.runner.run(input.ffmpegPath, [
    "-hide_banner",
    "-nostdin",
    "-v",
    "warning",
    "-fflags",
    "+genpts",
    "-i",
    input.inputPath,
    "-map",
    "0",
    "-c",
    "copy",
    input.overwrite ? "-y" : "-n",
    normalizedPath,
  ]);
  input.manifest.operations.push({
    executable: input.ffmpegPath,
    purpose: "normalize-transport-stream",
    exitCode: result.exitCode,
  });
  await assertRegularFile(normalizedPath);
  const { stat } = await import("node:fs/promises");
  if ((await stat(normalizedPath)).size === 0) {
    throw new InputError(
      "Transport stream normalization produced an empty file.",
      {
        path: normalizedPath,
      },
    );
  }
  input.analysis.normalizedRelativePath = path
    .relative(input.taskDirectory, normalizedPath)
    .split(path.sep)
    .join("/");
  return normalizedPath;
}

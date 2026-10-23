import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  blindGenerationInputManifestSchema,
  InputError,
  machineQualityRecoveryModeSchema,
  machineQualityRecoveryProfileSchema,
} from "@mvl/shared";
import { emitMachineQualityRunArtifacts } from "@mvl/video-subtitler";

function argumentsMap(argv: readonly string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === undefined || value === undefined) {
      throw new InputError("Invalid C6.0.1.1 run-audit arguments.");
    }
    result.set(flag, value);
  }
  return result;
}

function required(values: Map<string, string>, key: string): string {
  const value = values.get(key);
  if (value === undefined) throw new InputError(`Missing ${key}.`);
  return value;
}

const args = argumentsMap(process.argv.slice(2));
const outputDirectory = path.resolve(required(args, "--output"));
const mode = machineQualityRecoveryModeSchema.parse(required(args, "--mode"));
const profile = machineQualityRecoveryProfileSchema.parse(
  required(args, "--profile"),
);
const manifest = blindGenerationInputManifestSchema.parse(
  JSON.parse(
    await readFile(
      path.join(outputDirectory, "blind-generation-input-manifest.json"),
      "utf8",
    ),
  ) as unknown,
);
const targetChunkSeconds =
  mode === "enforce" ? Number(args.get("--target-chunk") ?? "30") : null;
const vadEnabled = args.get("--vad") === "true";
const whisperArgumentIndex =
  manifest.generationArguments.indexOf("--whisper-cpp-path");
const whisperExecutablePath =
  whisperArgumentIndex < 0
    ? null
    : (manifest.generationArguments[whisperArgumentIndex + 1] ?? null);
const result = await emitMachineQualityRunArtifacts({
  outputDirectory,
  runId: manifest.generationRunId,
  repositoryCommit: manifest.repositoryCommit,
  sourceMediaSha256: manifest.sourceVideo.sha256,
  mode,
  profile,
  targetChunkSeconds,
  vadEnabled,
  sceneRouting:
    args.get("--scene-routing") ??
    (mode === "enforce" ? "balanced" : "observe"),
  whisperExecutablePath,
});
console.log(JSON.stringify(result, null, 2));

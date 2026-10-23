import { createHash } from "node:crypto";
import { constants, createReadStream, type Dirent } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import os from "node:os";
import path from "node:path";

import {
  deviceProfileSchema,
  mediaProfileSchema,
  type CoreMLProbeStatus,
  type DeviceProfile,
  type MediaProfile,
  type ProcessRunner,
  type WhisperModelCapability,
} from "@mvl/shared";

import type { MediaProfileInput } from "./types.js";

const GIBIBYTE = 1024 ** 3;

export interface CoreMLProbeResult {
  status: CoreMLProbeStatus;
  deviceCapable: boolean;
  whisperCppCompiledWithCoreML: boolean;
  encoderAvailable: boolean;
  encoderPath: string | null;
  runtimeValidated: boolean;
  reason: string | null;
}

interface ExecutableProfile {
  available: boolean;
  path: string | null;
  version: string | null;
  diagnostic: string;
}

async function sha256File(filePath: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function isRegularFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isDirectory();
  } catch {
    return false;
  }
}

async function directoryFingerprint(
  directory: string | null,
): Promise<string | null> {
  if (directory === null || !(await isDirectory(directory))) return null;
  const entries: {
    relativePath: string;
    size: number;
    modifiedMilliseconds: number;
  }[] = [];
  const visit = async (current: string): Promise<void> => {
    const children = await readdir(current, { withFileTypes: true });
    for (const child of children) {
      const absolute = path.join(current, child.name);
      if (child.isDirectory()) {
        await visit(absolute);
      } else if (child.isFile()) {
        const info = await stat(absolute);
        entries.push({
          relativePath: path.relative(directory, absolute),
          size: info.size,
          modifiedMilliseconds: info.mtimeMs,
        });
      }
    }
  };
  await visit(directory);
  return createHash("sha256")
    .update(
      JSON.stringify(
        entries.toSorted((left, right) =>
          left.relativePath.localeCompare(right.relativePath),
        ),
      ),
    )
    .digest("hex");
}

export async function resolveExecutablePath(
  requested: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  if (path.isAbsolute(requested) || requested.includes(path.sep)) {
    const absolute = path.resolve(requested);
    try {
      await access(absolute, constants.X_OK);
      return absolute;
    } catch {
      return null;
    }
  }
  for (const directory of (environment.PATH ?? "").split(path.delimiter)) {
    if (directory === "") continue;
    const candidate = path.join(directory, requested);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue without invoking a shell.
    }
  }
  return null;
}

async function inspectExecutable(
  runner: ProcessRunner,
  requested: string,
  environment: NodeJS.ProcessEnv,
): Promise<ExecutableProfile> {
  const executable = await resolveExecutablePath(requested, environment);
  if (executable === null) {
    return { available: false, path: null, version: null, diagnostic: "" };
  }
  let fallbackDiagnostic = "";
  for (const args of [["--version"], ["-version"], ["--help"]] as const) {
    try {
      const result = await runner.run(executable, args, {
        allowNonZero: true,
        timeoutMs: 15_000,
      });
      const diagnostic = `${result.stdout}\n${result.stderr}`.trim();
      if (diagnostic !== "" && fallbackDiagnostic === "") {
        fallbackDiagnostic = diagnostic;
      }
      if (result.exitCode === 0) {
        return {
          available: true,
          path: executable,
          version:
            diagnostic === ""
              ? "unknown"
              : (diagnostic.split(/\r?\n/u)[0]?.trim() ?? "unknown"),
          diagnostic,
        };
      }
    } catch {
      // Try the next version/help shape.
    }
  }
  return {
    available: true,
    path: executable,
    version:
      fallbackDiagnostic === ""
        ? "unknown"
        : (fallbackDiagnostic.split(/\r?\n/u)[0]?.trim() ?? "unknown"),
    diagnostic: fallbackDiagnostic,
  };
}

async function executableHelp(
  runner: ProcessRunner,
  executablePath: string | null,
): Promise<string> {
  if (executablePath === null) return "";
  try {
    const result = await runner.run(executablePath, ["--help"], {
      allowNonZero: true,
      timeoutMs: 15_000,
    });
    return `${result.stdout}\n${result.stderr}`;
  } catch {
    return "";
  }
}

async function macOSAvailableMemoryBytes(
  runner: ProcessRunner,
): Promise<number | null> {
  try {
    const result = await runner.run("vm_stat", [], {
      allowNonZero: true,
      timeoutMs: 5_000,
    });
    if (result.exitCode !== 0) return null;
    const diagnostic = `${result.stdout}\n${result.stderr}`;
    const pageSize = Number(
      /page size of\s+([0-9]+)\s+bytes/iu.exec(diagnostic)?.[1],
    );
    if (!Number.isFinite(pageSize) || pageSize <= 0) return null;
    const availableLabels = [
      "Pages free",
      "Pages inactive",
      "Pages speculative",
      "Pages purgeable",
    ];
    let pages = 0;
    for (const label of availableLabels) {
      const value = Number(
        new RegExp(`${label}:\\s+([0-9]+)\\.`, "iu").exec(diagnostic)?.[1],
      );
      if (Number.isFinite(value) && value > 0) pages += value;
    }
    return pages > 0 ? pages * pageSize : null;
  } catch {
    return null;
  }
}

function modelFamilyFromName(fileName: string): string {
  return fileName
    .replace(/\.bin$/u, "")
    .replace(/^ggml-/u, "")
    .replace(/-(?:q[0-9]+(?:_[0-9]+)?|f16|f32)$/iu, "");
}

function quantizationFromName(fileName: string): string | null {
  return /-(q[0-9]+(?:_[0-9]+)?|f16|f32)\.bin$/iu.exec(fileName)?.[1] ?? null;
}

function expectedEncoderName(fileName: string): string {
  const family = modelFamilyFromName(fileName);
  return `ggml-${family}-encoder.mlmodelc`;
}

function qualityTier(family: string): WhisperModelCapability["qualityTier"] {
  if (family === "large-v3") return "maximum";
  if (family === "large-v3-turbo") return "fast";
  if (family.startsWith("medium")) return "high";
  return "balanced";
}

function modelRoles(family: string): WhisperModelCapability["roles"] {
  if (family === "large-v3") return ["refinement", "fallback"];
  if (family === "large-v3-turbo") return ["baseline", "fallback"];
  return ["baseline", "fallback"];
}

async function modelDirectories(input: {
  explicitDirectory?: string;
  explicitModelPath?: string;
  environment: NodeJS.ProcessEnv;
  includeDefaults?: boolean;
}): Promise<string[]> {
  const configured = [
    input.explicitDirectory,
    input.environment.WHISPER_MODEL_DIR,
    input.environment.WHISPER_MODEL_DIRECTORY,
    input.explicitModelPath === undefined
      ? undefined
      : path.dirname(path.resolve(input.explicitModelPath)),
    ...(input.includeDefaults === false
      ? []
      : [
          path.resolve("models/whisper"),
          path.join(homedir(), ".cache/whisper.cpp"),
        ]),
  ].filter(
    (value, index, values): value is string =>
      value !== undefined &&
      value.trim() !== "" &&
      values.indexOf(value) === index,
  );
  const existing = await Promise.all(
    configured.map(async (directory) =>
      (await isDirectory(path.resolve(directory)))
        ? path.resolve(directory)
        : null,
    ),
  );
  return existing.filter((value): value is string => value !== null);
}

async function discoverCoreMLEncoders(
  directories: readonly string[],
): Promise<DeviceProfile["coreMLEncoders"]> {
  const encoderPaths = new Set<string>();
  for (const directory of directories) {
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        entry.name.startsWith("ggml-") &&
        entry.name.endsWith("-encoder.mlmodelc")
      ) {
        encoderPaths.add(path.join(directory, entry.name));
      }
    }
  }
  const encoders: DeviceProfile["coreMLEncoders"] = [];
  for (const encoderPath of [...encoderPaths].toSorted()) {
    const fingerprint = await directoryFingerprint(encoderPath);
    if (fingerprint === null) continue;
    encoders.push({
      path: encoderPath,
      modelFamily: path
        .basename(encoderPath)
        .replace(/^ggml-/u, "")
        .replace(/-encoder\.mlmodelc$/u, ""),
      fingerprint,
    });
  }
  return encoders;
}

export async function probeCoreML(input: {
  runner: ProcessRunner;
  executablePath: string;
  modelPath: string;
  encoderPath: string | null;
  appleSilicon: boolean;
  coreMLCompiled: boolean;
  sampleAudioPath?: string;
  expectedEncoderName?: string;
}): Promise<CoreMLProbeResult> {
  if (!input.appleSilicon) {
    return {
      status: "unsupported-platform",
      deviceCapable: false,
      whisperCppCompiledWithCoreML: input.coreMLCompiled,
      encoderAvailable: input.encoderPath !== null,
      encoderPath: input.encoderPath,
      runtimeValidated: false,
      reason: "Core ML transcription is supported only on Apple Silicon.",
    };
  }
  if (!input.coreMLCompiled) {
    return {
      status: "not-compiled",
      deviceCapable: true,
      whisperCppCompiledWithCoreML: false,
      encoderAvailable: input.encoderPath !== null,
      encoderPath: input.encoderPath,
      runtimeValidated: false,
      reason: "The whisper.cpp executable did not report COREML = 1.",
    };
  }
  if (input.encoderPath === null) {
    return {
      status: "encoder-missing",
      deviceCapable: true,
      whisperCppCompiledWithCoreML: true,
      encoderAvailable: false,
      encoderPath: null,
      runtimeValidated: false,
      reason: "No matching Core ML encoder directory was found.",
    };
  }
  const expected =
    input.expectedEncoderName ??
    expectedEncoderName(path.basename(input.modelPath));
  if (path.basename(input.encoderPath) !== expected) {
    return {
      status: "encoder-mismatch",
      deviceCapable: true,
      whisperCppCompiledWithCoreML: true,
      encoderAvailable: true,
      encoderPath: input.encoderPath,
      runtimeValidated: false,
      reason: `Expected ${expected}, received ${path.basename(input.encoderPath)}.`,
    };
  }
  if (!(await isDirectory(input.encoderPath))) {
    return {
      status: "encoder-missing",
      deviceCapable: true,
      whisperCppCompiledWithCoreML: true,
      encoderAvailable: false,
      encoderPath: input.encoderPath,
      runtimeValidated: false,
      reason: "The matching Core ML encoder path is not a directory.",
    };
  }
  if (input.sampleAudioPath === undefined) {
    return {
      status: "load-failed",
      deviceCapable: true,
      whisperCppCompiledWithCoreML: true,
      encoderAvailable: true,
      encoderPath: input.encoderPath,
      runtimeValidated: false,
      reason:
        "A representative audio sample is required for runtime validation.",
    };
  }
  try {
    const result = await input.runner.run(
      input.executablePath,
      [
        "--model",
        input.modelPath,
        "--file",
        input.sampleAudioPath,
        "--threads",
        "1",
        "--language",
        "auto",
      ],
      { allowNonZero: true, timeoutMs: 10 * 60_000 },
    );
    const diagnostic = `${result.stdout}\n${result.stderr}`;
    if (
      /COREML\s*=\s*0|Core ML.*(?:not compiled|disabled|unavailable)|(?:not compiled|built without).*Core ML/iu.test(
        diagnostic,
      )
    ) {
      return {
        status: "not-compiled",
        deviceCapable: true,
        whisperCppCompiledWithCoreML: false,
        encoderAvailable: true,
        encoderPath: input.encoderPath,
        runtimeValidated: false,
        reason:
          diagnostic.trim().slice(-500) ||
          "The whisper.cpp runtime reported that Core ML is not compiled.",
      };
    }
    if (
      result.exitCode === 0 &&
      /Core ML model loaded|COREML\s*=\s*1/iu.test(diagnostic)
    ) {
      return {
        status: "available",
        deviceCapable: true,
        whisperCppCompiledWithCoreML: true,
        encoderAvailable: true,
        encoderPath: input.encoderPath,
        runtimeValidated: true,
        reason: null,
      };
    }
    return {
      status: "load-failed",
      deviceCapable: true,
      whisperCppCompiledWithCoreML: true,
      encoderAvailable: true,
      encoderPath: input.encoderPath,
      runtimeValidated: false,
      reason:
        diagnostic.trim().slice(-500) ||
        `whisper.cpp exited with code ${result.exitCode}.`,
    };
  } catch (error) {
    return {
      status: "load-failed",
      deviceCapable: true,
      whisperCppCompiledWithCoreML: true,
      encoderAvailable: true,
      encoderPath: input.encoderPath,
      runtimeValidated: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function discoverModelPaths(input: {
  directories: readonly string[];
  explicitModelPath?: string;
}): Promise<string[]> {
  const modelPaths = new Set<string>();
  if (
    input.explicitModelPath !== undefined &&
    (await isRegularFile(path.resolve(input.explicitModelPath)))
  ) {
    modelPaths.add(path.resolve(input.explicitModelPath));
  }
  for (const directory of input.directories) {
    let names: string[];
    try {
      names = await readdir(directory);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!/^ggml-.+\.bin$/u.test(name) || name.startsWith("ggml-silero-")) {
        continue;
      }
      const candidate = path.join(directory, name);
      if (await isRegularFile(candidate)) modelPaths.add(candidate);
    }
  }
  return [...modelPaths].toSorted();
}

async function probeWhisperBackend(input: {
  runner: ProcessRunner;
  executablePath: string;
  modelPath: string;
  sampleAudioPath: string;
}): Promise<string> {
  try {
    const result = await input.runner.run(
      input.executablePath,
      [
        "--model",
        input.modelPath,
        "--file",
        input.sampleAudioPath,
        "--threads",
        "1",
        "--language",
        "auto",
        "--duration",
        "1000",
      ],
      { allowNonZero: true, timeoutMs: 10 * 60_000 },
    );
    return `${result.stdout}\n${result.stderr}`;
  } catch {
    return "";
  }
}

async function discoverModels(input: {
  modelPaths: readonly string[];
  appleSilicon: boolean;
  coreMLCompiled: boolean;
  executablePath: string | null;
  runner: ProcessRunner;
  sampleAudioPath?: string;
}): Promise<WhisperModelCapability[]> {
  const capabilities: WhisperModelCapability[] = [];
  for (const modelPath of input.modelPaths) {
    const fileName = path.basename(modelPath);
    const family = modelFamilyFromName(fileName);
    const expectedEncoder = path.join(
      path.dirname(modelPath),
      expectedEncoderName(fileName),
    );
    let encoderPath = (await isDirectory(expectedEncoder))
      ? expectedEncoder
      : null;
    if (encoderPath === null) {
      try {
        const availableEncoders = (
          await readdir(path.dirname(modelPath))
        ).filter((name) => name.endsWith("-encoder.mlmodelc"));
        const mismatched = availableEncoders[0];
        if (mismatched !== undefined) {
          encoderPath = path.join(path.dirname(modelPath), mismatched);
        }
      } catch {
        encoderPath = null;
      }
    }
    const probe =
      input.executablePath === null
        ? {
            status: "not-compiled" as const,
            deviceCapable: input.appleSilicon,
            whisperCppCompiledWithCoreML: false,
            encoderAvailable: encoderPath !== null,
            encoderPath,
            runtimeValidated: false,
            reason: "whisper.cpp is unavailable.",
          }
        : await probeCoreML({
            runner: input.runner,
            executablePath: input.executablePath,
            modelPath,
            encoderPath,
            appleSilicon: input.appleSilicon,
            coreMLCompiled: input.coreMLCompiled,
            ...(input.sampleAudioPath === undefined
              ? {}
              : { sampleAudioPath: input.sampleAudioPath }),
          });
    const modelStat = await stat(modelPath);
    const modelHash = await sha256File(modelPath);
    const encoderFingerprint = await directoryFingerprint(encoderPath);
    const base = {
      modelPath,
      modelHash,
      modelFamily: family,
      qualityTier: qualityTier(family),
      quantization: quantizationFromName(fileName),
      estimatedMemoryBytes: Math.max(
        modelStat.size,
        Math.round(modelStat.size * 1.35),
      ),
      roles: modelRoles(family),
    } satisfies Omit<WhisperModelCapability, "id" | "runtime" | "coreML">;
    capabilities.push({
      ...base,
      id: `${family}:${base.quantization ?? "full"}:cpu`,
      runtime: "cpu",
      coreML: {
        supported: false,
        status: probe.status,
        deviceCapable: probe.deviceCapable,
        whisperCppCompiledWithCoreML: probe.whisperCppCompiledWithCoreML,
        encoderAvailable: probe.encoderAvailable,
        encoderPath: probe.encoderPath,
        encoderFingerprint,
        runtimeValidated: false,
        reason:
          probe.reason ??
          "Core ML is available, but this compatibility capability runs the same model on CPU.",
      },
    });
    if (input.appleSilicon) {
      capabilities.push({
        ...base,
        id: `${family}:${base.quantization ?? "full"}:coreml`,
        runtime: "coreml",
        coreML: {
          supported: probe.status === "available",
          status: probe.status,
          deviceCapable: probe.deviceCapable,
          whisperCppCompiledWithCoreML: probe.whisperCppCompiledWithCoreML,
          encoderAvailable: probe.encoderAvailable,
          encoderPath: probe.encoderPath,
          encoderFingerprint,
          runtimeValidated: probe.runtimeValidated,
          reason: probe.reason,
        },
      });
    }
  }
  return capabilities;
}

function parsePhysicalCores(value: string): number | null {
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function profileDevice(input: {
  runner: ProcessRunner;
  whisperCppPath?: string;
  modelPath?: string;
  modelDirectory?: string;
  ffmpegPath?: string;
  ffprobePath?: string;
  environment?: NodeJS.ProcessEnv;
  sampleAudioPath?: string;
  platform?: NodeJS.Platform;
  architecture?: string;
  totalMemoryBytes?: number;
  availableMemoryBytes?: number;
  logicalCores?: number;
  cpuModel?: string;
  includeDefaultModelDirectories?: boolean;
}): Promise<DeviceProfile> {
  const environment = input.environment ?? process.env;
  const platform = input.platform ?? process.platform;
  const architecture = input.architecture ?? process.arch;
  const appleSilicon = platform === "darwin" && architecture === "arm64";
  const whisper = await inspectExecutable(
    input.runner,
    input.whisperCppPath ?? environment.WHISPER_CPP_PATH ?? "whisper-cli",
    environment,
  );
  const [ffmpeg, ffprobe] = await Promise.all([
    inspectExecutable(
      input.runner,
      input.ffmpegPath ?? environment.FFMPEG_PATH ?? "ffmpeg",
      environment,
    ),
    inspectExecutable(
      input.runner,
      input.ffprobePath ?? environment.FFPROBE_PATH ?? "ffprobe",
      environment,
    ),
  ]);
  const whisperHelp = await executableHelp(input.runner, whisper.path);
  let physicalCores: number | null = null;
  if (platform === "darwin") {
    try {
      const result = await input.runner.run(
        "sysctl",
        ["-n", "hw.physicalcpu"],
        { allowNonZero: true, timeoutMs: 5_000 },
      );
      if (result.exitCode === 0)
        physicalCores = parsePhysicalCores(result.stdout);
    } catch {
      physicalCores = null;
    }
  }
  const configuredModelPath = input.modelPath ?? environment.WHISPER_MODEL_PATH;
  const includeDefaultModelDirectories =
    input.includeDefaultModelDirectories ??
    (input.modelDirectory === undefined &&
      configuredModelPath === undefined &&
      environment.WHISPER_MODEL_DIR === undefined &&
      environment.WHISPER_MODEL_DIRECTORY === undefined);
  const directories = await modelDirectories({
    environment,
    includeDefaults: includeDefaultModelDirectories,
    ...(input.modelDirectory === undefined
      ? {}
      : { explicitDirectory: input.modelDirectory }),
    ...(configuredModelPath === undefined
      ? {}
      : { explicitModelPath: configuredModelPath }),
  });
  const modelPaths = await discoverModelPaths({
    directories,
    ...(configuredModelPath === undefined
      ? {}
      : { explicitModelPath: configuredModelPath }),
  });
  const backendDiagnostic =
    appleSilicon &&
    whisper.path !== null &&
    input.sampleAudioPath !== undefined &&
    modelPaths[0] !== undefined
      ? await probeWhisperBackend({
          runner: input.runner,
          executablePath: whisper.path,
          modelPath: modelPaths[0],
          sampleAudioPath: input.sampleAudioPath,
        })
      : "";
  const combinedWhisperDiagnostic = `${whisper.diagnostic}\n${backendDiagnostic}`;
  const coreMLCompiled = /COREML\s*=\s*1/iu.test(combinedWhisperDiagnostic);
  const metalAvailable =
    /METAL\s*=\s*1|MTL\s*:\s*EMBED_LIBRARY\s*=\s*1|loaded MTL backend|ggml_metal_device_init/iu.test(
      combinedWhisperDiagnostic,
    );
  const models = await discoverModels({
    modelPaths,
    appleSilicon,
    coreMLCompiled,
    executablePath: whisper.path,
    runner: input.runner,
    ...(input.sampleAudioPath === undefined
      ? {}
      : { sampleAudioPath: input.sampleAudioPath }),
  });
  const coreMLEncoders = await discoverCoreMLEncoders(directories);
  const totalMemoryBytes = input.totalMemoryBytes ?? os.totalmem();
  const detectedAvailableMemory =
    input.availableMemoryBytes === undefined && platform === "darwin"
      ? await macOSAvailableMemoryBytes(input.runner)
      : null;
  const availableMemoryBytes =
    input.availableMemoryBytes ?? detectedAvailableMemory ?? os.freemem();
  const logicalCores = input.logicalCores ?? Math.max(1, os.cpus().length);
  const cpuModel = input.cpuModel ?? os.cpus()[0]?.model ?? "unknown";
  const runtimeValidatedCoreML = models.some(
    (model) =>
      model.coreML.status === "available" && model.coreML.runtimeValidated,
  );
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        platform,
        architecture,
        totalMemoryBytes,
        logicalCores,
        cpuModel,
        whisperVersion: whisper.version,
      }),
    )
    .digest("hex");
  return deviceProfileSchema.parse({
    schemaVersion: "1.0.0",
    platform,
    architecture,
    appleSilicon,
    memory: {
      totalGiB: totalMemoryBytes / GIBIBYTE,
      availableGiB: availableMemoryBytes / GIBIBYTE,
    },
    cpu: {
      physicalCores,
      logicalCores,
      model: cpuModel,
    },
    ffmpeg: {
      available: ffmpeg.available,
      version: ffmpeg.version,
    },
    ffprobe: {
      available: ffprobe.available,
      version: ffprobe.version,
    },
    whisperCpp: {
      available: whisper.available,
      executablePath: whisper.path,
      version: whisper.version,
      metalAvailable,
      coreMLCompiled: coreMLCompiled || runtimeValidatedCoreML,
      tokenTimestampsAvailable:
        /--output-json-full\b/u.test(whisperHelp) &&
        /--max-len\b/u.test(whisperHelp),
      fullJsonAvailable: /--output-json-full\b/u.test(whisperHelp),
    },
    coreMLEncoders,
    models,
    fingerprint,
  });
}

function mergeIntervals(
  intervals: readonly { start: number; end: number }[],
): { start: number; end: number }[] {
  const sorted = [...intervals].toSorted(
    (left, right) => left.start - right.start,
  );
  const merged: { start: number; end: number }[] = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (previous !== undefined && interval.start <= previous.end) {
      previous.end = Math.max(previous.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

function speechFromSilence(input: {
  durationSeconds: number;
  silenceIntervals: readonly { start: number; end: number }[];
}): { start: number; end: number }[] {
  const silence = mergeIntervals(
    input.silenceIntervals
      .map((interval) => ({
        start: Math.max(0, interval.start),
        end: Math.min(input.durationSeconds, interval.end),
      }))
      .filter((interval) => interval.end > interval.start),
  );
  const speech: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const interval of silence) {
    if (interval.start > cursor)
      speech.push({ start: cursor, end: interval.start });
    cursor = Math.max(cursor, interval.end);
  }
  if (cursor < input.durationSeconds) {
    speech.push({ start: cursor, end: input.durationSeconds });
  }
  return speech.filter((interval) => interval.end - interval.start >= 0.1);
}

function parseSilenceIntervals(
  stderr: string,
  durationSeconds: number,
): { start: number; end: number }[] {
  const events = [...stderr.matchAll(/silence_(start|end):\s*([0-9.]+)/gu)].map(
    (match) => ({
      kind: match[1] as "start" | "end",
      time: Number(match[2]),
    }),
  );
  const intervals: { start: number; end: number }[] = [];
  let start: number | null = null;
  for (const event of events) {
    if (event.kind === "start") start = event.time;
    if (event.kind === "end" && start !== null && event.time > start) {
      intervals.push({ start, end: event.time });
      start = null;
    }
  }
  if (start !== null && durationSeconds > start) {
    intervals.push({ start, end: durationSeconds });
  }
  return intervals;
}

export async function profileMedia(
  input: MediaProfileInput,
): Promise<MediaProfile> {
  let silenceIntervals: { start: number; end: number }[];
  let profilingMethod: MediaProfile["profilingMethod"] = "duration-fallback";
  try {
    const result = await input.runner.run(
      input.ffmpegPath,
      [
        "-hide_banner",
        "-i",
        input.mediaPath,
        "-map",
        `0:${input.audioTrack.index}`,
        "-af",
        "silencedetect=noise=-35dB:d=0.35",
        "-f",
        "null",
        "-",
      ],
      { allowNonZero: true, timeoutMs: 30 * 60_000 },
    );
    silenceIntervals = parseSilenceIntervals(
      result.stderr,
      input.durationSeconds,
    );
    profilingMethod = "ffmpeg-silencedetect";
  } catch {
    silenceIntervals = [];
  }
  const speechIntervals =
    profilingMethod === "duration-fallback"
      ? input.durationSeconds === 0
        ? []
        : [{ start: 0, end: input.durationSeconds }]
      : speechFromSilence({
          durationSeconds: input.durationSeconds,
          silenceIntervals,
        });
  const speechDurationSeconds = speechIntervals.reduce(
    (total, interval) => total + interval.end - interval.start,
    0,
  );
  const silenceDuration = Math.max(
    0,
    input.durationSeconds - speechDurationSeconds,
  );
  const longSilenceDuration = silenceIntervals
    .filter((interval) => interval.end - interval.start >= 2)
    .reduce((total, interval) => total + interval.end - interval.start, 0);
  const speechRatio =
    input.durationSeconds === 0
      ? 0
      : Math.min(1, speechDurationSeconds / input.durationSeconds);
  return mediaProfileSchema.parse({
    schemaVersion: "1.0.0",
    durationSeconds: input.durationSeconds,
    dialogueLanguages: input.dialogueLanguages,
    audioTrack: input.audioTrack,
    speechDurationSeconds,
    speechRatio,
    effectiveSpeechDurationSeconds: speechDurationSeconds,
    musicHeavy:
      speechRatio > 0.35 &&
      speechRatio < 0.8 &&
      silenceDuration / Math.max(1, input.durationSeconds) < 0.25,
    longSilenceRatio:
      input.durationSeconds === 0
        ? 0
        : Math.min(1, longSilenceDuration / input.durationSeconds),
    availableEmbeddedSubtitle: input.availableEmbeddedSubtitle,
    availableReferenceSubtitle: input.availableReferenceSubtitle,
    availablePrimarySubtitle: input.availablePrimarySubtitle,
    speechIntervals,
    profilingMethod,
  });
}

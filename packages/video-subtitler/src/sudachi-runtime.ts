import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import {
  InputError,
  sudachiRuntimeCapabilitySchema,
  type ProcessRunner,
  type SudachiRuntimeCapability,
} from "@mvl/shared";
import { forcedAlignmentSha256 } from "@mvl/transcription-core";

import { sha256LocalFile } from "./finalization-support.js";
import { runSudachiMorphemeAnalysis } from "./sudachi-analysis.js";

export const PINNED_SUDACHI_PY_VERSION = "0.6.11";
export const PINNED_SUDACHI_DICTIONARY_VERSION = "20260428";
export const SUDACHI_RUNTIME_VERSION = "C5.17.1";

export function defaultSudachiRuntimeRoot(): string {
  return path.join(
    homedir(),
    ".cache",
    "mvl",
    "sudachi-runtime",
    "c5-17-1-python-3.12-sudachi-0.6.11-core-20260428",
  );
}

export function sudachiRuntimePaths(root = defaultSudachiRuntimeRoot()): {
  runtimeDirectory: string;
  environmentDirectory: string;
  pythonExecutable: string;
  manifestPath: string;
} {
  const runtimeDirectory = path.resolve(root);
  const environmentDirectory = path.join(runtimeDirectory, "venv");
  return {
    runtimeDirectory,
    environmentDirectory,
    pythonExecutable: path.join(
      environmentDirectory,
      process.platform === "win32" ? "Scripts" : "bin",
      process.platform === "win32" ? "python.exe" : "python",
    ),
    manifestPath: path.join(runtimeDirectory, "runtime-manifest.json"),
  };
}

export async function verifySudachiRuntimeCapability(input: {
  raw: unknown;
  pythonExecutable: string;
  helperPath: string;
  requirementsPath: string;
  runner: ProcessRunner;
}): Promise<SudachiRuntimeCapability> {
  const capability = sudachiRuntimeCapabilitySchema.parse(input.raw);
  for (const executable of [input.pythonExecutable, input.helperPath]) {
    try {
      await access(executable, constants.R_OK);
    } catch {
      throw new InputError(
        `Sudachi runtime dependency is unavailable: ${path.basename(executable)}.`,
      );
    }
  }
  const requirementsSha256 = await sha256LocalFile(input.requirementsPath);
  const helperSha256 = await sha256LocalFile(input.helperPath);
  if (
    capability.requirementsSha256 !== requirementsSha256 ||
    capability.helperSha256 !== helperSha256
  ) {
    throw new InputError(
      "Sudachi runtime manifest does not match the pinned requirements/helper hashes.",
    );
  }
  const versionProbe = await input.runner.run(input.pythonExecutable, [
    "-c",
    [
      "import importlib.metadata as m, json, platform",
      "print(json.dumps({'python': platform.python_version(), 'sudachi': m.version('SudachiPy'), 'dictionary': m.version('SudachiDict-core')}))",
    ].join("\n"),
  ]);
  const versions = JSON.parse(versionProbe.stdout) as {
    python?: unknown;
    sudachi?: unknown;
    dictionary?: unknown;
  };
  if (
    versions.python !== capability.pythonVersion ||
    versions.sudachi !== PINNED_SUDACHI_PY_VERSION ||
    versions.dictionary !== PINNED_SUDACHI_DICTIONARY_VERSION
  ) {
    throw new InputError(
      "Sudachi runtime package versions do not match the manifest.",
    );
  }
  const parsedSample = await runSudachiMorphemeAnalysis({
    pythonExecutable: input.pythonExecutable,
    helperPath: input.helperPath,
    items: [{ id: "offline-probe", text: "日本語" }],
  });
  if (parsedSample.readingsById.get("offline-probe") !== "にほんご") {
    throw new InputError(
      "Sudachi offline verification returned an unexpected reading.",
    );
  }
  const expectedIdentity = forcedAlignmentSha256({
    runtimeVersion: SUDACHI_RUNTIME_VERSION,
    pythonVersion: capability.pythonVersion,
    sudachiPyVersion: capability.sudachiPyVersion,
    sudachiDictionaryVersion: capability.sudachiDictionaryVersion,
    requirementsSha256,
    helperSha256,
  });
  if (capability.runtimeIdentityHash !== expectedIdentity) {
    throw new InputError("Sudachi runtime identity hash is invalid.");
  }
  return capability;
}

export async function buildSudachiRuntimeCapability(input: {
  pythonExecutable: string;
  helperPath: string;
  requirementsPath: string;
  runner: ProcessRunner;
  generatedAt?: string;
}): Promise<SudachiRuntimeCapability> {
  const requirementsSha256 = await sha256LocalFile(input.requirementsPath);
  const helperSha256 = await sha256LocalFile(input.helperPath);
  const probe = await input.runner.run(input.pythonExecutable, [
    "-c",
    [
      "import importlib.metadata as m, json, platform",
      "print(json.dumps({'python': platform.python_version(), 'sudachi': m.version('SudachiPy'), 'dictionary': m.version('SudachiDict-core')}))",
    ].join("\n"),
  ]);
  const versions = JSON.parse(probe.stdout) as Record<string, unknown>;
  if (
    typeof versions.python !== "string" ||
    !/^3\.(?:11|12)\./u.test(versions.python) ||
    versions.sudachi !== PINNED_SUDACHI_PY_VERSION ||
    versions.dictionary !== PINNED_SUDACHI_DICTIONARY_VERSION
  ) {
    throw new InputError(
      "Created Sudachi runtime does not have the pinned package identities.",
    );
  }
  const runtimeIdentityHash = forcedAlignmentSha256({
    runtimeVersion: SUDACHI_RUNTIME_VERSION,
    pythonVersion: versions.python,
    sudachiPyVersion: versions.sudachi,
    sudachiDictionaryVersion: versions.dictionary,
    requirementsSha256,
    helperSha256,
  });
  const capability = sudachiRuntimeCapabilitySchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "sudachi-runtime-capability",
    runtimeVersion: SUDACHI_RUNTIME_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    pythonVersion: versions.python,
    sudachiPyVersion: versions.sudachi,
    sudachiDictionaryVersion: versions.dictionary,
    dictionary: "core",
    splitMode: "C",
    requirementsSha256,
    helperSha256,
    executableBasename: path.basename(input.pythonExecutable),
    runtimeIdentityHash,
    offlineVerificationPassed: true,
    systemPythonModified: false,
    mfaRuntimeDependency: false,
    shareable: true,
  });
  return await verifySudachiRuntimeCapability({
    raw: capability,
    pythonExecutable: input.pythonExecutable,
    helperPath: input.helperPath,
    requirementsPath: input.requirementsPath,
    runner: input.runner,
  });
}

export async function loadSudachiRuntimeCapability(input: {
  manifestPath: string;
  pythonExecutable: string;
  helperPath: string;
  requirementsPath: string;
  runner: ProcessRunner;
}): Promise<SudachiRuntimeCapability> {
  return await verifySudachiRuntimeCapability({
    raw: JSON.parse(await readFile(input.manifestPath, "utf8")) as unknown,
    pythonExecutable: input.pythonExecutable,
    helperPath: input.helperPath,
    requirementsPath: input.requirementsPath,
    runner: input.runner,
  });
}

export function requirementsContentSha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

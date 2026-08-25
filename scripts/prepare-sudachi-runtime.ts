import { access, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { InputError, NodeProcessRunner, atomicWriteJson } from "@mvl/shared";
import {
  buildSudachiRuntimeCapability,
  defaultSudachiRuntimeRoot,
  loadSudachiRuntimeCapability,
  sudachiRuntimePaths,
} from "@mvl/video-subtitler";

const { values } = parseArgs({
  options: {
    "create-runtime": { type: "boolean", default: false },
    "runtime-root": { type: "string" },
    "python-executable": { type: "string" },
    requirements: {
      type: "string",
      default: path.resolve("scripts/requirements-sudachi.txt"),
    },
    helper: {
      type: "string",
      default: path.resolve("scripts/sudachi-readings.py"),
    },
  },
  strict: true,
});

const paths = sudachiRuntimePaths(
  values["runtime-root"] === undefined
    ? defaultSudachiRuntimeRoot()
    : path.resolve(values["runtime-root"]),
);
const requirementsPath = path.resolve(values.requirements);
const helperPath = path.resolve(values.helper);
const runner = new NodeProcessRunner();

async function firstAvailable(candidates: readonly string[]): Promise<string> {
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Keep looking through fixed Python 3.12/3.11 candidates.
    }
  }
  throw new InputError(
    "Sudachi runtime creation requires a callable Python 3.11 or 3.12 executable.",
  );
}

if (!values["create-runtime"]) {
  const capability = await loadSudachiRuntimeCapability({
    manifestPath: paths.manifestPath,
    pythonExecutable: paths.pythonExecutable,
    helperPath,
    requirementsPath,
    runner,
  });
  process.stdout.write(
    `${JSON.stringify({ ok: true, offline: true, manifestPath: paths.manifestPath, runtimeIdentityHash: capability.runtimeIdentityHash }, null, 2)}\n`,
  );
  process.exit(0);
}

const bootstrapPython = await firstAvailable(
  values["python-executable"] === undefined
    ? [
        "/opt/homebrew/bin/python3.12",
        "/opt/homebrew/bin/python3.11",
        "python3.12",
        "python3.11",
      ]
    : [path.resolve(values["python-executable"])],
);
await mkdir(paths.runtimeDirectory, { recursive: true });
try {
  await access(paths.pythonExecutable, constants.X_OK);
} catch {
  await runner.run(bootstrapPython, ["-m", "venv", paths.environmentDirectory]);
}
await runner.run(paths.pythonExecutable, [
  "-m",
  "pip",
  "install",
  "--disable-pip-version-check",
  "--no-input",
  "--requirement",
  requirementsPath,
]);
const capability = await buildSudachiRuntimeCapability({
  pythonExecutable: paths.pythonExecutable,
  helperPath,
  requirementsPath,
  runner,
});
await atomicWriteJson(paths.manifestPath, capability, { overwrite: true });
process.stdout.write(
  `${JSON.stringify({ ok: true, created: true, manifestPath: paths.manifestPath, pythonExecutable: paths.pythonExecutable, runtimeIdentityHash: capability.runtimeIdentityHash }, null, 2)}\n`,
);

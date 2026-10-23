import path from "node:path";
import { parseArgs } from "node:util";

import { InputError, NodeProcessRunner } from "@mvl/shared";
import { loadSudachiRuntimeCapability } from "@mvl/video-subtitler";

const { values } = parseArgs({
  options: {
    "runtime-manifest": { type: "string" },
    "python-executable": { type: "string" },
    helper: {
      type: "string",
      default: path.resolve("scripts/sudachi-readings.py"),
    },
    requirements: {
      type: "string",
      default: path.resolve("scripts/requirements-sudachi.txt"),
    },
  },
  strict: true,
});

if (values["runtime-manifest"] === undefined) {
  throw new InputError("verify:sudachi-runtime requires --runtime-manifest.");
}
const manifestPath = path.resolve(values["runtime-manifest"]);
const pythonExecutable = path.resolve(
  values["python-executable"] ??
    path.join(path.dirname(manifestPath), "venv", "bin", "python"),
);
const capability = await loadSudachiRuntimeCapability({
  manifestPath,
  pythonExecutable,
  helperPath: path.resolve(values.helper),
  requirementsPath: path.resolve(values.requirements),
  runner: new NodeProcessRunner(),
});
process.stdout.write(
  `${JSON.stringify({ ok: true, offline: true, runtimeIdentityHash: capability.runtimeIdentityHash, pythonVersion: capability.pythonVersion, sudachiPyVersion: capability.sudachiPyVersion, dictionaryVersion: capability.sudachiDictionaryVersion }, null, 2)}\n`,
);

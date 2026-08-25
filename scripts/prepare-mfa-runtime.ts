import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  InputError,
  NodeProcessRunner,
  atomicWriteFile,
  atomicWriteJson,
} from "@mvl/shared";
import {
  PINNED_JAPANESE_ACOUSTIC_MODEL,
  PINNED_JAPANESE_DICTIONARY_MODEL,
  PINNED_JAPANESE_G2P_MODEL,
  PINNED_JAPANESE_MODEL_VERSION,
  PINNED_MFA_VERSION,
  OFFICIAL_JAPANESE_ACOUSTIC_CITATION,
  OFFICIAL_JAPANESE_DICTIONARY_CITATION,
  OFFICIAL_JAPANESE_G2P_CITATION,
  OFFICIAL_MFA_MODEL_LICENSE,
  assertMfaNetworkPolicy,
  detectMfaEnvironmentManager,
  mfaCreateEnvironmentArguments,
  mfaRuntimePaths,
  missingMfaManagerError,
  probeMfaRuntimeCapability,
  verifyMfaRuntimeCapability,
} from "@mvl/video-subtitler";

import { runCommand } from "./whisper-runtime-common.js";

const { values } = parseArgs({
  options: {
    "mfa-version": { type: "string", default: PINNED_MFA_VERSION },
    "runtime-root": { type: "string" },
    "create-runtime": { type: "boolean", default: false },
    "create-mfa-runtime": { type: "boolean", default: false },
    "fetch-mfa-models": { type: "boolean", default: false },
  },
  strict: true,
});

if (values["mfa-version"] !== PINNED_MFA_VERSION) {
  throw new InputError(
    `C5.17 requires MFA ${PINNED_MFA_VERSION}; received ${values["mfa-version"]}.`,
  );
}

const createRuntime = values["create-runtime"] || values["create-mfa-runtime"];
const fetchModels = values["fetch-mfa-models"];
const paths = mfaRuntimePaths({
  ...(values["runtime-root"] === undefined
    ? {}
    : { root: path.resolve(values["runtime-root"]) }),
});

if (!createRuntime && !fetchModels) {
  const existing = verifyMfaRuntimeCapability(
    JSON.parse(await readFile(paths.manifestPath, "utf8")) as unknown,
  );
  process.stdout.write(
    `${JSON.stringify({ ok: true, offline: true, manifestPath: paths.manifestPath, runtimeIdentityHash: existing.runtimeIdentityHash }, null, 2)}\n`,
  );
  process.exit(0);
}

const manager = await detectMfaEnvironmentManager();
if (manager === null) throw missingMfaManagerError();
await mkdir(paths.runtimeDirectory, { recursive: true });
await mkdir(paths.modelDirectory, { recursive: true });
await mkdir(paths.temporaryDirectory, { recursive: true });

if (createRuntime) {
  assertMfaNetworkPolicy({
    operation: "create-runtime",
    createRuntime,
    fetchModels,
  });
  await runCommand(
    manager.executable,
    mfaCreateEnvironmentArguments({
      manager: manager.manager,
      environmentDirectory: paths.environmentDirectory,
    }),
  );
}

const executableDirectory = path.join(
  paths.environmentDirectory,
  process.platform === "win32" ? "Scripts" : "bin",
);
const mfaExecutable = path.join(
  executableDirectory,
  process.platform === "win32" ? "mfa.exe" : "mfa",
);
const pythonExecutable = path.join(
  executableDirectory,
  process.platform === "win32" ? "python.exe" : "python",
);
const environment = {
  ...process.env,
  MFA_ROOT_DIR: paths.modelDirectory,
};

const explicit = await runCommand(
  manager.executable,
  ["list", "--explicit", "--prefix", paths.environmentDirectory],
  { environment },
);
await atomicWriteFile(paths.explicitSpecPath, explicit.stdout, {
  overwrite: true,
});

if (fetchModels) {
  assertMfaNetworkPolicy({
    operation: "fetch-models",
    createRuntime,
    fetchModels,
  });
  for (const [modelType, modelName] of [
    ["acoustic", PINNED_JAPANESE_ACOUSTIC_MODEL],
    ["dictionary", PINNED_JAPANESE_DICTIONARY_MODEL],
    ["g2p", PINNED_JAPANESE_G2P_MODEL],
  ] as const) {
    await runCommand(
      mfaExecutable,
      [
        "model",
        "download",
        modelType,
        modelName,
        "--version",
        PINNED_JAPANESE_MODEL_VERSION,
      ],
      { environment },
    );
  }
}

async function findModelArchive(
  modelType: "acoustic" | "dictionary" | "g2p",
  name: string,
): Promise<string> {
  const extension = modelType === "dictionary" ? ".dict" : ".zip";
  const candidates = [
    path.join(
      paths.modelDirectory,
      "pretrained_models",
      modelType,
      `${name}${extension}`,
    ),
    path.join(paths.modelDirectory, "pretrained_models", modelType, name),
    path.join(paths.modelDirectory, modelType, `${name}${extension}`),
  ];
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // Continue through known MFA 3.x layouts only; no broad filesystem scan.
    }
  }
  throw new InputError(
    `Pinned official ${modelType} model ${name} ${PINNED_JAPANESE_MODEL_VERSION} is missing from the isolated model root.`,
  );
}

const [acousticPath, dictionaryPath, g2pPath] = await Promise.all([
  findModelArchive("acoustic", PINNED_JAPANESE_ACOUSTIC_MODEL),
  findModelArchive("dictionary", PINNED_JAPANESE_DICTIONARY_MODEL),
  findModelArchive("g2p", PINNED_JAPANESE_G2P_MODEL),
]);

const oldMfaRoot = process.env.MFA_ROOT_DIR;
process.env.MFA_ROOT_DIR = paths.modelDirectory;
try {
  const capability = await probeMfaRuntimeCapability({
    runner: new NodeProcessRunner(),
    mfaExecutable,
    pythonExecutable,
    explicitSpecPath: paths.explicitSpecPath,
    acousticModel: {
      name: PINNED_JAPANESE_ACOUSTIC_MODEL,
      version: PINNED_JAPANESE_MODEL_VERSION,
      filePath: acousticPath,
      license: OFFICIAL_MFA_MODEL_LICENSE,
      citation: OFFICIAL_JAPANESE_ACOUSTIC_CITATION,
    },
    dictionaryModel: {
      name: PINNED_JAPANESE_DICTIONARY_MODEL,
      version: PINNED_JAPANESE_MODEL_VERSION,
      filePath: dictionaryPath,
      license: OFFICIAL_MFA_MODEL_LICENSE,
      citation: OFFICIAL_JAPANESE_DICTIONARY_CITATION,
    },
    g2pModel: {
      name: PINNED_JAPANESE_G2P_MODEL,
      version: PINNED_JAPANESE_MODEL_VERSION,
      filePath: g2pPath,
      license: OFFICIAL_MFA_MODEL_LICENSE,
      citation: OFFICIAL_JAPANESE_G2P_CITATION,
    },
    networkUsedDuringPreparation: createRuntime || fetchModels,
  });
  await atomicWriteJson(paths.manifestPath, capability, { overwrite: true });
  process.stdout.write(
    `${JSON.stringify({ ok: true, manager: manager.manager, manifestPath: paths.manifestPath, runtimeIdentityHash: capability.runtimeIdentityHash, selectedCommand: capability.commandCapabilities.alignOneCommand, selectedOutputFormat: capability.commandCapabilities.selectedOutputFormat }, null, 2)}\n`,
  );
} finally {
  if (oldMfaRoot === undefined) delete process.env.MFA_ROOT_DIR;
  else process.env.MFA_ROOT_DIR = oldMfaRoot;
}

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
  installPinnedMicromamba,
  PINNED_MICROMAMBA_VERSION,
} from "@mvl/video-subtitler";

import { runCommand } from "./whisper-runtime-common.js";

const { values } = parseArgs({
  options: {
    "mfa-version": { type: "string", default: PINNED_MFA_VERSION },
    "micromamba-version": {
      type: "string",
      default: PINNED_MICROMAMBA_VERSION,
    },
    "install-micromamba": { type: "boolean", default: false },
    "runtime-root": { type: "string" },
    "create-runtime": { type: "boolean", default: false },
    "create-mfa-runtime": { type: "boolean", default: false },
    "fetch-mfa-models": { type: "boolean", default: false },
    "acoustic-model": {
      type: "string",
      default: PINNED_JAPANESE_ACOUSTIC_MODEL,
    },
    "acoustic-model-version": {
      type: "string",
      default: PINNED_JAPANESE_MODEL_VERSION,
    },
    "dictionary-model": {
      type: "string",
      default: PINNED_JAPANESE_DICTIONARY_MODEL,
    },
    "dictionary-model-version": {
      type: "string",
      default: PINNED_JAPANESE_MODEL_VERSION,
    },
    "g2p-model": {
      type: "string",
      default: PINNED_JAPANESE_G2P_MODEL,
    },
    "g2p-model-version": {
      type: "string",
      default: PINNED_JAPANESE_MODEL_VERSION,
    },
  },
  strict: true,
});

if (values["mfa-version"] !== PINNED_MFA_VERSION) {
  throw new InputError(
    `C5.17 requires MFA ${PINNED_MFA_VERSION}; received ${values["mfa-version"]}.`,
  );
}
if (values["micromamba-version"] !== PINNED_MICROMAMBA_VERSION) {
  throw new InputError(
    `C5.17.1 requires Micromamba ${PINNED_MICROMAMBA_VERSION}; received ${values["micromamba-version"]}.`,
  );
}
for (const [name, actual, expected] of [
  ["acoustic model", values["acoustic-model"], PINNED_JAPANESE_ACOUSTIC_MODEL],
  [
    "dictionary model",
    values["dictionary-model"],
    PINNED_JAPANESE_DICTIONARY_MODEL,
  ],
  ["G2P model", values["g2p-model"], PINNED_JAPANESE_G2P_MODEL],
] as const) {
  if (actual !== expected) {
    throw new InputError(
      `C5.17.1 requires official ${name} ${expected}; received ${actual}.`,
    );
  }
}
for (const [name, actual] of [
  ["acoustic model", values["acoustic-model-version"]],
  ["dictionary model", values["dictionary-model-version"]],
  ["G2P model", values["g2p-model-version"]],
] as const) {
  if (actual !== PINNED_JAPANESE_MODEL_VERSION) {
    throw new InputError(
      `C5.17.1 requires ${name} ${PINNED_JAPANESE_MODEL_VERSION}; received ${actual}.`,
    );
  }
}

const createRuntime = values["create-runtime"] || values["create-mfa-runtime"];
const fetchModels = values["fetch-mfa-models"];
const paths = mfaRuntimePaths({
  ...(values["runtime-root"] === undefined
    ? {}
    : { root: path.resolve(values["runtime-root"]) }),
});

if (!createRuntime && !fetchModels) {
  try {
    const existing = verifyMfaRuntimeCapability(
      JSON.parse(await readFile(paths.manifestPath, "utf8")) as unknown,
    );
    process.stdout.write(
      `${JSON.stringify({ ok: true, offline: true, manifestPath: paths.manifestPath, runtimeIdentityHash: existing.runtimeIdentityHash }, null, 2)}\n`,
    );
    process.exit(0);
  } catch (error) {
    if (!(
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    )) {
      throw error;
    }
    // The isolated environment may already be complete while an earlier
    // capability probe failed. Re-probe it without recreating or downloading.
  }
}

const installedMicromamba = values["install-micromamba"]
  ? await installPinnedMicromamba({ allowDownload: true })
  : null;
const manager =
  installedMicromamba === null
    ? await detectMfaEnvironmentManager()
    : {
        manager: "micromamba" as const,
        executable: installedMicromamba.executablePath,
      };
if (manager === null) throw missingMfaManagerError();
await mkdir(paths.runtimeDirectory, { recursive: true });
await mkdir(paths.modelDirectory, { recursive: true });
await mkdir(paths.temporaryDirectory, { recursive: true });
const environment = {
  ...process.env,
  MFA_ROOT_DIR: paths.modelDirectory,
  MAMBA_ROOT_PREFIX: path.join(paths.runtimeDirectory, "micromamba-root"),
};

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
    { environment },
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

const officialCache = JSON.parse(
  await readFile(
    path.join(paths.modelDirectory, "pretrained_models", "cache.json"),
    "utf8",
  ),
) as Record<string, Record<string, Record<string, unknown>>>;
function officialRegistryEntry(
  modelType: "acoustic" | "dictionary" | "g2p",
  modelName: string,
): readonly [string, string, string, string, string, number] {
  const entry =
    officialCache[modelType]?.[modelName]?.[
      `v${PINNED_JAPANESE_MODEL_VERSION}`
    ];
  if (
    !Array.isArray(entry) ||
    entry.length !== 6 ||
    entry.slice(0, 5).some((value) => typeof value !== "string") ||
    typeof entry[5] !== "number"
  ) {
    throw new InputError(
      `Official MFA registry has no exact ${modelType} ${modelName} ${PINNED_JAPANESE_MODEL_VERSION} entry.`,
    );
  }
  return entry as unknown as readonly [
    string,
    string,
    string,
    string,
    string,
    number,
  ];
}

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
    officialRegistry: {
      acoustic: officialRegistryEntry(
        "acoustic",
        PINNED_JAPANESE_ACOUSTIC_MODEL,
      ),
      dictionary: officialRegistryEntry(
        "dictionary",
        PINNED_JAPANESE_DICTIONARY_MODEL,
      ),
      g2p: officialRegistryEntry("g2p", PINNED_JAPANESE_G2P_MODEL),
    },
    networkUsedDuringPreparation: createRuntime || fetchModels,
    ...(installedMicromamba === null
      ? {}
      : { micromamba: installedMicromamba.identity }),
  });
  await atomicWriteJson(paths.manifestPath, capability, { overwrite: true });
  process.stdout.write(
    `${JSON.stringify({ ok: true, manager: manager.manager, micromamba: installedMicromamba?.identity ?? null, manifestPath: paths.manifestPath, runtimeIdentityHash: capability.runtimeIdentityHash, selectedCommand: capability.commandCapabilities.alignOneCommand, selectedG2pCommand: capability.commandCapabilities.g2pCommand, selectedOutputFormat: capability.commandCapabilities.selectedOutputFormat }, null, 2)}\n`,
  );
} finally {
  if (oldMfaRoot === undefined) delete process.env.MFA_ROOT_DIR;
  else process.env.MFA_ROOT_DIR = oldMfaRoot;
}

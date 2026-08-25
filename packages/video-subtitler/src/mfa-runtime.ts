import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import {
  InputError,
  UserActionRequiredError,
  forcedAlignmentRuntimeCapabilitySchema,
  type ForcedAlignmentModelIdentity,
  type ForcedAlignmentRuntimeCapability,
  type MicromambaInstallationIdentity,
  type ProcessRunner,
} from "@mvl/shared";
import { forcedAlignmentSha256 } from "@mvl/transcription-core";

import { sha256LocalFile } from "./finalization-support.js";

export const PINNED_MFA_VERSION = "3.4.2";
export const PINNED_JAPANESE_MODEL_VERSION = "3.0.0";
export const PINNED_JAPANESE_ACOUSTIC_MODEL = "japanese_mfa";
export const PINNED_JAPANESE_DICTIONARY_MODEL = "japanese_mfa";
export const PINNED_JAPANESE_G2P_MODEL = "japanese_katakana_mfa";
export const OFFICIAL_MFA_MODEL_LICENSE = "CC BY 4.0";
export const OFFICIAL_JAPANESE_ACOUSTIC_CITATION =
  "@techreport{mfa_japanese_mfa_acoustic_2024, title={Japanese MFA acoustic model v3.0.0}, year={2024}}";
export const OFFICIAL_JAPANESE_DICTIONARY_CITATION =
  "@techreport{mfa_japanese_mfa_dictionary_2024, title={Japanese MFA dictionary v3.0.0}, year={2024}}";
export const OFFICIAL_JAPANESE_G2P_CITATION =
  "@techreport{mfa_japanese_katakana_mfa_g2p_2023, title={Japanese (Katakana) MFA G2P model v3.0.0}, year={2023}}";

export type MfaEnvironmentManager = "micromamba" | "mamba" | "conda";

export function selectMfaG2pCommand(input: {
  g2pHelp: { exitCode: number; output: string };
  g2pOneHelp: { exitCode: number; output: string };
}): "g2p" | "g2p_one" {
  const g2pOneViable =
    input.g2pOneHelp.exitCode === 0 &&
    /g2p_one/iu.test(input.g2pOneHelp.output) &&
    /word|text/iu.test(input.g2pOneHelp.output) &&
    /g2p.*model/iu.test(input.g2pOneHelp.output);
  if (g2pOneViable) return "g2p_one";
  const g2pViable =
    input.g2pHelp.exitCode === 0 &&
    /\bg2p\b/iu.test(input.g2pHelp.output) &&
    /input|corpus|word|text/iu.test(input.g2pHelp.output) &&
    /output/iu.test(input.g2pHelp.output) &&
    /g2p.*model/iu.test(input.g2pHelp.output);
  if (g2pViable) return "g2p";
  throw new InputError(
    "MFA 3.4.2 exposes neither a verified g2p_one nor g2p command.",
  );
}

function pathEntries(environmentPath = process.env.PATH ?? ""): string[] {
  return environmentPath.split(path.delimiter).filter((entry) => entry !== "");
}

async function executableAt(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function detectMfaEnvironmentManager(
  input: {
    environmentPath?: string;
    platform?: NodeJS.Platform;
  } = {},
): Promise<{ manager: MfaEnvironmentManager; executable: string } | null> {
  const suffix = (input.platform ?? process.platform) === "win32" ? ".exe" : "";
  for (const manager of ["micromamba", "mamba", "conda"] as const) {
    for (const directory of pathEntries(input.environmentPath)) {
      const candidate = path.join(directory, `${manager}${suffix}`);
      if (await executableAt(candidate))
        return { manager, executable: candidate };
    }
  }
  return null;
}

export function defaultMfaRuntimeRoot(): string {
  return path.join(
    homedir(),
    ".cache",
    "mvl",
    "mfa-runtime",
    PINNED_MFA_VERSION,
  );
}

export function mfaRuntimeId(
  input: {
    platform?: string;
    architecture?: string;
    pythonVersion?: string;
  } = {},
): string {
  return [
    input.platform ?? process.platform,
    input.architecture ?? process.arch,
    `python-${input.pythonVersion ?? "3.11"}`,
    `mfa-${PINNED_MFA_VERSION}`,
  ].join("-");
}

export function mfaRuntimePaths(
  input: {
    root?: string;
    runtimeId?: string;
  } = {},
): {
  runtimeDirectory: string;
  environmentDirectory: string;
  modelDirectory: string;
  temporaryDirectory: string;
  manifestPath: string;
  explicitSpecPath: string;
} {
  const runtimeDirectory = path.join(
    input.root ?? defaultMfaRuntimeRoot(),
    input.runtimeId ?? mfaRuntimeId(),
  );
  return {
    runtimeDirectory,
    environmentDirectory: path.join(runtimeDirectory, "env"),
    modelDirectory: path.join(runtimeDirectory, "models"),
    temporaryDirectory: path.join(runtimeDirectory, "temporary"),
    manifestPath: path.join(runtimeDirectory, "runtime-manifest.json"),
    explicitSpecPath: path.join(runtimeDirectory, "conda-explicit-spec.txt"),
  };
}

export function assertMfaNetworkPolicy(input: {
  operation: "normal-replay" | "create-runtime" | "fetch-models";
  createRuntime: boolean;
  fetchModels: boolean;
}): void {
  if (
    input.operation === "normal-replay" &&
    (input.createRuntime || input.fetchModels)
  ) {
    throw new InputError(
      "Normal forced-alignment replay is offline; runtime/model network operations require their explicit commands.",
    );
  }
  if (input.operation === "create-runtime" && !input.createRuntime) {
    throw new InputError(
      "Runtime creation requires --create-mfa-runtime/--create-runtime.",
    );
  }
  if (input.operation === "fetch-models" && !input.fetchModels) {
    throw new InputError("Model download requires --fetch-mfa-models.");
  }
}

export function missingMfaManagerError(): UserActionRequiredError {
  return new UserActionRequiredError(
    "MFA runtime preparation requires micromamba, mamba, or conda (checked in that order). Install one explicitly, then rerun prepare:mfa-runtime. Codex will not install Miniforge, use curl | sh, or modify shell profiles.",
    {
      detectedManagers: [],
      allowedManagers: ["micromamba", "mamba", "conda"],
      automaticInstallerUsed: false,
      shellProfileModified: false,
    },
  );
}

function combinedOutput(result: { stdout: string; stderr: string }): string {
  return `${result.stdout}\n${result.stderr}`;
}

export function parseMfaVersion(value: string): string {
  const match = /(?:Montreal Forced Aligner|MFA)?\s*v?(\d+\.\d+\.\d+)/iu.exec(
    value,
  );
  if (match?.[1] === undefined) {
    throw new InputError(`Could not parse MFA version output: ${value.trim()}`);
  }
  return match[1];
}

export function selectMfaAlignOneCommand(input: {
  alignOneHelp: { exitCode: number; output: string };
  alignOneLegacyHelp: { exitCode: number; output: string };
}): "align_one" | "align_one_legacy" {
  const viable = (value: { exitCode: number; output: string }, name: string) =>
    value.exitCode === 0 &&
    value.output.toLowerCase().includes(name.toLowerCase()) &&
    /sound|audio|wav/iu.test(value.output) &&
    /text|transcript/iu.test(value.output);
  if (viable(input.alignOneHelp, "align_one")) return "align_one";
  if (viable(input.alignOneLegacyHelp, "align_one_legacy")) {
    return "align_one_legacy";
  }
  throw new InputError(
    "MFA 3.4.2 exposes neither a verified align_one nor align_one_legacy single-file command.",
  );
}

function capabilityFlags(help: string) {
  return {
    g2pSupported: /--g2p_model_path\b/u.test(help),
    originalTextSupported: /--include_original_text\b/u.test(help),
    noTokenizationSupported: /--no_tokenization\b/u.test(help),
    jsonOutputSupported: /(?:--output_format[^\n]*json|\bjson\b)/iu.test(help),
    textGridOutputSupported: /(?:textgrid|long_textgrid)/iu.test(help),
  };
}

interface ModelProbeInput {
  modelType: ForcedAlignmentModelIdentity["modelType"];
  name: string;
  version: string;
  filePath: string;
  license: string;
  citation: string;
  inspectOutput: string;
  inspectExitCode: number;
  listOutput: string;
  registryMetadata: readonly [string, string, string, string, string, number];
}

async function modelIdentity(
  input: ModelProbeInput,
): Promise<ForcedAlignmentModelIdentity> {
  const info = await import("node:fs/promises").then(
    async ({ stat }) => await stat(input.filePath),
  );
  if (!info.isFile()) {
    throw new InputError(`MFA ${input.modelType} model is not a regular file.`);
  }
  if (!input.listOutput.toLowerCase().includes(input.name.toLowerCase())) {
    throw new InputError(
      `MFA model list did not identify ${input.modelType} ${input.name}.`,
    );
  }
  const [registryName, releaseTag, registryVersion, downloadUrl, fileName] =
    input.registryMetadata;
  if (
    registryName !== input.name ||
    registryVersion !== `v${input.version}` ||
    fileName !== path.basename(input.filePath) ||
    !downloadUrl.startsWith(
      "https://api.github.com/repos/MontrealCorpusTools/mfa-models/releases/assets/",
    )
  ) {
    throw new InputError(
      `MFA official registry did not confirm ${input.modelType} ${input.name} ${input.version}.`,
    );
  }
  const knownDictionaryInspectFailure =
    input.modelType === "dictionary" &&
    input.inspectExitCode !== 0 &&
    /PosixPath.*load_dictionary_paths/isu.test(input.inspectOutput);
  if (input.inspectExitCode !== 0 && !knownDictionaryInspectFailure) {
    throw new InputError(
      `MFA model inspect failed for ${input.modelType} ${input.name}.`,
    );
  }
  if (
    input.inspectExitCode === 0 &&
    !input.inspectOutput.toLowerCase().includes(input.name.toLowerCase())
  ) {
    throw new InputError(
      `MFA model inspect did not identify ${input.modelType} ${input.name}.`,
    );
  }
  return {
    modelType: input.modelType,
    name: input.name,
    version: input.version,
    fileBasename: path.basename(input.filePath),
    size: info.size,
    sha256: await sha256LocalFile(input.filePath),
    license: input.license,
    citation: input.citation,
    metadataSha256: createHash("sha256")
      .update(
        JSON.stringify({
          registryMetadata: input.registryMetadata,
          inspectExitCode: input.inspectExitCode,
          inspectOutput: input.inspectOutput,
        }),
        "utf8",
      )
      .digest("hex"),
    officialSource: "MontrealCorpusTools",
    officialReleaseTag: releaseTag,
    officialDownloadUrl: downloadUrl,
    inspectStatus: knownDictionaryInspectFailure
      ? "known-upstream-cli-failure"
      : "verified",
    inspectExitCode: input.inspectExitCode,
    inspectDiagnostic: knownDictionaryInspectFailure
      ? "MFA 3.4.2 dictionary inspect failed inside upstream pretty_print with PosixPath.load_dictionary_paths; model list, official registry identity, file hash, and real align_one compatibility remain independently verified."
      : null,
    phoneset: [
      ...new Set(
        [
          ...input.inspectOutput.matchAll(
            /(?:phone_set_type|phoneset)\s*[:=]\s*([^\n]+)/giu,
          ),
        ]
          .map((match) => match[1]?.trim())
          .filter((value): value is string => Boolean(value)),
      ),
    ],
    silencePhones: [
      ...new Set(
        [
          ...input.inspectOutput.matchAll(
            /silence(?:_phones| phones)?\s*[:=]\s*([^\n]+)/giu,
          ),
        ]
          .flatMap((match) => match[1]?.split(/[\s,]+/u) ?? [])
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ],
    tokenizerRequirements: [
      ...new Set(
        [
          ...input.inspectOutput.matchAll(
            /(?:tokenizer|dependencies?)\s*[:=]\s*([^\n]+)/giu,
          ),
        ]
          .map((match) => match[1]?.trim())
          .filter((value): value is string => Boolean(value)),
      ),
    ],
  };
}

interface PythonRuntimeVersions {
  pythonVersion: string;
  kalpyVersion: string;
  kaldiVersion: string;
  pyniniVersion: string;
  sudachiVersion: string;
  praatioVersion: string;
}

function parseRuntimeVersions(value: string): PythonRuntimeVersions {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch (error) {
    throw new InputError("MFA Python runtime returned invalid version JSON.", {
      cause: String(error),
    });
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new InputError(
      "MFA Python runtime version payload is not an object.",
    );
  }
  const record = parsed as Record<string, unknown>;
  const required = [
    "pythonVersion",
    "kalpyVersion",
    "kaldiVersion",
    "pyniniVersion",
    "sudachiVersion",
    "praatioVersion",
  ] as const;
  for (const key of required) {
    if (typeof record[key] !== "string" || record[key] === "") {
      throw new InputError(`MFA Python runtime did not report ${key}.`);
    }
  }
  return record as unknown as PythonRuntimeVersions;
}

function condaExplicitPackageVersion(
  spec: Buffer,
  packageName: string,
): string | null {
  const pattern = new RegExp(
    `/${packageName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}-([0-9][^-]*)-`,
    "u",
  );
  return pattern.exec(spec.toString("utf8"))?.[1] ?? null;
}

export interface ProbeMfaRuntimeOptions {
  runner: ProcessRunner;
  mfaExecutable: string;
  pythonExecutable: string;
  explicitSpecPath: string;
  acousticModel: Omit<
    ModelProbeInput,
    | "modelType"
    | "inspectOutput"
    | "inspectExitCode"
    | "listOutput"
    | "registryMetadata"
  >;
  dictionaryModel: ProbeMfaRuntimeOptions["acousticModel"];
  g2pModel: ProbeMfaRuntimeOptions["acousticModel"];
  generatedAt?: string;
  networkUsedDuringPreparation: boolean;
  micromamba?: MicromambaInstallationIdentity;
  sampleJsonTierProbe?: { wordTier: boolean; phoneTier: boolean };
  officialRegistry: {
    acoustic: ModelProbeInput["registryMetadata"];
    dictionary: ModelProbeInput["registryMetadata"];
    g2p: ModelProbeInput["registryMetadata"];
  };
  platform?: string;
  architecture?: string;
}

const PYTHON_VERSION_PROBE = [
  "import importlib.metadata as m, json, platform",
  "def v(*names):",
  "  for name in names:",
  "    try: return m.version(name)",
  "    except m.PackageNotFoundError: pass",
  "  return 'unavailable'",
  "print(json.dumps({'pythonVersion': platform.python_version(), 'kalpyVersion': v('kalpy'), 'kaldiVersion': v('kaldi-native-fbank','kaldi'), 'pyniniVersion': v('pynini'), 'sudachiVersion': v('SudachiPy'), 'praatioVersion': v('praatio')}))",
].join("\n");

export async function probeMfaRuntimeCapability(
  options: ProbeMfaRuntimeOptions,
): Promise<ForcedAlignmentRuntimeCapability> {
  const [
    versionResult,
    alignOne,
    alignOneLegacy,
    g2pHelp,
    g2pOneHelp,
    runtimeVersionsResult,
    spec,
  ] = await Promise.all([
    options.runner.run(options.mfaExecutable, ["version"], {
      allowNonZero: true,
    }),
    options.runner.run(options.mfaExecutable, ["align_one", "--help"], {
      allowNonZero: true,
    }),
    options.runner.run(options.mfaExecutable, ["align_one_legacy", "--help"], {
      allowNonZero: true,
    }),
    options.runner.run(options.mfaExecutable, ["g2p", "--help"], {
      allowNonZero: true,
    }),
    options.runner.run(options.mfaExecutable, ["g2p_one", "--help"], {
      allowNonZero: true,
    }),
    options.runner.run(options.pythonExecutable, ["-c", PYTHON_VERSION_PROBE]),
    import("node:fs/promises").then(
      async ({ readFile }) => await readFile(options.explicitSpecPath),
    ),
  ]);
  const mfaVersion = parseMfaVersion(combinedOutput(versionResult));
  if (mfaVersion !== PINNED_MFA_VERSION) {
    throw new InputError(
      `MFA runtime version mismatch: expected ${PINNED_MFA_VERSION}, received ${mfaVersion}. Unknown MFA 4.x behavior is rejected.`,
    );
  }
  const alignOneCommand = selectMfaAlignOneCommand({
    alignOneHelp: {
      exitCode: alignOne.exitCode,
      output: combinedOutput(alignOne),
    },
    alignOneLegacyHelp: {
      exitCode: alignOneLegacy.exitCode,
      output: combinedOutput(alignOneLegacy),
    },
  });
  const selectedHelp =
    alignOneCommand === "align_one"
      ? combinedOutput(alignOne)
      : combinedOutput(alignOneLegacy);
  const flags = capabilityFlags(selectedHelp);
  const g2pCommand = selectMfaG2pCommand({
    g2pHelp: { exitCode: g2pHelp.exitCode, output: combinedOutput(g2pHelp) },
    g2pOneHelp: {
      exitCode: g2pOneHelp.exitCode,
      output: combinedOutput(g2pOneHelp),
    },
  });
  if (!flags.g2pSupported) {
    throw new InputError(
      `MFA ${alignOneCommand} does not expose --g2p_model_path; Japanese OOV handling cannot be verified.`,
    );
  }
  if (!flags.textGridOutputSupported && !flags.jsonOutputSupported) {
    throw new InputError(
      "MFA single-file command exposes no supported output format.",
    );
  }
  const inspect = async (
    modelType: "acoustic" | "dictionary" | "g2p",
    model: ProbeMfaRuntimeOptions["acousticModel"],
    registryMetadata: ModelProbeInput["registryMetadata"],
  ) => {
    const [result, list] = await Promise.all([
      options.runner.run(
        options.mfaExecutable,
        ["model", "inspect", modelType, model.name],
        { allowNonZero: true },
      ),
      options.runner.run(options.mfaExecutable, ["model", "list", modelType], {
        allowNonZero: true,
      }),
    ]);
    if (list.exitCode !== 0) {
      throw new InputError(`MFA could not list official ${modelType} models.`);
    }
    return await modelIdentity({
      ...model,
      modelType,
      inspectOutput: combinedOutput(result),
      inspectExitCode: result.exitCode,
      listOutput: combinedOutput(list),
      registryMetadata,
    });
  };
  const [acousticModel, dictionaryModel, g2pModel] = await Promise.all([
    inspect(
      "acoustic",
      options.acousticModel,
      options.officialRegistry.acoustic,
    ),
    inspect(
      "dictionary",
      options.dictionaryModel,
      options.officialRegistry.dictionary,
    ),
    inspect("g2p", options.g2pModel, options.officialRegistry.g2p),
  ]);
  if (
    acousticModel.name !== PINNED_JAPANESE_ACOUSTIC_MODEL ||
    dictionaryModel.name !== PINNED_JAPANESE_DICTIONARY_MODEL ||
    g2pModel.name !== PINNED_JAPANESE_G2P_MODEL ||
    [acousticModel, dictionaryModel, g2pModel].some(
      (model) => model.version !== PINNED_JAPANESE_MODEL_VERSION,
    )
  ) {
    throw new InputError(
      "MFA Japanese model identity is not the pinned C5.17 set.",
    );
  }
  const runtimeVersions = parseRuntimeVersions(runtimeVersionsResult.stdout);
  if (runtimeVersions.kalpyVersion === "unavailable") {
    runtimeVersions.kalpyVersion =
      condaExplicitPackageVersion(spec, "kalpy") ?? "unavailable";
  }
  if (runtimeVersions.kaldiVersion === "unavailable") {
    runtimeVersions.kaldiVersion =
      condaExplicitPackageVersion(spec, "kaldi") ?? "unavailable";
  }
  const environmentExplicitSpecSha256 = createHash("sha256")
    .update(spec)
    .digest("hex");
  const jsonComplete =
    flags.jsonOutputSupported &&
    options.sampleJsonTierProbe?.wordTier === true &&
    options.sampleJsonTierProbe.phoneTier;
  const selectedOutputFormat = jsonComplete ? "json" : "long_textgrid";
  if (
    selectedOutputFormat === "long_textgrid" &&
    !flags.textGridOutputSupported
  ) {
    throw new InputError(
      "MFA JSON did not prove complete word and phone tiers and long TextGrid is unavailable.",
    );
  }
  const identityInput = {
    backend: "mfa-japanese",
    mfaVersion,
    ...runtimeVersions,
    alignOneCommand,
    selectedOutputFormat,
    g2pCommand,
    acousticModel,
    dictionaryModel,
    g2pModel,
    environmentExplicitSpecSha256,
    platform: options.platform ?? process.platform,
    architecture: options.architecture ?? process.arch,
  };
  return forcedAlignmentRuntimeCapabilitySchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "forced-alignment-runtime-capability",
    runtimeVersion: "C5.17.1",
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    backend: "mfa-japanese",
    mfaVersion,
    ...runtimeVersions,
    commandCapabilities: {
      alignOneCommand,
      outputFormats: [
        ...(flags.jsonOutputSupported ? (["json"] as const) : []),
        ...(flags.textGridOutputSupported ? (["long_textgrid"] as const) : []),
      ],
      selectedOutputFormat,
      jsonHasWordTier: options.sampleJsonTierProbe?.wordTier ?? false,
      jsonHasPhoneTier: options.sampleJsonTierProbe?.phoneTier ?? false,
      g2pSupported: flags.g2pSupported,
      g2pCommand,
      g2pHelpVerified: true,
      originalTextSupported: flags.originalTextSupported,
      tokenizationMode: "sudachi",
      speakerAdaptationSkipped: true,
    },
    acousticModel,
    dictionaryModel,
    g2pModel,
    environmentExplicitSpecSha256,
    ...(options.micromamba === undefined
      ? {}
      : { micromamba: options.micromamba }),
    runtimeIdentityHash: forcedAlignmentSha256(identityInput),
    platform: options.platform ?? process.platform,
    architecture: options.architecture ?? process.arch,
    networkUsedDuringPreparation: options.networkUsedDuringPreparation,
    networkUsedDuringAlignment: false,
    shareable: true,
  });
}

export function verifyMfaRuntimeCapability(
  raw: unknown,
): ForcedAlignmentRuntimeCapability {
  const capability = forcedAlignmentRuntimeCapabilitySchema.parse(raw);
  if (
    capability.acousticModel.name !== PINNED_JAPANESE_ACOUSTIC_MODEL ||
    capability.dictionaryModel.name !== PINNED_JAPANESE_DICTIONARY_MODEL ||
    capability.g2pModel.name !== PINNED_JAPANESE_G2P_MODEL ||
    [
      capability.acousticModel.version,
      capability.dictionaryModel.version,
      capability.g2pModel.version,
    ].some((version) => version !== PINNED_JAPANESE_MODEL_VERSION)
  ) {
    throw new InputError("Forced-alignment runtime/model identity mismatch.");
  }
  const serialized = JSON.stringify(capability);
  if (
    /(?:^|["'\s(])(?:\/(?:Users|home|opt|private|tmp)\/|[A-Za-z]:[\\/]|file:\/\/)/u.test(
      serialized,
    )
  ) {
    throw new InputError(
      "Shareable forced-alignment capability contains an absolute path.",
    );
  }
  return capability;
}

export function mfaCreateEnvironmentArguments(input: {
  manager: MfaEnvironmentManager;
  environmentDirectory: string;
}): string[] {
  const packages = [
    "python=3.11",
    `montreal-forced-aligner=${PINNED_MFA_VERSION}`,
    "praatio",
  ];
  return input.manager === "conda"
    ? [
        "create",
        "--yes",
        "--prefix",
        input.environmentDirectory,
        "--channel",
        "conda-forge",
        "--strict-channel-priority",
        ...packages,
      ]
    : [
        "create",
        "--yes",
        "--prefix",
        input.environmentDirectory,
        "--channel",
        "conda-forge",
        "--strict-channel-priority",
        ...packages,
      ];
}

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  InputError,
  NodeProcessRunner,
  atomicWriteFile,
  atomicWriteJson,
  ctcModelManifestSchema,
  ctcRuntimeManifestSchema,
} from "@mvl/shared";
import {
  CTC_MODEL_LICENSE,
  CTC_MODEL_REPO,
  CTC_MODEL_REVISION,
  CTC_RUNTIME_REQUIREMENTS,
  SEPARATION_MODEL_REPO,
  SEPARATION_MODEL_REVISION,
  ctcModelSnapshotIdentity,
  ctcRuntimeIdentity,
  loadAndVerifyCtcRuntime,
  sha256Value,
} from "@mvl/video-subtitler";

const { values } = parseArgs({
  options: {
    "create-runtime": { type: "boolean", default: false },
    "fetch-ctc-model": { type: "boolean", default: false },
    "ctc-model": { type: "string", default: CTC_MODEL_REPO },
    "model-revision": { type: "string", default: CTC_MODEL_REVISION },
    "fetch-separation-model": { type: "boolean", default: false },
    "separation-model": { type: "string", default: SEPARATION_MODEL_REPO },
    "separation-revision": {
      type: "string",
      default: SEPARATION_MODEL_REVISION,
    },
    "runtime-root": { type: "string" },
    "python-command": {
      type: "string",
      default: "/opt/homebrew/bin/python3.12",
    },
    "hf-token-env": { type: "string", default: "HF_TOKEN" },
  },
  strict: true,
});

if (
  !values["create-runtime"] &&
  !values["fetch-ctc-model"] &&
  !values["fetch-separation-model"]
) {
  throw new InputError(
    "Pass --create-runtime, --fetch-ctc-model, and/or --fetch-separation-model.",
  );
}
if (
  values["ctc-model"] !== CTC_MODEL_REPO ||
  values["model-revision"] !== CTC_MODEL_REVISION
) {
  throw new InputError(
    `C5.18.1 requires ${CTC_MODEL_REPO}@${CTC_MODEL_REVISION}.`,
  );
}
if (
  values["separation-model"] !== SEPARATION_MODEL_REPO ||
  values["separation-revision"] !== SEPARATION_MODEL_REVISION
) {
  throw new InputError(
    `C5.18.1 requires ${SEPARATION_MODEL_REPO}@${SEPARATION_MODEL_REVISION} when separation is fetched.`,
  );
}
if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(values["hf-token-env"])) {
  throw new InputError("--hf-token-env must name one environment variable.");
}

const runner = new NodeProcessRunner();
const systemPython = values["python-command"];
const systemPythonVersion = (
  await runner.run(systemPython, [
    "-c",
    "import platform; print(platform.python_version())",
  ])
).stdout.trim();
if (!systemPythonVersion.startsWith("3.12.")) {
  throw new InputError(
    `C5.18.1 runtime preparation requires Python 3.12, received ${systemPythonVersion}.`,
  );
}
const dependencySpec = `${CTC_RUNTIME_REQUIREMENTS.join("\n")}\n`;
const dependencySpecSha256 = createHash("sha256")
  .update(dependencySpec)
  .digest("hex");
const runtimeId = `c5181-${sha256Value({
  systemPythonVersion,
  requirements: CTC_RUNTIME_REQUIREMENTS,
}).slice(0, 16)}`;
const runtimeRoot = path.resolve(
  values["runtime-root"] ??
    path.join(homedir(), ".cache", "mvl", "ctc-runtime"),
);
const runtimeDirectory = path.join(runtimeRoot, runtimeId);
const runtimePython = path.join(runtimeDirectory, "bin", "python");
const manifestDirectory = path.join(runtimeDirectory, "manifests");
const explicitSpecPath = path.join(
  manifestDirectory,
  "requirements-explicit.txt",
);
const dependencySpecPath = path.join(
  manifestDirectory,
  "requirements-direct.txt",
);
await mkdir(manifestDirectory, { recursive: true });

if (values["create-runtime"]) {
  try {
    if (!(await stat(runtimePython)).isFile()) throw new Error("not-file");
  } catch {
    await runner.run(systemPython, ["-m", "venv", runtimeDirectory], {
      timeoutMs: 120_000,
    });
  }
  await runner.run(
    runtimePython,
    [
      "-m",
      "pip",
      "install",
      "--disable-pip-version-check",
      "--no-input",
      ...CTC_RUNTIME_REQUIREMENTS,
    ],
    { timeoutMs: 1_800_000 },
  );
}

const packageNames = [
  "torch",
  "transformers",
  "huggingface-hub",
  "safetensors",
  "numpy",
  "soundfile",
  "speechbrain",
];
const packageProbe = await runner.run(runtimePython, [
  "-c",
  `import importlib.metadata,json; names=${JSON.stringify(packageNames)}; print(json.dumps([{"name":n,"version":importlib.metadata.version(n)} for n in names],separators=(",",":")))`,
]);
const packages = JSON.parse(packageProbe.stdout) as {
  name: string;
  version: string;
}[];
const runtimePythonVersion = (
  await runner.run(runtimePython, [
    "-c",
    "import platform; print(platform.python_version())",
  ])
).stdout.trim();
const explicitSpec = (
  await runner.run(runtimePython, ["-m", "pip", "freeze", "--all"])
).stdout;
await Promise.all([
  atomicWriteFile(explicitSpecPath, explicitSpec, { overwrite: true }),
  atomicWriteFile(dependencySpecPath, dependencySpec, { overwrite: true }),
]);
const explicitSpecSha256 = createHash("sha256")
  .update(await readFile(explicitSpecPath))
  .digest("hex");
const runtimeManifest = ctcRuntimeManifestSchema.parse({
  schemaVersion: "1.0.0",
  artifactType: "ctc-runtime-manifest",
  runtimeVersion: "C5.18.1",
  generatedAt: new Date().toISOString(),
  runtimeId,
  runtimeDirectory,
  pythonExecutable: runtimePython,
  pythonVersion: runtimePythonVersion,
  packages,
  explicitSpecPath,
  explicitSpecSha256,
  dependencySpecSha256,
  runtimeIdentityHash: ctcRuntimeIdentity({
    pythonVersion: runtimePythonVersion,
    packages,
    explicitSpecSha256,
    dependencySpecSha256,
  }),
});
const runtimeManifestPath = path.join(
  manifestDirectory,
  "ctc-runtime-manifest.json",
);
await atomicWriteJson(runtimeManifestPath, runtimeManifest, {
  overwrite: true,
});

async function collectFiles(
  directory: string,
  root = directory,
): Promise<{ relativePath: string; size: number; sha256: string }[]> {
  const output: { relativePath: string; size: number; sha256: string }[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      output.push(...(await collectFiles(entryPath, root)));
      continue;
    }
    const info = await stat(entryPath);
    if (!info.isFile()) continue;
    output.push({
      relativePath: path.relative(root, entryPath).split(path.sep).join("/"),
      size: info.size,
      sha256: createHash("sha256")
        .update(await readFile(entryPath))
        .digest("hex"),
    });
  }
  return output.toSorted((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
}

async function snapshotDownload(repo: string, revision: string) {
  const code = [
    "import json,os,sys",
    "from huggingface_hub import snapshot_download",
    "repo,revision,token_name=sys.argv[1:4]",
    "token=os.environ.get(token_name) or None",
    "target=snapshot_download(repo_id=repo,revision=revision,token=token)",
    "print(json.dumps({'snapshotDirectory':target},separators=(',',':')))",
  ].join(";");
  const result = await runner.run(
    runtimePython,
    ["-c", code, repo, revision, values["hf-token-env"]],
    { timeoutMs: 3_600_000 },
  );
  return path.resolve(
    (JSON.parse(result.stdout) as { snapshotDirectory: string })
      .snapshotDirectory,
  );
}

const modelManifestPath = path.join(
  manifestDirectory,
  "ctc-model-manifest.json",
);
let priorModel: unknown;
try {
  priorModel = JSON.parse(await readFile(modelManifestPath, "utf8")) as unknown;
} catch {
  priorModel = null;
}
const prior =
  priorModel === null ? null : ctcModelManifestSchema.parse(priorModel);
const ctcSnapshot = values["fetch-ctc-model"]
  ? await snapshotDownload(CTC_MODEL_REPO, CTC_MODEL_REVISION)
  : prior?.snapshotDirectory;
if (ctcSnapshot === undefined) {
  process.stdout.write(
    `${JSON.stringify({ ok: true, runtimeManifest: runtimeManifestPath }, null, 2)}\n`,
  );
  process.exit(0);
}
const modelFiles = await collectFiles(ctcSnapshot);
const modelSnapshotHash = ctcModelSnapshotIdentity({
  modelRepo: CTC_MODEL_REPO,
  modelRevision: CTC_MODEL_REVISION,
  modelFiles,
});

const separationSnapshot = values["fetch-separation-model"]
  ? await snapshotDownload(SEPARATION_MODEL_REPO, SEPARATION_MODEL_REVISION)
  : prior?.separationModel?.snapshotDirectory;
const separationModel =
  separationSnapshot === undefined
    ? null
    : await (async () => {
        const files = await collectFiles(separationSnapshot);
        return {
          modelRepo: SEPARATION_MODEL_REPO,
          requestedRevision: SEPARATION_MODEL_REVISION,
          resolvedRevision: SEPARATION_MODEL_REVISION,
          snapshotDirectory: separationSnapshot,
          modelSnapshotHash: ctcModelSnapshotIdentity({
            modelRepo: SEPARATION_MODEL_REPO,
            modelRevision: SEPARATION_MODEL_REVISION,
            modelFiles: files,
          }),
          modelFiles: files,
          license: "Apache-2.0",
          domain: "WHAMR 16 kHz English mixtures",
          targetDomainCompatibility: "cross-domain-experimental",
        } as const;
      })();
const modelManifest = ctcModelManifestSchema.parse({
  schemaVersion: "1.0.0",
  artifactType: "ctc-model-manifest",
  modelVersion: "C5.18.1",
  generatedAt: new Date().toISOString(),
  modelRepo: CTC_MODEL_REPO,
  requestedRevision: CTC_MODEL_REVISION,
  resolvedRevision: CTC_MODEL_REVISION,
  snapshotDirectory: ctcSnapshot,
  modelSnapshotHash,
  modelFiles,
  architecture: "Wav2Vec2ForCTC",
  language: "ja",
  license: CTC_MODEL_LICENSE,
  trustRemoteCode: false,
  networkUsedDuringPreparation:
    values["fetch-ctc-model"] || values["fetch-separation-model"],
  hfTokenStored: false,
  separationModel,
});
await atomicWriteJson(modelManifestPath, modelManifest, { overwrite: true });
await loadAndVerifyCtcRuntime({ runtimeManifestPath, modelManifestPath });
process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      runtimeManifest: runtimeManifestPath,
      modelManifest: modelManifestPath,
      runtimeIdentityHash: runtimeManifest.runtimeIdentityHash,
      modelSnapshotHash,
      separationModelSnapshotHash:
        modelManifest.separationModel?.modelSnapshotHash ?? null,
    },
    null,
    2,
  )}\n`,
);
